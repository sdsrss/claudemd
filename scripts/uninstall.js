import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings, unmergeHook } from './lib/settings-merge.js';
import { listBackups, restoreBackup } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome, backupRoot } from './lib/paths.js';

export async function uninstall({ specAction = 'keep', confirmHardAuth = false, purge = false } = {}) {
  const manifestPath = path.join(stateDir(), 'installed.json');
  if (!fs.existsSync(manifestPath)) {
    return { warning: 'already-uninstalled' };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. Remove settings.json entries by commandPredicate (manifest sha256 or path fallback)
  if (fs.existsSync(settingsPath())) {
    const s = readSettings();
    const pluginCommands = new Set(manifest.entries.map(e => e.command));
    unmergeHook(s, { commandPredicate: (c) =>
      pluginCommands.has(c) || c.includes('claudemd/hooks/')
    });
    writeSettings(s);
  }

  // 2. Spec file disposition
  let outcome = specAction;
  if (specAction === 'delete') {
    if (!confirmHardAuth) {
      return { specAction: 'abort', reason: 'hard-AUTH confirmation required for delete' };
    }
    for (const p of specHome()) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } else if (specAction === 'restore') {
    const backups = listBackups();
    if (backups.length === 0) {
      return { specAction: 'abort', reason: 'no backups available to restore' };
    }
    restoreBackup(backups[0].dir, backupRoot());
  } else {
    outcome = 'keep';
  }

  // 3. Clean state + logs (per purge flag)
  if (purge) {
    fs.rmSync(stateDir(), { recursive: true, force: true });
    fs.rmSync(logsDir(), { recursive: true, force: true });
  } else {
    fs.unlinkSync(manifestPath);
  }

  return { specAction: outcome };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const specAction = process.env.CLAUDEMD_SPEC_ACTION || 'keep';
  const confirmHardAuth = process.env.CLAUDEMD_CONFIRM === '1';
  const purge = process.env.CLAUDEMD_PURGE === '1';
  uninstall({ specAction, confirmHardAuth, purge }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`uninstall failed: ${e.message}`);
    process.exit(1);
  });
}
