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
