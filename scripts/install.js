import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, mergeHook } from './lib/settings-merge.js';
import { createBackup, pruneBackups } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome } from './lib/paths.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

const HOOK_SPECS = (pluginRoot) => [
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/banned-vocab-check.sh"`, timeout: 3 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/ship-baseline-check.sh"`, timeout: 5 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/memory-read-check.sh"`, timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: `bash "${pluginRoot}/hooks/residue-audit.sh"`, timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: `bash "${pluginRoot}/hooks/sandbox-disposal-check.sh"`, timeout: 3 },
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

  // §2.7 safety: pre-merge backup of settings.json before any modification
  let settingsBackup = null;
  if (fs.existsSync(settingsPath())) {
    settingsBackup = `${settingsPath()}.claudemd-backup-${isoStamp()}`;
    fs.copyFileSync(settingsPath(), settingsBackup);
  }

  // Settings: merge hooks idempotently
  const settings = fs.existsSync(settingsPath()) ? readSettings() : {};
  const entries = [];
  for (const spec of HOOK_SPECS(pluginRoot)) {
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
    version: '0.1.0',
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

function isoStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+Z$/, 'Z');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  install().then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`install failed: ${e.message}`);
    process.exit(1);
  });
}
