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
// A symlink at `p` whose target is ABSENT → the target it names; null for
// anything else (regular file, live link, absent path, a target we cannot see).
//
// Absent and unreadable are different answers, and only the first one licenses
// deleting the entry. `existsSync` conflates them — it is false for ANY stat
// failure — so an unmounted network dotfiles directory, a TCC-protected path on
// macOS or a mode-0700 parent made a LIVE link read as dead: the no-backup
// upgrade branch removed it, wrote a regular file in its place, and printed a
// warning saying the target does not exist when it does and still holds the
// user's bytes. v0.76.2 failed loudly and kept the link, so that was a
// regression this guard introduced (0.77.0 pre-tag review, MEDIUM-1).
//
// `statSync` with `throwIfNoEntry` FOLLOWS the link and returns undefined for
// ENOENT and for ENOTDIR — both are deterministic statements that no entry can
// exist at that path, the second when a path component is a regular file. Every
// other error throws and is caught below as "cannot tell", which leaves the
// entry alone. The distinction that matters is not the errno but its class: a
// shape error is knowable, a permission or mount error is not.
//
// A circular link (ELOOP) therefore survives too and the copy fails loudly,
// which is the right end for a state nothing here can safely resolve — on the
// no-backup branch that leaves a partial upgrade, which is pre-existing, needs a
// self-referential spec symlink to reach, and is recorded rather than fixed here
// (0.77.0 pre-tag review, LOW-6).
function danglingLinkTarget(p) {
  try {
    if (!fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
    if (fs.statSync(p, { throwIfNoEntry: false }) !== undefined) return null;
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

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
      // NEVER write through a DANGLING destination link. copyFileSync opens dest
      // with O_CREAT and the kernel resolves that along the link — so a
      // ~/.claude/CLAUDE-extended.md still pointing into a dotfiles checkout that
      // has moved makes install CREATE the file inside the user's repo: 25 KB of
      // spec they never put there and may commit (0.76.2 pre-tag review MEDIUM-2).
      //
      // This is the ONLY place that covers the upgrade population. install's
      // backup branch moves such a link aside before this runs, but the
      // spec-on-spec branch takes no backup at all by design (the v0.23.11
      // data-loss fix), and update.js reaches this code with no branch of its own.
      //
      // A LIVE link is deliberately left alone HERE: a user who symlinks the spec
      // into their dotfiles to sync it across machines wants the new bytes to land
      // there. Only the dead entry is replaced, and the target it named is printed
      // so the link can be rebuilt.
      //
      // "Here" is load-bearing and an earlier version of this comment omitted it.
      // On install's BACKUP branch and on every update, `createBackup` has already
      // moved a live link aside before this runs, so the bytes land in a fresh
      // regular file and the user's sync stops — pre-existing behaviour, reached
      // by two of the three paths (0.77.0 pre-tag review, LOW-4). The pass-through
      // described above is real only on install's spec-on-spec branch, which takes
      // no backup.
      const deadLink = danglingLinkTarget(dest);
      if (deadLink !== null) {
        fs.unlinkSync(dest);
        process.stderr.write(
          `[claudemd] WARN: ${dest} was a symlink to ${deadLink}, which does not exist. ` +
            `Writing the spec through it would have created that file in its directory, so ` +
            `the dead link was removed and ${name} written in its place. Re-create the link ` +
            `if its target comes back.\n`
        );
      }
      // Write beside the destination, verify, then rename ONTO it (Round-14
      // audit SCR-M1). A bare `copyFileSync(src, dest)` is open(O_TRUNC) + write:
      // for the whole duration of that write the installed spec is TRUNCATED,
      // and this is the file every Claude Code session reads at startup. A
      // concurrent upgrade tripped the integrity check below at 4 of 40 trials,
      // which is the same window seen from the writer's side. rename(2) is
      // atomic within a filesystem, so a reader sees the old bytes or the new
      // ones and never a prefix, and an interrupted write leaves the previous
      // spec in place instead of a partial one.
      //
      // The tmp file goes next to the REAL destination, resolved through any
      // symlink, for the two reasons writeJsonAtomic (paths.js) documents:
      // rename cannot cross filesystems, and renaming onto the LINK would
      // replace it with a regular file — silently detaching the dotfiles setup
      // this function goes out of its way to keep working.
      //
      // So the swap only happens when the real destination can be NAMED.
      // `realpathSync` failing is two different situations: nothing is there
      // (the ordinary fresh-install case — safe, the rename creates the file),
      // or there IS an entry that cannot be resolved, which on this path means a
      // live link into an unreadable directory. Renaming onto that link is
      // exactly the M-2 regression — deleting a live link and writing a regular
      // file over it — so it falls back to the direct copy, which writes THROUGH
      // the link and fails loudly when it cannot.
      let realDest = null;
      try {
        realDest = fs.realpathSync(dest);
      } catch {
        try {
          if (fs.lstatSync(dest, { throwIfNoEntry: false }) === undefined) realDest = dest;
        } catch {
          /* cannot even lstat — leave realDest null and copy through */
        }
      }
      if (realDest === null) {
        fs.copyFileSync(src, dest);
        if (sha256File(src) !== sha256File(dest)) {
          throw new Error(
            `spec copy: post-copy integrity check failed for ${name} ` +
              `(${dest} does not match shipped ${src}). Disk full or a concurrent writer? Re-run.`
          );
        }
      } else {
        const tmp = `${realDest}.claudemd-tmp-${process.pid}`;
        try {
          fs.copyFileSync(src, tmp);
          if (sha256File(src) !== sha256File(tmp)) {
            throw new Error(
              `spec copy: post-copy integrity check failed for ${name} ` +
                `(${tmp} does not match shipped ${src}). Disk full or a concurrent writer? Re-run.`
            );
          }
          fs.renameSync(tmp, realDest);
        } catch (e) {
          try {
            fs.unlinkSync(tmp);
          } catch {
            /* nothing to clean up */
          }
          throw e;
        }
      }
    }
  } catch (e) {
    if (backupDir) {
      for (const name of names) {
        const saved = path.join(backupDir, name);
        try {
          if (fs.existsSync(saved)) fs.copyFileSync(saved, homeSpec(name));
          // A DANGLING link in the backup dir is a state createBackup can only
          // produce since it stopped skipping such entries (backup.js
          // entryPresent). Without this arm the rollback fell through to the
          // `written` branch and DELETED the home path, leaving the user's link
          // only inside backup-<stamp>/ — a worse end state than the failure it
          // is rolling back. Restore the entry in the shape it had.
          //
          // A link whose target still resolves keeps the older behavior above:
          // its content is copied back. That asymmetry is deliberate — copying
          // through a live entry is what restoreBackup does too, and widening it
          // here would change a path this fix has no evidence about.
          else if (fs.lstatSync(saved, { throwIfNoEntry: false })?.isSymbolicLink()) {
            const target = fs.readlinkSync(saved);
            fs.rmSync(homeSpec(name), { force: true });
            fs.symlinkSync(target, homeSpec(name));
          } else if (written.includes(name)) fs.unlinkSync(homeSpec(name));
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
