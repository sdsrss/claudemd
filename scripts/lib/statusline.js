import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings } from './settings-merge.js';
import { settingsPath, stateDir, homeSpec } from './paths.js';
import { backupSettingsFile } from './backup.js';
import { detectHost, HOST_ADAPTERS, CLAUDEMD_PROVIDER_ID, manualPsCandidates } from './statusline-hosts.js';

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

// The supersede restore-record accepts both the current list shape
// ({superseded:[<prov>,…]}) and the legacy singular shape ({superseded:<prov>},
// written by ≤v0.26.1) so an upgrade taken mid-supersede still restores. Returns
// an array of provider objects with an id (possibly empty). A {command:…}
// foreign-takeover record (no `superseded` key) normalizes to [].
function readSupersededList() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8')); } catch { return []; }
  if (!prev || prev.superseded == null) return [];
  const arr = Array.isArray(prev.superseded) ? prev.superseded : [prev.superseded];
  return arr.filter((p) => p && p.id);
}

export function detect(pluginRoot = null) {
  const settings = loadSettings();
  // Presence — not command-parseability — decides absent-vs-occupied. A slot
  // holding ANY shape/command we don't recognise as ours is still someone
  // else's: a composite host we know how to guest-register under → 'host',
  // anything else → 'foreign'. Classifying either as 'absent' would let the
  // empty-slot install path clobber it, breaking the never-touch-a-foreign-slot
  // invariant. Only a missing / null / '' slot is genuinely 'absent'.
  const present = settings.statusLine != null && settings.statusLine !== '';
  const cmd = settings.statusLine && typeof settings.statusLine.command === 'string'
    ? settings.statusLine.command
    : null;
  let verdict, host = null, providers = null, guestRegistered = false, psCandidates = null;
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
      // Providers a user might want claudemd to supersede (hand-made PS1s). The
      // tested predicate is the single source of truth — the command surfaces
      // this field instead of re-deriving the heuristic in prose.
      psCandidates = manualPsCandidates(providers);
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
  return { verdict, host, current: cmd, providers, guestRegistered, psCandidates, dest: { exists, matchesShipped } };
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
    let supersedeMissed = null;
    if (supersede) {
      const prov = adapter.listProviders().find((p) => p.id === supersede);
      if (prov) {
        fs.mkdirSync(stateDir(), { recursive: true });
        // Append to a list (dedup by id) rather than overwrite, so a SECOND
        // --supersede does not clobber the first's restore record — remove()
        // restores EVERY superseded provider, not just the last. Without this,
        // `adopt --supersede=A` then `--supersede=B` left A unrecoverable.
        const list = fs.existsSync(prevPath()) ? readSupersededList() : [];
        if (!list.some((p) => p.id === prov.id)) list.push(prov);
        fs.writeFileSync(prevPath(), JSON.stringify({ superseded: list }, null, 2));
        adapter.unregister(supersede);
        superseded = prov.id;
      } else {
        // Requested a supersede target not in the registry (stale id, or a TOCTOU
        // change since detect). Don't fail the register — surface the miss so the
        // caller/CLI can tell the user nothing was superseded.
        supersedeMissed = supersede;
      }
    }
    const changed = adapter.register(
      { id: CLAUDEMD_PROVIDER_ID, command: GUEST_COMMAND(), needsStdin: true },
      { front: true },
    );
    return { action: (changed || superseded) ? 'registered' : 'already-registered', host: adapter.id, to: GUEST_COMMAND(), superseded, ...(supersedeMissed ? { supersedeMissed } : {}) };
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
      // Restore EVERY superseded provider (list shape; legacy singular tolerated).
      // Reverse order + front-insert so they regain their original relative
      // order: the last superseded, restored first, ends up behind the earlier
      // ones. `restored` is a comma-joined id list (single case → the one id).
      const list = readSupersededList();
      for (let i = list.length - 1; i >= 0; i--) {
        adapter.register(list[i], { front: true });
      }
      if (list.length) restored = list.map((p) => p.id).join(',');
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
