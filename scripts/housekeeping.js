import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/housekeeping.js tmp [--apply] [--root=DIR] [--min-age-minutes=N]
       node scripts/housekeeping.js branches [--apply] [--cwd=DIR]

tmp       Reclaim the per-run directories vitest leaves in the temp root.
          vitest 5.0.0 creates join(os.tmpdir(), nanoid()) on its root object
          and never removes it; on a tmpfs /tmp that is unreclaimable RAM.
          A directory is a target ONLY when all of these hold: its name is 21
          chars of [A-Za-z0-9_-]; it is a real directory owned by this uid; its
          children are a non-empty subset of {ssr, client}, each a real
          directory; every grandchild is a regular file named by 40 hex chars;
          and the newest mtime anywhere inside is older than the floor
          (60 min, or 24 h while a vitest watch-mode process of this uid runs).
          Roots: $TMPDIR, os.tmpdir(), /tmp and ~/.cache/tmp, de-duplicated
          (CLAUDEMD_TMP_SWEEP_ROOTS, colon-separated, replaces the list).
branches  Delete local branches whose content is already on the default
          branch (local or origin/<default>): the tip is an ancestor, or the
          branch's squashed diff / every commit is patch-equivalent to one
          there. Never touches the default branch or a branch checked out in
          any worktree. An ancestor branch that never moved since creation is
          reported under \`fresh\`, not deleted — except worktree-agent-*,
          which Claude Code's worktree isolation names. Local git only.

Options:
  --apply                Delete (default is a dry run that only reports).
  --root=DIR             tmp: scan only DIR (test seam).
  --min-age-minutes=N    tmp: override the age floor.
  --cwd=DIR              branches: repository to prune (default: cwd).
  --help, -h             Print this message and exit.

Output: JSON on stdout. Every deleted branch carries its sha, so
\`git branch <name> <sha>\` restores it.

Exit codes: 0 success | 2 argv-shape error.`;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const VITEST_DIR_NAME = /^[A-Za-z0-9_-]{21}$/;
const VITEST_ENV_NAMES = new Set(['ssr', 'client']);
const HEX40 = /^[0-9a-f]{40}$/;

export function ageFloorMs({ watchAlive }) {
  return watchAlive ? 24 * HOUR : HOUR;
}

// A process line runs vitest when a token naming the vitest binary is either
// the program / its first argument (`vitest …`, `npx vitest …`,
// `node vitest.mjs …`) or a node_modules path. `grep vitest` does not count.
// Watch mode is vitest's default: anything but `run` / `--run` is a watcher.
export function vitestWatchAlive(lines) {
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    const i = tokens.findIndex(
      (t, idx) => /^vitest(\.m?js)?$/.test(path.basename(t)) && (idx <= 1 || t.includes('/node_modules/'))
    );
    if (i === -1) continue;
    const after = tokens.slice(i + 1);
    if (after[0] === 'run' || after.some(t => t === '--run')) continue;
    return true;
  }
  return false;
}

function psLines() {
  const r = spawnSync('ps', ['-U', String(process.getuid()), '-o', 'args='], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.split('\n');
}

// CLAUDEMD_TMP_SWEEP_ROOTS (colon-separated) replaces the list outright — the
// hook suite's seam, so a test never sweeps the real temp root.
export function defaultTmpRoots() {
  const seam = process.env.CLAUDEMD_TMP_SWEEP_ROOTS;
  if (seam) return seam.split(':').filter(Boolean);
  const roots = [process.env.TMPDIR, os.tmpdir(), '/tmp', path.join(os.homedir(), '.cache', 'tmp')];
  return roots.filter(Boolean);
}

// Returns { bytes, newestMs } when `dir` carries the exact vitest signature,
// null otherwise. lstat throughout: a symlink anywhere disqualifies.
function vitestSignature(dir, uid) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory() || st.uid !== uid) return null;
  let newestMs = st.mtimeMs;
  let bytes = 0;
  let children;
  try {
    children = fs.readdirSync(dir);
  } catch {
    return null;
  }
  if (children.length === 0) return null;
  for (const c of children) {
    if (!VITEST_ENV_NAMES.has(c)) return null;
    const cp = path.join(dir, c);
    let cst;
    let files;
    try {
      cst = fs.lstatSync(cp);
      if (!cst.isDirectory()) return null;
      files = fs.readdirSync(cp);
    } catch {
      return null;
    }
    newestMs = Math.max(newestMs, cst.mtimeMs);
    for (const f of files) {
      if (!HEX40.test(f)) return null;
      let fst;
      try {
        fst = fs.lstatSync(path.join(cp, f));
      } catch {
        return null;
      }
      if (!fst.isFile()) return null;
      newestMs = Math.max(newestMs, fst.mtimeMs);
      bytes += fst.size;
    }
  }
  return { bytes, newestMs };
}

