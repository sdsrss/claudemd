// v0.8.0 R-N2 — drift gate for spec/hard-rules.json.
// Mirrors R-N1's banned-vocab-canonical contract for HARD rules:
// (1) every manifest entry's section_anchor must exist verbatim in the
//     named spec file (anchor = unique-ish substring);
// (2) every "(HARD)" annotation in the spec must be reflected by a
//     manifest entry — exemptions documented inline;
// (3) every entry with rule_hits_section: <X> must point to a section
//     known to the v0.7.0 hook taxonomy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'spec/hard-rules.json');
const CORE_SPEC = path.join(ROOT, 'spec/CLAUDE.md');
const EXT_SPEC = path.join(ROOT, 'spec/CLAUDE-extended.md');

// v0.7.0 spec_section taxonomy — keep in sync with docs/RULE-HITS-SCHEMA.md
// "Spec section taxonomy" table. Updating this requires the same in both.
const KNOWN_HOOK_SECTIONS = new Set([
  '§10-V', '§7-ship-baseline', '§8', '§8-rm-rf-var', '§8-npx',
  '§11-memory-read', '§7-user-global-state', '§8.V4',
]);

// HARD spec annotations whose containing line cannot be matched by any
// manifest entry's `section_anchor` substring. There's exactly ONE such
// line in the current spec: the §12 fallback table cross-ref to the
// `sp:subagent-driven-development` skill, which mentions "(HARD)" but
// is a pointer to a HARD rule documented elsewhere — not a new rule.
//
// All other (HARD)-bearing lines ARE covered by anchor matching:
//   • §8 V1-V4 sub-rules → parent `§8-verify-before-claim` anchor matches
//     the heading "Verify-before-claim (HARD, 4 sub-rules)" line.
//   • Iron Law #1 / #2 — each has its own manifest entry.
//   • Manual-ship atomicity — its own entry.
//   • Each top-level (HARD) section heading or bold-tagged rule — own entry.
const SPEC_HARD_LINE_EXEMPTIONS = new Set([
  'sp:subagent-driven-development | main + fresh-subagent review per sub-task (HARD)',
]);

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function readSpec(scope) {
  return fs.readFileSync(scope === 'core' ? CORE_SPEC : EXT_SPEC, 'utf8');
}

test('hard-rules-1: every manifest entry section_anchor exists in named spec file', () => {
  const m = loadManifest();
  const drift = [];
  for (const r of m.rules) {
    const text = readSpec(r.scope);
    if (!text.includes(r.section_anchor)) {
      drift.push({ id: r.id, scope: r.scope, anchor: r.section_anchor });
    }
  }
  assert.deepEqual(drift, [],
    `Manifest entries whose section_anchor is not present in the named spec file:\n` +
    drift.map(d => `  ${d.id} [${d.scope}]: '${d.anchor}'`).join('\n') +
    `\nResolution: either fix the spec section header or update section_anchor in spec/hard-rules.json.`);
});

test('hard-rules-2: every rule_hits_section is in the v0.7.0 taxonomy', () => {
  const m = loadManifest();
  const orphans = m.rules
    .filter(r => r.rule_hits_section !== null)
    .filter(r => !KNOWN_HOOK_SECTIONS.has(r.rule_hits_section))
    .map(r => ({ id: r.id, section: r.rule_hits_section }));
  assert.deepEqual(orphans, [],
    `Manifest entries with rule_hits_section outside the v0.7.0 taxonomy:\n` +
    orphans.map(o => `  ${o.id}: '${o.section}'`).join('\n') +
    `\nResolution: either update KNOWN_HOOK_SECTIONS in this test (and docs/RULE-HITS-SCHEMA.md), or fix rule_hits_section in the manifest.`);
});

