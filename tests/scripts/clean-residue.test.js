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
  assert.match(bad.stderr, /at least 1/i);
});

// --- the retention floor (2026-09-02 pre-tag incident) -------------------------
//
// `~/.claude/tmp/claude-<uid>` holds every live session's scratchpad, and under
// the sandbox its bridge socket too; their mtimes are "now". A reviewer ran
// `--retention-days=0 --apply` with only $TMPDIR redirected, and the
// un-overridden ~/.claude/tmp scope removed every session's scratchpad on the
// box. `0` was accepted since v0.71.3 (`< 0` was the only check). These lock
// the floor at every entry: the flag, the project CLAUDE.md, and the library.

test('CLI --retention-days below 1 is rejected and deletes nothing', () => {
  const fresh = mkStale('live-session', 0.2);
  const old = mkStale('old-x', 10);
  for (const v of ['0', '0.5']) {
    const r = spawnSync(process.execPath, [SCRIPT, '--apply', `--retention-days=${v}`], {
      env: cliEnv(),
      encoding: 'utf8',
    });
    assert.equal(r.status, 1, `--retention-days=${v} must be a validation error, got ${r.status}`);
    assert.match(r.stderr, /at least 1/);
    assert.equal(r.stdout, '', 'a rejected window must not print a report as if it ran');
  }
  assert.ok(fs.existsSync(fresh), 'a live session dir survived');
  assert.ok(fs.existsSync(old), 'nothing at all was deleted on a rejected window');
});

test('CLI: TMP_RETENTION_DAYS below 1 in CLAUDE.md warns and falls back to the default', () => {
  const fresh = mkStale('live-session', 0.2);
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-proj-test-'));
  fs.writeFileSync(path.join(projDir, 'CLAUDE.md'), 'TMP_RETENTION_DAYS: 0\n');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--apply'], {
      cwd: projDir,
      env: cliEnv(),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /below the 1-day floor/, 'a cloned repo cannot silently set a zero window');
    assert.equal(JSON.parse(r.stdout).claudeTmp.retentionDays, 7);
    assert.ok(fs.existsSync(fresh));
  } finally {
    fs.rmSync(projDir, { recursive: true, force: true });
  }
});

test('library: cleanClaudeTmp / cleanStateDir clamp a sub-day window to the floor', () => {
  const fresh = mkStale('live-session', 0.2);
  const r = cleanClaudeTmp({ claudeTmpDir: claudeTmp, apply: true, retentionDays: 0 });
  assert.equal(r.retentionDays, 1, 'the effective window is reported, not the requested one');
  assert.ok(fs.existsSync(fresh), 'retentionDays: 0 through the library must not delete a fresh entry');

  const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-cstate-floor-'));
  try {
    fs.writeFileSync(path.join(sd, 'session-start-live.ref'), '');
    const s = cleanStateDir({ stateDir: sd, apply: true, retentionDays: 0 });
    assert.equal(s.retentionDays, 1);
    assert.ok(fs.existsSync(path.join(sd, 'session-start-live.ref')), "a live session's ref survived");
  } finally {
    fs.rmSync(sd, { recursive: true, force: true });
  }
});

// --- the self-path guard --------------------------------------------------------
//
// Env seams cannot stop a deleter from removing the tree its own $TMPDIR or cwd
// sits in — that scope is the one the caller did not override. The sandbox
// hands out `~/.claude/tmp/claude-<uid>` AS $TMPDIR, so a fixture made there is
// a child of the retention scope's target. The guard recognises the branch the
// process is sitting on, whatever the window says.

test('CLI --apply never deletes a stale entry that contains its own $TMPDIR or cwd', () => {
  // Stale project dirs under the uid dir; one of them holds this run's $TMPDIR,
  // another its cwd. Both are 30 days old by mtime, well past the window.
  const holdsTmp = mkStale('claude-1000/proj-tmp', 30);
  const fixtureTmp = path.join(holdsTmp, 'fixture');
  fs.mkdirSync(fixtureTmp);
  setMtime(holdsTmp, 30);
  const holdsCwd = mkStale('claude-1000/proj-cwd', 30);
  const cwd = path.join(holdsCwd, 'session');
  fs.mkdirSync(cwd);
  setMtime(holdsCwd, 30);
  const plain = mkStale('claude-1000/proj-plain', 30);

  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--retention-days=7'], {
    cwd,
    env: cliEnv({ TMPDIR: fixtureTmp }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `protected entries are not "remaining": ${r.stderr}`);
  const o = JSON.parse(r.stdout);
  assert.ok(fs.existsSync(holdsTmp), 'the tree holding $TMPDIR survived');
  assert.ok(fs.existsSync(holdsCwd), 'the tree holding cwd survived');
  assert.ok(!fs.existsSync(plain), 'an equally stale sibling was still reaped');
  assert.deepEqual(
    o.protected.map(p => path.basename(p.path)).sort(),
    ['proj-cwd', 'proj-tmp'],
    'the JSON names what was protected'
  );
  assert.equal(o.claudeTmp.deleted, 1);
  assert.equal(o.remaining, 0);
  assert.match(r.stderr, /2 stale entries skipped/);
});

