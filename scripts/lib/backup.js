import fs from 'node:fs';
import path from 'node:path';
import { backupRoot, settingsPath } from './paths.js';

// Second-precision (legacy) vs millisecond-precision (current). Both accepted
// by listBackups so pre-existing backups keep sorting correctly. The optional
// `-N` suffix matches createBackup's same-ms collision path — without it those
// dirs were invisible to listBackups/pruneBackups (never listed, never pruned,
// never restored → leaked in ~/.claude forever). The sibling SETTINGS_BK_REGEX
// already carried `(-\d+)?`; this regex had drifted out of sync. The `-N` dir
// sorts just after its base stamp (longer string > shorter), matching creation
// order (the collision dir is written second).
const STAMP_GRAMMAR = String.raw`\d{8}T\d{6}(\d{3})?Z(-\d+)?`;
// Backups are namespaced BY LABEL, and list/prune/restore only ever see one
// namespace at a time (audit-2026-08-22 P1-1). Pre-fix both install.js (the
// user's personal ~/.claude/CLAUDE.md) and update.js (the spec it is about to
// overwrite) wrote `backup-<stamp>`, so an update pushed a spec-only backup on
// top of the personal one: `CLAUDEMD_SPEC_ACTION=restore` takes listBackups()[0]
// and returned the OLD SPEC, while pruneBackups(5) evicted the personal content
// after five updates — the v0.23.11 data-loss mode, reopened through update.
// install.js's "the personal backup is the SOLE backup" comment is true again
// only because the other writers now live in their own namespaces.
//
// SINGLE SOURCE for the namespaces in use. Anything that writes a backup dir
// takes its label from here, and anything that reports on backups as a whole
// (doctor's inventory) iterates this object rather than assuming one prefix.
export const BACKUP_LABELS = {
  // install.js — the user's own ~/.claude/CLAUDE.md, moved aside so the spec
  // can take its place. This is the ONLY namespace uninstall's restore reads.
  personal: 'backup',
  // update.js — the installed spec about to be replaced by a newer one.
  spec: 'spec-backup',
  // install.js — pre-plugin hand-installed hook files (banned-vocab-check.sh
  // and its patterns). Its own namespace because the dir it needs holds those
  // files under a `hooks/` SUBDIR, and restoreBackup only copies depth-1
  // files: as a `backup-` dir it was a newest-but-EMPTY restore source that
  // shadowed the personal one (audit-2026-08-22 P1-1, second arm).
  handHook: 'handhook-backup',
};
const DEFAULT_LABEL = BACKUP_LABELS.personal;

// How many backup generations survive a prune. The literal `5` was written six
// times — three defaults here plus three call sites in install.js / update.js /
// doctor.js prose (audit R11-31). Six copies of a retention policy is five
// chances to change it in one place and leave the others; and this one governs
// how far back a user can restore, so a partial change is silent data loss.
export const BACKUP_RETAIN_COUNT = 5;

