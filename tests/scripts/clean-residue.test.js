import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  scan,
  clean,
  scanClaudeTmp,
  cleanClaudeTmp,
  scanStateDir,
  cleanStateDir,
} from '../../scripts/clean-residue.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/clean-residue.js');

let tmpDir;

const setMtime = (p, daysAgo) => {
  const t = (Date.now() - daysAgo * 86400000) / 1000;
  fs.utimesSync(p, t, t);
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-clean-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scan finds claudemd-sync-* files and claudemd-(mockgh|work).* dirs', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-abc'), '');
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-xyz123'), '');
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockgh.AAA'));
  fs.mkdirSync(path.join(tmpDir, 'claudemd-work.BBB'));
  fs.writeFileSync(path.join(tmpDir, 'unrelated.txt'), '');
  fs.mkdirSync(path.join(tmpDir, 'unrelated-dir'));

  const r = scan({ tmpDir });
  assert.equal(r.sentinels.length, 2);
  assert.equal(r.sandboxes.length, 2);
});

// --- audit-2026-08-22 P1-5: the memtags spill file had no reaper ------------
//
// hooks/lib/memory-tags.sh spills an oversize haystack to a $TMPDIR file. If
// the hook is killed at its hooks.json timeout — the exact scenario that
// library was written for — the file survives, and its name matched NEITHER
// pattern here nor residue-audit's ~/.claude/tmp scope. Nothing would ever
// collect it. The template is read out of the shell source rather than
// hand-copied, so renaming it there fails HERE instead of silently orphaning
// the files again (feedback_extraction_needs_consumer_gate).
test('P1-5: the memtags spill template is reaped by scan()', () => {
  const lib = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../hooks/lib/memory-tags.sh'),
    'utf8'
  );
  const m = lib.match(/mktemp\s+"\$\{TMPDIR:-\/tmp\}\/([A-Za-z0-9._-]*X{3,})"/);
  assert.ok(m, 'could not find the mktemp template in hooks/lib/memory-tags.sh');
  // mktemp replaces the trailing X run with random chars.
  const sample = m[1].replace(/X+$/, 'a1b2c3');
  fs.writeFileSync(path.join(tmpDir, sample), 'spilled haystack');

  const r = scan({ tmpDir });
  assert.ok(
    r.sentinels.some(s => path.basename(s.path) === sample),
    `${sample} is left in $TMPDIR by a killed hook but no clean-residue pattern matches it`
  );
});

test('scan tolerates missing/empty dir', () => {
  const r = scan({ tmpDir });
  assert.deepEqual(r.sentinels, []);
  assert.deepEqual(r.sandboxes, []);

  const r2 = scan({ tmpDir: path.join(tmpDir, 'nonexistent') });
  assert.deepEqual(r2.sentinels, []);
  assert.deepEqual(r2.sandboxes, []);
});

test('clean dryRun returns targets without deleting', () => {
  const f = path.join(tmpDir, 'claudemd-sync-old');
  fs.writeFileSync(f, '');
  setMtime(f, 5);

  const r = clean({ tmpDir, apply: false });
  assert.equal(r.dryRun, true);
  assert.equal(r.deleted, 0);
  assert.equal(r.targets.length, 1);
  assert.ok(fs.existsSync(f), 'dry-run must not delete');
});

test('clean apply deletes only entries older than ageDaysMin', () => {
  const old = path.join(tmpDir, 'claudemd-sync-old');
  const fresh = path.join(tmpDir, 'claudemd-sync-fresh');
  fs.writeFileSync(old, '');
  fs.writeFileSync(fresh, '');
  setMtime(old, 5);
  // fresh's mtime stays "now" — under the 1-day threshold

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 1);
  assert.ok(!fs.existsSync(old), 'old must be deleted');
  assert.ok(fs.existsSync(fresh), 'fresh must be preserved');
});

test('clean apply deletes sandbox dirs recursively', () => {
  const sandbox = path.join(tmpDir, 'claudemd-mockgh.XYZ');
  fs.mkdirSync(sandbox);
  fs.writeFileSync(path.join(sandbox, 'gh'), 'fake content');
  fs.mkdirSync(path.join(sandbox, 'nested'));
  setMtime(sandbox, 5);
  setMtime(path.join(sandbox, 'gh'), 5);
  setMtime(path.join(sandbox, 'nested'), 5);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 1);
  assert.ok(!fs.existsSync(sandbox));
});

