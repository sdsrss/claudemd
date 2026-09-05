import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';
import { stateDir } from './lib/paths.js';

const USAGE = `Usage: node scripts/clean-residue.js [--apply] [--age-days=N] [--retention-days=N]

Clean leftover claudemd-sync-* / claudemd-memtags-hay-* sentinels and historical
claudemd-(mockgh|work).*
sandbox dirs from $TMPDIR, stale tool-exhaust from ~/.claude/tmp per spec
§EXT §7-EXT retention (mtime > TMP_RETENTION_DAYS, default 7), and orphaned
per-session sentinels from ~/.claude/.claudemd-state. Default is dry-run.

Also COUNTS and sizes — never deletes — $TMPDIR entries left by a bare
\`mktemp\`/\`mktemp -d\` (the tmp.XXXXXXXXXX shape). Nothing can prove those were
created by claudemd, so they are reported for a human to judge;
tests/lib/mktemp-template.sh keeps the repo from adding more.

Options:
  --apply             Opt into deletion (without it, prints what would be deleted).
  --age-days=N        $TMPDIR stale threshold in days (non-negative, default 1).
  --retention-days=N  ~/.claude/tmp AND ~/.claude/.claudemd-state retention in
                      days (at least 1). Resolution:
                      this flag > TMP_RETENTION_DAYS: in ./CLAUDE.md > 7.
  --help, -h          Print this message and exit.

Never deleted, whatever the window: any entry that contains this process's own
working directory or its $TMPDIR (reported under \`protected\`). Under the Claude
Code sandbox $TMPDIR IS a child of ~/.claude/tmp/claude-<uid>, so a fixture
placed there sits inside the retention scope's target tree.

State-dir scope: only ext-read-*, vocab-scan-*, failopen-*, mem-coverage-*,
session-start-<sid>.ref, tmp-baseline-<sid>.txt and session-summary-<sid>.lastrun
past the retention window.
Allowlist-by-pattern — live singleton state in the same directory (including
the sid-less session-start.ref and tmp-baseline.txt) is never deleted, however
old. This list and STATE_EPHEMERAL below are joined by
tests/scripts/subject-set-drift.test.js — before that join existed, this text
named four classes while the array held six, for the two releases after v0.67.0
added the last two (audit-2026-08-22 条目 7).

Env: CLAUDEMD_CLAUDE_TMP_DIR overrides the ~/.claude/tmp root (test seam).
     CLAUDEMD_STATE_DIR overrides the ~/.claude/.claudemd-state root (test seam).

Wrapped by /claudemd-clean-residue.

Output: JSON. \`remaining\` = targets still on disk after --apply (always 0 on a
dry run); \`unreapable\` names each one with the errno that stopped it (EACCES on
a child directory with no write bit, EPERM on an entry owned by another user),
and the same list goes to stderr. \`stateDir.dir\` echoes the directory actually
scanned, so a run under CLAUDEMD_STATE_DIR can be confirmed rather than assumed.

Exit codes: 0 success | 1 validation error | 2 argv-shape error |
3 --apply left targets behind (see \`remaining\` and \`unreapable\`).`;

// Anchored regexes — names MUST start with the prefix. Defends against
// future fnmatch-style globs that would falsely match `not-claudemd-sync-*`.
// `claudemd-memtags-hay-*` joined the set for audit-2026-08-22 P1-5:
// hooks/lib/memory-tags.sh spills an oversize haystack there and now traps to
// remove it, but a SIGKILL at the hooks.json timeout still strands one, and
// before this it matched no reaper at all. The join back to that template is
// asserted in tests/scripts/clean-residue.test.js, so a rename there fails here
// rather than silently orphaning the files again.
const SENTINEL_PATTERN = /^claudemd-(sync-|memtags-hay-)/;
const SANDBOX_PATTERN = /^claudemd-(mockgh|work)\./;

