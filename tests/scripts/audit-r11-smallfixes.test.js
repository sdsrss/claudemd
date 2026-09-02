// audit-r11-smallfixes.test.js — regressions for five defects the 2026-09-02
// audit found and the suite could not see. Every one of them passed `npm test`
// before the fix, which is the point: each was a silent wrong answer, not a
// crash. R11-13b, R11-13c, R11-13d, R11-22, R11-23, R11-29, R11-30.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArgvLintHits } from '../../scripts/baseline-metrics.js';
import { isAdvisoryCheck } from '../../scripts/doctor.js';
import {
  IMMUTABLE_SECTION_RE,
  isImmutableSection,
  isSignalEvent,
  isBlockingDeny,
} from '../../scripts/lib/rule-hits-parse.js';
import { claudeHome, homeSpec, backupRoot } from '../../scripts/lib/paths.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
// Comment lines are not code. Both files below now DESCRIBE the defect being
// asserted against, and a gate that reads prose as code is the failure this repo
// keeps closing (feedback_gate_reads_prose_not_code).
const codeOf = rel =>
  read(rel)
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

// --- R11-29 -------------------------------------------------------------------
// `lintArgv.hits` matched /^\S+:\d+:/ against STDOUT. lint-argv.js writes to
// stderr, in the shape `  file:line  [pattern]` — two spaces, no second colon.
// So the field was null in every run where the gate had something to report.

test('R11-29: argv-lint hits come from stderr and from the count line', () => {
  const realStderr =
    'argv-lint: 3 antipattern hit(s):\n\n' +
    "  scripts/a.js:12  [args.includes(--literal)]\n    const j = args.includes('--json');\n" +
    '    why: Silent-drop on --key=value form.\n\n';
  assert.equal(parseArgvLintHits({ status: 1, stderr: realStderr }), 3);
  assert.equal(parseArgvLintHits({ status: 0, stderr: '' }), 0, 'a clean gate is 0 hits, not null');
  // The pre-fix shape: this is what the field used to be handed, and why it
  // could only ever produce null.
  assert.equal(parseArgvLintHits({ status: 1, stdout: realStderr, stderr: '' }), null);
  assert.equal(parseArgvLintHits({ status: 1, stderr: 'segfault' }), null, 'unparseable is null, not 0');
});

