import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../scripts/doctor.js';

const DOCTOR_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/doctor.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.1.0', entries: []
  }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('doctor returns checks array with at least 5 entries', async () => {
  const r = await doctor({});
  assert.ok(Array.isArray(r.checks));
  assert.ok(r.checks.length >= 5);
});

test('doctor --prune-backups removes old backups', async () => {
  for (const iso of ['20260101T000000Z','20260201T000000Z','20260301T000000Z',
                     '20260401T000000Z','20260501T000000Z','20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const r = await doctor({ pruneBackups: 3 });
  assert.equal(r.pruned.length, 3);
});

test('doctor CLI rejects --prune-backups=0 (F9)', () => {
  // Regression: --prune-backups=0 meant "retain zero", which deleted ALL
  // backups silently. Users reasonably read "0" as "prune zero of them".
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'must exit non-zero on prune=0');
  assert.match(result.stderr, /positive integer/i);
});

test('doctor logs check reports size and warns above threshold (L5)', async () => {
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // 6 MB of pseudo-entries — beyond the 5 MB warn threshold.
  const row = `{"ts":"2026-04-22T00:00:00Z","hook":"banned-vocab","event":"deny","extra":null}\n`;
  const rowsNeeded = Math.ceil((6 * 1024 * 1024) / row.length);
  fs.writeFileSync(logPath, row.repeat(rowsNeeded));
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.ok(logs, 'logs check must exist');
  assert.equal(logs.ok, false, 'must fail when log exceeds 5 MB threshold');
  assert.match(logs.detail, /MB/);
  assert.match(logs.detail, /truncate/i);
});

test('doctor logs check ok when small (L5)', async () => {
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(logPath, `{"ts":"2026-04-22T00:00:00Z","hook":"x","event":"pass","extra":null}\n`);
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.equal(logs.ok, true);
  assert.match(logs.detail, /1 rule-hits row/);
});

test('doctor runs banned-vocab self-test and reports pass when hook denies synthetic trigger', async () => {
  // Requires jq + bash on PATH; CI installs both. Skip assertion if absent.
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest, 'self-test check must exist');
  assert.equal(selftest.ok, true,
    `self-test must pass on a clean tree; detail="${selftest.detail}"`);
  assert.match(selftest.detail, /significantly/);
  // Clean env: no kill-switch note should appear.
  assert.doesNotMatch(selftest.detail, /kill-switch engaged/);
});

test('doctor self-test detail notes kill-switch when user has disabled the hook via settings.json', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  // Write a settings.json with the per-hook kill-switch engaged. The self-test
  // still runs against the hook CODE (with env cleared in spawn), but its
  // detail must call out that live enforcement is OFF for this user.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_BANNED_VOCAB_HOOK: '1' } }));
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest);
  assert.equal(selftest.ok, true, 'hook code still denies synthetic trigger regardless of kill-switch');
  assert.match(selftest.detail, /kill-switch engaged/);
  assert.match(selftest.detail, /will NOT fire in practice/);
});

test('doctor self-test detail notes kill-switch when DISABLE_CLAUDEMD_HOOKS=1 in process env', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const saved = process.env.DISABLE_CLAUDEMD_HOOKS;
  process.env.DISABLE_CLAUDEMD_HOOKS = '1';
  try {
    const r = await doctor({});
    const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
    assert.ok(selftest);
    assert.equal(selftest.ok, true);
    assert.match(selftest.detail, /kill-switch engaged/);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_CLAUDEMD_HOOKS;
    else process.env.DISABLE_CLAUDEMD_HOOKS = saved;
  }
});

test('D8: orphan manifest detected when manifest.pluginRoot path is absent', async () => {
  // User scenario: ran /plugin uninstall claudemd@claudemd without the
  // /claudemd-uninstall step. Plugin cache is gone; manifest survives with
  // a now-stale pluginRoot. doctor must flag this so the user knows what to clean up.
  const ghostPluginRoot = path.join(tmpHome, 'plugins/cache/claudemd/claudemd/9.9.9-removed');
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '9.9.9-removed',
    installedAt: new Date().toISOString(),
    pluginRoot: ghostPluginRoot,
    entries: [],
  }));
  const r = await doctor({});
  const pc = r.checks.find(c => c.name === 'plugin cache');
  assert.ok(pc, 'plugin cache check must exist');
  assert.equal(pc.ok, false, 'must report fail when pluginRoot is absent');
  assert.match(pc.detail, /orphan manifest/);
  assert.match(pc.detail, /claudemd-uninstall/);
});

test('doctor surfaces spec-hash drift when installed differs from shipped (v0.6.0)', async () => {
  // Write installed spec content that cannot match the real shipped spec —
  // proves drift is detected, not silently green.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'fake spec body\n');
  const r = await doctor({});
  const main = r.checks.find(c => c.name === 'spec-hash:CLAUDE.md');
  assert.ok(main, 'spec-hash:CLAUDE.md check must exist');
  assert.equal(main.ok, false);
  assert.match(main.detail, /≠ shipped/);
  assert.match(main.detail, /claudemd-update/);
});

test('doctor reports spec-hash:* missing when installed spec absent (v0.6.0)', async () => {
  // Default beforeEach does NOT write a CLAUDE.md to ~/.claude — so the
  // "installed missing" branch fires. This is the fresh-install state
  // before /plugin install runs the postInstall hook.
  const r = await doctor({});
  const main = r.checks.find(c => c.name === 'spec-hash:CLAUDE.md');
  assert.ok(main);
  assert.equal(main.ok, false);
  assert.match(main.detail, /installed spec missing/);
});

test('D8: plugin cache check passes when manifest.pluginRoot exists', async () => {
  const realPluginRoot = path.join(tmpHome, 'plugins/cache/claudemd/claudemd/0.5.4');
  fs.mkdirSync(realPluginRoot, { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.5.4',
    installedAt: new Date().toISOString(),
    pluginRoot: realPluginRoot,
    entries: [],
  }));
  const r = await doctor({});
  const pc = r.checks.find(c => c.name === 'plugin cache');
  assert.ok(pc);
  assert.equal(pc.ok, true);
  assert.match(pc.detail, /present at/);
});