test('clean does NOT touch non-matching files', () => {
  const safe = path.join(tmpDir, 'unrelated.txt');
  fs.writeFileSync(safe, 'keep me');
  setMtime(safe, 100);

  const safeDir = path.join(tmpDir, 'random-dir');
  fs.mkdirSync(safeDir);
  setMtime(safeDir, 100);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(safe));
  assert.equal(fs.readFileSync(safe, 'utf8'), 'keep me');
  assert.ok(fs.existsSync(safeDir));
});

test('clean ageDaysMin=0 includes brand-new entries', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-new'), '');
  const r = clean({ tmpDir, apply: true, ageDaysMin: 0 });
  assert.equal(r.deleted, 1);
});

test('clean does NOT match almost-similar names (anchor patterns)', () => {
  // Defense against future fnmatch-style sloppiness.
  fs.writeFileSync(path.join(tmpDir, 'not-claudemd-sync-foo'), '');
  fs.writeFileSync(path.join(tmpDir, 'xclaudemd-sync-foo'), '');
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockgh-noDot'));
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockghX.YYY'));
  for (const f of fs.readdirSync(tmpDir)) setMtime(path.join(tmpDir, f), 30);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 0, `unexpected matches: ${r.targets.map(t => t.path).join(', ')}`);
});

test('CLI dry-run by default prints sentinel/sandbox/deleted counts', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-z'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-z'), 5);

  const result = spawnSync(process.execPath, [SCRIPT], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const r = JSON.parse(result.stdout);
  assert.equal(r.dryRun, true);
  assert.equal(r.sentinels, 1);
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-z')), 'CLI default must not delete');
});

test('CLI --apply deletes; subsequent run is idempotent', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-z'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-z'), 5);

  const r1 = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r1.status, 0);
  const o1 = JSON.parse(r1.stdout);
  assert.equal(o1.deleted, 1);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'claudemd-sync-z')));

  const r2 = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  const o2 = JSON.parse(r2.stdout);
  assert.equal(o2.deleted, 0);
});

test('CLI --age-days=N overrides default 1-day threshold', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-3d'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-3d'), 3);

  // age-days=7 should NOT match a 3-day-old file
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--age-days=7'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  const o = JSON.parse(r.stdout);
  assert.equal(o.deleted, 0);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-3d')));
});

test('CLI rejects negative --age-days', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--age-days=-1'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /non-negative/i);
});

test('CLI rejects space-form --age-days 0 (was silent default → exit 0 + 0 deleted)', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-now'), '');
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--age-days', '0'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `expected exit 2 (ArgvError); got ${r.status}, stderr: ${r.stderr}`);
  assert.match(r.stderr, /requires '=value' form/);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-now')), 'must not delete on parse error');
});

test('CLI rejects unknown flag (was silent ignore)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--bogus=x'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown flag.*--bogus/);
});

// --- ~/.claude/tmp retention (spec §EXT §7-EXT: purge mtime > TMP_RETENTION_DAYS, default 7) ---

let claudeTmp;

