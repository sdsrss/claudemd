import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { classifyTag, parseMemoryIndex, scanMemoryTags, scanMemoryIndexSizes, MEMORY_INDEX_BUDGET_BYTES } from '../../scripts/lib/memory-tags.js';

test('classifyTag: multi-word tag passes', () => {
  assert.deepEqual(classifyTag('find-references'), []);
  assert.deepEqual(classifyTag('semantic-search'), []);
  assert.deepEqual(classifyTag('memory_read'), []);
  assert.deepEqual(classifyTag('plugin-update'), []);
});

test('classifyTag: CJK / non-ASCII tag passes', () => {
  assert.deepEqual(classifyTag('升级'), []);
  assert.deepEqual(classifyTag('发版'), []);
  assert.deepEqual(classifyTag('中文叙述'), []);
  assert.deepEqual(classifyTag('改spec'), []);
});

test('classifyTag: narrow-allowlist short technical terms pass', () => {
  assert.deepEqual(classifyTag('cwd'), []);
  assert.deepEqual(classifyTag('npx'), []);
  assert.deepEqual(classifyTag('jq'), []);
  assert.deepEqual(classifyTag('gh'), []);
  assert.deepEqual(classifyTag('json'), []);
  // Case-insensitive allowlist:
  assert.deepEqual(classifyTag('CWD'), []);
  assert.deepEqual(classifyTag('JSON'), []);
});

test('classifyTag: hook trigger verbs pass (intentional tags, not FP)', () => {
  // memory-read-check.sh TRIGGER_RE verb set — tagging on these is the
  // hook's design intent. Without this allowlist sub-class the detector
  // self-FPs on legitimate ship/release/deploy tags.
  for (const tag of ['release', 'push', 'ship', 'deploy', 'publish', 'merge', 'commit', 'build']) {
    assert.deepEqual(classifyTag(tag), [], `${tag} should pass — it's a trigger verb`);
  }
});

test('classifyTag: OS / runtime narrow terms pass', () => {
  // `macos` etc. are short but topic-specific in claudemd-domain.
  for (const tag of ['macos', 'linux', 'ubuntu', 'darwin', 'node', 'python', 'rust', 'go']) {
    assert.deepEqual(classifyTag(tag), [], `${tag} should pass — narrow OS/runtime term`);
  }
});

test('classifyTag: short single-word EN tag flagged short-single-word', () => {
  const r = classifyTag('foo');
  assert.ok(r.includes('short-single-word'), `expected short-single-word in ${JSON.stringify(r)}`);
});

test('classifyTag: generic wordlist hit flagged generic-wordlist', () => {
  // 8-char single-word EN — passes length but in wordlist.
  const r = classifyTag('semantic');
  assert.ok(r.includes('generic-wordlist'), `expected generic-wordlist in ${JSON.stringify(r)}`);
  assert.ok(!r.includes('short-single-word'), `semantic is 8 chars — should NOT be short-single-word: ${JSON.stringify(r)}`);
});

test('classifyTag: short AND in wordlist → both reasons', () => {
  // 4-char single-word EN, in wordlist (cli, refs, deps, hook).
  const r = classifyTag('refs');
  assert.ok(r.includes('short-single-word'), `expected short-single-word in ${JSON.stringify(r)}`);
  assert.ok(r.includes('generic-wordlist'), `expected generic-wordlist in ${JSON.stringify(r)}`);
});

test('classifyTag: observed FPs all flagged', () => {
  // The 5 generic tags from plugin_code_graph_mcp.md that drove the
  // 2026-05-11 FP investigation.
  for (const tag of ['impact', 'refs', 'overview', 'semantic', 'deps']) {
    const r = classifyTag(tag);
    assert.ok(r.length > 0, `expected ${tag} to be flagged, got: ${JSON.stringify(r)}`);
  }
});

test('v0.9.38: design / brainstorm + 8 ship-prose words flagged', () => {
  // 2026-05-11 cutover-split ship: `design` matched "by-design housekeeping"
  // in release notes; `brainstorm` co-tagged with `design` in the same entry.
  // Plus 8 additional ship-prose words added in v0.9.38 wordlist pass.
  for (const tag of [
    'design', 'brainstorm',
    'architecture', 'behavior', 'schema', 'default',
    'pattern', 'format', 'system', 'process',
  ]) {
    const r = classifyTag(tag);
    assert.ok(r.includes('generic-wordlist'),
      `${tag} must be flagged as generic-wordlist after v0.9.38, got: ${JSON.stringify(r)}`);
  }
});

