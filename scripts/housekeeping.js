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
          under \`landed\` when every one of its commits has a commit on the
          default branch, after the fork point, with the same \`git patch-id
          --verbatim\` (whitespace kept, binary files compared by blob id), or
          its whole change equals one such commit; \`git branch -d\` refuses
          these, so deleting them takes \`git branch -D\`. Judges at most 20
          such candidates, counting the rest in \`unjudged\`, and none whose
          fork point is more than 500 commits behind. A gone one that is not
          landed is listed under \`goneUnmerged\`.
refused   Judge the branches a \`git branch -d\` command left in place: the
          names in its \`git [-C DIR] branch -d|--delete\` segments (read from
          stdin) that still exist, are not the default branch, a worktree
          checkout or a symbolic ref. Each is \`landed\` (as above, with
          \`how\`: \`per-commit\` and the number of \`commits\`, \`squash\` and
          the commit it equals, \`via\`, or \`on-main\` when its tip is on the
          default branch and -d compared it with something else) or
          \`kept\`, with up to 3 of the commits that have no copy on the
          default branch (\`missingCount\` counts them all). Never deletes.

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
// forever. Such a branch is landed when every one of its commits has a commit
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
// Measured on the 29 branches users force-deleted in one week after -d
// refused them: 27 landed, the other 2 had a commit edited on the way in.
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

function gitIn(cwd) {
  return (...args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
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
// full blob ids (a binary change hashes by them), no rename pairing.
const DIFF_OPTS = ['--no-color', '--no-ext-diff', '--no-textconv', '--full-index', '--no-renames'];
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
// either fails (git before 2.39 has no --verbatim). Run at the top level, so
// a `diff.relative` setting cannot cut the diff down to the cwd's subtree.
function verbatimPatchIds(top, args) {
  const opts = { encoding: 'utf8', maxBuffer: PATCH_MAX_BUFFER };
  const out = spawnSync('git', ['-C', top, ...args], opts);
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

// Each sha → { how: 'on-main' | 'per-commit' | 'squash' } when its work is on
// defaultRef (with `commits`, how many were matched, or `via`, the commit equal
// to the whole change), else { reason, missing } (the commits with no copy).
function judgeLanded(git, top, defaultRef, shas) {
  const verdicts = new Map();
  const open = [];
  for (const sha of shas) {
    if (git('merge-base', '--is-ancestor', sha, defaultRef) !== null) {
      verdicts.set(sha, { how: 'on-main' });
      continue;
    }
    const base = git('merge-base', sha, defaultRef);
    if (!base) {
      verdicts.set(sha, { reason: 'unrelated', missing: [] });
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
    open.push({ sha, base, commits: own.map(p => p[0]), after: new Set(after) });
  }
  if (open.length === 0) return verdicts;
  // One `git log -p` of the default branch covers every fork point; each
  // branch then counts only the commits after its own.
  const bases = [...new Set(open.map(o => o.base))];
  const oldest = bases.length === 1 ? bases[0] : git('merge-base', '--octopus', ...bases);
  const main =
    oldest &&
    verbatimPatchIds(top, ['log', ...LOG_OPTS, `--max-count=${MAIN_WINDOW}`, `${oldest}..${defaultRef}`]);
  for (const o of open) {
    const mine = main && verbatimPatchIds(top, ['log', ...LOG_OPTS, `${defaultRef}..${o.sha}`]);
    if (!mine) {
      verdicts.set(o.sha, { reason: 'patch-id-failed', missing: [] });
      continue;
    }
    const onMain = new Set([...main].filter(([c]) => o.after.has(c)).map(([, id]) => id));
    // An empty commit has no patch id, so it counts as missing.
    const missing = o.commits.filter(c => !onMain.has(mine.get(c)));
    if (missing.length === 0) {
      verdicts.set(o.sha, { how: 'per-commit', commits: o.commits.length });
      continue;
    }
    const whole = verbatimPatchIds(top, ['diff', ...DIFF_OPTS, o.base, o.sha]);
    const wholeId = whole && [...whole.values()][0];
    const via = wholeId && [...main].find(([c, id]) => id === wholeId && o.after.has(c))?.[0];
    if (via) verdicts.set(o.sha, { how: 'squash', via });
    else verdicts.set(o.sha, { reason: 'not-on-default', missing });
  }
  return verdicts;
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
// is marked `dynamic`, since its value is not in the text.
function shellSegments(text) {
  const segments = [];
  let words = [];
  let cur = null;
  const word = () => (cur ??= { text: '', dynamic: false });
  const endWord = () => {
    if (cur) words.push(cur);
    cur = null;
  };
  const endSegment = () => {
    endWord();
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
  for (const words of shellSegments(String(command ?? ''))) {
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].text)) i++;
    const git = words[i];
    if (!git || git.dynamic || (git.text !== 'git' && !git.text.endsWith('/git'))) continue;
    let dir = null;
    let ok = true;
    for (i++; ok && i < words.length && words[i].text.startsWith('-'); i++) {
      const w = words[i].text;
      if (w === '-C') {
        const d = words[++i];
        if (!d || d.dynamic) ok = false;
        else dir = dir === null || path.isAbsolute(d.text) ? d.text : path.join(dir, d.text);
      } else if (w === '-c') i++;
      else if (!GIT_FLAG_OPTS.has(w)) ok = false;
    }
    if (!ok || words[i]?.text !== 'branch') continue;
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
    const named = [];
    for (const name of t.names) {
      const key = `${repo}\0${name}`;
      if (seen.has(key) || name === defaultBranch || checkedOut.has(name)) continue;
      seen.add(key);
      if (git('symbolic-ref', '--quiet', `refs/heads/${name}`) !== null) continue;
      const sha = git('rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`);
      if (sha) named.push({ name, sha });
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
  return { landed, kept, skipped };
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
