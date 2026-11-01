import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings, settingsShapeError } from './settings-merge.js';
import { claudeHome, settingsPath, stateDir } from './paths.js';
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

const destPath = () => claudeHome('claudemd-statusline.sh');
const prevPath = () => path.join(stateDir(), 'statusline-prev.json');
const shippedRenderer = pluginRoot => path.join(pluginRoot, 'scripts', 'statusline.sh');
const rawSettings = () => (fs.existsSync(settingsPath()) ? readSettings() : {});
// A settings.json that parses to null or an array holds no statusLine, so
// readers see `{}`; adopt refuses it before writing (defect 173): null crashed
// every reader, and on an array JSON.stringify drops the key adopt sets, so it
// reported `set` having written nothing.
function loadSettings() {
  const s = rawSettings();
  return settingsShapeError(s) ? {} : s;
}

// The supersede restore-record accepts both the current list shape
// ({superseded:[<prov>,…]}) and the legacy singular shape ({superseded:<prov>},
// written by ≤v0.26.1) so an upgrade taken mid-supersede still restores. Returns
// an array of provider objects with an id (possibly empty). A {command:…}
// foreign-takeover record (no `superseded` key) normalizes to [].
function readSupersededList() {
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
  } catch {
    return [];
  }
  if (!prev || prev.superseded == null) return [];
  const arr = Array.isArray(prev.superseded) ? prev.superseded : [prev.superseded];
  // Our own entry is never a saved provider (D#628): adopt refuses
  // `--supersede=claudemd` now, but a record an older version wrote holds it,
  // and restoring it registered our entry over a renderer remove() deleted.
  return arr.filter(p => p && p.id && p.id !== CLAUDEMD_PROVIDER_ID);
}

// remove() restores a saved provider only when no live one has its id (D#628):
// register replaces by id, so restoring would overwrite the entry the host runs
// now, possibly one that runs our file. detect() predicts with the same split.
function splitRestorable(saved, liveProviders) {
  const live = new Set((liveProviders || []).map(p => p?.id));
  return {
    restore: saved.filter(p => !live.has(p.id)),
    blocked: saved.filter(p => live.has(p.id)),
  };
}

