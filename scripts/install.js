import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, unmergeHook, isClaudemdLegacyHookCommand } from './lib/settings-merge.js';
import { createBackup, pruneBackups, pruneSettingsBackups, isoStamp } from './lib/backup.js';
import { pruneCache } from './lib/cache-prune.js';
import { stateDir, logsDir, settingsPath, specHome, resolvePluginRoot, readPluginVersion, manifestPath, legacyManifestPath } from './lib/paths.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

// Basenames shared with uninstall — used as the cleanup discriminator so stale
// entries from ≤0.1.4 installs (which wrote hook commands into settings.json
// under ${CLAUDE_PLUGIN_ROOT} or absolute version-dir paths) get evicted on
// upgrade. The source of truth for registered hooks is now the plugin's
// hooks/hooks.json; settings.json should contain NO claudemd hook commands.
export const HOOK_BASENAMES = [
  'banned-vocab-check.sh',
  'ship-baseline-check.sh',
  'memory-read-check.sh',
  'pre-bash-safety-check.sh',
  'residue-audit.sh',
  'sandbox-disposal-check.sh',
  'session-start-check.sh',
  'version-sync.sh',
];

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
  let specResult, backupDir = null;
  if (existing.length === 0) {
    specResult = 'fresh';
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
  for (const name of SPEC_FILES) {
    const src = path.join(pluginRoot, 'spec', name);
    const dest = path.join(path.dirname(settingsPath()), name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
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

  // §2.7 safety: pre-merge backup of settings.json before any modification
  let settingsBackup = null;
  let settingsBackupsPruned = [];
  if (fs.existsSync(settingsPath())) {
    let candidate = `${settingsPath()}.claudemd-backup-${isoStamp()}`;
    if (fs.existsSync(candidate)) {
      for (let i = 1; i < 1000; i++) {
        const next = `${candidate}-${i}`;
        if (!fs.existsSync(next)) { candidate = next; break; }
      }
    }
    settingsBackup = candidate;
    fs.copyFileSync(settingsPath(), settingsBackup);
    // Retention: keep 5 newest pre-merge backups, drop older. Without this,
    // N installs leave N `.claudemd-backup-*` files indefinitely —
    // `/claudemd-doctor --prune-backups` only touches `backup-<ISO>/` dirs,
    // never these sibling files.
    settingsBackupsPruned = pruneSettingsBackups(5);
  }

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
    version: readPluginVersion(pluginRoot),
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

  return { spec: specResult, backupDir, settingsBackup, settingsBackupsPruned, entries, cachePruned, userContentDetected };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pluginRoot = resolvePluginRoot(import.meta.url);
  install({ pluginRoot }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`install failed: ${e.message}`);
    process.exit(1);
  });
}