const mkStale = (rel, daysAgo, { dir = true } = {}) => {
  const p = path.join(claudeTmp, rel);
  if (dir) {
    fs.mkdirSync(p, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  }
  setMtime(p, daysAgo);
  return p;
};

// Sandboxed state dir for every CLI spawn. Without CLAUDEMD_STATE_DIR the
// script resolves ~/.claude/.claudemd-state, so `--apply` ran the destructive
// reaper against the maintainer's LIVE state directory — §8.V3 ("session-new
// destructive paths MUST sandbox-test first") straight through the test suite.
// Invisible until R10-09 added a `remaining` count and this file started
// failing on whatever the live directory happened to hold. Every spawn goes
// through cliEnv() so a new case cannot reintroduce the omission by writing an
// env literal that happens to be one key short.
let cliStateDir;
const cliEnv = (extra = {}) => ({
  ...process.env,
  TMPDIR: tmpDir,
  CLAUDEMD_CLAUDE_TMP_DIR: claudeTmp,
  CLAUDEMD_STATE_DIR: cliStateDir,
  ...extra,
});

beforeEach(() => {
  claudeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-ctmp-test-'));
  cliStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-cstate-test-'));
});

afterEach(() => {
  fs.rmSync(claudeTmp, { recursive: true, force: true });
  fs.chmodSync(cliStateDir, 0o700);
  fs.rmSync(cliStateDir, { recursive: true, force: true });
});

test('scanClaudeTmp lists stale depth-1 entries; descends into claude-<uid> instead of listing it', () => {
  const staleTop = mkStale('gsd-errcode-old', 30);
  const staleFile = mkStale('stray.log', 30, { dir: false });
  mkStale('fresh-dir', 0);
  const staleChild = mkStale('claude-1000/old-session', 30);
  mkStale('claude-1000/fresh-session', 0);
  setMtime(path.join(claudeTmp, 'claude-1000'), 30); // uid dir itself stale — must still not be a candidate

  const r = scanClaudeTmp({ claudeTmpDir: claudeTmp });
  const paths = r.candidates.map(c => c.path).sort();
  assert.ok(paths.includes(staleTop));
  assert.ok(paths.includes(staleFile));
  assert.ok(paths.includes(staleChild));
  assert.ok(
    !paths.some(p => p === path.join(claudeTmp, 'claude-1000')),
    'uid dir itself must never be a candidate'
  );
  // fresh entries are still listed by scan (age filter is clean's job) with ageDays ~0
  const fresh = r.candidates.find(c => c.path.endsWith('fresh-dir'));
  assert.ok(fresh && fresh.ageDays < 1);
});

test('scanClaudeTmp exempts .keep-marked dirs', () => {
  const marked = mkStale('fixture-keepme', 30);
  fs.writeFileSync(path.join(marked, '.keep'), '');
  setMtime(marked, 30); // writing .keep refreshed dir mtime; re-age it
  const plain = mkStale('fixture-plain', 30);

  const r = scanClaudeTmp({ claudeTmpDir: claudeTmp });
  const paths = r.candidates.map(c => c.path);
  assert.ok(!paths.includes(marked), '.keep-marked dir must be exempt');
  assert.ok(paths.includes(plain));
});

test('cleanClaudeTmp dry-run by default; apply deletes >= retentionDays and keeps the rest', () => {
  const old1 = mkStale('old-a', 10);
  const old2 = mkStale('claude-1000/old-b', 10);
  const fresh = mkStale('fresh-c', 2);

  const dry = cleanClaudeTmp({ claudeTmpDir: claudeTmp, retentionDays: 7 });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.deleted, 0);
  assert.equal(dry.targets.length, 2);
  assert.ok(fs.existsSync(old1) && fs.existsSync(old2), 'dry-run must not delete');

  const r = cleanClaudeTmp({ claudeTmpDir: claudeTmp, apply: true, retentionDays: 7 });
  assert.equal(r.deleted, 2);
  assert.ok(!fs.existsSync(old1) && !fs.existsSync(old2));
  assert.ok(fs.existsSync(fresh), '2-day-old entry stays under 7-day retention');
  assert.ok(fs.existsSync(path.join(claudeTmp, 'claude-1000')), 'uid dir shell survives');
});

test('cleanClaudeTmp tolerates missing dir', () => {
  const r = cleanClaudeTmp({ claudeTmpDir: path.join(claudeTmp, 'nonexistent'), apply: true });
  assert.equal(r.deleted, 0);
  assert.deepEqual(r.targets, []);
});

test('CLI --apply also purges CLAUDEMD_CLAUDE_TMP_DIR and reports claudeTmp section', () => {
  mkStale('old-x', 10);
  mkStale('claude-1000/old-y', 10);
  mkStale('fresh-z', 1);
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-q'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-q'), 5);

  const r = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const o = JSON.parse(r.stdout);
  assert.equal(o.deleted, 1, '$TMPDIR sentinel path still works');
  assert.equal(o.claudeTmp.retentionDays, 7);
  assert.equal(o.claudeTmp.deleted, 2);
  assert.ok(!fs.existsSync(path.join(claudeTmp, 'old-x')));
  assert.ok(fs.existsSync(path.join(claudeTmp, 'fresh-z')));
});

