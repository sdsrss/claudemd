import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const CORE = 'spec/CLAUDE.md';
const EXT = 'spec/CLAUDE-extended.md';
const CL = 'spec/CLAUDE-changelog.md';

// Rough token estimator: 1 word ≈ 1.3 tokens (English/markdown heuristic).
function estTokens(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

test('A13: core CLAUDE.md ≤ 5,500 tokens', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  const tokens = estTokens(text);
  assert.ok(tokens <= 5500, `core tokens = ${tokens}, expected ≤ 5500`);
});

// Version pins are DYNAMIC consistency joins (2026-07-25 audit L3: the pinned
// form required a manual test edit every release and its test NAME had already
// drifted one version behind its own assertion). Cross-file version equality is
// what these guard; "did the release land" is version-cascade-check.js + the
// upgrade-lifecycle NEW_SPEC_VER pin.
test('core / extended / hard-rules.json declare the same spec version', () => {
  const core = fs.readFileSync(CORE, 'utf8').match(/AI-CODING-SPEC v(\d+\.\d+\.\d+)\s+—\s+Core/);
  const ext = fs.readFileSync(EXT, 'utf8').match(/AI-CODING-SPEC v(\d+\.\d+\.\d+)\s+—\s+Extended/);
  const hr = JSON.parse(fs.readFileSync('spec/hard-rules.json', 'utf8'));
  assert.ok(core, 'core header must declare semver version inline');
  assert.ok(ext, 'extended header must declare semver version inline');
  assert.equal(ext[1], core[1], 'extended header version must match core');
  assert.equal(hr.spec_version, `v${core[1]}`, 'hard-rules.json spec_version must match core');
});

