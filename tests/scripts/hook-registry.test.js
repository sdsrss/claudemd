// Drift gate: scripts/lib/hook-registry.js is the single source of truth for
// the 9 plugin hooks. This test asserts every consumer (hooks.json,
// commands/claudemd-toggle.md, hooks/*.sh files on disk, derived consts) stays
// in lockstep. Adding a hook = one entry in the registry + the hooks.json
// command + the toggle.md list; any drift fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOOK_REGISTRY,
  HOOK_BASENAMES,
  HOOK_ENV_SUFFIXES,
  HOOK_NAME_TO_ENV,
} from '../../scripts/lib/hook-registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('registry has 12 entries (matches integration MCOUNT)', () => {
  // Pinned to the same number as tests/integration/full-lifecycle.test.sh
  // MCOUNT and tests/scripts/install.test.js manifest.entries.length so the
  // three counts move together when a hook is added or removed.
  assert.equal(HOOK_REGISTRY.length, 12);
});

test('registry → hooks.json: every entry registered with same event/matcher/timeout', () => {
  const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks/hooks.json'), 'utf8'));
  const flat = [];
  for (const [event, blocks] of Object.entries(data.hooks || {})) {
    for (const block of blocks) {
      for (const h of block.hooks || []) {
        flat.push({ event, matcher: block.matcher, command: h.command, timeout: h.timeout });
      }
    }
  }
  for (const r of HOOK_REGISTRY) {
    const match = flat.find(f => f.command.includes(`/hooks/${r.basename}`));
    assert.ok(match, `registry entry ${r.basename} not found in hooks/hooks.json`);
    assert.equal(match.event, r.hookEvent, `${r.basename}: hookEvent drift`);
    assert.equal(match.matcher, r.matcher, `${r.basename}: matcher drift`);
    assert.equal(match.timeout, r.timeout, `${r.basename}: timeout drift`);
  }
});

test('hooks.json → registry: every command points to a registry basename', () => {
  const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks/hooks.json'), 'utf8'));
  const basenameRe = /\/hooks\/([\w.-]+\.sh)/;
  for (const blocks of Object.values(data.hooks || {})) {
    for (const block of blocks) {
      for (const h of block.hooks || []) {
        const m = h.command.match(basenameRe);
        assert.ok(m, `cannot extract basename from hooks.json command: ${h.command}`);
        assert.ok(
          HOOK_BASENAMES.includes(m[1]),
          `hooks.json registers ${m[1]} but it has no entry in scripts/lib/hook-registry.js`
        );
      }
    }
  }
});

test('hooks/*.sh on disk are all registered (no orphan entrypoints)', () => {
  const dir = path.join(REPO_ROOT, 'hooks');
  const sh = fs.readdirSync(dir).filter(n => n.endsWith('.sh'));
  for (const name of sh) {
    assert.ok(
      HOOK_BASENAMES.includes(name),
      `${name} exists in hooks/ but is not in HOOK_REGISTRY — either register it or move it under hooks/lib/`
    );
  }
  // Inverse: every registry basename has a file on disk.
  for (const r of HOOK_REGISTRY) {
    assert.ok(
      fs.existsSync(path.join(dir, r.basename)),
      `registry entry ${r.basename} has no file at hooks/${r.basename}`
    );
  }
});

test('commands/claudemd-toggle.md lists every registry displayName', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'commands/claudemd-toggle.md'), 'utf8');
  for (const r of HOOK_REGISTRY) {
    assert.ok(
      md.includes(`\`${r.displayName}\``),
      `commands/claudemd-toggle.md must mention \`${r.displayName}\` (registry displayName); list out of sync`
    );
  }
});

test('derived exports have one entry per registry row', () => {
  assert.equal(HOOK_BASENAMES.length, HOOK_REGISTRY.length);
  assert.equal(HOOK_ENV_SUFFIXES.length, HOOK_REGISTRY.length);
  assert.equal(Object.keys(HOOK_NAME_TO_ENV).length, HOOK_REGISTRY.length);
});

test('every registry row has unique basename / displayName / envVarSuffix', () => {
  const basenames = HOOK_REGISTRY.map(r => r.basename);
  const displayNames = HOOK_REGISTRY.map(r => r.displayName);
  const envSuffixes = HOOK_REGISTRY.map(r => r.envVarSuffix);
  assert.equal(new Set(basenames).size, basenames.length, 'duplicate basename in registry');
  assert.equal(new Set(displayNames).size, displayNames.length, 'duplicate displayName in registry');
  assert.equal(new Set(envSuffixes).size, envSuffixes.length, 'duplicate envVarSuffix in registry');
});
