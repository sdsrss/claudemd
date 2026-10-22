import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/housekeeping.js tmp [--apply] [--root=DIR] [--min-age-minutes=N]
       node scripts/housekeeping.js branches [--cwd=DIR]
       node scripts/housekeeping.js refused [--cwd=DIR] < COMMAND

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
          tip is already on the local default branch, plus worktree-agent-*
          branches on it; each one also on what \`git branch -d\` compares it
          with in --cwd's checkout (its upstream when that exists, else
          HEAD), so \`git branch -d\` deletes every branch listed. A gone
          branch on origin/<default> but not on the local default branch
          (pushed and merged, local default not yet fast-forwarded) is not
          listed until the local default branch has it. Never lists the
          default branch or a branch checked out in any worktree; and,
          worktree-agent-* aside, never a branch whose upstream still exists
          or one with no upstream. Reports nothing while a rebase or bisect is
          in progress in a worktree it can see. Deleting is left to \`git
          branch -d\`, which runs git's own merged and in-use checks at the
          moment of deletion. Examines at most 200 candidates; \`truncated\`
          counts the rest.
          A candidate whose tip is on neither the default branch nor
          origin/<default> (a rebase merge, a cherry-pick, a squash) is listed
          under \`landed\` when each of its commits has its own commit on
          the default branch, after the fork point, with the same \`git
          patch-id --verbatim\` (whitespace kept, binary files compared by
          blob id), or its whole change equals one such commit and its tip is
          not back at an earlier commit's tree; and that commit is the same
          change at the same place (a three-way merge of the change onto it,
          git 2.40+, run with no config or attributes, leaves it as it is). A
          partial clone or a repository with grafts is not judged.
          \`git branch -d\` refuses these, so deleting them takes \`git
          branch -D\`. Judges at most 20 such candidates, counting the rest
          in \`unjudged\`, and none whose fork point is more than 500 commits
          behind. A gone one that is not landed is listed under
          \`goneUnmerged\`.
refused   Judge the branches a \`git branch -d\` command left in place: the
          names in its \`git [-C DIR] branch -d|--delete\` segments (read from
          stdin) that still exist, are not the default branch, a worktree
          checkout or a symbolic ref, at most 20 (\`unjudged\` counts the
          rest). Comments, redirections, a segment with a GIT_* assignment,
          and one after a \`cd\` (also \`command cd\`, \`builtin cd\`) without
          an absolute -C, name nothing. Each
          is \`landed\` (as above, with \`how\`: \`per-commit\` and the number
          of \`commits\`, \`squash\` and the commit it equals, \`via\`, or
          \`on-main\` when its tip is on the default branch and -d compared
          it with something else) or \`kept\`, with up to 3 of the commits
          that have no copy on the default branch (\`missingCount\` counts
          them all), or a reason such as \`compare-failed\` when the
          comparison could not be made, \`shallow\` when a shallow clone
          holds no commit it shares with the default branch (it stops
          before the fork point, or the branch is unrelated),
          \`no-default-branch\` when the default branch has no local copy,
          or \`grafts\` when the repository has grafts.
          Never deletes.

Options:
  --apply                tmp: delete (default is a dry run that only reports).
  --root=DIR             tmp: scan only DIR, an existing directory (test seam).
  --min-age-minutes=N    tmp: override the age floor.
  --cwd=DIR              branches, refused: repository to inspect, or the
                         directory a -C in the command is relative to
                         (default: cwd).
  --help, -h             Print this message and exit.

Output: JSON on stdout.

Exit codes: 0 success | 2 argv-shape error, a bad --min-age-minutes, or a
--root that is not a directory | 3 tmp --apply recorded an error for a
target (each one is listed in \`errors\`, with its errno).`;

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
//
// Several sweeps racing over one root each count what they removed, so their
// sum can exceed the dirs removed. Counting only a successful rmdir of the top
// (529ad53, backed out in 864b03a) does not fix that on macOS: there, two
// processes' rmdir(2) of the same empty dir can both return success (PR CI run
// 39461011037: 801, 897 and 885 successes for 800 dirs on Node 20, 22 and 24;
// Linux exactly 800).
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
//   - patch-id equivalence decides `landed` (below), never `deletable`;
//   - apart from worktree-agent-*, no branch whose upstream still exists is a
//     candidate (a `[behind N]` / `[ahead N]` track is not `[gone]`), which
//     is what keeps `main` / `develop` safe in a git-flow repo whose origin/HEAD
//     names the other one (H2, M1);
//   - no branch without an upstream is a candidate (a backup made before a
//     rebase, a renamed fresh branch — M3) except worktree-agent-*, the name
//     Claude Code's worktree isolation gives and no person reuses.
// A gone branch whose tip is NOT on the default branch and is not `landed`
// (work changed on its way in, or work the remote lost) is listed under
// goneUnmerged for a person to judge.
//
// `landed`: a rebase merge, a cherry-pick or a squash puts a branch's work on
// the default branch as NEW commits, so `git branch -d` refuses the branch
// forever. Such a branch is landed when each of its commits has its own commit
// on the default branch, after the fork point, with the same `git patch-id
// --verbatim`, or its whole change equals one such commit (a squash). 0.93.0
// rejected patch-id for deletion (review H3, M2); the two objections and what
// answers them (tasks/specs/landed-branch-cleanup.md):
//   - H3, plain patch-id strips whitespace, so `git cherry` calls two
//     different edits equal (a line moved into an `if` in Python): --verbatim
//     keeps every byte, --full-index compares binary files by blob id;
//   - M2, a patch that landed may since have been reverted: counted as landed
//     by the user's decision (2026-10-21), since the commit is still in the
//     default branch's history. A match from BEFORE the fork point is not
//     counted: re-adding what the default branch once removed is new work.
// Measured on 29 branches -d refuses that were deleted with -D in one week:
// 27 landed, the other 2 each had one commit whose content on main differs.
//
// "On the default branch" means the LOCAL one, and a listed branch must also
// be merged into what `git branch -d` compares it with: its upstream when that
// resolves, else HEAD of the --cwd checkout. origin/<default> counted as well
// from 0.93.0, when this script deleted with update-ref and checked merged-ness
// itself. Once the delete was left to `git branch -d` (report-only, below), a
// branch on origin/main only (merged on GitHub and fetched, local main behind)
// was listed, and `git branch -d` on main refused it "not fully merged" and
// suggested -D (167). Such a branch is neither listed nor goneUnmerged: it is
// listed after the merge or pull that brings it onto the local default branch.
//
// Report-only, by the maintainer's decision after the 0.93.0 pre-tag reviews:
// git has no delete that both compares and checks use. `update-ref -d <sha>`
// is a compare-and-delete but skips git's in-use checks (a branch mid-rebase,
// one checked out in a worktree created after classification) and
// dereferences a symbolic ref, deleting its target; `git branch -d`/`-D`
// checks use but takes no expected sha, so a branch moved in between loses its
// new commits. `git branch -d`, run by whoever acts on the report, checks
// merged-ness and use at the moment it deletes. Symbolic refs are not listed.
// A `landed` branch needs `git branch -D`, which keeps the in-use checks
// (checked out or being rebased in any worktree, git 2.53) and drops only the
// merged one; the sha this report gives is what a caller compares the tip
// with first, so a branch that moved since is not deleted.

