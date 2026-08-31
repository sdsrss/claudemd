import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pluginCacheDir, stateDir, logsDir, settingsPath, backupRoot, specHome, manifestPath, legacyManifestPath, readManifest, codeGraphRegistryPath, codeGraphProvidersBackupPath, SEMVER_RE, semverCmp } from '../../scripts/lib/paths.js';
import path from 'node:path';
import os from 'node:os';

test('pluginCacheDir points to ~/.claude/plugins/cache/claudemd', () => {
  assert.equal(pluginCacheDir(), path.join(os.homedir(), '.claude/plugins/cache/claudemd'));
});

test('stateDir points to ~/.claude/.claudemd-state', () => {
  assert.equal(stateDir(), path.join(os.homedir(), '.claude/.claudemd-state'));
});

test('stateDir honors CLAUDEMD_STATE_DIR — one seam, not one per caller (条目 13)', () => {
  // The seam existed only inside doctor.js and clean-residue.js, so pointing
  // CLAUDEMD_STATE_DIR at a fixture redirected the two things that DELETE from
  // the state dir and none of the things that write to it: install.js,
  // uninstall.js and statusline.js went on using the real one via this
  // function. Asserted here, at the single authority.
  const saved = process.env.CLAUDEMD_STATE_DIR;
  try {
    process.env.CLAUDEMD_STATE_DIR = '/tmp/claudemd-seam-fixture';
    assert.equal(stateDir(), '/tmp/claudemd-seam-fixture');
    // legacyManifestPath is derived from it, so the seam has to carry through.
    assert.equal(legacyManifestPath(), path.join('/tmp/claudemd-seam-fixture', 'installed.json'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_STATE_DIR;
    else process.env.CLAUDEMD_STATE_DIR = saved;
  }
  assert.equal(stateDir(), path.join(os.homedir(), '.claude/.claudemd-state'));
});

test('logsDir points to ~/.claude/logs', () => {
  assert.equal(logsDir(), path.join(os.homedir(), '.claude/logs'));
});

test('settingsPath points to ~/.claude/settings.json', () => {
  assert.equal(settingsPath(), path.join(os.homedir(), '.claude/settings.json'));
});

test('backupRoot points to ~/.claude', () => {
  assert.equal(backupRoot(), path.join(os.homedir(), '.claude'));
});

test('specHome returns four spec paths in ~/.claude (CLAUDE trio + OPERATOR.md)', () => {
  const paths = specHome();
  assert.equal(paths.length, 4);
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-extended.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-changelog.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/OPERATOR.md')));
});

test('HOME override respected', () => {
  const saved = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
  try {
    assert.equal(pluginCacheDir(), '/tmp/fake-home/.claude/plugins/cache/claudemd');
  } finally {
    process.env.HOME = saved;
  }
});

test('manifestPath is outside stateDir — rm -rf stateDir keeps manifest (v0.1.9 P1)', () => {
  // v0.1.9 relocates the install manifest out of the runtime state dir so
  // that clearing residue-audit/sandbox-disposal baselines via
  // `rm -rf ~/.claude/.claudemd-state/` no longer erases install metadata.
  const saved = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
  try {
    assert.equal(manifestPath(), '/tmp/fake-home/.claude/.claudemd-manifest.json');
    assert.equal(legacyManifestPath(), '/tmp/fake-home/.claude/.claudemd-state/installed.json');
    assert.ok(!manifestPath().startsWith(stateDir()));
  } finally {
    process.env.HOME = saved;
  }
});

test('readManifest migrates legacy ~/.claudemd-state/installed.json to new location (v0.1.9 P1a)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
    const legacy = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
    const newPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
    const payload = { version: 'test', entries: [{ event: 'X' }] };
    fs.writeFileSync(legacy, JSON.stringify(payload));

    const r = readManifest();
    assert.equal(r.exists, true);
    assert.equal(r.migrated, true);
    assert.equal(r.data.version, 'test');
    assert.equal(r.path, newPath);
    assert.ok(fs.existsSync(newPath), 'new manifest must be written');
    assert.ok(!fs.existsSync(legacy), 'legacy manifest must be unlinked');
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('readManifest returns exists=false when neither path present (v0.1.9)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const r = readManifest();
    assert.equal(r.exists, false);
    assert.equal(r.data, null);
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('readManifest prefers new manifest over stale legacy (v0.1.9)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
    const legacy = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
    const newPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
    fs.writeFileSync(legacy, JSON.stringify({ version: 'stale' }));
    fs.writeFileSync(newPath, JSON.stringify({ version: 'fresh' }));

    const r = readManifest();
    assert.equal(r.data.version, 'fresh');
    assert.equal(r.migrated, false);
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('semverCmp orders MAJOR.MINOR.PATCH numerically (v0.36.0)', () => {
  assert.equal(semverCmp('0.33.0', '0.34.0'), -1);
  assert.equal(semverCmp('0.34.0', '0.33.0'), 1);
  assert.equal(semverCmp('0.35.0', '0.35.0'), 0);
  // Numeric, not lexicographic — '0.9.9' < '0.10.0' even though '9' > '1' as a string.
  assert.equal(semverCmp('0.9.9', '0.10.0'), -1);
  assert.equal(semverCmp('1.0.0', '0.99.99'), 1);
});

test('SEMVER_RE accepts strict x.y.z only (v0.36.0)', () => {
  assert.ok(SEMVER_RE.test('0.36.0'));
  assert.ok(!SEMVER_RE.test('9.9.9-test'));
  assert.ok(!SEMVER_RE.test('unknown'));
  assert.ok(!SEMVER_RE.test('v0.36.0'));
  assert.ok(!SEMVER_RE.test('0.36'));
});

test('code-graph registry paths derive from HOME', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    assert.equal(codeGraphRegistryPath(), path.join(tmpHome, '.cache/code-graph/statusline-registry.json'));
    assert.equal(codeGraphProvidersBackupPath(), path.join(tmpHome, '.claude/statusline-providers.json'));
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// --- 2026-08-29 audit R10-17b: SPEC_FILES had four copies and no join -------
test('R10-17b: the spec set has exactly one definition in scripts/', async () => {
  const fs2 = await import('node:fs');
  const path2 = await import('node:path');
  const url = await import('node:url');
  const root = path2.resolve(path2.dirname(url.fileURLToPath(import.meta.url)), '../..');
  const files = [];
  const walk = d => {
    for (const e of fs2.readdirSync(d, { withFileTypes: true })) {
      const full = path2.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path2.join(root, 'scripts'));

  // A single-line array literal holding both names. `[^\]\n]` rather than
  // `[^\]]`: without the newline exclusion the span crossed unrelated code and
  // matched spec-coherence-audit.js, which addresses `CLAUDE.md` and
  // `CLAUDE-extended.md` individually (they are its subject, not a copy of the
  // set) with `m[1]`-style brackets in between.
  const defs = files.filter(f => {
    const src = fs2.readFileSync(f, 'utf8');
    return /\[[^\]\n]*'CLAUDE\.md'[^\]\n]*'CLAUDE-extended\.md'[^\]\n]*\]/.test(src);
  }).map(f => path2.relative(root, f)).sort();

  assert.deepEqual(defs, ['scripts/lib/paths.js'],
    'the shipped spec set must be defined once, in scripts/lib/paths.js — ' +
    `found it spelled out in: ${defs.join(', ')}`);
});

test('R10-17b: specHome() is derived from SPEC_FILES, in order', async () => {
  const { SPEC_FILES, specHome, homeSpec } = await import('../../scripts/lib/paths.js');
  assert.ok(SPEC_FILES.length >= 4, `expected >= 4 spec files, got ${SPEC_FILES.length}`);
  assert.equal(SPEC_FILES[0], 'CLAUDE.md', 'element 0 is treated as canonical by install/backup');
  assert.deepEqual(specHome(), SPEC_FILES.map(n => homeSpec(n)));
});
