// exit-code-doc-drift.test.js — R11-25 (2026-09-02 audit).
//
// Four CLIs documented `Exit codes: 0 success | 2 argv-shape error` while their
// code also exited 1 (safety-coverage-audit, update, status) or overloaded 1
// across two meanings (spec-coherence-audit). A USAGE line that disagrees with
// its own `process.exit` is worse than no line: a caller branches on it.
//
// The one-time text sweep is not the fix — the drift is what recurs. This gate
// derives, per CLI, the exit codes the source actually uses and asserts the
// file's own `Exit codes:` line names each one. It is deliberately one-way:
// documenting a code the source does not (yet) use is allowed (`doctor` may
// describe 3 before every branch exists); using one the doc omits is not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Scope constants and the main-guard shape come from the argv gate rather than
// a second hand-written copy — a CLI this gate cannot see is a CLI it cannot
// judge, and two definitions of "is this a CLI" is the drift class itself.
import { SCAN_DIRS, SCAN_EXT, REPO_ROOT, findMainBlockGuard } from '../../scripts/lint-argv.js';

// Comments must not count as code: a comment naming `process.exit(3)` would
// make this gate demand a doc entry for a branch that does not exist.
//
// LINE-ORIENTED on purpose. The first version of this function used the obvious
// `text.replace(/\/\*[\s\S]*?\*\//g, '')`, and the pre-tag review measured what
// that does to this repo: a `/*` is two characters, and this codebase's prose is
// full of paths like `~/.claude/projects/*` and `fixtures/sampling-audit/*.jsonl`.
// Each one opened a "block comment" that ran to the next real `*/`, deleting
// lines 24-836 and 996-1088 of scripts/sampling-audit.js — 906 of 1111 lines,
// including every `process.exit` in the file. The gate reported "judged 19" and
// was structurally blind to two of them; an injected `process.exit(4)` with no
// doc change stayed green. A gate whose comment-stripper is eaten by comments
// is the exact failure this repo keeps writing down.
//
// So: a block comment opens only when `/*` is the first non-whitespace on its
// line, and a line comment only when the line STARTS with `//`. Trailing
// comments are deliberately NOT stripped. The bias is one-directional —
// over-keeping text can only produce a false RED (a visible, fixable demand to
// document a code that lives in a comment), while over-stripping produces the
// false GREEN this whole gate exists to prevent.
function stripComments(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    const t = line.trimStart();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      out.push('');
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      out.push('');
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) {
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function* walkJs(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'lib') continue; // internal modules have no CLI surface
      yield* walkJs(full);
    } else if (SCAN_EXT.includes(path.extname(ent.name))) {
      yield full;
    }
  }
}

// Codes the source can actually produce. `process.exit()` / `process.exit(0)`
// and a bare fall-off-the-end are both 0, which every doc line states.
function usedExitCodes(code) {
  const used = new Set();
  for (const m of code.matchAll(/process\.exit\s*\(\s*(\d+)\s*\)/g)) used.add(m[1]);
  for (const m of code.matchAll(/process\.exitCode\s*=\s*(\d+)/g)) used.add(m[1]);
  return used;
}

// The documented region runs from `Exit codes:` to the end of that template
// literal, so a multi-line entry (spec-coherence-audit's overload note) counts.
//
// Located on the STRIPPED text: `spec-coherence-audit.js` and
// `version-cascade-check.js` each carry a header COMMENT containing the literal
// `Exit codes:` above their USAGE, and anchoring on the raw text found the
// comment instead — so deleting the real USAGE block from either left test 1
// (whose message says "in its USAGE") still passing. A comment is not
// documentation the user can read from `--help`.
function documentedExitCodes(raw) {
  const text = stripComments(raw);
  const at = text.indexOf('Exit codes:');
  if (at === -1) return null;
  const rest = text.slice(at);
  const end = rest.indexOf('`;');
  const region = end === -1 ? rest.split('\n').slice(0, 6).join('\n') : rest.slice(0, end);
  return { region, codes: new Set(region.match(/(?<![\w.])\d(?![\w.])/g) || []) };
}

// A main guard is one way to be a CLI; being `package.json#bin` is the other,
// and it was the one this gate missed. `bin/claudemd-lint.js` runs
// unconditionally — no guard to match — so the single binary this repo PUBLISHES
// TO NPM, whose exit codes an external caller actually branches on, sat outside
// the judged set while the gate reported a comfortable 19.
function binEntryPoints() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return Object.values(pkg.bin || {}).map(p => path.normalize(p));
}

function cliEntryPoints() {
  const bins = new Set(binEntryPoints());
  const out = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkJs(abs)) {
      const rel = path.relative(REPO_ROOT, file);
      const text = fs.readFileSync(file, 'utf8');
      if (!findMainBlockGuard(text) && !bins.has(rel)) continue;
      out.push({ rel, text });
    }
  }
  // Every declared bin must have been reachable by the walk above — a bin moved
  // outside SCAN_DIRS would otherwise leave the gate silently narrower.
  const seen = new Set(out.map(c => c.rel));
  const missed = [...bins].filter(b => !seen.has(b));
  assert.deepEqual(missed, [], `package.json#bin names files this gate never scanned: ${missed.join(', ')}`);
  return out;
}

