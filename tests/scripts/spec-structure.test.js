import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
// Tokenizer moved to scripts/lib/spec-routing.js when doctor.js needed the same
// §4 read against the INSTALLED spec. Two copies of this regex is the shape a
// dozen gates in this repo exist to prevent, so it has exactly one home now; the
// rules it encodes (bold-strip, list-boundary anchoring, target column only)
// live in that file's header with the orphan artefacts they were written for.
import { skillTokens, tableRows as sharedTableRows } from '../../scripts/lib/spec-routing.js';

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

test('A14: extended contains §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT anchors', () => {
  const text = fs.readFileSync(EXT, 'utf8');
  for (const anchor of ['§1.5-EXT', '§5.1-EXT', '§7-EXT', '§11-EXT']) {
    assert.ok(text.includes(anchor), `missing ${anchor} in extended`);
  }
});

test('A14: core CLAUDE.md references §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  for (const anchor of ['§1.5-EXT', '§5.1-EXT', '§7-EXT', '§11-EXT']) {
    assert.ok(text.includes(anchor), `core missing pointer to ${anchor}`);
  }
});

test('A15: MEMORY.md tag syntax described in §11 (core summary + §EXT detail)', () => {
  const coreText = fs.readFileSync(CORE, 'utf8');
  const extText = fs.readFileSync(EXT, 'utf8');
  assert.match(coreText, /MEMORY\.md/);
  // v6.11.9: detail migrated to §EXT §11-EXT MEMORY-tag-syntax; the [tag1, tag2]
  // literal is a structural copy-paste anchor and the stable sentinel — now
  // lives in extended. Core retains a one-line operational summary.
  assert.match(extText, /\[tag1, tag2\]/);
  assert.match(coreText, /tag syntax/i);
});

test('core contains §0.1 + §2.1 (unified ROUTE absorbs former §2.3 TOOLS)', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.ok(text.includes('§0.1 Core growth discipline'));
  assert.ok(text.includes('§2.1 ROUTE'));
  // v6.10.0: §2.3 TOOLS merged into §2.1; escalation block retains the substance.
  assert.match(text, /Tool escalation/);
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

test('§2.1 table contains sp:brainstorming row', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /sp:brainstorming/);
});

// v6.21.0: every §4 Routing primary must own a §12 Fallback-table row. `gs:/qa`
// had none since both tables landed in 52b65db, while §4's `ship L2` row routes
// user-facing ships at it — the gap only surfaced when a /doctor run noticed the
// skill was disabled via skillOverrides.
// Same drift class as hard-rules-9 (§13 prose counts): a table that must stay in
// sync with another table, with nothing asserting the join.
// `skillTokens` and the row reader now live in scripts/lib/spec-routing.js —
// doctor.js asks the same question of the INSTALLED spec, and a second copy of
// that regex is the drift this file's own §12 join exists to catch, one level up.
// The shared reader reports a missing heading through a callback so a non-test
// caller can degrade instead of throwing; here a missing heading must fail the
// test loudly, which is all this wrapper restores.
const tableRows = (text, startHeading, endMarker) =>
  sharedTableRows(text, startHeading, endMarker, msg => assert.fail(msg));

test('§12: every §4 Routing primary has a §12 Fallback-table row', () => {
  const text = fs.readFileSync(EXT, 'utf8');

  const covered = tableRows(text, '### Fallback table', 'Detection: first call fails')
    .flatMap(cols => skillTokens(cols[0]))
    // `/design-*` and `sp:*-code-review` are globs over a skill family
    .map(tok => new RegExp(`^${tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`));

  const routed = new Set(
    tableRows(text, '### Routing', '### Composite requests').flatMap(cols => skillTokens(cols[1])) // Primary column only; Notes are advisory
  );

  // Floors on BOTH sides, added 2026-09-01 when the tokenizer moved to
  // scripts/lib/spec-routing.js. The reach mutation for that extraction — make
  // skillTokens return nothing — left this test at 15/15 green, because "no
  // routed primary lacks a fallback row" is trivially true of an empty routed
  // set. The join had no floor, so a tokenizer that silently stopped matching
  // (a heading rename, a regex edit, a table reformat) would have reported a
  // clean join over zero skills. Counts are 24 routed / 27 covered today
  // (recounted at the 0.71.1 pre-tag review — the first draft of this comment
  // said 25, in a release whose thesis is that recounts beat carried numbers);
  // the floors sit well below that to catch a layer vanishing, not table churn.
  assert.ok(
    routed.size >= 15,
    `§4 Routing resolved only ${routed.size} primary skill(s) — the table moved or the tokenizer ` +
      'stopped matching. Refusing to report a clean §12 join over a set that short.'
  );
  assert.ok(
    covered.length >= 15,
    `§12 Fallback table resolved only ${covered.length} row token(s) — same failure, other side.`
  );

  const orphans = [...routed].filter(s => !covered.some(re => re.test(s)));
  assert.deepEqual(
    orphans,
    [],
    `§4 Routing primaries with no §12 Fallback row: ${orphans.join(', ')} — add a row to the Fallback table ` +
      'or drop the skill from §4 Routing. A routed-but-uncovered skill leaves the agent with no documented ' +
      'degradation path when it is disabled via skillOverrides or not installed.'
  );
});

// --- audit-2026-08-29 R10-15: the reverse direction, and one window ---------

