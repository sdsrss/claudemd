import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings, unmergeHook, isClaudemdLegacyHookCommand } from './lib/settings-merge.js';
import { listBackups, restoreBackup } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome, backupRoot, readManifest, legacyManifestPath } from './lib/paths.js';
import { HOOK_BASENAMES } from './install.js';

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
  if (fs.existsSync(settingsPath())) {
    const s = readSettings();
    const pluginCommands = new Set((m.data?.entries || []).map(e => e.command));
    const r = unmergeHook(s, { commandPredicate: (c) =>
      pluginCommands.has(c) || isClaudemdLegacyHookCommand(c, HOOK_BASENAMES)
    });
    settingsRemoved = r.removed;
    writeSettings(s);
  }

  // No manifest = no path forward for state/log/spec disposition (you can't
  // remove what you don't know about). settingsRemoved still surfaces the
  // partial outcome so callers can see the eviction did happen.
  if (!m.exists || !m.data) {
    return { warning: 'already-uninstalled', settingsRemoved };
  }
  const activeManifestPath = m.path;
  const legacyPath = legacyManifestPath();

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

  return { specAction: outcome, settingsRemoved };
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
