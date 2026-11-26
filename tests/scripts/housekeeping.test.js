import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  scanVitestTmp,
  sweepVitestTmp,
  vitestWatchAlive,
  ageFloorMs,
  removeVitestTargets,
} from '../../scripts/housekeeping.js';
import * as housekeeping from '../../scripts/housekeeping.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/housekeeping.js');
const HOUR = 3600000;
const NANO = 'AbCdEfGhIjKlMnOpQrStU'; // 21 chars, the nanoid alphabet
const HEX = 'a'.repeat(40);

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-housekeeping-test-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Age a whole tree: the sweep reads the NEWEST mtime anywhere inside, so
// ageing only the top dir would build a fixture that is stale by one measure
// and fresh by the one under test.
const age = (p, hoursAgo) => {
  const t = (Date.now() - hoursAgo * HOUR) / 1000;
  const walk = q => {
    const st = fs.lstatSync(q);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) for (const n of fs.readdirSync(q)) walk(path.join(q, n));
    fs.utimesSync(q, t, t);
  };
  walk(p);
};

const vitestDir = (name = NANO, envs = ['ssr'], files = [HEX]) => {
  const d = path.join(root, name);
  for (const e of envs) {
    fs.mkdirSync(path.join(d, e), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(d, e, f), 'const x = 1;\n');
  }
  return d;
};

const scan = (extra = {}) => scanVitestTmp({ roots: [root], minAgeMs: HOUR, ...extra }).map(t => t.path);

test('vitest tmp: stale dir with the exact signature is a target', () => {
  const d = vitestDir();
  age(d, 2);
  assert.deepEqual(scan(), [d]);
});

test('vitest tmp: ssr + client children both qualify', () => {
  const d = vitestDir(NANO, ['ssr', 'client']);
  age(d, 2);
  assert.deepEqual(scan(), [d]);
});

test('vitest tmp: younger than the floor is kept', () => {
  vitestDir();
  assert.deepEqual(scan(), []);
});

test('vitest tmp: one fresh file deep inside keeps the whole dir', () => {
  const d = vitestDir(NANO, ['ssr'], [HEX, 'b'.repeat(40)]);
  age(d, 2);
  const t = Date.now() / 1000;
  fs.utimesSync(path.join(d, 'ssr', 'b'.repeat(40)), t, t);
  assert.deepEqual(scan(), []);
});

for (const [label, build] of [
  ['20-char name', () => vitestDir(NANO.slice(1))],
  ['22-char name', () => vitestDir(NANO + 'x')],
  ['foreign child dir', () => vitestDir(NANO, ['ssr', 'web'])],
  [
    'empty dir',
    () => {
      const d = path.join(root, NANO);
      fs.mkdirSync(d);
      return d;
    },
  ],
  ['non-hex file name', () => vitestDir(NANO, ['ssr'], ['notes.txt'])],
  ['39-hex file name', () => vitestDir(NANO, ['ssr'], ['a'.repeat(39)])],
  [
    'nested dir under ssr',
    () => {
      const d = vitestDir();
      fs.mkdirSync(path.join(d, 'ssr', 'b'.repeat(40)));
      return d;
    },
  ],
  [
    'loose file at top level',
    () => {
      const d = vitestDir();
      fs.writeFileSync(path.join(d, 'keep.db'), 'x');
      return d;
    },
  ],
]) {
  test(`vitest tmp: ${label} is not a target`, () => {
    const d = build();
    age(d, 2);
    assert.deepEqual(scan(), []);
  });
}

test('vitest tmp: a symlink carrying the name is never followed or deleted', () => {
  const real = vitestDir('x'.repeat(21));
  age(real, 2);
  const link = path.join(root, NANO);
  fs.symlinkSync(real, link);
  assert.deepEqual(scan(), [real]);
});

