import fs from 'node:fs';
import path from 'node:path';
import { settingsPath } from './paths.js';

export function readSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  let raw = fs.readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in settings.json: ${e.message}`);
  }
}

export function writeSettings(obj) {
  const p = settingsPath();
  const tmp = `${p}.tmp-${process.pid}`;
  const json = JSON.stringify(obj, null, 2);
  JSON.parse(json); // validate before write
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, p);
}

// NOT live production wiring (2026-07-24 audit P2-10): hooks register via the
// plugin's own hooks/hooks.json since v0.1.5 — install.js only EVICTS from
// settings.json (unmergeHook below) and never merges in. Retained because the
// settings-merge test suite uses it as the canonical fixture builder for the
// historical merged shape that unmergeHook must still evict. Do not wire it
// back into install without re-reading the v0.1.2-0.1.4 ${CLAUDE_PLUGIN_ROOT}
// expansion incident in isClaudemdLegacyHookCommand's comment.
export function mergeHook(settings, spec) {
  const { event, matcher, command, timeout } = spec;
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[event]) settings.hooks[event] = [];

  let block = settings.hooks[event].find(m => m.matcher === matcher);
  if (!block) {
    block = { matcher, hooks: [] };
    settings.hooks[event].push(block);
  }
  const existing = block.hooks.find(h => h.command === command);
  if (existing) {
    return { added: false, entry: existing };
  }
  const entry = { type: 'command', command, ...(timeout != null ? { timeout } : {}) };
  block.hooks.push(entry);
  return { added: true, entry };
}

// D6 (v0.5.4): path-anchored predicate for evicting claudemd's legacy
// settings.json hook entries. Pre-fix substring match `c.includes('/hooks/${b}')`
// would also match a hypothetical future plugin shipping a same-basename hook
// (`/plugins/cache/some-other/hooks/banned-vocab-check.sh`). The three OR
// branches enumerate every legitimate residue form claudemd has ever written:
//   1. `/plugins/cache/claudemd/...`  — pre-0.1.5 absolute version-dir form
//      (≤0.1.1 — went stale on `/plugin update` swapping the version pointer)
//   2. `/.claude/hooks/${basename}`   — v0 hand-install form (pre-plugin era)
//   3. `${CLAUDE_PLUGIN_ROOT}/hooks/` — pre-0.1.5 unexpanded literal
//      (0.1.2-0.1.4 wrote this into settings.json; CC harness refused to
//      expand the variable from settings.json and threw on every invocation)
// `hookBasenames` is passed in (rather than imported from install.js) to
// avoid the lib → top-level circular dependency.
export function isClaudemdLegacyHookCommand(c, hookBasenames) {
  // Anchor the hand-install match to the USER's own ~/.claude/hooks/ (derived
  // from settingsPath → its dirname is ~/.claude). Pre-fix the bare substring
  // `/.claude/hooks/<basename>` also matched a FOREIGN plugin installed under a
  // different root that happened to reuse a claudemd basename
  // (`/opt/otherplugin/.claude/hooks/banned-vocab-check.sh`), so claudemd's
  // uninstall would evict that other plugin's hook.
  const handHooksDir = path.join(path.dirname(settingsPath()), 'hooks') + path.sep;
  return hookBasenames.some(b => {
    const inPluginCache = c.includes('/plugins/cache/claudemd/') && c.includes(`/hooks/${b}`);
    const inHandInstall = c.includes(`${handHooksDir}${b}`);
    const inEnvLiteral  = c.includes(`\${CLAUDE_PLUGIN_ROOT}/hooks/${b}`);
    return inPluginCache || inHandInstall || inEnvLiteral;
  });
}

export function unmergeHook(settings, { commandPredicate }) {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return { removed: 0 };
  }
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const blocks = settings.hooks[event];
    // Tolerate malformed-but-valid-JSON settings (hand-edited or written by a
    // third-party tool): a non-array event value, a non-object block, or a
    // block whose `hooks` is not an array cannot hold a claudemd entry in any
    // form claudemd ever wrote. Pre-fix, iterating these threw a cryptic
    // `Cannot read properties of undefined (reading 'length')` that surfaced as
    // "install failed: …" / "uninstall failed: …" during the adopter's
    // first-touch flow. Skip the malformed parts and leave them untouched —
    // never mutate or drop structure we don't understand.
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || !Array.isArray(block.hooks)) continue;
      const before = block.hooks.length;
      // Keep an entry unless it is a well-formed claudemd command. Malformed
      // entries (null, non-object, non-string command) are preserved as-is.
      block.hooks = block.hooks.filter(h =>
        !h || typeof h !== 'object' || typeof h.command !== 'string' || !commandPredicate(h.command)
      );
      removed += before - block.hooks.length;
    }
    // Drop only well-formed blocks that are now empty — otherwise every
    // install/uninstall cycle leaves a `"PreToolUse": []` residue and
    // settings.json accumulates empty scaffolding visible in diffs. Malformed
    // blocks are passed through unchanged.
    settings.hooks[event] = blocks.filter(
      b => !b || typeof b !== 'object' || !Array.isArray(b.hooks) || b.hooks.length > 0
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { removed };
}