// --no-replace-objects, here and in verbatimPatchIds: a replace ref swaps a
// commit's content and parents, so one could hide a branch commit from
// `rev-list` and the branch read as landed, or dress a commit up as main's
// copy (pre-tag review round 3 L1). A repository with grafts is not judged
// (judgeLanded); the same-place check takes each commit's parent from this
// walk, so it checks the change its patch id was computed from.
function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', ['--no-replace-objects', '-C', cwd, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.replace(/\n$/, '') : null;
  };
}

const MAX_CANDIDATES = 200;
// Judging a branch costs about seven git spawns plus a `git log -p` of the
// default branch since the oldest fork point (about 1.5 ms per commit), and
// branch-prune runs after every merge, pull, fetch and push.
const MAX_JUDGED = 20;
const MAIN_WINDOW = 500;
// 500 commits of this repo's `git log -p` came to 6.9 MB (2026-10-21).
const PATCH_MAX_BUFFER = 256 * 1024 * 1024;
// One set of options on both sides, so a user's diff config cannot make the
// same change read differently: no colour, no external or textconv driver,
// full blob ids (a binary change hashes by them), no rename pairing, and every
// submodule pointer shown as such (diff.submodule=log, diff.ignoreSubmodules
// or `ignore = all` in .gitmodules hid a moved pointer: 0.116.0 review H2).
const DIFF_OPTS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--full-index',
  '--no-renames',
  '--ignore-submodules=none',
  '--submodule=short',
];
const LOG_OPTS = ['-p', ...DIFF_OPTS, '--no-merges', '--no-show-signature', '--format=commit %H'];
const EMPTY = () => ({
  defaultBranch: null,
  deletable: [],
  landed: [],
  goneUnmerged: [],
  skipped: null,
  truncated: 0,
  unjudged: 0,
});

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

