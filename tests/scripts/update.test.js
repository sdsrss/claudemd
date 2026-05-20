import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { update } from '../../scripts/update.js';

const UPDATE_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/update.js');

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-upd-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), 'plugin-new\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), 'plugin-new-ext\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), 'plugin-new-cl\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/OPERATOR.md'), 'plugin-new-op\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'home-old\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'plugin-new-ext\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'home-old-cl\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/OPERATOR.md'), 'plugin-new-op\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('dry-run: returns per-file diff summary', async () => {
  const res = await update({ pluginRoot, choice: 'cancel' });
  assert.equal(res.applied, false);
  assert.equal(res.diffs.length, 4);
  const core = res.diffs.find(d => d.file === 'CLAUDE.md');
  assert.ok(core.added > 0 || core.removed > 0);
  const ext = res.diffs.find(d => d.file === 'CLAUDE-extended.md');
  assert.equal(ext.added, 0);
  assert.equal(ext.removed, 0);
});

test('apply-all: backup created and all files updated', async () => {
  const res = await update({ pluginRoot, choice: 'apply-all' });
  assert.equal(res.applied, true);
  assert.ok(res.backupDir);
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'plugin-new\n');
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'home-old\n');
});

test('unknown choice throws', async () => {
  await assert.rejects(
    () => update({ pluginRoot, choice: 'select' }),
    /unknown choice/
  );
});

test('CLI: unknown CLAUDEMD_UPDATE_CHOICE → clean stderr + exit 1 (no Node stack trace)', () => {
  // Pre-fix, an unknown env value surfaced as a raw Node promise-rejection
  // stack trace dumped to stderr (lines starting with `Error:` and
  // `    at update (file:.../update.js:41:11)`). The .catch wrapper translates
  // it into a one-line message + exit 1 — same UX contract as audit.js /
  // sparkline.js validation errors.
  const r = spawnSync('node', [UPDATE_JS], {
    env: { ...process.env, CLAUDEMD_UPDATE_CHOICE: 'YOLO' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown choice: YOLO/);
  // No raw Node stack trace lines (the `    at update (file:.../` pattern).
  assert.doesNotMatch(r.stderr, /^\s*at update \(/m);
});