test('CLI dry-run default lists claudeTmp candidates without deleting', () => {
  mkStale('old-x', 10);
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  const o = JSON.parse(r.stdout);
  assert.equal(o.dryRun, true);
  assert.equal(o.claudeTmp.candidates, 1);
  assert.equal(o.claudeTmp.deleted, 0);
  assert.ok(fs.existsSync(path.join(claudeTmp, 'old-x')));
});

test('CLI --retention-days=N overrides default; bad shape rejected', () => {
  mkStale('old-x', 10);
  const keep = spawnSync(process.execPath, [SCRIPT, '--apply', '--retention-days=30'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(keep.stdout).claudeTmp.deleted, 0, '10d-old stays under 30d retention');
  assert.ok(fs.existsSync(path.join(claudeTmp, 'old-x')));

  const bad = spawnSync(process.execPath, [SCRIPT, '--retention-days=-3'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /non-negative/i);
});

test('CLI reads TMP_RETENTION_DAYS from cwd CLAUDE.md; flag wins over file', () => {
  mkStale('old-x', 10);
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-proj-test-'));
  fs.writeFileSync(path.join(projDir, 'CLAUDE.md'), 'AUTONOMY_LEVEL: aggressive\nTMP_RETENTION_DAYS: 30\n');

  try {
    const viaFile = spawnSync(process.execPath, [SCRIPT, '--apply'], {
      cwd: projDir,
      env: cliEnv(),
      encoding: 'utf8',
    });
    const o1 = JSON.parse(viaFile.stdout);
    assert.equal(o1.claudeTmp.retentionDays, 30);
    assert.equal(o1.claudeTmp.deleted, 0, '30d retention from CLAUDE.md keeps 10d-old entry');

    const viaFlag = spawnSync(process.execPath, [SCRIPT, '--apply', '--retention-days=7'], {
      cwd: projDir,
      env: cliEnv(),
      encoding: 'utf8',
    });
    const o2 = JSON.parse(viaFlag.stdout);
    assert.equal(o2.claudeTmp.retentionDays, 7, 'flag overrides CLAUDE.md');
    assert.equal(o2.claudeTmp.deleted, 1);
  } finally {
    fs.rmSync(projDir, { recursive: true, force: true });
  }
});

// --- state-dir orphan reaping (2026-07-28 audit H3) --------------------------
// The plugin's own state dir was outside every cleaner's scope. The risk in
// closing that gap is over-reach: the dir mixes disposable per-session
// sentinels with live singleton state whose age says nothing about whether it
// is still in use. These lock BOTH directions.

test('scanStateDir picks up only the three ephemeral classes', () => {
  const stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  for (const f of ['ext-read-a.ts', 'failopen-banned-vocab-bad-event.ts', 'mem-coverage-b.ts']) {
    fs.writeFileSync(path.join(stateDir, f), '0');
    setMtime(path.join(stateDir, f), 30);
  }
  for (const f of ['tmp-baseline.txt', 'session-start.ref', 'l2-task-counter']) {
    fs.writeFileSync(path.join(stateDir, f), '0');
    setMtime(path.join(stateDir, f), 300);
  }
  const { candidates } = scanStateDir({ stateDir });
  assert.deepEqual(candidates.map(c => c.kind).sort(), ['ext-read', 'failopen', 'mem-coverage']);
});

test('scanStateDir reaps vocab-scan sentinels', () => {
  // transcript-vocab-scan.sh writes one per session and NOTHING reaps it — a
  // strictly worse leak than ext-read-*, which self-reaps on a clean exit. The
  // first draft of STATE_EPHEMERAL missed it because the path is built from
  // $VS_STATE_DIR, so the extraction keyed on $STATE_DIR could not see it.
  const stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const f = path.join(stateDir, 'vocab-scan-abc123.last');
  fs.writeFileSync(f, 'deadbeef');
  setMtime(f, 30);
  const { candidates } = scanStateDir({ stateDir });
  assert.deepEqual(
    candidates.map(c => c.kind),
    ['vocab-scan']
  );
});

test('cleanStateDir never deletes live singleton state, however old', () => {
  const stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  // Every non-ephemeral name the state dir is known to carry, aged well past
  // any retention window. Age must not be sufficient grounds for deletion.
  const live = [
    'tmp-baseline.txt',
    'session-start.ref',
    'upstream-check.lastrun',
    'last-session-summary.json',
    'last-session-summary.json.last-shown',
    'bootstrap-failed.json',
    'l2-task-counter',
    'ship-baseline-recent',
    'mem-audit.lastrun',
    'session-summary.lastrun',
    'statusline-prev.json',
  ];
  for (const f of live) {
    fs.writeFileSync(path.join(stateDir, f), '0');
    setMtime(path.join(stateDir, f), 300);
  }
  const res = cleanStateDir({ stateDir, apply: true, retentionDays: 7 });
  assert.equal(res.deleted, 0, 'live singleton state must be untouchable by age alone');
  for (const f of live) {
    assert.ok(fs.existsSync(path.join(stateDir, f)), `${f} was deleted`);
  }
});

test('cleanStateDir respects retention and dry-run by default', () => {
  const stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const old = path.join(stateDir, 'ext-read-old.ts');
  const fresh = path.join(stateDir, 'ext-read-fresh.ts');
  fs.writeFileSync(old, '0');
  setMtime(old, 30);
  fs.writeFileSync(fresh, '0');

  const dry = cleanStateDir({ stateDir, retentionDays: 7 });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.deleted, 0);
  assert.ok(fs.existsSync(old), 'dry run must not delete');

  const applied = cleanStateDir({ stateDir, apply: true, retentionDays: 7 });
  assert.equal(applied.deleted, 1);
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(fresh), 'a sentinel inside the retention window is still live');
});

