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

test('core contains §2.1; §0.1 lives with the other spec-editing rules in extended §13', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.ok(fs.readFileSync(EXT, 'utf8').includes('§0.1 Core growth discipline'));
  assert.ok(!text.includes('§0.1 Core growth discipline'));
  assert.ok(text.includes('§2.1 TOOLS'));
  // v6.10.0: §2.3 TOOLS merged into §2.1; v8.0.0 renamed §2.1 back to TOOLS
  // when the routing table it was named for had gone. The escalation clauses
  // keep their substance: look-up before guessing, impact analysis first.
  assert.match(text, /impact analysis first/);
  assert.match(text, /look it up/);
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
  const he = ext.indexOf('<!-- module:', hs);
  assert.ok(
    he > hs,
    'no module marker after `## Recent changes` — the cut would swallow the rest of extended'
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
    /with 0 fired rows, `hits\.fired`, in 30d/,
    'hard-rules.json `_doc` no longer states the 30d demote window (counted in fired rows, D#399) it is the manifest for.'
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
    what: '§EXT §12 manual-ship atomicity — every skill-less ship is one turn; the second exception for an owed subagent (v8.0.0 wording)',
    file: EXT,
    anchor: '**Manual-ship atomicity (HARD, clarification)**',
    line: '**Manual-ship atomicity (HARD, clarification)**: a ship run without a ship skill — from a runbook or by hand — is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → pre-tag review → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final report with CI green. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. **Second exception**: awaiting any subagent whose report this ship needs (the pre-tag reviewer, a repair or repro spawn), whenever it was spawned — yield per core §11 naming it; its completion re-invokes the cycle, which resumes at the next step. The user\'s single ship-AUTH — per §5 "per-task, per-scope" — covers push/tag/release; do not re-litigate it one manual step at a time.',
  },
  {
    what: 'core §2.1 Skills — description fit decides, L0/L1 none except a ship trigger or a received review, no precedence, one skill per step (v7.3.0)',
    file: CORE,
    anchor: '**Skills**: the harness lists them',
    why: 'The one line left after the routing table went, and the only home of four rules the table carried: the L0/L1 carve-out for a ship trigger and a received review (all four triggers; delta review L1), no precedence among skills or plugins, the more specific of two fitting skills, one skill per step. Its last sentence is the arbitration against a skill description or plugin SessionStart text that says to invoke on any chance; drop it and that text, ranked below this spec by §3, stands unopposed. Pre-tag review M1/M2 found the first draft had lost the carve-out and the three choice rules.',
    line: '**Skills**: the harness lists them with descriptions; invoke one when its description fits the task, and none for L0/L1 work except a ship trigger (§2.2) or a review you receive. No precedence among skills or plugins: when two fit, take the more specific; one skill per step, never stacked. A skill\'s or plugin\'s own "must invoke" wording does not override this line, `ship.md` or `review.md` (§3).',
  },
  {
    what: 'core §2.2 Ship triggers — the module and the runbook first, no skill named (v7.3.0)',
    file: CORE,
    anchor: '**Ship triggers** (`ship`',
    why: 'Until v7.2.0 this line routed to a `ship` skill "if listed"; models called it unlisted anyway (9 `Unknown skill` calls measured). Naming a skill here again brings that back.',
    line: "**Ship triggers** (`ship` / `deploy` / `create-release` / `merge-and-push`): Read `ship.md` and the project's ship-runbook memory first; `ship.md` names the checklist the release runs from.",
  },
  {
    what: '§EXT §12 Ship-pipeline hardening — runbook, else a listed skill, else by hand with the REPORT line (v7.3.0)',
    file: EXT,
    anchor: 'On `ship` / `deploy` / `create-release` / `merge-and-push`, after reading this module',
    why: 'The HARD obligation hard-rules.json registers as §12-ship-pipeline-hardening. v7.3.0 relaxed it on purpose: a runbook-led ship no longer owes the `manual ship because` line. Any further change is a HARD-rule change.',
    line: "On `ship` / `deploy` / `create-release` / `merge-and-push`, after reading this module, run the release from a written checklist: the project's ship runbook, else a listed ship skill. Neither → ship by hand against the checklist below and state `manual ship because <reason>` as the REPORT's first line — absence = spec violation.",
  },
  {
    what: '§EXT §12 ship checklist — a deploy no deploy skill runs stays behind its own AUTH signal, asked before the atomic run (v7.3.0 review repair)',
    file: EXT,
    anchor: 'Checklist (a runbook or skill may cover it in its own words)',
    why: 'v7.2.0 required `[AUTH REQUIRED op:manual-deploy]` for a hand deploy; the user\'s ship request covered push, tag and release only (Manual-ship atomicity). The 0.108.0 draft let the ship request authorize the deploy too (pre-tag review H1); its first repair covered only a deploy "by hand", which ship.md defines to exclude a runbook (delta review M1). v7.2.0 required the signal whenever no deploy skill ran, runbook or not. Asking before the atomic run keeps the AUTH stop out of Manual-ship atomicity\'s no-turn-ending window.',
    line: 'Checklist (a runbook or skill may cover it in its own words): version sites in sync, CHANGELOG entry, release notes from its top entry, the release artifact (GitHub Release vs. bare tag), CI green on the pushed SHA. Each step fails silently by hand; the REPORT line lets a reviewer audit a checklist-less ship against this list. A deploy no deploy skill runs, from a runbook or by hand, needs `[AUTH REQUIRED op:manual-deploy]` before the atomic run below starts: the ship request covers push, tag and release, not a deploy.',
  },
  {
    what: '§EXT §12 Author ≠ reviewer — independent of any review skill; no or blocked subagent is asked about, L2 reports the review as could not run, and L3 stops (v8.0.0 wording)',
    file: EXT,
    anchor: '- **Author ≠ reviewer (HARD)**',
    why: 'Both branches lived only in the removed skill routing table: its "Gated = missing" paragraph and the L3 cell "No subagent at all → L3 not executable, escalate (HARD)". Without them a missing or gated subagent reads as permission to self-review.',
    line: '- **Author ≠ reviewer (HARD)**: reviewer = fresh subagent, empty context, with or without a review skill installed. No self-review in costume. No subagent can be spawned, or a harness or tool setting blocks it → name the block and ASK once; refused or impossible → L2: report the review as could not run, naming the block; L3 not executable: escalate.',
  },
  {
    what: '§EXT §11-O subagent rules — the delivery fact and the polling fallback (v8.2.0 wording)',
    file: EXT,
    anchor: '- **Output reaches main only at turn end**',
    line: "- **Output reaches main only at turn end**: inside a cycle you are blind to a subagent's report, so the default is to yield per core §11. A cycle that genuinely cannot yield gives the spawn an output path and polls that file; the notification channel itself is not pollable.",
  },
  {
    what: '§EXT §11-O Long reports — reviews and audits spawned unnamed, the full report in the final message, no resend (v8.2.0)',
    file: EXT,
    anchor: '- **Long reports**',
    why: 'Measured 2026-10-17: a named spawn reports through an idle notification cut at 4064 chars (every 0.111.0 and 0.112.0 reviewer); an unnamed spawn\'s final message arrived whole at 35,521 chars. Drop "without a name" and reviews arrive cut; drop the no-resend clause and each ask wakes the reviewer into another completion event.',
    line: "- **Long reports**: a spawn given a `name` reports through an idle notification that the harness cuts at 4000 chars; an unnamed spawn's final message arrives whole. Spawn every review or audit without a name and ask for the full report in its final message. A named spawn's report cut anyway → ONE message asking for the rest, never for a resend; once a report has landed, send its author nothing — each message wakes it into another completion event.",
  },
  {
    what: '§EXT §12 Blind brief — what a review spawn prompt gives and withholds, and how the reviewer is spawned (v6.32.0; Long reports pointer v8.2.0)',
    file: EXT,
    anchor: '- **Blind brief**',
    why: 'Author ≠ reviewer fixes the context, not the prompt; the withhold list is what keeps the author verdict out of the review.',
    line: "- **Blind brief**: an empty context is not independence — the spawn prompt carries the author's view in. Give the artifact (commit range / paths), the contract (spec / issue / acceptance criteria) and the questions; withhold the author's rationale, its verdict (`fixed` / `correct`), earlier rounds' findings and any expected count. Author claims worth checking go in a separate `claims to falsify` list. Each finding cites file:line plus a reproducing command or quoted evidence; unexamined scope goes under `NOT CHECKED`. Spawn the reviewer without a name and ask for the whole report in its final message (§11-O Long reports). A re-review after repair is a new spawn, never a message to the reviewer who found the defect.",
  },
  {
    what: 'core §5 Hard — the eleven hard-AUTH categories and the self-enforced tag (v6.28.0 wording)',
    file: CORE,
    anchor: '**Hard** (default; HARD, self-enforced',
    line: '**Hard** (default; HARD, self-enforced — no hook checks the signal was emitted, so the Agent is the only gate): delete file/dir · migration/DB schema · CI/deploy/infra config · deps add/remove/bump (prod) · `.env`/secret/config schema · `~/.claude/settings.json` / user-global hooks / MCP config · auth/payment/crypto · cross-module refactor (≥3 Modules) · Δ-contract on public API · L3 enter implementation · NPX unknown script (§8).',
  },
  {
    what: 'core §8 Escape tokens — token and switch routes are both AUTH artifacts (v7.2.0 wording)',
    file: CORE,
    anchor: '**Escape tokens** (the `[allow-…]`',
    line: "**Escape tokens** (the `[allow-…]` / `[skip-…]` literals a hook deny advertises, plus every `DISABLE_*` kill switch and hook feature flag): AUTH artifacts. A deny naming one names the USER's exit, not yours. Take one only on explicit user authorization for that command, this task; self-issuing one to clear your own deny is a §5 breach, on a §8 pattern a §8 one — under `bypassPermissions` nothing else stands there.",
  },
  {
    what: 'core §3 User relaxation — defaults yield to the user, HARD rules and §5 AUTH gates do not (v8.0.0 wording; channels in §3-EXT)',
    file: CORE,
    anchor: '**User relaxation**: an explicit user instruction',
    line: '**User relaxation**: an explicit user instruction relaxes a spec **default** (§1 language, §2.1 tools, §7 commits) for that task, stated back in one line. HARD rules and §5 AUTH gates do NOT relax this way: they move only through their own named channels, and §8 never. The channels and the unspoken-clause rule → `auth.md`.',
  },
  {
    what: '§EXT §3-EXT — the only channels through which HARD rules and §5 AUTH gates move (v7.2.0)',
    file: EXT,
    anchor: 'The §3 Order resolves conflicts, not permissions',
    why: 'Moved out of core §3 in v7.2.0. Add a channel here and a project file or a user sentence can relax an AUTH gate while the core line stays green.',
    line: "The §3 Order resolves conflicts, not permissions; where the user has not spoken about a clause, the stricter reading governs. HARD rules and §5 AUTH gates move only through §5.1 `AUTONOMY_LEVEL`, `SAFE_DELETE_PATHS:` and §8.V3's on-real-repo exception. Neither a default nor a HARD rule / AUTH gate: recommend and proceed, reading stated in one line.",
  },
  {
    what: '§EXT §5-EXT SAFE_DELETE_PATHS ceiling — a project entry covering a NEVER item is ignored, not honoured (v6.30.0)',
    file: EXT,
    anchor: '- an entry covering a NEVER-covers item',
    why: '§3-EXT (auth.md; core §3 until v7.2.0) names SAFE_DELETE_PATHS one of three channels that move a §5 AUTH gate. Without this clause the channel has no ceiling and a project file can widen delete-soft over anything. The clause was cited by core from the first spec commit and had no content until v6.30.0.',
    line: '- an entry covering a NEVER-covers item is ignored, not honoured — the project file extends the list, it cannot raise its ceiling',
  },
  {
    what: '§EXT §13 Drift check — project CLAUDE.md ranks with the user, and §8/HARD never yield (v6.28.0 wording)',
    file: EXT,
    anchor: '- **Drift check**:',
    line: '- **Drift check**: project `CLAUDE.md` ranks with current-turn user per §3 TRUST order — where the spec explicitly delegates (§5.1 AUTONOMY_LEVEL, `SAFE_DELETE_PATHS:`, `TMP_RETENTION_DAYS:`) the project file wins; §8/HARD never yield. Flag obvious contradictions only (conflicting AUTH levels, opposing TDD policy, signal-format overrides) in first reply — no full diff.',
  },
  {
    what: 'core §2.2 — where §EXT sections live and how a module reaches context (v7.0.0 wording)',
    file: CORE,
    anchor: '`§EXT` sections live in per-phase modules',
    why: "Replaced v6.29.0's ban on loading extended below L3: every core reference to a §EXT section now resolves through this line and the index under it, and the hook that injects modules (tier 2) is what the line promises.",
    line: '`§EXT` sections live in per-phase modules under `~/.claude/spec-modules/`. A hook injects the module your prompt matches; otherwise Read the module listed here before the work it covers. `~/.claude/CLAUDE-extended.md` is their build source: do not read it whole.',
  },
  {
    what: 'core §2.2 — the three-strike trigger now names the debug module (v7.0.0 wording)',
    file: CORE,
    anchor: '- `debug.md` —',
    why: 'The one L1 entry that sends work to a module: an L1 bugfix failing with the same signature three times escalates to §6, which lives in debug.md.',
    line: '- `debug.md` — a bug, failing test or error; L1-bugfix same signature 3× (§6)',
  },
  {
    what: '§EXT §11-O — a subagent has nobody to ASK, on the same bound core §5 states (v8.0.0 wording)',
    file: EXT,
    anchor: '- **A subagent has nobody to ASK**',
    why: "This is the detail behind core §0 and §5; `in-scope non-hard` must match core §5 word for word or the two layers state the bound differently, which is this release's own named defect class.",
    line: "- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: pick a reading per §0 and state it in the report, and STOP at a §5 hard-AUTH boundary — finish the in-scope non-hard work, list the boundary under open items as `<op> needs AUTH`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.",
  },
  {
    what: "core §5 AUTH — the signal, its scope, and the subagent's in-scope non-hard bound (v8.0.0 wording)",
    file: CORE,
    anchor: '`[AUTH REQUIRED]` (§0) blocks until user confirms',
    why: "`in-scope non-hard` carries BOTH bounds: drop `in-scope` and the same sentence's `files outside grant → re-AUTH` is contradicted; drop `non-hard` and a subagent may run a §5 Hard op.",
    line: '`[AUTH REQUIRED]` (§0) blocks until user confirms. **Soft AUTH**: proceed, surface diff/plan inline first. Per-task, per-scope. Files outside grant → re-AUTH. **Subagent**: nobody to confirm — do the in-scope non-hard part, list the rest under open items as `<op> needs AUTH`, never self-authorize (`orchestrate.md`).',
  },
  {
    what: 'core §11 Mid-SPINE turn-yield — the three triggers, the named bad stops and the Tell (v8.0.0 wording)',
    file: CORE,
    anchor: '**Mid-SPINE turn-yield** (HARD, all levels)',
    line: '- **Mid-SPINE turn-yield** (HARD, all levels): once a turn has run a tool inside an active task, continue through VALIDATE; `<system-reminder>` blocks (hook output, mid-turn recall) are NOT turn boundaries. **Yield only on**: `[AUTH REQUIRED]`, a question §0 allows, or **awaiting a spawned subagent** — its report reaches you only after your turn ends, so the yield IS the delivery (sleeping or pinging an idle agent delivers nothing): name what you await; its completion re-invokes you with no user input; a yield still unresumed when the user next types owes an update of the spec file (without one, `tasks/<slug>-paused.md`). Any other stop is not a yield — a progress summary, a next step announced instead of taken; a silent mid-cycle stop followed by a next-turn "done" claim = Iron Law #2 violation. **Tell**: `继续 / next / 怎么停了 / why did you stop` after a turn that neither asked, reported (§10) nor named an awaited subagent = confirmed premature stop.',
  },
  {
    what: 'core §10 Specificity — ambiguous claims take the strict reading; no baseline goes under open items (v8.0.0 wording)',
    file: CORE,
    anchor: '- **Specificity (HARD)**',
    why: 'The tie-break exists nowhere else: core §3 stricter-reading covers only safety/AUTH ambiguity. Dropped as a why-clause in the 0.107.0 draft and caught at pre-tag review.',
    line: "- **Specificity (HARD)**: value claims about own work (perf / quality / completeness / correctness) MUST cite absolute number (p99 580ms→140ms, 12/12 tests) OR ratio+baseline (1453→1490 +2.5%). Banned: bare adjectives, hedges, baseline-less ratios. Scope: *agent's own work* (external-system framing allowed). Ambiguous → strict. **No-baseline fallback**: a numeric claim without a baseline says so under open items, NOT softener synonyms (`much / notably / clearly / markedly / 较为 / 比较`). Process-completion (commit landed / file created / config applied) V1-verified → a plain statement.",
  },
  {
    what: 'core §5.1 — AUTONOMY_LEVEL reaches only the Soft and None rows (v8.0.0 wording)',
    file: CORE,
    anchor: 'Project `CLAUDE.md` MAY set `AUTONOMY_LEVEL:',
    why: 'v8.0.0 dropped the aggressive skip-list: its two items (a single obvious option without preamble, a clear-scope bugfix without a proposal) are the default for every level now. What the line must keep is the reach: the auth.md table may move the Soft and None rows and nothing above them, which the Never-downgrade pin below states.',
    line: 'Project `CLAUDE.md` MAY set `AUTONOMY_LEVEL: aggressive | default | careful` (default = `default`); its effect on the Soft and None rows → `auth.md`.',
  },
  {
    what: 'core §5.1 Never-downgrade — every §5 Hard category, not a subset (v8.0.0)',
    file: CORE,
    anchor: '**Never-downgrade** (no level',
    why: 'v7 listed ten items and left five §5 Hard categories out, which auth.md had to patch for `aggressive` by citing the skip-list v8 removed. Listing every §5 Hard category here is what keeps a level, a project file or a user sentence from relaxing one.',
    line: '**Never-downgrade** (no level, project file or user instruction relaxes these): §8 SAFETY incl. Verify-before-claim (V1–V4), Iron Law #2, §11 Session-exit, the §7 user-global-state check, every §5 Hard category (safe-path deletes stay Soft, §5), `L3 enter`.',
  },
  {
    what: 'core §0 — the one bracketed signal, its definition and the closure (v8.0.0)',
    file: CORE,
    anchor: '**Signal (only 1)**:',
    why: 'v8 removed `[PARTIAL]`: a not-run verdict in the report says it. The closure (`Everything else = natural prose`) is in the same line, so a second bracketed token cannot be added without failing this pin; `(subagent → §5)` keeps a subagent from emitting and blocking.',
    line: '**Signal (only 1)**: `[AUTH REQUIRED op:<what> scope:<files> risk:<why>]` — pre-exec on §5 hard; blocks until user confirms (subagent → §5). Everything else = natural prose, no bracketed signals.',
  },
  {
    what: 'core §0 Ambiguity — decide and record a low-risk pick, ask a costly one after the independent work, a subagent never asks (v8.0.0)',
    file: CORE,
    anchor: '**Ambiguity**:',
    why: 'The user asked for low-risk, reversible ambiguity to be decided and written down. The ask half stays because sampling-audit H4 counted only 4 bare assents in 183 answered asks over 30 days; drop the cost condition and those asks go too. The subagent half is the core-side home of §EXT §11-O.',
    line: "**Ambiguity**: readings differ and a wrong pick is low-risk and cheap to undo → pick one, write the choice and the reason down (the spec file's decisions section, else the report's open items) and continue. A wrong pick that would waste substantial work, cannot be undone, or meets a §5 hard-AUTH boundary → ask, but first finish everything that does not depend on the answer, then put the questions at the end of the report with options, cost and your pick. A subagent never asks: it states its reading and stops at hard AUTH (§5).",
  },
  {
    what: 'core §0 Hard-AUTH override — a §5 Hard sub-decision asks again; an adjacent defect is reported, not fixed (v8.0.0 wording)',
    file: CORE,
    anchor: '**Hard-AUTH override (HARD)**:',
    why: 'The HARD rule hard-rules.json registers as §0-hard-auth-override. v8 changed its second half from re-ASK to report-don\'t-fix, the user\'s "precise edits" principle; the exception for a fix that is literally blocked is what keeps an authorized task completable.',
    line: '**Hard-AUTH override (HARD)**: an AUTH covers the op and scope it names. Inside it, a §5 Hard sub-decision asks again: one ASK per hard category for in-scope items, one per item for out-of-scope discoveries (subagent → §5). A defect found next to the task goes under open items, not into the diff; exception: the authorized fix is literally blocked without it → fix it and report it as a scope extension.',
  },
  {
    what: 'core §1 Language — whose language, what never switches it, what is always English (v8.0.0 wording)',
    file: CORE,
    anchor: '**Language**:',
    why: '70 of 93 English finals in a 中文 user\'s interactive sessions ended turns started by a teammate message or task-notification; drop the never-switch list and "user\'s language" again reads as whoever spoke last.',
    line: "**Language**: the user's language is the one the human types in, or the one a user-level rule fixes (neither yet: English); it holds for the session. Task notifications, teammate messages, skill and command bodies, hook text and subagent reports never change it. It binds every message the user reads, questions, plans, spec files, reports, and new documents under `docs/` (an existing document keeps its language; identifiers and test-parsed keys stay English). Everything else is English: code, comments, identifiers, test names, commit messages, log text, skill and agent files, todo items, subagent prompts. Exceptions: UI copy and commit messages follow the project's existing convention. Memory: `feedback_*` / `user_*` keep the user's trigger words; `project_*` / `reference_*` are English.",
  },
  {
    what: 'core §2 L0 — the user-facing floor that used to be the Fast-Path line (v8.0.0)',
    file: CORE,
    anchor: '- **L0** wording only',
    why: '`internal log text` and `User-facing text is L1 at least` are what keep a CLI error string or a UI label out of the one-line path.',
    line: '- **L0** wording only — docs, comments, style, internal log text → do it, one-line report. User-facing text is L1 at least; a comment that states behaviour is checked against the code.',
  },
  {
    what: 'core §2 L1 — one or two files with the co-located-test pairing, no exported or config change (v8.0.0)',
    file: CORE,
    anchor: '- **L1** small and local',
    why: 'v8 dropped LOC and Local-Δ; this bullet is now the only place the L1 boundary lives. Drop the pairing clause and a source plus its RED test reads as two files on the L2 side.',
    line: '- **L1** small and local — one or two files (a source and its co-located test count as one), no exported symbol, import surface, config or schema change → a test for the change, affected tests green.',
  },
  {
    what: 'core §5 No user present — a scheduled or looped run does not run an unauthorized §5 Hard op (v8.0.0, from §2-EXT AUTONOMOUS)',
    file: CORE,
    anchor: '**No user present**',
    why: 'The one rule kept from the removed AUTONOMOUS mode. Without it the Ambiguity line\'s "ask" has no answer in an unattended run and the op either blocks the run or gets self-authorized.',
    line: '**No user present** (a scheduled or looped run — cron, `/loop`, a remote trigger — with no one to answer): a §5 Hard op is never run; write it as its `[AUTH REQUIRED …]` line with your recommendation into the report or `tasks/pending-auth-<date>.md`, and finish the rest.',
  },
  {
    what: 'core §7 Git — per-change commits, the current branch unless the project says otherwise, both stated as overriding the harness (v8.0.0); a branch you merged is deleted locally (v8.1.0)',
    file: CORE,
    anchor: '**Git** (git repo, any level)',
    why: "Both the Opus 5.5 and the Fable 5.1 harness say commit only when asked and branch first. This user's repositories commit on main (517–955 commits on main in 60 days, no merges), and the release flow assumes one commit per change; drop the override clause and the harness default wins silently. The last sentence is the user's (2026-10-16): two repos kept merged local branches because nothing said to delete them. Its -d refusal clause is from the 0.110.0 pre-tag review: git also refuses some merged branches and its hint names -D, so without the clause the delete instruction plus the hint lead to a forced delete.",
    line: "**Git** (git repo, any level): each verified change is its own local commit (one logical change). Branching follows the project's convention; none stated → commit on the current branch. Push, tag and release only when asked. Both override the harness's commit-only-when-asked and branch-first defaults; project `AUTO_COMMIT: off` opts out. After you merge a branch into the main line, delete the local branch with `git branch -d`, unless the project keeps it; if `-d` refuses, keep the branch and name it under open items, never `-D`.",
  },
  {
    what: 'core §10 Report shape — when a report is owed, its heading and the three parts in order (v8.0.0; HARD ID §10-four-section-order)',
    file: CORE,
    anchor: '**Report shape (HARD)**',
    why: 'hard-rules-1 pins the anchor only, so the body could be rewritten while the manifest stayed green. transcript-structure-scan and sampling-audit parse the heading and the part names.',
    line: "**Report shape (HARD)**: a task that changed files or ran checks closes with a `## 汇报` heading (`## Report` for an English-speaking user; headings and verdicts follow the user's language) and up to three parts in this order, empty ones left out:",
  },
  {
    what: 'core §10 Report shape — the four verdicts and the pre-existing/regression split (v8.0.0)',
    file: CORE,
    anchor: '- **验证** (Verification)',
    why: 'evidence-gate suppresses on the not-run verdicts and both structure scanners require one verdict per verification line; a fifth verdict word or a reworded one breaks all three silently.',
    line: '- **验证** (Verification): one line per check, `<command or check>` → exactly one of 通过 / 失败 / 未运行 / 无法运行 (passed / failed / not run / could not run), then the numbers or the reason — a check you could not confirm is 无法运行, not a new word; failures that predate the task on a separate line from regressions you introduced.',
  },
  {
    what: 'core §10 Report shape — the one-sentence form and the override of the harness heading rule (v8.0.0)',
    file: CORE,
    anchor: 'A trivial change reports in one sentence',
    why: 'Without the override clause, the Fable 5.1 harness\'s "no headers in a message under about 500 words" decides most reports.',
    line: 'A trivial change reports in one sentence that names its check. This shape overrides any harness rule against headings in short messages.',
  },
  {
    what: '§EXT §2.S spec template — the status line the spec-status test parses (v8.0.0)',
    file: EXT,
    anchor: '状态：草稿 | 进行中 | 已完成',
    why: 'tests/scripts/spec-status-drift.test.js maps 草稿 / 进行中 / 已完成 to draft / open / done; a fourth word or a renamed one leaves a spec unjudged.',
    line: '  状态：草稿 | 进行中 | 已完成   (Status: draft | in progress | done)',
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
  { file: CORE, heading: '', sha256: '8fecf04a7c610c79' },
  { file: CORE, heading: '## §0 SPINE', sha256: '7b7a9634be2dc9b7' },
  { file: CORE, heading: '## §1 IDENTITY', sha256: 'f85ed215ca1e3fa5' },
  { file: CORE, heading: '## §1.5 GLOSSARY', sha256: '7e76d0dfa2112699' },
  { file: CORE, heading: '## §2 LEVEL', sha256: '3f593e34baa198dd' },
  { file: CORE, heading: '## §3 TRUST', sha256: '4dbd6259a8286f62' },
  { file: CORE, heading: '## §5 AUTH', sha256: '4afe5c697db7a67b' },
  { file: CORE, heading: '## §7 VALIDATE', sha256: 'f72dfd1044d79063' },
  { file: CORE, heading: '## §8 SAFETY (immutable, never exempt)', sha256: '28d607ccf56a5ac6' },
  { file: CORE, heading: '## §9 QUALITY', sha256: '3923863eceba4c45' },
  { file: CORE, heading: '## §10 REPORT', sha256: '7db962169948ef25' },
  { file: CORE, heading: '## §11 SESSION (universal)', sha256: 'dadbe6efc009e4cf' },
  { file: EXT, heading: '', sha256: 'e2f02697328e595d' },
  { file: EXT, heading: '## §3-EXT User relaxation (detail)', sha256: '18609ab31699f781' },
  { file: EXT, heading: '## §5-EXT Safe-paths whitelist (detail)', sha256: '7bf311f5bc8f6813' },
  {
    file: EXT,
    heading: '## §2-EXT Released-artifact checklist (L3 hard upgrade, core §2)',
    sha256: 'fdb6b1b5759ca2c2',
  },
  { file: EXT, heading: '## §2.S SPEC ARTIFACT', sha256: '8e461fa93acb1d8a' },
  { file: EXT, heading: '## §4 FLOW', sha256: 'c82f5c80a7f350e3' },
  { file: EXT, heading: '## §6 DEBUG', sha256: '474a96377fa1bdf9' },
  { file: EXT, heading: '## §7-EXT VALIDATE (L3)', sha256: 'a0bc0e2da432b216' },
  { file: EXT, heading: '## §10-V Banned-vocab (reference list)', sha256: '3178c89ebb3775c5' },
  { file: EXT, heading: '## §10-R COMPLETE', sha256: '023253b216dcd619' },
  { file: EXT, heading: '## 汇报', sha256: 'f46384510714a963' },
  { file: EXT, heading: '## §11-O ORCHESTRATE', sha256: '4f90ecc95d87f0bc' },
  { file: EXT, heading: '## §12 PLUGINS', sha256: 'a50532f806aabd1a' },
  { file: EXT, heading: '## §13 META (Agent-facing)', sha256: '1b8fc572dfcd738b' },
  { file: EXT, heading: '## §13.1 → `OPERATOR.md`', sha256: '782ca8de33a3d25a' },
  { file: EXT, heading: '## §13.2 HARD-rule budget (rolling, permanent)', sha256: '6b29d8ad82ccea56' },
  { file: EXT, heading: '## Appendix B — Canonical examples', sha256: 'bd6e21df70b6dbe6' },
  { file: EXT, heading: '## Recent changes', sha256: '3766d4cc9ec8c454' },
  { file: EXT, heading: '## §1.5-EXT GLOSSARY', sha256: '33de059955088778' },
  { file: EXT, heading: '## §5.1-EXT AUTONOMY_LEVEL effects (full table)', sha256: '2318cf9f54cccf37' },
  { file: EXT, heading: '## §7-EXT-TMP TMP_RETENTION policy', sha256: '442b3e9691f130fe' },
  { file: EXT, heading: '## §11-EXT Session heuristics (advisory)', sha256: '6033d7f946da6b92' },
  { file: EXT, heading: '## §11-EXT-MEM Memory operations', sha256: 'f308d065ec44ba2e' },
  { file: EXT, heading: '## §11-EXT-MAC macOS shell portability (cross-ref)', sha256: 'db65bc3272ec5aeb' },
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
  { file: CORE, count: 18, sha256: '65f3b427a78314b9' },
  { file: EXT, count: 53, sha256: 'e04879bcff9819b9' },
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
