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
  refusedBranches,
  branchDeleteTargets,
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

test('CLI: unknown subcommand exits 2', () => {
  const r = spawnSync('node', [SCRIPT, 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

// ---- branches ----
//
// A branch is listed as deletable only when (a) its upstream was deleted on the remote
// (`[gone]`) or its name is worktree-agent-*, AND (b) its tip is an ancestor of
// the local default branch and of what `git branch -d` compares it with (its
// upstream when that resolves, else HEAD). Every fixture below is built against
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
  // What a rebase merge or a cherry-pick does: main moves first, so the
  // branch's commits land as new commits and its tip is not an ancestor.
  if (mode === 'pick') {
    commit(r, `main-${name}.txt`, 'unrelated\n');
    git(r, 'cherry-pick', `main..${name}`);
  }
  if (mode !== 'none') git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', name);
  git(r, 'fetch', '-q', '--prune');
}

const names = list => list.map(b => b.name).sort();

test('branches: upstream gone + tip on main → listed', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'ff');
  const c = classifyBranches({ cwd: r });
  assert.equal(c.defaultBranch, 'main');
  assert.deepEqual(names(c.deletable), ['feat']);
  assert.equal(c.deletable[0].why, 'gone');
});

// What is listed is handed to `git branch -d`, which compares a branch with its
// upstream when that resolves, else with HEAD; never with origin/<default>.
// Each fixture below first shows -d refusing, so the case is the real one.
const branchD = (cwd, name) =>
  spawnSync('git', ['branch', '-d', name], { cwd, encoding: 'utf8', env: GIT_ENV });

test('branches: upstream gone, tip only on origin/main (local main behind) → not listed until main has it (167)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'ff');
  git(r, 'reset', '-q', '--hard', 'HEAD~1'); // local main no longer contains feat
  assert.notEqual(branchD(r, 'feat').status, 0, 'fixture: git branch -d refuses feat on main');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.goneUnmerged), [], 'on origin/main: merged, not a squash merge');
  git(r, 'merge', '-q', '--ff-only', 'origin/main');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), ['feat']);
  assert.equal(branchD(r, 'feat').status, 0, 'listed → git branch -d deletes it');
});

test('branches: gone and on main, but not on the current checkout → not listed (167)', () => {
  const r = clone();
  const before = git(r, 'rev-parse', 'HEAD');
  landAndDeleteRemote(r, 'feat', 'ff');
  git(r, 'checkout', '-q', '-b', 'older', before);
  assert.notEqual(branchD(r, 'feat').status, 0, 'fixture: git branch -d refuses feat from here');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.goneUnmerged), []);
  git(r, 'checkout', '-q', 'main');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), ['feat']);
});

test('branches: worktree-agent-* on main whose live upstream lacks its tip → not listed (167)', () => {
  const r = clone();
  const wa = 'worktree-agent-c0123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  git(r, 'push', '-q', '-u', 'origin', wa);
  commit(r, 'u.txt', 'u\n');
  git(r, 'checkout', '-q', 'main');
  git(r, 'merge', '-q', '--ff-only', wa);
  assert.notEqual(branchD(r, wa).status, 0, 'fixture: git branch -d checks the upstream and refuses');
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
  git(r, 'push', '-q', 'origin', wa);
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), [wa]);
  assert.equal(branchD(r, wa).status, 0, 'listed → git branch -d deletes it');
});

// A squash commit equal to the branch's whole change lands it (landed, below);
// one that also carries something else does not.
test('branches: upstream gone, squash commit that adds more than the branch → kept, listed as goneUnmerged', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'sq');
  commit(r, 'sq.txt', 'sq\n');
  git(r, 'push', '-q', '-u', 'origin', 'sq');
  git(r, 'checkout', '-q', 'main');
  git(r, 'merge', '-q', '--squash', 'sq');
  fs.writeFileSync(path.join(r, 'extra.txt'), 'extra\n');
  git(r, 'add', 'extra.txt');
  git(r, 'commit', '-q', '-m', 'squash sq plus extra');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', 'sq');
  git(r, 'fetch', '-q', '--prune');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.landed), []);
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
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  // `git cherry`'s patch-id strips whitespace and calls these two equal.
  assert.deepEqual(names(c.landed), []);
  assert.deepEqual(names(c.goneUnmerged), ['ws']);
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

