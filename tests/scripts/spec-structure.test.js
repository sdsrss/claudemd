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

test('A15: MEMORY.md tag syntax described in §11', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /MEMORY\.md/);
  // v0.2.1: dropped `/tag syntax/i` literal-phrase match — the [tag1, tag2]
  // literal is a structural copy-paste anchor and is the stable sentinel.
  // Free-form prose around it (e.g. "Optional tag syntax" / "Index line tag
  // annotation") can drift without breaking user-facing intent.
  assert.match(text, /\[tag1, tag2\]/);
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
  assert.equal(m[1], '6.11.2');
});

test('changelog top entry is v6.11.2', () => {
  const text = fs.readFileSync(CL, 'utf8');
  const first = text.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  assert.ok(first);
  assert.equal(first[1], '6.11.2');
});

test('§2.1 table contains sp:brainstorming row', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /sp:brainstorming/);
});
