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
  // The specific regression: `shellcheck --severity=warning hooks/*.sh …`.
  //
  // Backslash continuations are joined into one LOGICAL line first. The first
  // version split on '\n' and only examined lines that BEGIN with `shellcheck`,
  // so pushing the globs onto the continuation —
  //     shellcheck --severity=warning \
  //       hooks/*.sh hooks/lib/*.sh scripts/*.sh
  // — walked straight past it, green, on a ci.yml that had re-grown a scope
  // narrower than run-all.sh's. Not a hypothetical spelling: the block this
  // gate exists to prevent spanned continuation lines itself (pre-tag review of
  // v0.71.0). The sibling test does not cover it either — it only asks that
  // `lib/shell-files.sh` appear SOMEWHERE in the file, which the mutant still
  // satisfies.
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const logical = [];
  let buf = null;
  ci.split('\n').forEach((raw, i) => {
    const cont = /\\\s*$/.test(raw);
    const body = raw.replace(/\\\s*$/, '');
    if (buf === null) buf = { line: i + 1, text: body };
    else buf.text += ` ${body.trim()}`;
    if (!cont) { logical.push(buf); buf = null; }
  });
  if (buf !== null) logical.push(buf);

  const offenders = logical
    // Comments are not commands. Widening the trigger to match mid-line made
    // a legitimate `# shellcheck source=…` directive read as an invocation —
    // fail-closed, so an annoyance rather than a hole, but it is this release's
    // fourth instance of a gate reading a comment as code (delta re-review).
    .filter(({ text }) => !/^\s*#/.test(text))
    // A boundary, not a character allowlist: `(^|\s|;|&&)` missed `(shellcheck`,
    // `"shellcheck` and `|shellcheck`. Anything that is not part of an
    // identifier or path counts as the start of the word.
    .filter(({ text }) => /(?<![\w.\/-])shellcheck\s/.test(text))
    // Everything after the tool name and its flags must be `$FILES`. Any bare
    // filename counts, with or without a slash — `shellcheck run-all.sh` was
    // invisible to the first version's `\/[a-z0-9-]+\.sh` alternative.
    // `(?![\w-])` rather than `(\s|$)`: requiring whitespace-or-end after `.sh`
    // let `(shellcheck … hooks/*.sh)` through, because the filename is followed
    // by the closing paren. The lookbehind above admitted that subshell form
    // correctly and this half then dropped it — a fix whose two halves did not
    // agree, caught by running the control rather than by reading it.
    .filter(({ text }) => /[\w*.\/-]+\.sh(?![\w-])/.test(text.replace(/\$\{?FILES\}?/g, '')));
  assert.deepEqual(offenders.map(({ line, text }) => `${line}: ${text.trim()}`), [],
    'ci.yml names shell files on a shellcheck command again — that list was a ' +
    'proper subset of run-all.sh\'s and is why tests/lib/shell-files.sh exists. ' +
    'Pass the scope as $FILES from that script.');
});
