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
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh',     '#!/bin/bash\necho b\n');
  writeFile(marketRoot, 'hooks/banned-vocab-check.sh', '#!/bin/bash\necho a\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh',     '#!/bin/bash\necho b\n');

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
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh',     'shared\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh',     'shared\n');

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
  writeFile(sourceRoot, 'hooks/lib/rule-hits.sh',   'L1\n');
  writeFile(sourceRoot, 'hooks/lib/hook-common.sh', 'L2\n');
  writeFile(marketRoot, 'hooks/lib/rule-hits.sh',   'L1\n');
  writeFile(marketRoot, 'hooks/lib/hook-common.sh', 'DIFFERENT\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.driftCount, 1);
  assert.equal(r.diffs[0].path, 'hooks/lib/hook-common.sh');
});

test('compareHooks skips non-.sh files (.patterns, .json) so config evolution is not noise', () => {
  // banned-vocab.patterns / hooks.json are config; drift there is not the
  // hook-CODE drift this check is for. /claudemd-update covers config.
  writeFile(sourceRoot, 'hooks/banned-vocab.patterns', 'pat-v2\n');
  writeFile(sourceRoot, 'hooks/hooks.json',            '{"v":2}\n');
  writeFile(marketRoot, 'hooks/banned-vocab.patterns', 'pat-v1\n');
  writeFile(marketRoot, 'hooks/hooks.json',            '{"v":1}\n');

  const r = compareHooks(sourceRoot, marketRoot);
  assert.equal(r.skipped, true);
  assert.equal(r.skippedReason, 'no-hooks-in-source');
});
