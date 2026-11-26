// version-cascade-check tests. Pattern follows spec-coherence-audit.test.js:
// real-repo smoke (catches drift on every `npm test`) + synthetic fixtures
// for failure paths the real repo can't reproduce while green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runVersionCascadeCheck, runPluginSemverCheck } from '../../scripts/version-cascade-check.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/version-cascade-check.js');

// --- Real-repo smoke -------------------------------------------------------

test('real repo: README + plugin.json + marketplace.json all match spec_version minor', () => {
  const r = runVersionCascadeCheck({ root: REPO_ROOT });
  assert.equal(r.ok, true, `cascade drift: ${JSON.stringify(r.offenders, null, 2)}`);
  assert.equal(r.filesChecked.length, 3);
  assert.match(r.expectedMinor, /^v\d+\.\d+$/);
});

// --- Synthetic fixtures: failure paths ------------------------------------

function makeFixture(tmpDir, { specVersion, readme, pluginJson, marketplaceJson }) {
  fs.mkdirSync(path.join(tmpDir, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'spec/hard-rules.json'),
    JSON.stringify({ spec_version: specVersion }, null, 2)
  );
  fs.writeFileSync(path.join(tmpDir, 'README.md'), readme);
  fs.writeFileSync(path.join(tmpDir, '.claude-plugin/plugin.json'), pluginJson);
  fs.writeFileSync(path.join(tmpDir, '.claude-plugin/marketplace.json'), marketplaceJson);
  return tmpDir;
}

test('synthetic: stale README minor → offender reported with file:line + context', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'line 1\nAI-CODING-SPEC v6.11 HARD rules\nline 3\n',
      pluginJson: '{"description":"plugin v6.13 enforcement"}',
      marketplaceJson: '{"metadata":{"description":"marketplace v6.13"}}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, false);
    assert.equal(r.offenders.length, 1);
    assert.equal(r.offenders[0].file, 'README.md');
    assert.equal(r.offenders[0].line, 2);
    assert.equal(r.offenders[0].found, 'v6.11');
    assert.equal(r.offenders[0].expected, 'v6.13');
    assert.match(r.offenders[0].context, /v6\.11/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: patch-only mismatch (v6.13.0 vs v6.13.1) does NOT trip — minor match is enough', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'Spec v6.13.1 docs\n',
      pluginJson: '{"description":"v6.13 plugin"}',
      marketplaceJson: '{"description":"v6.13 market"}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, true, `unexpected offenders: ${JSON.stringify(r.offenders)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: multiple stale mentions reported in scan order', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'A v6.11 line\nAnother v6.10.5 line\n',
      pluginJson: '{"description":"v6.13 ok"}',
      marketplaceJson: '{"d":"old v6.12 stale here too"}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, false);
    assert.equal(r.offenders.length, 3);
    const files = r.offenders.map(o => o.file);
    assert.deepEqual(files, ['README.md', 'README.md', '.claude-plugin/marketplace.json']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- CLI exit codes --------------------------------------------------------

test('CLI: clean repo → exit 0 + stdout ok line', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /ok/);
});

test('CLI: --json → exit 0 + parseable JSON on clean repo (v0.21.2 nested shape)', () => {
  // Top-level `ok` is the combined gate; `cascade` and `pluginSemver`
  // sub-objects carry the per-check detail.
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.cascade.ok, true);
  assert.match(parsed.cascade.expectedMinor, /^v\d+\.\d+$/);
  assert.equal(parsed.cascade.filesChecked.length, 3);
});

test('CLI: --help → exit 0 + usage on stdout', () => {
  const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('CLI: unknown flag → exit 2 + argv-shape error', () => {
  const r = spawnSync('node', [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown/);
});

test('REL-M3: ADDING-NEW-HOOK names as many semver sites as the gate enumerates', () => {
  // Round-17 REL-M3. The contributor doc told you to bump four sites; this gate
  // then checked six (the lockfile pair had been added), and its own failure text
  // still said "All four" — three statements of one number, two of them stale,
  // and the one that decides is the array. The array is the source here: the doc
  // is joined to `--json`'s own output, not to a second literal.
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
  const sites = JSON.parse(r.stdout).pluginSemver.sites;
  assert.ok(sites.length >= 4, `--json reported ${sites.length} semver sites — too few to be real`);

  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/ADDING-NEW-HOOK.md'), 'utf8');
  const WORDS = { four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const m = doc.match(/\*\*(\w+)\*\* semver sites/);
  assert.ok(m, 'ADDING-NEW-HOOK.md no longer states a semver-site count in the pinned form');
  assert.equal(
    WORDS[m[1]] ?? Number(m[1]),
    sites.length,
    `ADDING-NEW-HOOK.md says ${m[1]} semver sites; the gate enumerates ${sites.length}`
  );

  // And each file by name, so a correct total over a wrong list still fails.
  for (const file of new Set(sites.map(s => s.file))) {
    assert.ok(doc.includes(`\`${file}\``), `ADDING-NEW-HOOK.md never names the semver site ${file}`);
  }

  // The gate's own failure text derives its count rather than restating it.
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(
    src,
    /All \$\{semverResult\.sites\.length\} MUST match/,
    'version-cascade-check.js went back to a hand-written count in its failure text'
  );
});

// === Check 3: plugin semver agreement (v0.47.4) ===
// v0.47.1/0.47.2/0.47.3 each shipped with package.json still at 0.47.0 while both
// .claude-plugin manifests advanced — the ship runbook's grep list does not include
// package.json. It is the file readPluginVersion() reads, so install.js stamped a
// stale version into the manifest and /claudemd-status reported 0.47.0 for a live
// 0.47.3 install. These lock the class.

function semverFixture(dir, { pkg, plugin, meta, entry }) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  if (pkg !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: pkg }));
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ version: plugin }));
  fs.writeFileSync(
    path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ metadata: { version: meta }, plugins: [{ version: entry }] })
  );
  return dir;
}

