// actions-sha-pin.test.js — every third-party GitHub Action this repo runs must
// be referenced by an immutable commit SHA, not by a moving tag.
//
// 2026-09-02 audit R11-33, the one item in that batch that needed authorisation
// (§5 hard: CI config). `actions/checkout@v6` is a branch-like ref the upstream
// owner can repoint at any commit at any time. npm-publish.yml grants
// `id-token: write` and holds `secrets.NPM_TOKEN`, so a repointed tag in any
// step of that workflow executes attacker-chosen code in a job that can mint a
// provenance attestation and publish to npm under this package's name. The
// marketplace channel is worse in one respect: it serves the tag directly and
// `ci.yml` only reports, so nothing about a compromised run would look red.
//
// A SHA pin costs manual updates. That is the trade, and it is why every pinned
// ref carries a trailing `# vX.Y.Z` comment: without it the workflow becomes a
// wall of hex that nobody can tell is nine months stale. The comment is
// documentation, NOT the thing that runs — which is exactly why the test below
// asserts on both halves separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

// Floors, not exact counts: a workflow may legitimately gain or drop a step.
// What may not happen is the parser resolving nothing and this file reporting a
// green pin over an empty set (feedback_gate_must_report_its_cardinality — the
// count that matters is of the judged subject, and a gate that cannot judge its
// subject has to be red rather than quiet).
const WORKFLOW_FLOOR = 2;
const USES_FLOOR = 5;

// Workflows that legitimately run no actions at all (`run:`-only). Empty today.
// It exists because the "read no steps" failure below used to tell the reader to
// "drop them from this floor deliberately" while offering nowhere to drop them:
// adding a plain `run:`-only workflow turned the gate red and the only way out
// was editing the test. A promised affordance that does not exist is worse than
// no affordance — the next person edits the predicate instead of the list.
const NO_ACTION_WORKFLOWS = [];

