import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { samplingAudit } from '../../scripts/sampling-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests/fixtures/sampling-audit');

// Build a tmp "projects dir" containing one fixture file with mtime forced
// to `now` so the days-window filter accepts it. Real ~/.claude/projects/<cwd>/
// stores transcripts as UUID.jsonl at the top level of the cwd-encoded dir.
function stageFixture(name, { mtimeDaysAgo = 0 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-'));
  const dest = path.join(tmp, `${name}.jsonl`);
  fs.copyFileSync(path.join(FIXTURE_DIR, `${name}.jsonl`), dest);
  if (mtimeDaysAgo > 0) {
    const past = new Date(Date.now() - mtimeDaysAgo * 86400000);
    fs.utimesSync(dest, past, past);
  }
  return tmp;
}

test('clean fixture: no rule hits', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.byRule['§10-V'].hits, 0);
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
    assert.equal(r.byRule['§10-honesty'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('vocab-hit fixture: §10-V fires on "significantly" + "robust" + "production-ready"', async () => {
  const dir = stageFixture('vocab-hit');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.ok(r.byRule['§10-V'].hits >= 1, `expected ≥1 §10-V hit, got ${r.byRule['§10-V'].hits}`);
    assert.equal(r.byRule['§10-V'].transcriptsAffected, 1);
    // Iron-law-2 / order should NOT fire — fixture has no four-section block.
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('iron-law-2-miss fixture: §iron-law-2 fires on Done without evidence', async () => {
  const dir = stageFixture('iron-law-2-miss');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§iron-law-2'].hits, 1);
    assert.equal(r.byRule['§iron-law-2'].transcriptsAffected, 1);
    // Order is correct (Done<Not done<Failed<Uncertain) → no order hit.
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
    // Uncertain line has "because" → no honesty hit.
    assert.equal(r.byRule['§10-honesty'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('order-violation fixture: §10-four-section-order fires', async () => {
  const dir = stageFixture('order-violation');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-four-section-order'].hits, 1);
    assert.equal(r.byRule['§10-four-section-order'].transcriptsAffected, 1);
    // Done has tests evidence → no iron-law-2 hit.
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('honesty-bare fixture: §10-honesty fires on bare Uncertain', async () => {
  const dir = stageFixture('honesty-bare');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-honesty'].hits, 1);
    assert.equal(r.byRule['§10-honesty'].transcriptsAffected, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('multi-turn fixture: detects per-turn hits across one transcript', async () => {
  const dir = stageFixture('multi-turn');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // 3 assistant turns: clean / vocab-hit / honesty-bare → 2 distinct rule hits.
    assert.ok(r.byRule['§10-V'].hits >= 1, 'expected vocab hit on turn 2');
    assert.equal(r.byRule['§10-honesty'].hits, 1, 'expected honesty hit on turn 3');
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.totalTurns, 3, 'expected 3 assistant text turns counted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('days window: mtime older than window is excluded', async () => {
  const dir = stageFixture('vocab-hit', { mtimeDaysAgo: 60 });
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 0, 'old transcript should be filtered out');
    assert.equal(r.byRule['§10-V'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate shape: byRule keys are all 4 rules with hits+transcriptsAffected', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    for (const key of ['§10-V', '§iron-law-2', '§10-four-section-order', '§10-honesty']) {
      assert.ok(r.byRule[key], `missing rule ${key}`);
      assert.equal(typeof r.byRule[key].hits, 'number');
      assert.equal(typeof r.byRule[key].transcriptsAffected, 'number');
    }
    assert.equal(typeof r.windowDays, 'number');
    assert.equal(typeof r.scannedTranscripts, 'number');
    assert.equal(typeof r.totalTurns, 'number');
    assert.ok(Array.isArray(r.perTranscript), 'perTranscript must be array');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing projectsDir: returns zero result, no throw', async () => {
  const r = await samplingAudit({
    projectsDir: '/nonexistent/path/that/does/not/exist',
    days: 30,
    pluginRoot: REPO_ROOT,
  });
  assert.equal(r.scannedTranscripts, 0);
});