test('branches: worktree-agent-* on main → listed without an upstream; with unique commits → kept', () => {
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

test('branches: the default branch is never listed, even with a gone upstream (claims review L3)', () => {
  const r = clone();
  git(r, 'push', '-q', 'origin', 'main:tmpx');
  git(r, 'branch', '-q', '-u', 'origin/tmpx', 'main');
  git(r, 'push', '-q', 'origin', '--delete', 'tmpx');
  git(r, 'fetch', '-q', '--prune');
  git(r, 'checkout', '-q', '-b', 'other');
  assert.equal(
    git(r, 'for-each-ref', '--format=%(upstream:track)', 'refs/heads/main'),
    '[gone]',
    'fixture: main is gone'
  );
  assert.deepEqual(names(classifyBranches({ cwd: r }).deletable), []);
});

test('branches: an am-style rebase (rebase-apply) in progress also skips the run (claims review L3)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'other', 'ff');
  fs.mkdirSync(path.join(r, '.git', 'rebase-apply'));
  assert.equal(classifyBranches({ cwd: r }).skipped, 'rebase-or-bisect-in-progress');
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

// At most 200 candidates are examined; the ones left out used to vanish without
// a word, so a caller could not tell "nothing more" from "not looked at".
test('branches: more than 200 candidates → 200 examined and truncated counts the rest', () => {
  const r = clone();
  const sha = git(r, 'rev-parse', 'HEAD');
  const refs = Array.from({ length: 203 }, (_, i) => `create refs/heads/worktree-agent-${i} ${sha}\n`);
  const u = spawnSync('git', ['-C', r, 'update-ref', '--stdin'], { input: refs.join(''), env: GIT_ENV });
  assert.equal(u.status, 0, String(u.stderr));
  const out = classifyBranches({ cwd: r });
  assert.equal(out.deletable.length, 200);
  assert.equal(out.truncated, 3);
  assert.equal(classifyBranches({ cwd: root }).truncated, 0, 'not a repo: nothing left out');
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

// ---- landed: `git branch -d` refuses, every commit is on main byte for byte ----
//
// A rebase merge, a cherry-pick or a squash lands a branch's work as NEW
// commits, so its tip is not an ancestor and `git branch -d` refuses it. Such
// a branch is `landed` when each of its commits has a commit on main, after
// the fork point, with the same `git patch-id --verbatim` (whitespace kept,
// binary files by blob id), or its whole change equals one such commit
// (squash). tasks/specs/landed-branch-cleanup.md.

test('branches: upstream gone, rebase-merged (each commit re-applied on main) → landed per-commit', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  assert.notEqual(branchD(r, 'feat').status, 0, 'fixture: git branch -d refuses feat');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.goneUnmerged), []);
  assert.deepEqual(c.landed, [
    { name: 'feat', sha: git(r, 'rev-parse', 'feat'), why: 'gone', how: 'per-commit', commits: 1 },
  ]);
});

test('branches: upstream gone, squash-merged (two commits, one squash) → landed squash', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'sq');
  commit(r, 'sq.txt', 'one\n');
  commit(r, 'sq.txt', 'one\ntwo\n');
  git(r, 'push', '-q', '-u', 'origin', 'sq');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'merge', '-q', '--squash', 'sq');
  git(r, 'commit', '-q', '-m', 'squash sq');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', 'sq');
  git(r, 'fetch', '-q', '--prune');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.goneUnmerged), []);
  assert.deepEqual(names(c.landed), ['sq']);
  assert.equal(c.landed[0].how, 'squash');
  // The commit on main that equals the branch's whole change, so a reader can check it.
  assert.equal(c.landed[0].via, git(r, 'rev-parse', 'main'));
});

