import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { status } from '../../scripts/status.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-st-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.1.0', entries: [
      { event: 'PreToolUse', command: 'bash /pkg/hooks/banned-vocab-check.sh', sha256: 'x' }
    ],
  }));
  // Real v6.10.0+ spec format: version lives in the H1 title, no standalone
  // `Version:` line (see spec-structure.test.js:55 and CHANGELOG v0.2.1
  // "Versioning policy": canonical spec version source is the `spec/CLAUDE.md`
  // top-line title). status.js must extract the version from this H1.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'),
    '# AI-CODING-SPEC v6.10.0 — Core\n\nBody.\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('status reports plugin version + installed spec version', async () => {
  const r = await status();
  assert.equal(r.plugin.version, '0.1.0');
  assert.equal(r.spec.installed, '6.10.0');
});

test('status reports kill-switch state', async () => {
  const saved = process.env.DISABLE_CLAUDEMD_HOOKS;
  process.env.DISABLE_CLAUDEMD_HOOKS = '1';
  try {
    const r = await status();
    assert.equal(r.killSwitches.plugin, true);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_CLAUDEMD_HOOKS;
    else process.env.DISABLE_CLAUDEMD_HOOKS = saved;
  }
});

test('status surfaces pendingKillSwitches when settings.json toggles ahead of process.env (Round-6)', async () => {
  // Pre-fix dogfood: `/claudemd-toggle banned-vocab` writes
  // DISABLE_BANNED_VOCAB_HOOK=1 to settings.json. CC will pick that up at
  // next session start. A user running `node scripts/status.js` between
  // toggle and restart saw `banned_vocab: false` (= effective in *this*
  // process) with NO indication that a flip is pending — confusing
  // self-verification of toggle action. Fix: dual-source.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_BANNED_VOCAB_HOOK: '1' } }));
  // Process env intentionally NOT set — simulates "between toggle and CC restart".
  delete process.env.DISABLE_BANNED_VOCAB_HOOK;
  const r = await status();
  assert.equal(r.killSwitches.banned_vocab, false, 'effective stays false this process');
  assert.ok(r.pendingKillSwitches, 'pendingKillSwitches block must exist');
  assert.deepEqual(r.pendingKillSwitches.banned_vocab,
    { effective: false, persisted: true });
});

test('status pendingKillSwitches is empty when env + settings agree', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: {} }));
  delete process.env.DISABLE_BANNED_VOCAB_HOOK;
  const r = await status();
  assert.deepEqual(r.pendingKillSwitches, {}, 'no diff → empty pendingKillSwitches');
});

test('status reports not-installed when manifest missing', async () => {
  // v0.1.9: manifest lives at ~/.claude/.claudemd-manifest.json outside
  // the runtime state dir. Clean both locations to assert "not-installed".
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), { force: true });
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true, force: true });
  const r = await status();
  assert.equal(r.plugin.installed, false);
  // No cache dir present → no hint either.
  assert.equal(r.plugin.hint, undefined);
});

test('status survives a manifest with version but no entries array (v0.23.11)', async () => {
  // A legacy / hand-edited / truncated manifest may carry `version` without
  // `entries`. Pre-fix `m.data.entries.length` threw an unguarded TypeError
  // + raw stack (exit 1) — the lone manifest consumer that didn't guard.
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'),
    JSON.stringify({ version: '9.9.9' }));
  const r = await status();
  assert.equal(r.plugin.installed, true);
  assert.equal(r.plugin.version, '9.9.9');
  assert.equal(r.plugin.entries, 0);
});

