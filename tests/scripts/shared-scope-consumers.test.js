// shared-scope-consumers.test.js — a file that declares itself the SINGLE
// SOURCE of a check's scope must actually be read by every caller of that check.
//
// 2026-08-29 audit R10-18c. The shellcheck scope existed twice: seven
// hand-written globs in ci.yml and `git ls-files '*.sh'` in tests/run-all.sh,
// the former a proper subset of the latter. Converging them into
// tests/lib/shell-files.sh fixes today's copy; this gate is what stops the next
// one, because the repo's own record says extraction without a consumer gate
// drifts back (feedback_extraction_needs_consumer_gate — the 0.62.x hotfixes,
// the banned-vocab flatten miss, SPEC_FILES).
//
// It also covers tests/lib/bash32-constructs.sh, which has carried the same
// "SINGLE SOURCE for ci.yml AND run-all.sh" claim since v0.62.2 with nothing
// checking it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONSUMERS = ['.github/workflows/ci.yml', 'tests/run-all.sh'];

// Derived, not listed: any tests/lib/*.sh whose header claims to be the single
// source of a scope. A new one inherits this gate by making the claim.
function singleSourceScopeFiles() {
  const dir = path.join(ROOT, 'tests/lib');
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sh'))
    .filter(f => /SINGLE SOURCE/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort();
}

// Comments stripped before matching, and the match is on `lib/<name>` rather
// than the repo-relative path. Both halves were found by this gate's first run:
// run-all.sh calls its sibling as "$HERE/lib/bash32-constructs.sh" (the correct
// way for a script to find one), and the shell-files.sh row passed on a COMMENT
// naming the file rather than on the call — a gate reading prose instead of
// code, which is the failure this repo files under "the gate certified a shape
// production never sees".
const codeOf = text => text.split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');

test('every self-declared SINGLE SOURCE scope file is read by both callers', () => {
  const sources = singleSourceScopeFiles();
  assert.ok(sources.length >= 2,
    `only ${sources.length} SINGLE SOURCE scope file(s) found in tests/lib/ — the ` +
    `extraction broke, and this gate must never validate an empty set.`);

  const consumerCode = Object.fromEntries(
    CONSUMERS.map(c => [c, codeOf(fs.readFileSync(path.join(ROOT, c), 'utf8'))]));

  const unread = [];
  for (const src of sources) {
    const re = new RegExp(`lib/${src.replace(/[.]/g, '\\.')}`);
    for (const c of CONSUMERS) {
      if (!re.test(consumerCode[c])) unread.push(`${src} — not read by ${c}`);
    }
  }
  assert.deepEqual(unread, [],
    'a file claiming to be the SINGLE SOURCE of a check\'s scope is not read by ' +
    'one of its callers:\n      ' + unread.join('\n      ') +
    '\n      Either the caller kept its own copy of the scope (the drift this ' +
    'claim exists to prevent), or the claim is stale and should come out of the header.');
});

test('ci.yml does not hand-write a shellcheck file list', () => {
  // The specific regression: `shellcheck --severity=warning hooks/*.sh …`. The
  // scope has to arrive from the shared script, so the only paths on a
  // shellcheck line are `$FILES`-shaped.
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const handWritten = ci.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^\s*shellcheck\b/.test(l))
    .filter(([, l]) => /\*\.sh|\/[a-z0-9-]+\.sh/.test(l));
  assert.deepEqual(handWritten.map(([n, l]) => `${n}: ${l.trim()}`), [],
    'ci.yml names shell files on a shellcheck line again — that list was a ' +
    'proper subset of run-all.sh\'s and is why tests/lib/shell-files.sh exists.');
});
