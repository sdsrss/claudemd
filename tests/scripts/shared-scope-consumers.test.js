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

// Backslash continuations joined into one logical line, keeping the first line's
// number for the failure message. Shared by the two ci.yml tests below: the
// mutant that walked past the first version of the hand-written-list test lived
// on a continuation line, so anything reading commands out of this file has to
// see them the way the shell does.
function logicalLines(text) {
  const out = [];
  let buf = null;
  text.split('\n').forEach((raw, i) => {
    const cont = /\\\s*$/.test(raw);
    const body = raw.replace(/\\\s*$/, '');
    if (buf === null) buf = { line: i + 1, text: body };
    else buf.text += ` ${body.trim()}`;
    if (!cont) { out.push(buf); buf = null; }
  });
  if (buf !== null) out.push(buf);
  return out;
}

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
  const offenders = logicalLines(ci)
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

// The hole the two tests above share, reproduced in a tree copy during the
// v0.71.0 delta re-review and green on both of them:
//
//     FILES=$(bash tests/lib/shell-files.sh | grep '^hooks/')
//     shellcheck --severity=warning $FILES
//
// The single source is still read and no filename is written anywhere, yet the
// CI step is once again narrower than the run-all gate it front-runs — which is
// the entire defect R10-18c existed to close. A hand-written list is one way to
// narrow the scope; a filter on the shared list is another, and reading the
// command text only ever knew about the first.
//
// This still checks spelling — the honest fix is to compare the resulting SETS,
// which means running the workflow's shell — but it checks the spelling of the
// ASSIGNMENT rather than of the command, which is where the narrowing has to
// happen. Three shapes fail here that passed before: a filter inside the
// substitution, a second assignment to the same name, and a shellcheck fed from
// a variable that never came from the shared script at all.
test('ci.yml hands shellcheck a variable that is the unfiltered shared scope', () => {
  const sources = singleSourceScopeFiles();
  assert.ok(sources.length >= 2, 'the SINGLE SOURCE set collapsed — see the first test');
  const lines = logicalLines(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'))
    .filter(({ text }) => !/^\s*#/.test(text));

  // `NAME=$( … )`, body captured without nesting: a nested `$(` inside is itself
  // a reason to fail, since it cannot be the plain call this requires.
  const assignments = [];
  for (const { line, text } of lines) {
    for (const m of text.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=\$\(([^)]*)\)/g)) {
      assignments.push({ line, name: m[1], body: m[2].trim() });
    }
  }

  // Flags are allowed (bash32-constructs.sh is called with --list); anything
  // that could change the resulting set is not.
  const shape = new RegExp(`^bash tests/lib/(${sources.map((s) => s.replace(/\./g, '\\.')).join('|')})((?: --[a-z-]+)*)$`);
  const fromShared = assignments.filter(({ body }) => sources.some((s) => body.includes(`lib/${s}`)));

  const filtered = fromShared.filter(({ body }) => !shape.test(body));
  assert.deepEqual(filtered.map(({ line, name, body }) => `${line}: ${name}=$(${body})`), [],
    'a ci.yml variable is assigned from a SINGLE SOURCE scope script with something ' +
    'appended — a pipe, a filter, a second command:\n      ' +
    filtered.map(({ line, name, body }) => `${line}: ${name}=$(${body})`).join('\n      ') +
    '\n      That narrows the scope while leaving every "is the shared script read?" check ' +
    'green, which is how the hand-written list came back. Assign the call alone.');

  const shared = new Set(fromShared.map(({ name }) => name));
  assert.ok(shared.size >= 1,
    'no ci.yml variable is assigned from a SINGLE SOURCE scope script at all — the step ' +
    'stopped reading the shared scope, or this gate stopped finding the assignment.');

  // Assigned once. A second assignment can filter what the first produced, and
  // each one on its own satisfies the shape above.
  const rebound = [...shared].filter((n) => assignments.filter((a) => a.name === n).length > 1);
  assert.deepEqual(rebound, [],
    `ci.yml assigns ${rebound.join(', ')} more than once — the later assignment can narrow ` +
    'what the shared script returned, and each assignment passes the shape check alone.');

  // And the variable shellcheck actually receives is one of those.
  const wrongVar = [];
  for (const { line, text } of lines) {
    if (!/(?<![\w./-])shellcheck\s/.test(text)) continue;
    for (const m of text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
      if (!shared.has(m[1])) wrongVar.push(`${line}: shellcheck … $${m[1]}`);
    }
  }
  assert.deepEqual(wrongVar, [],
    'a shellcheck command in ci.yml expands a variable that was not assigned from a ' +
    'SINGLE SOURCE scope script:\n      ' + wrongVar.join('\n      ') +
    '\n      Deriving the list into a second variable is the same narrowing by another name.');
});