test('pluginSemver: all four manifest sites agree -> ok', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, true);
    assert.equal(r.expected, '1.2.3');
    assert.equal(r.sites.length, 4);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// D#612 (0.117.2): package-lock.json is no longer tracked, so its two copies
// are no longer sites. A stray local lockfile must not count.
test('pluginSemver: a package-lock.json in the root is not a site', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    fs.writeFileSync(
      path.join(d, 'package-lock.json'),
      JSON.stringify({ version: '0.71.3', packages: { '': { version: '0.71.3' } } })
    );
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, true, JSON.stringify(r.sites));
    assert.deepEqual(
      r.sites.filter(x => x.file === 'package-lock.json'),
      [],
      'the lockfile is not read'
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('pluginSemver: stale package.json is caught (the v0.47.1-0.47.3 shape)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '0.47.0', plugin: '0.47.3', meta: '0.47.3', entry: '0.47.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, false, 'stale package.json must fail — it is what install.js stamps');
    assert.equal(r.expected, '0.47.0');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('pluginSemver: a stale marketplace entry is caught too', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.2' });
    assert.equal(runPluginSemverCheck({ root: d }).ok, false);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('pluginSemver: missing package.json fails loudly, does not skip', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, false, 'absent package.json must fail, not fail-open');
    assert.equal(r.sites[0].value, null);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('pluginSemver: the real repo agrees across every site', () => {
  const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const r = runPluginSemverCheck({ root });
  assert.equal(r.ok, true, `real repo semver drift: ${JSON.stringify(r.sites)}`);
});

// README's GitHub Actions example pins `npx --yes claudemd-cli@X.Y.Z`. Nothing
// bumped it: 0.113.4 stood there from 0.115.0 through 0.116.4 while the ruleset
// moved under it. Each pin is a site of its own, so a release bumps it with
// the manifests; a README with no pin adds no site.
test('pluginSemver: each README claudemd-cli pin is a site, named by line', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    fs.writeFileSync(
      path.join(d, 'README.md'),
      'intro\n  run: npx --yes claudemd-cli@1.2.3 lint --stdin\n\n`npx claudemd-cli@1.1.0 audit x`\n'
    );
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, false, 'a stale README pin must fail');
    const pins = r.sites.filter(s => s.file === 'README.md');
    assert.deepEqual(
      pins.map(s => [s.path, s.value]),
      [
        ['claudemd-cli@ (line 2)', '1.2.3'],
        ['claudemd-cli@ (line 4)', '1.1.0'],
      ]
    );
    assert.equal(r.sites.length, 6);

    fs.writeFileSync(path.join(d, 'README.md'), 'npx --yes claudemd-cli@1.2.3 lint --stdin\n');
    const ok = runPluginSemverCheck({ root: d });
    assert.equal(ok.ok, true, `matching pin must pass: ${JSON.stringify(ok.sites)}`);
    assert.equal(ok.sites.length, 5);

    fs.writeFileSync(path.join(d, 'README.md'), 'npx --yes claudemd-cli lint --stdin\n');
    assert.equal(runPluginSemverCheck({ root: d }).sites.length, 4, 'an unpinned mention is not a site');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// D#612: Claude Code installs a plugin's dependencies, devDependencies included,
// whenever the plugin root holds package.json and a lockfile it installs from
// (2.1.316: package-lock.json or npm-shrinkwrap.json, through `npm ci` on a
// rebuilt package.json and lockfile in a temp dir, so no .npmrc in this repo is
// read; bun.lock,
// through `bun install`). bun.lockb, yarn.lock and pnpm-lock.yaml are refused
// with a warning instead. All six stay untracked.
// With package-lock.json tracked, every cached version carried 37M of eslint,
// c8, prettier and jscpd that no hook or command loads (only the repo's own
// lint and metrics tooling does). The devDependencies are
// pinned to exact versions in package.json instead.
test('D#612: the repo root tracks no lockfile, so the plugin install has nothing to install', () => {
  const lockfiles = [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'bun.lock',
    'bun.lockb',
    'yarn.lock',
    'pnpm-lock.yaml',
  ];
  const r = spawnSync('git', ['ls-files', '--', ...lockfiles], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    r.stdout.split('\n').filter(Boolean),
    [],
    'a tracked root lockfile ships to every plugin cache'
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const loose = Object.entries(pkg.devDependencies || {}).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
  assert.deepEqual(loose, [], 'without a lockfile every devDependency is pinned to an exact version');
});
