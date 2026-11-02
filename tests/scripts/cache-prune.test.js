import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pruneCache } from '../../scripts/lib/cache-prune.js';

let sandbox, versionsDir, savedHome, savedLogKnob;

function mkVersion(name) {
  const dir = path.join(versionsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker'), name);
  return dir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-prune-'));
  // HOME redirect, not a bespoke cacheRoot parameter: pruneCache now checks the
  // scan target against pluginCacheDir() (R11-02), which is derived from HOME
  // like every other path in paths.js. The layout below mirrors production
  // exactly — `~/.claude/plugins/cache/claudemd/claudemd/<version>`, i.e. the
  // versions dir sits ONE level under pluginCacheDir(), not at it.
  savedHome = process.env.HOME;
  process.env.HOME = sandbox;
  // pruneCache reads DISABLE_RULE_HITS_LOG (D#643); an exported value in the
  // shell turned four older cases red when this file ran alone (0.117.6 review L6).
  savedLogKnob = process.env.DISABLE_RULE_HITS_LOG;
  delete process.env.DISABLE_RULE_HITS_LOG;
  versionsDir = path.join(sandbox, '.claude/plugins/cache/claudemd/claudemd');
  fs.mkdirSync(versionsDir, { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  if (savedLogKnob === undefined) delete process.env.DISABLE_RULE_HITS_LOG;
  else process.env.DISABLE_RULE_HITS_LOG = savedLogKnob;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('keeps top 3 newest by semver, removes older', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  const current = path.join(versionsDir, '0.2.1');
  const r = pruneCache(current, { keep: 3 });
  assert.deepEqual(r.kept.sort(), ['0.1.6', '0.1.9', '0.2.1']);
  assert.equal(r.removed.length, 2);
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.4')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.2.1')));
});

test('always keeps current version even if older than top-3 newest', () => {
  // User rolled back: current is 0.1.6 but cache still has 0.2.1 + 0.1.9 + 0.1.7
  for (const v of ['0.1.1', '0.1.6', '0.1.7', '0.1.9', '0.2.1']) mkVersion(v);
  const current = path.join(versionsDir, '0.1.6');
  const r = pruneCache(current, { keep: 3 });
  assert.ok(r.kept.includes('0.1.6'), 'current version must survive prune');
  assert.equal(r.kept.length, 3);
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
});

test('fewer than keep → keep all, no removal', () => {
  for (const v of ['0.1.6', '0.2.1']) mkVersion(v);
  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });
  assert.equal(r.removed.length, 0);
  assert.equal(r.kept.length, 2);
});

test('non-semver sibling dirs are ignored, not deleted', () => {
  mkVersion('0.1.9');
  mkVersion('0.2.0');
  mkVersion('0.2.1');
  mkVersion('0.1.6');
  fs.mkdirSync(path.join(versionsDir, 'scratch-notes'), { recursive: true });
  fs.writeFileSync(path.join(versionsDir, 'scratch-notes/note.md'), 'x');
  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });
  assert.ok(fs.existsSync(path.join(versionsDir, 'scratch-notes')), 'non-semver dirs must be left alone');
  assert.ok(!r.kept.includes('scratch-notes'));
  assert.ok(!r.removed.some(p => p.endsWith('scratch-notes')));
});

test('non-semver pluginRoot basename skips pruning (dev-mode safety)', () => {
  // Running install.js from source repo: pluginRoot basename is 'claudemd'
  // (not X.Y.Z) — must NOT scan siblings of the repo dir.
  for (const v of ['0.1.6', '0.2.1']) mkVersion(v);
  const devRoot = path.join(sandbox, 'dev-checkout');
  fs.mkdirSync(devRoot, { recursive: true });
  const r = pruneCache(devRoot, { keep: 3 });
  assert.equal(r.skipped, 'non-semver-plugin-root');
  assert.equal(r.removed.length, 0);
  // All siblings untouched
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.2.1')));
});

test('missing versions parent dir → no-op', () => {
  const ghost = path.join(sandbox, 'does/not/exist/0.2.1');
  const r = pruneCache(ghost, { keep: 3 });
  assert.equal(r.skipped, 'missing-versions-dir');
  assert.equal(r.removed.length, 0);
});

test('semver sort handles multi-digit parts correctly (0.10.x > 0.9.x)', () => {
  for (const v of ['0.9.5', '0.10.0', '0.10.1', '0.11.0']) mkVersion(v);
  const r = pruneCache(path.join(versionsDir, '0.11.0'), { keep: 3 });
  assert.deepEqual(r.kept.sort(), ['0.10.0', '0.10.1', '0.11.0']);
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.9.5')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.10.0')));
});

