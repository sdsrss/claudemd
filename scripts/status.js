import fs from 'node:fs';
import path from 'node:path';
import { logsDir, backupRoot, readManifest } from './lib/paths.js';

const HOOK_NAMES = ['BANNED_VOCAB','SHIP_BASELINE','RESIDUE_AUDIT','MEMORY_READ','SANDBOX_DISPOSAL','SESSION_START'];

export async function status() {
  const m = readManifest();
  let plugin = { installed: false };
  if (m.exists && m.data) {
    plugin = { installed: true, version: m.data.version, entries: m.data.entries.length };
  }

  const coreSpec = path.join(backupRoot(), 'CLAUDE.md');
  const specVersion = fs.existsSync(coreSpec)
    ? (fs.readFileSync(coreSpec, 'utf8').match(/^Version:\s*(\S+)/m) || [,''])[1]
    : '';

  const killSwitches = { plugin: process.env.DISABLE_CLAUDEMD_HOOKS === '1' };
  for (const name of HOOK_NAMES) {
    killSwitches[name.toLowerCase()] = process.env[`DISABLE_${name}_HOOK`] === '1';
  }

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;

  return { plugin, spec: { installed: specVersion }, killSwitches, log: { lines: logLines } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  status().then(r => console.log(JSON.stringify(r, null, 2)));
}
