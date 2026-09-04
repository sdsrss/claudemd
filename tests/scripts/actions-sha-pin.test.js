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

// `uses:` as a YAML key at the start of a line, optionally after a `- `. Not a
// substring search: the workflows explain themselves at length, and a comment
// or an `echo "uses: …"` inside a `run: |` block is prose, not a step. Comment
// lines are dropped first for the same reason the repo files under
// feedback_gate_reads_prose_not_code — twice, including once in a gate written
// to close that very class.
function stepUses(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    const m = raw.match(/^\s*-?\s*uses:\s*(\S+)\s*(.*)$/);
    if (!m) return;
    out.push({ line: i + 1, ref: m[1], rest: m[2].trim() });
  });
  return out;
}

// Local composite actions (`./.github/actions/x`) and container refs have no
// upstream tag to move, so there is nothing for a SHA to pin. Neither shape
// exists in this repo today; the rule is written down so that adding one does
// not read as an exemption someone invented at the time.
const isThirdParty = ref => !ref.startsWith('./') && !ref.startsWith('docker://');

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
    f => stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length === 0
  );
  assert.deepEqual(
    silent,
    [],
    `workflow file(s) from which no \`uses:\` step could be read: ${silent.join(', ')}. ` +
      'Either they run no actions (then drop them from this floor deliberately) or the parser ' +
      'no longer recognises the step shape and is certifying a file it cannot see.'
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

test('R11-33: every third-party action is pinned to a full commit SHA', t => {
  const unpinned = [];
  let judged = 0;
  for (const f of workflowFiles()) {
    for (const { line, ref } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (!isThirdParty(ref)) continue;
      judged++;
      const at = ref.lastIndexOf('@');
      const rev = at === -1 ? '' : ref.slice(at + 1);
      // Full 40-hex only. An abbreviated SHA is not a pin: git resolves a
      // prefix, and GitHub rejects it outright, so accepting one here would
      // certify a workflow that cannot run.
      if (!/^[0-9a-f]{40}$/.test(rev)) unpinned.push(`${f}:${line}: ${ref}`);
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
      'and NPM_TOKEN in scope. Pin to the full commit SHA and keep a trailing `# vX.Y.Z` comment.'
  );
});

test('R11-33: every pinned SHA carries the version it was pinned at', () => {
  const undocumented = [];
  for (const f of workflowFiles()) {
    for (const { line, ref, rest } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (!isThirdParty(ref)) continue;
      if (!/^[0-9a-f]{40}$/.test(ref.slice(ref.lastIndexOf('@') + 1))) continue;
      if (!/^#\s*v\d+\.\d+\.\d+/.test(rest)) undocumented.push(`${f}:${line}: ${ref} ${rest}`.trim());
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
  const tagged = stepUses('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v6\n');
  assert.equal(tagged.length, 1, 'the parser did not read a tagged step — control vacuous');
  assert.ok(
    !/^[0-9a-f]{40}$/.test(tagged[0].ref.slice(tagged[0].ref.lastIndexOf('@') + 1)),
    'a `@v6` reference satisfied the SHA predicate — the pin check cannot fail'
  );

  const bare = stepUses(`jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${'0'.repeat(40)}\n`);
  assert.equal(bare.length, 1, 'the parser did not read an uncommented pinned step — control vacuous');
  assert.ok(
    !/^#\s*v\d+\.\d+\.\d+/.test(bare[0].rest),
    'a SHA with no trailing comment satisfied the version-comment predicate'
  );

  // And the comment must not be able to stand in for the pin: a tag ref with a
  // `# v6.1.0` comment after it is exactly the shape that would pass a gate
  // reading the prose instead of the ref.
  const decorated = stepUses('      - uses: actions/checkout@v6 # v6.1.0\n');
  assert.equal(decorated.length, 1, 'the parser did not read the decorated step — control vacuous');
  assert.ok(
    !/^[0-9a-f]{40}$/.test(decorated[0].ref.slice(decorated[0].ref.lastIndexOf('@') + 1)),
    'a tag ref with a version comment passed the SHA predicate — the gate is reading the comment'
  );

  // Comments are not steps: the header of this very file writes `uses:` inside
  // prose, and both workflows explain their own steps at length.
  assert.equal(
    stepUses('      # - uses: actions/checkout@v6\n').length,
    0,
    'a commented-out step was read as a real one'
  );
});
