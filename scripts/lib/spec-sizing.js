// spec-sizing.js — SINGLE SOURCE for reading the spec's `**Sizing**` line.
//
// Two release gates read that one line and, until 2026-09-02, each parsed it
// with its own regex (audit R11-13a):
//
//   scripts/version-cascade-check.js  per target, tolerated the arrowless
//                                     "core 24417 bytes" form, covered
//                                     OPERATOR.md
//   scripts/spec-coherence-audit.js   one combined regex that REQUIRED the
//                                     framing "core N → N bytes …; extended
//                                     N → N bytes", ignored OPERATOR.md
//
// So one line could make one ship gate red and the other green: write the
// arrowless form and version-cascade parses it while spec-coherence reports
// HIGH "unparseable"; put `extended` before `core` and the same split appears
// with the roles reversed. That is a correctness gap in the release toolchain,
// not untidiness — the two gates disagreeing means neither answer is the
// project's answer.
//
// Consumers are enumerated and joined back to this file by
// tests/scripts/spec-sizing.test.js, so a third parser cannot appear quietly
// (feedback_extraction_needs_consumer_gate).

// ±20B, not 0: rewriting the Sizing line changes the size of the file the line
// lives in, so the claim can never be exactly self-consistent
// (feedback_spec_sizing_recursive_rewrite).
export const SIZING_TOLERANCE_BYTES = 20;

// Every target the line names. version-cascade-check checks all three;
// spec-coherence-audit checks the two it reports on. Ordering is the line's.
export const SIZING_TARGETS = [
  { name: 'core', file: 'spec/CLAUDE.md', threshold: SIZING_TOLERANCE_BYTES },
  { name: 'extended', file: 'spec/CLAUDE-extended.md', threshold: SIZING_TOLERANCE_BYTES },
  { name: 'OPERATOR.md', file: 'spec/OPERATOR.md', threshold: SIZING_TOLERANCE_BYTES },
];

// The canonical line, from spec/CLAUDE-extended.md. Returns the line text or
// null — "no Sizing line at all" is a different failure from "a Sizing line I
// could not read", and both callers report them differently.
export function findSizingLine(extendedText) {
  const m = String(extendedText ?? '').match(/^\*\*Sizing\*\*.*$/m);
  return m ? m[0] : null;
}

// One target's claim out of the line. Returns null when the target is not named.
//
//   { value,                  the post-arrow (current) byte count
//     matched,                the exact substring, for an OLD/NEW edit
//     suggestReplacement(n) } the same substring with `n` swapped in
//
// suggestReplacement exists because the Sizing line is self-referential: fixing
// it changes the number it should hold, so the fix is applied as a copy-paste
// OLD→NEW edit rather than iterated by hand (v0.21.6 P6).
export function extractSizingClaim(line, prefix) {
  const esc = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Arrowed form: "core 24417 → 24417 bytes" / "core 24417 -> 24417 bytes".
  const arrowed = new RegExp(`\\b${esc}\\s+(\\d+)\\s*(?:→|->)\\s*(\\d+)\\s*bytes`, 'i').exec(line ?? '');
  if (arrowed) {
    return {
      value: Number(arrowed[2]),
      matched: arrowed[0],
      suggestReplacement: actual => arrowed[0].replace(/(\s+(?:→|->)\s*)\d+(\s*bytes)/, `$1${actual}$2`),
    };
  }
  // Plain form: "core 24417 bytes" — no arrow, for an operator who skips the
  // diff convention. version-cascade-check has accepted this since v0.21.6;
  // spec-coherence-audit rejected it, which is the disagreement above.
  const plain = new RegExp(`\\b${esc}\\s+(\\d+)\\s*bytes`, 'i').exec(line ?? '');
  if (plain) {
    return {
      value: Number(plain[1]),
      matched: plain[0],
      suggestReplacement: actual => plain[0].replace(/\d+(\s*bytes)/, `${actual}$1`),
    };
  }
  return null;
}

// Convenience for a caller that wants the whole line resolved at once.
// Returns { line, claims: { <target>: claim|null } } or null when there is no
// Sizing line to read.
export function parseSizingLine(extendedText, targets = SIZING_TARGETS) {
  const line = findSizingLine(extendedText);
  if (line == null) return null;
  const claims = {};
  for (const t of targets) claims[t.name] = extractSizingClaim(line, t.name);
  return { line, claims };
}