// A gate must report how many objects it judged: "clean" and "found nothing to
// judge" print the same PASS otherwise. The floor is a tripwire on the scope
// itself — if a future refactor makes findMainBlockGuard stop matching, this
// fails instead of quietly judging two files.
const MIN_CLIS = 18;

test('R11-25: every CLI is judged, and the count is stated', () => {
  const clis = cliEntryPoints();
  console.log(`  exit-code-doc gate: judged ${clis.length} CLI entry point(s)`);
  assert.ok(
    clis.length >= MIN_CLIS,
    `expected ≥${MIN_CLIS} CLI entry points, found ${clis.length}: ${clis.map(c => c.rel).join(', ')}`
  );
  const undocumented = clis.filter(c => documentedExitCodes(c.text) === null).map(c => c.rel);
  assert.deepEqual(
    undocumented,
    [],
    'every CLI with a main guard must carry an `Exit codes:` line in its USAGE'
  );
});

test('R11-25: no CLI uses an exit code its own USAGE does not document', () => {
  const drift = [];
  for (const { rel, text } of cliEntryPoints()) {
    const doc = documentedExitCodes(text);
    if (!doc) continue; // reported by the test above
    const used = usedExitCodes(stripComments(text));
    const missing = [...used].filter(c => !doc.codes.has(c)).sort();
    if (missing.length)
      drift.push(
        `${rel}: exits ${missing.join(', ')} but documents only ${[...doc.codes].sort().join(', ')}`
      );
  }
  assert.deepEqual(drift, [], `USAGE disagrees with process.exit:\n  ${drift.join('\n  ')}`);
});

test('R11-25: the comment stripper does not eat code (instrument self-check)', () => {
  // The instrument's own failure mode, pinned. `stripComments` must leave the
  // main guard — which is code — standing in every CLI. When the whole-file
  // block-comment regex was in place this failed for sampling-audit.js and
  // baseline-metrics.js, which is how the blindness was found.
  // Only for files that HAVE a guard to lose: `bin/claudemd-lint.js` enters the
  // set as a package.json#bin and runs unconditionally. (This assertion caught
  // its own scope mismatch the moment that file joined the set — which is the
  // behaviour wanted from an instrument self-check.)
  const eaten = [];
  const docLost = [];
  for (const { rel, text } of cliEntryPoints()) {
    if (findMainBlockGuard(text) && !findMainBlockGuard(stripComments(text))) eaten.push(rel);
    // The other half of "did the stripper eat something load-bearing": the
    // USAGE block is a template literal, not a comment, so it must survive.
    if (!stripComments(text).includes('Exit codes:')) docLost.push(rel);
  }
  assert.deepEqual(eaten, [], `stripComments removed the main guard from: ${eaten.join(', ')}`);
  assert.deepEqual(
    docLost,
    [],
    `stripComments removed the USAGE Exit-codes line from: ${docLost.join(', ')}`
  );

  // Prose containing a glob must not open a block comment (the reported bug).
  const prose = [
    '// scans ~/.claude/projects/* and fixtures/sampling-audit/*.jsonl',
    'if (bad) process.exit(3);',
    '/* a real block comment',
    '   process.exit(9) is only mentioned here */',
    'process.exit(0);',
  ].join('\n');
  const seen = usedExitCodes(stripComments(prose));
  assert.ok(seen.has('3'), 'a real exit after glob-bearing prose must still be seen');
  assert.equal(seen.has('9'), false, 'an exit inside a real block comment must not count');
});

test('R11-25: an undocumented exit injected into a real CLI turns the gate red (mutation control)', () => {
  // Not a synthetic string: the injection goes into the actual source of the
  // file that was invisible, at the line range that was being deleted.
  const victim = cliEntryPoints().find(c => c.rel === 'scripts/sampling-audit.js');
  assert.ok(victim, 'premise: sampling-audit.js is in the judged set');
  const lines = victim.text.split('\n');
  assert.ok(lines.length > 600, 'premise: the file is long enough for a mid-file injection');
  lines.splice(500, 0, 'if (process.env.NEVER_EVER_SET) process.exit(4);');
  const mutated = lines.join('\n');

  const doc = documentedExitCodes(mutated);
  const used = usedExitCodes(stripComments(mutated));
  assert.ok(used.has('4'), 'the injected exit must be visible to the scanner');
  assert.deepEqual(
    [...used].filter(c => !doc.codes.has(c)),
    ['4'],
    'an undocumented exit code must be reported'
  );
});

test('R11-25: the detector fires on a doc/code mismatch (control)', () => {
  // Without this the assertion above passes on a detector that always returns
  // an empty list — the shape that let a bad harness reject a real finding
  // (probe-harness controls-first lesson).
  const bad = 'const USAGE = `Usage: x\n\nExit codes: 0 success | 2 argv-shape error.`;\nprocess.exit(1);\n';
  const doc = documentedExitCodes(bad);
  const used = usedExitCodes(stripComments(bad));
  assert.deepEqual(
    [...used].filter(c => !doc.codes.has(c)),
    ['1']
  );

  // …and a comment mentioning an exit code does not count as using it.
  const commented =
    'const USAGE = `Exit codes: 0 success | 2 argv-shape error.`;\n// process.exit(7) once lived here\n';
  assert.deepEqual([...usedExitCodes(stripComments(commented))], []);
});
