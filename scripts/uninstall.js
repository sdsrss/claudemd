import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings, unmergeHook } from './lib/settings-merge.js';
import { listBackups, restoreBackup } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome, backupRoot, readManifest, legacyManifestPath } from './lib/paths.js';
import { HOOK_BASENAMES } from './install.js';

export async function uninstall({ specAction = 'keep', confirmHardAuth = false, purge = false } = {}) {
  const m = readManifest();
  if (!m.exists || !m.data) {
    return { warning: 'already-uninstalled' };
  }
  const manifest = m.data;
  const activeManifestPath = m.path;
  const legacyPath = legacyManifestPath();

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

  // 1. Remove settings.json entries. Manifest command match is the precise
  // path; HOOK_BASENAMES fallback catches env-var-form entries AND any stale
  // absolute-path entries the manifest didn't record (e.g. user hand-edit,
  // older-version leftovers).
  if (fs.existsSync(settingsPath())) {
    const s = readSettings();
    const pluginCommands = new Set(manifest.entries.map(e => e.command));
    unmergeHook(s, { commandPredicate: (c) =>
      pluginCommands.has(c) ||
      HOOK_BASENAMES.some(b => c.includes(`/hooks/${b}`))
    });
    writeSettings(s);
  }

  // 2. Spec file disposition
  let outcome = specAction;
  if (specAction === 'delete') {
    for (const p of specHome()) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } else if (specAction === 'restore') {
    restoreBackup(restoreSource, backupRoot());
  } else {
    outcome = 'keep';
  }

  // 3. Clean state + logs (per purge flag). Always unlink both the current
  // manifest path and any pre-0.1.9 legacy file — readManifest() migrated
  // legacy → new in-place, but if install.js never ran on the upgraded
  // version the legacy location could still exist as a stale copy.
  if (purge) {
    fs.rmSync(stateDir(), { recursive: true, force: true });
    if (fs.existsSync(activeManifestPath)) fs.unlinkSync(activeManifestPath);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    // ~/.claude/logs is shared with other plugins (e.g. claude-mem-lite) —
    // only drop our own jsonl, and remove the dir if it ends up empty.
    const ownLog = path.join(logsDir(), 'claudemd.jsonl');
    if (fs.existsSync(ownLog)) fs.unlinkSync(ownLog);
    try {
      if (fs.readdirSync(logsDir()).length === 0) fs.rmdirSync(logsDir());
    } catch { /* dir gone or unreadable — fine */ }
  } else {
    if (fs.existsSync(activeManifestPath)) fs.unlinkSync(activeManifestPath);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
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
