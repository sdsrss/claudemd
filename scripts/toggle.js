import { readSettings, writeSettings, settingsShapeError } from './lib/settings-merge.js';
import { HOOK_NAME_TO_ENV, HOOK_REGISTRY } from './lib/hook-registry.js';
import { settingsPath } from './lib/paths.js';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

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

Exit codes: 0 success | 1 unknown hook / no arg | 2 argv-shape error.`;

// The names a user has in hand come from README's "N shell hooks" row, which
// lists them by FILE — `banned-vocab-check`, `pre-bash-safety-check`,
// `ship-baseline-check`. Exactly those three differ from the displayName this
// map is keyed by and the rest are identical (the row's count is derived from
// the registry, so it is not repeated here), so copying that row got a
// bare `unknown hook: banned-vocab-check` and exit 1, with the valid list
// printed only by the no-argument path the user did not take. Map the file
// spelling back rather than ACCEPTING it: a second accepted vocabulary would
// need its own documentation and its own drift test, and `/claudemd-status
// --verbose` would still report only the displayName.
function nearestHookName(name) {
  const strip = s => s.replace(/\.sh$/, '').replace(/-check$/, '');
  const target = strip(String(name));
  return Object.keys(NAME_MAP).find(n => strip(n) === target) || null;
}

export async function toggle(name) {
  // `Object.hasOwn`, not a bare `NAME_MAP[name]`: the map is a plain object, so
  // a bracket lookup walks the prototype chain and `NAME_MAP.constructor` comes
  // back truthy. `toggle.js constructor` then skipped the whole unknown-hook
  // path below and wrote `DISABLE_function Object() { [native code] }_HOOK` into
  // the user's settings, reporting exit 0 and `newState: disabled` for a hook
  // that does not exist (0.88.0 pre-tag review, Low-1).
  const upper = Object.hasOwn(NAME_MAP, name) ? NAME_MAP[name] : undefined;
  if (!upper) {
    const near = nearestHookName(name);
    throw new Error(
      `unknown hook: ${name}` +
        (near ? ` — did you mean '${near}'?` : '') +
        `\nValid hook names: ${Object.keys(NAME_MAP).join(' | ')}`
    );
  }
  const key = `DISABLE_${upper}_HOOK`;
  const s = readSettings();
  // Refuse rather than report a state nothing wrote (Round-14 audit SCR-L2).
  // With a JSON ARRAY here, `s.env ||= {}` succeeds, `JSON.stringify` drops the
  // property on the way out, and this function returned `{newState: 'disabled'}`
  // for a hook that stayed on.
  const shape = settingsShapeError(s);
  if (shape) {
    throw new Error(
      `toggle: ${settingsPath()} parses to ${shape}, not a JSON object. Refusing — the toggle would ` +
        `report a new state and write nothing. Replace it with an object (\`{}\` is valid) and re-run.`
    );
  }
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
  // A default-OFF hook needs its opt-in variable as well as a clear kill
  // switch; without one, "enabled" named a hook that still exited at its gate
  // (R15). settings.json env is what the next session's hooks get; the
  // current process env covers an opt-in exported in the user's shell.
  const optIn = HOOK_REGISTRY.find(r => r.displayName === name)?.optIn;
  // String(): a JSON number 1 in settings.json reaches the hook as "1" (R18 L3).
  const optValue = s.env[optIn?.env] ?? process.env[optIn?.env];
  if (optIn && !optIn.values.includes(optValue == null ? undefined : String(optValue))) {
    const now =
      optValue == null
        ? `${optIn.env} is unset`
        : `${optIn.env} is ${JSON.stringify(String(optValue))}, not 1`;
    const note =
      newState === 'enabled'
        ? `${name} is opt-in: the kill switch is off, but the hook stays inactive until ${optIn.env}=${optIn.values[0]} ` +
          `is set (settings.json "env" or your shell).`
        : `${name} is opt-in and was not active (${now}); the kill switch is now set as well.`;
    return { hook: name, newState, note };
  }
  return { hook: name, newState };
}

if (invokedAsMain(import.meta.url)) {
  const raw = process.argv.slice(2);
  printHelpAndExit(raw, USAGE);
  // SCRIPT-2 (2026-07-12 audit): toggle took a positional hook name but read
  // process.argv[2] directly, so `toggle.js banned-vocab --json` flipped the
  // hook and SILENTLY dropped --json (the silent-flag-drop antipattern every
  // sibling CLI fixed via parseStrict). Take the first positional as the hook
  // name; feed everything else (stray flags + extra positionals) to parseStrict
  // so an unknown flag / extra arg rejects loudly with exit 2 (shape error),
  // distinct from exit 1 (missing/unknown hook).
  const positionals = raw.filter(a => !a.startsWith('-'));
  const name = positionals[0];
  const leftover = raw.filter(a => a.startsWith('-')).concat(positionals.slice(1));
  parseStrictOrExit(leftover);
  if (!name) {
    console.error(USAGE);
    process.exit(1);
  }
  toggle(name)
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => {
      console.error(e.message);
      process.exit(1);
    });
}
