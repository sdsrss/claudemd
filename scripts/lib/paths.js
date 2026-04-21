import path from 'node:path';
import os from 'node:os';

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
