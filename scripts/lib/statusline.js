import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings } from './settings-merge.js';
import { settingsPath, stateDir, homeSpec } from './paths.js';
import { backupSettingsFile } from './backup.js';
import { detectHost, HOST_ADAPTERS, CLAUDEMD_PROVIDER_ID } from './statusline-hosts.js';

// Ownership is a substring match on our stable renderer basename. A foreign
// statusLine command that happened to embed this exact substring would
// misclassify as ours — accepted: no other tool references this basename.
const MARKER = 'claudemd-statusline.sh';
const COMMAND = 'bash "$HOME/.claude/claudemd-statusline.sh"';

// Slot-owner command (CC runs it through a shell → $HOME expands).
// Guest command (a composite host runs it via execFileSync → no shell, only
// ~ expands, NOT $HOME) MUST be an absolute path, or it ENOENTs and blanks.
const GUEST_COMMAND = () => `bash "${destPath()}"`;

const destPath = () => homeSpec('claudemd-statusline.sh');
const prevPath = () => path.join(stateDir(), 'statusline-prev.json');
const shippedRenderer = (pluginRoot) => path.join(pluginRoot, 'scripts', 'statusline.sh');
const loadSettings = () => (fs.existsSync(settingsPath()) ? readSettings() : {});

export function detect(pluginRoot = null) {
  const settings = loadSettings();
  const present = settings.statusLine != null && settings.statusLine !== '';
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string'
    ? settings.statusLine.command
    : null;
  let verdict, host = null, providers = null, guestRegistered = false;
  if (!present) {
    verdict = 'absent';
  } else if (cmd && cmd.includes(MARKER)) {
    verdict = 'claudemd';
  } else {
    const adapter = cmd ? detectHost(cmd) : null;
    if (adapter) {
      verdict = 'host';
      host = adapter.id;
      providers = adapter.listProviders();
      guestRegistered = adapter.isRegistered(CLAUDEMD_PROVIDER_ID);
    } else {
      verdict = 'foreign';
    }
  }
  const dest = destPath();
  const exists = fs.existsSync(dest);
  let matchesShipped = false;
  if (pluginRoot && exists) {
    try {
      matchesShipped = fs.readFileSync(dest, 'utf8') === fs.readFileSync(shippedRenderer(pluginRoot), 'utf8');
    } catch { matchesShipped = false; }
  }
  return { verdict, host, current: cmd, providers, guestRegistered, dest: { exists, matchesShipped } };
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

export function adopt({ pluginRoot, force = false, emptyOnly = false, dryRun = false, supersede = null, backupSettings = true } = {}) {
  if (!pluginRoot) throw new Error('adopt: pluginRoot required');
  const { verdict, current, host } = detect(pluginRoot);

  if (verdict === 'claudemd') {
    if (dryRun) return { action: 'dry-run', from: current, to: current };
    copyRenderer(pluginRoot);
    return { action: 'refreshed', from: current, to: current };
  }

  if (verdict === 'host') {
    const adapter = HOST_ADAPTERS.find((a) => a.id === host);
    if (emptyOnly) return { action: 'host-detected', host: adapter.id, to: null };
    if (dryRun) return { action: 'dry-run', host: adapter.id, to: GUEST_COMMAND(), supersede };
    copyRenderer(pluginRoot);
    let superseded = null;
    if (supersede) {
      const prov = adapter.listProviders().find((p) => p.id === supersede);
      if (prov) {
        fs.mkdirSync(stateDir(), { recursive: true });
        fs.writeFileSync(prevPath(), JSON.stringify({ superseded: prov }, null, 2));
        adapter.unregister(supersede);
        superseded = prov.id;
      }
    }
    const changed = adapter.register(
      { id: CLAUDEMD_PROVIDER_ID, command: GUEST_COMMAND(), needsStdin: true },
      { front: true },
    );
    return { action: (changed || superseded) ? 'registered' : 'already-registered', host: adapter.id, to: GUEST_COMMAND(), superseded };
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
  // Clear any stale prev left by an earlier --force that was later undone
  // out-of-band, so a subsequent remove() empties this freshly-taken empty slot
  // instead of resurrecting the old foreign command.
  try { fs.unlinkSync(prevPath()); } catch { /* no stale prev to clear */ }
  copyRenderer(pluginRoot);
  setStatusLine();
  return { action: 'set', from: null, to: COMMAND, settingsBackup };
}

export function remove() {
  const d = detect();
  if (d.verdict === 'host' && d.guestRegistered) {
    const adapter = HOST_ADAPTERS.find((a) => a.id === d.host);
    adapter.unregister(CLAUDEMD_PROVIDER_ID);
    let restored = null;
    if (fs.existsSync(prevPath())) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
        if (prev && prev.superseded && prev.superseded.id) {
          adapter.register(prev.superseded, { front: true });
          restored = prev.superseded.id;
        }
      } catch { /* prev unreadable — just drop it */ }
      try { fs.unlinkSync(prevPath()); } catch { /* best-effort */ }
    }
    try { fs.unlinkSync(destPath()); } catch { /* best-effort */ }
    return { action: 'unregistered', host: d.host, restored };
  }
  const { verdict } = d;
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
