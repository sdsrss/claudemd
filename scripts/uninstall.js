import fs from 'node:fs';
import path from 'node:path';
import {
  readSettings,
  writeSettings,
  unmergeHook,
  isClaudemdLegacyHookCommand,
} from './lib/settings-merge.js';
import { listBackups, restoreBackup } from './lib/backup.js';
import {
  stateDir,
  logsDir,
  settingsPath,
  specHome,
  backupRoot,
  readManifest,
  legacyManifestPath,
} from './lib/paths.js';
import { HOOK_BASENAMES } from './lib/hook-registry.js';
import { remove as removeStatusline } from './lib/statusline.js';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

// Files claudemd is known to write into its state dir. Used ONLY on the
// non-canonical-name branch of the purge below, where recursing is refused.
// Deliberately a shape list rather than "everything in the directory": if the
// variable points somewhere unexpected, the contents are not ours to assume.
//
// Exported for tests/scripts/architecture-drift.test.js, which joins it against
// the state paths its extractor finds in source. Until the 2026-08-29 audit
// (R10-13) this was a hand-copied subset of that same set with no join at all —
// a fresh instance of the class 0.69.1 shipped a gate to close. Its blast
// direction is benign (an unmatched stem is left behind, never wrongly deleted),
// which is exactly why nothing would have noticed it going stale.
export const CLAUDEMD_STATE_FILE_RE =
  /^(ext-read-|failopen-|mem-coverage-|vocab-scan-|session-start|tmp-baseline|session-summary|upstream-check|last-session-summary|bootstrap-failed|user-content-backup|l2-task-counter|ship-baseline-recent|mem-audit\.lastrun|statusline-prev|installed\.json)/;

const UNINSTALL_USAGE = `Usage: node scripts/uninstall.js

Remove claudemd hooks from ~/.claude/settings.json + clear the install
manifest. Spec files in ~/.claude/CLAUDE*.md are kept by default. Idempotent
(re-run after success returns warning: already-uninstalled).

No flags. Behavior is read from the following env vars:
  CLAUDEMD_SPEC_ACTION  keep (default) | delete | restore
  CLAUDEMD_CONFIRM      1 to confirm hard-AUTH for spec delete
  CLAUDEMD_PURGE        1 to also wipe ~/.claude/.claudemd-state and logs

restore copies the newest backup-<stamp>/ back over ~/.claude and REPORTS what
it copied (\`restored\`; \`warning: "restore-empty"\` when that list is empty).
It restores; it does not remove. The spec files claudemd added and you never
had — CLAUDE-extended.md, CLAUDE-changelog.md, OPERATOR.md — are left in place,
because removing spec files is what CLAUDEMD_SPEC_ACTION=delete does and that
path is gated behind CLAUDEMD_CONFIRM=1. Claude Code does not auto-load those
three, so they are inert residue; delete them by hand if you want them gone
(2026-09-05 audit Q-02, maintainer decision: document, do not widen restore).

Options:
  --help, -h     Print this message and exit.

Exit codes: 0 success | 1 uninstall failure | 2 argv-shape error.`;