test('branches: a commit whose content changed in the pick → not landed (goneUnmerged)', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'edit');
  commit(r, 'e.txt', 'e1\n');
  commit(r, 'f.txt', 'f1\n');
  git(r, 'push', '-q', '-u', 'origin', 'edit');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'cherry-pick', 'edit~1');
  commit(r, 'f.txt', 'f2\n'); // the second commit lands with different bytes
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'push', '-q', 'origin', '--delete', 'edit');
  git(r, 'fetch', '-q', '--prune');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
  assert.deepEqual(names(c.goneUnmerged), ['edit']);
});

test('branches: worktree-agent-* with no upstream, cherry-picked onto main → landed (why worktree-agent)', () => {
  const r = clone();
  const wa = 'worktree-agent-d0123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'w1.txt', 'w1\n');
  commit(r, 'w2.txt', 'w2\n');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'cherry-pick', `main..${wa}`);
  assert.notEqual(branchD(r, wa).status, 0, 'fixture: git branch -d refuses it');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.deletable), []);
  assert.deepEqual(names(c.landed), [wa]);
  assert.equal(c.landed[0].why, 'worktree-agent');
  assert.equal(c.landed[0].how, 'per-commit');
});

test('branches: a merge commit on the branch → not landed', () => {
  const r = clone();
  const wa = 'worktree-agent-e0123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'w.txt', 'w\n');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'm.txt', 'm\n');
  git(r, 'checkout', '-q', wa);
  git(r, 'merge', '-q', '--no-ff', '-m', 'merge main in', 'main');
  git(r, 'checkout', '-q', 'main');
  git(r, 'cherry-pick', `${wa}~1`);
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
  assert.equal(refusedBranches({ cwd: r, command: `git branch -d ${wa}` }).kept[0].reason, 'merge-commits');
});

test('branches: a main commit from before the fork point does not count (re-adding what main once removed)', () => {
  const r = clone();
  // A second candidate forked earlier, so the one `git log -p` of main also
  // covers the commits before the re-adding branch's fork point.
  git(r, 'checkout', '-q', '-b', 'worktree-agent-e1123456789abcdef');
  commit(r, 'early.txt', 'early\n');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'n.txt', '1\n2\n3\n');
  commit(r, 'n.txt', '1\n2\nX\n3\n'); // main adds X …
  commit(r, 'n.txt', '1\n2\n3\n'); // … and removes it again
  const wa = 'worktree-agent-f0123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'n.txt', '1\n2\nX\n3\n'); // the branch re-adds it: same diff as main's older commit
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
});

// patch-id ignores line numbers: the same hunk, with the same context, at
// another place in the file has the same id. A file with two identical blocks
// where the branch edits the first and main the second must not read as
// landed: the branch's change is not on main.
test('branches: the same edit applied to another identical block is not landed', () => {
  const r = clone();
  const block = 'a1\na2\na3\nVALUE=1\na4\na5\na6\n';
  commit(r, 'f.txt', `${block}mid\n${block}`);
  const wa = 'worktree-agent-c1123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'f.txt', `${block.replace('VALUE=1', 'VALUE=2')}mid\n${block}`);
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  commit(r, 'f.txt', `${block}mid\n${block.replace('VALUE=1', 'VALUE=2')}`);
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
  // Control: the same edit at the same place, after main moved, is landed.
  git(r, 'cherry-pick', '-X', 'theirs', wa);
  assert.deepEqual(names(classifyBranches({ cwd: r }).landed), [wa]);
});

// A user's git config must not change a verdict: apply.whitespace=fix would
// strip the trailing spaces this commit carries, diff.noprefix drops the a/ b/
// that apply -p1 expects, diff.external replaces the diff, diff.relative cuts
// it to the cwd's subtree, color.ui=always colours it.
test('branches: a landed branch stays landed under a hostile git config, judged from a subdirectory', () => {
  const r = clone();
  const wa = 'worktree-agent-d1123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'ws.txt', 'trailing spaces   \n');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'cherry-pick', wa);
  for (const [k, v] of [
    ['apply.whitespace', 'fix'],
    ['diff.noprefix', 'true'],
    ['diff.external', 'false'],
    ['diff.relative', 'true'],
    ['color.ui', 'always'],
  ])
    git(r, 'config', k, v);
  fs.mkdirSync(path.join(r, 'sub'));
  assert.deepEqual(names(classifyBranches({ cwd: path.join(r, 'sub') }).landed), [wa]);
});

