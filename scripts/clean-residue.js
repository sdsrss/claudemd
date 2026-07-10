import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/clean-residue.js [--apply] [--age-days=N] [--retention-days=N]

Clean leftover claudemd-sync-* sentinels and historical claudemd-(mockgh|work).*
sandbox dirs from $TMPDIR, plus stale tool-exhaust from ~/.claude/tmp per spec
§EXT §7-EXT retention (mtime > TMP_RETENTION_DAYS, default 7). Default is dry-run.

Options:
  --apply             Opt into deletion (without it, prints what would be deleted).
  --age-days=N        $TMPDIR stale threshold in days (non-negative, default 1).
  --retention-days=N  ~/.claude/tmp retention in days (non-negative). Resolution:
                      this flag > TMP_RETENTION_DAYS: in ./CLAUDE.md > 7.
  --help, -h          Print this message and exit.

Env: CLAUDEMD_CLAUDE_TMP_DIR overrides the ~/.claude/tmp root (test seam).

Wrapped by /claudemd-clean-residue.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

// Anchored regexes — names MUST start with the prefix. Defends against
// future fnmatch-style globs that would falsely match `not-claudemd-sync-*`.
const SENTINEL_PATTERN = /^claudemd-sync-/;
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

  const result = clean({ apply, ageDaysMin });
  const ctmp = cleanClaudeTmp({ claudeTmpDir, apply, retentionDays });
  const sentinelCount = result.targets.filter(t => SENTINEL_PATTERN.test(path.basename(t.path))).length;
  const sandboxCount  = result.targets.filter(t => SANDBOX_PATTERN.test(path.basename(t.path))).length;
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
  }, null, 2));
}
