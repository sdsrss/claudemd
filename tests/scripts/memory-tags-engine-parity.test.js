// The MEMORY.md tag index is parsed by TWO engines and nothing joined them
// (Round-14 audit ALG-M6): `scripts/lib/memory-tags.js#parseMemoryIndex`, which
// is what `/claudemd-doctor` reports from, and the awk matcher in
// `hooks/lib/memory-tags.sh`, which is what the §11 deny fires from. They
// disagreed on whitespace in both directions:
//
//   • JS `\s` is Unicode and awk's `[ \t\r\v\f]` is not, so an entry separated
//     from its tag block by NBSP or U+3000 parsed in JS and not in awk —
//     doctor reported a tagged entry the deny could never match, which is the
//     dangerous direction (a gate believed to cover something it does not).
//   • awk removes EVERY space inside a tag (`gsub(/ /, "", t)`), JS trimmed
//     only the edges — so `spec gate` was a live tag in doctor's output and a
//     dead one in the matcher.
//
// tests/hooks/memory-tags-parity.test.sh joins awk against the shell loop it
// replaced. This file joins the JS against awk, which is the axis that was
// missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMemoryIndex } from '../../scripts/lib/memory-tags.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(REPO_ROOT, 'hooks/lib/memory-tags.sh');

/** awk's view: the tags it reports for `file` given `haystack`. */
function awkTags(indexPath, haystack, file) {
  const r = spawnSync(
    'bash',
    ['-c', `source "$1" && memtags_match "$2" "$3"`, 'bash', LIB, indexPath, haystack],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, `memtags_match failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    const [f, tags] = line.split('\t');
    if (f === file) return tags ? tags.split(',') : [];
  }
  return [];
}

const NBSP = ' ';
const IDEOGRAPHIC_SPACE = '　';

// [line, file, expected tags in BOTH engines]
const CORPUS = [
  ['- [A](feedback_a.md) `[alpha, beta]` — ordinary backtick form', 'feedback_a.md', ['alpha', 'beta']],
  ['- [B](feedback_b.md) [gamma] — ordinary plain form', 'feedback_b.md', ['gamma']],
  ['- [C](feedback_c.md) `[ delta ]` — padded tag', 'feedback_c.md', ['delta']],
  [
    '- [D](feedback_d.md) `[spec gate, solo]` — a space INSIDE a tag is removed, not trimmed',
    'feedback_d.md',
    ['specgate', 'solo'],
  ],
  [`- [E](feedback_e.md)${NBSP}\`[epsilon]\` — NBSP separator: untagged in both`, 'feedback_e.md', []],
  [
    `- [F](feedback_f.md)${IDEOGRAPHIC_SPACE}[zeta] — U+3000 separator: untagged in both`,
    'feedback_f.md',
    [],
  ],
  ['- [G](project_g.md) — no tag block at all', 'project_g.md', []],
];

test('ALG-M6: the doctor parser and the §11 matcher agree on every whitespace shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-memtags-parity-'));
  try {
    const indexPath = path.join(dir, 'MEMORY.md');
    fs.writeFileSync(indexPath, CORPUS.map(([line]) => line).join('\n') + '\n');

    const jsEntries = new Map(parseMemoryIndex(fs.readFileSync(indexPath, 'utf8')).map(e => [e.file, e.tags]));

    // A haystack carrying every tag either engine could plausibly produce, so
    // the matcher's answer is "which tags does it HAVE", not "which matched".
    const haystack = [
      'alpha beta gamma delta specgate solo epsilon zeta',
      'spec gate', // the multi-word spelling, so a trim-only engine would hit too
    ].join(' ');

    const divergences = [];
    for (const [, file, expected] of CORPUS) {
      const js = jsEntries.get(file) || [];
      const awk = awkTags(indexPath, haystack, file);
      if (JSON.stringify(js) !== JSON.stringify(awk)) {
        divergences.push(`${file}: js=${JSON.stringify(js)} awk=${JSON.stringify(awk)}`);
      }
      assert.deepEqual(js, expected, `${file}: JS parse disagrees with the pinned expectation`);
    }
    assert.deepEqual(divergences, [], `engine divergence:\n${divergences.join('\n')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M6: the parity join is capable of failing (mutation control)', () => {
  // A join that always agrees is decoration. Re-run the NBSP shape through a
  // parser that uses JS `\s` — the pre-fix spelling — and require it to differ
  // from awk's answer on the same line.
  const line = `- [E](feedback_e.md)${NBSP}\`[epsilon]\` — NBSP separator`;
  const preFix = line.match(/.*\.md\)\s*`\[([^\]]*)\]`/);
  assert.ok(preFix, 'the pre-fix `\\s` spelling no longer parses the NBSP line — control vacuous');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-memtags-ctl-'));
  try {
    const indexPath = path.join(dir, 'MEMORY.md');
    fs.writeFileSync(indexPath, line + '\n');
    assert.deepEqual(
      awkTags(indexPath, 'epsilon', 'feedback_e.md'),
      [],
      'awk matched an NBSP-separated tag block — the divergence this test models is gone'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