test('status flags cache-present-bootstrap-pending when manifest missing but plugin cache exists', async () => {
  // CC's `/plugin install claudemd@claudemd` lands the version dir in
  // ~/.claude/plugins/cache/claudemd/claudemd/<ver>/ but does NOT fire
  // postInstall, so install.js (which writes the manifest) hasn't run yet.
  // status.js must surface this limbo state so /claudemd-status can tell
  // the user the plugin is staged but not bootstrapped.
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), { force: true });
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true, force: true });
  const cacheBase = path.join(tmpHome, '.claude/plugins/cache/claudemd/claudemd');
  fs.mkdirSync(path.join(cacheBase, '0.6.4'), { recursive: true });
  fs.mkdirSync(path.join(cacheBase, '0.6.5'), { recursive: true });
  // Non-semver dir must be ignored (e.g. dev-mode `node scripts/install.js`
  // from a git checkout where the cache dir basename is the branch name).
  fs.mkdirSync(path.join(cacheBase, 'main'), { recursive: true });
  const r = await status();
  assert.equal(r.plugin.installed, false);
  assert.equal(r.plugin.hint, 'cache-present-bootstrap-pending');
  assert.deepEqual(r.plugin.cacheVersions, ['0.6.4', '0.6.5']);
});

test('status.spec.hashes covers all four spec files (v0.6.0, v0.19.0 adds OPERATOR.md)', async () => {
  const r = await status();
  assert.ok(Array.isArray(r.spec.hashes), 'spec.hashes must be an array');
  assert.equal(r.spec.hashes.length, 4);
  assert.deepEqual(r.spec.hashes.map(h => h.name),
    ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md']);
  // The fixture installed-spec content does NOT match the shipped spec
  // (test writes a synthetic 6.10.0 stub, not the real shipped spec) — so
  // CLAUDE.md must report match=false. This proves drift is detected, not
  // silently green.
  const main = r.spec.hashes.find(h => h.name === 'CLAUDE.md');
  assert.equal(main.match, false);
  assert.equal(typeof main.installed, 'string'); // fixture installed
  assert.equal(typeof main.shipped, 'string');   // real shipped from repo
});

test('status omits verbose block by default', async () => {
  const r = await status();
  assert.equal(r.verbose, undefined, 'default status must not carry verbose block');
});

test('status({verbose:true}) emits per-hook kill-switch table covering every shipped hook', async () => {
  const r = await status({ verbose: true });
  assert.ok(r.verbose, 'verbose block must exist');
  assert.ok(r.verbose.killSwitches, 'verbose.killSwitches must exist');
  assert.ok(r.verbose.killSwitches.global, 'global kill-switch entry must exist');
  assert.equal(r.verbose.killSwitches.global.envVar, 'DISABLE_CLAUDEMD_HOOKS');
  // perHook must list all 16 shipped hooks (matches hook-registry.js).
  assert.equal(r.verbose.killSwitches.perHook.length, 16,
    'perHook must enumerate every entry in HOOK_REGISTRY');
  const sample = r.verbose.killSwitches.perHook.find(h => h.displayName === 'banned-vocab');
  assert.ok(sample, 'banned-vocab hook must appear in perHook');
  assert.equal(sample.envVar, 'DISABLE_BANNED_VOCAB_HOOK');
  assert.equal(sample.event, 'PreToolUse');
  assert.equal(typeof sample.effective, 'boolean');
  assert.equal(typeof sample.persisted, 'boolean');
});

test('status({verbose:true}) emits escapeTokens table covering all 5 per-invocation bypasses', async () => {
  const r = await status({ verbose: true });
  assert.ok(Array.isArray(r.verbose.escapeTokens), 'verbose.escapeTokens must be an array');
  assert.equal(r.verbose.escapeTokens.length, 5, 'all 5 documented escape tokens must appear');
  const tokens = r.verbose.escapeTokens.map(t => t.token);
  assert.ok(tokens.includes('[allow-banned-vocab]'));
  assert.ok(tokens.includes('known-red baseline:'));
  assert.ok(tokens.includes('[skip-memory-check]'));
  assert.ok(tokens.includes('[allow-rm-rf-var]'));
  assert.ok(tokens.includes('[allow-npx-unpinned]'));
  // Every entry carries the cross-ref triple (where / bypasses / section)
  for (const e of r.verbose.escapeTokens) {
    assert.equal(typeof e.where, 'string', `${e.token} missing where`);
    assert.equal(typeof e.bypasses, 'string', `${e.token} missing bypasses`);
    assert.match(e.section, /^§/, `${e.token} section must start with §`);
  }
});

test('status({verbose:true}) reflects persisted kill-switch from settings.json (per-hook detail)', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_BANNED_VOCAB_HOOK: '1' } }));
  delete process.env.DISABLE_BANNED_VOCAB_HOOK;
  const r = await status({ verbose: true });
  const bv = r.verbose.killSwitches.perHook.find(h => h.displayName === 'banned-vocab');
  assert.equal(bv.effective, false, 'effective stays false this process');
  assert.equal(bv.persisted, true, 'persisted reflects settings.json toggle');
});