// The default `mktemp` / `mktemp -d` name shape, EXACTLY: `tmp.` plus ten
// alphanumerics and nothing else. Not a `tmp.*` glob — that would also swallow
// `tmp.backup`, `tmp.lock`, and anything else a person chose to name that way.
//
// This class is UNOWNED: nothing here can prove claudemd created it. It is
// COUNTED AND SIZED on every run and NEVER deleted. It exists because the
// recycler's `$TMPDIR` pass matched only claudemd- prefixes, so the largest
// residue class this project's own tests produced (2.6 GB across 524
// directories, 150-250 new ones a day, measured 2026-09-02, audit R11-38) never
// appeared in its report. tests/lib/mktemp-template.sh stops the repo making
// more; this makes what is already on disk visible.
//
// Why not a delete flag: the 0.72.0 pre-tag review showed that where those
// entries actually lived — `~/.claude/tmp/claude-<uid>`, which the sandbox
// hands out as $TMPDIR — cleanClaudeTmp() already reaps every depth-1 child by
// age, so a delete flag added no reach there, and in a shared /tmp it would
// delete other programs' live work (feedback_seam_widening_widens_rm_targets).
const UNOWNED_MKTEMP_PATTERN = /^tmp\.[A-Za-z0-9]{10}$/;

// Every early return carries the same three keys as the full path. The 0.72.0
// pre-tag review found the two below returning only two after `unowned` was
// added: a missing or unreadable $TMPDIR became a TypeError in clean() instead
// of an empty report (HIGH-1).
const EMPTY_SCAN = () => ({ sentinels: [], sandboxes: [], unowned: [] });

export function scan({ tmpDir = os.tmpdir(), now = Date.now() } = {}) {
  if (!fs.existsSync(tmpDir)) return EMPTY_SCAN();
  let entries;
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return EMPTY_SCAN();
  }
  const sentinels = [];
  const sandboxes = [];
  const unowned = [];
  for (const entry of entries) {
    const full = path.join(tmpDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    // Clamp at 0: macOS APFS can return mtimeMs marginally above Date.now()
    // for files just written in the same turn (sub-ms timing skew between
    // fs.writeFileSync and the Date.now() read here). A file can't be
    // younger than itself; negative ageDays would falsely exclude it under
    // ageDaysMin=0. v0.6.2 macOS CI red root cause.
    const ageDays = Math.max(0, (now - stat.mtimeMs) / 86400000);
    if (SENTINEL_PATTERN.test(entry.name) && entry.isFile()) {
      sentinels.push({ path: full, ageDays });
    } else if (SANDBOX_PATTERN.test(entry.name) && entry.isDirectory()) {
      sandboxes.push({ path: full, ageDays });
    } else if (UNOWNED_MKTEMP_PATTERN.test(entry.name)) {
      // Files as well as directories: `mktemp` without -d yields the same name
      // shape, and the suites that leaked used both forms.
      unowned.push({ path: full, ageDays, isDir: entry.isDirectory() });
    }
  }
  return { sentinels, sandboxes, unowned };
}

// Paths this process must never delete out from under itself: its working
// directory and its $TMPDIR, resolved through symlinks. A target that CONTAINS
// either is skipped and reported, not deleted. This is the shape of the
// 2026-09-02 incident: the reviewer's fixture and cwd were both under
// `~/.claude/tmp/claude-1000` (the sandbox's $TMPDIR), and a zero-day
// `--apply` removed the tree they lived in along with every other session's
// scratchpad — and the sandbox bridge sockets inside them. Env seams cannot
// prevent that (the un-overridden scope still points at the real root); the
// deleter has to recognise the branch it is sitting on.
function selfPaths() {
  const out = [];
  for (const get of [() => process.cwd(), () => os.tmpdir()]) {
    try {
      out.push(fs.realpathSync(get()));
    } catch {
      /* a vanished cwd protects nothing; the deleter has already lost it */
    }
  }
  return out;
}