function checkedOutBranches(git) {
  return new Set(
    (git('worktree', 'list', '--porcelain') || '')
      .split('\n')
      .filter(l => l.startsWith('branch refs/heads/'))
      .map(l => l.slice('branch refs/heads/'.length))
  );
}

// `git <args> | git patch-id --verbatim` as a Map commit → patch id, null when
// either fails (git before 2.39 has no --verbatim; the same-place check
// below needs 2.40). Run at the top level, so
// a `diff.relative` setting cannot cut the diff down to the cwd's subtree.
function verbatimPatchIds(top, args) {
  const opts = { encoding: 'utf8', maxBuffer: PATCH_MAX_BUFFER };
  const out = spawnSync('git', ['--no-replace-objects', '-C', top, ...args], opts);
  if (out.status !== 0) return null;
  const ids = spawnSync('git', ['-C', top, 'patch-id', '--verbatim'], { ...opts, input: out.stdout });
  if (ids.status !== 0) return null;
  const map = new Map();
  for (const line of ids.stdout.split('\n')) {
    const [id, commit] = line.split(' ');
    if (id && commit) map.set(commit, id);
  }
  return map;
}

// patch-id ignores line numbers, so the same hunk with the same context at
// another place in a file has the same id. A match counts only when it is the
// same change at the same place: a three-way merge of the branch's change onto
// the matching commit, with the change's own base as merge base, is clean and
// leaves that commit's tree as it is. An identical edit elsewhere conflicts or
// adds to the tree; a submodule pointer the diff hid shows in the tree. The
// first build applied the diff with `git apply`, which moves a hunk to any
// place its context matches (0.116.0 review H1). `--merge-base` needs git 2.40;
// when merge-tree fails (an older git, a missing object) the branch is
// `compare-failed`, not missing commits (round 2 M3).
//
// The merge runs in a throwaway bare repository that reads the repository's
// objects as an alternate, with no user, system or repository config and no
// attributes: merge=ours or merge=union from .git/info/attributes, a
// .gitattributes or the user's attributes file decided the result, and a
// configured merge driver ran, with its temp files in the repository's top
// directory (round 2 M1, M2). Its objects directory takes what merge-tree
// writes for a result that differs. It is removed after the run; one a run
// killed at the hook's timeout left is reaped by the next run after 10
// minutes (review M2), and by /claudemd-clean-residue.
const LANDED_TMP = /^claudemd-landed\.[A-Za-z0-9]{6}$/;
const LANDED_TMP_STALE_MS = 10 * MINUTE;

function reapStaleLandedTmp(root, now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!LANDED_TMP.test(name)) continue;
    const full = path.join(root, name);
    try {
      const st = fs.lstatSync(full);
      if (st.isDirectory() && st.uid === process.getuid() && now - st.mtimeMs > LANDED_TMP_STALE_MS)
        fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // another run removed it first
    }
  }
}

class CompareFailed extends Error {}

