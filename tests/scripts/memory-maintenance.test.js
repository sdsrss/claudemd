import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { memoryMaintenance, CITE_MIN, PROMOTE_MIN_AGE_DAYS, RECALL_MAX_AGE_DAYS, STALE_AGE_DAYS } from '../../scripts/lib/memory-maintenance.js';

const DAY_MS = 86400000;

// Relative timestamps throughout — hardcoded dates age out of windowed
// queries and detonate weeks later (feedback_test_fixture_absolute_dates_time_bomb).
function daysAgo(now, d) { return now - d * DAY_MS; }

function stage({ now }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-mm-'));
  const memDir = path.join(tmp, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const touch = (name, ageDays) => {
    const p = path.join(memDir, name);
    fs.writeFileSync(p, `# ${name}\n`);
    const t = new Date(daysAgo(now, ageDays));
    fs.utimesSync(p, t, t);
  };
  touch('MEMORY.md', 200);              // index — always excluded
  touch('recall_old_plugin_gap.md', 45); // (b) candidate: recall_* older than 30d
  touch('recall_fresh.md', 5);           // recall_* within 30d — not a candidate
  touch('feedback_stale_never_hit.md', 120); // (c) candidate: old + no log mention
  touch('feedback_old_but_hit.md', 120);     // old but mentioned in-window → alive
  touch('feedback_recent.md', 3);            // young → not stale

  const logPath = path.join(tmp, 'claudemd.jsonl');
  const inWindow = new Date(daysAgo(now, 10)).toISOString();
  const outOfWindow = new Date(daysAgo(now, 100)).toISOString();
  fs.writeFileSync(logPath,
    // In-window mention keeps feedback_old_but_hit.md alive.
    `{"ts":"${inWindow}","hook":"memory-read-check","event":"deny","extra":{"missing":["feedback_old_but_hit.md"],"match_count":1}}\n` +
    // Out-of-window mention of the stale file must NOT count as liveness.
    `{"ts":"${outOfWindow}","hook":"memory-prompt-hint","event":"suggest","extra":{"suggested":["feedback_stale_never_hit.md"]}}\n`
  );
  return { tmp, memDir, logPath };
}

async function makeMemLiteDb(dir, project, now) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = path.join(dir, 'claude-mem-lite.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE observations (
    id INTEGER PRIMARY KEY, project TEXT, title TEXT, lesson_learned TEXT,
    cited_count INTEGER, created_at_epoch INTEGER, superseded_at TEXT, demoted_at TEXT
  )`);
  const ins = db.prepare('INSERT INTO observations (project, title, lesson_learned, cited_count, created_at_epoch, superseded_at, demoted_at) VALUES (?,?,?,?,?,?,?)');
  // Qualifying: cited 5×, 40d old, live.
  ins.run(project, 'hot lesson', 'always flatten newlines', 5, daysAgo(now, 40), null, null);
  // Too young (5d) despite citations.
  ins.run(project, 'young lesson', 'x', 4, daysAgo(now, 5), null, null);
  // Under cite threshold.
  ins.run(project, 'cold lesson', 'y', CITE_MIN - 1, daysAgo(now, 60), null, null);
  // Superseded — excluded.
  ins.run(project, 'overturned lesson', 'z', 9, daysAgo(now, 60), '2026-01-01', null);
  // Other project — excluded.
  ins.run('other--proj', 'foreign lesson', 'w', 9, daysAgo(now, 60), null, null);
  db.close();
  return dbPath;
}

test('E2 (b)+(c): recall repatriation + stale-durable candidates, in-window mention keeps a file alive', async () => {
  const now = Date.now();
  const { tmp, memDir, logPath } = stage({ now });
  try {
    const r = await memoryMaintenance({
      cwd: '/x/projects/claudemd', memDir, logPath, now,
      memLiteDbPath: path.join(tmp, 'absent.db'),
    });
    assert.deepEqual(r.recallRepatriation.map(c => c.file), ['recall_old_plugin_gap.md']);
    assert.ok(r.recallRepatriation[0].ageDays > RECALL_MAX_AGE_DAYS);
    assert.deepEqual(r.staleDurable.map(c => c.file), ['feedback_stale_never_hit.md'],
      'out-of-window mention must not count as liveness; in-window mention must');
    assert.ok(r.staleDurable[0].ageDays > STALE_AGE_DAYS);
    // MEMORY.md excluded; 5 scanned (2 recall + 3 feedback).
    assert.equal(r.scannedDurableFiles, 5);
    // Absent DB → graceful skip, not a throw.
    assert.equal(r.promoteToDurable.length, 0);
    assert.match(r.promoteSkipped, /not found/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('E2 (a): promote-to-durable from mem-lite — cite>=3, age>=30d, live, same project only', async () => {
  const now = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-mm-db-'));
  try {
    const cwd = '/x/projects/claudemd'; // → mem-lite project 'projects--claudemd'
    const dbPath = await makeMemLiteDb(tmp, 'projects--claudemd', now);
    const r = await memoryMaintenance({
      cwd, memDir: path.join(tmp, 'no-such-memdir'), logPath: path.join(tmp, 'no.jsonl'),
      memLiteDbPath: dbPath, now,
    });
    assert.equal(r.promoteSkipped, null);
    assert.deepEqual(r.promoteToDurable.map(c => c.title), ['hot lesson'],
      'young / under-cited / superseded / foreign-project lessons must not qualify');
    assert.equal(r.promoteToDurable[0].citedCount, 5);
    assert.equal(PROMOTE_MIN_AGE_DAYS, 30);
    assert.equal(CITE_MIN, 3);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('E2: missing memory dir returns empty (b)/(c) without throwing', async () => {
  const now = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-mm-empty-'));
  try {
    const r = await memoryMaintenance({
      cwd: '/x/projects/claudemd',
      memDir: path.join(tmp, 'nope'),
      logPath: path.join(tmp, 'no.jsonl'),
      memLiteDbPath: path.join(tmp, 'no.db'),
      now,
    });
    assert.deepEqual(r.recallRepatriation, []);
    assert.deepEqual(r.staleDurable, []);
    assert.equal(r.scannedDurableFiles, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
