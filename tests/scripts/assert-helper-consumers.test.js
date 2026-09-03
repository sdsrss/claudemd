// assert-helper-consumers.test.js — R11-27 (2026-09-02 audit).
//
// Bash suites each wrote their own pass/fail bookkeeping, and it disagreed:
// `contract.test.sh`'s ok() increments a PASS counter, `hook-budget.test.sh`'s
// pass() increments nothing and only failures are counted. Every one of them
// prints a "Tests: N/M passed" or "All cases passed" line, so the run-wide
// tally sums numbers that do not mean the same thing.
//
// tests/lib/assert.sh is the single vocabulary. The migration is deliberately
// partial — rewriting working suites all at once buys drift risk, not coverage —
// so this gate does the one thing that keeps a partial migration from becoming
// a permanent one: it holds the un-migrated set as an explicit, SHRINKING list.
//
// CLASSIFIED BY MECHANISM, NOT BY NAME. The first version of this gate matched
// `^(ok|ng|pass|fail|assert_*)\(\)` and reported 13 suites. The pre-tag review
// measured the real class: 26 of 28 suites keep their own PASS/FAIL counter,
// under names like `run_case`, `check_budget`, `drive`, `run_hook`,
// `control_shape` — so a new suite calling its helper `check()` sailed through
// while reproducing exactly the drift the gate exists to stop. Naming the
// helpers was classifying by content along the wrong axis
// (memory: classify_by_mechanism_not_content). The rule below needs no
// predicate at all: a suite either sources the shared vocabulary or it is on
// the list, and nothing else is admissible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK_SUITES = path.join(REPO_ROOT, 'tests/hooks');
const SHARED = 'tests/lib/assert.sh';

const sourcesShared = text => text.includes('lib/assert.sh');

// Every bash suite that has NOT yet moved to tests/lib/assert.sh, measured
// 2026-09-03. This list may only get shorter — see the two shrink assertions
// below. It is the migration backlog, not an allowlist for new work.
const LEGACY_OWN_ASSERTIONS = [
  'banned-vocab.test.sh',
  'bash-readonly-skip.test.sh',
  'contract.test.sh',
  'env-hygiene.test.sh',
  'fail-open.test.sh',
  'hook-budget.test.sh',
  'hook-common.test.sh',
  'mem-audit.test.sh',
  'memory-prompt-hint.test.sh',
  'memory-read-check.test.sh',
  'memory-tags-parity.test.sh',
  'platform.test.sh',
  'pre-bash-safety.test.sh',
  'preToolUse-fastpath-order.test.sh',
  'preToolUse-jq-spawn-budget.test.sh',
  'residue-audit.test.sh',
  'rule-hits.test.sh',
  'sandbox-disposal.test.sh',
  'session-end-check.test.sh',
  'session-extended-read.test.sh',
  'session-start.test.sh',
  'session-summary.test.sh',
  'ship-baseline.test.sh',
  'timeout-guard.test.sh',
  'transcript-structure-scan.test.sh',
  'transcript-vocab-scan.test.sh',
  'version-sync.test.sh',
];

function suites() {
  return fs
    .readdirSync(HOOK_SUITES)
    .filter(f => f.endsWith('.test.sh'))
    .map(f => ({ name: f, text: fs.readFileSync(path.join(HOOK_SUITES, f), 'utf8') }));
}

test('R11-27: the gate states how many suites it judged', () => {
  const all = suites();
  const migrated = all.filter(s => sourcesShared(s.text)).map(s => s.name);
  console.log(
    `  assert-helper gate: judged ${all.length} bash suite(s); ` +
      `${migrated.length} on ${SHARED}, ${LEGACY_OWN_ASSERTIONS.length} still on their own`
  );
  // A floor on the SCANNED set, not on the subset that happens to match — a
  // readdir that silently returns two files must fail, not pass clean.
  assert.ok(all.length >= 25, `expected ≥25 hook suites, found ${all.length}`);
  assert.ok(migrated.length >= 1, 'the shared vocabulary must have at least one real consumer');
});

test('R11-27: every bash suite either sources the shared vocabulary or is on the legacy list', () => {
  const offenders = suites()
    .filter(s => !sourcesShared(s.text) && !LEGACY_OWN_ASSERTIONS.includes(s.name))
    .map(s => s.name);
  assert.deepEqual(
    offenders,
    [],
    `these suites keep their own assertion bookkeeping instead of sourcing ${SHARED}:\n  ${offenders.join('\n  ')}`
  );
});

test('R11-27: the legacy list only shrinks — no stale or migrated entry may linger', () => {
  const byName = new Map(suites().map(s => [s.name, s]));
  const gone = LEGACY_OWN_ASSERTIONS.filter(n => !byName.has(n));
  assert.deepEqual(gone, [], 'legacy entries name suites that no longer exist — delete them from the list');

  // An entry that has already migrated must leave the list, or it stays a
  // standing permission for the next edit to walk back off the shared helper.
  const migrated = LEGACY_OWN_ASSERTIONS.filter(n => sourcesShared(byName.get(n).text));
  assert.deepEqual(
    migrated,
    [],
    `these suites already source ${SHARED} — remove them from LEGACY_OWN_ASSERTIONS:\n  ${migrated.join('\n  ')}`
  );
});

test('R11-27: the shared vocabulary exists and every helper counts', () => {
  // The drift being fixed was a pass() that incremented nothing, so "does it
  // count?" is the property worth pinning, not "does the file exist?".
  const text = fs.readFileSync(path.join(REPO_ROOT, SHARED), 'utf8');
  for (const fn of ['ok', 'ng', 'assert_eq', 'assert_contains', 'assert_not_contains', 'assert_status']) {
    assert.match(text, new RegExp(`^${fn}\\(\\)`, 'm'), `${SHARED} must define ${fn}`);
  }
  assert.match(
    text,
    /^ok\(\)[\s\S]*?CLAUDEMD_ASSERT_PASS=\$\(\(CLAUDEMD_ASSERT_PASS \+ 1\)\)/m,
    'ok() must count'
  );
  assert.match(
    text,
    /^ng\(\)[\s\S]*?CLAUDEMD_ASSERT_FAIL=\$\(\(CLAUDEMD_ASSERT_FAIL \+ 1\)\)/m,
    'ng() must count'
  );
  // Zero assertions must be a failure, not a silent pass.
  assert.match(text, /total == 0[\s\S]{0,200}return 1/, 'claudemd_assert_summary must fail on an empty run');
});

test('R11-27: a new suite under any helper name is caught (control)', () => {
  // The name-based predecessor passed this exact shape. Run against a synthetic
  // directory listing rather than by writing into tests/hooks/, so the control
  // leaves no file behind.
  const synthetic = [
    { name: 'zz-new.test.sh', text: 'check() { echo "PASS: $1"; }\ncheck "a thing"\n' },
    { name: 'zz-migrated.test.sh', text: 'source "$HERE/../lib/assert.sh"\nok "a thing"\n' },
  ];
  const flagged = synthetic
    .filter(s => !sourcesShared(s.text) && !LEGACY_OWN_ASSERTIONS.includes(s.name))
    .map(s => s.name);
  assert.deepEqual(
    flagged,
    ['zz-new.test.sh'],
    'a privately-named helper must be caught, a migrated suite must not'
  );
});