test('§12: every §12 Fallback row names a skill the spec mentions elsewhere', () => {
  // The mirror of the test above, and the direction that was missing: the
  // fallback table carried a `gs:/canary` row for a skill no §4 row routes to
  // and no other passage names. A fallback for something unreachable is a
  // degradation path for a decision the agent never makes — 99 bytes of
  // instruction that can only mislead. Removed in v6.25.3; this keeps the next
  // one from settling in.
  //
  // The bar is "mentioned elsewhere in core or extended", not "is a §4 Routing
  // primary": `sp:test-driven-development`, `context7` and `gs:/document-release`
  // are legitimately reached from §2.1, §4.FULL steps and prose rather than from
  // the Routing table.
  const ext = fs.readFileSync(EXT, 'utf8');
  const core = fs.readFileSync(CORE, 'utf8');
  const rows = tableRows(ext, '### Fallback table', 'Detection: first call fails');
  assert.ok(
    rows.length >= 15,
    `vacuity guard: parsed ${rows.length} fallback rows — the table anchor moved and this gate is checking nothing`
  );

  const FALLBACK_START = ext.indexOf('### Fallback table');
  const FALLBACK_END = ext.indexOf('Detection: first call fails');
  // `Recent changes` is excluded along with the table itself. It is a
  // historical record, and a release entry NAMING the row just removed
  // ("§12's Fallback table carried a `gs:/canary` row …") counts as a mention
  // and disarms this gate. That is not hypothetical: the v6.25.3 entry did
  // exactly that, so the control run before the entry was written passed and
  // the same control against the tagged tree would have gone green — caught by
  // the pre-tag review of this release. Same line the sibling demote-window
  // test draws when it excludes the changelog from its live-text scan.
  // Anchored at a line start, not `indexOf`. §11-EXT-MEM's prose contains the
  // literal `## Recent changes` inside a sentence, so a plain indexOf has a
  // SECOND landing spot: rename the real heading and the cut silently jumps to
  // that mention, `HISTORY_START > FALLBACK_END` still holds, the assert below
  // still passes, and the release entry is back inside `elsewhere` — the exact
  // HIGH this exclusion was added to close, resurrected by a rename. Deleting
  // the heading already failed closed (indexOf → -1); renaming it did not.
  // Found by the delta re-review of this release.
  const historyMatch = ext.match(/^## Recent changes$/m);
  assert.ok(
    historyMatch,
    'the `## Recent changes` heading is gone from extended — this exclusion has nothing to cut'
  );
  const HISTORY_START = historyMatch.index;
  assert.ok(
    HISTORY_START > FALLBACK_END,
    'the `## Recent changes` heading moved above the Fallback table — this exclusion no longer cuts what it means to cut'
  );
  const elsewhere = core + ext.slice(0, FALLBACK_START) + ext.slice(FALLBACK_END, HISTORY_START);
  // Compare in `skillTokens`' normalised form on BOTH sides. The first version
  // compared a normalised `gs/canary` against raw spec prose that spells it
  // `gs:/canary`, so every row looked orphaned — 25 false positives, which is
  // the shape of a gate that would have been "fixed" by loosening it.
  const mentioned = new Set(skillTokens(elsewhere));

  const orphans = [
    ...new Set(
      rows
        .flatMap(cols => skillTokens(cols[0]))
        .filter(tok => !tok.includes('*')) // globs are families, checked by the sibling test
        .filter(tok => !mentioned.has(tok))
    ),
  ];
  assert.deepEqual(
    orphans,
    [],
    `§12 Fallback rows for skills named nowhere else in the spec: ${orphans.join(', ')} — ` +
      'either the skill lost its routing row (restore it) or the fallback row outlived what it covered (drop it).'
  );
});

test('§13.1 demote window: one number, and no cadence word standing in for it', () => {
  // hard-rules.json's `_doc` said "quarterly demote (rules with 0 hits in 90d)"
  // while OPERATOR.md §13.1 and scripts/hard-rules-audit.js both used 30d — a
  // 3× difference between the manifest's own description and the tool that reads
  // it, with a cadence word ("quarterly") doing duty for a window size. Three
  // more copies of "quarterly" had spread to the audit script's USAGE, the
  // sparkline command doc and rule-hits-parse's header.
  const LIVE = [
    'spec/hard-rules.json',
    'spec/OPERATOR.md',
    'spec/CLAUDE.md',
    'spec/CLAUDE-extended.md',
    'scripts/hard-rules-audit.js',
    'scripts/doctor.js',
    'scripts/lib/doctor-hook-tests.js',
    'scripts/lib/rule-hits-parse.js',
    'commands/claudemd-rules.md',
    'commands/claudemd-sparkline.md',
    'commands/claudemd-doctor.md',
  ];
  // The changelog and docs/ are historical records and keep their original wording.
  const offenders = LIVE.filter(f => /quarterly/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    `"quarterly" appears in live spec/tooling text: ${offenders.join(', ')}. The demote WINDOW is 30d ` +
      '(OPERATOR.md §13.1) and the review CADENCE is every 20 L2+ tasks or 30 days (§13.2). Neither is quarterly.'
  );

  const manifest = fs.readFileSync('spec/hard-rules.json', 'utf8');
  assert.match(
    JSON.parse(manifest)._doc,
    /0 hits in 30d/,
    'hard-rules.json `_doc` no longer states the 30d demote window it is the manifest for.'
  );
  const auditSrc = fs.readFileSync('scripts/hard-rules-audit.js', 'utf8');
  assert.match(
    auditSrc,
    /DEFAULT_WINDOW_DAYS\s*=\s*30\b/,
    'scripts/hard-rules-audit.js no longer defaults to the 30d window the spec text promises.'
  );
});

// --- audit-2026-08-22 P1-4: two spec-text HIGHs, both drift between files ----

test('§EXT: every phrase extended quotes as a core § clause exists in core', () => {
  // `§1 "default to writing no comments"` cited a rule core does not carry: the
  // v6.25.0 compression dropped the sentence it was quoting, and what had been
  // an EXTERNAL citation (the harness's own guidance) degraded into a dangling
  // internal reference. The spec then violated its own §8.V1 — a cited clause
  // must be verifiable — in the file that defines the rule.
  const core = fs.readFileSync(CORE, 'utf8').toLowerCase();
  const ext = fs.readFileSync(EXT, 'utf8');
  // `§<n> "<phrase>"` — an attributed quotation, not prose that merely contains
  // a quote. Case-insensitive: core sentence-cases what extended cites inline.
  const cites = [...ext.matchAll(/§[0-9][0-9.]*[A-Za-z-]*\s+"([^"]{8,120})"/g)].map(m => m[1]);
  assert.ok(
    cites.length > 0,
    'vacuity guard: extended must still quote at least one core clause, or this pattern has drifted'
  );
  const missing = cites.filter(p => !core.includes(p.toLowerCase()));
  assert.deepEqual(
    missing,
    [],
    `extended attributes these phrases to a core § that does not contain them: ${missing.map(m => JSON.stringify(m)).join(', ')}. ` +
      'Restore the clause in core, re-attribute it to its real (external) source, or drop the quotation — ' +
      'a §-attributed quote the reader cannot verify is the §8.V1 failure the spec forbids elsewhere.'
  );
});

test('§2.1 ↔ §4: core must not mandate a skill extended tells L2-additive to skip', () => {
  // core §2.1 routed L2-additive at `sp:test-driven-development RED-first` while
  // §4's feat row said `skip full sp:TDD ceremony` for the same case. L0-L2 load
  // core ONLY, so the highest-frequency routing path had two tables giving
  // opposite instructions and no join asserting either way — the §12 join above
  // runs §4→§12 only, and nothing ran core→§4.
  const core = fs.readFileSync(CORE, 'utf8');
  const ext = fs.readFileSync(EXT, 'utf8');

  const featRow = tableRows(ext, '### Routing', '### Composite requests').find(
    cols => cols[0].replace(/\*/g, '').trim() === 'feat'
  );
  assert.ok(featRow, '§4 Routing must carry a `feat` row');
  const skipped = [
    ...featRow.join(' | ').matchAll(/skip\s+(?:the\s+)?(?:full\s+)?(sp:[A-Za-z:-]+|gs:\/?[A-Za-z-]+)/gi),
  ].flatMap(m => skillTokens(m[1]));
  assert.ok(
    skipped.length > 0,
    'vacuity guard: §4 feat row must still name a skill it skips, or this join tests nothing'
  );

  const coreAdditiveRow = core.split('\n').find(l => l.startsWith('|') && /feat L2 \(additive\)/.test(l));
  assert.ok(coreAdditiveRow, 'core §2.1 must carry the `feat L2 (additive)` row');
  const coreTokens = skillTokens(coreAdditiveRow.split('|').slice(1, -1)[1] || '');

  for (const s of skipped) {
    if (!coreTokens.includes(s)) continue;
    assert.match(
      coreAdditiveRow,
      /optional|not required/i,
      `§4 tells L2-additive to skip ${s} while core §2.1 routes it there as the primary, with no optionality marker. ` +
        'L0-L2 never load extended, so core wins by default and the two tables read as opposite instructions ' +
        'on the most-travelled path. Align the wording in whichever table is wrong.'
    );
  }
});

// 2026-07-25 audit (spec HIGH-1/MEDIUM-3): content consistency was test-gated
// but LEVEL/PRECEDENCE semantics were gated by nothing — Iron Law #1 was L3 in
// core's pointer and (L2+) in extended's definition; §13 cited a §3 TRUST rank
// (project CLAUDE.md) that §3 never enumerated. These two joins close the class.

test('§7: Iron Law #1 level tag agrees between core and the extended heading', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const ext = fs.readFileSync(EXT, 'utf8');
  const extHead = ext.match(/^###\s+Iron Law #1:[^\n]*\((L\d\+?)\)/m);
  assert.ok(extHead, 'extended must carry the Iron Law #1 heading with a level tag');
  const level = extHead[1];
  const coreLines = core.split('\n').filter(l => l.includes('Iron Law #1'));
  assert.ok(coreLines.length > 0, 'core must mention Iron Law #1 (L2 agents cannot load extended)');
  for (const l of coreLines) {
    assert.ok(
      l.includes(`(${level}`),
      `every core Iron Law #1 mention must carry its ${level} tag (an L3-grouped pointer hides an L2+ rule): ${l}`
    );
  }
});

test('§3: every entity extended cites as ranked "per §3" appears in the core §3 Order line', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  const ext = fs.readFileSync(EXT, 'utf8');
  const orderLine = core.split('\n').find(l => l.startsWith('Order:'));
  assert.ok(orderLine, 'core §3 must carry the Order: enumeration line');
  // Only the RANK phrase counts ("per §3 TRUST order"), and only entities
  // BEFORE it — they are the ranked subject; text after the citation is
  // elaboration (delegation examples etc.). "per §3 stricter-reading" cites a
  // different §3 rule and is out of scope.
  const citing = ext.split('\n').filter(l => l.includes('per §3 TRUST order'));
  assert.ok(citing.length > 0, 'vacuity guard: extended must still cite the §3 rank somewhere');
  for (const line of citing) {
    const prefix = line.slice(0, line.indexOf('per §3 TRUST order'));
    for (const raw of prefix.match(/`[^`]+`/g) || []) {
      const ent = raw.replace(/`/g, '');
      assert.ok(
        orderLine.includes(ent),
        `extended cites \`${ent}\` as ranked per §3 TRUST order, but core §3 Order line never enumerates it: ${line.trim()}`
      );
    }
  }
});

