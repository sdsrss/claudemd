#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';
import { resolvePluginRoot } from './lib/paths.js';
import { detect, adopt, remove } from './lib/statusline.js';

const USAGE = `Usage: node scripts/statusline-adopt.js <detect|adopt|remove> [flags]

Manage claudemd's statusLine registration in ~/.claude/settings.json.

Modes:
  detect            Print JSON verdict (absent|claudemd|foreign) + dest state. No writes.
  adopt             Empty slot → set. claudemd → refresh renderer. foreign → no-op
                    unless --force. Copies the renderer to ~/.claude/claudemd-statusline.sh.
  remove            Remove claudemd's statusLine (restore prior if saved). No-op if not ours.

Flags:
  --force           adopt: replace a foreign statusLine (saves prior for remove).
  --empty-only      adopt: only write when the slot is empty (install-time guard).
  --supersede=<id>  adopt(host): supersede a named provider (saves it for remove).
  --dry-run         adopt: print the transition, write nothing.
  --json            Machine-readable JSON (default is a human-readable summary).
  --help, -h        Print this message and exit.

Exit codes: 0 success | 1 failure | 2 argv-shape error.`;

// realpath BOTH sides so a symlinked invocation path still matches (mirrors
// design-detect.js — a bare href compare silently no-ops under a symlinked dir).
const invokedAsMain = (() => {
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
})();

function renderHuman(mode, out) {
  if (mode === 'detect') {
    const bits = [`verdict: ${out.verdict}`];
    if (out.host) bits.push(`host: ${out.host}`, `claudemd-registered: ${out.guestRegistered}`);
    if (out.current) bits.push(`current: ${out.current}`);
    bits.push(`renderer: ${out.dest.exists ? 'present' : 'absent'}${out.dest.exists ? (out.dest.matchesShipped ? ' (matches shipped)' : ' (differs from shipped)') : ''}`);
    return bits.join('\n');
  }
  // adopt / remove
  const tail = [out.host && `host=${out.host}`, out.superseded && `superseded=${out.superseded}`, out.restored && `restored=${out.restored}`, out.to && `to=${out.to}`].filter(Boolean).join('  ');
  return `action: ${out.action}${tail ? '  ' + tail : ''}`;
}

if (invokedAsMain) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const [mode, ...rest] = argv;
  if (!['detect', 'adopt', 'remove'].includes(mode || '')) {
    console.error(`Unknown mode: '${mode || ''}'. Expected detect|adopt|remove.`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseStrict(rest, { bools: ['--force', '--empty-only', '--dry-run', '--json'], values: ['--supersede'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  try {
    let out;
    if (mode === 'detect') out = detect(pluginRoot);
    else if (mode === 'adopt') out = adopt({
      pluginRoot,
      force: parsed.bools.has('--force'),
      emptyOnly: parsed.bools.has('--empty-only'),
      dryRun: parsed.bools.has('--dry-run'),
      supersede: parsed.values['--supersede'] || null,
    });
    else out = remove();
    if (parsed.bools.has('--json')) {
      process.stdout.write(JSON.stringify(out) + '\n');
    } else {
      process.stdout.write(renderHuman(mode, out) + '\n');
    }
    process.exit(0);
  } catch (e) {
    console.error(`statusline-adopt failed: ${e.message}`);
    process.exit(1);
  }
}