function makeInPlace(top) {
  const git = gitIn(top);
  const objects = git('rev-parse', '--path-format=absolute', '--git-path', 'objects');
  const format = git('rev-parse', '--show-object-format');
  let tmp = null;
  let env = null;
  // true once the throwaway repository is there, false when it could not be made.
  let ready = null;
  const setup = () => {
    reapStaleLandedTmp(os.tmpdir());
    // An empty template directory: no hooks, no info/ files. With no temp
    // directory (TMPDIR names one that is not there, a full disk) the branch is
    // not compared and the run goes on; the throw lost the whole list (round 4).
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-landed.'));
      fs.mkdirSync(path.join(tmp, 'template'));
    } catch {
      return false;
    }
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const base = {
      ...clean,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_ATTR_NOSYSTEM: '1',
    };
    const repo = path.join(tmp, 'repo.git');
    const init = spawnSync(
      'git',
      ['init', '-q', '--bare', `--template=${path.join(tmp, 'template')}`, `--object-format=${format}`, repo],
      { encoding: 'utf8', env: base }
    );
    env = { ...base, GIT_DIR: repo, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
    return init.status === 0;
  };
  // -c core.attributesFile: with no global config, git still reads
  // $XDG_CONFIG_HOME/git/attributes (or ~/.config/git/attributes).
  const run = args =>
    spawnSync('git', ['-c', 'core.attributesFile=/dev/null', ...args], { encoding: 'utf8', env, cwd: tmp });
  // [from, to] is the branch's change; onto the matching commit. Throws
  // CompareFailed when git cannot tell (exit status above 1).
  const inPlace = (from, to, onto) => {
    ready ??= Boolean(objects && format) && setup();
    if (!ready) throw new CompareFailed();
    const merged = run(['merge-tree', '--write-tree', '--no-messages', `--merge-base=${from}`, onto, to]);
    if (merged.status === 1) return false; // conflicts
    if (merged.status !== 0) throw new CompareFailed();
    const tree = run(['rev-parse', '--verify', '--quiet', `${onto}^{tree}`]);
    if (tree.status !== 0) throw new CompareFailed();
    return merged.stdout.split('\n')[0] === tree.stdout.trim();
  };
  const done = () => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { inPlace, done };
}

// A partial clone lacks blobs, and diffing would fetch them from the remote,
// from inside a hook (review M3): such a repository is not judged. A promisor
// remote is any boolean true (`yes`, `on`, `1` too); git 2.53 records a
// partial clone with remote.<name>.promisor alone.
function isPartialClone(git) {
  if (git('config', '--get', 'extensions.partialclone')) return true;
  return /\strue$/m.test(git('config', '--type=bool', '--get-regexp', '^remote\\..*\\.promisor$') || '');
}

// Each sha → { how: 'on-main' | 'per-commit' | 'squash' } when its work is on
// defaultRef (with `commits`, how many were matched, or `via`, the commit equal
// to the whole change), else { reason, missing } (the commits with no copy).
function judgeLanded(git, top, defaultRef, shas) {
  const verdicts = new Map();
  // origin/HEAD can name a branch with no local copy; merge-base then failed
  // for every branch, which read as unrelated history (round 4).
  if (git('rev-parse', '--verify', '--quiet', defaultRef) === null) {
    for (const sha of shas) verdicts.set(sha, { reason: 'no-default-branch', missing: [] });
    return verdicts;
  }
  // A graft (.git/info/grafts, or the file GIT_GRAFT_FILE names) gives commits
  // other parents in every walk: one on the default branch's side made a
  // branch commit its ancestor while no tree there held its change, and the
  // branch read as landed (round 4 L1). Such a repository is not judged; with
  // no path for the file the branch is not compared. A git before 2.31 prints
  // the --path-format it does not know back as its first line, then the path
  // (absolute from a linked worktree), exit 0 (review H1): only output that
  // is an absolute path from its first character is an answer, never a line
  // taken from it.
  const out = git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts');
  const grafts = out && path.isAbsolute(out) ? out : null;
  if (grafts === null || fs.existsSync(grafts)) {
    for (const sha of shas) verdicts.set(sha, { reason: grafts ? 'grafts' : 'compare-failed', missing: [] });
    return verdicts;
  }
  const open = [];
  const partial = isPartialClone(git);
  let shallow = null;
  for (const sha of shas) {
    if (git('merge-base', '--is-ancestor', sha, defaultRef) !== null) {
      verdicts.set(sha, { how: 'on-main' });
      continue;
    }
    if (partial) {
      verdicts.set(sha, { reason: 'partial-clone', missing: [] });
      continue;
    }
    const base = git('merge-base', sha, defaultRef);
    if (!base) {
      // A shallow clone can stop before the fork point.
      shallow ??= git('rev-parse', '--is-shallow-repository') === 'true';
      verdicts.set(sha, { reason: shallow ? 'shallow' : 'unrelated', missing: [] });
      continue;
    }
    const own = (git('rev-list', '--parents', `${defaultRef}..${sha}`) || '')
      .split('\n')
      .filter(Boolean)
      .map(l => l.split(' '));
    // A merge commit can carry its own edits, which no patch id covers.
    if (own.some(p => p.length > 2)) {
      verdicts.set(sha, { reason: 'merge-commits', missing: [] });
      continue;
    }
    const after = (git('rev-list', `--max-count=${MAIN_WINDOW + 1}`, `${base}..${defaultRef}`) || '')
      .split('\n')
      .filter(Boolean);
    if (after.length > MAIN_WINDOW) {
      verdicts.set(sha, { reason: 'too-far', missing: [] });
      continue;
    }
    open.push({ sha, base, commits: own.map(p => p[0]), parents: new Map(own), after: new Set(after) });
  }
  if (open.length === 0) return verdicts;
  // One `git log -p` of the default branch covers every fork point; each
  // branch then counts only the commits after its own.
  const bases = [...new Set(open.map(o => o.base))];
  const oldest = bases.length === 1 ? bases[0] : git('merge-base', '--octopus', ...bases);
  const main =
    oldest &&
    verbatimPatchIds(top, ['log', ...LOG_OPTS, `--max-count=${MAIN_WINDOW}`, `${oldest}..${defaultRef}`]);
  const { inPlace, done } = makeInPlace(top);
  try {
    judgeOpen(open, main, top, defaultRef, inPlace, verdicts);
  } finally {
    done();
  }
  return verdicts;
}

