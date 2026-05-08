// lint-cli.test.js — spawn-based CLI surface tests for bin/claudemd-lint.js.
// Asserts argv parsing, exit codes, output channel (stdout vs stderr),
// and JSON output shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO_ROOT, 'bin/claudemd-lint.js');

const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], {
  input,
  encoding: 'utf8',
  timeout: 10000,
});

test('CLI: --help exits 0, prints usage to stdout', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /lint <text>/);
  assert.match(r.stdout, /audit <jsonl-path>/);
});

test('CLI: no args exits 2 + prints usage', () => {
  const r = run([]);
  assert.equal(r.status, 2, 'bare invocation must exit 2 (usage error)');
  assert.match(r.stdout, /Usage:/);
});

test('CLI: --version exits 0, prints package version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('CLI: lint clean text → exit 0, stdout "OK"', () => {
  const r = run(['lint', 'added pagination cursor; 1453 → 1490 (+2.5%)']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK/);
  assert.equal(r.stderr, '');
});

test('CLI: lint hit → exit 1, stderr describes hit, stdout empty', () => {
  const r = run(['lint', 'this is significantly better']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '', 'human-readable hits go to stderr, not stdout');
  assert.match(r.stderr, /significantly/);
  assert.match(r.stderr, /§10-V drift/);
});

test('CLI: lint --stdin reads from stdin', () => {
  const r = run(['lint', '--stdin'], 'this is significantly improved\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /significantly/);
});

test('CLI: lint --json emits parseable JSON to stdout regardless of hit/clean', () => {
  // Clean
  const okRun = run(['lint', '--json', 'clean prose 30 → 60']);
  assert.equal(okRun.status, 0);
  const okPayload = JSON.parse(okRun.stdout);
  assert.equal(okPayload.scope, 'lint');
  assert.equal(okPayload.hits.length, 0);
  // Hit
  const hitRun = run(['lint', '--json', 'this is significantly better']);
  assert.equal(hitRun.status, 1);
  const hitPayload = JSON.parse(hitRun.stdout);
  assert.equal(hitPayload.hits.length >= 1, true);
  assert.equal(hitPayload.hits[0].match.toLowerCase(), 'significantly');
});

test('CLI: lint with no positional arg + no --stdin → exit 2 usage error', () => {
  const r = run(['lint']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /text required/);
});

test('CLI: audit clean transcript → exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'added cursor; tests 30 → 35' }] },
  }) + '\n');
  try {
    const r = run(['audit', transcript]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^OK/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit transcript with banned word → exit 1, names line + turn', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'this is significantly improved' }] } }),
  ].join('\n') + '\n');
  try {
    const r = run(['audit', transcript]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /significantly/);
    assert.match(r.stderr, /1 of 1 assistant turn/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit missing file → exit 2', () => {
  const r = run(['audit', '/nonexistent/transcript.jsonl']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /file not found/);
});

test('CLI: unknown subcommand → exit 2 + usage', () => {
  const r = run(['nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown subcommand/);
  assert.match(r.stderr, /Usage:/);
});
