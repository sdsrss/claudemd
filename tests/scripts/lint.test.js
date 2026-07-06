// lint.test.js — unit tests for scripts/lib/lint.js (pure functions).
// CLI surface tests live in lint-cli.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPatterns,
  scan,
  stripIdentifiers,
  parseTranscript,
  formatHumanReadable,
  DEFAULT_PATTERNS_FILE,
} from '../../scripts/lib/lint.js';
import fs from 'node:fs';

test('readPatterns: parses production hooks/banned-vocab.patterns into entries', () => {
  const pats = readPatterns();
  assert.ok(pats.length >= 10, `expected ≥10 patterns, got ${pats.length}`);
  // Spot-check a known pattern from the high-fire region.
  const sig = pats.find(p => p.regex.includes('significantly'));
  assert.ok(sig, 'must include the \\bsignificantly\\b pattern');
  assert.equal(sig.isRatio, false);
  // Spot-check a ratio-tagged pattern (\b[0-9]+%\s+(faster|slower|...)\b).
  const ratio = pats.find(p => p.regex.includes('faster') && p.isRatio);
  assert.ok(ratio, 'must include at least one @ratio-tagged pattern');
});

test('scan: hits the obvious banned word, reports match + reason', () => {
  const hits = scan('this is significantly improved');
  assert.equal(hits.length >= 1, true);
  const sig = hits.find(h => h.match.toLowerCase() === 'significantly');
  assert.ok(sig);
  assert.match(sig.reason, /vague magnitude/);
});

test('scan: clean prose returns no hits', () => {
  const hits = scan('added pagination cursor; tests 1453 → 1490 (+2.5%)');
  assert.equal(hits.length, 0);
});

test('scan: case-insensitive matching (i flag is contract)', () => {
  const hits = scan('THIS IS SIGNIFICANTLY BETTER');
  const sig = hits.find(h => h.match.toLowerCase() === 'significantly');
  assert.ok(sig, 'uppercase must hit too');
});

test('scan: excludeRatio drops @ratio-tagged patterns', () => {
  // "70% faster" matches the @ratio pattern \b[0-9]+%\s+(faster|...)\b.
  const all = scan('the new render is 70% faster on the homepage');
  const exclRatio = scan('the new render is 70% faster on the homepage', { excludeRatio: true });
  assert.ok(all.length > exclRatio.length, 'with @ratio included, must hit; excluded, must not');
  assert.ok(all.some(h => /faster/i.test(h.match)));
  assert.ok(!exclRatio.some(h => /faster/i.test(h.match)));
});

test('scan: invalid regex in pattern silently skipped (fail-open)', () => {
  // Build a synthetic patterns array with one bad regex.
  const patterns = [
    { regex: '[unclosed', reason: 'malformed', isRatio: false },
    { regex: '\\bvalid\\b', reason: 'good', isRatio: false },
  ];
  const hits = scan('this is valid', { patterns });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'good');
});

test('parseTranscript: extracts only assistant text turns, joins blocks per turn', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'text', text: 'first part' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'text', text: 'second part' },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: 'more' } }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'text', text: 'last turn' },
    ] } }),
  ].join('\n');
  const turns = parseTranscript(jsonl);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].text, 'first part second part');
  assert.equal(turns[1].text, 'last turn');
  assert.equal(turns[0].turnIndex, 0);
  assert.equal(turns[1].turnIndex, 1);
});

test('parseTranscript: corrupt jsonl rows silently skipped', () => {
  const jsonl = [
    'not json at all',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
    '{"partial":', // truncated mid-write
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'still ok' }] } }),
  ].join('\n');
  const turns = parseTranscript(jsonl);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].text, 'ok');
  assert.equal(turns[1].text, 'still ok');
});

test('formatHumanReadable lint: clean → "OK", with hits → enumerated lines', () => {
  const ok = formatHumanReadable({ scope: 'lint', hits: [] });
  assert.match(ok, /^OK/);
  const hits = [
    { match: 'significantly', regex: '\\bsignificantly\\b', reason: 'vague', isRatio: false },
  ];
  const out = formatHumanReadable({ scope: 'lint', hits });
  assert.match(out, /1 hit/);
  assert.match(out, /significantly/);
  assert.match(out, /vague/);
});

test('formatHumanReadable audit: groups hits by turn line + index', () => {
  const turns = [
    { turnIndex: 0, line: 2, text: 'clean', hits: [] },
    { turnIndex: 1, line: 4, text: 'sig', hits: [
      { match: 'significantly', reason: 'vague magnitude', isRatio: false },
    ] },
  ];
  const out = formatHumanReadable({ scope: 'audit', turns });
  assert.match(out, /1 of 2 assistant turn/);
  assert.match(out, /line 4 \(turn #1\)/);
  assert.match(out, /significantly/);
});

test('DEFAULT_PATTERNS_FILE resolves to the production patterns file', () => {
  assert.ok(fs.existsSync(DEFAULT_PATTERNS_FILE), 'production patterns must exist');
  assert.match(DEFAULT_PATTERNS_FILE, /hooks\/banned-vocab\.patterns$/);
});

// --- stripIdentifiers + scan({sanitize}) — identifier/path FP class ----------
// A commit message naming a file/branch/backtick-identifier that embeds a
// high-fire word must NOT be flagged (\b treats -,/,. as boundaries). Ported
// from hooks/banned-vocab-check.sh v0.23.19 Path 2, extended for bare filenames.

test('stripIdentifiers: removes fenced blocks, backtick spans, slashed paths, dotted files', () => {
  assert.doesNotMatch(stripIdentifiers('see `comprehensive` flag'), /comprehensive/);
  assert.doesNotMatch(stripIdentifiers('merge docs/comprehensive-audit-2026'), /comprehensive/);
  assert.doesNotMatch(stripIdentifiers('refactor comprehensive-parser.js now'), /comprehensive/);
  assert.doesNotMatch(stripIdentifiers('```\nrobust = true\n```'), /robust/);
});

test('stripIdentifiers: preserves bare prose words and decimals (no over-strip)', () => {
  assert.match(stripIdentifiers('the coverage is comprehensive'), /comprehensive/);
  assert.match(stripIdentifiers('3.5x faster'), /3\.5x/);          // decimal survives → ratio still catchable
  assert.match(stripIdentifiers('comprehensive. Next sentence'), /comprehensive/); // sentence period, not a file
});

test('scan({sanitize}): identifier-quoted high-fire word does NOT hit (FP fix)', () => {
  assert.equal(scan('refactor comprehensive-parser.js', { sanitize: true }).length, 0);
  assert.equal(scan('merge docs/comprehensive-audit', { sanitize: true }).length, 0);
  assert.equal(scan('see `robust` flag toggling', { sanitize: true }).length, 0);
});

test('scan({sanitize}): bare-prose violation STILL hits (no false negative)', () => {
  assert.ok(scan('this is significantly faster', { sanitize: true }).some(h => h.match.toLowerCase() === 'significantly'));
  assert.ok(scan('a robust design', { sanitize: true }).some(h => h.match.toLowerCase() === 'robust'));
});

test('scan({sanitize}): baseline-less decimal ratio STILL hits (no false negative)', () => {
  // "3.5x faster" must not be swallowed by the dotted-file strip.
  assert.ok(scan('3.5x faster', { sanitize: true }).length >= 1, 'decimal ratio still flagged');
});

test('scan(): default (sanitize:false) is unchanged — identifier still hits', () => {
  // Preserves the prior contract for any non-CLI caller.
  assert.ok(scan('refactor comprehensive-parser.js').length >= 1);
});
