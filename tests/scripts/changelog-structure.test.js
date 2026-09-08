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

test('CHANGELOG: the structure checks can fail (mutation control)', () => {
  // The real corruption, replayed against a copy: the file header pasted into
  // the entry body. Without this, three assertions that can never fire read
  // exactly like three that guard something.
  const text = read();
  const header = text.split('\n').slice(0, 9).join('\n') + '\n';
  const entry = topEntry(text);
  // Spliced by SLICING, at a line boundary inside the entry. The first draft of
  // this control used `text.replace(entry, …)` and reproduced the very bug it
  // exists to pin: the replacement string carried the entry's own `` `$` `` and
  // ate the file prefix, so the assertions below read 1 instead of 2.
  const at = text.indexOf('\n', text.indexOf(entry) + 200) + 1;
  const corrupted = text.slice(0, at) + header + text.slice(at);
  assert.notEqual(corrupted, text, 'the mutation did not change the text');
  assert.equal(countMatches(corrupted, /^# Changelog$/gm), 2);
  assert.equal(countMatches(corrupted, /^## Versioning policy/gm), 2);
  assert.ok(
    topEntry(corrupted)
      .split('\n')
      .filter(l => /^## /.test(l)).length > 1,
    'the foreign-H2 check would not have seen the real corruption'
  );
});