test('classifyTag: spec-compliant tags from MEMORY.md pass', () => {
  // Sample of multi-word + CJK tags currently in MEMORY.md — should all pass.
  for (const tag of [
    'plugin-root', 'hook-expansion', 'plugin-update', 'silent-noop',
    'test-fixture', 'fixture-drift', 'atomic-ship', 'spec-edit', '改spec',
    'sizing-line', 'recursive-rewrite', 'wc-c-drift', 'hook-audit',
    'spec-quote', 'partial-impl', 'sweep-prep', 'audit-tool-first',
    '四分段', '中文叙述', 'group_by', 'top-section', 'platform-lib',
    'command-v-guard', 'silent-fallthrough', 'cli-positional', 'flag-shape',
    'parse-strict', 'callgraph', 'ast-search', 'dead-code',
  ]) {
    assert.deepEqual(classifyTag(tag), [], `expected ${tag} to pass, got: ${JSON.stringify(classifyTag(tag))}`);
  }
});

test('parseMemoryIndex: backtick form', () => {
  const md = '- [Title](feedback_x.md) `[tag1, tag2-multi, 中文]` — desc\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'feedback_x.md');
  assert.deepEqual(entries[0].tags, ['tag1', 'tag2-multi', '中文']);
});

test('parseMemoryIndex: plain form (no backticks) — matches code-graph-mcp template', () => {
  const md = '- [code-graph-mcp](plugin_code_graph_mcp.md) [callgraph, impact, refs] — desc\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'plugin_code_graph_mcp.md');
  assert.deepEqual(entries[0].tags, ['callgraph', 'impact', 'refs']);
});

test('v0.23.11: parser-parity — title embedding a (foo.md) token resolves the LAST (link-target) group', () => {
  // memory-read-check.sh resolves the file with a greedy `s/.*(\(...\.md\)).*/`
  // (last match = the markdown link target). Pre-fix this used `.match()` (first
  // match) and returned `bar.md` for a title containing it, while the hook
  // enforced against `real_file.md` — a silent parser divergence.
  const md = '- [See foo (bar.md)](real_file.md) `[tag1, tag2]` — desc\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'real_file.md');
});

test('v0.32.2: blockquote prose quoting `[label]` + `(…​.md)` tokens is not a tagged entry', () => {
  // Live FP: code-graph-mcp's MEMORY.md header line
  //   > … Visible `[label]` is short; real filename is in the `(…​.md)` link — …
  // parsed as {file: '…​.md', tags: ['label']} because the backtick tag-block
  // regex was not anchored on `.md)` (the hook's sed IS anchored — parser-parity
  // divergence, same family as the v0.23.11 first-vs-last file-match fix).
  const md = '> One line per memory = router only. Visible `[label]` is short; real filename is in the `(…​.md)` link — match task keywords against filename/tags.\n' +
    '- [Real](a.md) `[real-tag-one]` — d\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'a.md');
  assert.deepEqual(entries[0].tags, ['real-tag-one']);
});

test('parseMemoryIndex: skips lines without tag block (untagged entries)', () => {
  const md = '- [Just title](file.md) — no tags here\n- [Has tags](other.md) `[tag1]` — yes\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'other.md');
});

test('parseMemoryIndex: skips header / non-entry lines', () => {
  const md = '# Memory index\n\n- [Real](a.md) `[t]` — d\n<!-- comment -->\n';
  const entries = parseMemoryIndex(md);
  assert.equal(entries.length, 1);
});