export function scanVitestTmp({
  roots = defaultTmpRoots(),
  now = Date.now(),
  minAgeMs,
  uid = process.getuid(),
} = {}) {
  const seen = new Set();
  const targets = [];
  for (const r of roots) {
    let real;
    try {
      real = fs.realpathSync(r);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    let entries;
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!VITEST_DIR_NAME.test(e.name) || !e.isDirectory()) continue;
      const full = path.join(real, e.name);
      const sig = vitestSignature(full, uid);
      if (!sig || now - sig.newestMs < minAgeMs) continue;
      targets.push({ path: full, bytes: sig.bytes });
    }
  }
  return targets;
}

export function sweepVitestTmp({ apply = false, minAgeMs, ...opts } = {}) {
  if (minAgeMs == null) {
    const lines = psLines();
    // ps unavailable → assume a watcher may be alive and take the long floor.
    minAgeMs = ageFloorMs({ watchAlive: lines === null || vitestWatchAlive(lines) });
  }
  const targets = scanVitestTmp({ ...opts, minAgeMs });
  let deleted = 0;
  let bytes = 0;
  const errors = [];
  if (apply) {
    const uid = opts.uid ?? process.getuid();
    for (const t of targets) {
      // Re-check right before the delete: the scan and the rm are separate
      // moments, and a run that restarted in between makes the dir fresh.
      const sig = vitestSignature(t.path, uid);
      if (!sig || (opts.now ?? Date.now()) - sig.newestMs < minAgeMs) continue;
      try {
        fs.rmSync(t.path, { recursive: true });
        deleted++;
        bytes += t.bytes;
      } catch (e) {
        errors.push({ path: t.path, code: e.code || String(e) });
      }
    }
  }
  return { minAgeMs, targets, deleted, bytes, errors };
}

// ---- branches ----

// commit-tree needs an identity; a machine with none configured must still be
// able to test a squash, so the probe commit gets a fixed one.
const PROBE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'claudemd',
  GIT_AUTHOR_EMAIL: 'claudemd@localhost',
  GIT_COMMITTER_NAME: 'claudemd',
  GIT_COMMITTER_EMAIL: 'claudemd@localhost',
};

function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: PROBE_ENV });
    return r.status === 0 ? r.stdout.replace(/\n$/, '') : null;
  };
}

const MAX_CANDIDATES = 200;
const EMPTY = () => ({ defaultBranch: null, prune: [], fresh: [] });

function defaultBranchOf(git) {
  const sym = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  if (sym && sym.startsWith('origin/')) return sym.slice('origin/'.length);
  for (const b of ['main', 'master'])
    if (git('show-ref', '--verify', '--quiet', `refs/heads/${b}`) !== null) return b;
  return null;
}

function patchEquivalent(git, base, name) {
  // Every commit already there (rebase-merge) ...
  const cherry = git('cherry', base, name);
  if (cherry !== null && cherry !== '' && !cherry.split('\n').some(l => l.startsWith('+'))) return true;
  // ... or the whole branch as one diff (squash-merge).
  const mb = git('merge-base', base, name);
  if (!mb) return false;
  const probe = git('commit-tree', `${name}^{tree}`, '-p', mb, '-m', 'claudemd squash probe');
  if (!probe) return false;
  const c = git('cherry', base, probe);
  return c !== null && c.startsWith('-');
}

