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
import { hookEmittedSections as sharedEmittedSections, EMITTED_SECTION_IDIOMS } from '../lib/emitted-sections.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'spec/hard-rules.json');
const CORE_SPEC = path.join(ROOT, 'spec/CLAUDE.md');
const EXT_SPEC = path.join(ROOT, 'spec/CLAUDE-extended.md');
const HOOKS_DIR = path.join(ROOT, 'hooks');

// spec_section taxonomy — PARSED from docs/RULE-HITS-SCHEMA.md's "Spec section
// taxonomy" table, not hand-copied from it.
//
// This was a literal Set with a "keep in sync … requires the same in both"
// comment, and it covered 10 of the table's ~16 sections (§11-memory-hint,
// §13.1-extended-read, §11-post-compaction, §iron-law-2, §10-four-section-order,
// §10-honesty were all absent). It passed anyway because the assertion only ran
// manifest→Set: no manifest entry referenced the missing ones, so the gap was
// unobservable in the direction the test checked (2026-07-25 audit). Parsing the
// table removes the copy entirely. `§8` (the pre-granular fallback bucket) is
// documented inline in the taxonomy's pre-bash-safety row rather than as its own
// row, so it is added explicitly.
const KNOWN_HOOK_SECTIONS = (() => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/RULE-HITS-SCHEMA.md'), 'utf8');
  const out = new Set();
  let inTable = false;
  for (const line of doc.split('\n')) {
    if (/^\|\s*Hook\s*\|\s*Event\s*\|\s*spec_section\s*\|/.test(line)) { inTable = true; continue; }
    if (inTable && !line.startsWith('|')) break;
    if (!inTable || /^\|\s*-+/.test(line)) continue;
    const cols = line.split('|');
    if (cols.length < 4) continue;
    for (const m of cols[3].matchAll(/`(§[^`]+)`/g)) out.add(m[1]);
  }
  if (out.size === 0) throw new Error('taxonomy parse failed — table shape changed in RULE-HITS-SCHEMA.md');
  return out;
})();

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

// Extractor lives in tests/lib/emitted-sections.mjs — the single source both
// this gate and architecture-drift.test.js read (2026-08-29 audit R10-17a).
const hookEmittedSections = () => sharedEmittedSections(HOOKS_DIR);

// Sections that carry observability rows without being HARD rules in the spec:
// the memory-prompt-hint suggestion instrument and the §11-EXT mem-audit body
// scan. Both exist to MEASURE, not to enforce, so requiring a spec/hard-rules.json
// entry for them would mean inventing rules to satisfy a test.
const NON_RULE_SECTIONS = new Set([
  '§11-memory-hint',        // memory-prompt-hint suggestion instrument
  '§11-EXT-mem-audit',      // §11-EXT durable-memory body-structure scan
  '§13.1-extended-read',    // observability for extended loading, not a rule
  '§13.2-batch-review',     // operator cadence advisory (§13.2 is META, not HARD)
  '§8',                     // fallback bucket for untagged §8 hits; its granular
                            // children (§8-rm-rf-var / §8-npx / §8-curl-sh) each
                            // have their own manifest entry
  '§hooks-fail-open',       // plugin-internal observability, not a spec rule
]);

test('hard-rules-4: a rule with hook-emitted rows declares the section they land in', () => {
  // INVERTED 2026-07-25 (audit). The old assertion required self/external rules
  // to keep rule_hits_section: null, with the rationale "rule-hits.jsonl only
  // carries hook-emitted rows … until R-N8 transcript-side scan lands". R-N8
  // landed in v0.8.3 and transcript-structure-scan in v0.9.10, so five entries
  // were carrying null while hooks actively emitted under their sections —
  // §11-session-exit had 39 live rows. The consequence was not cosmetic: the
  // §13.1 demote review counts "hits in 30d" through this field, so those rules
  // computed 0 BY CONSTRUCTION and looked like dead weight. The test cemented
  // the error, so the manifest could not be corrected without changing it first.
  //
  // The real invariant: whatever a hook files rows under must be declared. A rule
  // nobody emits for stays null (Agent-only enforcement, no telemetry surface).
  const m = loadManifest();
  const emitted = hookEmittedSections();
  // For a rule with NO declared section there is nothing to join on, so the id is
  // used as the candidate section name. That is only sound while ids and section
  // names share a namespace — previously an unstated coincidence that would let a
  // future rule pass vacuously. Assert the premise instead of relying on it: every
  // declared section in the manifest must equal the id of the rule declaring it,
  // or be listed here as a deliberate exception.
  const ID_NE_SECTION = new Set([
    '§10-specificity',        // fires under the shared §10-V vocab section
    '§8.V4-sandbox-disposal',  // hook files under the shorter §8.V4
  ]);
  const namespaceBreaks = m.rules
    .filter(r => r.rule_hits_section !== null)
    .filter(r => r.rule_hits_section !== r.id && !ID_NE_SECTION.has(r.id))
    .map(r => `${r.id} → ${r.rule_hits_section}`);
  assert.deepEqual(namespaceBreaks, [],
    `rule id and rule_hits_section diverge without an ID_NE_SECTION entry:\n` +
    namespaceBreaks.map(x => `  ${x}`).join('\n') +
    `\nThe null-section check below joins on the id, so an undocumented divergence ` +
    `makes it pass vacuously.`);

  const undeclared = m.rules
    .filter(r => r.rule_hits_section === null)
    .filter(r => emitted.has(r.id))
    .map(r => ({ id: r.id, enforcement: r.enforcement }));
  assert.deepEqual(undeclared, [],
    `Manifest entries with null rule_hits_section that hooks DO emit rows for:\n` +
    undeclared.map(o => `  ${o.id} (${o.enforcement})`).join('\n') +
    `\nResolution: set rule_hits_section so §13.1 demote accounting can see the hits.`);

  // And the reverse: a declared section must be one a hook actually emits.
  const phantom = m.rules
    .filter(r => r.rule_hits_section !== null)
    .filter(r => !emitted.has(r.rule_hits_section))
    .map(r => ({ id: r.id, section: r.rule_hits_section }));
  assert.deepEqual(phantom, [],
    `Manifest entries declaring a rule_hits_section no hook emits:\n` +
    phantom.map(o => `  ${o.id} → '${o.section}'`).join('\n'));
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

test('hard-rules-7: manifest spec_version matches spec/CLAUDE.md H1 version', () => {
  // Pre-fix, the manifest's spec_version drifted to v6.11.12 while spec/CLAUDE.md
  // shipped v6.11.16 (four patch releases of compression / wording — no HARD
  // rule add/remove, so the manifest was never bumped). Both hard-rules-audit
  // and safety-coverage-audit display this field at the top of their output,
  // so users running `/claudemd-rules` saw a stale version tag for the live
  // spec. Manifests must be bumped with every spec H1 change, even when the
  // rules list is unchanged — otherwise downstream tooling reports against
  // a phantom spec.
  const m = loadManifest();
  const coreSpec = readSpec('core');
  const h1 = coreSpec.match(/^#\s*AI-CODING-SPEC\s+(v[\d.]+)/m);
  assert.ok(h1, 'spec/CLAUDE.md H1 must match `# AI-CODING-SPEC vX.Y.Z`');
  assert.equal(
    m.spec_version, h1[1],
    `manifest spec_version=${m.spec_version} drifted from spec H1=${h1[1]} — bump spec/hard-rules.json:spec_version`
  );
});

