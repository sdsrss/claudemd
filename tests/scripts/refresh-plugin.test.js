// refresh-plugin.test.js — scripts/refresh-plugin.sh drives the `claude plugin`
// CLI three-step (marketplace update → uninstall -y → install) and fails loudly.
// Controls-first (feedback_probe_harness_controls_first): cases 1+2 must produce
// opposite outcomes before the rest is trusted. `claude` is a PATH shim that
// logs argv — no real CLI, no network, no ~/.claude writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/refresh-plugin.sh');

function makeShim(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'claude');
  fs.writeFileSync(shim, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(shim, 0o755);
}

function runScript(pathDirs) {
  return spawnSync('bash', [SCRIPT], {
    env: { ...process.env, PATH: pathDirs.join(':') },
    encoding: 'utf8',
  });
}

test('control A: success shim — 3 CLI calls in order, exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-ok-'));
  try {
    const log = path.join(tmp, 'calls.log');
    makeShim(path.join(tmp, 'bin'), `echo "$*" >> "${log}"`);
    const r = runScript([path.join(tmp, 'bin'), '/usr/bin', '/bin']);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(fs.readFileSync(log, 'utf8'), [
      'plugin marketplace update claudemd',
      'plugin uninstall claudemd@claudemd -y',
      'plugin install claudemd@claudemd',
      '',
    ].join('\n'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('control B: marketplace-update failure stops the pipeline before uninstall', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-fail-'));
  try {
    const log = path.join(tmp, 'calls.log');
    makeShim(path.join(tmp, 'bin'),
      `echo "$*" >> "${log}"\n[[ "$*" == plugin\\ marketplace\\ update* ]] && exit 1\nexit 0`);
    const r = runScript([path.join(tmp, 'bin'), '/usr/bin', '/bin']);
    assert.notEqual(r.status, 0);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('uninstall'),
      'set -e must stop before uninstall');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('claude CLI missing from PATH: exit 1 + stderr names the problem', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-none-'));
  try {
    // PATH keeps /usr/bin:/bin (bash itself must resolve) but no claude shim.
    // Precondition guard: if a real `claude` lives in those dirs the case is
    // meaningless — fail loudly instead of asserting on the wrong branch.
    fs.mkdirSync(path.join(tmp, 'empty'));
    const dirs = [path.join(tmp, 'empty'), '/usr/bin', '/bin'];
    const probe = spawnSync('bash', ['-c', 'command -v claude'], {
      env: { ...process.env, PATH: dirs.join(':') }, encoding: 'utf8',
    });
    assert.notEqual(probe.status, 0,
      `precondition: claude resolves at ${probe.stdout.trim()} under the stripped PATH`);
    const r = runScript(dirs);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /'claude' CLI not found/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