test('status.features.bashReadonlyFastPath defaults TRUE when env var unset (v0.20.0)', async () => {
  // v0.20.0 promotion: default flipped from opt-in OFF to opt-out ON.
  // Verify the new default state.
  const saved = process.env.BASH_READONLY_FAST_PATH;
  try {
    delete process.env.BASH_READONLY_FAST_PATH;
    const r = await status();
    assert.equal(r.features.bashReadonlyFastPath, true,
      'unset env var must mean fast-path ON per v0.20.0 default flip');
  } finally {
    if (saved === undefined) delete process.env.BASH_READONLY_FAST_PATH;
    else process.env.BASH_READONLY_FAST_PATH = saved;
  }
});

test('status.features.bashReadonlyFastPath honors explicit opt-out =0 (v0.20.0)', async () => {
  const saved = process.env.BASH_READONLY_FAST_PATH;
  try {
    process.env.BASH_READONLY_FAST_PATH = '0';
    const r = await status();
    assert.equal(r.features.bashReadonlyFastPath, false,
      'explicit BASH_READONLY_FAST_PATH=0 must opt OUT of fast-path');
  } finally {
    if (saved === undefined) delete process.env.BASH_READONLY_FAST_PATH;
    else process.env.BASH_READONLY_FAST_PATH = saved;
  }
});

test('status.features.bashReadonlyFastPath ON for any non-zero value (v0.20.0)', async () => {
  // Any value other than the literal "0" → ON. Robustness against typos.
  const saved = process.env.BASH_READONLY_FAST_PATH;
  try {
    process.env.BASH_READONLY_FAST_PATH = '1';
    assert.equal((await status()).features.bashReadonlyFastPath, true);
    process.env.BASH_READONLY_FAST_PATH = 'on';
    assert.equal((await status()).features.bashReadonlyFastPath, true,
      'truthy strings other than the literal "0" must still mean ON');
  } finally {
    if (saved === undefined) delete process.env.BASH_READONLY_FAST_PATH;
    else process.env.BASH_READONLY_FAST_PATH = saved;
  }
});

test('status.features.bashSafetyIndirectCall defaults TRUE when env var unset (v0.21.8 default-ON)', async () => {
  // v0.21.8 flipped this flag from opt-in OFF to default-ON (the hook reads
  // `${BASH_SAFETY_INDIRECT_CALL:-1} != 0`). status.js must mirror that
  // default-ON semantics, like bashReadonlyFastPath — not the stale
  // `=== '1'` (explicit-set) check that misreports unset as OFF.
  const saved = process.env.BASH_SAFETY_INDIRECT_CALL;
  try {
    delete process.env.BASH_SAFETY_INDIRECT_CALL;
    const r = await status();
    assert.equal(r.features.bashSafetyIndirectCall, true,
      'unset env var must report indirect-call ON per v0.21.8 default flip');
  } finally {
    if (saved === undefined) delete process.env.BASH_SAFETY_INDIRECT_CALL;
    else process.env.BASH_SAFETY_INDIRECT_CALL = saved;
  }
});

test('status.features.bashSafetyIndirectCall honors explicit opt-out =0 (v0.21.8)', async () => {
  const saved = process.env.BASH_SAFETY_INDIRECT_CALL;
  try {
    process.env.BASH_SAFETY_INDIRECT_CALL = '0';
    const r = await status();
    assert.equal(r.features.bashSafetyIndirectCall, false,
      'explicit BASH_SAFETY_INDIRECT_CALL=0 must report indirect-call OFF');
  } finally {
    if (saved === undefined) delete process.env.BASH_SAFETY_INDIRECT_CALL;
    else process.env.BASH_SAFETY_INDIRECT_CALL = saved;
  }
});

