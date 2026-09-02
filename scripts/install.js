import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, unmergeHook, isClaudemdLegacyHookCommand } from './lib/settings-merge.js';
import { createBackup, pruneBackups, backupSettingsFile, looksLikeSpec, BACKUP_LABELS } from './lib/backup.js';
import { pruneCache } from './lib/cache-prune.js';
import { stateDir, logsDir, settingsPath, specHome, resolvePluginRoot, readPluginVersion, readManifest, manifestPath, legacyManifestPath, writeJsonAtomic, SEMVER_RE, semverCmp, SPEC_FILES } from './lib/paths.js';
import { HOOK_BASENAMES } from './lib/hook-registry.js';
import { copySpecFiles } from './lib/spec-hash.js';
import { adopt as adoptStatusline } from './lib/statusline.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';



const INSTALL_USAGE = `Usage: node scripts/install.js

Install claudemd hooks + spec from the plugin cache into ~/.claude/. Idempotent
(safe to re-run). Wired by Claude Code's plugin install lifecycle.

No flags. Behavior is read from the plugin cache + the following env vars:
  CLAUDEMD_NO_STATUSLINE=1      skip statusLine auto-adopt
  CLAUDEMD_ALLOW_DOWNGRADE=1    permit installing a version OLDER than the
                                manifest records (deliberate rollback; without
                                it a stale-cache-dir run is refused)

Options:
  --help, -h     Print this message and exit.

Exit codes: 0 success | 1 install failure | 2 argv-shape error.`;

// Re-export for back-compat: tests/scripts/install.test.js + scripts/uninstall.js
// previously imported HOOK_BASENAMES from this module. Source of truth now lives
// in scripts/lib/hook-registry.js; drift between registry, hooks/hooks.json, and
// commands/claudemd-toggle.md is gated by tests/scripts/hook-registry.test.js.
export { HOOK_BASENAMES };

// Flatten the plugin's hooks/hooks.json into the same {event,matcher,command,timeout}
// shape previously held in HOOK_SPECS. Used to populate the manifest so status/
// uninstall keep seeing the shipped hooks (hooks/hooks.json is the source of
// truth for the set) after the v0.1.5 registration move.
function readPluginHookSpecs(pluginRoot) {
  const hooksFile = path.join(pluginRoot, 'hooks/hooks.json');
  if (!fs.existsSync(hooksFile)) return [];
  const data = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  const specs = [];
  for (const [event, blocks] of Object.entries(data.hooks || {})) {
    for (const block of blocks) {
      for (const h of block.hooks || []) {
        specs.push({ event, matcher: block.matcher, command: h.command, timeout: h.timeout });
      }
    }
  }
  return specs;
}

