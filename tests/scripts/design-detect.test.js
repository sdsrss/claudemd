// design-detect.js tests — pure/stateless detector for /claudemd-design-adopt.
// Verdict matrix over the fixture tree + review-driven regression locks:
// nested SCSS interpolation (#196), unterminated comment (#191), digit/underscore
// custom-prop names (#199), monorepo cross-package token misattribution (#247),
// backend-with-site/ false positive (#143), wiring-check basename false positive
// (#291), and the pathToFileURL main guard (#3). Fixture-mutation variants run on
// mkdtemp COPIES so committed fixtures stay pristine (§8.V3). The detector writes
// NOTHING to disk, so there is no cache/state to assert or clean.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { detect } = await import('../../scripts/design-detect.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '../fixtures/design-detect');
const SCRIPT = path.resolve(HERE, '../../scripts/design-detect.js');
const LIB = path.resolve(HERE, '../../scripts/lib');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-design-detect-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function tmpCopy(name) {
  const dst = fs.mkdtempSync(path.join(TMP, `${name}-`));
  fs.cpSync(path.join(FIX, name), dst, { recursive: true });
  return dst;
}
const paths = (r) => r.tokenSources.map(t => t.path);

// ── verdict matrix ──────────────────────────────────────────────────────────

test('vue-scss: adoptable; scss variables + interpolated :root; skips node_modules; dark signal', () => {
  const r = detect(path.join(FIX, 'vue-scss'));
  assert.equal(r.verdict, 'adoptable');
  assert.equal(r.framework, 'vue');
  assert.ok(r.uiLibs.includes('element-plus'));
  assert.ok(paths(r).includes(path.join('src', 'assets', 'styles', 'variables.scss')));
  assert.ok(paths(r).includes(path.join('src', 'assets', 'styles', 'main.scss'))); // #{} interpolation
  assert.ok(!paths(r).some(p => p.includes('node_modules')));
  assert.ok(r.darkModeSignals.includes(path.join('src', 'assets', 'styles', 'main.scss')));
});

test('vue-scss fixture is the byte-exact daagu sample (fixture-drift lock)', () => {
  const scss = fs.readFileSync(path.join(FIX, 'vue-scss/src/assets/styles/variables.scss'), 'utf8');
  assert.ok(scss.includes('$stock-up-color: $neon-vermilion;'));
  assert.ok(scss.includes('// 股票涨跌 (A股铁律: 红涨绿跌)'));
});

test('react-tailwind v3: adoptable via config; small :root (2 props) is NOT a source', () => {
  const r = detect(path.join(FIX, 'react-tailwind'));
  assert.equal(r.verdict, 'adoptable');
  assert.deepEqual(paths(r), ['tailwind.config.ts']);
  assert.ok(r.darkModeSignals.includes('tailwind.config.ts'));
});

test('monorepo (shallow) + deep monorepo: adoptable via subproject walk', () => {
  const shallow = detect(path.join(FIX, 'monorepo'));
  assert.equal(shallow.verdict, 'adoptable');
  assert.equal(shallow.monorepoPkg, path.join('packages', 'web'));
  assert.ok(paths(shallow).includes(path.join('packages', 'web', 'uno.config.ts')));
  const deep = detect(path.join(FIX, 'monorepo-deep'));
  assert.equal(deep.verdict, 'adoptable');
  assert.ok(paths(deep).some(p => p.endsWith(path.join('styles', 'variables.scss'))));
});

test('fullstack split (empty root + frontend/): adoptable via subproject fallback', () => {
  const r = detect(path.join(FIX, 'fullstack'));
  assert.equal(r.verdict, 'adoptable');
  assert.equal(r.monorepoPkg, 'frontend');
  assert.ok(paths(r).includes(path.join('frontend', 'src', 'styles', 'variables.scss')));
});

test('nuxt meta-framework + tailwind v4 @theme: adoptable', () => {
  const nuxt = detect(path.join(FIX, 'nuxt'));
  assert.equal(nuxt.framework, 'nuxt');
  assert.equal(nuxt.verdict, 'adoptable');
  const v4 = detect(path.join(FIX, 'tailwind-v4'));
  assert.equal(v4.verdict, 'adoptable');
  assert.ok(paths(v4).some(p => p.endsWith('app.css')));
});

test('no-ui / ui-no-tokens matrix', () => {
  assert.equal(detect(path.join(FIX, 'node-cli')).verdict, 'no-ui');
  assert.equal(detect(path.join(FIX, 'empty')).verdict, 'no-ui');
  assert.equal(detect(path.join(FIX, 'ui-no-tokens')).verdict, 'ui-no-tokens');
});

// ── review regression locks ─────────────────────────────────────────────────

test('#196 nested SCSS interpolation in a :root block is counted', () => {
  const r = detect(path.join(FIX, 'nested-interp'));
  assert.equal(r.verdict, 'adoptable');
  assert.ok(paths(r).some(p => p.endsWith('main.scss')));
});