test('scanMemoryTags: integration on fixture tree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-mt-'));
  try {
    // Two project memory dirs — one clean, one with FP candidates.
    const projA = path.join(tmp, '-clean-project', 'memory');
    const projB = path.join(tmp, '-fp-project', 'memory');
    fs.mkdirSync(projA, { recursive: true });
    fs.mkdirSync(projB, { recursive: true });
    fs.writeFileSync(path.join(projA, 'MEMORY.md'),
      '# Memory index\n\n' +
      '- [Clean](feedback_clean.md) `[hook-audit, atomic-ship, 中文叙述]` — all multi-word/CJK\n'
    );
    fs.writeFileSync(path.join(projB, 'MEMORY.md'),
      '# Memory index\n\n' +
      '- [Bad](plugin_x.md) [callgraph, impact, refs, semantic, dead-code] — mix of good and FP-prone\n' +
      '- [Also bad](plugin_y.md) `[cwd, foo]` — cwd OK, foo flagged\n'
    );

    const { findings, scannedFiles } = scanMemoryTags({ rootDir: tmp });
    assert.equal(scannedFiles, 2);
    // Expected flags:
    //   plugin_x.md: impact (generic), refs (short+generic), semantic (generic)
    //   plugin_y.md: foo (short)
    // = 4 findings.
    assert.equal(findings.length, 4, `findings: ${JSON.stringify(findings, null, 2)}`);
    const flaggedTags = findings.map(f => f.tag).sort();
    assert.deepEqual(flaggedTags, ['foo', 'impact', 'refs', 'semantic']);
    // Clean project produced 0 findings.
    assert.ok(findings.every(f => !f.memDir.includes('-clean-project')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanMemoryTags: missing root dir → empty findings, no throw', () => {
  const { findings, scannedFiles } = scanMemoryTags({ rootDir: '/nonexistent/path/xyz' });
  assert.equal(findings.length, 0);
  assert.equal(scannedFiles, 0);
});

// --- v0.35.0 R2: scanMemoryIndexSizes -----------------------------------

test('scanMemoryIndexSizes: reports bytes + entry count, sorted bytes-desc', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-idxsize-'));
  try {
    const projSmall = path.join(tmp, '-proj-small', 'memory');
    const projBig = path.join(tmp, '-proj-big', 'memory');
    fs.mkdirSync(projSmall, { recursive: true });
    fs.mkdirSync(projBig, { recursive: true });
    const small = '# Memory index\n\n- [One](feedback_one.md) `[tag-a]` — desc\n';
    fs.writeFileSync(path.join(projSmall, 'MEMORY.md'), small);
    // 3 entries + padding to guarantee projBig sorts first.
    const big = '# Memory index\n\n' +
      '- [A](feedback_a.md) `[tag-b]` — desc\n' +
      '- [B](feedback_b.md) `[tag-c]` — desc\n' +
      `- [C](feedback_c.md) \`[tag-d]\` — ${'x'.repeat(200)}\n` +
      'not an entry line\n';
    fs.writeFileSync(path.join(projBig, 'MEMORY.md'), big);

    const { indexes, scannedFiles } = scanMemoryIndexSizes({ rootDir: tmp });
    assert.equal(scannedFiles, 2);
    assert.equal(indexes.length, 2);
    // Sorted bytes-desc: big first.
    assert.ok(indexes[0].memDir.includes('-proj-big'));
    assert.equal(indexes[0].entries, 3);
    assert.equal(indexes[0].bytes, Buffer.byteLength(big, 'utf8'));
    assert.equal(indexes[1].entries, 1);
    assert.equal(indexes[1].bytes, Buffer.byteLength(small, 'utf8'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanMemoryIndexSizes: budget constant flags a >12KB index', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-idxbudget-'));
  try {
    const proj = path.join(tmp, '-proj-over', 'memory');
    fs.mkdirSync(proj, { recursive: true });
    // One entry line padded past the budget — mirrors the doctor check's
    // filter (bytes > MEMORY_INDEX_BUDGET_BYTES).
    const content = `- [Fat](project_fat.md) \`[fat-tag]\` — ${'y'.repeat(MEMORY_INDEX_BUDGET_BYTES)}\n`;
    fs.writeFileSync(path.join(proj, 'MEMORY.md'), content);
    const { indexes } = scanMemoryIndexSizes({ rootDir: tmp });
    const over = indexes.filter(i => i.bytes > MEMORY_INDEX_BUDGET_BYTES);
    assert.equal(over.length, 1);
    assert.equal(over[0].entries, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanMemoryIndexSizes: missing root dir → empty, no throw', () => {
  const { indexes, scannedFiles } = scanMemoryIndexSizes({ rootDir: '/nonexistent/path/xyz' });
  assert.equal(indexes.length, 0);
  assert.equal(scannedFiles, 0);
});
