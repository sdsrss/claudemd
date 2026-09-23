import { test, beforeEach, afterEach } from 'node:test';
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
  classifyBranches,
  removeVitestTargets,
} from '../../scripts/housekeeping.js';

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

test('CLI: unknown subcommand exits 2', () => {
  const r = spawnSync('node', [SCRIPT, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

// ---- branches ----
//
// A branch is pruned only when (a) its upstream was deleted on the remote
// (`[gone]`) or its name is worktree-agent-*, AND (b) its tip is an ancestor of
// the default branch or origin/<default>. Every fixture below is built against
// a real bare remote so `[gone]` is the state git itself reports.

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd, file, body) => {
  fs.writeFileSync(path.join(cwd, file), body);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `edit ${file}`);
};

// A bare remote with `main`, and a clone of it tracking origin/main.
function clone(defaultBranch = 'main') {
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  git(root, 'init', '-q', '--bare', '-b', defaultBranch, remote);
  fs.mkdirSync(seed);
  git(seed, 'init', '-q', '-b', defaultBranch);
  commit(seed, 'a.txt', 'a\n');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', defaultBranch);
  const r = path.join(root, 'repo');
  git(root, 'clone', '-q', remote, r);
  return r;
}

// Push `name` with an upstream, land it on main the way `mode` says, delete
// it on the remote, and fetch --prune so its upstream reads `[gone]`.
function landAndDeleteRemote(r, name, mode) {
  git(r, 'checkout', '-q', '-b', name);
  commit(r, `${name}.txt`, `${name}\n`);
  git(r, 'push', '-q', '-u', 'origin', name);
  git(r, 'checkout', '-q', 'main');
  if (mode === 'ff') git(r, 'merge', '-q', '--ff-only', name);
  if (mode === 'squash') {
    git(r, 'merge', '-q', '--squash', name);
    git(r, 'commit', '-q', '-m', `squash ${name}`);
  }
  if (mode !== 'none') git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', name);
  git(r, 'fetch', '-q', '--prune');
}

const names = list => list.map(b => b.name).sort();

test('branches: upstream gone + tip on main → pruned', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'ff');
  const c = classifyBranches({ cwd: r });
  assert.equal(c.defaultBranch, 'main');
  assert.deepEqual(names(c.deletable), ['feat']);
  assert.equal(c.deletable[0].why, 'gone');
});

test('branches: upstream gone but tip only on origin/main (local main behind) → pruned', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'ff');
  git(r, 'reset', '-q', '--hard', 'HEAD~1'); // local main no longer contains feat
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), ['feat']);
});

test('branches: upstream gone, squash-merged (tip not an ancestor) → kept, listed as goneUnmerged', () => {
  const r = clone();
  landAndDeleteRemote(r, 'sq', 'squash');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.goneUnmerged), ['sq']);
});

test('branches: whitespace-only difference is never judged equivalent (review H3)', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'ws');
  commit(r, 'x.py', 'x = "foob ar"\n');
  git(r, 'push', '-q', '-u', 'origin', 'ws');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'x.py', 'x = "foo bar"\n');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', 'ws');
  git(r, 'fetch', '-q', '--prune');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('branches: upstream still on the remote → kept even when an ancestor (git-flow main/develop, review H2/M1)', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'develop');
  git(r, 'push', '-q', '-u', 'origin', 'develop');
  commit(r, 'd.txt', 'd\n');
  git(r, 'push', '-q');
  git(r, 'checkout', '-q', 'main');
  git(r, 'merge', '-q', '--ff-only', 'develop');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('branches: no upstream (backup / renamed / fresh) → kept even when an ancestor (review M3)', () => {
  const r = clone();
  git(r, 'branch', 'backup-before-rebase');
  git(r, 'branch', 'newwork');
  git(r, 'branch', '-m', 'newwork', 'my-next-feature');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('branches: worktree-agent-* on main → pruned without an upstream; with unique commits → kept', () => {
  const r = clone();
  git(r, 'branch', 'worktree-agent-a0123456789abcdef');
  git(r, 'checkout', '-q', '-b', 'worktree-agent-b0123456789abcdef');
  commit(r, 'w.txt', 'w\n');
  git(r, 'checkout', '-q', 'main');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), ['worktree-agent-a0123456789abcdef']);
  assert.equal(c.deletable[0].why, 'worktree-agent');
});

