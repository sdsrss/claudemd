import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const home = () => process.env.HOME || os.homedir();

export const pluginCacheDir = () => path.join(home(), '.claude/plugins/cache/claudemd');
export const stateDir       = () => path.join(home(), '.claude/.claudemd-state');
export const logsDir        = () => path.join(home(), '.claude/logs');
export const settingsPath   = () => path.join(home(), '.claude/settings.json');
export const backupRoot     = () => path.join(home(), '.claude');
export const specHome       = () => [
  path.join(home(), '.claude/CLAUDE.md'),
  path.join(home(), '.claude/CLAUDE-extended.md'),
  path.join(home(), '.claude/CLAUDE-changelog.md'),
];

export function resolvePluginRoot(importMetaUrl) {
  const explicit = process.env.CLAUDE_PLUGIN_ROOT;
  if (explicit) return explicit;
  const scriptsDir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(scriptsDir, '..');
}

export function readPluginVersion(pluginRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}
