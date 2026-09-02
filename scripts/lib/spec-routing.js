// spec-routing.js — SINGLE SOURCE for reading skill names out of the spec's
// routing tables.
//
// Two consumers with two different questions, one parser:
//   - tests/scripts/spec-structure.test.js — "does every §4 Routing primary own a
//     §12 Fallback row?" (repo spec, at test time)
//   - scripts/doctor.js — "does this machine's INSTALLED spec route to a skill
//     this machine has switched off?" (home spec, at doctor time)
//
// The tokenizer was written for the first and hand-copying it for the second is
// the drift shape this repo keeps closing (feedback_extraction_needs_consumer_gate:
// an extraction without a gate over its consumer set drifts back). The gate lives
// in tests/scripts/spec-routing-consumers.test.js and asserts the distinctive
// regex below exists in exactly one tracked file — a private re-spelling is the
// failure, not a missing import.
//
// The parsing rules and everything they cost to learn (2026-07-24, v6.21.0):
//   - markdown bold is not part of a name: `**gs:/investigate**` must not yield
//     `investigate**`;
//   - a bare `/name` inherits the namespace of the last prefixed token in the same
//     cell, but only at a list boundary (start / space / comma), or the prose
//     `gs:/benchmark (before/after)` mints a `gs/after` skill that does not exist;
//   - only the target column is parsed — §4's Notes column carries advisory
//     mentions like `/qa: skip unless user-facing`, and scanning whole rows turns
//     those into primaries.
// Ten of the first run's twelve "orphans" were artefacts of the first two.

// Shorthand used in §4 → canonical §12 entry.
export const SKILL_ALIASES = {
  'sp/tdd': 'sp/test-driven-development',
  'sp/finishing': 'sp/finishing-a-development-branch',
};

export function skillTokens(cell) {
  const out = [];
  let ns = null;
  const text = cell.replace(/\*\*/g, '');
  const re = /(?:\b(sp|gs):\/?|(?<=^|[\s,])\/)([a-z*][a-z0-9*-]*)/gi;
  for (const m of text.matchAll(re)) {
    if (m[1]) ns = m[1].toLowerCase();
    if (!ns) continue; // bare `/x` before any namespace → not a skill
    const key = `${ns}/${m[2].toLowerCase()}`;
    out.push(SKILL_ALIASES[key] || key);
  }
  return out;
}

// Rows between a heading and an end marker, split into cells. Throws through the
// caller's assert when a heading is missing — both consumers want that loud.
export function tableRows(text, startHeading, endMarker, onMissing) {
  const start = text.indexOf(startHeading);
  if (start === -1) {
    onMissing?.(`missing heading: ${startHeading}`);
    return [];
  }
  const end = text.indexOf(endMarker, start);
  if (end === -1) {
    onMissing?.(`missing end marker after ${startHeading}: ${endMarker}`);
    return [];
  }
  return text
    .slice(start, end)
    .split('\n')
    .filter(l => l.startsWith('|') && !/^\|[\s-]+\|/.test(l) && !/^\|\s*(Request type|Missing)\s*\|/.test(l))
    .map(l => l.split('|').slice(1, -1));
}

export const ROUTING_HEADING = '### Routing';
export const ROUTING_END = '### Composite requests';

// §4 Routing primaries as a Map of token → the trigger cells that route to it.
// Column 1 only (the Primary column); column 0 is the trigger, column 2 Notes.
export function routingPrimaries(text, onMissing) {
  const primaries = new Map();
  for (const cols of tableRows(text, ROUTING_HEADING, ROUTING_END, onMissing)) {
    for (const tok of skillTokens(cols[1] ?? '')) {
      if (!primaries.has(tok)) primaries.set(tok, []);
      const trigger = (cols[0] ?? '').trim();
      if (!primaries.get(tok).includes(trigger)) primaries.get(tok).push(trigger);
    }
  }
  return primaries;
}