function judgeOpen(open, main, top, defaultRef, inPlace, verdicts) {
  for (const o of open) {
    const mine = main && verbatimPatchIds(top, ['log', ...LOG_OPTS, `${defaultRef}..${o.sha}`]);
    if (!mine) {
      verdicts.set(o.sha, { reason: 'patch-id-failed', missing: [] });
      continue;
    }
    // patch id → the commits after the fork point that carry it, oldest first.
    const byId = new Map();
    for (const [c, id] of [...main].reverse()) if (o.after.has(c)) byId.set(id, [...(byId.get(id) || []), c]);
    try {
      verdicts.set(o.sha, matchBranch(o, mine, byId, top, defaultRef, inPlace));
    } catch (e) {
      if (!(e instanceof CompareFailed)) throw e;
      verdicts.set(o.sha, { reason: 'compare-failed', missing: [] });
    }
  }
}

function matchBranch(o, mine, byId, top, defaultRef, inPlace) {
  // Each main commit stands for one branch commit, oldest first: a branch that
  // adds a line, removes it and adds it again has two adds, and one copy on
  // main stands for the first only (round 2 H1). An empty commit has no patch
  // id, so it counts as missing; so does a match whose change sits at another
  // place. The change is the commit's diff from the parent the walk gave it,
  // the one its patch id hashed: `${c}^` in the throwaway repository, which
  // has no grafts, named the real parent, and of a commit grafted onto the
  // fork point only its own change was checked (round 3 H1).
  const used = new Set();
  const copied = new Set();
  for (const c of [...o.commits].reverse()) {
    const m = (byId.get(mine.get(c)) || []).find(m => !used.has(m) && inPlace(o.parents.get(c), c, m));
    if (m) {
      used.add(m);
      copied.add(c);
    }
  }
  const missing = o.commits.filter(c => !copied.has(c));
  if (missing.length === 0) return { how: 'per-commit', commits: o.commits.length };
  // A branch whose tip has the tree of one of its earlier commits (it took
  // something out and put it back) has that commit's change as its whole
  // change, so a copy of that commit would read as a squash of the branch
  // (round 2 H1). Such a branch is not judged a squash.
  const trees = (
    gitIn(top)('rev-list', '--no-commit-header', '--format=%T', `${defaultRef}..${o.sha}`) || ''
  ).split('\n');
  if (trees.indexOf(trees[0], 1) > 0) return { reason: 'not-on-default', missing };
  const whole = verbatimPatchIds(top, ['diff', ...DIFF_OPTS, o.base, o.sha]);
  const wholeId = whole && [...whole.values()][0];
  const via = wholeId && (byId.get(wholeId) || []).find(m => inPlace(o.base, o.sha, m));
  return via ? { how: 'squash', via } : { reason: 'not-on-default', missing };
}