test('library: clean() protects a stale sandbox that contains the process cwd', () => {
  const box = path.join(tmpDir, 'claudemd-work.self');
  fs.mkdirSync(path.join(box, 'inner'), { recursive: true });
  setMtime(box, 30);
  const other = path.join(tmpDir, 'claudemd-work.other');
  fs.mkdirSync(other);
  setMtime(other, 30);
  const prev = process.cwd();
  process.chdir(path.join(box, 'inner'));
  try {
    const r = clean({ tmpDir, apply: true });
    assert.ok(fs.existsSync(box), 'the sandbox holding cwd survived');
    assert.ok(!fs.existsSync(other), 'the other stale sandbox was reaped');
    assert.equal(r.protected.length, 1);
    assert.equal(r.deleted, 1);
  } finally {
    process.chdir(prev);
  }
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

test('scanStateDir reaps the legacy .last-shown banner sentinels', () => {
  // Both SessionStart banners renamed their sentinel to `.last-shown` instead of
  // deleting it, and no pattern here matched the result — the R10-21e leak. The
  // banners consume with rm as of 2026-09-05 (audit P3-1), so what remains on an
  // upgraded machine is a leftover, not live state, and this is what removes it.
  const stateDir = path.join(tmpDir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  for (const f of ['last-session-summary.json.last-shown', 'bootstrap-failed.json.last-shown']) {
    const p = path.join(stateDir, f);
    fs.writeFileSync(p, '0');
    setMtime(p, 300);
  }
  const { candidates } = scanStateDir({ stateDir });
  assert.deepEqual(
    candidates.map(c => c.kind),
    ['last-shown', 'last-shown']
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

test('shipped JSON: stateDir.candidates is the REAPABLE count, not everything scanned', () => {
  // The two numbers must be told apart by the fixture, or the assertion passes
  // under either reading. The R10-09 case above seeds a single 30-day file, so
  // there targets.length === scanned.length === 1 and it cannot discriminate —
  // the pre-tag review of v0.74.2 demonstrated that by rewriting this key to
  // the scanned set and watching the whole suite stay green (43/43).
  //
  // `cleanStateDir()` returns the full scan as `scanned` precisely so the word
  // `candidates` keeps exactly one meaning in the shipped output.
  const old = path.join(cliStateDir, 'ext-read-old.ts');
  const fresh = path.join(cliStateDir, 'ext-read-fresh.ts');
  fs.writeFileSync(old, '');
  fs.writeFileSync(fresh, '');
  setMtime(old, 30);
  setMtime(fresh, 0);

  const r = spawnSync(process.execPath, [SCRIPT], { env: cliEnv(), encoding: 'utf8' });
  const o = JSON.parse(r.stdout);
  assert.equal(o.stateDir.candidates, 1, 'only the 30-day file is past the 7-day window');
  assert.equal(o.stateDir.paths.length, 1);
  assert.match(o.stateDir.paths[0].path, /ext-read-old\.ts$/);
  // The premise: two files really are on disk, so a `1` cannot come from an
  // empty or single-entry directory.
  assert.equal(fs.readdirSync(cliStateDir).length, 2);
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
// The recycler's $TMPDIR pass matched on the `claudemd-` prefix, so the biggest
// residue class this project produced never appeared in its report: a bare
// `mktemp -d` yields `tmp.XXXXXXXXXX`, which no prefix here covers. Measured
// that day: 2.6 GB across 524 directories, 150-250 new ones a day. The class is
// COUNTED AND SIZED, never deleted — the 0.72.0 pre-tag review withdrew the
// delete flag (see UNOWNED_MKTEMP_PATTERN). These lock both halves: the shape
// is recognised EXACTLY, and no option reaches a deletion of it.

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

test('unowned residue is counted and sized on every run and never deleted', () => {
  const stale = path.join(tmpDir, 'tmp.SfxwqKagsR');
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, 'payload'), 'x'.repeat(4096));
  setMtime(stale, 30);
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-owned'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-owned'), 30);

  const dry = clean({ tmpDir, apply: false });
  assert.equal(dry.unowned.scanned, 1);
  assert.ok(
    dry.unowned.bytes >= 4096,
    `bytes ${dry.unowned.bytes} — the size report is what makes the cost legible`
  );
  assert.deepEqual(
    dry.targets.map(t => path.basename(t.path)),
    ['claudemd-sync-owned'],
    'an unowned entry must not enter the delete set just because it was counted'
  );

  // No option reaches it. The withdrawn flag's spellings are passed on purpose:
  // if either ever comes back as a live parameter, this is the test that goes red.
  clean({ tmpDir, apply: true, ageDaysMin: 0, includeUnowned: true, unownedRetentionDays: 0 });
  assert.ok(fs.existsSync(stale), 'an unowned directory was deleted');
  assert.ok(!fs.existsSync(path.join(tmpDir, 'claudemd-sync-owned')), 'the owned sentinel should have gone');
});

test('CLI: --include-unowned is no longer a flag; the counts reach the JSON without it', () => {
  fs.mkdirSync(path.join(tmpDir, 'tmp.CLIentry12'));
  setMtime(path.join(tmpDir, 'tmp.CLIentry12'), 30);
  const gone = spawnSync(process.execPath, [SCRIPT, '--include-unowned', '--apply'], {
    encoding: 'utf8',
    env: cliEnv(),
    timeout: 30000,
  });
  assert.equal(gone.status, 2, 'a withdrawn flag is an argv-shape error, not a silent no-op');
  assert.ok(fs.existsSync(path.join(tmpDir, 'tmp.CLIentry12')));

  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: cliEnv(),
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j.unowned).sort(), ['bytes', 'scanned']);
  assert.equal(j.unowned.scanned, 1);
  assert.ok(fs.existsSync(path.join(tmpDir, 'tmp.CLIentry12')));
});

// HIGH-1 of the 0.72.0 pre-tag review: scan()'s two early returns still
// returned two keys after `unowned` joined the destructure in clean(), so a
// missing or unreadable $TMPDIR was a TypeError and exit 1 instead of an empty
// report. Both early-return paths are driven here.
test('scan()/clean() on a missing or unreadable $TMPDIR return an empty report, not a TypeError', () => {
  const missing = path.join(tmpDir, 'does-not-exist');
  assert.deepEqual(scan({ tmpDir: missing }), { sentinels: [], sandboxes: [], unowned: [] });
  const r = clean({ tmpDir: missing, apply: true });
  assert.deepEqual(r.unowned, { scanned: 0, bytes: 0 });
  assert.deepEqual(r.targets, []);

  const cli = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: cliEnv({ TMPDIR: missing }),
    timeout: 30000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).unowned.scanned, 0);

  if (process.getuid && process.getuid() !== 0) {
    const unreadable = path.join(tmpDir, 'no-read');
    fs.mkdirSync(unreadable, { mode: 0o000 });
    try {
      assert.deepEqual(scan({ tmpDir: unreadable }), { sentinels: [], sandboxes: [], unowned: [] });
    } finally {
      fs.chmodSync(unreadable, 0o700);
    }
  }
});

