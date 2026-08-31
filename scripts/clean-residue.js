import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';
import { stateDir } from './lib/paths.js';

const USAGE = `Usage: node scripts/clean-residue.js [--apply] [--age-days=N] [--retention-days=N]

Clean leftover claudemd-sync-* / claudemd-memtags-hay-* sentinels and historical
claudemd-(mockgh|work).*
sandbox dirs from $TMPDIR, stale tool-exhaust from ~/.claude/tmp per spec
§EXT §7-EXT retention (mtime > TMP_RETENTION_DAYS, default 7), and orphaned
per-session sentinels from ~/.claude/.claudemd-state. Default is dry-run.

Options:
  --apply             Opt into deletion (without it, prints what would be deleted).
  --age-days=N        $TMPDIR stale threshold in days (non-negative, default 1).
  --retention-days=N  ~/.claude/tmp AND ~/.claude/.claudemd-state retention in
                      days (non-negative). Resolution:
                      this flag > TMP_RETENTION_DAYS: in ./CLAUDE.md > 7.
  --help, -h          Print this message and exit.

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
dry run). \`stateDir.dir\` echoes the directory actually scanned, so a run under
CLAUDEMD_STATE_DIR can be confirmed rather than assumed.

Exit codes: 0 success | 1 validation error | 2 argv-shape error |
3 --apply left targets behind (see \`remaining\`).`;

// Anchored regexes — names MUST start with the prefix. Defends against
// future fnmatch-style globs that would falsely match `not-claudemd-sync-*`.
// `claudemd-memtags-hay-*` joined the set for audit-2026-08-22 P1-5:
// hooks/lib/memory-tags.sh spills an oversize haystack there and now traps to
// remove it, but a SIGKILL at the hooks.json timeout still strands one, and
// before this it matched no reaper at all. The join back to that template is
// asserted in tests/scripts/clean-residue.test.js, so a rename there fails here
// rather than silently orphaning the files again.
const SENTINEL_PATTERN = /^claudemd-(sync-|memtags-hay-)/;
const SANDBOX_PATTERN  = /^claudemd-(mockgh|work)\./;

export function scan({ tmpDir = os.tmpdir(), now = Date.now() } = {}) {
  if (!fs.existsSync(tmpDir)) return { sentinels: [], sandboxes: [] };
  let entries;
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { sentinels: [], sandboxes: [] };
  }
  const sentinels = [];
  const sandboxes = [];
  for (const entry of entries) {
    const full = path.join(tmpDir, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
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
    }
  }
  return { sentinels, sandboxes };
}

export function clean({ tmpDir = os.tmpdir(), apply = false, ageDaysMin = 1, now = Date.now() } = {}) {
  const { sentinels, sandboxes } = scan({ tmpDir, now });
  const targets = [
    ...sentinels.filter(s => s.ageDays >= ageDaysMin),
    ...sandboxes.filter(s => s.ageDays >= ageDaysMin),
  ];
  if (!apply) {
    return { dryRun: true, targets, deleted: 0 };
  }
  let deleted = 0;
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true });
      deleted++;
    } catch { /* best-effort; partial delete is fine */ }
  }
  return { dryRun: false, targets, deleted };
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
  try { entries = fs.readdirSync(claudeTmpDir, { withFileTypes: true }); } catch { return { candidates: [] }; }
  for (const entry of entries) {
    const full = path.join(claudeTmpDir, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (UID_DIR_PATTERN.test(entry.name) && stat.isDirectory()) {
      let children;
      try { children = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        const childFull = path.join(full, child.name);
        let childStat;
        try { childStat = fs.statSync(childFull); } catch { continue; }
        pushCandidate(childFull, childStat);
      }
    } else {
      pushCandidate(full, stat);
    }
  }
  return { candidates };
}

