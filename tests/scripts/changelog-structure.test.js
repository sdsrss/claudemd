// CHANGELOG.md is the GitHub release body: the ship runbook's step 9 is
// `gh release create --notes-file <the top entry>`. It is therefore shipped
// prose, and until 0.82.0 nothing read it for structure.
//
// The defect that produced this file: the 0.82.0 entry was spliced in with a
// JavaScript `String.replace(pattern, replacementString)`, and in a replacement
// STRING the two-character token `$\`` means "the input before the match". The
// entry's own prose contains the literal sequence `` `$` `` twice, so each one
// pasted a 964-byte copy of the file's header into the middle of a sentence.
// Two sentences shipped cut in half and `## Versioning policy` appeared three
// times; `claudemd-lint lint --file`, the whole node suite and `run-all.sh` were
// all green, because none of them reads the changelog. Same class as
// `feedback_ere_widening_shifts_backrefs` — a metacharacter on the REPLACEMENT
// side, not the pattern side. (The fix for the splice itself: pass a function,
// or escape `$` as `$$`, or do the edit in a language without that rule.)
//
// These are three greps. They would have caught it at commit time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CL = 'CHANGELOG.md';
const read = () => fs.readFileSync(CL, 'utf8');
const countMatches = (text, re) => (text.match(re) || []).length;

test('CHANGELOG: exactly one document title and one policy section', () => {
  const text = read();
  assert.equal(
    countMatches(text, /^# Changelog$/gm),
    1,
    'CHANGELOG.md must carry its H1 exactly once — more than one means a copy of the file ' +
      'header was pasted into the body, which is how a release entry gets cut in half.'
  );
  assert.equal(
    countMatches(text, /^## Versioning policy/gm),
    1,
    'CHANGELOG.md must carry the versioning-policy heading exactly once.'
  );
});

/** The text of the top release entry, from its `## [x.y.z]` to the next one. */
function topEntry(text) {
  const re = /^## \[\d+\.\d+\.\d+\]/gm;
  const first = re.exec(text);
  assert.ok(first, 'CHANGELOG.md has no `## [x.y.z]` release entry');
  const second = re.exec(text);
  return text.slice(first.index, second ? second.index : text.length);
}

test('CHANGELOG: the top release entry contains no foreign H2', () => {
  const entry = topEntry(read());
  const headings = entry.split('\n').filter(l => /^## /.test(l));
  assert.deepEqual(
    headings.slice(1),
    [],
    'the top release entry contains an H2 other than its own heading:\n' +
      headings.slice(1).join('\n') +
      '\nAn entry is one section. A second H2 inside it means text was spliced in — check ' +
      'whether the surrounding sentences are still whole.'
  );
});

test('CHANGELOG: no long line of the top entry is repeated anywhere in the file', () => {
  // The three checks above are walked past by the SIBLING metacharacter of the
  // bug they were written for (0.82.0 pre-tag review round 2, MEDIUM-1). In a
  // JS replacement string `$` + backtick is "the input before the match" — that
  // is what shipped — and `$` + `'` is "the input AFTER it". Same prose, same
  // splice, other direction: the file's TAIL lands mid-sentence, and because the
  // injected tail carries a `## [x.y.z]` of its own, `topEntry` below stops at it
  // and the foreign-H2 scan only ever sees the truncated prefix. Splicing a copy
  // of an older entry does the same.
  //
  // Duplication is what all three shapes have in common, whatever the mechanism:
  // a splice pastes text the file already contains. Long lines only, and scoped
  // to the top entry, because one long line legitimately repeats across two older
  // entries — file-wide this would need a baseline, and a check that needs a
  // baseline is a check that gets updated instead of read.
  const text = read();
  const entry = topEntry(text);
  const rest = text.replace(entry, '');
  const offenders = [];
  for (const line of entry.split('\n')) {
    if (line.length < 120) continue;
    const inEntry = entry.split(line).length - 1;
    const inRest = rest.split(line).length - 1;
    if (inEntry > 1 || inRest > 0)
      offenders.push(`${inEntry}× in entry, ${inRest}× elsewhere: ${line.slice(0, 90)}…`);
  }
  assert.deepEqual(
    offenders,
    [],
    'a long line of the top release entry appears more than once. That is what a bad splice looks ' +
      'like: text the file already holds, pasted into the middle of the entry. Read the entry as ' +
      'prose before deciding this is a coincidence.\n' +
      offenders.join('\n')
  );
});

test('CHANGELOG: the structure checks can fail (mutation control)', () => {
  // The real corruption, replayed against a copy: the file header pasted into
  // the entry body. Without this, three assertions that can never fire read
  // exactly like three that guard something.
  const text = read();
  const header = text.split('\n').slice(0, 9).join('\n') + '\n';
  const entry = topEntry(text);
  // Spliced MID-LINE, where the real one landed (0.82.0 pre-tag review round 2,
  // MEDIUM-2). The first draft spliced at a line boundary and asserted that
  // `^# Changelog$` went to 2 — but on the commit that actually shipped the
  // corruption that count is **1**, because the injected copy was glued to
  // `…holding a` + backtick and never reached column 0. Arm 1 is the one
  // assertion that would NOT have fired on the bug this file exists for; arms 2
  // and 3 are what caught it. Splicing at the `$`-backtick token reproduces it.
  //
  // The first draft also used `text.replace(entry, …)` and so reproduced the bug
  // inside the test meant to pin it — the replacement string carried the entry's
  // own token and ate the file prefix. Slicing has no replacement side.
  const marker = '`$`';
  const at = text.indexOf(marker, text.indexOf(entry));
  assert.notEqual(at, -1, 'the entry no longer contains the token this control splices at');
  const corrupted = text.slice(0, at + 1) + header + text.slice(at + 1);
  assert.notEqual(corrupted, text, 'the mutation did not change the text');
  assert.equal(
    countMatches(corrupted, /^## Versioning policy/gm),
    2,
    'the policy-heading arm would not have caught the corruption that shipped'
  );
  assert.ok(
    topEntry(corrupted)
      .split('\n')
      .filter(l => /^## /.test(l)).length > 1,
    'the foreign-H2 arm would not have caught the corruption that shipped'
  );
  // Arm 1 is recorded as NOT firing on this shape rather than asserted away: a
  // mid-line injection leaves the H1 off column 0, so the count stays 1.
  assert.equal(countMatches(corrupted, /^# Changelog$/gm), 1);
});