// --- R11-02 (2026-09-02 audit): the shape guard was basename-only ---
// `SEMVER_RE.test(basename(pluginRoot))` says nothing about WHERE the scan
// happens, so any directory holding semver-named siblings was fair game for
// rm -rf: a `git worktree add ../0.70.0`, a version-named checkout, or a
// CLAUDE_PLUGIN_ROOT pointed at one. paths.js already exported
// pluginCacheDir(); nothing had ever asked it.

test('R11-02.1: semver-named dirs OUTSIDE the plugin cache are never removed', () => {
  const outside = path.join(sandbox, 'checkouts');
  fs.mkdirSync(outside, { recursive: true });
  for (const v of ['0.70.0', '0.71.1', '0.71.2', '0.71.3']) {
    fs.mkdirSync(path.join(outside, v), { recursive: true });
    fs.writeFileSync(path.join(outside, v, 'marker'), v);
  }

  const r = pruneCache(path.join(outside, '0.71.3'), { keep: 3 });

  assert.equal(r.skipped, 'outside-plugin-cache');
  assert.deepEqual(r.removed, []);
  for (const v of ['0.70.0', '0.71.1', '0.71.2', '0.71.3']) {
    assert.ok(fs.existsSync(path.join(outside, v)), `${v} must survive`);
  }
});

test('R11-02.2: the guard resolves symlinks — a link INTO the cache still prunes', () => {
  for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  const link = path.join(sandbox, 'link-to-current');
  fs.symlinkSync(path.join(versionsDir, '0.2.1'), link);

  const r = pruneCache(link, { keep: 3 });

  assert.equal(r.skipped, null, 'realpath lands inside the cache → prune proceeds');
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
});

// --- D#635 (2026-11-01): pruning deleted a version dir live sessions ran from ---
// 0.117.3's install removed 0.116.6 while two sessions still ran their hooks
// from it; with the dir gone every claudemd hook there exits 127, which does not
// block. Claude Code marks a superseded dir with `.orphaned_at` (ms) and deletes
// it 14 days later so a session that loaded it keeps running; prune holds a dir
// while either that mark or the hook log says it may still be in use.

const DAY = 86400 * 1000;
const logPath = () => path.join(sandbox, '.claude/logs/claudemd.jsonl');

function markOrphaned(name, content) {
  fs.writeFileSync(path.join(versionsDir, name, '.orphaned_at'), String(content));
}

function logRow(version, msAgo, file = logPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    ts: new Date(Date.now() - msAgo).toISOString(),
    hook: 'verify-log',
    event: 'verify-run',
    hook_version: version,
  };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

test('D#635.1: a dir Claude Code orphaned under 14 days ago is held; one orphaned earlier goes', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  markOrphaned('0.1.4', Date.now() - 1 * DAY);
  markOrphaned('0.1.1', Date.now() - 20 * DAY);

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.4')), 'orphaned 1 day ago: a session may still run it');
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')), 'orphaned 20 days ago and no log rows: removed');
  assert.deepEqual(r.held, [{ name: '0.1.4', reason: 'orphaned-recently' }]);
  assert.deepEqual(r.removed, [path.join(versionsDir, '0.1.1')]);
  assert.deepEqual(r.kept.sort(), ['0.1.6', '0.1.9', '0.2.1']);
});

test('D#635.2: a dir whose version logged a hook row in the last 14 days is held, marked or not', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.5', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  logRow('0.1.5', 2 * DAY); // unmarked, recent row → held
  markOrphaned('0.1.4', Date.now() - 20 * DAY);
  logRow('0.1.4', 3 * DAY); // old mark, recent row → held
  logRow('0.1.1', 30 * DAY); // unmarked, only an old row → removed
  logRow('0.1.6', 1 * DAY); // a kept version's row holds nothing else

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.5')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.4')));
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
  assert.deepEqual(
    r.held.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '0.1.4', reason: 'hook-rows-recently' },
      { name: '0.1.5', reason: 'hook-rows-recently' },
    ]
  );
});

test('D#635.3: rows in the rotated log generations count', () => {
  for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  logRow('0.1.1', 5 * DAY, `${logPath()}.1`);
  logRow('0.2.1', 0, logPath());

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.1')), 'the row in claudemd.jsonl.1 holds it');
  assert.deepEqual(r.held, [{ name: '0.1.1', reason: 'hook-rows-recently' }]);
});

