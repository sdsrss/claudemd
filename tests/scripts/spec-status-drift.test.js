// spec-status-drift.test.js — a plan in tasks/specs/ that still says `approved`
// must still be an OPEN commitment.
//
// The defect this is written against: tasks/specs/s8-shared-tokenizer.md carried
// `status: approved` — "approved and not implemented, the oldest open commitment
// in specs/" — while every function it plans (`s8_split_segments`,
// `s8_strip_wrappers`, `S8_WRAP_ARGLESS`) had shipped in 8f39e37 and had since
// grown from the planned two consumers to four. The stale line was read as fact
// twice: once by the tasks/ index, once by an audit ledger, and both times the
// answer to "what is still owed here?" was wrong in the direction that costs the
// most — it invents work that is already done.
//
// Nothing related the claim to the tree. Frontmatter and the index agreed with
// each other, so a status-to-index join — the obvious gate, and the shape this
// repo reaches for — would have passed: they were both wrong together. The only
// reading that means anything is the one against the source
// (feedback_audit_finding_verify_vs_source).
//
// Scope note: tasks/INDEX.md is NOT tracked (tasks/ is ignore-by-default with a
// whitelist), so it cannot be an arm of a gate that has to run from a fresh
// checkout. The seven spec files are tracked and are the whole subject here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// `deprecated` is here because §2.S of the shipped spec defines it and this list
// did not — a spec retired with the word the spec itself names would have failed
// CI (v0.71.2 pre-tag review). `rejected` is the reverse mismatch: the tree uses
// it (tasks/specs/s8-literal-provenance.md) and §2.S does not define it. Both
// stay accepted; reconciling the two lists is a spec edit, not a test edit.
const KNOWN_STATUSES = ['draft', 'approved', 'implemented', 'rejected', 'deprecated'];

// Statuses that assert the work is NOT done yet, and so can be contradicted by
// the tree. `draft` is in the set because of the second instance, found by hand
// the same day this file shipped: tasks/specs/routing-single-source.md was
// executed in d801dd1 on the day it was written and sat at `status: draft` for
// 113 days. The first version of this gate judged `approved` only and would
// have walked past it — the drift does not care which of the two open words the
// header uses.
//
// The cost, stated here because it is real and because the note that led to this
// fix explicitly declined to pay it: every open spec must now carry two or more
// `- Produces:` lines or the second assertion fails on it. One of the seven
// tracked specs uses that convention today and §2.S does not define the field at
// all, so this turns one file's habit into a requirement. It is deliberate — the
// alternative is the silent `continue` that kept this gate green over an empty
// subset for the whole of its first release — but it is a requirement, not a
// free tightening: a draft written before its work exists has to say what it
// intends to produce, and a plan only to MODIFY existing symbols has nothing to
// declare and must either declare them anyway or not sit in an open status. If
// that trade turns out wrong, the part worth keeping is the count in the
// diagnostic, not this assertion.
const OPEN_STATUSES = ['approved', 'draft'];

// Floor over the whole spec set, not over the open subset. Zero open specs is
// the correct steady state — every commitment met — so an empty subset must be
// allowed to pass, and the thing that has to be non-empty is the set the
// machinery walked to get there. What the floor cannot do is tell an empty
// subset from an unevaluated one; that is the second test's job, below.
const SPEC_FLOOR = 5;

