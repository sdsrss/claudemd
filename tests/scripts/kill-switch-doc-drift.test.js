// kill-switch-doc-drift.test.js — Round-3 regression: README's per-hook
// kill-switch list MUST stay in lockstep with `hook_kill_switch <NAME>` calls
// in hooks/*.sh.
//
// Pre-fix (v0.9.23): README listed 9 DISABLE_* env vars but the codebase
// actually exposed 12, and one of the documented vars (DISABLE_USER_PROMPT_
// SUBMIT_HOOK) was annotated as disabling `transcript-vocab-scan` — but the
// arg passed to hook_kill_switch in version-sync.sh is USER_PROMPT_SUBMIT,
// so the env var actually disabled version-sync, not transcript-vocab-scan.
// A user trying to silence transcript-vocab-scan via the documented var
// would silence the wrong hook.
//
// This test fails when:
//   - a hook adds/changes its hook_kill_switch arg without updating README
//   - README lists a DISABLE_* var that no hook actually checks

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function expectedKillSwitchVars() {
  // For each hook, find `hook_kill_switch <NAME>` and convert to
  // DISABLE_<NAME>_HOOK. Hooks without the call are excluded.
  const hooksDir = path.join(REPO_ROOT, 'hooks');
  const hooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.sh'));
  const out = new Map(); // env-var → hook basename
  for (const h of hooks) {
    const src = fs.readFileSync(path.join(hooksDir, h), 'utf8');
    const m = src.match(/hook_kill_switch\s+([A-Z][A-Z0-9_]*)/);
    if (!m) continue;
    const envVar = `DISABLE_${m[1]}_HOOK`;
    out.set(envVar, h);
  }
  return out;
}

function documentedKillSwitchVars(readme) {
  // Grab `DISABLE_*_HOOK` (per-hook only — exclude DISABLE_CLAUDEMD_HOOKS
  // plugin-wide and DISABLE_*_BANNER / DISABLE_UPSTREAM_CHECK sub-feature
  // toggles documented in their own block).
  const matches = [...readme.matchAll(/\bDISABLE_[A-Z][A-Z0-9_]*_HOOK\b/g)];
  return new Set(matches.map(m => m[0]));
}

test('README per-hook kill-switch list matches hook_kill_switch calls', () => {
  const expected = expectedKillSwitchVars();
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const documented = documentedKillSwitchVars(readme);

  const missingFromReadme = [...expected.keys()].filter(v => !documented.has(v));
  const documentedButNoHook = [...documented].filter(v => !expected.has(v));

  assert.deepEqual(
    missingFromReadme,
    [],
    `README missing kill-switch entries for hooks that DO honor them: ${missingFromReadme.join(', ')}`,
  );
  assert.deepEqual(
    documentedButNoHook,
    [],
    `README documents kill-switch vars that no hook actually checks: ${documentedButNoHook.join(', ')}`,
  );
});

test('hook_kill_switch arg in each hook matches its filename family', () => {
  // Defends against the v0.9.23 bug specifically: README annotated
  // DISABLE_USER_PROMPT_SUBMIT_HOOK as "transcript-vocab-scan" because the
  // env var name doesn't obviously map to its owning hook. Lock the mapping
  // here so renames stay coherent.
  const expected = expectedKillSwitchVars();
  // Pinned mapping — env var → owning hook basename.
  const pinned = {
    DISABLE_BANNED_VOCAB_HOOK:             'banned-vocab-check.sh',
    DISABLE_MEM_AUDIT_HOOK:                'mem-audit.sh',
    DISABLE_MEMORY_READ_HOOK:              'memory-read-check.sh',
    DISABLE_PRE_BASH_SAFETY_HOOK:          'pre-bash-safety-check.sh',
    DISABLE_RESIDUE_AUDIT_HOOK:            'residue-audit.sh',
    DISABLE_SANDBOX_DISPOSAL_HOOK:         'sandbox-disposal-check.sh',
    DISABLE_SESSION_START_HOOK:            'session-start-check.sh',
    DISABLE_SESSION_SUMMARY_HOOK:          'session-summary.sh',
    DISABLE_SHIP_BASELINE_HOOK:            'ship-baseline-check.sh',
    DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK:'transcript-structure-scan.sh',
    DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK:    'transcript-vocab-scan.sh',
    DISABLE_USER_PROMPT_SUBMIT_HOOK:       'version-sync.sh',
  };
  for (const [envVar, hook] of Object.entries(pinned)) {
    assert.equal(
      expected.get(envVar),
      hook,
      `${envVar} should disable ${hook} (got: ${expected.get(envVar) || 'undefined'})`,
    );
  }
});

// --- 2026-08-29 audit R10-08: the OTHER bypass axis ------------------------
//
// This file has kept README's DISABLE_* list honest since Round-3, and the
// `[allow-*]` escape tokens had no equivalent join at all. `[allow-curl-sh]`
// shipped as a live deny path in 0.69.1 and appeared in exactly zero
// user-facing references: status.js's ESCAPE_TOKENS (whose own comment calls
// itself the single source) listed five, README's escape table listed five,
// and commands/claudemd-status.md promised a "full" reference and named the
// count. A user blocked by the curl|sh detector had nowhere to look.
//
// Derived from the hook sources, not from a list — a hand-kept list would be
// written against the same blind spot that produced the gap.
function hookEscapeTokens() {
  const hooksDir = path.join(REPO_ROOT, 'hooks');
  const out = new Set();
  for (const h of fs.readdirSync(hooksDir).filter(f => f.endsWith('.sh'))) {
    const src = fs.readFileSync(path.join(hooksDir, h), 'utf8');
    for (const m of src.matchAll(/\[allow-[a-z0-9-]+\]/g)) out.add(m[0]);
  }
  return out;
}

test('R10-08: every [allow-*] token a hook implements is in status.js ESCAPE_TOKENS', () => {
  const tokens = hookEscapeTokens();
  // Premise assertion: an empty or shrunken derivation must fail loudly rather
  // than pass vacuously (the run-all empty-glob lesson).
  assert.ok(tokens.size >= 3, `expected >= 3 [allow-*] tokens in hooks/, found ${tokens.size}`);

  const statusSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/status.js'), 'utf8');
  const block = statusSrc.match(/const ESCAPE_TOKENS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'ESCAPE_TOKENS array not found in scripts/status.js');
  for (const t of tokens) {
    assert.ok(block[1].includes(t),
      `${t} is implemented in hooks/ but missing from scripts/status.js ESCAPE_TOKENS`);
  }
});

test('R10-08: every [allow-*] token a hook implements is in the README escape table', () => {
  const tokens = hookEscapeTokens();
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  for (const t of tokens) {
    assert.ok(readme.includes(t),
      `${t} is implemented in hooks/ but never appears in README.md`);
  }
});

test('R10-08: no reference documents a token no hook implements', () => {
  // The reverse direction: a token removed from a hook must not linger in the
  // docs as advice that silently stops working.
  const tokens = hookEscapeTokens();
  const statusSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/status.js'), 'utf8');
  const block = statusSrc.match(/const ESCAPE_TOKENS = \[([\s\S]*?)\n\];/);
  for (const m of block[1].matchAll(/\[allow-[a-z0-9-]+\]/g)) {
    assert.ok(tokens.has(m[0]),
      `${m[0]} is documented in ESCAPE_TOKENS but no hook implements it`);
  }
});