test('vitest tmp: ssr as a symlink to a dir is not a target', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-housekeeping-out-'));
  try {
    fs.writeFileSync(path.join(outside, HEX), 'x');
    const d = path.join(root, NANO);
    fs.mkdirSync(d);
    fs.symlinkSync(outside, path.join(d, 'ssr'));
    age(d, 2);
    age(outside, 2);
    // age() skips links; age the link itself too, so only the symlink check
    // (not freshness) can keep this dir out.
    const t = (Date.now() - 2 * HOUR) / 1000;
    fs.lutimesSync(path.join(d, 'ssr'), t, t);
    fs.utimesSync(d, t, t);
    assert.deepEqual(scan(), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('vitest tmp: another uid is not a target', () => {
  const d = vitestDir();
  age(d, 2);
  assert.deepEqual(scan({ uid: process.getuid() + 1 }), []);
});

test('vitest tmp: missing root is an empty scan, not a throw', () => {
  assert.deepEqual(scanVitestTmp({ roots: [path.join(root, 'nope')], minAgeMs: HOUR }), []);
});

test('vitest tmp: duplicate roots scan once', () => {
  const d = vitestDir();
  age(d, 2);
  assert.equal(scanVitestTmp({ roots: [root, root + '/'], minAgeMs: HOUR }).length, 1);
  assert.ok(fs.existsSync(d));
});

test('vitest tmp: sweep without apply deletes nothing', () => {
  const d = vitestDir();
  age(d, 2);
  const r = sweepVitestTmp({ roots: [root], minAgeMs: HOUR, apply: false });
  assert.equal(r.targets.length, 1);
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(d));
});

test('vitest tmp: sweep with apply deletes targets and only targets', () => {
  const stale = vitestDir();
  age(stale, 2);
  const fresh = vitestDir('y'.repeat(21));
  const other = path.join(root, 'tmp.AbCdEfGhIj');
  fs.mkdirSync(other);
  age(other, 48);
  const r = sweepVitestTmp({ roots: [root], minAgeMs: HOUR, apply: true });
  assert.equal(r.deleted, 1);
  assert.ok(r.bytes > 0);
  assert.ok(!fs.existsSync(stale));
  assert.ok(fs.existsSync(fresh));
  assert.ok(fs.existsSync(other));
});

test('vitest watch detection: watch process raises the floor, run does not', () => {
  assert.equal(vitestWatchAlive(['node /p/node_modules/.bin/vitest']), true);
  assert.equal(vitestWatchAlive(['node /p/node_modules/vitest/vitest.mjs --watch']), true);
  assert.equal(vitestWatchAlive(['node /p/node_modules/.bin/vitest run']), false);
  assert.equal(vitestWatchAlive(['node /p/node_modules/.bin/vitest --run']), false);
  assert.equal(vitestWatchAlive(['bash -c grep vitest', 'node server.js']), false);
  assert.equal(ageFloorMs({ watchAlive: false }), HOUR);
  assert.equal(ageFloorMs({ watchAlive: true }), 24 * HOUR);
});

test('vitest tmp: CLI dry-run prints JSON and exits 0', () => {
  const d = vitestDir();
  age(d, 2);
  const r = spawnSync('node', [SCRIPT, 'tmp', `--root=${root}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.targets.length, 1);
  assert.equal(out.deleted, 0);
  assert.ok(fs.existsSync(d));
});

// A failed delete only went into `errors`, and the run exited 0: a caller that
// branches on the exit code read "reclaimed" (131c, reproduced 2026-10-20).
test(
  'vitest tmp: CLI --apply exits 3 when a target cannot be deleted, 0 once it can',
  { skip: process.getuid() === 0 && 'root ignores the mode bits' },
  () => {
    const d = vitestDir();
    age(d, 2);
    const ssr = path.join(d, 'ssr');
    const apply = () =>
      spawnSync('node', [SCRIPT, 'tmp', '--apply', `--root=${root}`, '--min-age-minutes=1'], {
        encoding: 'utf8',
      });
    fs.chmodSync(ssr, 0o555);
    let r;
    try {
      r = apply();
    } finally {
      fs.chmodSync(ssr, 0o755);
    }
    assert.equal(r.status, 3, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.deleted, 0);
    assert.deepEqual(
      out.errors.map(e => e.path),
      [d]
    );
    // The errno is the OS's: Linux reports the refused unlink (EACCES), macOS
    // the directory that could not be emptied (ENOTEMPTY; PR CI run 39557203873,
    // macos-latest node 24).
    assert.ok(['EACCES', 'EPERM', 'ENOTEMPTY'].includes(out.errors[0].code), out.errors[0].code);
    const again = apply();
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).deleted, 1);
    assert.ok(!fs.existsSync(d));
  }
);

test('vitest tmp: CLI --root that is missing, not a directory or empty is a usage error naming it', () => {
  const file = path.join(root, 'f');
  fs.writeFileSync(file, '');
  for (const bad of [path.join(root, 'nope'), file, '']) {
    const r = spawnSync('node', [SCRIPT, 'tmp', `--root=${bad}`], { encoding: 'utf8' });
    assert.equal(r.status, 2, `--root=${bad}: ${r.stdout}`);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(`'${bad}'`), r.stderr);
  }
});

// ---- agent temp residue (agent-tmp-*) ----
// Spec §5-EXT Agent temp residue: an agent names what it creates in a temp
// root agent-tmp-<task>-XXXXXX and keeps one with a .keep; the sweep reaps the
// rest once no entry's mtime or ctime is within 72 h. The hook cannot see
// whether a spec file or a deferred item names a dir, hence the longer floor
// than the model-side 24 h, and .keep as the only way to retain one.
// ctime cannot be set back, so these cases age a fixture by moving the clock
// forward (`now`, or CLAUDEMD_TMP_SWEEP_TEST_NOW_MS for the CLI).
const AGENT_FLOOR_H = 72;
const after = h => Date.now() + h * HOUR;
const STALE = () => after(AGENT_FLOOR_H + 1);

const agentDir = (name = 'agent-tmp-review-AbC123') => {
  const d = path.join(root, name);
  fs.mkdirSync(path.join(d, 'repo', 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'repo', 'src', 'a.js'), 'x');
  fs.writeFileSync(path.join(d, 'report.md'), 'r');
  return d;
};

const agentScan = (extra = {}) =>
  housekeeping.scanAgentTmp({ roots: [root], now: STALE(), ...extra }).targets.map(t => t.path);

const cli = (args, nowMs) =>
  spawnSync('node', [SCRIPT, 'tmp', ...args, `--root=${root}`], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDEMD_TMP_SWEEP_TEST_NOW_MS: nowMs === undefined ? '' : String(nowMs) },
  });

test('agent tmp: the floor is 72 h and /var/tmp is a default root', () => {
  assert.equal(housekeeping.AGENT_TMP_FLOOR_MS, AGENT_FLOOR_H * HOUR);
  const saved = process.env.CLAUDEMD_TMP_SWEEP_ROOTS;
  delete process.env.CLAUDEMD_TMP_SWEEP_ROOTS;
  try {
    assert.ok(housekeeping.defaultTmpRoots().includes('/var/tmp'));
  } finally {
    if (saved !== undefined) process.env.CLAUDEMD_TMP_SWEEP_ROOTS = saved;
  }
});

test('agent tmp: an agent-tmp-* dir idle past the floor is a target, with its bytes', () => {
  const d = agentDir();
  const r = housekeeping.scanAgentTmp({ roots: [root], now: STALE() });
  assert.deepEqual(
    r.targets.map(t => t.path),
    [d]
  );
  assert.equal(r.targets[0].bytes, 2);
});

test('agent tmp: idle less than the floor is kept', () => {
  agentDir();
  assert.deepEqual(agentScan({ now: after(AGENT_FLOOR_H - 1) }), []);
});

test('agent tmp: one fresh file deep inside keeps the whole dir', () => {
  const d = agentDir();
  const t = (STALE() - HOUR) / 1000;
  fs.utimesSync(path.join(d, 'repo', 'src', 'a.js'), t, t);
  assert.deepEqual(agentScan(), []);
});

// Review M1: cp -a, rsync -a and tar copy old mtimes onto the new dir itself.
test('agent tmp: a dir filled just now with old mtimes (cp -a / tar) is kept: ctime is fresh', () => {
  const d = agentDir();
  age(d, AGENT_FLOOR_H * 4);
  assert.deepEqual(housekeeping.scanAgentTmp({ roots: [root] }).targets, []);
});

// The top dir and each entry are judged separately: a dir renamed into an
// agent-tmp-* name has a fresh ctime on the top alone, a chmod on one file a
// fresh ctime on that file alone. The clock is put between the two ctimes.
const statsUnder = d => {
  const out = [];
  const walk = q => {
    const st = fs.lstatSync(q);
    out.push({ p: q, st });
    if (st.isDirectory()) for (const n of fs.readdirSync(q)) walk(path.join(q, n));
  };
  walk(d);
  return out;
};
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const newestOf = rows => Math.max(...rows.map(r => Math.max(r.st.mtimeMs, r.st.ctimeMs)));

test('agent tmp: a fresh ctime on the top dir alone keeps it (renamed into place)', () => {
  const src = path.join(root, 'old-work');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'sub', 'f'), 'x');
  pause(60);
  const d = path.join(root, 'agent-tmp-moved-AbC123');
  fs.renameSync(src, d);
  const rows = statsUnder(d);
  const inner = newestOf(rows.slice(1));
  assert.ok(rows[0].st.ctimeMs > inner + 30, 'fixture: the rename refreshed the top ctime');
  const now = inner + AGENT_FLOOR_H * HOUR + 10;
  assert.deepEqual(agentScan({ now }), []);
});

test('agent tmp: a fresh ctime on one inner file alone keeps the dir (chmod)', () => {
  const d = agentDir();
  pause(60);
  const f = path.join(d, 'repo', 'src', 'a.js');
  fs.chmodSync(f, 0o600);
  const rows = statsUnder(d);
  const others = newestOf(rows.filter(r => r.p !== f));
  assert.ok(fs.lstatSync(f).ctimeMs > others + 30, 'fixture: the chmod refreshed only that ctime');
  const now = others + AGENT_FLOOR_H * HOUR + 10;
  assert.deepEqual(agentScan({ now }), []);
});

test('agent tmp: a .keep at the top keeps the dir, whatever its age', () => {
  const d = agentDir();
  fs.writeFileSync(path.join(d, '.keep'), 'repro for D#123, until 2026-12-01');
  assert.deepEqual(agentScan({ now: after(24 * 30) }), []);
});

// Review H1: Claude Code keeps its listening sockets in cc-socks dirs.
for (const name of [
  'cc-socks',
  'cc-socks-1000',
  'cc-review-AbC123',
  'rv-6310-claims',
  'tmp.AbCdEfGhIj',
  'agent-tmp',
  'agent-tmp-',
  'AGENT-TMP-task-AbC123',
]) {
  test(`agent tmp: '${name}' (no agent-tmp-<x> name) is not a target`, () => {
    agentDir(name);
    assert.deepEqual(agentScan(), []);
  });
}

test('agent tmp: a socket inside keeps the dir and is reported as skipped', async () => {
  const d = agentDir();
  // Bound by a relative name from inside the dir: a unix socket path is capped
  // at 104 bytes on macOS and 108 on Linux, and the runner's temp path alone is
  // longer on macOS (PR CI run 41652259310: 129 bytes; the bind landed outside
  // the dir and the test read "not a socket"). Linux with a long TMPDIR fails
  // the old fixture with EINVAL.
  const net = await import('node:net');
  const srv = net.createServer();
  const prev = process.cwd();
  process.chdir(d);
  try {
    await new Promise((res, rej) => srv.once('error', rej).listen('s', res));
  } finally {
    process.chdir(prev);
  }
  assert.ok(fs.lstatSync(path.join(d, 's')).isSocket(), 'fixture: the socket is inside the dir');
  try {
    const r = housekeeping.scanAgentTmp({ roots: [root], now: STALE() });
    assert.deepEqual(r.targets, []);
    assert.deepEqual(r.skipped, [{ path: d, reason: 'socket-or-fifo' }]);
  } finally {
    await new Promise(res => srv.close(res));
  }
});

test('agent tmp: a FIFO inside keeps the dir', { skip: process.platform === 'win32' }, () => {
  const d = agentDir();
  const r = spawnSync('mkfifo', [path.join(d, 'f')]);
  assert.equal(r.status, 0, String(r.stderr));
  assert.deepEqual(agentScan(), []);
});

test('agent tmp: a regular file named agent-tmp-* is not a target', () => {
  fs.writeFileSync(path.join(root, 'agent-tmp-notes'), 'x');
  assert.deepEqual(agentScan(), []);
});

test('agent tmp: a symlink named agent-tmp-* is neither followed nor deleted', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-housekeeping-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'f'), 'x');
    const link = path.join(root, 'agent-tmp-link-AbC123');
    fs.symlinkSync(outside, link);
    assert.deepEqual(agentScan(), []);
    housekeeping.sweepTmp({ roots: [root], apply: true, minAgeMs: HOUR, now: STALE() });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(outside, 'f')));
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('agent tmp: a symlink inside is not followed: its target neither keeps the dir nor is deleted', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-housekeeping-out-'));
  try {
    const d = agentDir();
    fs.symlinkSync(outside, path.join(d, 'link'));
    const now = STALE();
    // Fresh at `now`: would keep the dir if the walk followed the link.
    fs.writeFileSync(path.join(outside, 'live'), 'x');
    const t = (now - HOUR) / 1000;
    fs.utimesSync(path.join(outside, 'live'), t, t);
    assert.deepEqual(agentScan({ now }), [d]);
    const r = housekeeping.sweepTmp({ roots: [root], apply: true, minAgeMs: HOUR, now });
    assert.equal(r.agent.deleted, 1);
    assert.ok(!fs.existsSync(d));
    assert.ok(fs.existsSync(path.join(outside, 'live')));
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('agent tmp: another uid is not a target', () => {
  agentDir();
  assert.deepEqual(agentScan({ uid: process.getuid() + 1 }), []);
});

test('agent tmp: more entries than the cap is skipped and says why', () => {
  const d = agentDir();
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, `f${i}`), 'x');
  const r = housekeeping.scanAgentTmp({ roots: [root], maxEntries: 4, now: STALE() });
  assert.deepEqual(r.targets, []);
  assert.deepEqual(r.skipped, [{ path: d, reason: 'too-many-entries' }]);
});

test('agent tmp: a target that turns fresh between scan and delete is kept (recheck)', () => {
  const d = agentDir();
  const now = STALE();
  const { targets } = housekeeping.scanAgentTmp({ roots: [root], now });
  assert.equal(targets.length, 1);
  const t = (now - HOUR) / 1000;
  fs.writeFileSync(path.join(d, 'repo', 'new.js'), 'y');
  fs.utimesSync(path.join(d, 'repo', 'new.js'), t, t);
  const r = housekeeping.removeAgentTargets({ targets, now });
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(d));
});

// D#718 L7: several sweeps racing over one root. The one that loses finds the
// dir, or part of it, already gone, and rmSync throws ENOENT. That is neither a
// failure (the CLI exited 3 on it: 4 sweeps over 400 dirs, 19 of 20 processes
// across 5 runs) nor a deletion of this sweep's. The race is played here by
// deleting the dir inside the rmSync call, before the real one runs.
const rmRacedBy = () => {
  const real = fs.rmSync;
  return mock.method(fs, 'rmSync', (p, opts) => {
    real(p, { recursive: true, force: true });
    return real(p, opts);
  });
};

test('agent tmp: a target another sweep removed first is neither an error nor counted (D#718 L7)', () => {
  const d = agentDir();
  const now = STALE();
  const { targets } = housekeeping.scanAgentTmp({ roots: [root], now });
  assert.equal(targets.length, 1);
  const m = rmRacedBy();
  let r;
  try {
    r = housekeeping.removeAgentTargets({ targets, now });
  } finally {
    m.mock.restore();
  }
  assert.deepEqual(r.errors, []);
  assert.equal(r.deleted, 0);
  assert.equal(r.bytes, 0);
  assert.ok(!fs.existsSync(d));
});

test('vitest tmp: a target another sweep removed first is neither an error nor counted (D#718 L7)', () => {
  const d = vitestDir();
  age(d, 2);
  const targets = scanVitestTmp({ roots: [root], minAgeMs: HOUR });
  assert.equal(targets.length, 1);
  const m = rmRacedBy();
  let r;
  try {
    r = removeVitestTargets({ targets, minAgeMs: HOUR });
  } finally {
    m.mock.restore();
  }
  assert.deepEqual(r.errors, []);
  assert.equal(r.deleted, 0);
  assert.ok(!fs.existsSync(d));
});

// D#718 L8: a recursive rmSync enters a mount point, and a user can mount
// without root (FUSE: sshfs, rclone). Path lookup crosses mount points under
// lstat as under stat, so an entry that is a mount point carries the mounted
// filesystem's st.dev. This host refuses unprivileged mounts (user namespaces
// are restricted), so the device number is faked for one inner dir.
const onOtherDevice = target => {
  const real = fs.lstatSync;
  return mock.method(fs, 'lstatSync', (p, ...rest) => {
    const st = real(p, ...rest);
    if (p !== target) return st;
    return new Proxy(st, {
      get: (t, k) => (k === 'dev' ? t.dev + 1 : typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
    });
  });
};

test('agent tmp: an entry on another device (a mount point) keeps the dir, at scan and at recheck (D#718 L8)', () => {
  const d = fs.realpathSync(agentDir());
  const mnt = path.join(d, 'repo', 'src');
  const now = STALE();
  const m = onOtherDevice(mnt);
  let scanned;
  let removed;
  try {
    scanned = housekeeping.scanAgentTmp({ roots: [root], now });
    // A target listed before the mount appeared: the recheck before rm decides.
    removed = housekeeping.removeAgentTargets({ targets: [{ path: d, bytes: 2 }], now });
  } finally {
    m.mock.restore();
  }
  assert.deepEqual(scanned.targets, []);
  assert.deepEqual(scanned.skipped, [{ path: d, reason: 'mount-point' }]);
  assert.equal(removed.deleted, 0);
  assert.ok(fs.existsSync(path.join(mnt, 'a.js')));
});

// 0.120.0 pre-tag review H1: when the agent-tmp-* dir is itself the mount
// point (`rclone mount remote: "$D"`), its top and every entry carry the
// mounted filesystem's st.dev, so comparing entries with the top never fires.
// The top is compared with its parent, the temp root.
test('agent tmp: a dir that is itself a mount point is kept, at scan and at recheck (0.120.0 review H1)', () => {
  const d = fs.realpathSync(agentDir());
  const now = STALE();
  const real = fs.lstatSync;
  const m = mock.method(fs, 'lstatSync', (p, ...rest) => {
    const st = real(p, ...rest);
    if (p !== d && !String(p).startsWith(d + path.sep)) return st;
    return new Proxy(st, {
      get: (t, k) => (k === 'dev' ? t.dev + 1 : typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
    });
  });
  let scanned;
  let removed;
  try {
    scanned = housekeeping.scanAgentTmp({ roots: [root], now });
    removed = housekeeping.removeAgentTargets({ targets: [{ path: d, bytes: 2 }], now });
  } finally {
    m.mock.restore();
  }
  assert.deepEqual(scanned.targets, []);
  assert.deepEqual(scanned.skipped, [{ path: d, reason: 'mount-point' }]);
  assert.equal(removed.deleted, 0);
  assert.ok(fs.existsSync(d));
});

test('agent tmp: CLI --apply deletes stale agent-tmp-* and vitest dirs and nothing else, 0 exit', () => {
  const stale = agentDir();
  const kept = agentDir('agent-tmp-kept-QwE456');
  fs.writeFileSync(path.join(kept, '.keep'), 'why');
  const foreign = agentDir('rv-6314-r2-delta');
  const socks = agentDir('cc-socks');
  const vit = vitestDir();
  age(vit, 2);
  const now = STALE();
  // Fresh at `now`: modified one hour before it.
  const fresh = agentDir('agent-tmp-live-XyZ789');
  const t = (now - HOUR) / 1000;
  fs.utimesSync(path.join(fresh, 'report.md'), t, t);
  const r = cli(['--apply'], now);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.deleted, 1);
  assert.equal(out.agent.deleted, 1);
  assert.equal(out.agent.minAgeMs, AGENT_FLOOR_H * HOUR);
  assert.deepEqual(
    out.agent.targets.map(x => x.path),
    [stale]
  );
  assert.ok(!fs.existsSync(stale));
  assert.ok(!fs.existsSync(vit));
  for (const p of [fresh, kept, foreign, socks]) assert.ok(fs.existsSync(p), p);
});

// Review L3: --min-age-minutes is the vitest floor only.
test('agent tmp: CLI --min-age-minutes does not lower the agent-tmp-* floor', () => {
  const d = agentDir();
  const r = cli(['--apply', '--min-age-minutes=60'], after(2));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.agent.targets, []);
  assert.equal(out.agent.deleted, 0);
  assert.ok(fs.existsSync(d));
});

test('agent tmp: the CLI clock seam is ignored unless the roots are redirected', () => {
  const d = agentDir();
  // TMPDIR=root makes the fixture's parent a DEFAULT root ($TMPDIR, os.tmpdir()),
  // so the only difference between the two runs is --root. Dry runs.
  const env = { ...process.env, TMPDIR: root, CLAUDEMD_TMP_SWEEP_TEST_NOW_MS: String(STALE()) };
  delete env.CLAUDEMD_TMP_SWEEP_ROOTS;
  const listed = args => {
    const r = spawnSync('node', [SCRIPT, 'tmp', ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).agent.targets.map(x => x.path);
  };
  assert.ok(!listed([]).includes(d), 'default roots: the real clock judges, the fixture is fresh');
  assert.deepEqual(listed([`--root=${root}`]), [d], 'redirected root: the seam clock judges');
  assert.ok(fs.existsSync(d));
});

test(
  'agent tmp: CLI --apply exits 3 when an agent-tmp-* target cannot be deleted',
  { skip: process.getuid() === 0 && 'root ignores the mode bits' },
  () => {
    const d = agentDir();
    const src = path.join(d, 'repo', 'src');
    fs.chmodSync(src, 0o555);
    let r;
    try {
      r = cli(['--apply'], STALE());
    } finally {
      fs.chmodSync(src, 0o755);
    }
    assert.equal(r.status, 3, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.agent.deleted, 0);
    assert.deepEqual(
      out.agent.errors.map(e => e.path),
      [d]
    );
  }
);

test('CLI: unknown subcommand exits 2', () => {
  const r = spawnSync('node', [SCRIPT, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