// `uses:` as a YAML key. Not a substring search: the workflows explain
// themselves at length, and a comment or an `echo "uses: …"` inside a `run: |`
// block is prose, not a step. Comment lines are dropped first for the same
// reason the repo files under feedback_gate_reads_prose_not_code — twice,
// including once in a gate written to close that very class.
//
// Two spellings, because block form is not the only legal one. The pre-tag
// review of this release drove 14 shapes through the first version and found
// `- {uses: actions/checkout@v6}` and `steps: [{uses: …}]` — both valid GitHub
// Actions YAML — parsing to ZERO steps: a `{` between the `- ` and the `uses:`
// made the line invisible, and the per-file "read no steps" assertion cannot
// see it because such a step lives in a file whose other steps parse fine.
//
// Surrounding quotes are stripped: `uses: 'actions/checkout@<sha>'` is a
// correct pin, and leaving the quote on made the 40-hex test read 41 characters
// and fail it — a gate that reddens on a properly pinned step is as broken as
// one that greens on an unpinned one, just louder.
const stripQuotes = s => s.replace(/^['"]/, '').replace(/['"]$/, '');

function stepUses(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    // The trailing comment is taken from the LINE, not from what follows the
    // ref, so the version comment is found in either spelling.
    const c = raw.match(/#.*$/);
    const rest = c ? c[0].trim() : '';
    const anchored = raw.match(/^\s*-?\s*uses:\s*(\S+)/);
    if (anchored) {
      out.push({ line: i + 1, ref: stripQuotes(anchored[1]), rest });
      return;
    }
    for (const m of raw.matchAll(/[[{,]\s*uses:\s*(["']?)([^\s,}\]"']+)/g)) {
      out.push({ line: i + 1, ref: m[2], rest });
    }
  });
  return out;
}

// Local composite actions (`./.github/actions/x`) have no upstream ref to move,
// so there is nothing for a SHA to pin. This shape does not exist in the repo
// today; the rule is written down so that adding one does not read as an
// exemption someone invented at the time.
//
// `docker://` is NOT exempt, and the first version of this file said it was on
// the grounds that "container refs have no upstream tag to move". That reason
// is false — `docker://alpine:3.14` is exactly as repointable as
// `actions/checkout@v6`, by the same mechanism. What differs is only the
// spelling of a pin, so the predicate differs and the exemption does not.
const isLocal = ref => ref.startsWith('./');
const isContainer = ref => ref.startsWith('docker://');

// A container ref is pinned by digest (`image@sha256:<64 hex>`); an action ref
// is pinned by commit SHA (40 hex). Full-length only, in both cases: git
// resolves an abbreviated prefix and GitHub rejects it, so accepting one would
// certify a workflow that cannot run.
function isPinned(ref) {
  if (isContainer(ref)) return /@sha256:[0-9a-f]{64}$/.test(ref);
  const at = ref.lastIndexOf('@');
  return at !== -1 && /^[0-9a-f]{40}$/.test(ref.slice(at + 1));
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

test('the workflow scan resolves the set it claims to judge', t => {
  const files = workflowFiles();
  assert.ok(
    files.length >= WORKFLOW_FLOOR,
    `only ${files.length} workflow file(s) under .github/workflows — under the floor of ` +
      `${WORKFLOW_FLOOR}. Two empty sets pin equally well, so this fails before any pin check.`
  );

  // Per file, not just in total: a parse that silently returns nothing for one
  // workflow is how a whole file stops being judged while the aggregate count
  // still clears its floor.
  const silent = files.filter(
    f =>
      !NO_ACTION_WORKFLOWS.includes(f) &&
      stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length === 0
  );
  assert.deepEqual(
    silent,
    [],
    `workflow file(s) from which no \`uses:\` step could be read: ${silent.join(', ')}. ` +
      'Either the parser no longer recognises the step shape and is certifying a file it cannot ' +
      'see, or this workflow genuinely runs no actions — in which case add it to ' +
      'NO_ACTION_WORKFLOWS above, deliberately and in the open. There is no implicit exemption.'
  );

  const total = files.reduce(
    (n, f) => n + stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length,
    0
  );
  assert.ok(
    total >= USES_FLOOR,
    `${total} \`uses:\` step(s) resolved across ${files.length} workflow(s), under the floor of ${USES_FLOOR}`
  );
  t.diagnostic(`${total} uses: step(s) across ${files.length} workflow(s): ${files.join(', ')}`);
});

test('R11-33: every third-party action is pinned to an immutable digest', t => {
  const unpinned = [];
  let judged = 0;
  for (const f of workflowFiles()) {
    for (const { line, ref } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (isLocal(ref)) continue;
      judged++;
      if (!isPinned(ref)) unpinned.push(`${f}:${line}: ${ref}`);
    }
  }
  t.diagnostic(`${judged} third-party action reference(s) judged`);
  assert.ok(judged >= USES_FLOOR, `only ${judged} third-party reference(s) judged — nothing to certify`);
  assert.deepEqual(
    unpinned,
    [],
    'GitHub Action(s) referenced by a mutable tag or branch:\n      ' +
      unpinned.join('\n      ') +
      '\n      A tag is a pointer its owner can repoint; npm-publish.yml runs with id-token: write ' +
      'and NPM_TOKEN in scope. Pin an action to its full commit SHA (and a container to its ' +
      '@sha256: digest), and keep a trailing `# vX.Y.Z` comment.'
  );
});

test('R11-33: every pinned SHA carries the version it was pinned at', () => {
  const undocumented = [];
  for (const f of workflowFiles()) {
    for (const { line, ref, rest } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (isLocal(ref) || !isPinned(ref)) continue;
      if (!/^#\s*v?\d+\.\d+\.\d+/.test(rest)) undocumented.push(`${f}:${line}: ${ref} ${rest}`.trim());
    }
  }
  assert.deepEqual(
    undocumented,
    [],
    'pinned action(s) with no `# vX.Y.Z` comment saying which release the SHA is:\n      ' +
      undocumented.join('\n      ') +
      '\n      The SHA is what runs; the comment is the only thing that makes it maintainable.'
  );
});

test('R11-33: both pin predicates can return false (mutation control)', () => {
  // Against the two shapes drift actually takes: a step re-written back to a
  // tag, and a SHA pasted in without the version comment. Asserted on the
  // parser + predicate pair rather than on a hand-read string, because the
  // failure this repo keeps filing is a control that never made the predicate
  // false (feedback_probe_harness_controls_first).
  const SHA = '0'.repeat(40);
  const one = line => {
    const s = stepUses(line);
    assert.equal(
      s.length,
      1,
      `the parser read ${s.length} step(s) from \`${line.trim()}\` — control vacuous`
    );
    return s[0];
  };

  // Must be judged UNPINNED. Every entry is a shape the pre-tag review of this
  // release drove through by hand; encoding them is the difference between a
  // reviewer having checked once and the gate checking on every run.
  for (const line of [
    '      - uses: actions/checkout@v6',
    '      - uses: actions/checkout@main',
    `      - uses: actions/checkout@${SHA.slice(0, 7)}`, // abbreviated is not a pin
    `      - uses: actions/checkout@${'A'.repeat(40)}`, // uppercase hex is not what git prints
    '      - uses: actions/checkout@v6 # v6.1.0', // the comment must not stand in for the ref
    "      - uses: 'actions/checkout@v6'",
    '      - {uses: actions/checkout@v6}', // flow mapping — invisible to the first version
    '    steps: [{uses: actions/checkout@v6}]',
    '      - uses: docker://alpine:3.14', // a registry tag moves like any other
    '      - uses: some-org/reusable/.github/workflows/x.yml@main',
  ]) {
    assert.ok(!isPinned(one(line).ref), `this shape satisfied isPinned and must not: ${line.trim()}`);
  }

  // Must be judged PINNED — a gate that reddens on a correct pin is as broken as
  // one that greens on a bad one, and the quoted form cost exactly that.
  for (const line of [
    `      - uses: actions/checkout@${SHA}`,
    `      - uses: "actions/checkout@${SHA}"`,
    `      - {uses: actions/checkout@${SHA}}`,
    `      - uses: docker://alpine@sha256:${'a'.repeat(64)}`,
  ]) {
    assert.ok(isPinned(one(line).ref), `this shape is a correct pin and was rejected: ${line.trim()}`);
  }

  // The version comment is read from the line in either spelling, and its
  // absence is what the second predicate keys on.
  assert.ok(!/^#\s*v?\d+\.\d+\.\d+/.test(one(`      - uses: actions/checkout@${SHA}`).rest));
  assert.ok(/^#\s*v?\d+\.\d+\.\d+/.test(one(`      - {uses: actions/checkout@${SHA}} # v6.1.0`).rest));

  // Comments are not steps: the header of this very file writes `uses:` inside
  // prose, and both workflows explain their own steps at length.
  assert.equal(
    stepUses('      # - uses: actions/checkout@v6\n').length,
    0,
    'a commented-out step was read as a real one'
  );

  // Local composite actions are the only exemption, and it must stay narrow.
  assert.ok(isLocal('./.github/actions/build'));
  assert.ok(!isLocal('actions/checkout@v6') && !isLocal('docker://alpine:3.14'));
});
