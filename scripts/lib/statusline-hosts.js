import fs from 'node:fs';
import path from 'node:path';
import { codeGraphRegistryPath, codeGraphProvidersBackupPath } from './paths.js';

// A composite host owns the single statusLine slot but renders MANY providers
// from a registry, so claudemd registers as a guest instead of clobbering the
// slot. Each adapter knows how to recognize its host and read/write our entry.
export const CLAUDEMD_PROVIDER_ID = 'claudemd';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// --- code-graph adapter ---
// Registry format (code-graph's): [{ id, command, needsStdin }]. Read prefers
// the volatile ~/.cache primary and falls back to the durable ~/.claude mirror
// (which code-graph self-heals the primary from); write updates BOTH, mirroring
// code-graph's own writeRegistry so a later code-graph run preserves our entry.
function cgRead() {
  const primary = readJson(codeGraphRegistryPath());
  if (Array.isArray(primary) && primary.length) return primary;
  const backup = readJson(codeGraphProvidersBackupPath());
  return Array.isArray(backup) ? backup : [];
}
function cgWrite(list) {
  if (!list || list.length === 0) {
    for (const p of [codeGraphRegistryPath(), codeGraphProvidersBackupPath()]) {
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
    return;
  }
  writeJsonAtomic(codeGraphRegistryPath(), list);
  try { writeJsonAtomic(codeGraphProvidersBackupPath(), list); } catch { /* mirror best-effort */ }
}

export const codeGraphAdapter = {
  id: 'code-graph',
  matches: (command) => typeof command === 'string' && command.includes('statusline-composite'),
  listProviders: () => cgRead(),
  isRegistered: (id) => cgRead().some((p) => p.id === id),
  register(entry, { front = false } = {}) {
    const list = cgRead();
    const idx = list.findIndex((p) => p.id === entry.id);
    if (idx >= 0) {
      if (list[idx].command === entry.command && !!list[idx].needsStdin === !!entry.needsStdin) return false;
      list[idx] = entry;
    } else if (front) {
      // Render after any pre-existing statusline (_previous) but before others.
      const insertAt = list[0] && list[0].id === '_previous' ? 1 : 0;
      list.splice(insertAt, 0, entry);
    } else {
      list.push(entry);
    }
    cgWrite(list);
    return true;
  },
  unregister(id) {
    const list = cgRead();
    const filtered = list.filter((p) => p.id !== id);
    if (filtered.length === list.length) return false;
    cgWrite(filtered);
    return true;
  },
};

export const HOST_ADAPTERS = [codeGraphAdapter];

export function detectHost(command) {
  return HOST_ADAPTERS.find((a) => a.matches(command)) || null;
}

// Providers that look like a hand-made PS1 the user might want claudemd to
// supersede: a bash script under ~/.claude/ that is neither claudemd's renderer
// nor a composite host. Used ONLY to OFFER a supersede choice — never applied
// silently (consent-driven).
export function manualPsCandidates(providers) {
  return (providers || []).filter((p) =>
    typeof p.command === 'string' &&
    /\bbash\b/.test(p.command) &&
    /\/\.claude\//.test(p.command) &&
    !p.command.includes('claudemd-statusline.sh') &&
    !p.command.includes('statusline-composite') &&
    p.id !== 'code-graph' && p.id !== CLAUDEMD_PROVIDER_ID,
  );
}