export function cleanClaudeTmp({ claudeTmpDir, apply = false, retentionDays = 7, now = Date.now() } = {}) {
  const { candidates } = scanClaudeTmp({ claudeTmpDir, now });
  const targets = candidates.filter(c => c.ageDays >= retentionDays);
  if (!apply) {
    return { dryRun: true, targets, deleted: 0 };
  }
  let deleted = 0;
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true });
      deleted++;
    } catch { /* best-effort; partial delete is fine */ }
  }
  return { dryRun: false, targets, deleted };
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
  try { entries = fs.readdirSync(stateDir, { withFileTypes: true }); } catch { return { candidates: [] }; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = STATE_EPHEMERAL.find(p => p.re.test(entry.name));
    if (!match) continue;
    const full = path.join(stateDir, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    candidates.push({
      path: full,
      kind: match.kind,
      ageDays: Math.max(0, (now - stat.mtimeMs) / 86400000),
    });
  }
  return { candidates };
}

export function cleanStateDir({ stateDir, apply = false, retentionDays = 7, now = Date.now() } = {}) {
  const { candidates } = scanStateDir({ stateDir, now });
  const targets = candidates.filter(c => c.ageDays >= retentionDays);
  if (!apply) return { dryRun: true, targets, deleted: 0 };
  let deleted = 0;
  for (const t of targets) {
    try { fs.rmSync(t.path, { force: true }); deleted++; } catch { /* best-effort */ }
  }
  return { dryRun: false, targets, deleted };
}

// TMP_RETENTION_DAYS: N in the invoking project's CLAUDE.md (spec §EXT §7-EXT
// override syntax). Malformed values warn to stderr and fall back to the default —
// a silently-ignored config knob is the flag-shape antipattern (see lib/argv.js).
export function readRetentionFromClaudeMd(cwd = process.cwd()) {
  const file = path.join(cwd, 'CLAUDE.md');
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = src.match(/^TMP_RETENTION_DAYS:[ \t]*(\S+)[ \t]*$/m);
  if (!m) return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(m[1])) {
    console.error(`TMP_RETENTION_DAYS in ${file} is not a non-negative number (got '${m[1]}'); using default.`);
    return null;
  }
  return Number(m[1]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), {
      bools: ['--apply'],
      values: ['--age-days', '--retention-days'],
    });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
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
    if (!/^[0-9]+(\.[0-9]+)?$/.test(String(rawRetention).trim()) || !Number.isFinite(retentionDays) || retentionDays < 0) {
      console.error(`--retention-days requires a non-negative number (got '${rawRetention}').`);
      process.exit(1);
    }
  } else {
    retentionDays = readRetentionFromClaudeMd() ?? 7;
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
  const sandboxCount  = result.targets.filter(t => SANDBOX_PATTERN.test(path.basename(t.path))).length;
  // Exit code reflects what REMAINS, not what was attempted (2026-08-29 audit
  // R10-09). All three cleaners swallow per-entry rmSync failures as
  // best-effort and count only successes, so a run that deleted nothing —
  // permissions, an immutable flag, a path that came back — printed its JSON
  // and returned 0. A wrapper or cron step gating on this command read "clean"
  // while the residue was still there (`cli-exit-code-must-reflect-remaining`).
  // Only meaningful under --apply: a dry run deletes nothing by definition.
  const attempted = result.targets.length + ctmp.targets.length + cstate.targets.length;
  const removed = result.deleted + ctmp.deleted + cstate.deleted;
  const remaining = apply ? attempted - removed : 0;
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    tmpDir: process.env.TMPDIR || os.tmpdir(),
    ageDaysMin,
    sentinels: sentinelCount,
    sandboxes: sandboxCount,
    deleted: result.deleted,
    paths: result.targets.map(t => ({ path: t.path, ageDays: Math.round(t.ageDays * 10) / 10 })),
    claudeTmp: {
      dir: claudeTmpDir,
      retentionDays,
      candidates: ctmp.targets.length,
      deleted: ctmp.deleted,
      paths: ctmp.targets.map(t => ({ path: t.path, ageDays: Math.round(t.ageDays * 10) / 10 })),
    },
    remaining,
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
      byKind: cstate.targets.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] || 0) + 1; return acc; }, {}),
      paths: cstate.targets.map(t => ({ path: t.path, kind: t.kind, ageDays: Math.round(t.ageDays * 10) / 10 })),
    },
  }, null, 2));
  // 3, not 1: 1 already means "validation error" and 2 means "argv-shape
  // error". Overloading either would make "some residue could not be removed"
  // indistinguishable from "you typed the flag wrong" — the same exit-code
  // conflation doctor.js resolved the same way.
  if (remaining > 0) process.exitCode = 3;
}