test('§3 ↔ §EXT §13: core and extended agree on whether a HARD rule yields to a user', () => {
  // v0.80.0 pre-tag review, CRITICAL-1. v6.28.0's first draft of §3 User
  // relaxation said an explicit user instruction may relax any clause "except
  // the §5.1 Never-downgrade set" — which grants relaxation over every HARD rule
  // outside that ~10-item floor. Extended §13's Drift check says, unchanged,
  // `§8/HARD never yield`, and draws the equation the grant depends on: project
  // CLAUDE.md ranks WITH current-turn user.
  //
  // The two never meet, because core §2.2 forbids loading extended at L0–L2. So
  // the same instruction relaxed a HARD rule at L2 and was refused at L3, and
  // the contradiction was structurally invisible from the L2 side. This is the
  // v6.25.2 defect class exactly (core §2.1 vs extended §4 routing, CHANGELOG
  // :685), which was also closed by adding the missing join rather than by
  // trusting the two texts to be read together.
  //
  // The shipped clause scopes relaxation to DEFAULTS and excludes HARD and §5
  // AUTH. This test fails if either half of that agreement is DELETED — and
  // deletion is all a substring check catches. The v0.80.0 verification round
  // restored the contradiction byte-neutrally by APPENDING to the extended
  // line (', but core §3 User relaxation overrides that …') with the whole
  // suite green, because the core half is whole-line pinned and the extended
  // half was not. Both lines carry a whole-line pin now; this join stays as
  // the statement of WHY the two must move together, which no pin encodes.
  // Limits, stated: it asserts two verbatim clauses, not what the surrounding
  // prose means — a sentence added beside either one can still revoke it, the
  // same open neighbour case the pin block documents below.
  const core = fs.readFileSync(CORE, 'utf8');
  const ext = fs.readFileSync(EXT, 'utf8');

  const relax = core.split('\n').filter(l => l.startsWith('**User relaxation**'));
  assert.equal(relax.length, 1, 'core §3 must carry exactly one **User relaxation** line');
  assert.ok(
    relax[0].includes('HARD rules and §5 AUTH gates do NOT relax this way'),
    'core §3 User relaxation must exclude HARD rules and §5 AUTH gates from what a user instruction ' +
      'can relax. Without that exclusion it contradicts §EXT §13 `§8/HARD never yield`, and L0–L2 ' +
      'never load extended, so the agent would get opposite answers by level from one instruction.'
  );

  const drift = ext.split('\n').filter(l => l.includes('**Drift check**'));
  assert.equal(drift.length, 1, '§EXT §13 must carry exactly one **Drift check** line');
  assert.ok(
    drift[0].includes('§8/HARD never yield'),
    '§EXT §13 Drift check must still state `§8/HARD never yield` — it is the half of this ' +
      'agreement that binds project CLAUDE.md, which §3 ranks at current-turn-user level.'
  );
});