// Human-facing glob list for every namespace, derived from BACKUP_LABELS.
//
// doctor's inventory and --prune-backups were widened to all three namespaces
// by P1-1, but the text telling the user how to clear them was not: it still
// named `~/.claude/backup-*` alone, a glob matching neither `spec-backup-*` nor
// `handhook-backup-*`. Following the printed instruction against a reported
// count of 7 removed 2 (0.68.3 pre-tag review MEDIUM-3). Deriving the string
// keeps the advice and the inventory on one source.
export function backupGlobs(root = '~/.claude') {
  return Object.values(BACKUP_LABELS)
    .map(l => `${root}/${l}-*`)
    .join(' ');
}
const labelRegex = label => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${STAMP_GRAMMAR}$`);
// Matches the pre-merge settings.json backup files install.js writes before
// any modification. Same iso-stamp grammar, plus an optional `-N` numeric
// suffix from the sub-ms collision path in install.js.
const SETTINGS_BK_REGEX = /^settings\.json\.claudemd-backup-\d{8}T\d{6}(\d{3})?Z(-\d+)?$/;

export function isoStamp() {
  // YYYYMMDDTHHMMSSmmmZ — ms suffix prevents sub-second collisions when install
  // or update runs twice in the same second (would overwrite prior backup).
  return new Date().toISOString().replace(/[-:.]/g, '');
}

export function createBackup(files, { label = DEFAULT_LABEL } = {}) {
  let dir = path.join(backupRoot(), `${label}-${isoStamp()}`);
  // Belt-and-braces: if the ms-precision stamp still collides (same process,
  // same ms — vanishingly rare), append a numeric suffix to avoid clobbering.
  if (fs.existsSync(dir)) {
    for (let i = 1; i < 1000; i++) {
      const candidate = `${dir}-${i}`;
      if (!fs.existsSync(candidate)) {
        dir = candidate;
        break;
      }
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const movedFiles = [];
  for (const src of files) {
    // existsSync FOLLOWS the link, so an already-dangling source is skipped
    // here and never reaches the branch below — unchanged behavior.
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, path.basename(src));
    // A SYMLINKED source is re-pointed, not moved.
    //
    // rename(2) moves the LINK, and a RELATIVE link resolves against its new
    // parent — so `~/.claude/CLAUDE.md -> ../dotfiles/CLAUDE.md`, the GNU stow
    // default and chezmoi's usual shape, lands in `backup-<stamp>/` resolving
    // one directory deeper and dangles before install has finished. Everything
    // downstream then reads as success on an entry that cannot be opened:
    // install's WARN names it as the place the user's instructions went,
    // restoreBackup's statSync guard (R10-04) skips it, and uninstall reports
    // `specAction: "restore"` having copied nothing back (2026-09-05 audit
    // ENG-01, sandbox-reproduced). Absolute links already survived the move,
    // which is why this sat behind the guard added FOR dangling entries.
    //
    // Absolutising one level is enough: a chain's next hop still resolves
    // against ITS own unmoved directory. The link — not a copy of the bytes —
    // is what belongs here, because the bytes were never claudemd's to move;
    // the dotfiles source stays exactly where the user put it, and restore
    // copies THROUGH the entry.
    let linkTarget = null;
    try {
      if (fs.lstatSync(src).isSymbolicLink()) linkTarget = fs.readlinkSync(src);
    } catch {
      /* raced between existsSync and lstat — fall through to the rename */
    }
    if (linkTarget !== null) {
      fs.symlinkSync(path.resolve(path.dirname(src), linkTarget), dest);
      fs.unlinkSync(src);
    } else {
      fs.renameSync(src, dest);
    }
    movedFiles.push(dest);
  }
  return { dir, movedFiles };
}

export function listBackups({ label = DEFAULT_LABEL } = {}) {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  const re = labelRegex(label);
  const prefix = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`);
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return (
    entries
      .filter(name => re.test(name))
      // A plain FILE named `backup-<stamp>` matches the name grammar but is not a
      // backup; dirSize would then readdir a file (ENOTDIR). Filter by type.
      .filter(name => {
        try {
          return fs.statSync(path.join(root, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map(name => ({
        dir: path.join(root, name),
        iso: name.replace(prefix, ''),
        size: dirSize(path.join(root, name)),
      }))
      .sort((a, b) => b.iso.localeCompare(a.iso))
  );
}

// `exclude` — dirs that are neither deleted NOR counted against retainCount.
//
// findLegacySpecBackups()'s dirs are the caller of record (doctor's
// --prune-backups). Those sit in the PERSONAL namespace but are pre-0.68.3
// spec backups, and on such a layout they are the NEWEST entries — so an
// unfiltered `pruneBackups(1)` retained a spec-shaped dir and deleted the
// user's genuine personal backup, which is the v0.23.11 data-loss mode
// reopened through a maintenance flag (2026-08-29 audit R10-03, reproduced in
// a sandbox probe). The 0.68.3 namespace fix routed new WRITES; the stock of
// dirs already there was never taken out of this retain window.
//
// Skipping rather than deleting keeps this function inside the report-only
// posture findLegacySpecBackups documents at length below: a legacy dir may be
// a genuine pre-v0.23.11 personal backup with user files beside the spec, and
// nothing at runtime tells the two apart, so it is the user's call. doctor
// reports the skipped set so its count and this one read the same.
export function pruneBackups(
  retainCount = BACKUP_RETAIN_COUNT,
  { label = DEFAULT_LABEL, exclude = [] } = {}
) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude);
  const backups = listBackups({ label }).filter(b => !skip.has(b.dir));
  const removed = [];
  for (const b of backups.slice(retainCount)) {
    fs.rmSync(b.dir, { recursive: true, force: true });
    removed.push(b.dir);
  }
  return removed;
}

// Prune ~/.claude/settings.json.claudemd-backup-* pre-merge safety copies.
// install.js writes one per invocation; without rotation, N installs leave N
// backup files indefinitely. Mirror pruneBackups (keep 5 newest, drop rest)
// so `/claudemd-doctor` is not needed to surface the growth. Lexicographic
// sort on the iso stamp is chronological by construction.
export function pruneSettingsBackups(retainCount = BACKUP_RETAIN_COUNT) {
  const dir = path.dirname(settingsPath());
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir)
    .filter(n => SETTINGS_BK_REGEX.test(n))
    .sort((a, b) => b.localeCompare(a));
  const removed = [];
  for (const n of entries.slice(retainCount)) {
    const full = path.join(dir, n);
    try {
      fs.unlinkSync(full);
      removed.push(full);
    } catch {
      /* best-effort — missing / race is fine */
    }
  }
  return removed;
}

// Pre-mutation safety copy of settings.json, shared by install.js and the
// statusline adopt path. Mirrors the inline block install.js used pre-extraction:
// `.claudemd-backup-<isoStamp>` sibling, numeric-suffixed on the (vanishingly
// rare) same-ms collision, then rotate to `retainCount` newest.
export function backupSettingsFile(retainCount = BACKUP_RETAIN_COUNT) {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { backup: null, pruned: [] };
  let candidate = `${p}.claudemd-backup-${isoStamp()}`;
  if (fs.existsSync(candidate)) {
    for (let i = 1; i < 1000; i++) {
      const next = `${candidate}-${i}`;
      if (!fs.existsSync(next)) {
        candidate = next;
        break;
      }
    }
  }
  fs.copyFileSync(p, candidate);
  const pruned = pruneSettingsBackups(retainCount);
  return { backup: candidate, pruned };
}

// Does this text look like a claudemd spec rather than the user's own file?
//
// SINGLE SOURCE for the question. install.js asks it to decide whether there is
// anything user-owned to preserve (spec-shaped → no backup at all); the legacy
// migration below asks it to decide who WROTE an existing `backup-` dir. The
// two answers must agree — if install.js never backs up a spec, then a `backup-`
// dir holding one cannot have come from install.js. Restating the predicate in
// the second caller would let that inference rot silently
// (feedback_extraction_needs_consumer_gate).
export function looksLikeSpec(text) {
  return /^#\s*AI-CODING-SPEC\b/m.test(String(text || '').slice(0, 256));
}

// REPORT — never move — pre-0.68.3 spec backups sitting in the personal
// namespace.
//
// P1-1 gave update.js its own label, but it was forward-only: the dirs already
// written under `backup-<stamp>` stay there, so on a machine that has run
// updates, restore still returns a spec-only dir and pruneBackups(5) still
// counts them against the personal retain window.
//
// A migration was written for this and then WITHDRAWN before 0.68.3 shipped,
// because the delta review disproved the invariant it rested on. The reasoning
// is recorded here so it is not re-derived and re-shipped:
//
//   The discriminator was "install.js creates a personal backup only when the
//   file does not look like a spec, so a spec-shaped `backup-` dir cannot have
//   come from install.js". That holds for TODAY's install.js. It is false for
//   the one that wrote the dirs a migration would target: the first install.js
//   (cc36e2b) backed up unconditionally, and this repo's own CHANGELOG records
//   that the whole pre-v0.23.11 window "backed up the spec itself". So
//   install.js-written spec-shaped dirs exist, and moving them would (a) carry
//   any sibling user files out of the restore path, which reads the personal
//   label only, and (b) land them in a namespace update.js prunes on every run
//   — deleting them after five updates. That is a data-loss path introduced by
//   a data-loss fix.
//
// So this function only looks. `/claudemd-doctor` surfaces what it finds and
// the user decides; the constraints a real migration would have to satisfy are
// in tasks/legacy-spec-backup-migration.md.
export function findLegacySpecBackups() {
  const found = [];
  for (const b of listBackups({ label: BACKUP_LABELS.personal })) {
    let head;
    try {
      const specFile = path.join(b.dir, 'CLAUDE.md');
      if (!fs.statSync(specFile).isFile()) continue;
      head = fs.readFileSync(specFile, 'utf8');
    } catch {
      continue; // unreadable / absent / dangling → no evidence, say nothing
    }
    if (!looksLikeSpec(head)) continue;
    let siblings = [];
    try {
      siblings = fs.readdirSync(b.dir).filter(n => n !== 'CLAUDE.md');
    } catch {
      /* listed above, unreadable now — report without siblings */
    }
    found.push({ dir: b.dir, siblings });
  }
  return found;
}

export function restoreBackup(backupDir, targetRoot) {
  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    const src = path.join(backupDir, name);
    const dest = path.join(targetRoot, name);
    // Guarded for the same reason dirSize below is, and against the same input
    // class its comment documents: createBackup uses renameSync, so a symlinked
    // ~/.claude/CLAUDE.md is MOVED into the backup dir as a link and dangles as
    // soon as its target does. 0.68.3 hardened dirSize and stopped at one
    // consumer — this one kept a bare statSync, so a single dangling link threw
    // ENOENT out of the `CLAUDEMD_SPEC_ACTION=restore` uninstall path, after
    // settings had already been evicted and in readdir order, i.e. some files
    // restored and some not (2026-08-29 audit R10-04).
    let isFile;
    try {
      isFile = fs.statSync(src).isFile();
    } catch {
      continue;
    }
    if (isFile) {
      fs.copyFileSync(src, dest);
      restored.push(dest);
    }
  }
  return restored;
}

// Best-effort byte count. Every stat is guarded because the entries here are
// whatever is actually in ~/.claude, and an unstattable one is routine rather
// than exceptional: `createBackup` uses renameSync, and rename(2) on a symlink
// moves the LINK — so a user who symlinks ~/.claude/CLAUDE.md into a dotfiles
// repo ends up with that symlink inside a backup dir, dangling as soon as the
// dotfiles source moves. Pre-0.68.3 an unguarded statSync here threw ENOENT out
// of listBackups, and the callers are `install`, `uninstall`, `doctor` and
// `update` — i.e. one stale symlink took out the install path and killed
// /claudemd-doctor with a bare stack before it printed a single check.
// Reporting a smaller size for an unreadable entry is the right trade against
// refusing to run at all (0.68.3 delta review HIGH-1).
function dirSize(dir) {
  let total = 0;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      total += stat.isFile() ? stat.size : 0;
    } catch {
      /* dangling symlink / raced deletion / permission — count 0 */
    }
  }
  return total;
}
