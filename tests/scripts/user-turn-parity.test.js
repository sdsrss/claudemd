// Cross-engine parity for "what counts as a real typed user turn" (2026-07-27
// audit, H2).
//
// The concept decides a TURN BOUNDARY: banned-vocab-check.sh slices the prior
// assistant turn from it (§10-V Path 2), session-end-check.sh slices forward
// from it to classify mid-SPINE work (§11 session-exit), and sampling-audit.js
// counts turns from it (§13.2 self-compliance denominators). It was implemented
// three times, in two languages, with three different answers — each citing the
// same memory (feedback_cc_user_content_string_vs_array) as its justification:
//
//   banned-vocab  string only            + isMeta/system-reminder filtered
//   session-end   string OR array-w-text + nothing filtered
//   sampling      string OR array-w-text minus tool_result, nothing filtered
//
// The divergent shape — array content carrying a text block, i.e. a prompt with
// an attachment — had no fixture in ANY of the three engines' tests
// (feedback_test_coverage_shape_fp_class). Under the old banned-vocab reading it
// is not a boundary, so an interrupted turn's stale claim stayed in scan range:
// the v0.23.19 deny-loop field report, reachable again through a different
// content shape.
//
// Same gate model as banned-vocab-engine-parity.test.js: one fixture corpus,
// both engines, assert identical verdicts AND coverage of every fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isUserTurn } from '../../scripts/lib/transcript-user-turn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/user-turn-shapes.jsonl');
const LIB = path.join(REPO_ROOT, 'hooks/lib/hook-common.sh');

const rows = fs.readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l));

test('fixture corpus covers both verdicts and the divergent shape', () => {
  assert.ok(rows.length >= 10, `expected >= 10 fixtures, got ${rows.length}`);
  assert.ok(rows.some(r => r._expected === true), 'no positive fixture');
  assert.ok(rows.some(r => r._expected === false), 'no negative fixture');
  const divergent = rows.find(r => r._name.includes('attachment-carrying'));
  assert.ok(divergent, 'the array-with-text shape must stay pinned');
  assert.equal(divergent._expected, true);
});

test('JS engine matches the declared verdict for every fixture', () => {
  for (const row of rows) {
    assert.equal(isUserTurn(row), row._expected, `JS disagreed on: ${row._name}`);
  }
});

test('bash/jq engine matches the JS engine row for row', () => {
  // Source the hook library, feed the same corpus through the shared jq
  // definition. Any divergence here is the seam this test exists to hold shut.
  const script = `
    set -uo pipefail
    source "${LIB}"
    jq -R -n "$HOOK_USER_TURN_JQ"'[inputs | try fromjson catch empty] | map(is_user_turn)' < "${FIXTURE}"
  `;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  const bashVerdicts = JSON.parse(out);
  const jsVerdicts = rows.map(r => isUserTurn(r));

  assert.equal(bashVerdicts.length, rows.length, 'bash engine skipped rows');
  for (let i = 0; i < rows.length; i++) {
    assert.equal(
      bashVerdicts[i], jsVerdicts[i],
      `engines disagreed on "${rows[i]._name}": bash=${bashVerdicts[i]} js=${jsVerdicts[i]}`
    );
  }
});

test('both bash consumers call the shared definition instead of inlining one', () => {
  // Derive the consumer set the same way trigger-view-parity.test.sh does:
  // a hook that resolves a last-user boundary must not carry its own spelling.
  const hooksDir = path.join(REPO_ROOT, 'hooks');
  const consumers = fs.readdirSync(hooksDir)
    .filter(f => f.endsWith('.sh'))
    .map(f => path.join(hooksDir, f))
    .filter(f => {
      const src = fs.readFileSync(f, 'utf8');
      return /\.type\s*==\s*"user"/.test(src) || /is_user_turn/.test(src);
    });

  assert.ok(consumers.length >= 2, `expected >= 2 last-user consumers, got ${consumers.length}`);
  for (const c of consumers) {
    const src = fs.readFileSync(c, 'utf8');
    assert.match(src, /is_user_turn/, `${path.basename(c)} does not use the shared is_user_turn`);
    const code = src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(
      code, /content\s*\|\s*type\)\s*==\s*"string"/,
      `${path.basename(c)} still inlines its own content-shape test`
    );
  }
});