// The same-place check once applied the branch's diff to the matching
// commit's parent with `git apply`, which moves a hunk to wherever its context
// still matches: main changing block 1 to something else and block 2 to the
// branch's value read as landed (0.116.0 pre-tag review H1).
test('branches: an edit that main made to the other identical block, after changing this one, is not landed', () => {
  const r = clone();
  const blk = v => `a1\na2\na3\nVALUE=${v}\na4\na5\na6\n`;
  commit(r, 'f.txt', `head\n${blk('X')}mid\n${blk('X')}`);
  const wa = 'worktree-agent-e2123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  commit(r, 'f.txt', `head\n${blk('Y')}mid\n${blk('X')}`);
  git(r, 'checkout', '-q', 'main');
  commit(r, 'f.txt', `head\n${blk('Z')}mid\n${blk('X')}`);
  commit(r, 'f.txt', `head\n${blk('Z')}mid\n${blk('Y')}`);
  assert.deepEqual(names(classifyBranches({ cwd: r }).landed), []);
  assert.deepEqual(names(refusedBranches({ cwd: r, command: `git branch -d ${wa}` }).landed), []);
});

// A submodule pointer the diff does not show: diff.submodule=log, or
// `ignore = all` in .gitmodules, left it out of both patch ids (review H2).
test('branches: a moved submodule pointer that the diff settings hide is not landed', () => {
  for (const hide of ['config', 'gitmodules']) {
    fs.rmSync(path.join(root, 'remote.git'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'seed'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'repo'), { recursive: true, force: true });
    const r = clone();
    const before = '0123456789abcdef0123456789abcdef01234567';
    git(r, 'update-index', '--add', '--cacheinfo', `160000,${before},sub`);
    if (hide === 'gitmodules') {
      fs.writeFileSync(
        path.join(r, '.gitmodules'),
        '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = all\n'
      );
      git(r, 'add', '.gitmodules');
    }
    git(r, 'commit', '-q', '-m', 'add sub');
    const wa = 'worktree-agent-f2123456789abcdef';
    git(r, 'checkout', '-q', '-b', wa);
    fs.writeFileSync(path.join(r, 'a.txt'), 'a\nb\n');
    git(r, 'add', 'a.txt');
    git(r, 'update-index', '--cacheinfo', '160000,89abcdef0123456789abcdef0123456789abcdef,sub');
    git(r, 'commit', '-q', '-m', 'edit a, move sub');
    git(r, 'checkout', '-q', 'main');
    commit(r, 'other.txt', 'other\n');
    commit(r, 'a.txt', 'a\nb\n');
    if (hide === 'config') git(r, 'config', 'diff.submodule', 'log');
    assert.deepEqual(names(classifyBranches({ cwd: r }).landed), [], hide);
  }
});

// Judging a partial clone would fetch the missing blobs from the remote,
// from inside a hook (review M3): it is not judged.
test('branches: a partial clone is not judged and fetches nothing', () => {
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  git(src, 'init', '-q', '-b', 'main');
  git(src, 'config', 'uploadpack.allowFilter', 'true');
  commit(src, 'a.txt', 'a\n');
  git(src, 'checkout', '-q', '-b', 'feat');
  commit(src, 'f.txt', 'f\n');
  git(src, 'checkout', '-q', 'main');
  commit(src, 'other.txt', 'other\n');
  git(src, 'cherry-pick', 'feat');
  const r = path.join(root, 'partial');
  git(root, 'clone', '-q', '--no-checkout', '--filter=blob:none', `file://${src}`, r);
  git(r, 'branch', 'feat', 'origin/feat');
  const packs = () => fs.readdirSync(path.join(r, '.git', 'objects', 'pack')).length;
  const before = packs();
  const out = refusedBranches({ cwd: r, command: 'git branch -d feat' });
  assert.deepEqual(names(out.landed), []);
  assert.equal(out.kept[0]?.reason, 'partial-clone');
  assert.equal(packs(), before, 'no object fetched');
});

