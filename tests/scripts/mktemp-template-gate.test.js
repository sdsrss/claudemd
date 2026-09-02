// mktemp-template-gate.test.js — the in-tree control for tests/lib/mktemp-template.sh.
//
// The gate shipped in 0.72.0 with its controls run by hand and recorded in a
// commit message, which is the exact omission the same release fixed for
// subject-set-drift (MEDIUM-4 of the pre-tag review). The review also found
// two ways to pass it that should not have passed: a trailing comment
// carrying `XXXXXX` vouched for the bare call before it (MEDIUM-3), and
// `$( mktemp` with a space was not a call at all (LOW-1). Each fixture below
// is a git checkout of a few .sh files, judged through the MKTEMP_GATE_ROOT
// seam with the floor lowered to 1, so a mutation of the gate's matcher or
// its judgement predicate goes red here rather than in the next review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = path.join(REPO_ROOT, 'tests/lib/mktemp-template.sh');

const TEMPLATED = 'D=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || exit 1\n';

// A checkout: `git ls-files` is the gate's scope, so files must be staged.
function checkout(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-mktemp-gate-'));
  const git = args => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  git(['init', '-q']);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  git(['add', '-A']);
  return root;
}

function judge(root, extraEnv = {}) {
  const r = spawnSync('bash', [GATE], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MKTEMP_GATE_ROOT: root, MKTEMP_CALL_FLOOR: '1', ...extraEnv },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

function withCheckout(files, fn) {
  const root = checkout(files);
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('gate: a templated call passes and the cardinality is printed', () => {
  withCheckout({ 'a.sh': TEMPLATED + TEMPLATED }, root => {
    const r = judge(root);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /-- 2 mktemp call site\(s\)/, 'the gate reports how many objects it judged');
  });
});

test('control: a bare `mktemp -d` goes RED with the offending site named', () => {
  withCheckout({ 'a.sh': TEMPLATED, 'b.sh': 'D=$(mktemp -d)\n' }, root => {
    const r = judge(root);
    assert.equal(r.status, 1);
    assert.match(r.out, /FAIL: mktemp without a template/);
    assert.match(r.out, /b\.sh:1:/);
  });
});

test('control: a bare `mktemp` FILE call goes RED too', () => {
  withCheckout({ 'a.sh': 'F=$(mktemp)\n' }, root => {
    assert.equal(judge(root).status, 1);
  });
});

// MEDIUM-3: the old predicate was a whole-line `grep -v XXXX` after stripping
// only full-line comments, so anything carrying XXXX anywhere on the line —
// a trailing comment, a second call — vouched for a bare call next to it.
test('control (MEDIUM-3): a trailing comment carrying XXXXXX does not vouch for a bare call', () => {
  withCheckout({ 'a.sh': 'D=$(mktemp -d) # like claudemd-test-XXXXXX but not\n' }, root => {
    const r = judge(root);
    assert.equal(r.status, 1, `a comment is not a template: ${r.out}`);
  });
});

test('control (MEDIUM-3): a templated call on the same line does not vouch for a bare one', () => {
  withCheckout({ 'a.sh': 'A=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); B=$(mktemp -d)\n' }, root =>
    assert.equal(judge(root).status, 1)
  );
});

// LOW-1: `$( mktemp` is the same call with a space the matcher did not allow.
test('control (LOW-1): `$( mktemp -d` with a space is a call and goes RED when bare', () => {
  withCheckout({ 'a.sh': 'D=$( mktemp -d )\n' }, root => assert.equal(judge(root).status, 1));
  withCheckout({ 'a.sh': 'D=$( mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX" )\n' }, root =>
    assert.equal(judge(root).status, 0)
  );
});

test('gate: full-line comments and escaped `\\$(mktemp` test data are not calls', () => {
  withCheckout(
    {
      'a.sh':
        TEMPLATED +
        '# a header that quotes D=$(mktemp -d) as the shape to avoid\n' +
        'CMD=\'X=\\$(mktemp -d); rm -rf "$X"\'\n',
    },
    root => {
      const r = judge(root);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /-- 1 mktemp call site\(s\)/, 'only the real call is counted');
    }
  );
});

// feedback_gate_must_report_its_cardinality: judging nothing must not read as clean.
test('control: below the floor the gate is RED even with zero offenders', () => {
  withCheckout({ 'a.sh': 'echo no sandboxes here\n' }, root => {
    const r = judge(root);
    assert.equal(r.status, 1);
    assert.match(r.out, /only 0 mktemp call site\(s\) resolved/);
  });
});

test('gate: the real repo is judged at or above its floor', () => {
  const r = spawnSync('bash', [GATE], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = r.stdout.match(/-- (\d+) mktemp call site\(s\)/);
  assert.ok(m, 'cardinality line present');
  assert.ok(Number(m[1]) >= 80, `real-repo count ${m[1]} is above the floor the file declares`);
});
