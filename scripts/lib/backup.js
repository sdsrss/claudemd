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
const labelRegex = (label) => new RegExp(
  `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${STAMP_GRAMMAR}$`
);
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
      if (!fs.existsSync(candidate)) { dir = candidate; break; }
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const movedFiles = [];
  for (const src of files) {
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, path.basename(src));
    fs.renameSync(src, dest);
    movedFiles.push(dest);
  }
  return { dir, movedFiles };
}

export function listBackups({ label = DEFAULT_LABEL } = {}) {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  const re = labelRegex(label);
  const prefix = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`);
  return fs.readdirSync(root)
    .filter(name => re.test(name))
    .map(name => ({
      dir: path.join(root, name),
      iso: name.replace(prefix, ''),
      size: dirSize(path.join(root, name)),
    }))
    .sort((a, b) => b.iso.localeCompare(a.iso));
}

export function pruneBackups(retainCount = 5, { label = DEFAULT_LABEL } = {}) {
  const backups = listBackups({ label });
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
export function pruneSettingsBackups(retainCount = 5) {
  const dir = path.dirname(settingsPath());
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir)
    .filter(n => SETTINGS_BK_REGEX.test(n))
    .sort((a, b) => b.localeCompare(a));
  const removed = [];
  for (const n of entries.slice(retainCount)) {
    const full = path.join(dir, n);
    try { fs.unlinkSync(full); removed.push(full); }
    catch { /* best-effort — missing / race is fine */ }
  }
  return removed;
}

// Pre-mutation safety copy of settings.json, shared by install.js and the
// statusline adopt path. Mirrors the inline block install.js used pre-extraction:
// `.claudemd-backup-<isoStamp>` sibling, numeric-suffixed on the (vanishingly
// rare) same-ms collision, then rotate to `retainCount` newest.
export function backupSettingsFile(retainCount = 5) {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { backup: null, pruned: [] };
  let candidate = `${p}.claudemd-backup-${isoStamp()}`;
  if (fs.existsSync(candidate)) {
    for (let i = 1; i < 1000; i++) {
      const next = `${candidate}-${i}`;
      if (!fs.existsSync(next)) { candidate = next; break; }
    }
  }
  fs.copyFileSync(p, candidate);
  const pruned = pruneSettingsBackups(retainCount);
  return { backup: candidate, pruned };
}

export function restoreBackup(backupDir, targetRoot) {
  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    const src = path.join(backupDir, name);
    const dest = path.join(targetRoot, name);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      restored.push(dest);
    }
  }
  return restored;
}

function dirSize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    total += stat.isFile() ? stat.size : 0;
  }
  return total;
}
