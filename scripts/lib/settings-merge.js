import fs from 'node:fs';
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
  return hookBasenames.some(b => {
    const inPluginCache = c.includes('/plugins/cache/claudemd/') && c.includes(`/hooks/${b}`);
    const inHandInstall = c.includes(`/.claude/hooks/${b}`);
    const inEnvLiteral  = c.includes(`\${CLAUDE_PLUGIN_ROOT}/hooks/${b}`);
    return inPluginCache || inHandInstall || inEnvLiteral;
  });
}

export function unmergeHook(settings, { commandPredicate }) {
  if (!settings.hooks) return { removed: 0 };
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const blocks = settings.hooks[event];
    for (const block of blocks) {
      const before = block.hooks.length;
      block.hooks = block.hooks.filter(h => !commandPredicate(h.command));
      removed += before - block.hooks.length;
    }
    settings.hooks[event] = blocks.filter(b => b.hooks.length > 0);
    // Drop the event key entirely if no blocks remain — otherwise every
    // install/uninstall cycle leaves a `"PreToolUse": []` residue and
    // settings.json accumulates empty scaffolding visible in diffs.
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return { removed };
}