test('R11-29: the parse matches what the real gate actually prints', () => {
  // Drives lint-argv against a fixture with a known number of antipatterns, so
  // the assertion rides on the tool's real output rather than on a string typed
  // here (feedback_test_fixture_format_drift).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-argvhits-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'bad.js'),
      "const a = args.includes('--json');\nconst b = args.indexOf('--file');\n"
    );
    const gate = path.join(REPO_ROOT, 'scripts', 'lint-argv.js');
    const r = spawnSync(
      process.execPath,
      [
        '-e',
        `
      import('${gate.replace(/\\/g, '\\\\')}').then(async m => {
        const hits = m.scan({ root: ${JSON.stringify(root)}, dirs: ['scripts'], fileAllowlist: {} });
        process.stderr.write('argv-lint: ' + hits.length + ' antipattern hit(s):\\n');
        process.exit(hits.length ? 1 : 0);
      });
    `,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(r.status, 1);
    assert.equal(parseArgvLintHits(r), 2, `stderr was: ${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- R11-23 -------------------------------------------------------------------
// `gh` is only needed by ship-baseline-check. Counting its absence made doctor
// exit 3 forever on any machine that does not use GitHub — the steady-state
// non-zero shape the ADVISORY list exists to prevent.

test('R11-23: a missing `gh` is advisory, so a non-GitHub machine is not permanently red', () => {
  assert.equal(isAdvisoryCheck('gh'), true);
  // Anchored: `gh` must not drag in every check whose name starts with those
  // letters. There are none today, which is exactly when an unanchored pattern
  // gets written and nobody notices.
  assert.equal(isAdvisoryCheck('ghost-check'), false);
  // The checks that must STAY counted — a missing jq or an unparseable
  // settings.json is a real broken install, not an operator judgement call.
  for (const name of ['jq', 'settings.json', 'manifest', 'hooks']) {
    assert.equal(isAdvisoryCheck(name), false, `${name} must keep counting toward exit 3`);
  }
});

// --- R11-13c ------------------------------------------------------------------
// doctor.js and hard-rules-audit.js held byte-identical copies of the §8
// immutable-section regex, and the second one's comment said "same anchoring as"
// the first — a claim, not a join.

test('R11-13c: one §8 immutable-section predicate, imported by both consumers', () => {
  for (const id of ['§8', '§8.V1', '§8.V4', '§8-npx', '§8-rm-rf-var', '§8.']) {
    assert.equal(isImmutableSection(id), true, id);
  }
  for (const id of ['§80', '§8x', '§7-user-global-state', '§iron-law-2', '', null, undefined]) {
    assert.equal(isImmutableSection(id), false, String(id));
  }
  assert.equal(IMMUTABLE_SECTION_RE.source, '^§8([.-]|$)');

  const consumers = ['scripts/doctor.js', 'scripts/hard-rules-audit.js'];
  for (const rel of consumers) {
    const src = read(rel);
    assert.match(
      src,
      /(IMMUTABLE_SECTION_RE|isImmutableSection)[\s\S]*?from '\.\/lib\/rule-hits-parse\.js'/,
      `${rel} must import the predicate rather than restate it`
    );
    assert.doesNotMatch(codeOf(rel), /\/\^§8\(/, `${rel} has grown its own copy of the §8 pattern again`);
  }
});

// --- R11-30 -------------------------------------------------------------------
// Two path accessors used against their documented intent. Both resolve to the
// same directory TODAY, which is why nothing caught it — the defect is that a
// later move made for one reason would silently take the other with it.

test('R11-30: path accessors are used for what they document', () => {
  assert.equal(claudeHome('x'), path.join(homeSpec('x')), 'claudeHome and homeSpec agree today');
  assert.equal(claudeHome(), backupRoot(), 'and so does backupRoot — that is the trap');

  assert.doesNotMatch(
    codeOf('scripts/status.js'),
    /backupRoot\(\)\s*,\s*'CLAUDE\.md'/,
    "status.js reads the spec through the BACKUP root again — homeSpec exists so a backup-root move cannot break the spec read path (paths.js's own words)"
  );
  assert.match(codeOf('scripts/status.js'), /homeSpec\('CLAUDE\.md'\)/);

  assert.doesNotMatch(
    codeOf('scripts/lib/statusline.js'),
    /homeSpec\('claudemd-statusline\.sh'\)/,
    'the statusline renderer is not a spec file; homeSpec carries a spec-relocation contract it must not inherit'
  );
  assert.match(codeOf('scripts/lib/statusline.js'), /claudeHome\('claudemd-statusline\.sh'\)/);
});

// --- R11-22 -------------------------------------------------------------------
// An unknown CLAUDEMD_SPEC_ACTION fell through to `keep`, exited 0, and reported
// `specAction: "keep"` — the caller asked for one disposition of their spec
// files and got the opposite, silently.

test('R11-22: an unknown CLAUDEMD_SPEC_ACTION is refused, not silently downgraded to keep', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'uninstall.js');
  const run = value =>
    spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, CLAUDEMD_SPEC_ACTION: value, CLAUDEMD_CONFIRM: '' },
    });

  for (const bad of ['Delete', 'restore ', ' keep', 'DELETE', 'purge', '']) {
    const r = run(bad);
    assert.equal(r.status, 1, `${JSON.stringify(bad)} should exit 1, got ${r.status}: ${r.stdout}`);
    assert.match(r.stderr, /CLAUDEMD_SPEC_ACTION must be one of/);
    assert.doesNotMatch(
      r.stdout,
      /"specAction"/,
      'a rejected value must not reach the point where a disposition is reported'
    );
  }
});

// --- R11-13b ------------------------------------------------------------------
// sparkline.js enumerated the trend's event set as a literal six-name Set, while
// the deny half of that set is a PREFIX RULE in rule-hits-parse.js. One side a
// rule, the other a list, no join: a new `deny-*` event would be counted as a
// real block by isBlockingDeny and silently dropped from the release-header
// trend.

test('R11-13b: the trend event set derives its deny half from isBlockingDeny', () => {
  for (const e of ['deny', 'deny-repeat', 'deny-prose', 'warn', 'advisory', 'bypass-escape-hatch']) {
    assert.equal(isSignalEvent(e), true, e);
  }
  // The one deny-family event that must stay OUT: it exits 0, so it is an
  // observation rather than a block.
  assert.equal(isSignalEvent('deny-prose-dry-run'), false);
  assert.equal(isBlockingDeny('deny-prose-dry-run'), false);
  // The whole point: an event nobody has written down yet.
  assert.equal(
    isSignalEvent('deny-future-shape'),
    true,
    'a new deny-* event must reach the trend without anyone editing a second list'
  );
  assert.equal(isBlockingDeny('deny-future-shape'), true);
  // And non-signal events stay out.
  for (const e of ['fail-open', 'suggest', 'rm-rf-allow-provenance', '', null]) {
    assert.equal(isSignalEvent(e), false, String(e));
  }
});

test('R11-13b: sparkline holds no private copy of the event set', () => {
  const src = codeOf('scripts/sparkline.js');
  assert.match(src, /isSignalEvent/, 'sparkline must use the shared predicate');
  assert.doesNotMatch(
    src,
    /'bypass-escape-hatch'/,
    'sparkline has re-enumerated the signal events — that literal belongs in lib/rule-hits-parse.js only'
  );
});

// --- R11-13d ------------------------------------------------------------------
// paths.js#projectsRoot exists, and its own comment recorded that the
// `.claude/projects` literal was "still rebuilt in five call sites". Four more
// were still doing it.

test('R11-13d: nothing rebuilds the ~/.claude/projects root by hand', () => {
  const files = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', 'scripts/*.js', 'bin/*.js'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length >= 20, `only ${files.length} file(s) resolved — this gate would pass over nothing`);

  const offenders = files
    .filter(f => f !== 'scripts/lib/paths.js') // the definition
    .filter(f => /'\.claude',\s*'projects'/.test(codeOf(f)));
  assert.deepEqual(
    offenders,
    [],
    `these files join the projects root by hand instead of calling paths.js#projectsRoot / #projectDir: ${offenders.join(', ')}`
  );
});