export function classifyBranches({ cwd = process.cwd() } = {}) {
  const git = gitIn(cwd);
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') return EMPTY();
  const defaultBranch = defaultBranchOf(git);
  if (!defaultBranch) return EMPTY();
  if (operationInProgress(git)) return { ...EMPTY(), defaultBranch, skipped: 'rebase-or-bisect-in-progress' };
  // A ref that does not exist makes merge-base fail, which reads as "not an ancestor".
  const isAncestor = (sha, ref) => git('merge-base', '--is-ancestor', sha, ref) !== null;
  const defaultRef = `refs/heads/${defaultBranch}`;
  // With the default branch checked out, "on HEAD" is the question already
  // answered; asking it again doubled the merge-base spawns (200 candidates on
  // Linux, 2026-10-21: 1.5-1.7 s asked twice, 0.5-0.7 s with this).
  const defaultSha = git('rev-parse', '--verify', '--quiet', defaultRef);
  const headIsDefault = defaultSha !== null && git('rev-parse', '--verify', '--quiet', 'HEAD') === defaultSha;
  const checkedOut = checkedOutBranches(git);
  const candidates = (
    git(
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(upstream:track)%09%(symref)%09%(upstream)',
      'refs/heads'
    ) || ''
  )
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [ref, sha, track, symref, upstream] = l.split('\t');
      return {
        name: ref.slice('refs/heads/'.length),
        sha,
        gone: track === '[gone]',
        symref: Boolean(symref),
        upstream,
      };
    })
    .filter(b => !b.symref)
    .filter(b => b.name !== defaultBranch && !checkedOut.has(b.name))
    .filter(b => b.gone || b.name.startsWith('worktree-agent-'));
  // The first MAX_CANDIDATES are examined; `truncated` counts the rest, so a
  // short list is not read as a complete one.
  const refs = candidates.slice(0, MAX_CANDIDATES);

  const deletable = [];
  const toJudge = [];
  for (const b of refs) {
    if (isAncestor(b.sha, defaultRef)) {
      // What `git branch -d` compares with: the upstream when it resolves (a
      // [gone] one does not), else HEAD of the checkout it runs in.
      const reference = b.upstream && !b.gone ? b.upstream : 'HEAD';
      if ((reference === 'HEAD' && headIsDefault) || isAncestor(b.sha, reference))
        deletable.push({ name: b.name, sha: b.sha, why: b.gone ? 'gone' : 'worktree-agent' });
    } else if (!(b.gone && isAncestor(b.sha, `refs/remotes/origin/${defaultBranch}`))) {
      toJudge.push(b);
    }
  }
  const judged = toJudge.slice(0, MAX_JUDGED);
  const top = judged.length > 0 ? git('rev-parse', '--show-toplevel') : null;
  const verdicts = top
    ? judgeLanded(
        git,
        top,
        defaultRef,
        judged.map(b => b.sha)
      )
    : new Map();
  const landed = [];
  const goneUnmerged = [];
  for (const b of toJudge) {
    const v = verdicts.get(b.sha);
    if (v?.how) landed.push({ name: b.name, sha: b.sha, why: b.gone ? 'gone' : 'worktree-agent', ...v });
    else if (b.gone) goneUnmerged.push({ name: b.name, sha: b.sha });
  }
  return {
    defaultBranch,
    deletable,
    landed,
    goneUnmerged,
    skipped: null,
    truncated: candidates.length - refs.length,
    unjudged: toJudge.length - judged.length,
  };
}