test('hard-rules-8: every hook DENY section is backed by a manifest entry', () => {
  // Reverse-completeness (SEC-2 / MANIFEST-1, 2026-07-13): hard-rules-2/3 assert
  // manifest→taxonomy and hook-entries→section, but nothing asserted hook→
  // manifest — a hook could file a blocking deny under a section that has NO
  // manifest entry, making that section invisible to /claudemd-rules §13.1
  // demote accounting. Exactly what happened to §8-curl-sh: the curl|sh gate
  // emitted `HIT_SECTIONS+=('§8-curl-sh')` and filed denies under it, but the
  // manifest (which self-describes as "every HARD rule") had no entry, so its
  // deny/bypass hits were uncounted. Enumerate the sections hooks attach to an
  // actual deny hit and require each to have a hook/both manifest entry.
  // Two idioms attach a section to a blocking deny; the completeness claim only
  // holds if BOTH are enumerated. (1) `HIT_SECTIONS+=('§…')` — pre-bash-safety
  // batches sections then emits once. (2) `hook_record <hook> <deny-verb> "<json>"
  // '§…'` — banned-vocab / memory-read-check / ship-baseline attach the section
  // directly. The original assertion parsed only (1), so a novel section reached
  // via (2) would slip past the very demote-accounting blind spot this test
  // guards. Blocking verbs only: deny / deny-repeat / deny-prose — NOT
  // deny-prose-dry-run (exits 0, files no HARD hit, needs no manifest entry).
  // WIDENED 2026-07-25 (audit): from deny-verbs only to every emitted section.
  // Scoping to deny/deny-repeat/deny-prose meant an advisory-emitting section
  // (`warn` from session-end-check under §11-session-exit, `structure-advisory`
  // under §10-four-section-order) was out of scope, which is precisely how those
  // rows stayed orphaned from the manifest while accumulating in the live log.
  // Coverage now also accepts a `self` entry: a rule can be Agent-enforced and
  // still have an observability section, which is what those five entries are.
  const denySections = hookEmittedSections();
  const m = loadManifest();
  const covered = new Set(
    m.rules.filter(r => r.rule_hits_section).map(r => r.rule_hits_section)
  );
  const uncovered = [...denySections]
    .filter(s => !covered.has(s))
    .filter(s => !NON_RULE_SECTIONS.has(s))
    .sort();
  assert.deepEqual(uncovered, [],
    `Hook deny sections with no hook/both manifest entry:\n` +
    uncovered.map(s => `  ${s} (emitted via HIT_SECTIONS+= but absent from spec/hard-rules.json)`).join('\n') +
    `\nResolution: add a manifest entry with rule_hits_section: <section> so /claudemd-rules can account its denies/bypasses.`);
});

