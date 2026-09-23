import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/housekeeping.js tmp [--apply] [--root=DIR] [--min-age-minutes=N]
       node scripts/housekeeping.js branches [--cwd=DIR]

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
branches  REPORT (never delete) the local branches that are safe to delete:
          a branch whose upstream the remote deleted (\`[gone]\`) and whose
          tip is already on the default branch (local or origin/<default>),
          plus worktree-agent-* branches on the default branch. Never lists
          the default branch or a branch checked out in any worktree; and,
          worktree-agent-* aside, never a branch whose upstream still exists
          or one with no upstream. Reports nothing while a rebase or bisect is
          in progress in a worktree it can see. A gone branch whose tip is NOT
          on the default branch (squash merge) is listed under
          \`goneUnmerged\`. Deleting is left to \`git branch -d\`, which runs
          git's own merged and in-use checks at the moment of deletion.

Options:
  --apply                tmp: delete (default is a dry run that only reports).
  --root=DIR             tmp: scan only DIR (test seam).
  --min-age-minutes=N    tmp: override the age floor.
  --cwd=DIR              branches: repository to inspect (default: cwd).
  --help, -h             Print this message and exit.

Output: JSON on stdout.

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

// Deletes scan targets, re-checking each one's signature and age right before
// its rm: scan and delete are separate moments, and a run that restarted in
// between has made the directory fresh again.
export function removeVitestTargets({ targets, minAgeMs, uid = process.getuid(), now = Date.now() }) {
  let deleted = 0;
  let bytes = 0;
  const errors = [];
  for (const t of targets) {
    const sig = vitestSignature(t.path, uid);
    if (!sig || now - sig.newestMs < minAgeMs) continue;
    try {
      fs.rmSync(t.path, { recursive: true });
      deleted++;
      bytes += t.bytes;
    } catch (e) {
      errors.push({ path: t.path, code: e.code || String(e) });
    }
  }
  return { deleted, bytes, errors };
}

export function sweepVitestTmp({ apply = false, minAgeMs, ...opts } = {}) {
  if (minAgeMs == null) {
    const lines = psLines();
    // ps unavailable → assume a watcher may be alive and take the long floor.
    minAgeMs = ageFloorMs({ watchAlive: lines === null || vitestWatchAlive(lines) });
  }
  const targets = scanVitestTmp({ ...opts, minAgeMs });
  const removed = apply
    ? removeVitestTargets({ targets, minAgeMs, uid: opts.uid, now: opts.now })
    : { deleted: 0, bytes: 0, errors: [] };
  return { minAgeMs, targets, ...removed };
}

// ---- branches ----
//
// The rule is the one `git branch -vv` users apply by hand: a branch whose
// upstream the remote deleted (`[gone]` — GitHub's delete_branch_on_merge plus
// fetch.prune produce exactly that after a merge) and whose tip is already on
// the default branch. Nothing else is judged "merged":
//   - no patch-id equivalence (`git cherry`, squash probes): patch-id ignores
//     whitespace, so two different edits compare equal (0.93.0 pre-tag review
//     H3), and it asks whether a patch ever landed, not whether it is still
//     there (M2);
//   - apart from worktree-agent-*, no branch whose upstream still exists is a
//     candidate (a `[behind N]` / `[ahead N]` track is not `[gone]`), which
//     is what keeps `main` / `develop` safe in a git-flow repo whose origin/HEAD
//     names the other one (H2, M1);
//   - no branch without an upstream is a candidate (a backup made before a
//     rebase, a renamed fresh branch — M3) except worktree-agent-*, the name
//     Claude Code's worktree isolation gives and no person reuses.
// A gone branch whose tip is NOT on the default branch (a squash merge, or
// work the remote lost) is listed under goneUnmerged for a person to judge.
//
// Report-only, by the maintainer's decision after the 0.93.0 pre-tag reviews:
// git has no delete that both compares and checks use. `update-ref -d <sha>`
// is a compare-and-delete but skips git's in-use checks (a branch mid-rebase,
// one checked out in a worktree created after classification) and
// dereferences a symbolic ref, deleting its target; `git branch -d`/`-D`
// checks use but takes no expected sha, so a branch moved in between loses its
// new commits. `git branch -d`, run by whoever acts on the report, checks
// merged-ness and use at the moment it deletes. Symbolic refs are not listed.

function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.replace(/\n$/, '') : null;
  };
}

const MAX_CANDIDATES = 200;
const EMPTY = () => ({ defaultBranch: null, deletable: [], goneUnmerged: [], skipped: null });

function defaultBranchOf(git) {
  const sym = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  if (sym && sym.startsWith('origin/')) return sym.slice('origin/'.length);
  for (const b of ['main', 'master'])
    if (git('show-ref', '--verify', '--quiet', `refs/heads/${b}`) !== null) return b;
  return null;
}

// A rebase or bisect in ANY worktree leaves its branch unlisted by
// `worktree list` (the worktree reads as detached), and deleting that branch
// makes `rebase --continue` fail to update it (H4). Skip the whole run.
function operationInProgress(git) {
  const porcelain = git('worktree', 'list', '--porcelain') || '';
  const dirs = porcelain
    .split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => l.slice('worktree '.length));
  for (const wt of dirs) {
    const gd = gitIn(wt)('rev-parse', '--absolute-git-dir');
    if (!gd) continue;
    for (const marker of ['rebase-merge', 'rebase-apply', 'BISECT_START']) {
      if (fs.existsSync(path.join(gd, marker))) return true;
    }
  }
  return false;
}

export function classifyBranches({ cwd = process.cwd() } = {}) {
  const git = gitIn(cwd);
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') return EMPTY();
  const defaultBranch = defaultBranchOf(git);
  if (!defaultBranch) return EMPTY();
  if (operationInProgress(git)) return { ...EMPTY(), defaultBranch, skipped: 'rebase-or-bisect-in-progress' };
  const bases = [`refs/heads/${defaultBranch}`, `refs/remotes/origin/${defaultBranch}`].filter(
    ref => git('show-ref', '--verify', '--quiet', ref) !== null
  );
  const checkedOut = new Set(
    (git('worktree', 'list', '--porcelain') || '')
      .split('\n')
      .filter(l => l.startsWith('branch refs/heads/'))
      .map(l => l.slice('branch refs/heads/'.length))
  );
  const refs = (
    git(
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(upstream:track)%09%(symref)',
      'refs/heads'
    ) || ''
  )
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [ref, sha, track, symref] = l.split('\t');
      return {
        name: ref.slice('refs/heads/'.length),
        sha,
        gone: track === '[gone]',
        symref: Boolean(symref),
      };
    })
    .filter(b => !b.symref)
    .filter(b => b.name !== defaultBranch && !checkedOut.has(b.name))
    .filter(b => b.gone || b.name.startsWith('worktree-agent-'))
    .slice(0, MAX_CANDIDATES);

  const deletable = [];
  const goneUnmerged = [];
  for (const b of refs) {
    const onDefault = bases.some(base => git('merge-base', '--is-ancestor', b.sha, base) !== null);
    if (onDefault) deletable.push({ name: b.name, sha: b.sha, why: b.gone ? 'gone' : 'worktree-agent' });
    else if (b.gone) goneUnmerged.push({ name: b.name, sha: b.sha });
  }
  return { defaultBranch, deletable, goneUnmerged, skipped: null };
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
    const p = parseStrictOrExit(rest, { values: ['--cwd'] });
    process.stdout.write(
      JSON.stringify(classifyBranches({ cwd: p.values['--cwd'] || process.cwd() })) + '\n'
    );
  } else {
    console.error(`Unknown subcommand: '${sub ?? ''}'. Expected 'tmp' or 'branches'.`);
    process.exit(2);
  }
}