// --- 2026-09-04: a target that cannot be deleted must say WHY -----------------
//
// Found by running `--apply` against the real machine: three entries under
// ~/.claude/tmp came back as targets on every run, `deleted: 0`, `remaining: 3`,
// exit 3 — honest about the outcome and silent about the cause. Two were
// another plugin's stale HOME whose `.claude/plugins` child is mode 0500 (rm
// cannot unlink through a directory with no write bit) and one was root-owned.
// Working that out took a hand-written `fs.rmSync` probe, because rmEach's
// `catch {}` discarded the errno.
//
// This is the deleter half of R11-24 (readers must count the rows they drop):
// a best-effort remover that reports only successes leaves the operator with a
// number and no next action. The window never closes on its own — a permission
// bit does not age out — so the entry is reported forever.
const mkUnreapable = name => {
  const dir = path.join(claudeTmp, name);
  fs.mkdirSync(path.join(dir, 'locked'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'locked', 'f'), 'x');
  fs.chmodSync(path.join(dir, 'locked'), 0o500);
  setMtime(dir, 30);
  return dir;
};
const unlock = dir => {
  try {
    fs.chmodSync(path.join(dir, 'locked'), 0o700);
  } catch {
    /* already gone */
  }
};

// The errno is platform-dependent and the property under test is not. Linux
// reports EACCES (the unlink inside the unwritable directory is refused);
// macOS surfaces the same refusal one level up as ENOTEMPTY (the rmdir of the
// parent fails because a child survives). The first version of these tests
// pinned 'EACCES', which is a fact about Linux, not about the fix — CI's macOS
// leg reddened on it at v0.74.0 while the code under test behaved correctly on
// both, reporting whichever errno it was actually given. EPERM is included
// because it is what the other real cause on 2026-09-04 (a root-owned entry)
// produces, and a test that names the platform's spelling instead of the
// property is the same defect twice.
const REFUSED = /^(EACCES|EPERM|ENOTEMPTY)$/;