function containsSelf(target, self = selfPaths()) {
  let real;
  try {
    real = fs.realpathSync(target);
  } catch {
    return false;
  }
  return self.some(s => s === real || s.startsWith(real + path.sep));
}

// Split a target list into what may be deleted and what must not. Shared by
// every directory-deleting pass so the guard cannot be present in one and
// absent in another.
function partitionProtected(targets) {
  const self = selfPaths();
  const allowed = [];
  const protectedTargets = [];
  for (const t of targets) (containsSelf(t.path, self) ? protectedTargets : allowed).push(t);
  return { allowed, protected: protectedTargets };
}

// Best-effort per entry, but the reason a delete failed is KEPT. The errno was
// swallowed here until 2026-09-04, when a real `--apply` run reported
// `remaining: 3` with no cause and finding it took a hand-written `fs.rmSync`
// probe: two entries were another plugin's stale HOME with a mode-0500 child
// (rm cannot unlink through a directory with no write bit) and one was
// root-owned. A permission bit does not age out, so those entries come back as
// targets on every future run — a number with no next action, forever. Same
// shape as R11-24 on the reading side: a pass that drops rows has to say which.
function rmEach(targets, opts) {
  let deleted = 0;
  const failures = [];
  for (const t of targets) {
    try {
      fs.rmSync(t.path, opts);
      deleted++;
    } catch (e) {
      failures.push({ path: t.path, code: e.code || e.name || 'UNKNOWN' });
    }
  }
  return { deleted, failures };
}

export function clean({ tmpDir = os.tmpdir(), apply = false, ageDaysMin = 1, now = Date.now() } = {}) {
  const { sentinels, sandboxes, unowned } = scan({ tmpDir, now });
  const { allowed: targets, protected: protectedTargets } = partitionProtected([
    ...sentinels.filter(s => s.ageDays >= ageDaysMin),
    ...sandboxes.filter(s => s.ageDays >= ageDaysMin),
  ]);
  // Counted, never deleted. The defect was that 2.6 GB was INVISIBLE; that is
  // fixed by reporting it. Sized over the whole class, so the number is the
  // cost of leaving it there, not the cost of a window nobody applies.
  const unownedReport = {
    scanned: unowned.length,
    bytes: unowned.reduce((n, u) => n + dirBytes(u.path), 0),
  };
  if (!apply) {
    return {
      dryRun: true,
      targets,
      protected: protectedTargets,
      deleted: 0,
      failures: [],
      unowned: unownedReport,
    };
  }
  const { deleted, failures } = rmEach(targets, { recursive: true, force: true });
  return { dryRun: false, targets, protected: protectedTargets, deleted, failures, unowned: unownedReport };
}

// Size of a residue entry, for the report only. Bounded and best-effort: a
// number that makes the cost legible is worth a walk, an exception during one is
// not worth failing the command over.
function dirBytes(p) {
  let total = 0;
  const walk = (abs, depth) => {
    if (depth > 12) return;
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      total += st.size;
      return;
    }
    if (!st.isDirectory()) return;
    let ents;
    try {
      ents = fs.readdirSync(abs);
    } catch {
      return;
    }
    for (const e of ents) walk(path.join(abs, e), depth + 1);
  };
  walk(p, 0);
  return total;
}

// --- ~/.claude/tmp retention (spec §EXT §7-EXT: "harness SHOULD purge mtime > 7d";
// this implements the AUTH'd command path — never runs without explicit /clean-residue). ---

// Per-UID dirs (claude-1000) churn constantly, so their own mtime is always fresh
// while stale sessions pile up INSIDE them. Never delete the shell; purge its
// depth-1 children instead.
const UID_DIR_PATTERN = /^claude-\d+$/;

