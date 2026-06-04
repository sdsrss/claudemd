// v0.7.1 R-N1 — spec ↔ banned-vocab.patterns drift test.
//
// What this catches: someone edits spec §10-V (adds/removes a banned term)
// but forgets to update hooks/banned-vocab.patterns, OR vice versa. Pre-fix,
// drift accumulated invisibly until field signal — this gate fires at CI time.
//
// Architecture: tests/fixtures/banned-vocab-canonical.json is the single
// source of truth mapping `spec term ↔ pattern regex`. The 4 tests below
// each prove one direction of correspondence:
//   1. patterns file → canonical (no orphan patterns)
//   2. canonical → patterns file (no dangling fixture entries)
//   3. spec §10-V text → canonical (no orphan spec terms)
//   4. canonical → spec §10-V text (no dangling fixture in_spec entries)
// Plus 2 schema invariants: every partial-coverage entry has exempt_reason,
// and no entry covers neither side (would be vestigial).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC_FILE = path.join(ROOT, 'spec/CLAUDE-extended.md');
const PATTERNS_FILE = path.join(ROOT, 'hooks/banned-vocab.patterns');
const CANONICAL_FILE = path.join(ROOT, 'tests/fixtures/banned-vocab-canonical.json');

function readSpecSection() {
  const text = fs.readFileSync(SPEC_FILE, 'utf8');
  const start = text.indexOf('## §10-V Banned-vocab');
  if (start < 0) throw new Error('§10-V section not found in spec/CLAUDE-extended.md — section header may have been renamed; update SPEC_FILE/anchor in this test.');
  const end = text.indexOf('\n## ', start + 1);
  return end > 0 ? text.slice(start, end) : text.slice(start);
}

// Parse spec text by extracting `**Banned ...**: "term"` shapes. Two forms:
//   "term1" / "term2"           — separate quoted blocks
//   "term1 / term2 / term3"     — single quoted block, slash-separated
function parseSpecBannedTerms() {
  const text = readSpecSection();
  const lines = text.match(/\*\*Banned[^*]+\*\*[^\n]*/g) || [];
  const terms = [];
  for (const line of lines) {
    const quoted = [...line.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    for (const block of quoted) {
      if (block.includes(' / ')) {
        for (const t of block.split(' / ')) terms.push(t.trim());
      } else {
        terms.push(block.trim());
      }
    }
  }
  return terms;
}

function parsePatterns() {
  const text = fs.readFileSync(PATTERNS_FILE, 'utf8');
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const idx = l.lastIndexOf('|');
      return l.slice(0, idx);
    });
}

function loadCanonical() {
  return JSON.parse(fs.readFileSync(CANONICAL_FILE, 'utf8'));
}

test('drift-1: every banned-vocab pattern is mapped in canonical fixture', () => {
  const patterns = parsePatterns();
  const canonical = loadCanonical();
  const canonicalPatterns = new Set(
    canonical.entries.filter(e => e.pattern).map(e => e.pattern)
  );
  const orphans = patterns.filter(p => !canonicalPatterns.has(p));
  assert.deepEqual(orphans, [],
    `Patterns in hooks/banned-vocab.patterns with no canonical mapping (drift):\n` +
    orphans.map(p => `  ${p}`).join('\n') +
    `\nResolution: add an entry to tests/fixtures/banned-vocab-canonical.json with this pattern, ` +
    `OR remove the pattern from hooks/banned-vocab.patterns.`);
});

test('drift-2: every canonical pattern entry exists in banned-vocab.patterns', () => {
  const patterns = new Set(parsePatterns());
  const canonical = loadCanonical();
  const dangling = canonical.entries
    .filter(e => e.pattern)
    .map(e => e.pattern)
    .filter(p => !patterns.has(p));
  // De-dup (multiple canonical entries may share a regex — e.g. "more efficient"
  // and "70-80% faster" both ride the same EN-ratio pattern).
  const uniqDangling = [...new Set(dangling)];
  assert.deepEqual(uniqDangling, [],
    `Canonical entries with .pattern not present in hooks/banned-vocab.patterns (drift):\n` +
    uniqDangling.map(p => `  ${p}`).join('\n') +
    `\nResolution: add the pattern to hooks/banned-vocab.patterns, OR remove from canonical.`);
});

test('drift-3: every spec §10-V banned term is mapped in canonical', () => {
  const specTerms = parseSpecBannedTerms();
  const canonical = loadCanonical();
  const canonicalTerms = new Set(
    canonical.entries.filter(e => e.in_spec).map(e => e.term)
  );
  const drift = specTerms.filter(t => !canonicalTerms.has(t));
  assert.deepEqual(drift, [],
    `Spec §10-V banned terms not in canonical fixture (drift):\n` +
    drift.map(t => `  ${t}`).join('\n') +
    `\nResolution: add to tests/fixtures/banned-vocab-canonical.json with in_spec: true.`);
});

test('drift-4: every canonical in_spec=true entry exists in spec §10-V text', () => {
  const specText = readSpecSection();
  const canonical = loadCanonical();
  const dangling = canonical.entries
    .filter(e => e.in_spec)
    .filter(e => !specText.includes(e.term))
    .map(e => e.term);
  assert.deepEqual(dangling, [],
    `Canonical in_spec entries not found verbatim in spec §10-V text (drift):\n` +
    dangling.map(t => `  ${t}`).join('\n') +
    `\nResolution: either add the term to spec §10-V, or set in_spec: false in canonical with an exempt_reason.`);
});

test('drift-5: canonical entries with partial coverage carry exempt_reason', () => {
  const canonical = loadCanonical();
  const violations = canonical.entries
    .filter(e => (!e.in_spec || !e.pattern))
    .filter(e => !e.exempt_reason)
    .map(e => e.term);
  assert.deepEqual(violations, [],
    `Canonical entries with partial spec/pattern coverage but no exempt_reason:\n` +
    violations.map(t => `  ${t}`).join('\n') +
    `\nResolution: either fully cover (in_spec: true AND pattern: <regex>) or document why one side is intentionally absent.`);
});

test('drift-6: no canonical entries cover neither spec nor pattern', () => {
  const canonical = loadCanonical();
  const both_null = canonical.entries
    .filter(e => !e.in_spec && !e.pattern)
    .map(e => e.term);
  assert.deepEqual(both_null, [],
    `Canonical entries with neither in_spec nor pattern (vestigial):\n` +
    both_null.map(t => `  ${t}`).join('\n') +
    `\nResolution: an entry must be enforced via spec, via pattern, or both. Otherwise delete.`);
});

test('drift-7 (v0.23.11): patterns file uses POSIX classes, not BSD-unsafe \\s/\\d/\\w', () => {
  // BSD/macOS grep treats \s/\d/\w as literal letters → the pattern silently
  // stops matching there (the 70% faster ratio deny never fired on macOS).
  // Patterns MUST use [[:space:]]/[[:digit:]] etc.; \b is fine (BSD-supported).
  // lint.js translates the POSIX classes back to JS \s/\d for the CLI.
  const lines = fs.readFileSync(PATTERNS_FILE, 'utf8').split('\n');
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) continue;
    const regex = line.slice(0, line.lastIndexOf('|'));
    if (/\\[sdwSDW]/.test(regex)) offenders.push(`L${i + 1}: ${line}`);
  }
  assert.deepEqual(offenders, [],
    `banned-vocab.patterns lines using BSD-unsafe GNU escapes (\\s/\\d/\\w):\n` +
    offenders.join('\n') +
    `\nResolution: replace \\s→[[:space:]], \\d→[[:digit:]], \\w→[[:alnum:]_].`);
});
