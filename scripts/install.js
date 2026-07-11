import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, unmergeHook, isClaudemdLegacyHookCommand } from './lib/settings-merge.js';
import { createBackup, pruneBackups, backupSettingsFile } from './lib/backup.js';
import { pruneCache } from './lib/cache-prune.js';
import { stateDir, logsDir, settingsPath, specHome, resolvePluginRoot, readPluginVersion, readManifest, manifestPath, legacyManifestPath, SEMVER_RE, semverCmp } from './lib/paths.js';
import { HOOK_BASENAMES } from './lib/hook-registry.js';
import { adopt as adoptStatusline } from './lib/statusline.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md'];

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
// uninstall keep seeing the 8 shipped hooks after the v0.1.5 registration move.
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
      `(/plugin marketplace update claudemd, /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins), ` +
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
    const head = fs.readFileSync(claudeMdPath, 'utf8').slice(0, 256);
    if (!/^#\s*AI-CODING-SPEC\b/m.test(head)) {
      userContentDetected = true;
    }
  }
  // Is a claudemd spec already at ~/.claude/CLAUDE.md? Then the existing spec
  // files are claudemd's OWN — a no-op re-install OR a version upgrade — not
  // user content. There is nothing user-owned to preserve, so we do NOT back
  // them up.
  const claudeMdIsSpec = existing.includes(claudeMdPath) && !userContentDetected;
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
    // branch below), the personal backup is the SOLE backup → restore always
    // returns it and prune can never bury it. The prior spec version is
    // recoverable from git / the plugin cache / update.js's own backups.
    // (The earlier v0.23.11 "byte-identical only" guard left the upgrade path
    // broken — restore after any upgrade returned the old spec.)
    specResult = 'overwrite-spec';
  } else {
    const bk = createBackup(existing, { label: 'backup' });
    backupDir = bk.dir;
    pruneBackups(5);
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
  // Fail loudly if the shipped spec dir is incomplete — otherwise the silent
  // skip below would leave home-spec partially populated (or empty on a fresh
  // install) while still writing the manifest, leaving the user thinking the
  // install succeeded. Triggers seen in the wild: partial git checkout,
  // truncated tarball, CI packaging that excluded `spec/`.
  const missingSpecs = SPEC_FILES.filter(n => !fs.existsSync(path.join(pluginRoot, 'spec', n)));
  if (missingSpecs.length > 0) {
    throw new Error(
      `install: shipped spec missing in ${pluginRoot}/spec/: ${missingSpecs.join(', ')}. ` +
      `Plugin cache is incomplete — re-run \`/plugin install claudemd@claudemd\` or ` +
      `re-clone from https://github.com/sdsrss/claudemd.`
    );
  }
  for (const name of SPEC_FILES) {
    const src = path.join(pluginRoot, 'spec', name);
    const dest = path.join(path.dirname(settingsPath()), name);
    fs.copyFileSync(src, dest);
  }

  // 2a. Migrate hand-installed banned-vocab hook files (pre-plugin v0 artifact).
  // settings.json entries that referenced this path are cleaned up in step 2b
  // along with any other stale claudemd hook entries.
  const handHookFiles = [
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab-check.sh'),
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab.patterns'),
  ];
  const handExisting = handHookFiles.filter(fs.existsSync);
  if (handExisting.length > 0) {
    const migrateDir = backupDir || createBackup([], { label: 'backup' }).dir;
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
  unmergeHook(settings, {
    commandPredicate: (c) => isClaudemdLegacyHookCommand(c, HOOK_BASENAMES),
  });
  writeSettings(settings);

  // Manifest entries mirror the plugin's hooks/hooks.json so status/uninstall
  // keep a canonical list of the 8 shipped hooks even though settings.json no
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
  fs.mkdirSync(path.dirname(manifestPath()), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify({
    version: incomingVersion,
    installedAt: new Date().toISOString(),
    pluginRoot,
    entries,
  }, null, 2));
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