test('D#635.4: a marker that is not a number holds the dir', () => {
  for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  markOrphaned('0.1.1', 'not-a-timestamp');

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.1')));
  assert.deepEqual(r.held, [{ name: '0.1.1', reason: 'orphaned-recently' }]);
});

test('D#635.6: a log that cannot be read throws before anything is removed (install swallows it)', () => {
  for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  fs.mkdirSync(logPath(), { recursive: true }); // EISDIR on read, as root too

  assert.throws(() => pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 }));
  assert.ok(
    fs.existsSync(path.join(versionsDir, '0.1.1')),
    'no candidate is removed when liveness is unknown'
  );
});

// D#643: with DISABLE_RULE_HITS_LOG=1 the hooks write no rows (hook-common.sh
// reads `== "1"`), so "no row from this version" says nothing about use. An
// unmarked candidate is held then; a mark 14 days old still lets it go, as
// Claude Code would delete it itself.
function withLogKnob(value, fn) {
  const saved = process.env.DISABLE_RULE_HITS_LOG;
  if (value === undefined) delete process.env.DISABLE_RULE_HITS_LOG;
  else process.env.DISABLE_RULE_HITS_LOG = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.DISABLE_RULE_HITS_LOG;
    else process.env.DISABLE_RULE_HITS_LOG = saved;
  }
}

test('D#643.1: with DISABLE_RULE_HITS_LOG=1 an unmarked dir beyond keep is held; an old mark still goes', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.5', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  markOrphaned('0.1.1', Date.now() - 20 * DAY); // old mark, no rows → removed
  logRow('0.1.5', 2 * DAY); // a row from before the log was turned off → that reason wins

  const r = withLogKnob('1', () => pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 }));

  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.4')), 'unmarked, and the log cannot vouch: held');
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')), 'marked 20 days ago: removed');
  assert.deepEqual(
    r.held.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '0.1.4', reason: 'no-log-signal' },
      { name: '0.1.5', reason: 'hook-rows-recently' },
    ]
  );
  assert.deepEqual(r.removed, [path.join(versionsDir, '0.1.1')]);
});

test('D#643.2: only the value 1 counts as the log being off', () => {
  for (const value of [undefined, '0', 'true', '']) {
    for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
    const r = withLogKnob(value, () => pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 }));
    assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')), `DISABLE_RULE_HITS_LOG=${value}: removed`);
    assert.deepEqual(r.held, [], `DISABLE_RULE_HITS_LOG=${value}`);
  }
});

// D#652: Claude Code writes `.in_use/<pid>` = {"pid":N,"procStart":"…"} in each
// version dir a process loads and removes it when that process exits; its own
// 14-day sweep skips a dir whose markers name a live process. The prune holds
// such a dir too, whatever the mark or the log setting says.
const HAS_PROC = fs.existsSync('/proc/self/stat');

// Field 22 (starttime) read by plain position: this process's comm is `node`,
// with no space, so the split needs none of the `)` handling the code under test uses.
const ownProcStart = () => fs.readFileSync('/proc/self/stat', 'utf8').split(' ')[21];

function inUse(version, file, content) {
  const dir = path.join(versionsDir, version, '.in_use');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
}

const liveMarker = () => (HAS_PROC ? { pid: process.pid, procStart: ownProcStart() } : { pid: process.pid });

test('D#652.1: a dir whose .in_use names a live process is held as in-use, before any other reason', () => {
  for (const v of ['0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  markOrphaned('0.1.1', Date.now() - 20 * DAY); // old mark alone would let it go
  inUse('0.1.1', String(process.pid), liveMarker());
  markOrphaned('0.1.2', Date.now() - 1 * DAY); // recent mark: in-use still names the reason
  inUse('0.1.2', String(process.pid), liveMarker());
  inUse('0.1.3', '1', { pid: 1 }); // pid 1 lives; kill(1, 0) is EPERM for a non-root user
  inUse('0.1.4', String(process.pid), { pid: process.pid }); // no procStart: the pid decides
  // 0.1.5: no mark, no row, no marker → removed (the log is on)

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.deepEqual(
    r.held.sort((a, b) => a.name.localeCompare(b.name)),
    ['0.1.1', '0.1.2', '0.1.3', '0.1.4'].map(name => ({ name, reason: 'in-use' }))
  );
  assert.deepEqual(r.removed, [path.join(versionsDir, '0.1.5')]);
  for (const v of ['0.1.1', '0.1.2', '0.1.3', '0.1.4']) {
    assert.ok(fs.existsSync(path.join(versionsDir, v)), `${v} must survive`);
  }
});

test('D#652.2: with DISABLE_RULE_HITS_LOG=1 a live marker reports in-use, not no-log-signal', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  inUse('0.1.1', String(process.pid), liveMarker());

  const r = withLogKnob('1', () => pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 }));

  assert.deepEqual(
    r.held.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '0.1.1', reason: 'in-use' },
      { name: '0.1.4', reason: 'no-log-signal' },
    ]
  );
});

