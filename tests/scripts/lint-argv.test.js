// lint-argv.test.js — verify the argv-lint gate detects the three antipattern
// signatures, honors inline + file-level allowlists, and stays silent on
// pure-comment lines that mention the patterns as documentation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { scan, scanMainBlockMissingArgv, REPO_ROOT } from '../../scripts/lint-argv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, '../../scripts/lint-argv.js');

function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'argv-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('argv-lint: live repo is clean (0 hits)', () => {
  const hits = scan({ root: REPO_ROOT });
  assert.deepEqual(hits, [], `unexpected hits: ${JSON.stringify(hits, null, 2)}`);
});

test('argv-lint: detects args.includes(--literal)', () => {
  const root = makeFixture({
    'scripts/bad.js': "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.includes(--literal)');
    assert.equal(hits[0].file, 'scripts/bad.js');
    assert.equal(hits[0].line, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: detects args.find(a => a.startsWith(--))', () => {
  const root = makeFixture({
    'scripts/bad.js': "const flag = args.find(a => a.startsWith('--days='));\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.find(a => a.startsWith(--))');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: detects args.indexOf(--literal)', () => {
  const root = makeFixture({
    'scripts/bad.js': "const i = args.indexOf('--file');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.indexOf(--literal)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: inline `// argv-lint:allow` suppresses the hit', () => {
  const root = makeFixture({
    'scripts/vetted.js': "const json = args.includes('--json'); // argv-lint:allow — validated upstream\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The trailing-comment form is layout-coupled: a formatter that wraps the line
// past printWidth moves the comment onto the NEXT line and re-arms the gate on
// code nobody edited. `prettier --write` did exactly that to
// bin/claudemd-lint.js's `--help`-in-any-position check. The preceding-line form
// is what survives reflow, so it has to keep working — and has to stay narrow
// enough that it cannot suppress a hit it was never meant to.
test('argv-lint: `// argv-lint:allow` on the PRECEDING line suppresses the hit', () => {
  const root = makeFixture({
    'scripts/vetted.js':
      '// argv-lint:allow — validated upstream\n' + "const json = args.includes('--json');\n",
  });
  try {
    assert.deepEqual(scan({ root, dirs: ['scripts'], fileAllowlist: {} }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The preceding line has to BE the suppression. A comment that merely mentions
// the token mid-sentence — the way a docstring explaining the convention does —
// must not silence the code under it. The 0.72.0 pre-tag review showed
// `includes()` did exactly that (MEDIUM-2); this is the control.
test('argv-lint: a preceding comment that only MENTIONS the token does NOT suppress', () => {
  const root = makeFixture({
    'scripts/prose.js':
      '// To silence this gate on a vetted line, append argv-lint:allow to it.\n' +
      "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'prose that mentions the token is not a directive');
    assert.equal(hits[0].line, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: a blank line between the token and the code does NOT suppress', () => {
  const root = makeFixture({
    'scripts/gap.js': '// argv-lint:allow — stale\n\n' + "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'a detached token must not travel down the file');
    assert.equal(hits[0].line, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: the token on a preceding CODE line does NOT suppress', () => {
  const root = makeFixture({
    // The string mentions the token; the line is not a comment. Accepting this
    // would let any file suppress the gate by naming the token in a literal.
    'scripts/sneaky.js': "const doc = 'argv-lint:allow';\n" + "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: file-level allowlist suppresses the file', () => {
  const root = makeFixture({
    'scripts/vetted.js': "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({
      root,
      dirs: ['scripts'],
      fileAllowlist: { 'scripts/vetted.js': 'test fixture: allowlisted' },
    });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: pure-comment line is NOT flagged (meta-recursion guard)', () => {
  const root = makeFixture({
    'scripts/doc.js': "// the bug: args.includes('--json') silently drops --json=yes\nconst safe = 1;\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: end-of-line comment on code IS still scanned', () => {
  const root = makeFixture({
    'scripts/sneaky.js': "const json = args.includes('--json'); // pretending it's documentation\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'code with end-of-line comment must still be flagged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: CLI exit 0 + stdout on clean (live-repo equivalent)', () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, `gate must exit 0 on live repo. stderr:\n${r.stderr}`);
  assert.match(r.stdout, /0 hits/);
});

test('Round-6: scanMainBlockMissingArgv flags main-block w/o parseStrict/printHelpAndExit', () => {
  // Reproduces pre-Round-5 install.js / uninstall.js / update.js shape: a
  // main-block guard that proceeds straight to side-effects without any
  // argv validation. The 3 regex PATTERNS can't catch this — there's no
  // wrong-shape argv read; there's NO argv read at all.
  const root = makeFixture({
    'scripts/destructive.js':
      "import { rmSync } from 'node:fs';\n" +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      "  rmSync('/tmp/x', { recursive: true });\n" +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'main-block-without-argv-validation');
    assert.equal(hits[0].file, 'scripts/destructive.js');
    assert.ok(hits[0].line >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-6: scanMainBlockMissingArgv passes a script that calls parseStrict', () => {
  const root = makeFixture({
    'scripts/safe.js':
      "import { parseStrict } from './lib/argv.js';\n" +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      '  parseStrict(process.argv.slice(2), {});\n' +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-6: scanMainBlockMissingArgv passes a script that calls printHelpAndExit only', () => {
  const root = makeFixture({
    'scripts/help-only.js':
      "import { printHelpAndExit } from './lib/argv.js';\n" +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      "  printHelpAndExit(process.argv.slice(2), 'usage');\n" +
      '  doStuff();\n' +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-6: scanMainBlockMissingArgv ignores files without main-block guard', () => {
  // Pure library modules (no `if (import.meta.url === ...)`) must not flag.
  const root = makeFixture({
    'scripts/pure-lib.js': 'export function thing() { return 42; }\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanMainBlockMissingArgv accepts validateAndExpandFlags IMPORTED from lib/argv.js', () => {
  // bin/claudemd-lint.js uses validateAndExpandFlags (a sibling validator, not
  // parseStrict — the space form and positional paths it accepts are published
  // contract). That counts, but only when it comes from the shared module.
  const root = makeFixture({
    'bin/cli.js':
      "import { validateAndExpandFlags } from '../scripts/lib/argv.js';\n" +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      "  validateAndExpandFlags(process.argv.slice(2), [], [], 'cli');\n" +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['bin'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R10-20: an unrelated import from lib/argv.js does not authenticate a local validator', () => {
  // The residue 条目 14 left behind. The gate asked two questions — "is one of
  // the three names called?" and "does this file import anything at all from
  // lib/argv.js?" — and never joined them. So a file importing only ArgvError
  // (a legitimate thing to import) while calling its OWN parseStrict satisfied
  // both halves, and the comment above the check claimed "the name must arrive
  // by import from there", which was not what the code asked.
  const root = makeFixture({
    'bin/cli.js':
      "import { ArgvError } from '../scripts/lib/argv.js';\n" +
      'function parseStrict() { /* validates nothing */ }\n' +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      '  parseStrict(process.argv.slice(2), {});\n' +
      "  throw new ArgvError('x');\n" +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['bin'], fileAllowlist: {} });
    assert.equal(
      hits.length,
      1,
      'importing some other symbol from lib/argv.js must not authenticate a locally-declared validator'
    );
    assert.equal(hits[0].pattern, 'main-block-without-argv-validation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R10-20: an aliased import of the real validator still counts', () => {
  // The reverse control: the join is on the LOCAL BINDING, so `x as y` must be
  // accepted when `y` is what the main block calls. Without this the fix would
  // trade one false pass for a false failure.
  const root = makeFixture({
    'bin/cli.js':
      "import { parseStrict as parseArgs } from '../scripts/lib/argv.js';\n" +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      '  parseArgs(process.argv.slice(2), {});\n' +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['bin'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a LOCALLY DECLARED validateAndExpandFlags does not satisfy the gate (条目 14)', () => {
  // The gate authenticated by function name, so this file passed while
  // validating whatever its own local function felt like — including nothing.
  // That is not hypothetical: the name was added to the accepted set BECAUSE
  // bin/claudemd-lint.js kept a private copy, which legitimised the duplicate
  // instead of converging it.
  const root = makeFixture({
    'bin/cli.js':
      'function validateAndExpandFlags() { /* validates nothing */ }\n' +
      'if (import.meta.url === `file://${process.argv[1]}`) {\n' +
      "  validateAndExpandFlags(process.argv.slice(2), [], [], 'cli');\n" +
      '}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['bin'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'a same-named local function must not authenticate the argv contract');
    assert.equal(hits[0].pattern, 'main-block-without-argv-validation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- R11-18(a) (2026-09-02 audit): keep this gate REACHABLE ---
// `npm run lint` is an && chain. It ran lint:sh && lint:js && lint:argv &&
// version-check, and lint:js has been red at 30 errors since eslint 10 landed
// — so lint:argv (this file's subject) and version-check never executed under
// `npm run lint` or `npm run check` at all. Both are ship gates. They kept
// working only because these test suites invoke them against the real tree
// directly; the npm entry point that CONTRIBUTING.md points people at did not.
//
// Asserting order rather than "everything runs": && semantics mean a red step
// necessarily masks its successors, so the only fix available without a task
// runner is to put the gates in front of the step that is allowed to be red.

test('R11-18a: the two ship gates run before lint:js in the lint chain', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const chain = pkg.scripts.lint;
  assert.ok(chain, 'package.json must define a lint script');

  // Step names in chain order, derived from the chain itself.
  const steps = chain.split('&&').map(s => s.trim().replace(/^npm run /, ''));
  for (const gate of ['lint:argv', 'version-check']) {
    const gi = steps.indexOf(gate);
    const ji = steps.indexOf('lint:js');
    assert.ok(gi >= 0, `${gate} must stay in the lint chain (steps: ${steps.join(', ')})`);
    assert.ok(ji >= 0, `lint:js must stay in the lint chain (steps: ${steps.join(', ')})`);
    assert.ok(
      gi < ji,
      `${gate} is a ship gate and must precede the burn-down-pending lint:js; got ${steps.join(' && ')}`
    );
  }
});

// R11-33 (2026-09-03 audit): the gate recognised only the href-compare main
// guard. design-detect.js and statusline-adopt.js use a realpath compare — the
// shape that survives a symlinked invocation, and therefore the shape a new CLI
// copies. Both happened to validate argv, so this was an escape route rather
// than a live miss; the fixture below is the miss it would have become.
const REALPATH_GUARD =
  'const invokedAsMain = (() => {\n' +
  '  try {\n' +
  '    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);\n' +
  '  } catch {\n' +
  '    return false;\n' +
  '  }\n' +
  '})();\n';

test('R11-33: a realpath-form main block without argv validation is flagged', () => {
  const root = makeFixture({
    'scripts/realpath-destructive.js':
      "import fs from 'node:fs';\nimport { fileURLToPath } from 'node:url';\n" +
      REALPATH_GUARD +
      'if (invokedAsMain) {\n  fs.rmSync(process.argv[2], { recursive: true });\n}\n',
  });
  try {
    const hits = scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'the realpath shape must be judged, not skipped');
    assert.equal(hits[0].file, 'scripts/realpath-destructive.js');
    assert.equal(hits[0].pattern, 'main-block-without-argv-validation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R11-33: a realpath-form main block that DOES validate argv still passes', () => {
  // Without this the test above would also pass on a gate that flags every
  // realpath-form file unconditionally.
  const root = makeFixture({
    'scripts/realpath-safe.js':
      "import fs from 'node:fs';\nimport { fileURLToPath } from 'node:url';\n" +
      "import { parseStrict } from './lib/argv.js';\n" +
      REALPATH_GUARD +
      'if (invokedAsMain) {\n  parseStrict(process.argv.slice(2), {});\n}\n',
  });
  try {
    assert.deepEqual(scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R11-33: the guard keys on the IIFE, not on the name `invokedAsMain`', () => {
  const root = makeFixture({
    'scripts/renamed.js':
      "import fs from 'node:fs';\nimport { fileURLToPath } from 'node:url';\n" +
      REALPATH_GUARD.replace(/invokedAsMain/g, 'isEntryPoint') +
      'if (isEntryPoint) {\n  fs.rmSync(process.argv[2], { recursive: true });\n}\n',
  });
  try {
    assert.equal(scanMainBlockMissingArgv({ root, dirs: ['scripts'], fileAllowlist: {} }).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