// The throwaway object directory is removed after a run; one a killed run
// left more than 10 minutes ago is reaped by the next (review M2).
test('branches: no claudemd-landed directory stays behind, and a stale one is reaped', () => {
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp);
  const stale = path.join(tmp, 'claudemd-landed.AbC123');
  const fresh = path.join(tmp, 'claudemd-landed.XyZ789');
  for (const d of [stale, fresh]) fs.mkdirSync(path.join(d, 'objects'), { recursive: true });
  const old = Date.now() / 1000 - 3600;
  fs.utimesSync(stale, old, old);
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    assert.deepEqual(names(classifyBranches({ cwd: r }).landed), ['feat']);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  assert.deepEqual(fs.readdirSync(tmp), ['claudemd-landed.XyZ789']);
});

test('branches: landed, then reverted on main → still landed (user decision 2026-10-21)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'rv', 'pick');
  git(r, 'revert', '--no-edit', 'HEAD');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), ['rv']);
});

test("branches: a mode change counts — the same edit without the branch's chmod is not landed", () => {
  const r = clone();
  const wa = 'worktree-agent-a1123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  fs.writeFileSync(path.join(r, 'a.txt'), 'a\nb\n');
  fs.chmodSync(path.join(r, 'a.txt'), 0o755);
  git(r, 'commit', '-q', '-am', 'edit a and make it executable');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  commit(r, 'a.txt', 'a\nb\n');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
});

test('branches: a binary file with other bytes on main → not landed', () => {
  const r = clone();
  const wa = 'worktree-agent-b1123456789abcdef';
  git(r, 'checkout', '-q', '-b', wa);
  fs.writeFileSync(path.join(r, 'b.bin'), Buffer.from([0, 1, 2, 3]));
  git(r, 'add', 'b.bin');
  git(r, 'commit', '-q', '-m', 'add b.bin');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  fs.writeFileSync(path.join(r, 'b.bin'), Buffer.from([0, 1, 2, 4]));
  git(r, 'add', 'b.bin');
  git(r, 'commit', '-q', '-m', 'add b.bin');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
});

test('branches: more than 20 candidates to judge → 20 judged, unjudged counts the rest', () => {
  const r = clone();
  const base = git(r, 'rev-parse', 'HEAD');
  const tree = git(r, 'rev-parse', 'HEAD^{tree}');
  const refs = [];
  for (let i = 0; i < 22; i++) {
    const c = spawnSync('git', ['-C', r, 'commit-tree', tree, '-p', base, '-m', `empty ${i}`], {
      encoding: 'utf8',
      env: GIT_ENV,
    });
    refs.push(`create refs/heads/worktree-agent-n${String(i).padStart(2, '0')} ${c.stdout.trim()}\n`);
  }
  const u = spawnSync('git', ['-C', r, 'update-ref', '--stdin'], { input: refs.join(''), env: GIT_ENV });
  assert.equal(u.status, 0, String(u.stderr));
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
  assert.equal(c.unjudged, 2);
  assert.equal(classifyBranches({ cwd: root }).unjudged, 0, 'not a repo: nothing left out');
});

test('branches: more than 500 main commits after the fork point → not judged landed', () => {
  const r = clone();
  landAndDeleteRemote(r, 'old', 'pick');
  // 500 more commits on main through fast-import: one spawn, not 500.
  const head = git(r, 'rev-parse', 'HEAD');
  let stream = '';
  for (let i = 0; i < 500; i++) {
    stream += `commit refs/heads/main\ncommitter t <t@t> ${Math.floor(Date.now() / 1000) + i} +0000\ndata 2\nc\n`;
    if (i === 0) stream += `from ${head}\n`;
    stream += `M 100644 inline pad.txt\ndata ${String(i).length + 1}\n${i}\n\n`;
  }
  const fi = spawnSync('git', ['-C', r, 'fast-import', '--quiet', '--force'], {
    input: stream,
    env: GIT_ENV,
  });
  assert.equal(fi.status, 0, String(fi.stderr));
  git(r, 'reset', '-q', '--hard', 'main');
  const c = classifyBranches({ cwd: r });
  assert.deepEqual(names(c.landed), []);
  assert.deepEqual(names(c.goneUnmerged), ['old']);
});