export async function uninstall({ specAction = 'keep', confirmHardAuth = false, purge = false } = {}) {
  const m = readManifest();

  // Pre-flight abort checks — MUST run before any side effects so that an
  // aborted uninstall leaves settings.json / spec files / manifest untouched.
  if (specAction === 'delete' && !confirmHardAuth) {
    return { specAction: 'abort', reason: 'hard-AUTH confirmation required for delete' };
  }
  let restoreSource = null;
  if (specAction === 'restore') {
    const backups = listBackups();
    if (backups.length === 0) {
      return { specAction: 'abort', reason: 'no backups available to restore' };
    }
    restoreSource = backups[0].dir;
  }

  // D6 (v0.5.4): settings.json eviction runs UNCONDITIONALLY. Pre-fix this
  // step lived after the manifest-presence guard, so a missing/corrupt manifest
  // (≤0.1.4 user hand-deleted it; JSON unparseable; etc.) returned early
  // without clearing settings.json — exactly the case where pre-0.1.5 legacy
  // hook entries were most likely to survive. Manifest command match still
  // wins when available; the path-anchored backstop covers everything else.
  let settingsRemoved = 0;
  let settingsWarning = null;
  if (fs.existsSync(settingsPath())) {
    // An unparseable settings.json used to abort the ENTIRE uninstall
    // (readSettings throws; nothing below ran) — so a user who had left a
    // trailing comma in a file this plugin does not own could not remove the
    // plugin at all: exit 1, manifest still present, state still present, and
    // an error message that named the file but not a way forward
    // (2026-08-16 user-journey E2E). Since v0.1.5 the hooks live in the
    // plugin's own hooks/hooks.json and settings.json normally carries ZERO
    // claudemd entries, so this eviction is the least load-bearing step here.
    // Degrade it to a REPORTED skip and let the manifest / state / spec
    // disposition below complete. Silent skip would be worse than the abort.
    try {
      const s = readSettings();
      const pluginCommands = new Set((m.data?.entries || []).map(e => e.command));
      const r = unmergeHook(s, {
        commandPredicate: c => pluginCommands.has(c) || isClaudemdLegacyHookCommand(c, HOOK_BASENAMES),
      });
      settingsRemoved = r.removed;
      writeSettings(s);
    } catch (e) {
      // Name BOTH residues. settings.json is the only home for two things we
      // own — legacy hook entries AND the statusLine — and removeStatusline()
      // below reads the same file, so it fails on exactly this input too. A
      // warning that mentions only hooks tells the user the statusLine is gone
      // when claudemd still owns it (2026-08-16 pre-tag review).
      settingsWarning =
        `skipped settings.json eviction — ${settingsPath()} is not valid JSON (${e.message}). ` +
        `Uninstall continued, but anything claudemd owns INSIDE that file was left as-is: ` +
        `legacy hook entries and the statusLine. Fix the JSON and re-run /claudemd-uninstall.`;
      process.stderr.write(`[claudemd] WARN: ${settingsWarning}\n`);
    }
  }

  // StatusLine cleanup — runs unconditionally (like the settings eviction
  // above) so a manifest-less uninstall still un-wires our statusLine. No-op
  // when the slot is empty or owned by another provider.
  let statusline;
  try {
    statusline = removeStatusline();
  } catch (e) {
    statusline = { action: 'error', error: e.message };
  }
  // The failure used to live only in the returned JSON's `statusline.action`,
  // which nothing surfaces on the human path — so a statusLine we could not
  // un-wire went unmentioned while the command reported success.
  if (statusline.action === 'error') {
    process.stderr.write(
      `[claudemd] WARN: could not un-wire the statusLine (${statusline.error}). ` +
        `If ~/.claude/settings.json still names claudemd-statusline.sh, fix that file and re-run, ` +
        `or clear it with /claudemd-statusline remove.\n`
    );
  }

  // No manifest = no path forward for state/log/spec disposition (you can't
  // remove what you don't know about). settingsRemoved still surfaces the
  // partial outcome so callers can see the eviction did happen. specAction
  // is set to 'noop' (rather than omitted) so consumers can `.specAction`
  // unconditionally without a missing-key branch — same shape as the success
  // paths returning {specAction: 'keep'|'delete'|'restore'|'abort'}.
  if (!m.exists || !m.data) {
    return {
      specAction: 'noop',
      restored: null,
      warning: 'already-uninstalled',
      settingsRemoved,
      settingsWarning,
      statusline,
    };
  }
  const activeManifestPath = m.path;
  const legacyPath = legacyManifestPath();

  // 2. Spec file disposition
  let outcome = specAction;
  // What the restore actually put back. `null` = this run was not a restore;
  // `[]` = a restore that copied nothing. The two were indistinguishable in the
  // output until 2026-09-05 (audit ENG-01): restoreBackup has always returned
  // the list and this line has always dropped it, so a backup dir holding only
  // a dangling entry — which install itself produced for every stow-style
  // relative symlink — printed `specAction: "restore"`, exited 0, and left the
  // spec in place. The user reaches this command from install's own WARN, so a
  // false success here is the last thing standing between them and their
  // personal instructions.
  let restored = null;
  if (specAction === 'delete') {
    for (const p of specHome()) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } else if (specAction === 'restore') {
    restored = restoreBackup(restoreSource, backupRoot());
    if (restored.length === 0) {
      process.stderr.write(
        `[claudemd] WARN: restore read no files from ${restoreSource} — your ~/.claude spec ` +
          `files are UNCHANGED. Entries that cannot be opened (a backed-up symlink whose ` +
          `target has moved) are skipped. Check \`ls -l ${restoreSource}\`.\n`
      );
    }
  } else {
    outcome = 'keep';
  }

  // 3. Clean state + logs (per purge flag). Always unlink both the current
  // manifest path and any pre-0.1.9 legacy file — readManifest() migrated
  // legacy → new in-place, but if install.js never ran on the upgraded
  // version the legacy location could still exist as a stale copy.
  if (purge) {
    // Recursive delete only when the resolved path is OUR directory by name.
    //
    // stateDir() started honouring CLAUDEMD_STATE_DIR in 0.69.0 so the seam
    // would reach writers as well as readers. That change also turned this line
    // — a fixed `~/.claude/.claudemd-state` target since it was written — into
    // `rm -rf $VAR` with no validation, on a variable the clean-residue USAGE
    // advertises to anyone who runs `--help`. An operator who exports it to
    // inspect reaper behaviour and then runs the documented two-step uninstall
    // with CLAUDEMD_PURGE=1 loses that whole directory, recursively, including what
    // claudemd never put there. Caught in the v0.69.0 pre-tag review; §8's
    // "rm -rf $VAR without validating VAR" arriving through a testability seam.
    //
    // The guard keeps the seam usable — point it at `<fixture>/.claudemd-state`
    // and purge behaves exactly as in production — while a redirect to anything
    // else falls back to removing only the files claudemd is known to write.
    const sd = stateDir();
    if (path.basename(sd) === '.claudemd-state') {
      fs.rmSync(sd, { recursive: true, force: true });
    } else if (fs.existsSync(sd)) {
      // Named something else: never recurse. Drop only our own known shapes and
      // leave the directory (and anything else in it) alone.
      for (const name of fs.readdirSync(sd)) {
        if (!CLAUDEMD_STATE_FILE_RE.test(name)) continue;
        try {
          fs.rmSync(path.join(sd, name), { force: true });
        } catch {
          /* best-effort */
        }
      }
      console.error(
        `[claudemd] CLAUDEMD_STATE_DIR points at ${sd}, which is not named .claudemd-state — ` +
          `removed only claudemd's own state files there and left the directory in place.`
      );
    }
    if (fs.existsSync(activeManifestPath)) fs.unlinkSync(activeManifestPath);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    // ~/.claude/logs is shared with other plugins (e.g. claude-mem-lite) —
    // only drop OUR files, and remove the dir if it ends up empty.
    //
    // 2026-07-25 audit: this unlinked `claudemd.jsonl` alone, while rule-hits.sh
    // rotates to `claudemd.jsonl.1` / `.2` (up to ~10 MB) and session-start-check
    // writes `claudemd-bootstrap.log`. Those three survived the purge, and because
    // they did, the emptiness check below never fired either — so the documented
    // two-step uninstall still left claudemd-owned files with no in-tree tool
    // able to remove them.
    for (const name of fs.existsSync(logsDir()) ? fs.readdirSync(logsDir()) : []) {
      if (
        name === 'claudemd.jsonl' ||
        name.startsWith('claudemd.jsonl.') ||
        name === 'claudemd-bootstrap.log'
      ) {
        try {
          // A directory can carry one of these names: `claudemd.jsonl.rotating`
          // is the rotation lock (hooks/lib/rule-hits.sh). `unlinkSync` throws
          // EISDIR on it, the catch swallowed that, and the emptiness check
          // below then failed — so purge left both the lock and ~/.claude/logs
          // standing, the residue class this loop exists to close (2026-09-05
          // post-ship review, finding 3). `rmdirSync` and not a recursive
          // remove: the lock is always empty, and a directory here that is not
          // deserves to be left alone rather than walked.
          const target = path.join(logsDir(), name);
          if (fs.lstatSync(target).isDirectory()) fs.rmdirSync(target);
          else fs.unlinkSync(target);
        } catch {
          /* already gone, or a non-empty directory this loop will not recurse into */
        }
      }
    }
    try {
      if (fs.readdirSync(logsDir()).length === 0) fs.rmdirSync(logsDir());
    } catch {
      /* dir gone or unreadable — fine */
    }
  } else {
    if (fs.existsSync(activeManifestPath)) fs.unlinkSync(activeManifestPath);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  }

  const result = { specAction: outcome, restored, settingsRemoved, settingsWarning, statusline };
  // Same reasoning as the `warning: 'already-uninstalled'` return above: the
  // exit code and specAction say the requested disposition ran, and only this
  // field distinguishes "put your files back" from "found nothing to put back".
  if (restored && restored.length === 0) result.warning = 'restore-empty';
  return result;
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), UNINSTALL_USAGE);
  // No argv contract — uninstall reads from env. Loud-fail on unknown flags.
  parseStrictOrExit(process.argv.slice(2), {});
  // Whitelist, loudly. `Delete` (capitalised) and `restore ` (trailing space)
  // used to fall through to `keep`, exit 0, and report `specAction: "keep"` —
  // the caller asked for one disposition of their spec files and got the
  // opposite with no signal (audit R11-22). update.js already validates the
  // same-shaped env this way; the argv-lint family exists for exactly this
  // class of silent-fallback. Exit 1 = validation error, per this file's own
  // documented exit codes (2 is reserved for argv shape).
  const SPEC_ACTIONS = ['keep', 'delete', 'restore'];
  const specAction = process.env.CLAUDEMD_SPEC_ACTION ?? 'keep';
  if (!SPEC_ACTIONS.includes(specAction)) {
    console.error(
      `CLAUDEMD_SPEC_ACTION must be one of ${SPEC_ACTIONS.join(' | ')} (got ${JSON.stringify(specAction)}). ` +
        `Matching is exact — no case folding, no trimming.`
    );
    process.exit(1);
  }
  const confirmHardAuth = process.env.CLAUDEMD_CONFIRM === '1';
  const purge = process.env.CLAUDEMD_PURGE === '1';
  uninstall({ specAction, confirmHardAuth, purge })
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch(e => {
      console.error(`uninstall failed: ${e.message}`);
      process.exit(1);
    });
}
