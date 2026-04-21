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
  }
  return { removed };
}