// The words of a shell command, cut into simple commands at ; & | ( ) and
// newlines outside quotes. Quotes are removed; a word the shell would expand
// ($, a backtick, a glob or brace character, a leading ~, an unclosed quote)
// is marked `dynamic`, since its value is not in the text. A comment, a
// redirection's operator and target, and a here-doc delimiter are not words
// (review M1: `git branch -d feat  # release` judged `release`).
function shellSegments(text) {
  const segments = [];
  let words = [];
  let cur = null;
  let redirectTarget = false;
  const word = () => (cur ??= { text: '', dynamic: false });
  const endWord = () => {
    if (cur && redirectTarget) redirectTarget = false;
    else if (cur) words.push(cur);
    cur = null;
  };
  const endSegment = () => {
    endWord();
    redirectTarget = false;
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      const w = word();
      const j = text.indexOf("'", i + 1);
      if (j < 0) {
        w.text += text.slice(i + 1);
        w.dynamic = true;
        break;
      }
      w.text += text.slice(i + 1, j);
      i = j;
    } else if (ch === '"') {
      const w = word();
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && '$`"\\\n'.includes(text[j + 1] ?? '')) j++;
        else if (text[j] === '$' || text[j] === '`') w.dynamic = true;
        w.text += text[j];
      }
      if (j >= text.length) w.dynamic = true;
      i = j;
    } else if (ch === '\\') {
      if (text[i + 1] === '\n') i++;
      else if (i + 1 < text.length) word().text += text[++i];
    } else if (ch === ' ' || ch === '\t') {
      endWord();
    } else if (ch === '#' && cur === null) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
    } else if (ch === '<' || ch === '>') {
      // A file-descriptor number right before the operator is part of it.
      if (cur && !cur.dynamic && /^[0-9]+$/.test(cur.text)) cur = null;
      else endWord();
      while ('<>&|'.includes(text[i + 1] ?? '') && text[i + 1] !== undefined) i++;
      redirectTarget = true;
    } else if ('\n;&|()'.includes(ch)) {
      endSegment();
    } else {
      const w = word();
      if ('$`*?[{'.includes(ch) || (ch === '~' && w.text === '')) w.dynamic = true;
      w.text += ch;
    }
  }
  endSegment();
  return segments;
}

// git's global options that do not change which repository a command acts on.
const GIT_FLAG_OPTS = new Set(['--no-pager', '-P', '--no-optional-locks', '--no-replace-objects']);

// The `git [-C DIR] branch -d|--delete NAME…` commands in a shell command, as
// [{ dir, names }] (dir: the -C argument, or null). A segment that forces
// (-D, -f, --force), names remote branches (-r) or points git elsewhere
// (--git-dir, --work-tree, any other global option) yields nothing; a name
// the shell would expand is dropped.
export function branchDeleteTargets(command) {
  const out = [];
  // After a `cd`, `pushd` or `popd`, a git without an absolute -C acts in a
  // directory the hook does not know (review text L4).
  let moved = false;
  for (const words of shellSegments(String(command ?? ''))) {
    let i = 0;
    let ok = true;
    // An assignment before the command; a GIT_* one (GIT_DIR, GIT_WORK_TREE, …)
    // can point git at another repository.
    for (; i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text); i++)
      if (words[i].text.startsWith('GIT_')) ok = false;
    const git = words[i];
    // `command cd` and `builtin cd` too (round 2 L3).
    const run = ['command', 'builtin'].includes(git?.text) ? words[i + 1] : git;
    if (['cd', 'pushd', 'popd'].includes(run?.text)) moved = true;
    if (!ok || !git || git.dynamic || (git.text !== 'git' && !git.text.endsWith('/git'))) continue;
    let dir = null;
    for (i++; ok && i < words.length && words[i].text.startsWith('-'); i++) {
      const w = words[i].text;
      if (w === '-C') {
        const d = words[++i];
        if (!d || d.dynamic) ok = false;
        else dir = dir === null || path.isAbsolute(d.text) ? d.text : path.join(dir, d.text);
      } else if (w === '-c') i++;
      else if (!GIT_FLAG_OPTS.has(w)) ok = false;
    }
    if (!ok || words[i]?.text !== 'branch' || (moved && !(dir !== null && path.isAbsolute(dir)))) continue;
    let del = false;
    let refuse = false;
    let opts = true;
    const names = [];
    for (i++; i < words.length; i++) {
      const { text, dynamic } = words[i];
      if (opts && text === '--') opts = false;
      else if (opts && text.startsWith('--')) {
        if (text === '--delete') del = true;
        else if (text !== '--quiet') refuse = true;
      } else if (opts && text.length > 1 && text.startsWith('-')) {
        if (/^-[dq]+$/.test(text)) del ||= text.includes('d');
        else refuse = true;
      } else if (!dynamic) names.push(text);
    }
    if (del && !refuse && names.length > 0) out.push({ dir, names });
  }
  return out;
}