test('status.features.batchCadenceAdvisory defaults TRUE when env var unset (v0.20.1)', async () => {
  // v0.20.1 I3 — sub-feature flag surfaced. Default ON (DISABLE_*=1 turns off).
  const saved = process.env.DISABLE_BATCH_CADENCE_ADVISORY;
  try {
    delete process.env.DISABLE_BATCH_CADENCE_ADVISORY;
    const r = await status();
    assert.equal(r.features.batchCadenceAdvisory, true);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_BATCH_CADENCE_ADVISORY;
    else process.env.DISABLE_BATCH_CADENCE_ADVISORY = saved;
  }
});

test('status.features.batchCadenceAdvisory honors DISABLE_BATCH_CADENCE_ADVISORY=1 (v0.20.1)', async () => {
  const saved = process.env.DISABLE_BATCH_CADENCE_ADVISORY;
  try {
    process.env.DISABLE_BATCH_CADENCE_ADVISORY = '1';
    const r = await status();
    assert.equal(r.features.batchCadenceAdvisory, false);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_BATCH_CADENCE_ADVISORY;
    else process.env.DISABLE_BATCH_CADENCE_ADVISORY = saved;
  }
});

test('status.features.batchCadenceThreshold defaults to 20 when env unset (v0.20.1)', async () => {
  const saved = process.env.CLAUDEMD_BATCH_THRESHOLD;
  try {
    delete process.env.CLAUDEMD_BATCH_THRESHOLD;
    const r = await status();
    assert.equal(r.features.batchCadenceThreshold, 20);
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_BATCH_THRESHOLD;
    else process.env.CLAUDEMD_BATCH_THRESHOLD = saved;
  }
});

test('status.features.batchCadenceThreshold honors positive-int override (v0.20.1)', async () => {
  const saved = process.env.CLAUDEMD_BATCH_THRESHOLD;
  try {
    process.env.CLAUDEMD_BATCH_THRESHOLD = '5';
    assert.equal((await status()).features.batchCadenceThreshold, 5);
    process.env.CLAUDEMD_BATCH_THRESHOLD = '100';
    assert.equal((await status()).features.batchCadenceThreshold, 100);
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_BATCH_THRESHOLD;
    else process.env.CLAUDEMD_BATCH_THRESHOLD = saved;
  }
});

test('status.features.batchCadenceThreshold falls back to 20 on invalid input (v0.20.1)', async () => {
  // Non-numeric / zero / negative / float → default 20. Matches the env guard
  // in session-end-check.sh (CLAUDEMD_BATCH_THRESHOLD requires ^[1-9][0-9]*$).
  const saved = process.env.CLAUDEMD_BATCH_THRESHOLD;
  try {
    for (const bad of ['0', '-5', '2.5', 'abc', '']) {
      process.env.CLAUDEMD_BATCH_THRESHOLD = bad;
      assert.equal((await status()).features.batchCadenceThreshold, 20,
        `bad input '${bad}' must fall back to default 20`);
    }
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_BATCH_THRESHOLD;
    else process.env.CLAUDEMD_BATCH_THRESHOLD = saved;
  }
});

test('status.features.bashSafetyIndirectCall ON for any non-zero value (v0.21.8)', async () => {
  // Was "reflects env var (v0.6.0)" with a stale `unset → false` assertion
  // encoding the pre-v0.21.8 default-OFF semantics; that contradicted the
  // hook's `:-1` default-ON and is now covered (true) by the unset test above.
  // Any value other than the literal "0" → ON (mirrors bashReadonlyFastPath).
  const saved = process.env.BASH_SAFETY_INDIRECT_CALL;
  try {
    process.env.BASH_SAFETY_INDIRECT_CALL = '1';
    assert.equal((await status()).features.bashSafetyIndirectCall, true);
    process.env.BASH_SAFETY_INDIRECT_CALL = 'on';
    assert.equal((await status()).features.bashSafetyIndirectCall, true,
      'truthy strings other than the literal "0" must still mean ON');
  } finally {
    if (saved === undefined) delete process.env.BASH_SAFETY_INDIRECT_CALL;
    else process.env.BASH_SAFETY_INDIRECT_CALL = saved;
  }
});
