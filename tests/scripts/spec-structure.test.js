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
  assert.match(text, /Index line tag syntax/i);
  assert.match(text, /\[tag1, tag2\]/);
});

test('core contains new §0.1 + §2.3', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.ok(text.includes('§0.1 Core growth discipline'));
  assert.ok(text.includes('§2.3 TOOLS'));
});

test('core version header is v6.9.2', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  const m = text.match(/Version:\s*(\S+)/);
  assert.ok(m);
  assert.equal(m[1], '6.9.2');
});

test('changelog top entry is v6.9.2', () => {
  const text = fs.readFileSync(CL, 'utf8');
  const first = text.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  assert.ok(first);
  assert.equal(first[1], '6.9.2');
});

test('§2.1 table contains sp:brainstorming row', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /sp:brainstorming/);
});
