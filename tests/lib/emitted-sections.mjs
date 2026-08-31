// emitted-sections.mjs — SINGLE SOURCE for "which spec_section literals do the
// hooks actually emit".
//
// This was two verbatim copies — architecture-drift.test.js and
// hard-rules-drift.test.js — five idioms each, kept in step by a comment in one
// of them claiming they were kept in step (2026-08-29 audit R10-17a). They
// agreed on the day of the audit; the sixth idiom would have been the fork,
// and the two gates ask the same question for different consumers, so a fork
// means one of them silently stops seeing a whole family of sections.
//
// Consumers are enumerated by tests/scripts/hard-rules-drift.test.js — a test
// file that scans hook sources for these idioms must call this helper rather
// than re-spell them (feedback_extraction_needs_consumer_gate).

import fs from 'node:fs';
import path from 'node:path';

// Every spec_section a hook attaches to ANY emitted row — not just blocking
// denies.
export function hookEmittedSections(hooksDir) {
  const out = new Set();
  // Include hooks/lib/*.sh: `§hooks-fail-open` is emitted from hook-common.sh,
  // and a loop over the top level alone never saw it.
  const libDir = path.join(hooksDir, 'lib');
  const files = [
    ...fs.readdirSync(hooksDir).map(f => path.join(hooksDir, f)),
    ...(fs.existsSync(libDir) ? fs.readdirSync(libDir).map(f => path.join(libDir, f)) : []),
  ];
  for (const full of files) {
    if (!path.basename(full).endsWith('.sh')) continue;
    // Join backslash line-continuations first: a multi-line hook_record call
    // puts the section argument on a later physical line, where a line-oriented
    // match cannot reach it (session-end-check spells §11-session-exit that way).
    const src = fs.readFileSync(full, 'utf8').replace(/\\\n\s*/g, ' ');
    // 1. `HIT_SECTIONS+=('§…')` — pre-bash-safety batches before a single emit.
    for (const m of src.matchAll(/HIT_SECTIONS\+=\('([^']+)'\)/g)) out.add(m[1]);
    // 2. The section argument of hook_record, which every other hook passes
    //    directly.
    for (const m of src.matchAll(/hook_record\s+\S+\s+\S+\s+.*?'(§[^']+)'/g)) out.add(m[1]);
    // 3. transcript-structure-scan tags each hit `"§section|detail"`, dedupes
    //    into SECTION_LIST, then emits with the section in a VARIABLE — so the
    //    literal-argument form above cannot see any of its sections.
    for (const m of src.matchAll(/HITS\+=\("(§[^|"]+)\|/g)) out.add(m[1]);
    // 4. A thin wrapper forwarding a literal section into hook_record
    //    (`record_section_deny '§8' …`). Missing it hid `§8`, the live fallback
    //    bucket for untagged §8 hits, from a test whose whole claim is
    //    completeness.
    for (const m of src.matchAll(/record_section_deny\s+'(§[^']+)'/g)) out.add(m[1]);
    // 5. The fail-open wrapper's own literal section.
    for (const m of src.matchAll(/rule_hits_append\s+\S+\s+\S+\s+.*?'(§[^']+)'/g)) out.add(m[1]);
  }
  return out;
}

// The idiom markers above, as source text for the consumer gate.
//
// Anchored on the SCANNING CALL (`matchAll(/<idiom>`), not on the idiom alone:
// hard-rules-drift.test.js names `HIT_SECTIONS+=` in two comments and one
// failure message, and a detector that matched those would fire on the prose
// describing the thing it guards (feedback_self_referential_marker_regex —
// this gate tripped on exactly that in its first form). A file that writes
// `matchAll(/HIT_SECTIONS` is re-implementing the extractor; a file that
// mentions the idiom in English is not.
export const EMITTED_SECTION_IDIOMS = [
  'matchAll\\(/HIT_SECTIONS',
  'matchAll\\(/record_section_deny',
  'matchAll\\(/rule_hits_append',
];