// --- 2026-08-29 audit R10-09 ----------------------------------------------

test('R10-09: stateDir.dir echoes the directory actually scanned', () => {
  // The key serialized the imported stateDir FUNCTION, and JSON.stringify drops
  // function values — so the field vanished, and the one thing the
  // CLAUDEMD_STATE_DIR seam exists to let a caller confirm was unconfirmable.
  const stateDir = path.join(tmpDir, 'state-echo');
  fs.mkdirSync(stateDir, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: cliEnv({ CLAUDEMD_STATE_DIR: stateDir }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const o = JSON.parse(r.stdout);
  assert.equal(typeof o.stateDir.dir, 'string');
  assert.equal(o.stateDir.dir, stateDir);
});

test('R10-09: --apply that cannot delete exits 3 and reports what remains', () => {
  // All three cleaners swallow per-entry rmSync failures and count only
  // successes, so a run that removed nothing still printed its JSON and exited
  // 0 — a wrapper gating on this command read "clean" over untouched residue.
  const stateDir = path.join(tmpDir, 'state-locked');
  fs.mkdirSync(stateDir, { recursive: true });
  const stuck = path.join(stateDir, 'ext-read-stuck.ts');
  fs.writeFileSync(stuck, '0');
  setMtime(stuck, 30);
  // Make the entry undeletable by removing write permission on its PARENT —
  // unlink needs write on the directory, not on the file.
  fs.chmodSync(stateDir, 0o500);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--apply'], {
      env: cliEnv({ CLAUDEMD_STATE_DIR: stateDir }),
      encoding: 'utf8',
    });
    const o = JSON.parse(r.stdout);
    // Premise check: if the platform let the delete through (running as root,
    // or a filesystem that ignores mode bits) this case proves nothing, so say
    // so rather than passing vacuously.
    if (o.stateDir.deleted === 1) {
      assert.ok(
        process.getuid && process.getuid() === 0,
        'delete succeeded despite mode 0500 — only expected as root'
      );
      return;
    }
    assert.equal(o.stateDir.candidates, 1);
    assert.equal(o.stateDir.deleted, 0);
    assert.equal(o.remaining, 1, 'remaining must report the target left behind');
    assert.equal(r.status, 3, `expected exit 3, got ${r.status} (stderr: ${r.stderr})`);
  } finally {
    fs.chmodSync(stateDir, 0o700);
  }
});

test('R10-09: a clean --apply still exits 0 with remaining=0', () => {
  // FP guard — the new exit code must not fire on the ordinary success path.
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-ok'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-ok'), 5);
  const r = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).remaining, 0);
});

test('R10-09: a dry run never reports remaining, however many candidates', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-dry'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-dry'), 5);
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: cliEnv(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.ok(o.sentinels >= 1);
  assert.equal(o.remaining, 0, 'a dry run deletes nothing by definition');
});