test('hard-rules-9: §13 META partition prose matches computed manifest partition', () => {
  // 2026-07-24 audit P1-2: the §13 META line in CLAUDE-extended.md tells the
  // agent how many HARD rules exist and how many auto-block ("Today: N hook /
  // N self / N both / N external"). It drifted silently when §8-curl-sh joined
  // the manifest (22→23 rules, 6→7 hook) because tests 1-8 verify anchors and
  // coverage but nothing verified these prose COUNTS. A model reading a stale
  // "6 hook" under-counts the mechanical gate and trusts self-enforcement
  // where a hook exists. This test closes the class: parse the prose counts
  // and assert they equal the reduce-computed partition of hard-rules.json.
  const m = loadManifest();
  const ext = readSpec('extended');
  const totalM = ext.match(/partitions the (\d+) HARD rules/);
  assert.ok(totalM, 'CLAUDE-extended.md §13 META must contain "partitions the <N> HARD rules"');
  const todayM = ext.match(/Today: (\d+) hook \/ (\d+) self \/ (\d+) both \/ (\d+) external/);
  assert.ok(todayM, 'CLAUDE-extended.md §13 META must contain "Today: N hook / N self / N both / N external"');
  const tally = { hook: 0, self: 0, both: 0, external: 0 };
  for (const r of m.rules) tally[r.enforcement] += 1;
  const prose = {
    total: Number(totalM[1]),
    hook: Number(todayM[1]), self: Number(todayM[2]),
    both: Number(todayM[3]), external: Number(todayM[4]),
  };
  const actual = { total: m.rules.length, ...tally };
  assert.deepEqual(prose, actual,
    `§13 META partition prose drifted from spec/hard-rules.json — update the "partitions the N HARD rules" / "Today: …" line in CLAUDE-extended.md to: ` +
    `${actual.total} HARD rules, Today: ${actual.hook} hook / ${actual.self} self / ${actual.both} both / ${actual.external} external`);
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

// --- 2026-08-29 audit R10-17a: consumer gate for the shared extractor ------
//
// The idiom set was two verbatim copies, and the only thing holding them
// together was a comment in one of them saying they were held together. A
// third consumer written the same way would fork silently on the sixth idiom.
// Enumerate the consumers from source: any test file that spells one of the
// extractor's idioms must be the extractor itself.
test('R10-17a: no test file re-implements the emitted-sections extractor', () => {
  const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(m?js|test\.sh)$/.test(e.name)) files.push(full);
    }
  };
  walk(testsDir);

  const SHARED = path.join(testsDir, 'lib/emitted-sections.mjs');
  assert.ok(fs.existsSync(SHARED), 'tests/lib/emitted-sections.mjs is missing — the single source moved');

  const offenders = [];
  for (const f of files) {
    if (f === SHARED) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const idiom of EMITTED_SECTION_IDIOMS) {
      if (new RegExp(idiom).test(src)) { offenders.push(`${path.relative(testsDir, f)} (${idiom})`); break; }
    }
  }
  assert.deepEqual(offenders, [],
    'test file(s) spell an emitted-sections idiom instead of importing the shared extractor:\n' +
    offenders.map(o => `  ${o}`).join('\n'));
});

test('R10-17a: both consumers agree, and the extractor is not empty', () => {
  const sections = sharedEmittedSections(HOOKS_DIR);
  assert.ok(sections.size > 5,
    `extractor returned only ${sections.size} sections — parser or hook shape changed`);
  // Same object, same call: the point is that there is only one to disagree with.
  assert.deepEqual([...hookEmittedSections()].sort(), [...sections].sort());
});