// v6.26.0: §11 turn-yield and §EXT §12 manual-ship atomicity jointly decide
// whether an orchestrating cycle can ever READ what it spawned. A subagent's
// report enters context only at turn end, so a rule forbidding turn-ending is a
// rule forbidding delivery — measured 2026-09-06 on the v0.77.0 ship as a
// 3h02m / 126-tool-call turn with zero completion notifications and a 230 ms
// post-turn flush. Both halves matter because removing EITHER restores the
// deadlock: §12's atomic window overrides the §11 trigger inside a ship, and §11
// without the trigger leaves §12's exception with nothing to permit. §12 has no
// numbered steps of its own; the review lands inside the atomic window in
// projects whose runbook orders it between the push and the tag.
//
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
    what: 'core §11 Mid-SPINE turn-yield — the four triggers and the Tell (v6.27.0 wording)',
    file: CORE,
    anchor: '**Mid-SPINE turn-yield** (HARD, all levels)',
    line: '- **Mid-SPINE turn-yield** (HARD, all levels): once a turn has executed ≥1 tool call inside an active SPINE cycle, continue planned steps through VALIDATE; `<system-reminder>` blocks (hook output, mid-turn recall) are NOT turn boundaries. **Yield only on**: `[AUTH REQUIRED]`, direction actually ambiguous, context pressure (→ `tasks/<slug>-paused.md`), or **awaiting a spawned subagent** — its report enters context only at turn end, so the yield IS the delivery (sleeping or pinging an idle agent does not deliver it): name what is awaited; completion re-invokes you with no user input; a yield still unresumed when the user next types owes `tasks/<slug>-paused.md`. "Natural-feeling" stop points are not yields; a silent mid-cycle yield followed by a next-turn "done" claim = Iron Law #2 violation. **Tell**: `继续 / next / 怎么停了 / why did you stop` after a turn that neither asked, closed (§10 format), nor named an awaited subagent = confirmed prior yield.',
  },
  {
    what: '§EXT §12 manual-ship atomicity — the second exception for an owed subagent (v6.27.0 wording)',
    file: EXT,
    anchor: '**Manual-ship atomicity (HARD, clarification)**',
    line: '**Manual-ship atomicity (HARD, clarification)**: when override applies, the manual path is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final Done-with-CI-green report. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. **Second exception**: awaiting any subagent whose report this ship needs (the pre-tag reviewer per Author ≠ reviewer above, a repair or repro spawn), whenever it was spawned — yield per core §11 naming it; its completion re-invokes the cycle, which resumes at the next step. The user\'s single ship-AUTH — per §5 "per-task, per-scope" — covers push/tag/release; do not re-litigate it one manual step at a time.',
  },
  {
    what: '§EXT §11-O subagent rules — the delivery fact and the file fallback (v6.27.0 wording)',
    file: EXT,
    anchor: '- **Output reaches main only at turn end**',
    line: "- **Output reaches main only at turn end**: inside a cycle you are blind to a subagent's report, so the default is to yield per core §11. A cycle that genuinely cannot yield names an absolute output path in the spawn prompt and polls that file; the notification channel itself is not pollable.",
  },
  {
    what: 'core §5 Hard — the eleven hard-AUTH categories and the self-enforced tag (v6.28.0 wording)',
    file: CORE,
    anchor: '**Hard** (default; HARD, self-enforced',
    line: '**Hard** (default; HARD, self-enforced — no hook checks the signal was emitted, so the Agent is the only gate): delete file/dir · migration/DB schema · CI/deploy/infra config · deps add/remove/bump (prod) · `.env`/secret/config schema · `~/.claude/settings.json` / user-global hooks / MCP config · auth/payment/crypto · cross-module refactor (≥3 Modules) · Δ-contract on public API · L3 enter implementation · NPX unknown script (§8).',
  },
  {
    what: 'core §8 Escape tokens — token and switch routes are both AUTH artifacts (v6.28.0 wording)',
    file: CORE,
    anchor: '**Escape tokens** (the `[allow-…]`',
    line: "**Escape tokens** (the `[allow-…]` / `[skip-…]` literals a hook deny advertises, plus every `DISABLE_*` kill switch and hook feature flag — the switch route is the wider one and records nothing): AUTH artifacts. A deny naming one names the USER's exit, not yours. Take one only on explicit user authorization for that command, this task; self-issuing one to clear your own deny is a §5 breach, on a §8 pattern a §8 one — under `bypassPermissions` nothing else stands there.",
  },
  {
    what: 'core §3 User relaxation — defaults yield to the user, HARD rules and §5 AUTH gates do not (v6.28.0 wording)',
    file: CORE,
    anchor: '**User relaxation**: the Order resolves',
    line: "**User relaxation**: the Order resolves *conflicts*, not permissions. Spec **defaults** — §1 language contract, §2.1 routing, ceremony in §5.1's skip-list sense — yield to an explicit user instruction, per-task, stated back in one line; stricter-reading governs where the user has not spoken about that clause. HARD rules and §5 AUTH gates do NOT relax this way: they move only through their own named channels (§5.1 `AUTONOMY_LEVEL`, `SAFE_DELETE_PATHS:`, §8.V3's on-real-repo exception), and §8 never. Outside both sets: recommend and proceed, reading stated in one line.",
  },
  {
    what: '§EXT §13 Drift check — project CLAUDE.md ranks with the user, and §8/HARD never yield (v6.28.0 wording)',
    file: EXT,
    anchor: '- **Drift check**:',
    line: '- **Drift check**: project `CLAUDE.md` ranks with current-turn user per §3 TRUST order — where the spec explicitly delegates (§5.1 AUTONOMY_LEVEL, `SAFE_DELETE_PATHS:`, `TMP_RETENTION_DAYS:`) the project file wins; §8/HARD never yield. Flag obvious contradictions only (conflicting AUTH levels, opposing TDD policy, signal-format overrides) in first reply — no full diff.',
  },
  {
    what: 'core §2 LEVEL — the L2 row, qualified by the same pairing rule as L1 (v6.29.0 wording)',
    file: CORE,
    anchor: 'L2  contract-Δ / >2 files after §1.5 pairing',
    why: 'Drop `after §1.5 pairing` and two paired files read as L1 by one row and L2 by the other — SPEC-M1 relocated rather than closed.',
    line: 'L2  contract-Δ / >2 files after §1.5 pairing / new test surface (new file/suite — not L1-bugfix RED, which is co-located per §1.5) / additive-schema → §7 L2 + §9',
  },
  {
    what: 'core §0 Fast-Path — the L0 whitelist under the user-facing floor above it (v6.29.0 wording)',
    file: CORE,
    anchor: '**Fast-Path (L0 only)**',
    why: '`internal` is what separates a log line nobody reads from a CLI error line the user does; without it a user-facing string routes to L0.',
    line: '**Fast-Path (L0 only)**: single-line report; user-facing text → L1 min. Whitelist: typo / formatting / internal log-string / direct plugin cmd. Comments/docstrings: pure wording → §7 L1-copy; behavior-describing → L1 (Read to confirm). Hidden risk → full SPINE.',
  },
  {
    what: 'core §0 — ambiguity resolution, including the subagent default (v6.29.0 wording)',
    file: CORE,
    anchor: '**Initial-prompt ambiguity**',
    why: 'The subagent half is the core-side home of §EXT §11-O; extended is not loaded at L0-L2, so deleting it here leaves a subagent no reachable rule.',
    line: '**Initial-prompt ambiguity**: multiple readings / action-vs-advice unclear / missing scope → (a) ASK once with candidates, or (b) state the chosen reading inline. Silent assumption banned. Default (a) when reversibility >10min or AUTH-relevant; (b) otherwise — and (b) always in a subagent, which has nobody to ask.',
  },
  {
    what: 'core §10 — the L1 short-report condition (v6.29.0 wording)',
    file: CORE,
    anchor: '- **L1**: Not done+Failed+Uncertain empty',
    why: 'Dropping `Not done` lets a one-line report swallow a section the four-section order exists to protect.',
    line: '- **L1**: Not done+Failed+Uncertain empty → `Done: <what>.` Else four-section.',
  },
  {
    what: 'core §10 — the L2/L3 report shape the L1 rows are bounded by (v6.29.0 wording)',
    file: CORE,
    anchor: '- **L2/L3**: four-section;',
    why: 'Unpinned, this line could be rewritten to grant L2 the one-line form, reversing the L1 pins above without touching them.',
    line: '- **L2/L3**: four-section; L3 zero-issue → single `Done:` paragraph. Format detail + auto-decisions + lessons file → §EXT §10-R.',
  },
  {
    what: 'core §1.5 — Local-Δ, the definition the L1 row now defers to (v6.29.0 wording)',
    file: CORE,
    anchor: '- **Local-Δ**:',
    why: "The L1 row points here for its file count, so widening `≤2 files` here moves L1's boundary with the pinned row untouched.",
    line: '- **Local-Δ**: ≤2 files (source + co-located test = one; co-located = test path mirrors source path); no exported-symbol / import-surface / config / schema change.',
  },
  {
    what: '§EXT §10-R — four-section applies at L2 and L3, deferring to core (v6.29.0 wording)',
    file: EXT,
    anchor: '### Full four-section',
    why: 'This heading used to grant L2 a shortcut core §10 does not; reverting it re-opens a core/extended contradiction L2 can never see.',
    line: '### Full four-section (L2 and L3 always — core §10, which is the layer that binds at L2)',
  },
  {
    what: '§EXT §10-R — the zero-issue short form is L3 only (v6.29.0 wording)',
    file: EXT,
    anchor: '**L3 zero-issue short**',
    why: 'The other half of the same repair: re-granting L2 the short form here contradicts core §10 from a file L2 does not load.',
    line: '**L3 zero-issue short** (Not done=∅, Failed=∅, Uncertain=∅): single `Done:` paragraph with evidence inline, no four-section scaffolding needed. L3 only — this heading used to grant L2 the same shortcut, and core §10 does not (audit SPEC-M4). Core wins by construction: L2 never loads this file.',
  },
  {
    what: 'core §2 LEVEL — the L1 row, whose file count lives in §1.5 Local-Δ (v6.29.0 wording)',
    file: CORE,
    anchor: 'L1  LOC <80, Local-Δ only',
    why: 'If this row regains a number, §1.5 Local-Δ stops being the single place the file count lives — the SPEC-M1 overlap returning.',
    line: 'L1  LOC <80, Local-Δ only (which bounds the file count)   → §7.L1',
  },
  {
    what: "core §0 — the two signals, including what [PARTIAL] means and §5's subagent pointer (v6.29.0 wording)",
    file: CORE,
    anchor: '- `[AUTH REQUIRED op:<what> scope:<files> risk:<why>]` — pre-exec on §5 hard',
    why: "This bullet DEFINES the signal §5's subagent clause redirects; unqualified, §3's stricter reading resolves back to emit-and-block, which is the behaviour the clause removes.",
    line: '- `[AUTH REQUIRED op:<what> scope:<files> risk:<why>]` — pre-exec on §5 hard; blocks until user confirms (subagent → §5).',
  },
  {
    what: "core §0 — the [PARTIAL] signal, which §5's subagent clause substitutes (v6.29.0 wording)",
    file: CORE,
    anchor: '- `[PARTIAL: <what-missing>]`',
    why: 'At L0-L2 this is the only definition of the signal a subagent is told to report instead of blocking.',
    line: '- `[PARTIAL: <what-missing>]` — end-of-task when evidence covers part; name the uncovered piece.',
  },
  {
    what: 'core §2.2 — the ban on loading extended below L3 (v6.29.0 wording)',
    file: CORE,
    anchor: '**L0/L1/L2**: do NOT load extended',
    why: 'Every core/extended split in this release rests on this line: the §EXT §10-R pins assert `L2 never loads this file`, and both subagent pins say the rule must live in core because of it.',
    line: "**L0/L1/L2**: do NOT load extended (targeted Read of a core-referenced §EXT section: OK at any level); wanting the full file at L2 signals re-classify to L3 — re-classify, don't load-and-continue. **How**: Read whole file at task start, before ROUTE; no per-task re-read absent compaction; post-compaction on L3/Override/ship → re-Read.",
  },
  {
    what: 'core §10 — the four-section order (v6.29.0 wording)',
    file: CORE,
    anchor: '**Four-section order (HARD)**',
    why: 'hard-rules-1 pins the ANCHOR string, not the rule body, so the body could be inverted while the manifest stayed green; the L1/L2/L3 report pins are all bounded by this order.',
    line: '**Four-section order (HARD)**: Done → Not done → Failed → Uncertain (structural; self-enforced — the Stop scan is advisory and opt-in). Prose emphasis goes to incomplete sections — Done stays terse with inline evidence.',
  },
  {
    what: "core §5 AUTH — the signal, its scope, and the subagent's in-scope non-hard bound (v6.29.0 wording)",
    file: CORE,
    anchor: '`[AUTH REQUIRED op:<what> scope:<files> risk:<why>]` blocks until user confirms',
    why: "`in-scope non-hard` carries BOTH bounds: drop `in-scope` and the same sentence's `files outside grant → re-AUTH` is contradicted; drop `non-hard` and a subagent may run a §5 Hard op.",
    line: '`[AUTH REQUIRED op:<what> scope:<files> risk:<why>]` blocks until user confirms. **Soft AUTH**: proceed, surface diff/plan inline first. Per-task, per-scope. Files outside grant → re-AUTH. **Subagent**: nobody to confirm — do the in-scope non-hard part, report `[PARTIAL: <op> needs AUTH]`, never self-authorize (§EXT §11-O).',
  },
  {
    what: "core §10 — the L1-bugfix report condition, on the L1 row's threshold and §1.5's file count (v6.29.0 wording)",
    file: CORE,
    anchor: '- **L1-bugfix**: single-line `Done:`',
    why: "Two bounds: the same threshold as the L1 row three lines up, and `(§1.5)` on the file count — read raw, source plus its co-located RED test is 2 files and this row's own default becomes unreachable.",
    line: '- **L1-bugfix**: single-line `Done:` with bugfix anchor by default; four-section when Not done/Failed/Uncertain non-empty OR scope ≥2 files (§1.5).',
  },
  {
    what: '§EXT §11-O — a subagent has nobody to ASK, on the same bound core §5 states (v6.29.0 wording)',
    file: EXT,
    anchor: '- **A subagent has nobody to ASK**',
    why: "This is the detail behind core §0 and §5; `in-scope non-hard` must match core §5 word for word or the two layers state the bound differently, which is this release's own named defect class.",
    line: "- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: take §0's option (b), state the chosen reading in the report, and STOP at a §5 hard-AUTH boundary — finish the in-scope non-hard work, report the boundary as `[PARTIAL: <op> needs AUTH]`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.",
  },
  {
    what: 'core §0 — the signal enumeration is CLOSED at two (v6.29.0 wording)',
    file: CORE,
    anchor: '**Signals (only 2)**:',
    why: "The two signal bullets are pinned as members; this line is the closure. Without it a third bracketed signal can be added byte-neutrally, which is exactly the property §EXT §5-EXT's plan-drift repair bought this release.",
    line: '**Signals (only 2)**:',
  },
  {
    what: 'core §0 — everything outside the two signals is prose (v6.29.0 wording)',
    file: CORE,
    anchor: 'Everything else = natural prose, no bracketed signals',
    why: 'The other half of the closure: flipping this clause admits new bracketed tokens while both member pins stay green.',
    line: 'Everything else = natural prose, no bracketed signals. Completion claims / level shifts / mode entry go in prose (§10 Specificity binds).',
  },
  {
    what: 'core §2.2 — the three-strike load trigger, the one L1 entry under the ban (v6.29.0 wording)',
    file: CORE,
    anchor: '- **L1-bugfix same signature 3×**',
    why: "This L1 trigger sits under a heading whose pinned sibling says L0/L1/L2 do NOT load extended; the two reconcile only through §2.2's targeted-Read parenthetical, so they must move together.",
    line: '- **L1-bugfix same signature 3×** (→ §EXT §6)',
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
// TWO LIMITS, and the first one is bigger than the first draft of this comment
// admitted (0.82.0 pre-tag review, HIGH-2 — five revoking mutations passed 57/57
// against the real spec). A block ends at the NEXT heading of any level, so what
// is watched is the 13 blocks that hold a pin, not the files: 139 of core's 246
// lines (59.1% of its bytes) and 43 of extended's 538 (15.3%). A sentence added
// under `## §1 IDENTITY`, `### §2.1 ROUTE`, `### §5.1 AUTONOMY_LEVEL` or
// `### Verify-before-claim` — none of which holds a pinned line — is not seen
// here at all, and can revoke a pinned rule two headings away. The heading
// inventory below closes the sub-case where such a section is NEW; it does not
// widen coverage of sections that already exist. Read a passing run as "no
// pinned line and no line sharing its block moved", nothing wider.
// The second limit is the line pins' own, unchanged in kind: a maintainer can
// re-bless a bad edit by updating a hash. What they cannot do is land it
// unmarked. Churn is the price and it is deliberate — `## §11 SESSION` runs to
// the end of core, so any edit in it fails this gate, and that failure is the
// prompt to re-read the pinned rules sharing the block. Hashes are the first 16
// hex of sha256 over the block's exact bytes.
const PINNED_BLOCKS = [
  { file: CORE, heading: '## §0 SPINE', sha256: '4de3e66c67259a19' },
  { file: CORE, heading: '## §1.5 GLOSSARY', sha256: '0e4a90afbc822ddd' },
  { file: CORE, heading: '## §10 REPORT', sha256: 'a1759faea2e4c7f6' },
  { file: CORE, heading: '## §11 SESSION (universal)', sha256: '9b225a811b713f24' },
  { file: CORE, heading: '## §2 LEVEL', sha256: 'eaf0b61905f98bf7' },
  { file: CORE, heading: '### §2.2 EXT LOADING', sha256: 'd42a54dbce37238f' },
  { file: CORE, heading: '## §3 TRUST', sha256: '82c66cea81fb5a86' },
  { file: CORE, heading: '## §5 AUTH', sha256: '4a9f3a3f72d514a9' },
  { file: CORE, heading: '## §8 SAFETY (immutable, never exempt)', sha256: '471529e83fb9281c' },
  { file: EXT, heading: '## §13 META (Agent-facing)', sha256: 'aed3335c80d538db' },
  {
    file: EXT,
    heading: '### Full four-section (L2 and L3 always — core §10, which is the layer that binds at L2)',
    sha256: '4981165c82541eb9',
  },
  { file: EXT, heading: '### Ship-pipeline hardening (HARD)', sha256: '148656c5d76fa1e1' },
  { file: EXT, heading: '### Subagent rules', sha256: 'b8122e6a1e0d72dd' },
];

const headingLevel = line => {
  const m = /^(#{1,6}) /.exec(line);
  return m ? m[1].length : 0;
};

/** The markdown block containing line `idx`: nearest heading → next heading of any level. */
function blockFor(lines, idx) {
  let start = idx;
  while (start >= 0 && headingLevel(lines[start]) === 0) start--;
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && headingLevel(lines[end]) === 0) end++;
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
  { file: CORE, count: 20, sha256: 'fdd8831e0ba58e73' },
  { file: EXT, count: 62, sha256: '2c2de62b8a76aeb4' },
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

for (const block of PINNED_BLOCKS) {
  test(`spec neighbourhood: ${block.heading}`, () => {
    const lines = fs.readFileSync(block.file, 'utf8').split('\n');
    // Occurrence count, not indexOf: a DUPLICATE of this heading placed at the
    // end of its own block, with a revocation under it, resolved to the first
    // occurrence and passed (0.82.0 pre-tag review, HIGH-2). Same uniqueness
    // rule the line pins below already enforce on their anchors.
    const occurrences = lines.filter(l => l === block.heading).length;
    assert.equal(
      occurrences,
      1,
      `${block.file} carries the heading ${JSON.stringify(block.heading)} ${occurrences} times. ` +
        'Two headings with the same text make the block boundary ambiguous, and the second one ' +
        'is where a revocation hides.'
    );
    const idx = lines.indexOf(block.heading);
    assert.notEqual(
      idx,
      -1,
      `${block.file} no longer carries the heading ${JSON.stringify(block.heading)} on a line of ` +
        'its own. A renamed or deleted heading moves every pinned rule under it into some other ' +
        "block, where this gate is not watching — re-point this entry at the rule's new home."
    );
    const found = blockHash(blockFor(lines, idx).text);
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

test('spec neighbourhood: every pinned line sits in a registered block', () => {
  // Self-extending: a pin added in an unregistered section fails here rather
  // than shipping with its neighbourhood unwatched. This is also the arm that
  // catches a `### Superseded` header inserted directly above a pinned line —
  // that header becomes the line's nearest heading, and it is not in the table.
  const registered = new Set(PINNED_BLOCKS.map(b => `${b.file} ${b.heading}`));
  const unregistered = [];
  for (const pin of PINS) {
    const lines = fs.readFileSync(pin.file, 'utf8').split('\n');
    const idx = lines.findIndex(l => l.includes(pin.anchor));
    if (idx === -1) continue; // the pin's own anchor-uniqueness test reports this
    const block = blockFor(lines, idx);
    const key = `${pin.file} ${block.heading}`;
    if (!registered.has(key)) unregistered.push(`${block.heading}  (holds: ${pin.what})`);
  }
  assert.deepEqual(
    [...new Set(unregistered)],
    [],
    'a pinned rule sits under a heading with no entry in PINNED_BLOCKS, so nothing watches its ' +
      'neighbours. Either the rule moved under a new heading (including one inserted above it), ' +
      'or a new pin was added without registering its block. Add the heading and its hash.'
  );
});

test('spec neighbourhood: the hash moves for all four demonstrated neighbour attacks', () => {
  // Mutation control. Without this, a table of hashes that can never go red
  // reads exactly like one that guards something. Each shape below is one the
  // 0.78.0 round-3 review ran against a full clone at exit 0.
  const lines = fs.readFileSync(CORE, 'utf8').split('\n');
  const idx = lines.indexOf('## §3 TRUST');
  const original = blockFor(lines, idx).text;
  const pinned = original.split('\n').findIndex(l => l.startsWith('**User relaxation**'));
  assert.ok(pinned > 0, 'the §3 block no longer carries the User relaxation line this control uses');

  const mutate = (at, text) => {
    const copy = original.split('\n');
    copy.splice(at, 0, text);
    return copy.join('\n');
  };
  const attacks = {
    'bullet beside it': mutate(pinned + 1, '**Relaxation exception**: the clause above is suspended.'),
    'preamble above it': mutate(pinned, 'The paragraph below is guidance, not a rule.'),
    'header over it': mutate(pinned, '### Superseded'),
    'clause appended to a NEIGHBOUR line': original.replace(
      'Schemas/specs/types: trust + verify consistency.',
      'Schemas/specs/types: trust + verify consistency, and the relaxation clause above does not bind.'
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
