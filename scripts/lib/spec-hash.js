import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homeSpec, SPEC_FILES } from './paths.js';

// Spec files shipped under <pluginRoot>/spec/ and installed at ~/.claude/<name>.
// Imported from lib/paths.js (2026-08-29 audit R10-17b) — this used to be a
// hand-copy justified by "no install-side dependency", but paths.js is a leaf
// this module already imports, so the single source costs nothing and a fifth
// spec file can no longer be installed by one consumer and ignored by another.

export function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// SINGLE SOURCE for "put the shipped spec into ~/.claude" (2026-09-02 audit
// R11-09). install.js and update.js had diverged into two semantics for one
// operation: install copied then compared sha256 per file (SCRIPT-1), update
// ran a bare copyFileSync loop with neither check nor rollback.
//
// The divergence was a data-loss path, not a style problem. createBackup
// RENAMES the user's ~/.claude/CLAUDE*.md into the backup dir (backup.js:82),
// so an ENOSPC or EACCES on the second file left ~/.claude holding one new file
// and three missing ones — precisely the partial state update.js:37-39 forbids,
// since the spec trio is lockstep and §EXT cross-references dangle otherwise.
//
// `backupDir` is where createBackup moved the originals. On any failure —
// thrown copy or hash mismatch — every name is put back from there before the
// error is rethrown, so the caller either gets the whole new spec or the whole
// old one. Callers that took no backup pass nothing and get install's original
// behavior: verify, throw, leave the FS as it is.
export function copySpecFiles(pluginRoot, names = SPEC_FILES, { backupDir = null } = {}) {
  const written = [];
  try {
    for (const name of names) {
      const src = path.join(pluginRoot, 'spec', name);
      const dest = homeSpec(name);
      // Recorded BEFORE the copy, not after (0.71.4 pre-tag review): a
      // copyFileSync that throws partway still leaves a truncated dest. Pushed
      // after, such a name was in neither `written` nor the backup dir, so the
      // rollback below neither restored nor removed it — reachable through
      // update.js, where a spec file absent from ~/.claude is a target but has
      // no backup entry.
      written.push(name);
      fs.copyFileSync(src, dest);
      if (sha256File(src) !== sha256File(dest)) {
        throw new Error(
          `spec copy: post-copy integrity check failed for ${name} ` +
            `(${dest} does not match shipped ${src}). Disk full or a concurrent writer? Re-run.`
        );
      }
    }
  } catch (e) {
    if (backupDir) {
      for (const name of names) {
        const saved = path.join(backupDir, name);
        try {
          if (fs.existsSync(saved)) fs.copyFileSync(saved, homeSpec(name));
          else if (written.includes(name)) fs.unlinkSync(homeSpec(name));
        } catch {
          /* best-effort rollback; the original error is the one to report */
        }
      }
    }
    throw e;
  }
  return written;
}

// Returns one row per spec file with shipped + installed hashes and a
// match/missing summary. Detects local drift (user/process modified
// ~/.claude/CLAUDE.md after install) AND post-upgrade staleness (plugin
// upgraded, spec not re-synced via /claudemd-update). Does NOT cover
// supply-chain integrity — that's the marketplace/npm signature layer.
export function compareSpecs(pluginRoot) {
  return SPEC_FILES.map(name => {
    const shipped = sha256File(path.join(pluginRoot, 'spec', name));
    const installed = sha256File(homeSpec(name));
    return {
      name,
      shipped,
      installed,
      match: shipped !== null && installed !== null && shipped === installed,
      missing: shipped === null || installed === null,
    };
  });
}
