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