// The branches a `git branch -d` command left in place (refused, not yet
// run, or named twice), judged: `landed` on the default branch, or `kept`
// with up to 3 of the commits that have no copy there (missingCount: all of them).
export function refusedBranches({ cwd = process.cwd(), command = '' } = {}) {
  const landed = [];
  const kept = [];
  let skipped = null;
  // At most MAX_JUDGED names per command, as in the list (review text L6).
  let budget = MAX_JUDGED;
  let unjudged = 0;
  const seen = new Set();
  for (const t of branchDeleteTargets(command)) {
    const repo = t.dir === null ? cwd : path.resolve(cwd, t.dir);
    const git = gitIn(repo);
    if (git('rev-parse', '--is-inside-work-tree') !== 'true') continue;
    const defaultBranch = defaultBranchOf(git);
    if (!defaultBranch) continue;
    if (operationInProgress(git)) {
      skipped = 'rebase-or-bisect-in-progress';
      continue;
    }
    const checkedOut = checkedOutBranches(git);
    // Only an existing branch's own name: `feat^0` resolves as a revision but
    // names no branch (review L3).
    const branches = new Map(
      (git('for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', 'refs/heads') || '')
        .split('\n')
        .filter(Boolean)
        .map(l => l.split('\t'))
        .filter(([, , symref]) => !symref)
        .map(([ref, sha]) => [ref.slice('refs/heads/'.length), sha])
    );
    const named = [];
    for (const name of t.names) {
      const key = `${repo}\0${name}`;
      if (seen.has(key) || name === defaultBranch || checkedOut.has(name) || !branches.has(name)) continue;
      seen.add(key);
      if (budget === 0) {
        unjudged++;
        continue;
      }
      budget--;
      named.push({ name, sha: branches.get(name) });
    }
    if (named.length === 0) continue;
    const top = git('rev-parse', '--show-toplevel');
    const verdicts = judgeLanded(
      git,
      top,
      `refs/heads/${defaultBranch}`,
      named.map(b => b.sha)
    );
    for (const b of named) {
      const v = verdicts.get(b.sha);
      if (v.how) {
        landed.push({ repo, name: b.name, sha: b.sha, onto: defaultBranch, ...v });
        continue;
      }
      const shown = v.missing.slice(0, 3);
      const unmatched = shown.length
        ? (git('log', '--no-walk=unsorted', '--format=%h%x09%s', ...shown) || '')
            .split('\n')
            .filter(Boolean)
            .map(l => ({ sha: l.split('\t')[0], subject: l.slice(l.indexOf('\t') + 1) }))
        : [];
      kept.push({
        repo,
        name: b.name,
        sha: b.sha,
        onto: defaultBranch,
        reason: v.reason,
        unmatched,
        missingCount: v.missing.length,
      });
    }
  }
  return { landed, kept, skipped, unjudged };
}

if (invokedAsMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const [sub, ...rest] = argv;
  if (sub === 'tmp') {
    const p = parseStrictOrExit(rest, { bools: ['--apply'], values: ['--root', '--min-age-minutes'] });
    const opts = { apply: p.bools.has('--apply') };
    if (p.values['--root'] !== undefined) {
      // A root that is not a directory scans nothing, and an empty report with
      // exit 0 reads as "nothing to reclaim".
      const r = p.values['--root'];
      if (!r || !fs.statSync(r, { throwIfNoEntry: false })?.isDirectory()) {
        console.error(`--root must be an existing directory (got '${r}').`);
        process.exit(2);
      }
      opts.roots = [r];
    }
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
    const result = sweepVitestTmp(opts);
    process.stdout.write(JSON.stringify(result) + '\n');
    // A target --apply could not delete is only an entry in `errors`; exit 0
    // read as "reclaimed" (131c). exitCode, not exit(): stdout drains first.
    if (result.errors.length > 0) process.exitCode = 3;
  } else if (sub === 'branches') {
    const p = parseStrictOrExit(rest, { values: ['--cwd'] });
    process.stdout.write(
      JSON.stringify(classifyBranches({ cwd: p.values['--cwd'] || process.cwd() })) + '\n'
    );
  } else if (sub === 'refused') {
    const p = parseStrictOrExit(rest, { values: ['--cwd'] });
    // On stdin, not argv: the command can be a long here-doc.
    const command = fs.readFileSync(0, 'utf8');
    process.stdout.write(
      JSON.stringify(refusedBranches({ cwd: p.values['--cwd'] || process.cwd(), command })) + '\n'
    );
  } else {
    console.error(`Unknown subcommand: '${sub ?? ''}'. Expected 'tmp', 'branches' or 'refused'.`);
    process.exit(2);
  }
}
