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

test('status.spec.hashes covers all three spec files (v0.6.0)', async () => {
  const r = await status();
  assert.ok(Array.isArray(r.spec.hashes), 'spec.hashes must be an array');
  assert.equal(r.spec.hashes.length, 3);
  assert.deepEqual(r.spec.hashes.map(h => h.name),
    ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md']);
  // The fixture installed-spec content does NOT match the shipped spec
  // (test writes a synthetic 6.10.0 stub, not the real shipped spec) — so
  // CLAUDE.md must report match=false. This proves drift is detected, not
  // silently green.
  const main = r.spec.hashes.find(h => h.name === 'CLAUDE.md');
  assert.equal(main.match, false);
  assert.equal(typeof main.installed, 'string'); // fixture installed
  assert.equal(typeof main.shipped, 'string');   // real shipped from repo
});

test('status.features.bashSafetyIndirectCall reflects env var (v0.6.0)', async () => {
  const saved = process.env.BASH_SAFETY_INDIRECT_CALL;
  try {
    delete process.env.BASH_SAFETY_INDIRECT_CALL;
    const off = await status();
    assert.equal(off.features.bashSafetyIndirectCall, false);

    process.env.BASH_SAFETY_INDIRECT_CALL = '1';
    const on = await status();
    assert.equal(on.features.bashSafetyIndirectCall, true);
  } finally {
    if (saved === undefined) delete process.env.BASH_SAFETY_INDIRECT_CALL;
    else process.env.BASH_SAFETY_INDIRECT_CALL = saved;
  }
});