export async function install({ pluginRoot = process.env.CLAUDE_PLUGIN_ROOT } = {}) {
  if (!pluginRoot) throw new Error('install: pluginRoot missing');

  // v0.36.0 — never-downgrade guard (tasks/manifest-pluginroot-stale-cache.md,
  // reproduced 2026-07-11). CC keeps versioned plugin cache dirs around and can
  // fire hooks from a STALE one after an upgrade; the bootstrap hooks'
  // direction-blind version comparison then ran THIS function from the old
  // root, regressing ~/.claude spec + manifest every session (observed as
  // v6.16.0 / v6.15.1 flapping). install.js is the choke point every AUTOMATIC
  // sync path funnels through (SessionStart bootstrap, UserPromptSubmit
  // piggy-back, manual runs from any cache dir), so the refusal lives here.
  // update.js stays a separate USER-gated spec writer (diff shown first,
  // explicit CLAUDEMD_UPDATE_CHOICE=apply-all) and is intentionally outside
  // this guard — documented in tasks/manifest-pluginroot-stale-cache.md. The
  // check runs before any other mutation (readManifest() itself may relocate
  // a pre-0.1.9 legacy manifest file — lossless, documented side effect).
  // Deliberate rollbacks stay possible via CLAUDEMD_ALLOW_DOWNGRADE=1.
  // Non-semver versions (dev-mode 'unknown', test fixtures) skip the guard —
  // fail-open, never fail-block.
  const incomingVersion = readPluginVersion(pluginRoot);
  const priorManifest = readManifest();
  const installedVersion = priorManifest.exists && priorManifest.data?.version
    ? String(priorManifest.data.version)
    : null;
  if (installedVersion
      && SEMVER_RE.test(incomingVersion) && SEMVER_RE.test(installedVersion)
      && semverCmp(incomingVersion, installedVersion) < 0
      && process.env.CLAUDEMD_ALLOW_DOWNGRADE !== '1') {
    throw new Error(
      `install: refusing downgrade — this plugin root is v${incomingVersion} but the installed manifest records v${installedVersion}. ` +
      `A hook or script is likely running from a stale versioned cache dir. Refresh the plugin registration ` +
      `(/claudemd-refresh — or manually: /plugin marketplace update claudemd, /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins), ` +
      `or set CLAUDEMD_ALLOW_DOWNGRADE=1 to force a rollback from ${pluginRoot}.`
    );
  }

  // Ensure ~/.claude exists
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });

  // Spec: backup existing files if any, then copy fresh.
  // D7 (v0.5.3): detect "personal user-global instructions" before the
  // overwrite. ~/.claude/CLAUDE.md is shared real estate — both this plugin's
  // spec and the user's hand-written CC user-global instructions live there.
  // If existing CLAUDE.md lacks the canonical `# AI-CODING-SPEC vX.Y.Z — Core`
  // H1, the user almost certainly didn't write it as a claudemd spec; we
  // still backup-and-overwrite (previous v0.5.2 behavior unchanged), but
  // flag it loudly via stderr so the user knows where their content went and
  // how to restore it. No silent data loss vector either way — backup-<ISO>/
  // always carries the original.
  const existing = specHome().filter(p => fs.existsSync(p));
  const claudeMdPath = specHome()[0]; // ~/.claude/CLAUDE.md by convention
  let userContentDetected = false;
  if (existing.includes(claudeMdPath)) {
    // Shared predicate — the legacy-backup migration below infers "install.js
    // did not write this dir" from the fact that install.js never backs up a
    // spec-shaped file. Two spellings of the same test would let that inference
    // rot silently, so both callers ask backup.js.
    if (!looksLikeSpec(fs.readFileSync(claudeMdPath, 'utf8'))) {
      userContentDetected = true;
    }
  }
  // Is a claudemd spec already at ~/.claude/CLAUDE.md? Then the existing spec
  // files are claudemd's OWN — a no-op re-install OR a version upgrade — not
  // user content. There is nothing user-owned to preserve, so we do NOT back
  // them up.
  const claudeMdIsSpec = existing.includes(claudeMdPath) && !userContentDetected;

  // SCRIPT-1 (2026-07-12 audit): validate the shipped spec is COMPLETE *before*
  // the backup branch below moves the user's ~/.claude/CLAUDE.md (createBackup
  // uses renameSync). Pre-fix this ran AFTER the move, so an incomplete plugin
  // checkout (partial git checkout / truncated tarball / CI packaging that
  // excluded spec/) left the user's home spec only in the backup dir, the home
  // path empty, and the manifest unwritten — recoverable but alarming. Fail
  // before touching anything the user owns.
  const missingSpecs = SPEC_FILES.filter(n => !fs.existsSync(path.join(pluginRoot, 'spec', n)));
  if (missingSpecs.length > 0) {
    throw new Error(
      `install: shipped spec missing in ${pluginRoot}/spec/: ${missingSpecs.join(', ')}. ` +
      `Plugin cache is incomplete — re-run \`/plugin install claudemd@claudemd\` or ` +
      `re-clone from https://github.com/sdsrss/claudemd.`
    );
  }

  // Same completeness contract for the HOOK manifest (2026-07-25 audit). The
  // spec check above existed because a truncated checkout is a real failure mode,
  // but hooks/hooks.json had no equivalent: readPluginHookSpecs returned [] for a
  // missing file and threw an unguarded SyntaxError for a malformed one — and it
  // runs AFTER the spec files are copied and settings.json is rewritten, i.e.
  // past the point of no return. A missing manifest therefore installed cleanly
  // with ZERO hooks, and because the manifest version still matched package.json,
  // the SessionStart bootstrap read that as healthy and never retried: enforcement
  // silently off while /claudemd-status reported installed. Validate here, before
  // anything the user owns is touched.
  const hooksFile = path.join(pluginRoot, 'hooks/hooks.json');
  if (!fs.existsSync(hooksFile)) {
    throw new Error(
      `install: hook manifest missing at ${hooksFile}. Plugin cache is incomplete — ` +
      `installing would register 0 hooks and report success. Re-run ` +
      `\`/plugin install claudemd@claudemd\` or re-clone from https://github.com/sdsrss/claudemd.`
    );
  }
  let hookSpecCount = 0;
  try {
    hookSpecCount = readPluginHookSpecs(pluginRoot).length;
  } catch (e) {
    throw new Error(
      `install: hook manifest at ${hooksFile} is not valid JSON (${e.message}). ` +
      `Refusing to install — re-run \`/plugin install claudemd@claudemd\`.`
    );
  }
  if (hookSpecCount === 0) {
    throw new Error(
      `install: hook manifest at ${hooksFile} declares no hooks. Refusing to install a ` +
      `hook-less claudemd — it would report success with enforcement disabled.`
    );
  }

  // Same fail-before-you-touch contract as the two checks above, applied to the
  // one USER-side precondition this function has (2026-08-16 user-journey E2E).
  // The pre-flight block validated only the PLUGIN side; settings.json was
  // parsed ~80 lines later, at its point of use — which is AFTER createBackup()
  // has renameSync'd the user's personal ~/.claude/CLAUDE.md into backup-<ts>/
  // and the spec has overwritten it. An unparseable settings.json (a trailing
  // comma from a hand-edit is the common shape) therefore produced: personal
  // CLAUDE.md moved, spec installed, manifest NEVER written. That state does not
  // self-heal — the manifest is what SessionStart keys on, so every subsequent
  // session re-spawns the same doomed background install, and the banner it
  // eventually shows points at /claudemd-refresh, which cannot fix JSON syntax
  // in a file this plugin does not own. Validate here, before anything moves.
  if (fs.existsSync(settingsPath())) {
    try {
      readSettings();
    } catch (e) {
      throw new Error(
        `install: ${settingsPath()} is not valid JSON (${e.message}). Refusing to install — ` +
        `the install rewrites this file and would otherwise leave a half-installed state. ` +
        `Fix the JSON (a trailing comma is the usual cause) or move the file aside, then re-run. ` +
        `A pre-existing backup may be available as ${settingsPath()}.claudemd-backup-*.`
      );
    }
  }

  // NOTE: install does NOT migrate pre-0.68.3 spec backups out of the personal
  // namespace. A migration was written and withdrawn — the reasoning is in
  // backup.js#findLegacySpecBackups; the short form is that its discriminator
  // was not an invariant, and moving on it could delete user content. doctor
  // reports the condition instead. Do not re-add a mover here without reading
  // tasks/legacy-spec-backup-migration.md.
  let specResult, backupDir = null;
  if (existing.length === 0) {
    specResult = 'fresh';
  } else if (claudeMdIsSpec) {
    // DATA-LOSS ROOT-CAUSE FIX (v0.23.11): never back up spec-on-spec — neither
    // a byte-identical re-install NOR a version upgrade. Pre-fix BOTH created a
    // backup of the spec itself; restore picks the NEWEST backup (uninstall.js)
    // and pruneBackups(5) evicts the oldest, so `CLAUDEMD_SPEC_ACTION=restore`
    // after a re-install OR an upgrade restored the SPEC instead of the user's
    // original personal CLAUDE.md, and enough of them permanently evicted the
    // personal backup. By only ever backing up genuine user content (the no-H1
    // branch below), the personal backup is the SOLE backup in the `backup-`
    // namespace → restore always returns it and prune can never bury it. That
    // claim was false between v0.23.11 and v0.68.2 because update.js wrote the
    // SAME namespace; it now uses BACKUP_LABELS.spec (audit-2026-08-22 P1-1).
    // The prior spec version is recoverable from git / the plugin cache /
    // update.js's own `spec-backup-` dirs.
    // (The earlier v0.23.11 "byte-identical only" guard left the upgrade path
    // broken — restore after any upgrade returned the old spec.)
    specResult = 'overwrite-spec';
  } else {
    const bk = createBackup(existing, { label: BACKUP_LABELS.personal });
    backupDir = bk.dir;
    pruneBackups(5, { label: BACKUP_LABELS.personal });
    specResult = 'backup-and-overwrite';
    if (userContentDetected) {
      process.stderr.write(
        `[claudemd] WARN: existing ~/.claude/CLAUDE.md does not look like a claudemd spec ` +
        `(no "# AI-CODING-SPEC" H1 in first 256 bytes). It looks like personal user-global ` +
        `instructions and was backed up to ${backupDir}/CLAUDE.md before being overwritten ` +
        `with the plugin spec. To bring your content back on uninstall, run ` +
        `\`CLAUDEMD_SPEC_ACTION=restore /claudemd-uninstall\`.\n`
      );
    }
  }
  // Completeness of the shipped spec was validated above (before any backup
  // move). Copy each file, then assert the installed bytes match the source —
  // a closing integrity check (SCRIPT-1) so a partial/failed copyFileSync that
  // does not throw surfaces HERE, not on the next `/claudemd-doctor` run.
  // Shared with update.js since R11-09 — this loop and update's bare
  // copyFileSync were two semantics for one operation, and update's had no
  // integrity check at all. Also drops install's third hand-rolled sha256:
  // spec-hash.js#sha256File was already the single source.
  // backupDir is passed, not omitted (0.71.4 pre-tag review): the branch that
  // sets it is the one that renameSync'd the user's PERSONAL ~/.claude/CLAUDE.md
  // away, so this is the call site where a mid-loop failure risks user-authored
  // content rather than a re-copyable shipped spec. It is null on the
  // overwrite-spec branch, which is the correct no-rollback case.
  copySpecFiles(pluginRoot, SPEC_FILES, { backupDir });

  // 2a. Migrate hand-installed banned-vocab hook files (pre-plugin v0 artifact).
  // settings.json entries that referenced this path are cleaned up in step 2b
  // along with any other stale claudemd hook entries.
  const handHookFiles = [
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab-check.sh'),
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab.patterns'),
  ];
  const handExisting = handHookFiles.filter(fs.existsSync);
  if (handExisting.length > 0) {
    // Reuse the personal backup dir when there is one — the hand-hook files
    // then sit in a `hooks/` subdir NEXT TO the restorable CLAUDE.md. With no
    // personal backup, a fresh `backup-` dir here would be the newest one and
    // EMPTY at depth 1 (restoreBackup copies files only), so restore returned
    // zero files while the real personal backup sat one slot down. Its own
    // namespace keeps it out of the restore path entirely (P1-1, second arm).
    const migrateDir = backupDir || createBackup([], { label: BACKUP_LABELS.handHook }).dir;
    const hooksSubdir = path.join(migrateDir, 'hooks');
    fs.mkdirSync(hooksSubdir, { recursive: true });
    for (const src of handExisting) {
      fs.renameSync(src, path.join(hooksSubdir, path.basename(src)));
    }
    backupDir = migrateDir;
  }

  // §2.7 safety: pre-merge backup of settings.json before any modification.
  const { backup: settingsBackup, pruned: settingsBackupsPruned } = backupSettingsFile(5);

  // Settings: evict ANY claudemd hook command from settings.json by basename.
  // Hooks now live in the plugin's hooks/hooks.json where ${CLAUDE_PLUGIN_ROOT}
  // actually expands (CC only resolves that variable for plugin-owned
  // hooks/hooks.json, not for entries in settings.json — see hooks docs
  // "Variable Expansion in Hook Commands"). Pre-0.1.5 installs wrote commands
  // into settings.json under either literal ${CLAUDE_PLUGIN_ROOT} (0.1.2-0.1.4,
  // which the harness refused to run) or absolute version-dir paths (≤0.1.1,
  // which went stale when CC swapped in a new version-dir on upgrade). Both
  // are evicted here; no merge back.
  const settings = fs.existsSync(settingsPath()) ? readSettings() : {};
  // D6 (v0.5.4): path-anchored predicate (lib/settings-merge.js) replaces
  // the old substring match — narrows eviction to claudemd's three legacy
  // residue forms and never touches a same-basename hook from another plugin.
  // Write ONLY when eviction actually removed something (2026-09-02 audit
  // R11-08). Steady state has been removed=0 since v0.1.5, yet every
  // version-mismatch SessionStart fired a background install that rewrote the
  // user's settings.json anyway — re-ordering keys, stripping the BOM, and
  // racing Claude Code's own writes to the same file for no gain.
  const evicted = unmergeHook(settings, {
    commandPredicate: (c) => isClaudemdLegacyHookCommand(c, HOOK_BASENAMES),
  });
  // …or when there is no settings.json yet. Skipping the write outright meant a
  // fresh machine never got the file created, and `doctor.js:140` reports a
  // MISSING settings.json as a failing check (exit 3) — `/claudemd-doctor` was
  // red out of the box, and doctor's §4 routing check, guarded on the file
  // existing, was skipped as well. Caught by the 0.71.4 pre-tag review.
  if (evicted.removed > 0 || !fs.existsSync(settingsPath())) writeSettings(settings);

  // Manifest entries mirror the plugin's hooks/hooks.json so status/uninstall
  // keep a canonical list of the shipped hooks even though settings.json no
  // longer carries them. Command sha256 is stable (same literal across versions).
  const hookSpecs = readPluginHookSpecs(pluginRoot);
  const entries = hookSpecs.map(s => ({
    event: s.event,
    matcher: s.matcher,
    command: s.command,
    sha256: crypto.createHash('sha256').update(s.command).digest('hex'),
  }));

  // State manifest — written at ~/.claude/.claudemd-manifest.json so that
  // blowing away the runtime state dir (tmp-baseline.txt / session-start.ref)
  // does not erase the install record. Pre-0.1.9 installs wrote to
  // stateDir()/installed.json; that legacy file is removed here to keep the
  // filesystem tidy when upgrading.
  fs.mkdirSync(stateDir(), { recursive: true });
  // Atomic (R11-10): the manifest is the key SessionStart and version-sync read
  // to decide "installed?" — a torn write reads back as absent and spawns
  // another install.
  writeJsonAtomic(manifestPath(), {
    version: incomingVersion,
    installedAt: new Date().toISOString(),
    pluginRoot,
    entries,
  });
  if (fs.existsSync(legacyManifestPath())) {
    try { fs.unlinkSync(legacyManifestPath()); } catch { /* stale legacy ok */ }
  }

  // Logs directory + empty jsonl (touch only)
  fs.mkdirSync(logsDir(), { recursive: true });
  const log = path.join(logsDir(), 'claudemd.jsonl');
  if (!fs.existsSync(log)) fs.writeFileSync(log, '');

  // Cache pruning: keep 3 newest version dirs (including current), drop older.
  // Best-effort — install has already succeeded; a prune failure must not
  // void that outcome, so the call is wrapped. `pruneCache` is a no-op when
  // pluginRoot basename is not semver (dev-mode via `node scripts/install.js`).
  let cachePruned = { kept: [], removed: [], skipped: 'not-attempted' };
  try { cachePruned = pruneCache(pluginRoot, { keep: 3 }); }
  catch { /* install succeeded — swallow prune FS errors */ }

  // StatusLine auto-adopt — empty-slot-only (never clobbers a foreign provider),
  // opt-out via CLAUDEMD_NO_STATUSLINE. best-effort: a statusline failure must
  // never fail the install (same posture as cachePrune). settings.json was
  // already backed up above, so backupSettings:false.
  let statusline;
  if (process.env.CLAUDEMD_NO_STATUSLINE === '1') {
    statusline = { action: 'opted-out' };
  } else {
    try {
      statusline = adoptStatusline({ pluginRoot, emptyOnly: true, backupSettings: false });
    } catch (e) {
      statusline = { action: 'error', error: e.message };
    }
  }
  if (statusline.action === 'set') {
    process.stderr.write('[claudemd] statusLine set (user@host:path (branch) model [ctx:N% · 5h:N% · 7d:N%]). Undo: /claudemd-statusline remove\n');
  } else if (statusline.action === 'host-detected') {
    process.stderr.write(`[claudemd] statusLine owned by a composite host (${statusline.host}) — run /claudemd-statusline to add claudemd's segment alongside it.\n`);
  } else if (statusline.action === 'skipped-foreign') {
    process.stderr.write('[claudemd] statusLine already owned by another provider — left untouched. Take over: /claudemd-statusline --force\n');
  } else if (statusline.action === 'error') {
    process.stderr.write(`[claudemd] statusLine setup skipped (${statusline.error}). The renderer may be missing from the package; run /claudemd-statusline after reinstalling.\n`);
  }

  return { spec: specResult, backupDir, settingsBackup, settingsBackupsPruned, entries, cachePruned, userContentDetected, statusline };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), INSTALL_USAGE);
  // No argv contract — install reads from plugin cache + env. Loud-fail on
  // unknown flags so a typo (e.g. `--help` pre-fix) doesn't silently RUN
  // the install destructively. Same silent-fallback family as Round-1
  // status.js / lint-argv.js.
  try {
    parseStrict(process.argv.slice(2), {});
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  install({ pluginRoot }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`install failed: ${e.message}`);
    process.exit(1);
  });
}