export function scanClaudeTmp({ claudeTmpDir, now = Date.now() } = {}) {
  if (!claudeTmpDir || !fs.existsSync(claudeTmpDir)) return { candidates: [] };
  const candidates = [];
  const pushCandidate = (full, stat) => {
    // §8.V4 exemption: a dir carrying a .keep marker is deliberately retained WIP,
    // not tool-exhaust — skip it regardless of age.
    if (stat.isDirectory() && fs.existsSync(path.join(full, '.keep'))) return;
    const ageDays = Math.max(0, (now - stat.mtimeMs) / 86400000); // clamp: see scan()
    candidates.push({ path: full, ageDays });
  };
  let entries;
  try {
    entries = fs.readdirSync(claudeTmpDir, { withFileTypes: true });
  } catch {
    return { candidates: [] };
  }
  for (const entry of entries) {
    const full = path.join(claudeTmpDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (UID_DIR_PATTERN.test(entry.name) && stat.isDirectory()) {
      let children;
      try {
        children = fs.readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        const childFull = path.join(full, child.name);
        let childStat;
        try {
          childStat = fs.statSync(childFull);
        } catch {
          continue;
        }
        pushCandidate(childFull, childStat);
      }
    } else {
      pushCandidate(full, stat);
    }
  }
  return { candidates };
}

// Hard floor on the retention window, applied where the deletion happens and
// not only at the CLI. `~/.claude/tmp/claude-<uid>` holds the scratchpad of
// every LIVE session (and, under the sandbox, its bridge socket); its entries'
// mtimes are "now". A zero-day window is therefore not "clean everything", it
// is "kill every running session" — which is what happened on 2026-09-02
// (retention-days=0 --apply through an un-overridden scope). The CLI rejects
// values below this; the library clamps so that a caller passing 0 directly
// gets a one-day window rather than that outcome.
export const MIN_RETENTION_DAYS = 1;

// The window used when neither --retention-days nor the project's CLAUDE.md
// says otherwise. Exported because doctor.js has to judge its state-dir
// advisory against the SAME window this script would delete with; a second
// literal `7` over there is how the advisory and its own remedy drift apart.
export const DEFAULT_RETENTION_DAYS = 7;

export function cleanClaudeTmp({ claudeTmpDir, apply = false, retentionDays = 7, now = Date.now() } = {}) {
  const window = Math.max(MIN_RETENTION_DAYS, retentionDays);
  const { candidates } = scanClaudeTmp({ claudeTmpDir, now });
  const { allowed: targets, protected: protectedTargets } = partitionProtected(
    candidates.filter(c => c.ageDays >= window)
  );
  if (!apply) {
    return {
      dryRun: true,
      targets,
      protected: protectedTargets,
      deleted: 0,
      failures: [],
      retentionDays: window,
    };
  }
  const { deleted, failures } = rmEach(targets, { recursive: true, force: true });
  return { dryRun: false, targets, protected: protectedTargets, deleted, failures, retentionDays: window };
}

// --- ~/.claude/.claudemd-state orphan reaping (2026-07-28 audit H3) ---
//
// The plugin's own state dir was outside every cleaner's scope: this script had
// zero references to it, doctor.js had zero, and residue-audit.sh only ever
// looked at ~/.claude/tmp. Measured on the maintainer's machine: 39 orphans,
// oldest 79 days — 27 `ext-read-*` (reaped by session-end-check ONLY for its own
// session, so any crash / kill / abnormal exit leaks one; one of the 27 is residue
// from a test-hermeticity bug that was itself fixed but whose leftovers nothing
// could reach), 11 `mem-coverage-*` (the hook that wrote them was deleted in
// v0.23.12 and left no migration), and 1 `failopen-*` rate-limit marker.
//
// Deletion is ALLOWLIST-by-pattern, not "everything old". The dir also holds
// live singleton state (tmp-baseline.txt, session-start.ref, l2-task-counter,
// last-session-summary.json, bootstrap-failed.json, …) whose age says nothing
// about whether it is still in use. A pattern this list does not name is never
// touched, so a future state file is safe by default rather than by memory.
const STATE_EPHEMERAL = [
  // Per-session extended-read sentinel. Self-reaping is best-effort by design.
  { kind: 'ext-read', re: /^ext-read-.+\.ts$/ },
  // hook_record_failopen rate-limit markers — meaningful for 60s, then dead.
  { kind: 'failopen', re: /^failopen-.+\.ts$/ },
  // memory-coverage-scan was removed in v0.23.12; no producer exists in-tree.
  { kind: 'mem-coverage', re: /^mem-coverage-.+\.ts$/ },
  // Per-session transcript-vocab-scan content-hash cursor. Nothing reaps it at
  // all — strictly worse than ext-read-*, which at least self-reaps on a clean
  // exit. Missed by the first draft of this list because the hook builds its
  // path from `$VS_STATE_DIR`, so the extraction keyed on `$STATE_DIR` could
  // not see it: this list's own scope failing to cover its subject.
  { kind: 'vocab-scan', re: /^vocab-scan-.+\.last$/ },
  // Per-session sandbox-disposal window ref (2026-08-16 audit F5). The
  // sid-less legacy `session-start.ref` (no dash) stays OUT of this pattern —
  // it is live singleton state for sessions whose event carries no session_id.
  { kind: 'session-ref', re: /^session-start-.+\.ref$/ },
  // Per-session residue-audit baseline (2026-08-16 audit CONC-3); legacy
  // `tmp-baseline.txt` likewise excluded.
  { kind: 'tmp-baseline', re: /^tmp-baseline-.+\.txt$/ },
  // Per-session session-summary window ref (audit-2026-08-22 条目 6). The
  // sid-less `session-summary.lastrun` stays OUT for the same reason as the
  // other two: it is live state for sessions whose Stop event carries no
  // session_id.
  { kind: 'session-summary', re: /^session-summary-.+\.lastrun$/ },
];

export function scanStateDir({ stateDir, now = Date.now() } = {}) {
  if (!stateDir || !fs.existsSync(stateDir)) return { candidates: [] };
  let entries;
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    return { candidates: [] };
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = STATE_EPHEMERAL.find(p => p.re.test(entry.name));
    if (!match) continue;
    const full = path.join(stateDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    candidates.push({
      path: full,
      kind: match.kind,
      ageDays: Math.max(0, (now - stat.mtimeMs) / 86400000),
    });
  }
  return { candidates };
}

export function cleanStateDir({ stateDir, apply = false, retentionDays = 7, now = Date.now() } = {}) {
  // Same floor as cleanClaudeTmp: a session-start-<sid>.ref written today is a
  // live session's window ref, not an orphan. Files only, so the self-path
  // guard has nothing to protect here.
  const window = Math.max(MIN_RETENTION_DAYS, retentionDays);
  const { candidates } = scanStateDir({ stateDir, now });
  const targets = candidates.filter(c => c.ageDays >= window);
  // `scanned` rides along with `targets` so a caller that needs BOTH numbers
  // (doctor.js does) gets them from one scan and one filter, instead of
  // re-deriving the window on its own — the re-derivation is what let doctor
  // report a population this function would never touch.
  //
  // NOT named `candidates`, though that is what scanStateDir calls it: this
  // command's shipped JSON already spells `stateDir.candidates` and means the
  // REAPABLE count by it. Two opposite meanings for one word, a few lines
  // apart, is bait for the next maintainer — the pre-tag review of this release
  // showed the "obvious cleanup" (`candidates: cstate.candidates.length`)
  // passing 43/43, because nothing pinned that shipped key's semantics.
  if (!apply)
    return { dryRun: true, scanned: candidates, targets, deleted: 0, failures: [], retentionDays: window };
  const { deleted, failures } = rmEach(targets, { force: true });
  return { dryRun: false, scanned: candidates, targets, deleted, failures, retentionDays: window };
}

// TMP_RETENTION_DAYS: N in the invoking project's CLAUDE.md (spec §EXT §7-EXT
// override syntax). Malformed values warn to stderr and fall back to the default —
// a silently-ignored config knob is the flag-shape antipattern (see lib/argv.js).
export function readRetentionFromClaudeMd(cwd = process.cwd()) {
  const file = path.join(cwd, 'CLAUDE.md');
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = src.match(/^TMP_RETENTION_DAYS:[ \t]*(\S+)[ \t]*$/m);
  if (!m) return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(m[1])) {
    console.error(
      `TMP_RETENTION_DAYS in ${file} is not a non-negative number (got '${m[1]}'); using default.`
    );
    return null;
  }
  const days = Number(m[1]);
  // A cloned repository's CLAUDE.md must not be able to set a window that
  // deletes live sessions (MIN_RETENTION_DAYS above). Loud fallback, same as
  // the malformed case: a silently-clamped knob is still a silently-ignored one.
  if (days < MIN_RETENTION_DAYS) {
    console.error(
      `TMP_RETENTION_DAYS in ${file} is below the ${MIN_RETENTION_DAYS}-day floor (got '${m[1]}'); using default.`
    );
    return null;
  }
  return days;
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const parsed = parseStrictOrExit(process.argv.slice(2), {
    bools: ['--apply'],
    values: ['--age-days', '--retention-days'],
  });
  const apply = parsed.bools.has('--apply');
  const rawAge = parsed.values['--age-days'] ?? '1';
  const ageDaysMin = Number(rawAge);
  // String-shape guard (not parsePositiveInt — this flag allows 0 and fractional
  // days). Rejects '0x1e'/'1e2'/' 2 ' that `Number()` would silently coerce,
  // while keeping '0', '1', '0.5' valid.
  if (!/^[0-9]+(\.[0-9]+)?$/.test(String(rawAge).trim()) || !Number.isFinite(ageDaysMin) || ageDaysMin < 0) {
    console.error(`--age-days requires a non-negative number (got '${rawAge}').`);
    process.exit(1);
  }

  const rawRetention = parsed.values['--retention-days'];
  let retentionDays;
  if (rawRetention !== undefined) {
    retentionDays = Number(rawRetention);
    // Floor at MIN_RETENTION_DAYS, not 0: the window covers every live session's
    // scratchpad, and 0 is "delete them all" — rejected loudly rather than
    // clamped, so the caller learns the knob does not go there.
    if (
      !/^[0-9]+(\.[0-9]+)?$/.test(String(rawRetention).trim()) ||
      !Number.isFinite(retentionDays) ||
      retentionDays < MIN_RETENTION_DAYS
    ) {
      console.error(
        `--retention-days requires a number of at least ${MIN_RETENTION_DAYS} (got '${rawRetention}'): ` +
          `~/.claude/tmp holds live sessions' scratchpads and a shorter window deletes them.`
      );
      process.exit(1);
    }
  } else {
    retentionDays = readRetentionFromClaudeMd() ?? DEFAULT_RETENTION_DAYS;
  }
  const claudeTmpDir = process.env.CLAUDEMD_CLAUDE_TMP_DIR || path.join(os.homedir(), '.claude', 'tmp');

  // Test seam mirrors CLAUDEMD_CLAUDE_TMP_DIR above — §8.V3 forbids driving a
  // destructive path against the live state dir to prove it works. The seam
  // itself now lives in paths.js#stateDir (audit-2026-08-22 条目 13): inlined
  // here and in doctor.js, CLAUDEMD_STATE_DIR redirected the two readers while
  // install / uninstall / statusline kept writing to the real directory.
  const stateDirPath = stateDir();

  const result = clean({ apply, ageDaysMin });
  const ctmp = cleanClaudeTmp({ claudeTmpDir, apply, retentionDays });
  const cstate = cleanStateDir({ stateDir: stateDirPath, apply, retentionDays });
  const sentinelCount = result.targets.filter(t => SENTINEL_PATTERN.test(path.basename(t.path))).length;
  const sandboxCount = result.targets.filter(t => SANDBOX_PATTERN.test(path.basename(t.path))).length;
  // Exit code reflects what REMAINS, not what was attempted (2026-08-29 audit
  // R10-09). All three cleaners swallow per-entry rmSync failures as
  // best-effort and count only successes, so a run that deleted nothing —
  // permissions, an immutable flag, a path that came back — printed its JSON
  // and returned 0. A wrapper or cron step gating on this command read "clean"
  // while the residue was still there (`cli-exit-code-must-reflect-remaining`).
  // Only meaningful under --apply: a dry run deletes nothing by definition.
  // Protected entries are not "remaining": they were never targets.
  const attempted = result.targets.length + ctmp.targets.length + cstate.targets.length;
  const removed = result.deleted + ctmp.deleted + cstate.deleted;
  const remaining = apply ? attempted - removed : 0;
  // `remaining` says HOW MANY are still there; this says WHICH and WHY. Without
  // it the operator's only route to the cause is a hand-written rmSync probe —
  // the route the maintainer actually had to take on 2026-09-04. Errno matters
  // because the three causes need different actions: EACCES on a child dir is a
  // chmod, EPERM on a root-owned entry needs sudo or nothing, and ENOTEMPTY
  // means something is still writing into it.
  const unreapable = [...result.failures, ...ctmp.failures, ...cstate.failures];
  const agePath = t => ({ path: t.path, ageDays: Math.round(t.ageDays * 10) / 10 });
  const protectedPaths = [...result.protected, ...ctmp.protected].map(agePath);
  if (protectedPaths.length > 0) {
    console.error(
      `${protectedPaths.length} stale entr${protectedPaths.length === 1 ? 'y' : 'ies'} skipped: ` +
        `contain${protectedPaths.length === 1 ? 's' : ''} this process's cwd or $TMPDIR (see \`protected\`).`
    );
  }
  if (unreapable.length > 0) {
    console.error(
      `${unreapable.length} target(s) could not be removed:\n` +
        unreapable.map(f => `  ${f.code}: ${f.path}`).join('\n') +
        '\n  These stay on disk and will be reported again on every run — a permission bit ' +
        'does not age out. EACCES is usually a child directory with no write bit.'
    );
  }
  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        tmpDir: process.env.TMPDIR || os.tmpdir(),
        ageDaysMin,
        sentinels: sentinelCount,
        sandboxes: sandboxCount,
        // Counted and sized on every run, never deleted (see
        // UNOWNED_MKTEMP_PATTERN). This class is the answer to "the recycler
        // could not see its own biggest input" (audit R11-38).
        unowned: result.unowned,
        deleted: result.deleted,
        paths: result.targets.map(agePath),
        protected: protectedPaths,
        claudeTmp: {
          dir: claudeTmpDir,
          retentionDays,
          candidates: ctmp.targets.length,
          deleted: ctmp.deleted,
          paths: ctmp.targets.map(agePath),
        },
        remaining,
        unreapable,
        stateDir: {
          // `stateDirPath`, not the imported `stateDir` FUNCTION — JSON.stringify
          // drops a function value, so this key vanished from the output entirely.
          // The one thing the CLAUDEMD_STATE_DIR seam exists to let a caller
          // confirm — which directory was actually scanned — was the one thing the
          // JSON never said (2026-08-29 audit R10-09).
          dir: stateDirPath,
          retentionDays,
          candidates: cstate.targets.length,
          deleted: cstate.deleted,
          byKind: cstate.targets.reduce((acc, t) => {
            acc[t.kind] = (acc[t.kind] || 0) + 1;
            return acc;
          }, {}),
          paths: cstate.targets.map(t => ({
            path: t.path,
            kind: t.kind,
            ageDays: Math.round(t.ageDays * 10) / 10,
          })),
        },
      },
      null,
      2
    )
  );
  // 3, not 1: 1 already means "validation error" and 2 means "argv-shape
  // error". Overloading either would make "some residue could not be removed"
  // indistinguishable from "you typed the flag wrong" — the same exit-code
  // conflation doctor.js resolved the same way.
  if (remaining > 0) process.exitCode = 3;
}