test('#199 digit/underscore-first custom-property names are counted', () => {
  const r = detect(path.join(FIX, 'digit-props'));
  assert.equal(r.verdict, 'adoptable');
  assert.ok(paths(r).some(p => p.endsWith('scale.css')));
});

test('#191 unterminated /* comment wrapping a :root block is NOT a token source', () => {
  const r = detect(path.join(FIX, 'unterminated-comment'));
  assert.equal(r.verdict, 'ui-no-tokens');
  assert.deepEqual(r.tokenSources, []);
});

test('#13 :root-in-comment + component-scoped props is NOT a token system', () => {
  const r = detect(path.join(FIX, 'css-scoped-trap'));
  assert.equal(r.verdict, 'ui-no-tokens');
  assert.deepEqual(r.tokenSources, []);
});

test('#247 monorepo: a non-UI sibling package’s tokens are NOT attributed to the UI package', () => {
  const r = detect(path.join(FIX, 'monorepo-siblingtokens'));
  assert.equal(r.monorepoPkg, path.join('packages', 'web'));
  assert.deepEqual(r.tokenSources, []);          // emails/_variables.scss must NOT leak in
  assert.equal(r.verdict, 'ui-no-tokens');
});

test('#143 backend repo with an incidental site/ stays no-ui (no adopt nag)', () => {
  const r = detect(path.join(FIX, 'backend-site'));
  assert.equal(r.verdict, 'no-ui');
  assert.equal(r.monorepoPkg, null);
});

test('#291 wiring: a bare token-basename mention in CLAUDE.md is NOT "configured"', () => {
  const dir = tmpCopy('vue-scss');
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), '# DESIGN.md\n');
  // CLAUDE.md mentions variables.scss for an unrelated reason, never DESIGN.md.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'The build reads src/assets/styles/variables.scss.\n');
  assert.equal(detect(dir).verdict, 'unwired');
  // real wiring (DESIGN.md reference) → configured
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'UI 改动前必读 `DESIGN.md`\n');
  assert.equal(detect(dir).verdict, 'configured');
  // sentinel block also counts
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '<!-- claudemd-design:begin v1 -->\n...\n');
  assert.equal(detect(dir).verdict, 'configured');
});

test('#4/#14 monorepo subproject + >64KB CLAUDE.md wiring', () => {
  const mono = tmpCopy('monorepo');
  fs.writeFileSync(path.join(mono, 'packages/web/DESIGN.md'), '# DESIGN.md\n');
  fs.writeFileSync(path.join(mono, 'packages/web/CLAUDE.md'), 'see `DESIGN.md`\n');
  assert.equal(detect(mono).verdict, 'configured');

  const big = tmpCopy('vue-scss');
  fs.writeFileSync(path.join(big, 'DESIGN.md'), '# DESIGN.md\n');
  fs.writeFileSync(path.join(big, 'CLAUDE.md'), '# notes\n'.repeat(9000) + '\nsee `DESIGN.md`\n');
  assert.equal(detect(big).verdict, 'configured'); // full read, not 64KB head
});

test('#6 FIFO in the tree does not hang the walk', () => {
  const dir = tmpCopy('vue-scss');
  try { execFileSync('mkfifo', [path.join(dir, 'src/theme.css')]); }
  catch { return; } // non-POSIX → skip
  assert.equal(detect(dir).verdict, 'adoptable');
});

test('token set enumeration is stable (sorted) across runs', () => {
  const a = detect(path.join(FIX, 'vue-scss')).tokenSources.map(t => t.path);
  const b = detect(path.join(FIX, 'vue-scss')).tokenSources.map(t => t.path);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort());
});

// ── CLI contract ────────────────────────────────────────────────────────────

test('CLI: --json verdict, --help exit 0, unknown flag exit 2, fail-open on bogus cwd', () => {
  const env = { ...process.env, HOME: TMP };
  assert.equal(JSON.parse(execFileSync('node', [SCRIPT, '--json', `--cwd=${path.join(FIX, 'node-cli')}`], { env, encoding: 'utf8' })).verdict, 'no-ui');
  assert.ok(execFileSync('node', [SCRIPT, '--help'], { env, encoding: 'utf8' }).includes('Usage:'));
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--bogus'], { env, encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.equal(JSON.parse(execFileSync('node', [SCRIPT, '--json', '--cwd=/nonexistent-xyz'], { env, encoding: 'utf8' })).verdict, 'no-ui');
});

test('#3 main guard fires when the script path contains a space (pathToFileURL)', () => {
  const base = path.join(TMP, 'with space', 'scripts');
  fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(base, 'design-detect.js'));
  for (const f of ['argv.js', 'paths.js']) fs.copyFileSync(path.join(LIB, f), path.join(base, 'lib', f));
  const out = execFileSync('node', [path.join(base, 'design-detect.js'), '--json', `--cwd=${path.join(FIX, 'node-cli')}`], { env: { ...process.env, HOME: TMP }, encoding: 'utf8' });
  assert.equal(JSON.parse(out).verdict, 'no-ui'); // pre-fix: empty stdout → JSON.parse throws
});
