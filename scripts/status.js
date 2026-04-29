import fs from 'node:fs';
import path from 'node:path';
import { logsDir, backupRoot, readManifest, resolvePluginRoot } from './lib/paths.js';
import { compareSpecs } from './lib/spec-hash.js';

// Keep in sync with toggle.js NAME_MAP values. Order mirrors HOOK_BASENAMES
// in install.js (registration order) for human-scannable output.
const HOOK_NAMES = ['BANNED_VOCAB','PRE_BASH_SAFETY','SHIP_BASELINE','RESIDUE_AUDIT','MEMORY_READ','SANDBOX_DISPOSAL','SESSION_START','USER_PROMPT_SUBMIT'];

export async function status() {
  const m = readManifest();
  let plugin = { installed: false };
  if (m.exists && m.data) {
    plugin = { installed: true, version: m.data.version, entries: m.data.entries.length };
  }

  // Spec version source (per v0.2.1 "Versioning policy"): the `spec/CLAUDE.md`
  // H1 title — `# AI-CODING-SPEC vX.Y.Z — Core`. Pre-v6.10.0 specs used a
  // standalone `Version: X.Y.Z` line (retired in v6.10.0 restructure);
  // fallback regex preserves read compatibility with old installs.
  const coreSpec = path.join(backupRoot(), 'CLAUDE.md');
  const specVersion = (() => {
    if (!fs.existsSync(coreSpec)) return '';
    const text = fs.readFileSync(coreSpec, 'utf8');
    const h1 = text.match(/^#\s*AI-CODING-SPEC\s+v([\d.]+)/m);
    if (h1) return h1[1];
    const legacy = text.match(/^Version:\s*(\S+)/m);
    return legacy ? legacy[1] : '';
  })();

  const killSwitches = { plugin: process.env.DISABLE_CLAUDEMD_HOOKS === '1' };
  for (const name of HOOK_NAMES) {
    killSwitches[name.toLowerCase()] = process.env[`DISABLE_${name}_HOOK`] === '1';
  }

  // v0.6.0: SHA-256 drift summary. Truncate to 12 hex chars for display
  // (full hash is in doctor's per-file detail). One row per shipped spec.
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const hashes = compareSpecs(pluginRoot).map(s => ({
    name: s.name,
    match: s.match,
    shipped: s.shipped ? s.shipped.slice(0, 12) : null,
    installed: s.installed ? s.installed.slice(0, 12) : null,
  }));

  // v0.6.0: surface opt-in feature flags so /claudemd-status reflects what
  // the hooks will actually do this session. BASH_SAFETY_INDIRECT_CALL gates
  // the bash -c / sh -c / zsh -c / eval unwrap path in pre-bash-safety hook.
  const features = {
    bashSafetyIndirectCall: process.env.BASH_SAFETY_INDIRECT_CALL === '1',
  };

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;

  return { plugin, spec: { installed: specVersion, hashes }, killSwitches, features, log: { lines: logLines } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  status().then(r => console.log(JSON.stringify(r, null, 2)));
}
