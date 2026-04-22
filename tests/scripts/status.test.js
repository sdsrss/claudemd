import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { status } from '../../scripts/status.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-st-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.1.0', entries: [
      { event: 'PreToolUse', command: 'bash /pkg/hooks/banned-vocab-check.sh', sha256: 'x' }
    ],
  }));
  // Real v6.10.0+ spec format: version lives in the H1 title, no standalone
  // `Version:` line (see spec-structure.test.js:55 and CHANGELOG v0.2.1
  // "Versioning policy": canonical spec version source is the `spec/CLAUDE.md`
  // top-line title). status.js must extract the version from this H1.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'),
    '# AI-CODING-SPEC v6.10.0 — Core\n\nBody.\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('status reports plugin version + installed spec version', async () => {
  const r = await status();
  assert.equal(r.plugin.version, '0.1.0');
  assert.equal(r.spec.installed, '6.10.0');
});

test('status reports kill-switch state', async () => {
  const saved = process.env.DISABLE_CLAUDEMD_HOOKS;
  process.env.DISABLE_CLAUDEMD_HOOKS = '1';
  try {
    const r = await status();
    assert.equal(r.killSwitches.plugin, true);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_CLAUDEMD_HOOKS;
    else process.env.DISABLE_CLAUDEMD_HOOKS = saved;
  }
});

test('status reports not-installed when manifest missing', async () => {
  // v0.1.9: manifest lives at ~/.claude/.claudemd-manifest.json outside
  // the runtime state dir. Clean both locations to assert "not-installed".
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), { force: true });
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true, force: true });
  const r = await status();
  assert.equal(r.plugin.installed, false);
});