export function classifyBranches({ cwd = process.cwd() } = {}) {
  const git = gitIn(cwd);
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') return EMPTY();
  const defaultBranch = defaultBranchOf(git);
  if (!defaultBranch) return EMPTY();
  const bases = [`refs/heads/${defaultBranch}`, `refs/remotes/origin/${defaultBranch}`].filter(
    ref => git('show-ref', '--verify', '--quiet', ref) !== null
  );
  const checkedOut = new Set(
    (git('worktree', 'list', '--porcelain') || '')
      .split('\n')
      .filter(l => l.startsWith('branch refs/heads/'))
      .map(l => l.slice('branch refs/heads/'.length))
  );
  const refs = (git('for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/heads') || '')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [ref, sha] = l.split('\t');
      return { name: ref.slice('refs/heads/'.length), sha };
    })
    .filter(b => b.name !== defaultBranch && !checkedOut.has(b.name))
    .slice(0, MAX_CANDIDATES);

  const prune = [];
  const fresh = [];
  for (const b of refs) {
    const ancestor = bases.some(base => git('merge-base', '--is-ancestor', b.sha, base) !== null);
    if (ancestor) {
      if (b.name.startsWith('worktree-agent-')) {
        prune.push({ ...b, why: 'worktree-agent' });
        continue;
      }
      const reflog = git('reflog', 'show', '--format=%H', `refs/heads/${b.name}`);
      const moved = reflog !== null && reflog.split('\n').filter(Boolean).length >= 2;
      if (moved) prune.push({ ...b, why: 'ancestor' });
      else fresh.push(b);
      continue;
    }
    if (bases.some(base => patchEquivalent(git, base, b.sha))) prune.push({ ...b, why: 'squash' });
  }
  return { defaultBranch, prune, fresh };
}

export function pruneBranches({ cwd = process.cwd(), apply = false } = {}) {
  const c = classifyBranches({ cwd });
  const deleted = [];
  const errors = [];
  if (apply) {
    const git = gitIn(cwd);
    for (const b of c.prune) {
      // Compare-and-delete: if the branch moved since classification, the old
      // value no longer matches and git refuses.
      if (git('update-ref', '-d', `refs/heads/${b.name}`, b.sha) !== null) {
        git('config', '--remove-section', `branch.${b.name}`);
        deleted.push(b);
      } else errors.push({ name: b.name, code: 'update-ref-refused' });
    }
  }
  return { ...c, deleted, errors };
}

if (invokedAsMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const [sub, ...rest] = argv;
  if (sub === 'tmp') {
    const p = parseStrictOrExit(rest, { bools: ['--apply'], values: ['--root', '--min-age-minutes'] });
    const opts = { apply: p.bools.has('--apply') };
    if (p.values['--root'] !== undefined) opts.roots = [p.values['--root']];
    if (p.values['--min-age-minutes'] !== undefined) {
      const n = parsePositiveInt(p.values['--min-age-minutes']);
      if (n === null) {
        console.error(
          `--min-age-minutes must be a positive integer (got '${p.values['--min-age-minutes']}').`
        );
        process.exit(2);
      }
      opts.minAgeMs = n * MINUTE;
    }
    process.stdout.write(JSON.stringify(sweepVitestTmp(opts)) + '\n');
  } else if (sub === 'branches') {
    const p = parseStrictOrExit(rest, { bools: ['--apply'], values: ['--cwd'] });
    const out = pruneBranches({ cwd: p.values['--cwd'] || process.cwd(), apply: p.bools.has('--apply') });
    process.stdout.write(JSON.stringify(out) + '\n');
  } else {
    console.error(`Unknown subcommand: '${sub ?? ''}'. Expected 'tmp' or 'branches'.`);
    process.exit(2);
  }
}
