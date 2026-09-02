import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compareHooks } from '../../scripts/lib/install-drift.js';

let sourceRoot, marketRoot;

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift-src-'));
  marketRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift-mkt-'));
});

afterEach(() => {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(marketRoot, { recursive: true, force: true });
});

test('compareHooks returns ok=true and no diffs when source == market', () => {
  writeFile(sourceRoot, 'hooks/banned-vocab-check.sh', '#!/bin/bash\necho a\n');
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', '#!/bin/bash\necho b\n');
  writeFile(marketRoot, 'hooks/banned-vocab-check.sh', '#!/bin/bash\necho a\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh', '#!/bin/bash\necho b\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.skipped, false);
  assert.equal(r.driftCount, 0);
  assert.equal(r.diffs.length, 0);
});

test('compareHooks reports drift when a hook file differs', () => {
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', "tr '/._' '-'\n");
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh', "tr '/.' '-'\n");

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.skipped, false);
  assert.equal(r.driftCount, 1);
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].path, 'hooks/lib/rule-hits.sh');
  assert.equal(r.diffs[0].reason, 'differs');
});

test('compareHooks reports missing-in-market when source has a hook the market does not', () => {
  writeFile(sourceRoot, 'hooks/banned-vocab-check.sh', 'NEW\n');
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', 'shared\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh', 'shared\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.driftCount, 1);
  assert.equal(r.diffs[0].path, 'hooks/banned-vocab-check.sh');
  assert.equal(r.diffs[0].reason, 'missing-in-market');
});

test('compareHooks skips when sourceRoot and marketRoot resolve to the same realpath', () => {
  // /claudemd-doctor running FROM the marketplace install would pass
  // PLUGIN_ROOT == marketRoot. A drift check against ourselves is noise.
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', 'a\n');

  const r = compareHooks(sourceRoot, sourceRoot);
  assert.equal(r.skipped, true);
  assert.equal(r.skippedReason, 'self-compare');
});

test('compareHooks skips when marketRoot does not exist', () => {
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', 'a\n');
  const missing = path.join(marketRoot, 'does-not-exist');

  const r = compareHooks(sourceRoot, missing);
  assert.equal(r.skipped, true);
  assert.equal(r.skippedReason, 'market-root-missing');
});

test('compareHooks skips when sourceRoot has no hooks/ dir (claudemd-cli npm install)', () => {
  // The standalone claudemd-cli npm package ships only bin/ — no hooks.
  // Drift check is meaningless there.
  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.skipped, true);
  assert.equal(r.skippedReason, 'no-hooks-in-source');
});

test('compareHooks scans recursively into hooks/ subdirectories', () => {
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh', 'L1\n');
  writeFile(sourceRoot, 'hooks/lib/hook-common.sh', 'L2\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh', 'L1\n');
  writeFile(marketRoot, 'hooks/lib/hook-common.sh', 'DIFFERENT\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.driftCount, 1);
  assert.equal(r.diffs[0].path, 'hooks/lib/hook-common.sh');
});

test('compareHooks skips non-.sh files (.patterns, .json) so config evolution is not noise', () => {
  // banned-vocab.patterns / hooks.json are config; drift there is not the
  // hook-CODE drift this check is for. /claudemd-update covers config.
  writeFile(sourceRoot, 'hooks/banned-vocab.patterns', 'pat-v2\n');
  writeFile(sourceRoot, 'hooks/hooks.json', '{"v":2}\n');
  writeFile(marketRoot, 'hooks/banned-vocab.patterns', 'pat-v1\n');
  writeFile(marketRoot, 'hooks/hooks.json', '{"v":1}\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.skipped, true);
  assert.equal(r.skippedReason, 'no-hooks-in-source');
});

test('reverse scan: a hook only in the marketplace root reports missing-in-source', () => {
  // 2026-07-26 audit: compareHooks iterated SOURCE only, so a file present in the
  // market root and gone from source — exactly what retiring a hook leaves, the
  // shape v0.57.0 created by deleting mid-spine-yield-scan — produced no diff.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-src-'));
  const mkt = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-mkt-'));
  try {
    fs.mkdirSync(path.join(src, 'hooks/lib'), { recursive: true });
    fs.mkdirSync(path.join(mkt, 'hooks/lib'), { recursive: true });
    fs.writeFileSync(path.join(src, 'hooks/a.sh'), '#!/bin/bash\n:\n');
    fs.writeFileSync(path.join(mkt, 'hooks/a.sh'), '#!/bin/bash\n:\n');
    // retired: present in market, absent from source — and nested, to prove the
    // reverse walk recurses.
    fs.writeFileSync(path.join(mkt, 'hooks/lib/retired.sh'), '#!/bin/bash\n:\n');
    // a non-.sh market-only file must NOT fire.
    fs.writeFileSync(path.join(mkt, 'hooks/notashell.txt'), 'x\n');

    const r = compareHooks(src, mkt);
    const reasons = r.diffs.map(d => `${d.path}:${d.reason}`).sort();
    assert.deepEqual(reasons, ['hooks/lib/retired.sh:missing-in-source']);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(mkt, { recursive: true, force: true });
  }
});

test('reverse scan does not double-report a file that also differs', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-src2-'));
  const mkt = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-mkt2-'));
  try {
    fs.mkdirSync(path.join(src, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(mkt, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(src, 'hooks/a.sh'), '#!/bin/bash\nsource\n');
    fs.writeFileSync(path.join(mkt, 'hooks/a.sh'), '#!/bin/bash\nmarket\n');

    const r = compareHooks(src, mkt);
    assert.equal(r.diffs.length, 1, `expected one diff, got ${JSON.stringify(r.diffs)}`);
    assert.equal(r.diffs[0].reason, 'differs');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(mkt, { recursive: true, force: true });
  }
});

test('a marketplace root with no hooks/ dir is not an error', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-src3-'));
  const mkt = fs.mkdtempSync(path.join(os.tmpdir(), 'idrift-mkt3-'));
  try {
    fs.mkdirSync(path.join(src, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(src, 'hooks/a.sh'), '#!/bin/bash\n:\n');
    const r = compareHooks(src, mkt);
    assert.equal(r.diffs.filter(d => d.reason === 'missing-in-market').length, 1);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(mkt, { recursive: true, force: true });
  }
});
