import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codeGraphAdapter, detectHost, manualPsCandidates, CLAUDEMD_PROVIDER_ID, HOST_ADAPTERS,
} from '../../scripts/lib/statusline-hosts.js';

let tmpHome, savedHome;
const primary = () => path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
const mirror  = () => path.join(tmpHome, '.claude/statusline-providers.json');
const seed = (list) => {
  fs.mkdirSync(path.dirname(primary()), { recursive: true });
  fs.mkdirSync(path.dirname(mirror()), { recursive: true });
  fs.writeFileSync(primary(), JSON.stringify(list));
  fs.writeFileSync(mirror(), JSON.stringify(list));
};
const readP = () => JSON.parse(fs.readFileSync(primary(), 'utf8'));
const readM = () => JSON.parse(fs.readFileSync(mirror(), 'utf8'));

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hosts-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('detectHost recognizes a code-graph composite command, not a plain one', () => {
  assert.equal(detectHost('node "/x/scripts/statusline-composite.js"'), codeGraphAdapter);
  assert.equal(detectHost('node "/x/other.js"'), null);
  assert.equal(detectHost(null), null);
});

test('register inserts our provider at the front (after _previous) in BOTH files', () => {
  seed([
    { id: '_previous', command: 'bash "/h/.claude/old.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  const changed = codeGraphAdapter.register(
    { id: CLAUDEMD_PROVIDER_ID, command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true },
    { front: true },
  );
  assert.equal(changed, true);
  for (const read of [readP, readM]) {
    const ids = read().map((p) => p.id);
    assert.deepEqual(ids, ['_previous', 'claudemd', 'code-graph'], 'claudemd after _previous, before code-graph');
  }
});

test('register is idempotent when the entry is unchanged', () => {
  seed([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const entry = { id: CLAUDEMD_PROVIDER_ID, command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true };
  assert.equal(codeGraphAdapter.register(entry, { front: true }), true);
  assert.equal(codeGraphAdapter.register(entry, { front: true }), false, 're-register is a no-op');
  assert.equal(readP().filter((p) => p.id === 'claudemd').length, 1);
});

test('unregister removes our provider from BOTH files, leaves others', () => {
  seed([
    { id: 'claudemd', command: 'bash "/h/.claude/claudemd-statusline.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  assert.equal(codeGraphAdapter.unregister('claudemd'), true);
  for (const read of [readP, readM]) {
    assert.deepEqual(read().map((p) => p.id), ['code-graph']);
  }
  assert.equal(codeGraphAdapter.unregister('claudemd'), false, 'second unregister is a no-op');
});

test('read prefers primary, falls back to durable mirror', () => {
  fs.mkdirSync(path.dirname(mirror()), { recursive: true });
  fs.writeFileSync(mirror(), JSON.stringify([{ id: 'code-graph', command: 'node "/cg/s.js"', needsStdin: false }]));
  assert.equal(codeGraphAdapter.isRegistered('code-graph'), true, 'self-heals from mirror when primary absent');
});

test('manualPsCandidates picks a ~/.claude bash PS1, not plugins or claudemd', () => {
  const providers = [
    { id: 'user-ps1', command: 'bash "/home/x/.claude/statusline-command.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
    { id: 'claudemd', command: 'bash "/home/x/.claude/claudemd-statusline.sh"', needsStdin: true },
  ];
  assert.deepEqual(manualPsCandidates(providers).map((p) => p.id), ['user-ps1']);
});

test('HOST_ADAPTERS contains the code-graph adapter', () => {
  assert.ok(HOST_ADAPTERS.includes(codeGraphAdapter));
});
