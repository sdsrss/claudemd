// spec-modules.test.js — per-phase spec modules (tasks/specs/spec-modules.md).
// Pins: the build from marked sections of spec/CLAUDE-extended.md, the committed
// outputs matching that build, the size caps, core §2.2's index agreeing with the
// registry and with what each module holds, and the installer's mirror of the
// module directory (write, idempotence, orphan removal, uninstall delete).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitModules, buildModules } from '../../scripts/lib/spec-modules.js';
import { syncSpecModules, compareSpecModules } from '../../scripts/lib/spec-hash.js';
import { specModulesHome } from '../../scripts/lib/paths.js';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MOD_DIR = path.join(REPO, 'spec', 'spec-modules');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO, 'spec', 'spec-modules.json'), 'utf8')).modules;
const box = useHomeSandbox('spec-modules');

test('spec-modules: a chunk that starts at ### carries its ## heading; none is dropped', () => {
  const src = [
    '# AI-CODING-SPEC v9.9.9 — Extended',
    'preamble',
    '<!-- module: a -->',
    '## §1 ONE',
    'body one',
    '<!-- module: b -->',
    '### sub of one',
    'body sub',
    '<!-- module: none -->',
    '## §9 META',
    'maintainer',
  ].join('\n');
  const parts = splitModules(src);
  assert.deepEqual(Object.keys(parts), ['a', 'b']);
  assert.match(parts.a[0], /^## §1 ONE\nbody one$/);
  assert.match(parts.b[0], /^## §1 ONE\n\n### sub of one\nbody sub$/);
  assert.ok(!JSON.stringify(parts).includes('maintainer'));
});

test('spec-modules: an unregistered marker or an empty registry entry is a build error', () => {
  const src = '# AI-CODING-SPEC v1.0.0 — Extended\n<!-- module: x -->\n## A\nz\n';
  assert.throws(() => buildModules(src, { y: { loadsOn: 'y' } }), /no registry entry: x/);
  assert.throws(() => buildModules(src, { x: { loadsOn: 'x' }, y: { loadsOn: 'y' } }), /no marked text: y/);
});

// A marker the build does not recognise used to be plain text: its chunk went
// on into the module before it (one trailing space moved 687 bytes of ship
// into verify). Every near-miss spelling is a build error naming its line.
test('spec-modules: a line that looks like a marker but is not one is a build error naming the line', () => {
  for (const bad of [
    '<!-- module: b --> ',
    '<!-- module: b -->\r',
    '<!--module: b -->',
    '<!-- Module: b -->',
    // 0.113.3 pre-tag review L3: no colon, and the plural, passed silently.
    '<!-- module b -->',
    '<!-- modules: b -->',
  ]) {
    const src = [
      '# AI-CODING-SPEC v1.0.0 — Extended',
      '<!-- module: a -->',
      '## A',
      'x',
      bad,
      '## B',
      'y',
    ].join('\n');
    assert.throws(() => splitModules(src), /line 5 .*not a module marker/, JSON.stringify(bad));
  }
});

test('build-spec-modules: an unwritable module file is a one-line error and exit 1, not a stack trace', t => {
  if (process.getuid && process.getuid() === 0) return t.skip('root writes through mode 0444');
  const root = box.dir('repo');
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  for (const f of ['build-spec-modules.js', 'lib/argv.js', 'lib/spec-modules.js'])
    fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(root, 'scripts', f));
  fs.cpSync(path.join(REPO, 'spec'), path.join(root, 'spec'), { recursive: true });
  fs.chmodSync(path.join(root, 'spec', 'spec-modules', 'ship.md'), 0o444);
  const r = spawnSync('node', [path.join(root, 'scripts', 'build-spec-modules.js')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^[^\n]*ship\.md[^\n]*\n$/, 'one line naming the file');
});

test('spec-modules: the committed modules are exactly what the source builds', () => {
  const r = spawnSync('node', [path.join(REPO, 'scripts/build-spec-modules.js'), '--check'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
});

test('spec-modules: each module <= 9 KB and all together <= 50 KB', () => {
  let total = 0;
  for (const f of fs.readdirSync(MOD_DIR)) {
    const n = fs.statSync(path.join(MOD_DIR, f)).size;
    total += n;
    assert.ok(n <= 9 * 1024, `${f} is ${n} bytes`);
  }
  assert.ok(total <= 50 * 1024, `modules total ${total} bytes`);
});

// spec-module-inject.sh puts the first matched module in whatever its size and
// defers a second one that would cross BUDGET (tasks/specs/spec-modules.md r7).
// That is only safe while every module fits alone: Claude Code replaces an
// additionalContext string over 10,000 characters with a path and a preview.
// The entry is rebuilt the way hooks/lib/spec-module.sh builds it; tests/hooks/
// spec-module-inject.test.sh case 16 measures the hook's real output.
test('spec-modules: every module fits the injection budget alone, and the budget sits under the cap', () => {
  const hook = fs.readFileSync(path.join(REPO, 'hooks', 'spec-module-inject.sh'), 'utf8');
  const budget = Number((hook.match(/^BUDGET=(\d+)$/m) || [])[1]);
  assert.ok(budget > 0 && budget <= 10000 - 200, `BUDGET=${budget} leaves no margin under 10,000`);
  for (const f of fs.readdirSync(MOD_DIR)) {
    const name = f.replace(/\.md$/, '');
    const lines = fs.readFileSync(path.join(MOD_DIR, f), 'utf8').replace(/\n$/, '').split('\n');
    const end = lines.indexOf('---', 1);
    const body = lines
      .slice(end + 1)
      .filter(l => !/^<!-- generated from .* -->$/.test(l))
      .join('\n');
    const entry =
      `[claudemd] system-injected — spec module \`${name}\` (~/.claude/spec-modules/${name}.md), ` +
      `matched by the user's prompt. Its rules apply to this task as if read from the file.\n\n` +
      `<spec-module name="${name}">\n${body}\n</spec-module>\n\n`;
    assert.ok(entry.length <= budget, `${name} injects ${entry.length} characters, over BUDGET=${budget}`);
  }
});

test('spec-modules: core §2.2 lists every registered module once, and each named § ID is in its module', () => {
  const core = fs.readFileSync(path.join(REPO, 'spec', 'CLAUDE.md'), 'utf8');
  const sec = core.slice(core.indexOf('### §2.2 MODULES'), core.indexOf('\n## §3 TRUST'));
  const rows = [...sec.matchAll(/^- `([a-z-]+)\.md` — .*\(([^)]*)\)$/gm)];
  assert.deepEqual(rows.map(r => r[1]).sort(), Object.keys(REGISTRY).sort());
  for (const [, name, ids] of rows) {
    const text = fs.readFileSync(path.join(MOD_DIR, `${name}.md`), 'utf8');
    for (const id of ids.match(/§[0-9][0-9A-Za-z.-]*/g) || []) {
      assert.ok(text.includes(id), `core §2.2 says ${name}.md holds ${id}; it does not`);
    }
  }
});

test('spec-modules: every module frontmatter carries its registry metadata', () => {
  for (const [name, meta] of Object.entries(REGISTRY)) {
    const text = fs.readFileSync(path.join(MOD_DIR, `${name}.md`), 'utf8');
    assert.ok(text.startsWith(`---\nmodule: ${name}\nloads-on: ${meta.loadsOn}\n`), name);
    assert.ok(text.includes(`\ntrigger-window: ${meta.window}\n`), name);
  }
});

test('spec-modules install: sync writes every module, then nothing, then removes an orphan only', () => {
  assert.ok(box.home, 'sandbox HOME');
  const first = syncSpecModules(REPO);
  assert.equal(first.written.length, Object.keys(REGISTRY).length);
  assert.deepEqual(syncSpecModules(REPO).written, [], 'second run is a no-op');
  const dir = specModulesHome();
  fs.writeFileSync(path.join(dir, 'retired.md'), 'old\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'user\n');
  const third = syncSpecModules(REPO);
  assert.deepEqual(third.removed, ['retired.md']);
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')), 'a non-.md file is left alone');
  assert.ok(compareSpecModules(REPO).every(r => r.match));
  fs.appendFileSync(path.join(dir, 'ship.md'), 'edit\n');
  assert.equal(compareSpecModules(REPO).find(r => r.name === 'spec-modules/ship.md').match, false);
});
