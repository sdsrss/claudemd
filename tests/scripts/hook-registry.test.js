// Drift gate: scripts/lib/hook-registry.js is the single source of truth for
// the plugin hooks. This test asserts every consumer (hooks.json,
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
  HOOK_REGISTRATION_COUNT,
} from '../../scripts/lib/hook-registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('registry has 27 entries and 28 hooks.json registrations', () => {
  // The install manifest holds one entry per registration (MCOUNT in
  // tests/integration/full-lifecycle.test.sh, manifest.entries.length in
  // tests/scripts/install.test.js), which is HOOK_REGISTRATION_COUNT: one per
  // hook plus its `alsoOn` events (branch-prune: PostToolUseFailure, 0.116.0).
  assert.equal(HOOK_REGISTRY.length, 27);
  assert.equal(HOOK_REGISTRATION_COUNT, 28);
});

test('R15: optIn names exactly the hooks whose source exits at an opt-in variable', () => {
  // Derived from each hook's own gate line, so a new opt-in hook written in
  // either existing form is red here until the registry (and so the toggle's
  // note) knows it. Not covered: an opt-in spelled any other way.
  const GATE = /^\[\[ "\$\{([A-Z_]+):-0\}" == "1" \]\] \|\| exit 0$|^case "\$\{([A-Z_]+):-0\}" in$/m;
  const derived = {};
  for (const r of HOOK_REGISTRY) {
    const m = fs.readFileSync(path.join(REPO_ROOT, 'hooks', r.basename), 'utf8').match(GATE);
    if (m) derived[r.displayName] = m[1] || m[2];
  }
  assert.equal(derived['evidence-gate'], 'EVIDENCE_GATE', 'control: a known opt-in hook is derived');
  assert.equal(derived['reply-language'], 'REPLY_LANGUAGE_CHECK', 'control: the case form is derived');
  const declared = Object.fromEntries(
    HOOK_REGISTRY.filter(r => r.optIn).map(r => [r.displayName, r.optIn.env])
  );
  assert.deepEqual(declared, derived);
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
  // A hook registered on more than one event lists the others in `alsoOn`;
  // hooks.json must hold exactly the declared registrations, each once.
  for (const r of HOOK_REGISTRY) {
    const declared = [r, ...(r.alsoOn || [])].map(e => `${e.hookEvent}|${e.matcher}|${e.timeout}`).sort();
    const found = flat
      .filter(f => f.command.includes(`/hooks/${r.basename}`))
      .map(f => `${f.event}|${f.matcher}|${f.timeout}`)
      .sort();
    assert.ok(found.length > 0, `registry entry ${r.basename} not found in hooks/hooks.json`);
    assert.deepEqual(found, declared, `${r.basename}: event/matcher/timeout drift`);
  }
});

test('branch-prune is registered on PostToolUseFailure too (a refused git branch -d exits 1)', () => {
  const r = HOOK_REGISTRY.find(h => h.basename === 'branch-prune.sh');
  assert.deepEqual(r.alsoOn, [{ hookEvent: 'PostToolUseFailure', matcher: 'Bash', timeout: 10 }]);
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
