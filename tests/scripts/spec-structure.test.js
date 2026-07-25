import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'spec/CLAUDE.md';
const EXT  = 'spec/CLAUDE-extended.md';
const CL   = 'spec/CLAUDE-changelog.md';

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

test('core version header matches current spec version', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  // v6.10.0: header is "# AI-CODING-SPEC vX.Y.Z — Core" (no standalone `Version:` line).
  const m = text.match(/AI-CODING-SPEC v(\d+\.\d+\.\d+)\s+—\s+Core/);
  assert.ok(m, 'core header must declare semver version inline');
  assert.equal(m[1], '6.21.0');
});

test('changelog top entry is v6.21.0', () => {
  const text = fs.readFileSync(CL, 'utf8');
  const first = text.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  assert.ok(first);
  assert.equal(first[1], '6.21.0');
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
const SKILL_ALIASES = {                      // shorthand used in §4 → canonical §12 entry
  'sp/tdd': 'sp/test-driven-development',
  'sp/finishing': 'sp/finishing-a-development-branch',
};

// Tokens are `<ns>/<name>`; a bare `/name` inherits the namespace of the last
// prefixed token in the same cell (`gs:/freeze, /guard, /retro` → all gs). The
// bare form only counts at a list boundary (start / space / comma) so prose like
// `gs:/benchmark (before/after)` does not mint a `gs/after` skill.
function skillTokens(cell) {
  const out = [];
  let ns = null;
  const text = cell.replace(/\*\*/g, '');    // markdown bold is not part of the name
  const re = /(?:\b(sp|gs):\/?|(?<=^|[\s,])\/)([a-z*][a-z0-9*-]*)/gi;
  for (const m of text.matchAll(re)) {
    if (m[1]) ns = m[1].toLowerCase();
    if (!ns) continue;                       // bare `/x` before any namespace → not a skill
    const key = `${ns}/${m[2].toLowerCase()}`;
    out.push(SKILL_ALIASES[key] || key);
  }
  return out;
}

function tableRows(text, startHeading, endMarker) {
  const start = text.indexOf(startHeading);
  assert.ok(start !== -1, `missing heading: ${startHeading}`);
  const end = text.indexOf(endMarker, start);
  assert.ok(end !== -1, `missing end marker after ${startHeading}: ${endMarker}`);
  return text.slice(start, end).split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s-]+\|/.test(l) && !/^\|\s*(Request type|Missing)\s*\|/.test(l))
    .map((l) => l.split('|').slice(1, -1));
}

test('§12: every §4 Routing primary has a §12 Fallback-table row', () => {
  const text = fs.readFileSync(EXT, 'utf8');

  const covered = tableRows(text, '### Fallback table', 'Detection: first call fails')
    .flatMap((cols) => skillTokens(cols[0]))
    // `/design-*` and `sp:*-code-review` are globs over a skill family
    .map((tok) => new RegExp(`^${tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`));

  const routed = new Set(
    tableRows(text, '### Routing', '### Composite requests')
      .flatMap((cols) => skillTokens(cols[1])),   // Primary column only; Notes are advisory
  );

  const orphans = [...routed].filter((s) => !covered.some((re) => re.test(s)));
  assert.deepEqual(orphans, [],
    `§4 Routing primaries with no §12 Fallback row: ${orphans.join(', ')} — add a row to the Fallback table `
    + 'or drop the skill from §4 Routing. A routed-but-uncovered skill leaves the agent with no documented '
    + 'degradation path when it is disabled via skillOverrides or not installed.');
});