test('branches: the current branch and worktree checkouts are never candidates', () => {
  const r = clone();
  landAndDeleteRemote(r, 'here', 'ff');
  git(r, 'worktree', 'add', '-q', path.join(root, 'wt'), 'here');
  landAndDeleteRemote(r, 'current', 'ff');
  git(r, 'checkout', '-q', 'current');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('branches: a rebase in progress in any worktree skips the whole run (review H4)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'topic', 'ff');
  landAndDeleteRemote(r, 'other', 'ff');
  // Stop an interactive-shaped rebase: `exec false` halts it with rebase-merge/ on disk.
  git(r, 'checkout', '-q', 'topic');
  const rb = spawnSync('git', ['rebase', '-q', '--exec', 'false', 'HEAD~1'], {
    cwd: r,
    encoding: 'utf8',
    env: GIT_ENV,
  });
  assert.notEqual(rb.status, 0, 'fixture: the rebase was expected to stop');
  const out = classifyBranches({ cwd: r });
  assert.equal(out.skipped, 'rebase-or-bisect-in-progress');
  assert.deepEqual(out.deletable, []);
});

test('branches: not a git repo is an empty result, not a throw', () => {
  assert.deepEqual(classifyBranches({ cwd: root }).deletable, []);
});

test('branches: the CLI only reports — the listed branch still exists, and --apply is rejected', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'ff');
  const out = spawnSync('node', [SCRIPT, 'branches', `--cwd=${r}`], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(
    JSON.parse(out.stdout).deletable.map(b => b.name),
    ['feat']
  );
  assert.ok(git(r, 'branch', '--list', 'feat'), 'feat still exists');
  const apply = spawnSync('node', [SCRIPT, 'branches', '--apply', `--cwd=${r}`], { encoding: 'utf8' });
  assert.equal(apply.status, 2);
  assert.ok(git(r, 'branch', '--list', 'feat'), 'feat still exists after --apply');
});

test('branches: a symbolic ref is never listed, whatever it points at (re-review 2 M1)', () => {
  const r = clone();
  git(r, 'symbolic-ref', 'refs/heads/worktree-agent-x', 'refs/heads/main');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('vitest tmp: a target that turns fresh between scan and delete is kept (recheck)', () => {
  const d = vitestDir();
  age(d, 2);
  const targets = scanVitestTmp({ roots: [root], minAgeMs: HOUR });
  assert.equal(targets.length, 1);
  const t = Date.now() / 1000;
  fs.utimesSync(path.join(d, 'ssr', HEX), t, t);
  const out = removeVitestTargets({ targets, minAgeMs: HOUR });
  assert.equal(out.deleted, 0);
  assert.ok(fs.existsSync(d));
});

test('branches: a local default branch behind its upstream stays safe in a git-flow repo (re-review F3)', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'develop');
  git(r, 'push', '-q', '-u', 'origin', 'develop');
  git(r, 'remote', 'set-head', 'origin', 'develop');
  // origin/main advances past local main, so local main reads [behind 1]
  // and is an ancestor of develop.
  git(r, 'checkout', '-q', 'main');
  commit(r, 'm.txt', 'm\n');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'reset', '-q', '--hard', 'HEAD~1');
  git(r, 'checkout', '-q', 'develop');
  const track = git(r, 'for-each-ref', '--format=%(upstream:track)', 'refs/heads/main');
  assert.equal(track, '[behind 1]', 'fixture: main is behind, not gone');
  const c = classifyBranches({ cwd: r });
  assert.equal(c.defaultBranch, 'develop');
  assert.deepEqual(names(c.deletable), []);
});

test('branches: a bisect in progress skips the whole run (re-review F7)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'other', 'ff');
  commit(r, 'b1.txt', '1\n');
  git(r, 'bisect', 'start', 'HEAD', 'HEAD~1');
  const out = classifyBranches({ cwd: r });
  assert.equal(out.skipped, 'rebase-or-bisect-in-progress');
  assert.deepEqual(out.deletable, []);
});