test('changelog top entry matches the core header version', () => {
  const core = fs.readFileSync(CORE, 'utf8').match(/AI-CODING-SPEC v(\d+\.\d+\.\d+)\s+—\s+Core/);
  const first = fs.readFileSync(CL, 'utf8').match(/^##\s+v(\d+\.\d+\.\d+)/m);
  assert.ok(core && first);
  assert.equal(first[1], core[1]);
});

test('the spec names no skill by plugin prefix: skill choice reads the harness listing', () => {
  // v7.3.0 removed the skill routing table (`skills.md`) and every `sp:` /
  // `gs:/` / `matt:` skill name, and the `superpowers:` / `gstack:` /
  // `mattpocock-skills:` forms Claude Code registers, from the rules. The table restated each skill's
  // own description, was read in 0 of 185 contexts after v7.2.0, and named 19
  // gstack sub-skills Claude Code does not register; its ship route produced 9
  // of 44 measured Skill calls as `Unknown skill` (2026-10-15 transcript scan,
  // tasks/specs/skill-routing-trim.md). The rules now name behaviours, so a
  // plugin that is absent, renamed or nested leaves no dangling reference.
  // `## Recent changes` is cut out: naming what was removed is its job.
  // Limit: this asserts an absence. It cannot tell whether the behaviour text
  // that replaced the names is right — the whole-line pins below hold that.
  const RE = /(?<![A-Za-z0-9_])(gs|sp|matt|superpowers|mattpocock-skills|gstack):\/?[a-z]/;
  for (const control of [
    'route to sp:writing-plans',
    '`gs:/ship`',
    '(matt:tdd)',
    'superpowers:test-driven-development',
    '`gstack:ship`',
    'mattpocock-skills:tdd',
    'gs:ship',
    'gstack:/ship',
    'sp:/brainstorming',
  ])
    assert.ok(RE.test(control), `vacuity guard: the scan regex no longer matches ${control}`);
  const ext = fs.readFileSync(EXT, 'utf8');
  const hs = ext.search(/^## Recent changes$/m);
  assert.ok(hs > 0, 'the `## Recent changes` heading is gone — this scan has nothing to cut');
  // The cut runs to the next module marker, or to the end of the file when
  // Recent changes is the last section (v9.0.0).
  const marker = ext.indexOf('<!-- module:', hs);
  const he = marker > hs ? marker : ext.length;
  assert.equal(
    ext.slice(hs, he).match(/^## /gm).length,
    1,
    'the Recent changes cut spans another `## ` section — it would hide that section from the scan'
  );
  const texts = { [CORE]: fs.readFileSync(CORE, 'utf8'), [EXT]: ext.slice(0, hs) + ext.slice(he) };
  for (const f of fs.readdirSync('spec/spec-modules'))
    texts[`spec/spec-modules/${f}`] = fs.readFileSync(`spec/spec-modules/${f}`, 'utf8');
  const scan = files =>
    Object.entries(files).flatMap(([f, text]) =>
      text
        .split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => RE.test(l))
        .map(([n, l]) => `${f}:${n}: ${l.slice(0, 120)}`)
    );
  // Column control (0.108.0 delta review M2): a spec rule line runs to 400+
  // characters, and a name past the cut must still be found.
  assert.equal(
    scan({ control: `${'a'.repeat(200)} then invoke sp:systematic-debugging` }).length,
    1,
    'vacuity guard: the scan does not see a skill name past column 120 of a line'
  );
  const hits = scan(texts);
  assert.deepEqual(hits, [], 'a rule names a skill by plugin prefix again — name the behaviour instead');
  assert.equal(
    fs.existsSync('spec/spec-modules/skills.md'),
    false,
    'spec/spec-modules/skills.md is back — the routing table v7.3.0 removed'
  );
});

// WHY THESE ARE EXACT-TEXT PINS AND NOT SEMANTIC ASSERTIONS.
// Two drafts tried to assert what the rules MEAN. The 0.78.0 pre-tag review
// broke the first with five mutations and the second with seven more, all of
// them green: `**Second exception**: none — … the wait is held open, never
// yielded.` satisfied a heading check and a `suspend` blacklist; `do NOT name an
// absolute output path` satisfied a positive phrase check and a `never name`
// blacklist; the trigger list was reverted to v6.25.4 verbatim with the bold
// phrase parked in a WITHDRAWN sentence that a delimiter-terminated slice
// silently swallowed. Each fix added tokens to a blacklist and the next reader
// wrote around it, because regex cannot decide what English prose means.
//
// So these do not try. Each test asserts that exactly ONE line carries the
// rule's bold heading, and that the line contains a clause VERBATIM. That is a
// golden pin: it makes no claim about meaning, and it cannot be satisfied by a
// paraphrase, an inversion, a withdrawal, a synonym or a decoy — every one of
// the twelve mutations above changes the pinned text.
//
// The pin's honest limits, both of them. A maintainer can update the pin to
// match a bad edit — but not SILENTLY: the rule text and the pin change in the
// same diff, in front of a human. Legitimate rewording fails here BY DESIGN,
// including a meaning-preserving reorder; that failure is the prompt to re-read
// the rule, not a bug to loosen away.
//
// The second limit is the one that matters and it is NOT closed: the pin covers
// THE LINE, not its neighbours. A bullet placed beside this one can revoke it,
// a preamble above it can weaken it, a `### Superseded` header can be inserted
// over it, and the rule dies with every gate here green — all four were
// demonstrated against a full clone at exit 0 (0.78.0 round-3 review, HIGH-1).
// Do not read a passing pin as "the rule still holds". It means the pinned line
// is byte-identical to what shipped, and nothing more. Closing the neighbour
// case would need a fourth mechanism asserting the semantics of surrounding
// prose, which is the approach two review rounds already falsified.
//
// The pin is the WHOLE LINE, not a clause inside it. A substring pin leaves the
// rule's own text intact and appends a sentence that takes it back — the clause
// still matches verbatim and the gate stays green. Whole-line equality has no
// such gap: anything added, removed or reworded anywhere in the bullet fails.
//
// Anchor uniqueness is the other half. Both spec files also carry prose
// RESTATEMENTS of these rules in their Recent-changes entries, and a decoy line
// carrying the same heading above a gutted real one was one of the mutations
// that survived. Requiring exactly one occurrence closes it by construction and
// is independent of where in the file the rule sits.
// The test name carries NO version. Deriving it from the spec H1 (v0.80.0's
// first attempt) made it a tautology — always the current version, so it can
// never be "behind" — while reading as "the version this pin was introduced",
// which is the opposite: every pin not introduced this release then displayed a
// label running AHEAD of its own `what`, widening each release. The 2026-07-25
// audit's defect was a stale typed label; the honest fix is to keep the version
// out of the name entirely. Each pin's `what` records when its wording was set.
const PINS = [
  {
    what: 'core §5 Ask first — the ops that stop for the [AUTH REQUIRED] line, and an approval covers only what it names (v9.0.0)',
    file: CORE,
    anchor: 'Stop and ask before these, naming them on one line',
    why: "The only list of ops that stop the agent. v9.0.0 folded v8's §5 Hard categories into it; an op dropped from this line is an op the agent now runs without asking.",
    line: 'Stop and ask before these, naming them on one line `[AUTH REQUIRED op:<what> scope:<files> risk:<why>]`: deleting files or directories you did not create in this task; a DB schema change or data migration; CI, deploy or infra config; adding, removing or bumping a production dependency; `.env`, secrets, `~/.claude/settings.json`, hooks or MCP config; auth, payment or crypto code; a breaking change to a public API; push, tag, publish or deploy the user did not ask for. An approval covers the op and scope it names.',
  },
  {
    what: 'core §7 commit — one local commit per change on the current branch; push, tag and release only when asked (v9.0.0)',
    file: CORE,
    anchor: '- In a git repo, commit each verified change locally',
    why: 'The behaviour the 2026-11-25 A/B kept the lean spec for: vanilla Opus 5.5 committed in 0/72 runs, the lean text in 72/72 (system-prompt delivery).',
    line: '- In a git repo, commit each verified change locally as its own commit, on the current branch (a project convention wins). Push, tag and release only when asked.',
  },
  {
    what: 'core §7 verify — done / fixed / passing only after a check ran this session (v9.0.0, Iron Law #2)',
    file: CORE,
    anchor: '- Say done, fixed or passing only after running the check',
    why: 'hard-rules.json §iron-law-2 anchors here; verify-log and evidence-gate file rows under it.',
    line: '- Say done, fixed or passing only after running the check in this session and reading its output.',
  },
  {
    what: 'core §8 rm on an empty-able variable — guard it with ${VAR:?} (v9.0.0 wording)',
    file: CORE,
    anchor: '- `rm -rf`, `rm -f` or `find -delete` on a variable that could be empty',
    why: "The text pre-bash-safety's §8-rm-rf-var deny enforces; its anchor in hard-rules.json.",
    line: '- `rm -rf`, `rm -f` or `find -delete` on a variable that could be empty: guard it, `rm -rf "${DIR:?}/x"`.',
  },
  {
    what: 'core §8 unknown-origin scripts — curl/wget into a shell, npx with no lockfile or local install (v9.0.0)',
    file: CORE,
    anchor: '- run scripts of unknown origin',
    why: 'Anchors §8-curl-sh and §8-npx, both hook-enforced.',
    line: '- run scripts of unknown origin: `curl` / `wget` piped into a shell, or `npx` of a package with no lockfile or local install (ask first);',
  },
  {
    what: 'core §10 遗留 — only what the user must decide or needs to know (v9.0.0)',
    file: CORE,
    anchor: '- **遗留** (Open items)',
    why: 'v9.0.0 narrowed it from "unfinished work, risks, decisions": 82-95% of v8 reports carried an open-items list (median 5-12 items) that the next session pasted back as its agenda (assessment 2026-11-25 §5).',
    line: '- **遗留** (Open items): only what the user must decide or needs to know — risks, unfinished work, choices with your pick.',
  },
  {
    what: '§EXT §12 pre-tag review — only for the listed risky changes or on request (v9.0.0)',
    file: EXT,
    anchor: 'Before the tag, a fresh-subagent reviewer',
    why: 'v8 reviewed every release; review agents took 33-36% of input tokens in two plugin repos. The list is what keeps review where defects cost users: delete paths, auth, install/publish scripts, gate decisions, data formats, default behaviour.',
    line: "Before the tag, a fresh-subagent reviewer (`review.md`) reviews the release when it changes any of: a delete or cleanup path; auth, secrets or permissions; install, update, publish or release scripts; a gate's allow or deny decision; a data format, schema or migration; the default behaviour of a published package. Otherwise skip the review and name the changed areas in the release notes. The user can ask for a review of any release.",
  },
  {
    what: '§EXT §12 one run — a ship request is one turn from commit to CI green, stopping only at a failure or for a reviewer (v9.0.0)',
    file: EXT,
    anchor: '- **One run**: one ship request covers commit, push, tag',
    why: 'hard-rules.json §12-manual-ship-atomicity anchors here. The reviewer stop is what lets a subagent report arrive (it lands only at turn end).',
    line: '- **One run**: one ship request covers commit, push, tag, the release artifact and the CI check. Do them back to back in one turn; stop only at a failure (push rejected, tag collision, CI red) or to wait for a reviewer. A deploy needs its own approval.',
  },
  {
    what: '§EXT §12-R Author ≠ reviewer — fresh subagent, blind brief, whole report in its final message (v9.0.0)',
    file: EXT,
    anchor: '- **Author ≠ reviewer**: the reviewer is a fresh subagent',
    why: 'hard-rules.json §12-author-not-reviewer anchors here.',
    line: "- **Author ≠ reviewer**: the reviewer is a fresh subagent with an empty context, never yourself. Give it the artifact (commit range as SHAs, or paths), the contract (release notes, issue or acceptance criteria) and the questions; withhold your rationale, your verdict and earlier rounds' findings. Ask for the whole report in its final message.",
  },
  {
    what: '§EXT §0.1 caps — core 4,000 / extended 12,000 bytes, and an outcome run before a new rule (v9.0.0)',
    file: EXT,
    anchor: 'Core ≤ 4,000 bytes, extended ≤ 12,000 bytes.',
    why: "The guard against regrowth: v8 reached 24 KB of core with no outcome evidence for its rules. The cap test at the end of this file enforces the caps; the outcome-run clause is the operator's gate (OPERATOR.md §13.1).",
    line: 'Core ≤ 4,000 bytes, extended ≤ 12,000 bytes. A new or stricter rule ships only after an outcome run (hidden tests, vanilla arm included; `OPERATOR.md` §13.1) shows it changes results enough to pay for its cost; "the spec is more complete" is not a reason. Removing a rule needs the same evidence or none.',
  },
];

// NEIGHBOURHOOD PINS — the second limit above, closed by visibility.
//
// The block above states it and calls it open: a pin covers THE LINE, not its
// neighbours, so a bullet placed beside a rule, a preamble above it, or a
// `### Superseded` header inserted over it kills the rule with every gate here
// green (0.78.0 round-3 review, HIGH-1; re-demonstrated in v0.80.0's round 3
// with a `**Relaxation exception**:` bullet next to the pinned §3 line, at 1088
// tests, version-cascade-check and spec-coherence-audit --strict all green). It
// also says closing it would need a mechanism that judges what the surrounding
// prose MEANS, and that two rounds falsified that approach.
//
// This does not judge meaning either, and that is the point. It makes a
// neighbour impossible to add SILENTLY — the same property the line pins
// already have, bought the same way `hard-rules-10` bought it: compare a whole
// artifact, not a substring of one. Each pinned line's markdown block (its
// nearest heading through the next heading of any level) is hashed. Anything
// added, removed or reworded anywhere in that block fails, so the neighbour and
// the hash update land in ONE diff, in front of a human.
//
// A `### Superseded` header inserted directly above a pinned line is caught by
// the other arm: it becomes that line's nearest heading, so the block key is
// absent from the table, and an unregistered block fails. That is the same
// mechanism that keeps the table honest as pins are added — a new pin in a new
// section cannot land without registering its neighbourhood.
//
// SCOPE, measured rather than asserted. The first cut of this watched only the
// blocks that held a pin, and a block ended at the next heading of ANY level —
// 59.1% of core's bytes, 15.3% of extended's. The 0.82.0 pre-tag review landed
// five revoking mutations in the gaps at 57/57 green, four of them in
// SUBSECTIONS of pinned sections (`### §5.1` under `## §5 AUTH`,
// `### Verify-before-claim` under `## §8`), one in a section holding no pin at
// all. Two changes close that: a section runs to the next heading of the same or
// higher level, so it owns its subsections, and EVERY top-level section of both
// files is registered, pinned or not — a revocation does not have to be near the
// rule it revokes. With the file preamble registered too (a sentence above the
// first heading reaches every rule below it) the watched span is the whole file:
// 24942/24942 bytes of core and 45264/45264 of extended, verified by the
// coverage assertion below rather than by this comment.
//
// The remaining limit is the line pins' own, unchanged in kind: a maintainer can
// re-bless a bad edit by updating a hash. What they cannot do is land it
// unmarked. Churn is the price and it is now the whole file — any spec edit
// fails exactly the section entry it lands in, which is the prompt to re-read
// the rules sharing that section. Hashes are the first 16 hex of sha256 over the
// section's exact bytes; `''` is the preamble, from the first line to the first
// `## ` heading.
const PINNED_BLOCKS = [
  { file: CORE, heading: '', sha256: '8b39dabbf85ffde4' },
  { file: CORE, heading: '## §1 Language', sha256: '46c8d2f548466dbb' },
  { file: CORE, heading: '## §5 Ask first', sha256: 'adfe140aa8a8f14c' },
  { file: CORE, heading: '## §7 Commit and verify', sha256: '850f3016f4bc154d' },
  { file: CORE, heading: '## §8 Safety', sha256: '270147649a41cec8' },
  { file: CORE, heading: '## §10 Report', sha256: '3ed30c588fb11d9e' },
  { file: CORE, heading: '## §12 Ship', sha256: '598ac5b7bf729032' },
  { file: EXT, heading: '', sha256: '36c055352ada3103' },
  { file: EXT, heading: '## §12 Ship', sha256: 'd486479b17aa5bd6' },
  { file: EXT, heading: '## §12-R Review', sha256: 'd4e07537d967abdc' },
  { file: EXT, heading: '## §13 META', sha256: '7c714d9c7de3fb34' },
  { file: EXT, heading: '## §10-V Banned-vocab (reference list)', sha256: 'a83549d78ed73f7f' },
  { file: EXT, heading: '## Recent changes', sha256: 'c17a04526dba5dcc' },
];

const headingLevel = line => {
  const m = /^(#{1,6}) /.exec(line);
  return m ? m[1].length : 0;
};

/**
 * The markdown SECTION containing line `idx`: nearest heading → next heading of
 * the SAME OR HIGHER level, so a section owns its subsections. The first cut of
 * this stopped at the next heading of ANY level, which left every subsection
 * that holds no pin of its own unwatched — `### §5.1 AUTONOMY_LEVEL` under a
 * pinned `## §5 AUTH`, `### Verify-before-claim` under a pinned `## §8`, and so
 * on. Four of the five mutations the 0.82.0 pre-tag review landed green were in
 * exactly those subsections.
 */
function blockFor(lines, idx) {
  let start = idx;
  while (start >= 0 && headingLevel(lines[start]) === 0) start--;
  if (start < 0) return null;
  const level = headingLevel(lines[start]);
  let end = start + 1;
  while (end < lines.length) {
    const l = headingLevel(lines[end]);
    if (l > 0 && l <= level) break;
    end++;
  }
  return { heading: lines[start], text: lines.slice(start, end).join('\n') };
}

const blockHash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

// The ordered list of every heading in both spec files, hashed. Two shapes the
// block hashes above cannot see, both demonstrated green against the real spec
// (0.82.0 pre-tag review, HIGH-2): a `### Superseded` inserted at the END of a
// pinned block — after its last line, before the next heading — leaves that
// block's bytes untouched and creates a NEW block that holds no pin, so neither
// arm looks at it; and a DUPLICATE of a registered heading is treated as
// registered, because the table keys on heading text. A heading cannot be added,
// removed, renamed or reordered anywhere in either file without this moving.
const HEADING_INVENTORY = [
  { file: CORE, count: 7, sha256: '9adc183ec0a28595' },
  { file: EXT, count: 9, sha256: 'aa6732a722219528' },
];

for (const inv of HEADING_INVENTORY) {
  test(`spec neighbourhood: heading inventory of ${inv.file}`, () => {
    const headings = fs
      .readFileSync(inv.file, 'utf8')
      .split('\n')
      .filter(l => /^#{1,6} /.test(l));
    const found = blockHash(headings.join('\n'));
    assert.equal(
      headings.length,
      inv.count,
      `${inv.file} has ${headings.length} headings, expected ${inv.count}. A heading was added ` +
        'or removed. If that is intentional, read what moved under it — a header inserted at the ' +
        'end of a pinned block is how a rule gets revoked with every other gate green — then ' +
        'update this entry in the same commit.\n' +
        headings.map(h => `  ${h}`).join('\n')
    );
    assert.equal(
      found,
      inv.sha256,
      `the heading inventory of ${inv.file} changed (count is unchanged, so a heading was ` +
        `renamed or reordered). EXPECTED ${inv.sha256}, FOUND ${found}. Update HEADING_INVENTORY ` +
        'in tests/scripts/spec-structure.test.js once you have read the diff.\n' +
        headings.map(h => `  ${h}`).join('\n')
    );
  });
}

/** The registered span for one table entry: the preamble when heading is ''. */
function registeredSpan(lines, heading) {
  if (heading === '') {
    let end = 0;
    while (end < lines.length && !/^## /.test(lines[end])) end++;
    return { start: 0, end, text: lines.slice(0, end).join('\n') };
  }
  const start = lines.indexOf(heading);
  if (start === -1) return null;
  const span = blockFor(lines, start);
  return { start, end: start + span.text.split('\n').length, text: span.text };
}

for (const block of PINNED_BLOCKS) {
  test(`spec neighbourhood: ${block.file} ${block.heading || '(preamble)'}`, () => {
    const lines = fs.readFileSync(block.file, 'utf8').split('\n');
    if (block.heading !== '') {
      // Occurrence count, not indexOf: a DUPLICATE of this heading placed at the
      // end of its own section, with a revocation under it, resolved to the first
      // occurrence and passed (0.82.0 pre-tag review, HIGH-2). Same uniqueness
      // rule the line pins below already enforce on their anchors.
      const occurrences = lines.filter(l => l === block.heading).length;
      assert.equal(
        occurrences,
        1,
        `${block.file} carries the heading ${JSON.stringify(block.heading)} ${occurrences} times. ` +
          'Two headings with the same text make the section boundary ambiguous, and the second ' +
          'one is where a revocation hides.'
      );
    }
    const span = registeredSpan(lines, block.heading);
    assert.ok(
      span,
      `${block.file} no longer carries the heading ${JSON.stringify(block.heading)} on a line of ` +
        'its own. A renamed or deleted heading moves every rule under it into some other ' +
        "section — re-point this entry at the rule's new home."
    );
    const found = blockHash(span.text);
    assert.equal(
      found,
      block.sha256,
      `the block under ${JSON.stringify(block.heading)} in ${block.file} changed.\n` +
        `EXPECTED sha256/16 ${block.sha256}, FOUND ${found}.\n\n` +
        'The pinned rule LINES in this block may all still be byte-identical — this gate is the ' +
        'other half, and it reports that something around them moved. A bullet beside a rule, a ' +
        'preamble above it, or a header inserted over it can revoke that rule without touching ' +
        'its text (0.78.0 round-3 HIGH-1). Read the diff of this block, decide whether every ' +
        'pinned rule in it still holds, and only then update this hash — it lives in ' +
        'PINNED_BLOCKS in tests/scripts/spec-structure.test.js — in the same commit.'
    );
  });
}

for (const file of [CORE, EXT]) {
  test(`spec neighbourhood: every line of ${file} is inside exactly one registered section`, () => {
    // The scope claim, asserted rather than described. The first cut of this gate
    // registered only the sections holding a pin, and the review's five revoking
    // mutations lived in the gaps; a percentage in a comment is not a property,
    // this is. It is also what keeps the table self-extending: a new `## ` section
    // cannot be added to either spec file without an entry, and a pin cannot move
    // into an unwatched place because there is no unwatched place.
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const seen = new Map();
    for (const block of PINNED_BLOCKS.filter(b => b.file === file)) {
      const span = registeredSpan(lines, block.heading);
      assert.ok(span, `PINNED_BLOCKS names ${JSON.stringify(block.heading)}, which ${file} lacks`);
      for (let i = span.start; i < span.end; i++) {
        assert.ok(
          !seen.has(i),
          `${file}:${i + 1} is inside two registered sections (${JSON.stringify(seen.get(i))} and ` +
            `${JSON.stringify(block.heading)}) — the table must partition the file, not overlap`
        );
        seen.set(i, block.heading);
      }
    }
    const uncovered = lines.map((l, i) => (seen.has(i) ? null : `${i + 1}: ${l}`)).filter(Boolean);
    assert.deepEqual(
      uncovered,
      [],
      `${file} has lines outside every registered section. A rule can be revoked from anywhere in ` +
        'the file, not only from beside itself, so an unwatched span is an unwatched revocation ' +
        'site. If these lines are under a real `## ` heading, add a PINNED_BLOCKS entry for it; ' +
        'if they are not — a `#` inside a fenced code block reads as a heading to this gate and ' +
        'to `blockFor` — the fix is in the spec file, not in the table:\n' +
        uncovered.join('\n')
    );
  });
}

test('spec neighbourhood: the hash moves for all four demonstrated neighbour attacks', () => {
  // Mutation control. Without this, a table of hashes that can never go red
  // reads exactly like one that guards something. Each shape below is one the
  // 0.78.0 round-3 review ran against a full clone at exit 0.
  const lines = fs.readFileSync(CORE, 'utf8').split('\n');
  const idx = lines.indexOf('## §7 Commit and verify');
  const original = blockFor(lines, idx).text;
  const pinned = original.split('\n').findIndex(l => l.startsWith('- Say done, fixed or passing'));
  assert.ok(pinned > 0, 'the §7 block no longer carries the verify line this control uses');

  const mutate = (at, text) => {
    const copy = original.split('\n');
    copy.splice(at, 0, text);
    return copy.join('\n');
  };
  const attacks = {
    'bullet beside it': mutate(pinned + 1, '- Exception: the line above is suspended for small changes.'),
    'preamble above it': mutate(pinned, 'The bullet below is guidance, not a rule.'),
    'header over it': mutate(pinned, '### Superseded'),
    'clause appended to a NEIGHBOUR line': original.replace(
      'Push, tag and release only when asked.',
      'Push, tag and release only when asked, and the verify line below does not bind.'
    ),
  };
  for (const [name, mutated] of Object.entries(attacks)) {
    assert.notEqual(mutated, original, `the ${name} mutation did not change the text`);
    assert.notEqual(
      blockHash(mutated),
      blockHash(original),
      `the ${name} mutation left the block hash unchanged — this gate would not see it`
    );
  }
});

for (const pin of PINS) {
  test(`spec pin: ${pin.what}`, () => {
    const lines = fs.readFileSync(pin.file, 'utf8').split('\n');
    const carrying = lines.filter(l => l.includes(pin.anchor));
    assert.equal(
      carrying.length,
      1,
      `${pin.file} must carry the heading ${JSON.stringify(pin.anchor)} on exactly one line, ` +
        `found ${carrying.length}. ` +
        (carrying.length === 0
          ? 'Zero means the heading was renamed or the rule was deleted; the pin cannot be ' +
            'checked at all, which is why this assertion runs first.'
          : 'More than one means a decoy or a duplicated restatement — the pin below would then ' +
            'be checked against whichever came first.')
    );
    assert.equal(
      carrying[0],
      pin.line,
      `the pinned rule line changed in ${pin.file}.\n\nEXPECTED:\n${pin.line}\n\nFOUND:\n${carrying[0]}\n\n` +
        'This pin does not judge meaning — it reports that rule text moved. ' +
        (pin.why ? `What this line is load-bearing for: ${pin.why}\n` : '') +
        'Re-read the rule and the changelog entry named in this pin, decide whether the new ' +
        'wording still holds that property, and only then update this pin in the same commit.'
    );
  });
}

// extended §13 §0.1 caps, in bytes: the core loads every turn of every session.
// Held here since 0.123.0 retired spec-coherence-audit.js, which enforced them.
test('§0.1 caps: core ≤ 4,000 bytes, extended ≤ 12,000 bytes', () => {
  const core = fs.statSync(CORE).size;
  const ext = fs.statSync(EXT).size;
  assert.ok(core <= 4000, `${CORE} is ${core} bytes, over the 4,000 cap`);
  assert.ok(ext <= 12000, `${EXT} is ${ext} bytes, over the 12,000 cap`);
});
