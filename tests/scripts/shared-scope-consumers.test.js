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
// happen.
//
// The first version of this test was itself escaped three ways by the v0.71.2
// pre-tag review, and each escape is now a case below:
//   - `FILES="$( … )"` — the reassignment scanner required `=$(` with no quote,
//     so two quote characters made a second assignment invisible. The gate
//     caught the spelling the reviewer wrote and missed the one shellcheck's own
//     SC2086 guidance pushes a maintainer toward. Names are now counted with a
//     bare `NAME=`, whatever the right-hand side looks like.
//   - `shellcheck … $(printf %s\n "$FILES" | grep …)` — narrowing at the point
//     of use, with no assignment at all for the assignment rules to engage on.
//     A command substitution on a shellcheck command is now itself the failure.
//   - `shellcheck $LIST` — `LIST` comes from the OTHER single-source script
//     (bash32-constructs.sh, 58 files to shell-files.sh's 62) and is assigned in
//     a different job, so at runtime it is empty and shellcheck reads its closed
//     stdin and exits 0. "Assigned from some single source" was never the
//     property wanted; the scope of THIS check has one name, below.
const SHELLCHECK_SCOPE = 'shell-files.sh';

test('ci.yml hands shellcheck a variable that is the unfiltered shared scope', () => {
  const sources = singleSourceScopeFiles();
  assert.ok(sources.includes(SHELLCHECK_SCOPE),
    `tests/lib/${SHELLCHECK_SCOPE} no longer declares itself the SINGLE SOURCE of a scope — ` +
    'it was renamed or the header changed, and this check is now guarding nothing.');
  const lines = logicalLines(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'))
    .filter(({ text }) => !/^\s*#/.test(text));

  // `NAME=$(bash tests/lib/shell-files.sh …`, optionally quoted. Everything to
  // the end of the logical line is the body, minus the closing paren and quote:
  // reading to a `)` instead would stop inside a nested substitution and call
  // the rest of the pipeline someone else's problem.
  const scopeAssigns = [];
  for (const { line, text } of lines) {
    const m = text.match(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(["']?)\$\((.*)$/);
    if (!m) continue;
    let body = m[3].trim();
    if (m[2] && body.endsWith(m[2])) body = body.slice(0, -1).trim();
    if (body.endsWith(')')) body = body.slice(0, -1).trim();
    if (!body.startsWith(`bash tests/lib/${SHELLCHECK_SCOPE}`)) continue;
    scopeAssigns.push({ line, name: m[1], body });
  }

  assert.ok(scopeAssigns.length >= 1,
    `no ci.yml variable is assigned from tests/lib/${SHELLCHECK_SCOPE} in a shape this check ` +
    'can read — either the step stopped reading the shared scope, or the assignment was ' +
    'written some way this gate does not recognise, and both must fail closed.');

  // Flags are allowed, with or without values: bash32-constructs.sh is called
  // with `--list`, and shell_files_checked_scope() documents a root argument.
  // What is not allowed is anything that can change the resulting set.
  const shape = new RegExp(`^bash tests/lib/${SHELLCHECK_SCOPE.replace(/\./g, '\\.')}(\\s+--[a-z][a-z-]*(=\\S+)?)*$`);
  const filtered = scopeAssigns.filter(({ body }) => !shape.test(body));
  assert.deepEqual(filtered.map(({ line, name, body }) => `${line}: ${name}=$(${body})`), [],
    'a ci.yml variable is assigned from the SINGLE SOURCE scope script with something ' +
    'appended — a pipe, a filter, a second command:\n      ' +
    filtered.map(({ line, name, body }) => `${line}: ${name}=$(${body})`).join('\n      ') +
    '\n      That narrows the scope while leaving every "is the shared script read?" check ' +
    'green, which is how the hand-written list came back. Assign the call alone.');

  const scopeVars = new Set(scopeAssigns.map(({ name }) => name));

  // Assigned once, counted on the NAME alone: the right-hand side of the second
  // assignment is exactly what must not be trusted, so its shape cannot be part
  // of finding it.
  const rebound = [...scopeVars].filter((n) => lines.filter(
    ({ text }) => new RegExp(`(?:^|\\s)${n}=`).test(text)).length > 1);
  assert.deepEqual(rebound, [],
    `ci.yml assigns ${rebound.join(', ')} more than once — the later assignment can narrow ` +
    'what the shared script returned, and the first one still looks correct on its own.');

  // And what shellcheck actually receives is one of those, whole. Flag values are
  // dropped first (`--severity="$SEV"` is a legitimate variable that is not a
  // file list); what is left are the operands.
  const badOperand = [];
  for (const { line, text } of lines) {
    if (!/(?<![\w./-])shellcheck\s/.test(text)) continue;
    const operands = text.replace(/--[a-z][a-z-]*(=|\s+)(["']?)\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\2/g, ' ');
    if (/\$\(/.test(operands)) {
      badOperand.push(`${line}: shellcheck … $( … ) — the scope is narrowed where it is used`);
    }
    for (const m of operands.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
      if (!scopeVars.has(m[1])) badOperand.push(`${line}: shellcheck … $${m[1]}`);
    }
  }
  assert.deepEqual(badOperand, [],
    `a shellcheck command in ci.yml is fed something other than the unfiltered ` +
    `tests/lib/${SHELLCHECK_SCOPE} scope:\n      ` + badOperand.join('\n      ') +
    '\n      Deriving the list into a second variable, filtering it inline, or passing the ' +
    'other single source (a different, smaller set) are all the same narrowing by another name.');
});
