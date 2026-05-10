import { readSettings, writeSettings } from './lib/settings-merge.js';
import { HOOK_NAME_TO_ENV } from './lib/hook-registry.js';
import { printHelpAndExit } from './lib/argv.js';

// Display name → env-var suffix. Source of truth: scripts/lib/hook-registry.js.
// `version-sync` maps to `USER_PROMPT_SUBMIT` (event name, not file name) —
// preserved in the registry so DISABLE_USER_PROMPT_SUBMIT_HOOK keeps working
// for users who set it under prior versions.
const NAME_MAP = HOOK_NAME_TO_ENV;

const USAGE = `Usage: node scripts/toggle.js <hook-name>

Toggle a claudemd hook on or off in ~/.claude/settings.json by setting/unsetting
DISABLE_<HOOK>_HOOK=1. Each invocation flips state; toggle twice to round-trip.

Hook names:
  ${Object.keys(NAME_MAP).join(' | ')}

Options:
  --help, -h     Print this message and exit.

Wrapped by /claudemd-toggle.

Exit codes: 0 success | 1 unknown hook / no arg.`;

export async function toggle(name) {
  const upper = NAME_MAP[name];
  if (!upper) throw new Error(`unknown hook: ${name}`);
  const key = `DISABLE_${upper}_HOOK`;
  const s = readSettings();
  s.env ||= {};
  let newState;
  if (s.env[key] === '1') {
    delete s.env[key];
    newState = 'enabled';
  } else {
    s.env[key] = '1';
    newState = 'disabled';
  }
  writeSettings(s);
  return { hook: name, newState };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const name = process.argv[2];
  if (!name) {
    console.error(USAGE);
    process.exit(1);
  }
  toggle(name).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