test('D#652.3: markers that name no live process hold nothing', () => {
  const dead = spawnSync(process.execPath, ['-e', '']).pid; // exited and reaped
  const bad = {
    '0.1.0': [String(dead), { pid: dead }],
    '0.1.1': [String(process.pid), ''],
    '0.1.2': [String(process.pid), 'not json'],
    '0.1.3': ['0', { pid: 0 }], // kill(0, 0) would reach our own process group
    '0.1.4': ['-1', { pid: -1 }], // kill(-1, 0) would reach every process we may signal
    '0.1.5': [String(process.pid), { pid: String(process.pid) }],
    '0.1.6': [String(process.pid), 'null'],
  };
  for (const v of [...Object.keys(bad), '0.1.7', '0.1.8', '0.1.9', '0.2.0', '0.2.1']) mkVersion(v);
  for (const [v, [file, content]] of Object.entries(bad)) {
    markOrphaned(v, Date.now() - 20 * DAY);
    inUse(v, file, content);
  }
  markOrphaned('0.1.7', Date.now() - 20 * DAY);
  fs.mkdirSync(path.join(versionsDir, '0.1.7', '.in_use', String(process.pid)), { recursive: true });
  markOrphaned('0.1.8', Date.now() - 20 * DAY);
  fs.writeFileSync(path.join(versionsDir, '0.1.8', '.in_use'), JSON.stringify(liveMarker())); // a file, not a dir

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.deepEqual(r.held, []);
  assert.deepEqual(r.removed.map(d => path.basename(d)).sort(), [...Object.keys(bad), '0.1.7', '0.1.8']);
});

test(
  'D#652.4: a live pid whose start time differs (a reused pid) holds nothing',
  { skip: !HAS_PROC && 'no /proc' },
  () => {
    for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
    markOrphaned('0.1.1', Date.now() - 20 * DAY);
    inUse('0.1.1', String(process.pid), { pid: process.pid, procStart: String(Number(ownProcStart()) + 1) });

    const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

    assert.deepEqual(r.held, []);
    assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
  }
);

test(
  'D#652.5: without /proc a live pid holds its dir whatever its procStart',
  { skip: HAS_PROC && 'has /proc' },
  () => {
    for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
    markOrphaned('0.1.1', Date.now() - 20 * DAY);
    inUse('0.1.1', String(process.pid), { pid: process.pid, procStart: 'Mon Nov  2 04:42:24 2026' });

    const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

    assert.deepEqual(r.held, [{ name: '0.1.1', reason: 'in-use' }]);
  }
);

// One live record is enough, and no record is not one: both shapes are in a real
// cache (an emptied `.in_use/`; a dir that two sessions loaded, one of them gone).
test('D#652.6: one live record among dead ones holds the dir; an empty .in_use holds nothing', () => {
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  for (const v of ['0.1.1', '0.1.2', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  markOrphaned('0.1.1', Date.now() - 20 * DAY);
  inUse('0.1.1', String(dead), { pid: dead });
  inUse('0.1.1', 'junk', 'not json');
  inUse('0.1.1', String(process.pid), liveMarker());
  markOrphaned('0.1.2', Date.now() - 20 * DAY);
  fs.mkdirSync(path.join(versionsDir, '0.1.2', '.in_use'));

  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });

  assert.deepEqual(r.held, [{ name: '0.1.1', reason: 'in-use' }]);
  assert.deepEqual(r.removed, [path.join(versionsDir, '0.1.2')]);
});

test('D#635.5: no candidates beyond keep → held is empty and removal is unchanged', () => {
  for (const v of ['0.1.9', '0.2.1']) mkVersion(v);
  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });
  assert.deepEqual(r.held, []);
  assert.deepEqual(r.removed, []);
});

test('R11-02.3: missing plugin cache dir → skip rather than scan', () => {
  fs.rmSync(path.join(sandbox, '.claude/plugins'), { recursive: true, force: true });
  const ghostVersions = path.join(sandbox, 'elsewhere');
  fs.mkdirSync(path.join(ghostVersions, '0.2.1'), { recursive: true });
  const r = pruneCache(path.join(ghostVersions, '0.2.1'), { keep: 3 });
  assert.equal(r.skipped, 'outside-plugin-cache');
  assert.deepEqual(r.removed, []);
});
