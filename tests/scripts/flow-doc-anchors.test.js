// flow-doc-anchors.test.js — converge round 7 (2026-09-14), decision D5.
//
// `docs/flows/*.md` walks a runtime path step by step and cites the source for
// each step. The obvious citation is a line number, and it is the one thing
// that cannot survive: any edit above a line moves it, so the numbers rot on
// somebody else's commit and a reader who checks two of them learns to stop
// checking. This repo has already paid for that twice this month — a schema
// row describing an encoding the code stopped performing, and a checklist
// pointing at a table that had moved to another file.
//
// So the flow docs cite a VERBATIM ANCHOR instead, and this gate re-resolves
// every one of them. The assertion is not "the anchor is present" but "the
// anchor occurs EXACTLY ONCE": a fragment that appears twice names two places
// and tells the reader neither, which is the uniqueness half the spec-text
// gates in this repo learned to require after a substring pin matched its own
// documentation instead of the rule.
//
// What it does NOT claim: that the prose beside an anchor describes what the
// code does. No regex can decide that. It claims the cited code still exists,
// still exists once, and is therefore still findable by grep — which is the
// property a line number was pretending to offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FLOW_DIR = path.join(REPO_ROOT, 'docs/flows');

// `path` → `anchor`, both in backticks. The left side must look like a source
// file or the pair is not a citation — the docs use backticks for plenty of
// things that are not paths, and a gate that judged those would fail on prose.
const CITATION = /`([^`]+)`\s*→\s*`([^`]+)`/g;
const SOURCE_EXT = /\.(sh|js|mjs|json)$/;

function flowDocs() {
  if (!fs.existsSync(FLOW_DIR)) return [];
  return fs
    .readdirSync(FLOW_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, text: fs.readFileSync(path.join(FLOW_DIR, f), 'utf8') }));
}

function citations(doc) {
  const out = [];
  for (const m of doc.text.matchAll(CITATION)) {
    const [, file, anchor] = m;
    if (!SOURCE_EXT.test(file)) continue;
    out.push({ doc: doc.name, file, anchor });
  }
  return out;
}

// Occurrences of a LITERAL substring. Deliberately not a regex: an anchor is
// real shell or JS and is full of characters a regex would read as syntax.
function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('flow docs: every citation resolves to exactly one place in its source', () => {
  const docs = flowDocs();
  const all = docs.flatMap(citations);
  console.log(`  flow-doc gate: ${all.length} citation(s) across ${docs.length} doc(s)`);

  // Floors on the judged set. Without them an emptied docs/flows/, a renamed
  // arrow, or a citation format nobody updated all report the same clean pass
  // as a doc that is genuinely in sync.
  assert.ok(docs.length >= 1, 'docs/flows/ holds no flow document — this gate judged nothing');
  assert.ok(
    all.length >= 15,
    `expected >=15 anchor citations, found ${all.length} — the citation format may have drifted away from this gate`
  );

  const broken = [];
  for (const c of all) {
    const abs = path.join(REPO_ROOT, c.file);
    if (!fs.existsSync(abs)) {
      broken.push(`${c.doc}: cites ${c.file}, which does not exist`);
      continue;
    }
    const n = occurrences(fs.readFileSync(abs, 'utf8'), c.anchor);
    if (n === 1) continue;
    broken.push(
      n === 0
        ? `${c.doc}: anchor gone from ${c.file} — "${c.anchor}"`
        : `${c.doc}: anchor occurs ${n}x in ${c.file}, so it names no single step — "${c.anchor}"`
    );
  }
  assert.deepEqual(broken, [], `flow doc citations no longer resolve:\n  ${broken.join('\n  ')}`);
});

test('flow docs: the resolver is capable of failing (mutation control)', () => {
  // The gate above passes both when every anchor resolves and when the
  // extractor silently matched nothing useful. Drive the two failure shapes
  // through the same functions to show they are reachable.
  const missing = occurrences('alpha beta', 'gamma');
  const twice = occurrences('alpha beta alpha', 'alpha');
  assert.equal(missing, 0, 'a vanished anchor must count 0');
  assert.equal(twice, 2, 'a duplicated anchor must count 2, not 1');

  // And the extractor must reject a backtick pair whose left side is prose,
  // or every flow doc would acquire phantom citations from ordinary writing.
  const prose = citations({ name: 'x.md', text: '`the manifest` → `written last`' });
  assert.deepEqual(prose, [], 'a non-path backtick pair was read as a citation');
  const real = citations({ name: 'x.md', text: '`hooks/a.sh` → `set -u`' });
  assert.deepEqual(real, [{ doc: 'x.md', file: 'hooks/a.sh', anchor: 'set -u' }]);
});