// --- unowned mktemp-default residue (2026-09-02 audit R11-38) ------------------
//
// The recycler matched on the `claudemd-` prefix, so it was blind to the biggest
// residue class this project produced: a bare `mktemp -d` yields
// `tmp.XXXXXXXXXX`, which no prefix here covers. Measured that day: 2.4 GB and
// 150-250 stray directories a day. These lock the two halves of the fix — the
// shape is recognised EXACTLY, and recognising it does not by itself widen what
// `--apply` deletes.

test('scan classifies the exact default mktemp shape as unowned, and nothing else', () => {
  fs.mkdirSync(path.join(tmpDir, 'tmp.SfxwqKagsR')); // real leaked shape, 10 alnum
  fs.writeFileSync(path.join(tmpDir, 'tmp.a1B2c3D4e5'), ''); // `mktemp` without -d
  // Near-misses that a `tmp.*` glob would have swallowed. Someone's own
  // tmp.backup is not this tool's to delete.
  fs.mkdirSync(path.join(tmpDir, 'tmp.backup'));
  fs.mkdirSync(path.join(tmpDir, 'tmp.short'));
  fs.mkdirSync(path.join(tmpDir, 'tmp.ELEVENCHARS'));
  fs.mkdirSync(path.join(tmpDir, 'tmp.has-dash12'));
  fs.mkdirSync(path.join(tmpDir, 'nottmp.SfxwqKagsR'));

  const names = scan({ tmpDir })
    .unowned.map(u => path.basename(u.path))
    .sort();
  assert.deepEqual(names, ['tmp.SfxwqKagsR', 'tmp.a1B2c3D4e5']);
});

test('unowned residue is counted on every run but NOT deleted without --include-unowned', () => {
  const stale = path.join(tmpDir, 'tmp.SfxwqKagsR');
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, 'payload'), 'x'.repeat(4096));
  setMtime(stale, 30);
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-owned'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-owned'), 30);

  const dry = clean({ tmpDir, apply: false });
  assert.equal(dry.unowned.scanned, 1);
  assert.equal(dry.unowned.stale, 1);
  assert.equal(dry.unowned.included, false);
  assert.ok(
    dry.unowned.bytes >= 4096,
    `bytes ${dry.unowned.bytes} — the size report is what makes the cost legible`
  );
  assert.deepEqual(
    dry.targets.map(t => path.basename(t.path)),
    ['claudemd-sync-owned'],
    'an unowned entry must not enter the delete set just because it was counted'
  );

  // --apply alone must still not touch it: someone running the flag today
  // expects claudemd-prefixed residue to go and nothing else.
  clean({ tmpDir, apply: true });
  assert.ok(fs.existsSync(stale), '--apply without --include-unowned deleted an unowned directory');
  assert.ok(!fs.existsSync(path.join(tmpDir, 'claudemd-sync-owned')), 'the owned sentinel should have gone');
});

test('--include-unowned deletes only entries past the retention window', () => {
  const old = path.join(tmpDir, 'tmp.OLDentry12');
  const fresh = path.join(tmpDir, 'tmp.FRESHone12');
  fs.mkdirSync(old);
  fs.mkdirSync(fresh);
  setMtime(old, 30);
  setMtime(fresh, 2);

  const r = clean({ tmpDir, apply: true, includeUnowned: true, unownedRetentionDays: 7 });
  assert.equal(r.unowned.scanned, 2);
  assert.equal(r.unowned.stale, 1);
  assert.ok(!fs.existsSync(old), 'a 30-day-old unowned dir past a 7-day window should be gone');
  assert.ok(
    fs.existsSync(fresh),
    'a 2-day-old unowned dir may belong to a process still running — the window is the whole safeguard'
  );
});

test('CLI: --include-unowned is a known flag and its counts reach the JSON', () => {
  fs.mkdirSync(path.join(tmpDir, 'tmp.CLIentry12'));
  setMtime(path.join(tmpDir, 'tmp.CLIentry12'), 30);
  const r = spawnSync(process.execPath, [SCRIPT, '--include-unowned'], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmpDir },
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.unowned.included, true);
  assert.equal(j.unowned.scanned, 1);
  assert.equal(j.unowned.stale, 1);
  assert.equal(j.dryRun, true, 'without --apply it must still delete nothing');
  assert.ok(fs.existsSync(path.join(tmpDir, 'tmp.CLIentry12')));
});
