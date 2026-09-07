import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    what: "core §2 LEVEL — the L1 file boundary in §1.5's own units (v6.29.0 wording)",
    file: CORE,
    anchor: "L1  ≤2 files after §1.5 pairing",
    line: "L1  ≤2 files after §1.5 pairing, LOC <80, Local-Δ only    → §7.L1",
  },
  {
    what: "core §2 LEVEL — the L2 trigger list, disjoint from L1's file count (v6.29.0 wording)",
    file: CORE,
    anchor: "L2  contract-Δ / >2 files",
    line: "L2  contract-Δ / >2 files / new test surface (new file/suite — not L1-bugfix RED, which is co-located per §1.5) / additive-schema → §7 L2 + §9",
  },
  {
    what: "core §0 Fast-Path — the L0 whitelist and the user-facing floor above it (v6.29.0 wording)",
    file: CORE,
    anchor: "**Fast-Path (L0 only)**",
    line: "**Fast-Path (L0 only)**: single-line report; user-facing text → L1 min. Whitelist: typo / formatting / internal log-string / direct plugin cmd. Comments/docstrings: pure wording → §7 L1-copy; behavior-describing → L1 (Read to confirm). Hidden risk → full SPINE.",
  },
  {
    what: "core §10 — the L1 short-report condition (v6.29.0 wording)",
    file: CORE,
    anchor: "- **L1**: Not done+Failed+Uncertain empty",
    line: "- **L1**: Not done+Failed+Uncertain empty → `Done: <what>.` Else four-section.",
  },
  {
    what: "§EXT §11-O — a subagent has nobody to ASK (v6.29.0 wording)",
    file: EXT,
    anchor: "- **A subagent has nobody to ASK**",
    line: "- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: take §0's option (b), state the chosen reading in the report, and STOP at a §5 hard-AUTH boundary — finish the authorized work, report the boundary as `[PARTIAL: <op> needs AUTH]`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.",
  },
];

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
        'This pin does not judge meaning — it reports that rule text moved. Re-read the rule and ' +
        'the v6.26.0 entry in spec/CLAUDE-changelog.md, decide whether the new wording still lets ' +
        'an orchestrating cycle yield to read what it spawned and still excepts that wait from the ' +
        'atomic ship window, and only then update this pin in the same commit.'
    );
  });
}
