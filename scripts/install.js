import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, mergeHook, unmergeHook } from './lib/settings-merge.js';
import { createBackup, pruneBackups, isoStamp } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome, resolvePluginRoot, readPluginVersion } from './lib/paths.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

// Basenames shared with uninstall — used as the migration/cleanup discriminator
// so stale version-specific absolute-path entries get removed on upgrade.
export const HOOK_BASENAMES = [
  'banned-vocab-check.sh',
  'ship-baseline-check.sh',
  'memory-read-check.sh',
  'residue-audit.sh',
  'sandbox-disposal-check.sh',
];

// Commands reference ${CLAUDE_PLUGIN_ROOT} (expanded by the CC harness at hook
// invocation, per hooks docs "Variable Expansion in Hook Commands"). Storing
// the literal env-var means `/plugin update claudemd` keeps hooks pointed at
// the active version without manual re-registration.
const HOOK_SPECS = [
  { event: 'PreToolUse', matcher: 'Bash',
    command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh"', timeout: 3 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"', timeout: 5 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/memory-read-check.sh"', timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/residue-audit.sh"', timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-disposal-check.sh"', timeout: 3 },
];

export async function install({ pluginRoot = process.env.CLAUDE_PLUGIN_ROOT } = {}) {
  if (!pluginRoot) throw new Error('install: pluginRoot missing');

  // Ensure ~/.claude exists
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });

  // Spec: backup existing files if any, then copy fresh
  const existing = specHome().filter(p => fs.existsSync(p));
  let specResult, backupDir = null;
  if (existing.length === 0) {
    specResult = 'fresh';
  } else {
    const bk = createBackup(existing, { label: 'backup' });
    backupDir = bk.dir;
    pruneBackups(5);
    specResult = 'backup-and-overwrite';
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
  }

  // Settings: evict stale claudemd entries by hook basename so upgrades from
  // older absolute-path installs converge on the current ${CLAUDE_PLUGIN_ROOT}
  // form. Skipping this left duplicate/dead hooks in settings.json after
  // `/plugin update claudemd` bumped the version directory.
  const settings = fs.existsSync(settingsPath()) ? readSettings() : {};
  unmergeHook(settings, { commandPredicate: (c) =>
    HOOK_BASENAMES.some(b => c.includes(`/hooks/${b}`))
  });
  const entries = [];
  for (const spec of HOOK_SPECS) {
    const { entry } = mergeHook(settings, spec);
    entries.push({
      event: spec.event,
      matcher: spec.matcher,
      command: entry.command,
      sha256: crypto.createHash('sha256').update(entry.command).digest('hex'),
    });
  }
  writeSettings(settings);

  // State manifest
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(path.join(stateDir(), 'installed.json'), JSON.stringify({
    version: readPluginVersion(pluginRoot),
    installedAt: new Date().toISOString(),
    pluginRoot,
    entries,
  }, null, 2));

  // Logs directory + empty jsonl (touch only)
  fs.mkdirSync(logsDir(), { recursive: true });
  const log = path.join(logsDir(), 'claudemd.jsonl');
  if (!fs.existsSync(log)) fs.writeFileSync(log, '');

  return { spec: specResult, backupDir, settingsBackup, entries };
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