test('cleanClaudeTmp reports the errno of a target it could not delete', t => {
  if (process.getuid && process.getuid() === 0) {
    t.diagnostic('SKIP: running as root — a 0500 directory does not stop root, so the fixture cannot fail');
    return;
  }
  const locked = mkUnreapable('stuck-a');
  const plain = path.join(claudeTmp, 'plain-b');
  fs.mkdirSync(plain);
  setMtime(plain, 30);
  try {
    const r = cleanClaudeTmp({ claudeTmpDir: claudeTmp, apply: true, retentionDays: 7 });
    assert.equal(r.targets.length, 2, 'both stale entries must be targets — otherwise this proves nothing');
    assert.equal(r.deleted, 1, 'the reapable one is still deleted; one stuck entry does not abort the pass');
    assert.equal(r.failures.length, 1, 'exactly one delete must have failed');
    assert.equal(r.failures[0].path, locked, 'the failure must name the entry that could not be removed');
    assert.match(
      r.failures[0].code,
      REFUSED,
      'the failed delete must carry a real errno, not vanish into a catch'
    );
    assert.ok(fs.existsSync(locked) && !fs.existsSync(plain));
  } finally {
    unlock(locked);
  }
});

test('CLI --apply prints unreapable entries with their errno and still exits 3', t => {
  if (process.getuid && process.getuid() === 0) {
    t.diagnostic('SKIP: running as root — a 0500 directory does not stop root, so the fixture cannot fail');
    return;
  }
  const locked = mkUnreapable('stuck-c');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--apply'], { env: cliEnv(), encoding: 'utf8' });
    assert.equal(r.status, 3, `expected the remaining-residue exit code; stderr: ${r.stderr}`);
    const o = JSON.parse(r.stdout);
    assert.equal(o.remaining, 1);
    assert.equal(
      o.unreapable.length,
      1,
      'the JSON must name what could not be removed — `remaining: 1` alone sent the maintainer ' +
        'to a hand-written rmSync probe to find out'
    );
    assert.equal(o.unreapable[0].path, locked);
    assert.match(o.unreapable[0].code, REFUSED, 'and why: the errno, whatever this platform calls it');
    // stderr too: the exit code and the JSON both need reading, and the one
    // thing an operator sees on a terminal is the message. Asserted against the
    // code the run actually produced rather than a literal, so this stays a
    // check that the two channels agree instead of a second platform pin.
    assert.match(r.stderr, new RegExp(o.unreapable[0].code));
    assert.match(r.stderr, /stuck-c/);
  } finally {
    unlock(locked);
  }
});

test('the unreapable report can be empty and can be non-empty (mutation control)', t => {
  if (process.getuid && process.getuid() === 0) {
    t.diagnostic('SKIP: running as root — a 0500 directory does not stop root');
    return;
  }
  // A clean pass must not manufacture failures: without this half, `failures`
  // could be hard-coded non-empty and both assertions above would still pass.
  const plain = path.join(claudeTmp, 'plain-d');
  fs.mkdirSync(plain);
  setMtime(plain, 30);
  const ok = cleanClaudeTmp({ claudeTmpDir: claudeTmp, apply: true, retentionDays: 7 });
  assert.equal(ok.deleted, 1);
  assert.deepEqual(ok.failures, [], 'a pass that deleted everything must report no failures');

  // The errno union must actually contain the spellings the supported platforms
  // produce. This machine only ever yields one of them, so without this the
  // macOS half of the claim is an assumption — and it was wrong once already,
  // in the release that added these tests.
  for (const code of ['EACCES', 'ENOTEMPTY', 'EPERM']) {
    assert.match(code, REFUSED, `${code} is a real refusal errno and must be accepted`);
  }
  assert.ok(
    !REFUSED.test('ENOENT'),
    'the union must not swallow "it was already gone", which is not a failure'
  );

  // And the fixture itself has to be capable of failing a delete — a chmod that
  // silently did nothing (a filesystem without permission bits, an overlay
  // mount) would make the two tests above vacuous rather than red.
  const locked = mkUnreapable('stuck-e');
  try {
    assert.throws(
      () => fs.rmSync(locked, { recursive: true, force: true }),
      e => REFUSED.test(e.code),
      'the 0500 fixture did not stop a delete on this filesystem — the tests above prove nothing here'
    );
  } finally {
    unlock(locked);
  }
});