test('hard-rules-3: hook-enforced manifest entries have non-null rule_hits_section', () => {
  const m = loadManifest();
  const orphans = m.rules
    .filter(r => r.enforcement === 'hook' || r.enforcement === 'both')
    .filter(r => r.rule_hits_section === null)
    .map(r => r.id);
  assert.deepEqual(orphans, [],
    `Hook-enforced manifest entries missing rule_hits_section:\n` +
    orphans.map(o => `  ${o}`).join('\n') +
    `\nResolution: fill rule_hits_section so /claudemd-rules can cross-ref hits.`);
});

test('hard-rules-4: self/external-enforced entries have null rule_hits_section', () => {
  const m = loadManifest();
  const inverted = m.rules
    .filter(r => r.enforcement === 'self' || r.enforcement === 'external')
    .filter(r => r.rule_hits_section !== null)
    .map(r => ({ id: r.id, enforcement: r.enforcement, section: r.rule_hits_section }));
  assert.deepEqual(inverted, [],
    `Self/external-enforced entries with non-null rule_hits_section:\n` +
    inverted.map(o => `  ${o.id} (${o.enforcement}) → '${o.section}'`).join('\n') +
    `\nRationale: rule-hits.jsonl only carries hook-emitted rows. Non-hook enforcement should be null until R-N8 transcript-side scan lands.`);
});

test('hard-rules-5: every (HARD) annotation in the spec is covered by a manifest entry', () => {
  // For each spec, extract lines containing "(HARD". For each, check whether
  // the line text matches any manifest entry's section_anchor.
  //
  // Direction: line.includes(anchor) ONLY. The earlier two-direction OR
  // (which also accepted `anchor.includes(line[:80])`) made silent renames
  // possible — if a future spec edit shortened a heading's verbatim text
  // but the manifest still carried the longer form, the second clause
  // accepted that. Strict one-direction matching forces invariant 1
  // (anchor → spec) and invariant 5 (spec → anchor) to remain in sync.
  const m = loadManifest();
  const violations = [];
  for (const scope of ['core', 'extended']) {
    const text = readSpec(scope);
    const hardLines = text.split('\n').filter(l => /\(HARD/.test(l));
    for (const line of hardLines) {
      const trimmed = line.trim();
      const matched = m.rules.some(r => trimmed.includes(r.section_anchor));
      if (matched) continue;
      const exempt = [...SPEC_HARD_LINE_EXEMPTIONS].some(e => trimmed.includes(e));
      if (exempt) continue;
      violations.push({ scope, line: trimmed.slice(0, 120) });
    }
  }
  assert.deepEqual(violations, [],
    `Spec lines marked (HARD) with no manifest entry and no exemption:\n` +
    violations.map(v => `  [${v.scope}] ${v.line}`).join('\n') +
    `\nResolution: add a manifest entry to spec/hard-rules.json or document the exemption in SPEC_HARD_LINE_EXEMPTIONS.`);
});

test('hard-rules-6: manifest schema sanity — required fields present', () => {
  const m = loadManifest();
  const required = ['id', 'name', 'scope', 'section_anchor', 'enforcement', 'rule_hits_section', 'added_version', 'confidence', 'last_demote_review'];
  const validEnf = new Set(['hook', 'self', 'external', 'both']);
  const validConf = new Set(['high', 'medium', 'low']);
  const violations = [];
  for (const r of m.rules) {
    for (const f of required) {
      if (!(f in r)) violations.push(`${r.id || '(no-id)'}: missing field '${f}'`);
    }
    if (r.enforcement && !validEnf.has(r.enforcement)) {
      violations.push(`${r.id}: invalid enforcement '${r.enforcement}' (expected hook|self|external|both)`);
    }
    if (r.confidence && !validConf.has(r.confidence)) {
      violations.push(`${r.id}: invalid confidence '${r.confidence}' (expected high|medium|low)`);
    }
    if (!['core', 'extended'].includes(r.scope)) {
      violations.push(`${r.id}: invalid scope '${r.scope}'`);
    }
  }
  assert.deepEqual(violations, [],
    `Manifest schema violations:\n${violations.map(v => `  ${v}`).join('\n')}`);
});
