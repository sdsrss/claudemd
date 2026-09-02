// purge-default-drift.test.js — R11-03 (2026-09-02 audit).
//
// Three user-facing sources described the SAME destructive default and one of
// them said the opposite:
//   - scripts/uninstall.js       `process.env.CLAUDEMD_PURGE === '1'`  → opt-in
//   - README.md                  "add CLAUDEMD_PURGE=1 to ALSO drop ..." → opt-in
//   - commands/claudemd-uninstall.md  "Default ...: CLAUDEMD_PURGE=1 node ..."
//
// An agent executes the slash-command stub, a user reads the README. Following
// the stub deleted ~/.claude/logs/claudemd.jsonl — the §13.1 demote-review
// corpus, not recoverable — on what both other sources call the default path.
//
// The join asserted here is stub-default ↔ script-default. It is deliberately
// NOT a keyword count: the stub's FIRST usage bullet is the line an agent
// copies, so that line is what must match how uninstall.js reads the env var.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const STUB = 'commands/claudemd-uninstall.md';
const SCRIPT = 'scripts/uninstall.js';
const README = 'README.md';

// The env var name comes from the script, not from a literal here, so a rename
// fails this suite loudly instead of silently matching nothing.
function purgeEnvVar() {
  const m = read(SCRIPT).match(/process\.env\.(CLAUDEMD_\w*PURGE\w*)\s*===\s*'1'/);
  assert.ok(m, `${SCRIPT} must gate purge on an env var === '1'`);
  return m[1];
}

// Every fenced/inline command in the stub that invokes uninstall.js, in order.
function stubInvocations() {
  const lines = read(STUB)
    .split('\n')
    .filter(l => /uninstall\.js/.test(l) && /`/.test(l))
    .map(l => (l.match(/`([^`]*uninstall\.js[^`]*)`/) || [])[1])
    .filter(Boolean);
  assert.ok(lines.length >= 2, 'stub must document at least a default and a purge invocation');
  return lines;
}

test('R11-03.1: the script gates purge behind an opt-in env var', () => {
  const v = purgeEnvVar();
  assert.equal(v, 'CLAUDEMD_PURGE');
});

test("R11-03.2: the stub's FIRST documented invocation does not set the purge var", () => {
  const v = purgeEnvVar();
  const first = stubInvocations()[0];
  assert.ok(
    !first.includes(`${v}=1`),
    `the stub's default invocation must not opt into purge, got: ${first}`
  );
});

test('R11-03.3: the stub still documents the purge invocation somewhere', () => {
  const v = purgeEnvVar();
  assert.ok(
    stubInvocations().some(c => c.includes(`${v}=1`)),
    `${STUB} must keep an explicit ${v}=1 example`
  );
});

// "This is something you ADD", in the three phrasings README actually uses.
// Kept as a predicate rather than a line-by-line snapshot so rewording README
// does not fail the suite, only reframing purge as automatic does.
const OPT_IN_FRAMING = /\b(also|add|with)\b/i;

test('R11-03.4: README describes purge as an addition, not the default', () => {
  const v = purgeEnvVar();
  const mentions = read(README)
    .split('\n')
    .filter(l => l.includes(v));
  assert.ok(mentions.length > 0, `README must document ${v}`);
  for (const line of mentions) {
    assert.ok(
      OPT_IN_FRAMING.test(line),
      `README line describes ${v} without opt-in framing (reads as a default): ${line.trim()}`
    );
  }
});

// The predicate above is loose enough to be worth proving it can still fail:
// this is the exact line the stub carried before this fix.
test('R11-03.6: the opt-in predicate rejects the pre-fix default-framing line', () => {
  const preFix =
    '- Default (keep spec, drop state + log):\n  `CLAUDEMD_PURGE=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`';
  const offending = preFix.split('\n').filter(l => l.includes('CLAUDEMD_PURGE'));
  assert.equal(offending.length, 1);
  assert.equal(
    OPT_IN_FRAMING.test(offending[0]),
    false,
    'predicate must reject a bare CLAUDEMD_PURGE=1 invocation line'
  );
});

test('R11-03.5: the stub frontmatter description does not promise unconditional log deletion', () => {
  const fm = read(STUB).split('---')[1] || '';
  const claimsUnconditional = /clear the plugin manifest, state dir, and rule-hits log/.test(fm);
  assert.equal(
    claimsUnconditional,
    false,
    'frontmatter must not list the purge-only targets as unconditional cleanup'
  );
});