// Host providers, other than our own guest entry, whose command runs our file:
// the same MARKER test detect() applies to the slot. Ids only; code-graph's
// composite runs an entry that has no id too, so one counts, under a label
// (D#618: it was listed as undefined, null in --json).
const NO_ID = '(no id)';
function othersRunningRenderer(providers) {
  return (providers || [])
    .filter(
      p => p?.id !== CLAUDEMD_PROVIDER_ID && typeof p?.command === 'string' && p.command.includes(MARKER)
    )
    .map(p => (typeof p.id === 'string' && p.id !== '' ? p.id : NO_ID));
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
  const cmd =
    settings.statusLine && typeof settings.statusLine.command === 'string'
      ? settings.statusLine.command
      : null;
  let verdict,
    host = null,
    providers = null,
    guestRegistered = false,
    psCandidates = null;
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
  // Whether anything renders through our file, whatever id it is under: the slot
  // itself, our guest entry, or another provider running our command. code-graph
  // keeps a slot it took over as provider `_previous`, so claudemd's command can
  // run there with claudemd not registered (D#599). Same test as the slot's own.
  // `rendererRunBy` lists the host providers OTHER than our guest entry that run
  // it: remove() keeps the file for them, and doctor does not offer remove as a
  // fix while they do (0.117.1 pre-tag review M1).
  const rendererRunBy = verdict === 'host' ? othersRunningRenderer(providers) : [];
  const rendererInUse =
    verdict === 'claudemd' || (verdict === 'host' && (guestRegistered || rendererRunBy.length > 0));
  // Superseded providers remove() would put back that run our file, so it keeps
  // the file for them too (D#618: after `adopt --supersede=_previous` the
  // registry shows only our entry). remove() restores only under our guest
  // entry, and not over a live provider with the same id (D#628). Not part of
  // rendererInUse: none of them renders until restored.
  const rendererRestoredBy =
    verdict === 'host' && guestRegistered
      ? othersRunningRenderer(splitRestorable(readSupersededList(), providers).restore)
      : [];
  const dest = destPath();
  const exists = fs.existsSync(dest);
  let matchesShipped = false;
  if (pluginRoot && exists) {
    try {
      matchesShipped = fs.readFileSync(dest, 'utf8') === fs.readFileSync(shippedRenderer(pluginRoot), 'utf8');
    } catch {
      matchesShipped = false;
    }
  }
  return {
    verdict,
    host,
    current: cmd,
    providers,
    guestRegistered,
    rendererInUse,
    rendererRunBy,
    rendererRestoredBy,
    psCandidates,
    dest: { exists, matchesShipped },
  };
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

export function adopt({
  pluginRoot,
  force = false,
  emptyOnly = false,
  dryRun = false,
  supersede = null,
  backupSettings = true,
} = {}) {
  if (!pluginRoot) throw new Error('adopt: pluginRoot required');
  // D#628: superseding our own guest entry saved it in the restore record, and
  // remove() then registered it again over a renderer it had just deleted.
  if (supersede === CLAUDEMD_PROVIDER_ID) {
    throw new Error(
      `statusline: cannot supersede claudemd's own entry ('${CLAUDEMD_PROVIDER_ID}'); ` +
        `--supersede takes the id of another provider in the host's registry.`
    );
  }
  const shape = settingsShapeError(rawSettings());
  if (shape) {
    throw new Error(
      `statusline: ${settingsPath()} parses to ${shape}, not a JSON object. Refusing — the statusLine ` +
        `would not be written. Replace it with an object (\`{}\` is valid) and re-run.`
    );
  }
  const { verdict, current, host, rendererInUse } = detect(pluginRoot);

  if (verdict === 'claudemd') {
    if (dryRun) return { action: 'dry-run', from: current, to: current };
    copyRenderer(pluginRoot);
    return { action: 'refreshed', from: current, to: current };
  }

  if (verdict === 'host') {
    const adapter = HOST_ADAPTERS.find(a => a.id === host);
    if (emptyOnly) {
      // `emptyOnly` is the install-time auto-adopt, and its rule is "never take a
      // slot that is not ours". A host slot we are NOT registered under is not
      // ours, so it stays untouched — the branch below.
      //
      // But once claudemd IS a registered guest, the file at destPath() is ours
      // and the host shells out to it on every render, so an upgrade owes it the
      // same refresh the `verdict === 'claudemd'` branch above performs. Pre-fix
      // this `return` came first and copyRenderer never ran on this path: a
      // guest-registered user kept whichever version's renderer first adopted
      // them, forever. Found by the v0.84.0 pre-ship review, in the release that
      // added a non-advisory `statusline` doctor row for a stale renderer — so
      // the first release touching scripts/statusline.sh would have turned that
      // row red for every guest user, with the row's own `/claudemd-install`
      // advice doing nothing about it.
      //
      // Registration is NOT touched here: refreshing our own file is not the
      // same as claiming the slot, and install-time adopt must not do the second.
      if (adapter.isRegistered(CLAUDEMD_PROVIDER_ID)) {
        if (dryRun) return { action: 'dry-run', host: adapter.id, to: GUEST_COMMAND() };
        copyRenderer(pluginRoot);
        return { action: 'guest-refreshed', host: adapter.id, to: GUEST_COMMAND() };
      }
      // Not our guest entry, but a provider of the host runs our file (D#599):
      // the file is still ours to refresh, and the host's registry is still not
      // ours to touch. `to: null` because nothing is registered.
      if (rendererInUse) {
        if (dryRun) return { action: 'dry-run', host: adapter.id, to: null };
        copyRenderer(pluginRoot);
        return { action: 'renderer-refreshed', host: adapter.id, to: null };
      }
      return { action: 'host-detected', host: adapter.id, to: null };
    }
    if (dryRun) return { action: 'dry-run', host: adapter.id, to: GUEST_COMMAND(), supersede };
    copyRenderer(pluginRoot);
    let superseded = null;
    let supersedeMissed = null;
    if (supersede) {
      const prov = adapter.listProviders().find(p => p.id === supersede);
      if (prov) {
        fs.mkdirSync(stateDir(), { recursive: true });
        // Append to a list (dedup by id) rather than overwrite, so a SECOND
        // --supersede does not clobber the first's restore record — remove()
        // restores EVERY superseded provider, not just the last. Without this,
        // `adopt --supersede=A` then `--supersede=B` left A unrecoverable.
        const list = fs.existsSync(prevPath()) ? readSupersededList() : [];
        if (!list.some(p => p.id === prov.id)) list.push(prov);
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
      { front: true }
    );
    return {
      action: changed || superseded ? 'registered' : 'already-registered',
      host: adapter.id,
      to: GUEST_COMMAND(),
      superseded,
      ...(supersedeMissed ? { supersedeMissed } : {}),
    };
  }

  if (verdict === 'foreign') {
    if (emptyOnly) return { action: 'skipped-foreign', from: current, to: null };
    if (!force) return { action: 'foreign', from: current, to: null };
    if (dryRun) return { action: 'dry-run', from: current, to: COMMAND };
    const settingsBackup = backupSettings ? backupSettingsFile().backup : null;
    fs.mkdirSync(stateDir(), { recursive: true });
    // The whole slot, not just its command: remove() puts back every key the
    // user had, `padding` included (defect 173).
    const statusLine = loadSettings().statusLine;
    fs.writeFileSync(prevPath(), JSON.stringify({ command: current, statusLine }, null, 2));
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
  try {
    fs.unlinkSync(prevPath());
  } catch {
    /* no stale prev to clear */
  }
  copyRenderer(pluginRoot);
  setStatusLine();
  return { action: 'set', from: null, to: COMMAND, settingsBackup };
}

export function remove() {
  const d = detect();
  if (d.verdict === 'host' && d.guestRegistered) {
    const adapter = HOST_ADAPTERS.find(a => a.id === d.host);
    adapter.unregister(CLAUDEMD_PROVIDER_ID);
    let restored = null;
    let notRestored = null;
    if (fs.existsSync(prevPath())) {
      // Restore every superseded provider (list shape; legacy singular tolerated)
      // that has no live namesake. Reverse order + front-insert so they regain
      // their original relative order: the last superseded, restored first, ends
      // up behind the earlier ones. `restored` is a comma-joined id list (single
      // case → the one id). A provider not restored stays in the record and is
      // listed in `notRestored`, so its command is not lost.
      const { restore, blocked } = splitRestorable(readSupersededList(), adapter.listProviders());
      for (let i = restore.length - 1; i >= 0; i--) {
        adapter.register(restore[i], { front: true });
      }
      if (restore.length) restored = restore.map(p => p.id).join(',');
      if (blocked.length) {
        notRestored = blocked.map(p => p.id);
        fs.writeFileSync(prevPath(), JSON.stringify({ superseded: blocked }, null, 2));
      } else {
        try {
          fs.unlinkSync(prevPath());
        } catch {
          /* best-effort */
        }
      }
    }
    // Another provider can run the same file under its own id: code-graph's
    // `_previous`, beside a guest entry 0.117.0's /claudemd-statusline added in
    // that state, or a superseded provider just restored. Deleting the file would
    // break the host's status line, so it stays for them.
    const kept = othersRunningRenderer(adapter.listProviders());
    if (kept.length === 0) {
      try {
        fs.unlinkSync(destPath());
      } catch {
        /* best-effort */
      }
    }
    return {
      action: 'unregistered',
      host: d.host,
      restored,
      ...(notRestored ? { notRestored } : {}),
      rendererKept: kept.length ? kept : null,
    };
  }
  const { verdict } = d;
  if (verdict !== 'claudemd') return { action: 'not-ours', restored: null };
  const settings = loadSettings();
  let action = 'removed';
  let restored = null;
  if (fs.existsSync(prevPath())) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevPath(), 'utf8'));
      if (prev && prev.statusLine != null && typeof prev.statusLine === 'object') {
        // The whole prior slot, whatever its command's shape.
        settings.statusLine = prev.statusLine;
        const c = prev.statusLine.command;
        restored = typeof c === 'string' ? c : JSON.stringify(c ?? null);
        action = 'restored';
      } else if (prev && typeof prev.command === 'string') {
        // A pre-173 record has the command only; that still restores.
        settings.statusLine = { type: 'command', command: prev.command };
        restored = prev.command;
        action = 'restored';
      } else {
        delete settings.statusLine;
      }
    } catch {
      delete settings.statusLine;
    }
    try {
      fs.unlinkSync(prevPath());
    } catch {
      /* best-effort */
    }
  } else {
    delete settings.statusLine;
  }
  writeSettings(settings);
  try {
    fs.unlinkSync(destPath());
  } catch {
    /* best-effort */
  }
  return { action, restored };
}
