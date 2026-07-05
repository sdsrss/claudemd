import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings } from './settings-merge.js';
import { settingsPath, stateDir, homeSpec } from './paths.js';
import { backupSettingsFile } from './backup.js';

// Ownership is a substring match on our stable renderer basename. A foreign
// statusLine command that happened to embed this exact substring would
// misclassify as ours — accepted: no other tool references this basename.
const MARKER = 'claudemd-statusline.sh';
const COMMAND = 'bash "$HOME/.claude/claudemd-statusline.sh"';

const destPath = () => homeSpec('claudemd-statusline.sh');
const prevPath = () => path.join(stateDir(), 'statusline-prev.json');
const shippedRenderer = (pluginRoot) => path.join(pluginRoot, 'scripts', 'statusline.sh');
const loadSettings = () => (fs.existsSync(settingsPath()) ? readSettings() : {});

export function detect(pluginRoot = null) {
  const settings = loadSettings();
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string'
    ? settings.statusLine.command
    : null;
  const verdict = !cmd ? 'absent' : (cmd.includes(MARKER) ? 'claudemd' : 'foreign');
  const dest = destPath();
  const exists = fs.existsSync(dest);
  let matchesShipped = false;
  if (pluginRoot && exists) {
    try {
      matchesShipped = fs.readFileSync(dest, 'utf8') === fs.readFileSync(shippedRenderer(pluginRoot), 'utf8');
    } catch { matchesShipped = false; }
  }
  return { verdict, current: cmd, dest: { exists, matchesShipped } };
}

function copyRenderer(pluginRoot) {
  const dest = destPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(shippedRenderer(pluginRoot), dest);
  fs.chmodSync(dest, 0o755);
}

function setStatusLine() {
  const settings = loadSettings();
  settings.statusLine = { type: 'command', command: COMMAND };
  writeSettings(settings);
}

export function adopt({ pluginRoot, force = false, emptyOnly = false, dryRun = false, backupSettings = true } = {}) {
  if (!pluginRoot) throw new Error('adopt: pluginRoot required');
  const { verdict, current } = detect(pluginRoot);

  if (verdict === 'claudemd') {
    if (dryRun) return { action: 'dry-run', from: current, to: current };
    copyRenderer(pluginRoot);
    return { action: 'refreshed', from: current, to: current };
  }

  if (verdict === 'foreign') {
    if (emptyOnly) return { action: 'skipped-foreign', from: current, to: null };
    if (!force) return { action: 'foreign', from: current, to: null };
    if (dryRun) return { action: 'dry-run', from: current, to: COMMAND };
    const settingsBackup = backupSettings ? backupSettingsFile().backup : null;
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(prevPath(), JSON.stringify({ command: current }, null, 2));
    copyRenderer(pluginRoot);
    setStatusLine();
    return { action: 'replaced', from: current, to: COMMAND, settingsBackup };
  }

  // absent
  if (dryRun) return { action: 'dry-run', from: null, to: COMMAND };
  const settingsBackup = backupSettings ? backupSettingsFile().backup : null;
  copyRenderer(pluginRoot);
  setStatusLine();
  return { action: 'set', from: null, to: COMMAND, settingsBackup };
}

export function remove() {
  const { verdict } = detect();
  if (verdict !== 'claudemd') return { action: 'not-ours', restored: null };
  const settings = loadSettings();
  let action = 'removed';
  let restored = null;
  if (fs.existsSync(prevPath())) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
      if (prev && typeof prev.command === 'string') {
        settings.statusLine = { type: 'command', command: prev.command };
        restored = prev.command;
        action = 'restored';
      } else {
        delete settings.statusLine;
      }
    } catch {
      delete settings.statusLine;
    }
    try { fs.unlinkSync(prevPath()); } catch { /* best-effort */ }
  } else {
    delete settings.statusLine;
  }
  writeSettings(settings);
  try { fs.unlinkSync(destPath()); } catch { /* best-effort */ }
  return { action, restored };
}