// ---- refused: the branches a `git branch -d` command left in place ----

test('refused: branchDeleteTargets reads names from git branch -d / --delete segments only', () => {
  assert.deepEqual(branchDeleteTargets('git branch -d feat'), [{ dir: null, names: ['feat'] }]);
  assert.deepEqual(branchDeleteTargets(`git -C '/x y' branch -d -- 'a' "b" fix/c`), [
    { dir: '/x y', names: ['a', 'b', 'fix/c'] },
  ]);
  assert.deepEqual(branchDeleteTargets('git branch --delete a; git status && git branch -dq b'), [
    { dir: null, names: ['a'] },
    { dir: null, names: ['b'] },
  ]);
  for (const notOne of [
    'git branch -D feat',
    'git branch -d -f feat',
    'git branch -d --force feat',
    'git branch -d -r origin/feat',
    'git branch feat',
    'echo git branch -d feat',
    'git log --oneline main..feat',
    'git --git-dir=/x branch -d feat',
    'git -C "$R" branch -d feat',
    'GIT_DIR=/other/.git git branch -d feat',
  ]) {
    assert.deepEqual(branchDeleteTargets(notOne), [], notOne);
  }
  // A name the shell would expand is not knowable from the text.
  assert.deepEqual(branchDeleteTargets('git branch -d "$b" feat-* `x` ok'), [{ dir: null, names: ['ok'] }]);
  // After a `cd`, a git without an absolute -C acts on another directory than
  // the one the hook judges in: nothing (review text L4).
  assert.deepEqual(branchDeleteTargets('cd /other && git branch -d feat'), []);
  assert.deepEqual(branchDeleteTargets('pushd sub; git branch -d feat'), []);
  assert.deepEqual(branchDeleteTargets('cd /x && git -C /abs branch -d feat'), [
    { dir: '/abs', names: ['feat'] },
  ]);
  assert.deepEqual(branchDeleteTargets('git branch -d feat; cd /x'), [{ dir: null, names: ['feat'] }]);
  // A comment, a redirect target and a here-doc delimiter are not names (review M1).
  for (const cmd of [
    'git branch -d feat  # merged, release stays',
    'git branch -d feat 2> logs',
    'git branch -d feat >out',
    'git branch -d feat 2>&1',
    'git branch -d feat <<EOF',
  ]) {
    assert.deepEqual(branchDeleteTargets(cmd), [{ dir: null, names: ['feat'] }], cmd);
  }
  assert.deepEqual(branchDeleteTargets('LC_ALL=C git branch -d a\ngit branch -d b'), [
    { dir: null, names: ['a'] },
    { dir: null, names: ['b'] },
  ]);
});

test('refused: a cherry-picked branch with no upstream that -d refused → landed per-commit', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'fix/x');
  commit(r, 'x.txt', 'x\n');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'cherry-pick', 'main..fix/x');
  assert.notEqual(branchD(r, 'fix/x').status, 0, 'fixture: git branch -d refuses it');
  const out = refusedBranches({ cwd: r, command: 'git branch -d fix/x' });
  assert.deepEqual(out.kept, []);
  assert.deepEqual(out.landed, [
    {
      repo: r,
      name: 'fix/x',
      sha: git(r, 'rev-parse', 'fix/x'),
      onto: 'main',
      how: 'per-commit',
      commits: 1,
    },
  ]);
});

test('refused: a commit changed in the pick → kept, naming the commit with no copy on main', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'fix/y');
  commit(r, 'y1.txt', 'y1\n');
  fs.writeFileSync(path.join(r, 'y2.txt'), 'y2\n');
  git(r, 'add', 'y2.txt');
  git(r, 'commit', '-q', '-m', 'add y2');
  git(r, 'checkout', '-q', 'main');
  commit(r, 'other.txt', 'other\n');
  git(r, 'cherry-pick', 'fix/y~1');
  commit(r, 'y2.txt', 'y2 changed\n');
  const out = refusedBranches({ cwd: r, command: 'git branch -d fix/y' });
  assert.deepEqual(out.landed, []);
  assert.equal(out.kept.length, 1);
  assert.equal(out.kept[0].name, 'fix/y');
  assert.equal(out.kept[0].reason, 'not-on-default');
  assert.equal(out.kept[0].missingCount, 1);
  assert.deepEqual(out.kept[0].unmatched, [
    { sha: git(r, 'rev-parse', '--short', 'fix/y'), subject: 'add y2' },
  ]);
});

