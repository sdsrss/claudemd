import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