function trackedSpecs() {
  return execFileSync('git', ['ls-files', 'tasks/specs/*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

const statusOf = (text) => (text.match(/^status:[ \t]*(\S+)/m) || [])[1];

// Only a backtick token IMMEDIATELY after the marker counts as a declared
// artifact. `- Produces: a test asserting … \`CURLSH_WRAP\` …` names a symbol it
// REFERENCES, not one it creates, and counting that would let a spec be judged
// complete on someone else's work. Arguments after the name are dropped:
// `s8_split_segments <multiline-cmd>` declares `s8_split_segments`.
function declaredArtifacts(text) {
  return [...text.matchAll(/^- Produces: `([^`]+)`/gm)]
    .map((m) => m[1].split(/\s+/)[0])
    .filter((n) => /^[A-Za-z_][\w.-]*$/.test(n));
}

// The haystack deliberately excludes tasks/specs/ itself: a plan naming the
// function it intends to write is not an implementation of it, and a gate that
// counted it would report every approved spec as complete on the day it was
// written. Narrative files are out for the same reason — a CHANGELOG entry or an
// audit doc describing the work is prose about code, not code
// (feedback_gate_reads_prose_not_code). Comment lines are stripped from what is
// left, so a `# see s8_strip_wrappers` note cannot stand in for a call.
//
// Block comments go first, and only in .js/.mjs: the v0.71.2 review recorded
// that this stripper handled `#` and `//` but not `/* */`, JSDoc continuation
// lines, or JSON string values, and left the note "fix it the next time this
// stripper is touched". This is that time. It is deliberately NOT applied to
// .sh — `rm -rf /*` is a command there, and a stripper that ate from it to the
// next `*/` would delete real definitions from the haystack, which fails in the
// direction that hides work rather than the one that over-reports it. The JSON
// half of that note is answered by the anchoring below instead: prose sitting in
// a `_doc` value is a mention, and mentions no longer count.
function codeHaystack() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('tasks/specs/'))
    .filter((f) => !f.startsWith('docs/'))
    .filter((f) => f !== 'CHANGELOG.md');
  const paths = new Set(files.map((f) => path.basename(f)));
  let code = '';
  for (const f of files) {
    if (!/\.(sh|js|mjs|json|tsv)$/.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    code += stripNonCode(text, f);
    code += '\n';
  }
  return { code, paths };
}

// Named so the cases below can drive the same function the scan uses rather
// than a second copy of the rules (feedback_extraction_needs_consumer_gate:
// the copy is what drifts). Block comments are removed whole-text before the
// line pass, because a line-at-a-time stripper cannot see a construct that
// spans lines (feedback_sed_line_based_misses_multiline).
// The opener must be a line's whole content, not a `/*` found anywhere in it.
// The unanchored version of this shipped in a staged 0.71.3 and the pre-tag
// review measured what it cost: `// Scans ~/.claude/projects/*/memory/…` is a
// comment about a glob, and `projects/*` is a `/*`, so the region ran to the
// next `*/` — another glob 175 lines later — and took `classifyTag` with it.
// Across the tree that stripper hid 8 of 99 exported functions from the
// haystack, which is the direction that makes shipped work read as outstanding:
// a spec declaring `scanVocab` and `scanStructure` was caught by 0.71.2 and
// silently passed by the version that added this. Reordering the two passes is
// NOT the fix — a `/*` inside a string literal opens the same runaway with the
// line pass run first — and neither is trusting that comments and globs stay
// out of each other's way. Anchoring is what makes the shape unambiguous, and
// it is also what a block comment written to be read looks like.
function stripNonCode(text, file) {
  const body = /\.(js|mjs)$/.test(file)
    ? text.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, ' ')
    : text;
  return body.split('\n').map((l) => l.replace(/(^|\s)(#|\/\/).*$/, '')).join('\n');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `- Produces:` claims the spec CREATES the thing. So presence has to be judged
// on a definition site, not on the name turning up somewhere — the difference
// between "this work landed" and "this word is in the repo".
//
// The unanchored `\bname\b` this replaces was reported from both sides in
// tasks/spec-status-drift-gate-blind-spots.md, and they are one predicate seen
// twice: a draft declaring `cache` and `resolve` was condemned as stale because
// both words appear in dozens of tracked files, while a real artifact that
// landed under a different name reads as absent. Measured against this tree
// before the change: `cache`, `resolve`, `linkage` and `saturation` are all
// mentioned and none are defined, while `s8_split_segments`, `s8_strip_wrappers`
// and `S8_WRAP_ARGLESS` — the three symbols the gate was written for — are still
// found. The FP pair drops out and the original defect is still caught.
//
// What it does not fix: a name that something really does define (`hook`,
// `status` both define in this tree) still collides. That is a genuine ambiguity
// in the declaration, not in the predicate, and the failure message says so.
function definitionShapes(name) {
  const n = escapeRe(name);
  return [
    // `name() {` / `function name() {` — shell and JS both.
    new RegExp(`^[ \\t]*(?:function[ \\t]+)?${n}[ \\t]*\\([ \\t]*\\)`, 'm'),
    new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:async[ \\t]+)?function[ \\t]+${n}\\b`, 'm'),
    new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${n}\\b[ \\t]*=`, 'm'),
    // Shell assignment, including the readonly/local/declare/export prefixes.
    new RegExp(`^[ \\t]*(?:readonly[ \\t]+|local[ \\t]+|export[ \\t]+|declare[ \\t]+-[A-Za-z]+[ \\t]+)?${n}=`, 'm'),
    // A JSON key is that file's definition of the name.
    new RegExp(`"${n}"[ \\t]*:`),
  ];
}

// Split rather than all-or-nothing. The caller needs to tell "none of this
// landed" from "two of the three did and the third was renamed", and the old
// boolean collapsed both into `false`, which is what made a rename silence a
// whole spec permanently.
function artifactPresence(artifacts, { code, paths }) {
  const present = [];
  const missing = [];
  for (const a of artifacts) {
    // The file set is consulted for EVERY artifact, not just the four
    // extensions the symbol branch knows to step aside for. `declaredArtifacts`
    // admits any `name.ext`, and this repo really does produce
    // `spec/hard-rules.json`, `banned-vocab.patterns` and `ci.yml` — under the
    // old mention-based predicate those were found by their paths appearing in
    // code, and routing them to a symbol lookup made every one of them read as
    // missing (pre-tag review of this release). A produced file is present when
    // the file is there; asking whether something defines `hard-rules.json` as
    // a symbol was never the question.
    const hit = paths.has(a)
      || (!/\.(sh|js|mjs|tsv)$/.test(a) && definitionShapes(a).some((re) => re.test(code)));
    (hit ? present : missing).push(a);
  }
  return { present, missing };
}

test('every tracked spec carries a known status', () => {
  const specs = trackedSpecs();
  assert.ok(specs.length >= SPEC_FLOOR,
    `only ${specs.length} tracked spec(s) under tasks/specs/ (floor ${SPEC_FLOOR}) — ` +
    'the glob matched nothing or the layout moved; refusing to report a clean status scan over that few.');
  const bad = [];
  for (const s of specs) {
    const st = statusOf(fs.readFileSync(path.join(ROOT, s), 'utf8'));
    if (!KNOWN_STATUSES.includes(st)) bad.push(`${s} — status: ${st ?? '<missing>'}`);
  }
  assert.deepEqual(bad, [],
    `spec(s) with a missing or unrecognised status (expected one of ${KNOWN_STATUSES.join('/')}):\n      ` +
    bad.join('\n      '));
});

// The `continue` on a spec with fewer than two declared artifacts used to be
// silent, and that made "judged them all, every commitment is open" and "judged
// nothing at all" the same output. It was not a hypothetical: `- Produces:` is
// used by exactly one of the seven tracked specs — the one this gate was written
// against — so the subset actually evaluated was empty on the day it shipped,
// and the pre-tag review escaped it by restating an already-shipped plan in the
// prose style the other six use. A gate that cannot say how many objects it
// judged cannot be believed when it says they were clean.
//
// So the unevaluated ones are now a failure of their own rather than a skip:
// an open spec that declares no parseable artifact is a spec whose completion
// this gate cannot check, and saying so is the only honest report available.
test('no open spec has already been fully implemented', (t) => {
  const { code, paths } = codeHaystack();
  const specs = trackedSpecs();
  const stale = [];
  const unevaluable = [];
  const partial = [];
  let judged = 0;
  for (const s of specs) {
    const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
    const status = statusOf(text);
    if (!OPEN_STATUSES.includes(status)) continue;
    const artifacts = declaredArtifacts(text);
    // Two or more, so a single generic name cannot condemn a spec by collision.
    if (artifacts.length < 2) {
      unevaluable.push(`${s} — status: ${status}, declares ${artifacts.length} parseable \`- Produces:\` artifact(s)`);
      continue;
    }
    judged++;
    const { present, missing } = artifactPresence(artifacts, { code, paths });
    if (missing.length === 0) {
      stale.push(`${s} — declares [${artifacts.join(', ')}], all present in the tree`);
    } else {
      // Not a failure: a spec with some — or none — of its artifacts in the
      // tree is work in progress, which is exactly what an open status should
      // mean. It is printed because the alternative is what the blind-spot note
      // recorded: one artifact renamed between the plan and the code, and the
      // whole spec goes quiet for good with nothing anywhere saying so.
      //
      // `0/2 present` is printed too, and that is not padding. The first
      // version of this guarded on `present.length > 0`, so a spec where the
      // predicate found NOTHING produced no line at all — and both regressions
      // the pre-tag review of this release found were invisible for exactly
      // that reason. A verdict of "nothing landed" is a verdict; the diagnostic
      // saying only how many specs were scanned, and never what came of them,
      // is the same hiding place one level down (feedback_gate_must_report_its_cardinality).
      partial.push(`${s} — ${present.length}/${artifacts.length} present, missing [${missing.join(', ')}]`);
    }
  }

  // Printed on the green path too, which is the point: the count is the
  // difference between a clean scan and an empty one.
  t.diagnostic(`${specs.length} tracked spec(s); ${judged + unevaluable.length} open ` +
    `(${OPEN_STATUSES.join('/')}); ${judged} evaluated against the tree, ${unevaluable.length} not evaluable` +
    (partial.length ? `\n      partially present (in progress, or an artifact was renamed):\n      ` +
      partial.join('\n      ') : ''));

  assert.deepEqual(stale, [],
    `a spec still marked open — i.e. an unmet commitment — has every artifact it plans ` +
    'already in the tree:\n      ' + stale.join('\n      ') +
    '\n      Flip it to `status: implemented` and record the commit that landed it. If the ' +
    'work really is outstanding, the names collided and the spec should say so.');

  assert.deepEqual(unevaluable, [],
    'an open spec declares nothing this gate can look for, so its completion was not ' +
    'checked — and a scan that reports green over an empty subset is the failure this ' +
    'gate exists to prevent:\n      ' + unevaluable.join('\n      ') +
    '\n      Give it two or more `- Produces: `name`` lines naming what it creates, or set ' +
    'its status to implemented/rejected if it is no longer an open commitment.');
});

// The two tests above judge whatever the tree happens to contain, and today that
// is nothing: all seven tracked specs are implemented or rejected, so the open
// subset is empty and both assertions are vacuous. That is the correct steady
// state and it is also why the predicate itself has to be driven by fixtures —
// otherwise the rules below are only exercised on the day someone opens a spec,
// which is the day they are relied on. These feed the same functions the scan
// calls; a second copy of the rules here would be the drift this repo keeps
// filing (feedback_extraction_needs_consumer_gate).

test('presence is judged on a definition, not on the name appearing somewhere', () => {
  const paths = new Set();
  // One line per shape, because a shape no fixture drives can be deleted with
  // the suite still green — the pre-tag review removed the `function name(…)`
  // and JSON-key arms and all six tests passed, while the predicate's reach
  // over this tree's exported functions collapsed from 91/99 to 6/99.
  const defined = { code: [
    'do_the_thing() {',
    '  echo hi',
    '}',
    'export async function with_args(a, b) {',
    'const a_binding = 1',
    'readonly THE_LIMIT=40',
    '{ "a_json_key": 1 }',
  ].join('\n'), paths };
  const declared = ['do_the_thing', 'with_args', 'a_binding', 'THE_LIMIT', 'a_json_key'];
  assert.deepEqual(artifactPresence(declared, defined), { present: declared, missing: [] });

  // Every line here MENTIONS both names — a call, an argument, a JSON string
  // value — and none of them creates either. This is the escape the v0.71.2
  // review reproduced from the other side: `cache` and `resolve` appear in
  // dozens of tracked files and the unanchored predicate read that as "the
  // plan's work is done, flip it to implemented".
  const mentioned = { code: [
    'do_the_thing "$1"',
    'if [[ -n "$THE_LIMIT" ]]; then run; fi',
    '{ "_doc": "cache and resolve are described here", "rationale": "do_the_thing" }',
  ].join('\n'), paths };
  assert.deepEqual(artifactPresence(['do_the_thing', 'THE_LIMIT'], mentioned),
    { present: [], missing: ['do_the_thing', 'THE_LIMIT'] });
});

test('a renamed artifact leaves the rest of the spec visible, not silent', () => {
  // The FN half of the same predicate. Two of three landed and the third was
  // renamed between the plan and the code — the ordinary case. All-or-nothing
  // reported `false` for the spec as a whole and printed nothing, so the spec
  // could never be judged again; the split says which one is missing.
  const haystack = { code: 'alpha() {\n}\nbeta() {\n}\n', paths: new Set() };
  assert.deepEqual(artifactPresence(['alpha', 'beta', 'gamma'], haystack),
    { present: ['alpha', 'beta'], missing: ['gamma'] });
});

// The fixtures above pin the RULES; this pins the HAYSTACK, and it is the only
// assertion in this file that is not vacuous on today's tree. Both regressions
// the pre-tag review of v0.71.3 found were failures to build the haystack, not
// failures to write a regex — one comment-stripping pass removed 8 of these 99
// functions from it and every fixture stayed green, because a fixture supplies
// its own code string and never touches the reader.
//
// Derived from the source rather than listed: an exported function is one this
// repo really does produce, so anything the predicate cannot see here it could
// not see in a spec that declared it either.
test('no tracked exported function is invisible to the predicate', (t) => {
  const { code, paths } = codeHaystack();
  const files = execFileSync('git', ['ls-files', 'scripts/*.js', 'scripts/lib/*.js', 'tests/lib/*.js'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const names = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8')
      .matchAll(/^export[ \t]+(?:async[ \t]+)?function[ \t]+([A-Za-z_]\w*)/gm)) names.add(m[1]);
  }
  assert.ok(names.size >= 40,
    `only ${names.size} exported function(s) found across ${files.length} tracked script file(s) — ` +
    'the derivation broke, and a check over that few proves nothing.');

  const { missing } = artifactPresence([...names], { code, paths });
  t.diagnostic(`${names.size} exported function(s) across ${files.length} file(s); ${missing.length} invisible`);
  assert.deepEqual(missing, [],
    'a function this repo exports cannot be found in the haystack the drift gate searches, so a ' +
    'spec declaring it would read as unfinished forever:\n      ' + missing.join('\n      ') +
    '\n      Either a definition shape is missing, or — far likelier — something in codeHaystack() ' +
    'is removing real code on its way in.');
});

test('an artifact named as a file is looked for as a file', () => {
  // `hard-rules.json` is here because the extension whitelist was the whole
  // test before, and this repo ships produced files it does not cover —
  // `spec/hard-rules.json`, `banned-vocab.patterns`, `ci.yml`. Routing those to
  // a symbol lookup asked whether anything DEFINES `hard-rules.json`, which
  // nothing does, so every one of them read as missing.
  const haystack = { code: '', paths: new Set(['s8-diff-scan.sh', 'hard-rules.json']) };
  assert.deepEqual(
    artifactPresence(['s8-diff-scan.sh', 'hard-rules.json', 'missing-tool.sh', 'absent.json'], haystack),
    { present: ['s8-diff-scan.sh', 'hard-rules.json'], missing: ['missing-tool.sh', 'absent.json'] });
});

test('a definition inside a JS block comment is not a definition', () => {
  // The gap the v0.71.2 review recorded as latent and asked to be closed the
  // next time this stripper was touched. `.sh` is deliberately left alone: the
  // `/*` there is a glob, and eating to the next `*/` would remove real code.
  //
  // The commented-out definition carries no ` * ` continuation prefix, and that
  // is the whole point of the fixture: with the prefix, the line anchor rejects
  // it on its own and removing the block stripper changes nothing — the first
  // version of this case was written that way and stayed green under a mutant
  // that deleted the stripping outright (feedback_probe_harness_controls_first:
  // a control that does not turn the assertion's own predicate false proves the
  // mutation missed, not that the gate holds).
  const js = stripNonCode('/*\nconst planned_helper = 1\n*/\nconst real_helper = 2\n', 'x.js');
  assert.deepEqual(artifactPresence(['planned_helper', 'real_helper'], { code: js, paths: new Set() }),
    { present: ['real_helper'], missing: ['planned_helper'] });

  const sh = stripNonCode('rm -rf /*\nkeep_me() {\n', 'x.sh');
  assert.deepEqual(artifactPresence(['keep_me'], { code: sh, paths: new Set() }),
    { present: ['keep_me'], missing: [] });
});