test('refused: on main but -d refused because HEAD is elsewhere → landed on-main', () => {
  const r = clone();
  git(r, 'checkout', '-q', '-b', 'topic');
  commit(r, 't.txt', 't\n');
  git(r, 'checkout', '-q', 'main');
  git(r, 'merge', '-q', '--ff-only', 'topic');
  git(r, 'checkout', '-q', '-b', 'elsewhere', 'main~1');
  assert.notEqual(branchD(r, 'topic').status, 0, 'fixture: git branch -d refuses topic from here');
  const out = refusedBranches({ cwd: r, command: 'git branch -d topic' });
  assert.deepEqual(names(out.landed), ['topic']);
  assert.equal(out.landed[0].how, 'on-main');
});

test('refused: a revision expression is not a branch name (review L3)', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  const out = refusedBranches({ cwd: r, command: 'git branch -d feat^0 feat~0' });
  assert.deepEqual(out.landed, []);
  assert.deepEqual(out.kept, []);
});

test('refused: deleted, default, checked-out, symbolic and unknown names are left out', () => {
  const r = clone();
  landAndDeleteRemote(r, 'gone1', 'pick');
  git(r, 'branch', 'busy', 'main');
  git(r, 'worktree', 'add', '-q', path.join(root, 'wt'), 'busy');
  git(r, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/main');
  const out = refusedBranches({ cwd: r, command: 'git branch -d main busy alias nosuch deleted-already' });
  assert.deepEqual(out.landed, []);
  assert.deepEqual(out.kept, []);
});

test('refused: git -C <dir> judges that repository, resolved from the cwd', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  const out = refusedBranches({ cwd: root, command: 'git -C repo branch -d feat' });
  assert.deepEqual(names(out.landed), ['feat']);
  assert.equal(out.landed[0].repo, r);
});

test('refused: at most 20 named branches are judged; unjudged counts the rest (review text L6)', () => {
  const r = clone();
  const base = git(r, 'rev-parse', 'HEAD');
  const tree = git(r, 'rev-parse', 'HEAD^{tree}');
  const refs = [];
  for (let i = 0; i < 22; i++) {
    const c = spawnSync('git', ['-C', r, 'commit-tree', tree, '-p', base, '-m', `n ${i}`], {
      encoding: 'utf8',
      env: GIT_ENV,
    });
    refs.push(`create refs/heads/n${String(i).padStart(2, '0')} ${c.stdout.trim()}\n`);
  }
  assert.equal(
    spawnSync('git', ['-C', r, 'update-ref', '--stdin'], { input: refs.join(''), env: GIT_ENV }).status,
    0
  );
  const names22 = Array.from({ length: 22 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  const out = refusedBranches({ cwd: r, command: `git branch -d ${names22.join(' ')}` });
  assert.equal(out.landed.length + out.kept.length, 20);
  assert.equal(out.unjudged, 2);
});

test('refused: a rebase in progress skips the run', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  fs.mkdirSync(path.join(r, '.git', 'rebase-merge'));
  const out = refusedBranches({ cwd: r, command: 'git branch -d feat' });
  assert.deepEqual(out.landed, []);
  assert.equal(out.skipped, 'rebase-or-bisect-in-progress');
});

test('refused: the CLI reads the command on stdin and prints JSON; it deletes nothing', () => {
  const r = clone();
  landAndDeleteRemote(r, 'feat', 'pick');
  const out = spawnSync('node', [SCRIPT, 'refused', `--cwd=${r}`], {
    input: 'git branch -d feat',
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(names(JSON.parse(out.stdout).landed), ['feat']);
  assert.ok(git(r, 'branch', '--list', 'feat'), 'feat still exists');
});
