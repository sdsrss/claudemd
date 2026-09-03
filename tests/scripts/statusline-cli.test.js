import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts/statusline-adopt.js');

let tmpHome, savedHome;
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-slcli-'));
  savedHome = process.env.HOME;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('detect on empty slot → absent', () => {
  const r = run(['detect', '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'absent');
});

test('adopt then detect → claudemd', () => {
  assert.equal(JSON.parse(run(['adopt', '--json']).stdout).action, 'set');
  assert.equal(JSON.parse(run(['detect', '--json']).stdout).verdict, 'claudemd');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('unknown mode → exit 2', () => {
  assert.equal(run(['bogus']).status, 2);
});

test('unknown flag → exit 2', () => {
  assert.equal(run(['adopt', '--nope']).status, 2);
});

test('--help → exit 0 with usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node scripts\/statusline-adopt\.js/);
});

test('M5: detect default is human-readable, --json is machine-readable', () => {
  // fresh empty slot in the sandbox HOME
  const r1 = run(['detect']);
  assert.doesNotMatch(r1.stdout, /^\s*\{/, 'default output is not raw JSON');
  assert.match(r1.stdout, /absent/, 'human summary names the verdict');
  const r2 = run(['detect', '--json']);
  const obj = JSON.parse(r2.stdout);
  assert.equal(obj.verdict, 'absent');
});

test('M5 review fix: adopt --supersede dry-run (human, default) names the supersede target', () => {
  // Seed a code-graph composite-host slot with two registered providers.
  fs.writeFileSync(
    path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } })
  );
  fs.mkdirSync(path.join(tmpHome, '.cache/code-graph'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.cache/code-graph/statusline-registry.json'),
    JSON.stringify([
      { id: 'user-ps1', command: 'bash "/h/.claude/x.sh"', needsStdin: true },
      { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
    ])
  );

  // Default human output must name the target even though adopt()'s host
  // dry-run branch returns it under `supersede` (echoed id), not `superseded`
  // (id replaced) — renderHuman must read either key.
  const human = run(['adopt', '--supersede=user-ps1', '--dry-run']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /dry-run/, 'names the dry-run action');
  assert.match(human.stdout, /user-ps1/, 'names the supersede target');

  // --json path is unaffected by the human-render fix; confirm it still parses.
  const json = run(['adopt', '--supersede=user-ps1', '--dry-run', '--json']);
  assert.equal(json.status, 0);
  const obj = JSON.parse(json.stdout);
  assert.equal(obj.action, 'dry-run');
  assert.equal(obj.supersede, 'user-ps1');
});

test('adopt --supersede a non-existent id → human warns, --json surfaces supersedeMissed', () => {
  fs.writeFileSync(
    path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } })
  );
  fs.mkdirSync(path.join(tmpHome, '.cache/code-graph'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.cache/code-graph/statusline-registry.json'),
    JSON.stringify([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }])
  );
  const human = run(['adopt', '--supersede=ghost']);
  assert.equal(human.status, 0);
  assert.match(
    human.stdout,
    /supersede target 'ghost' not found/,
    'human output warns the target was missed'
  );
  const json = run(['adopt', '--supersede=ghost', '--json']);
  assert.equal(json.status, 0);
  const obj = JSON.parse(json.stdout);
  assert.equal(obj.supersedeMissed, 'ghost');
  assert.equal(obj.superseded, null);
});

// R11-26 (2026-09-03 audit): `--empty-only` had zero occurrences in tests/.
// The lib parameter reaches adopt() from install.js:351 and is covered there
// only as a library argument — the CLI flag that sets it was untested, so a
// parseStrict rename would have silently turned the install-time guard off and
// let a fresh install clobber a foreign statusLine.
test('R11-26: adopt --empty-only writes into an empty slot but never over a foreign one', () => {
  // Empty slot: the guard permits the write (that IS the install-time case).
  const empty = run(['adopt', '--empty-only', '--json']);
  assert.equal(empty.status, 0, `stderr=${empty.stderr}`);
  assert.equal(JSON.parse(empty.stdout).action, 'set');

  // Foreign slot: the guard must refuse, WITHOUT --force being involved.
  const settings = path.join(tmpHome, '.claude/settings.json');
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: '/opt/other/line.sh' } }));
  const foreign = run(['adopt', '--empty-only', '--json']);
  assert.equal(foreign.status, 0, `stderr=${foreign.stderr}`);
  assert.equal(JSON.parse(foreign.stdout).action, 'skipped-foreign');
  assert.equal(
    JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command,
    '/opt/other/line.sh',
    'the foreign slot must survive byte-for-byte'
  );

  // Control: without --empty-only the same foreign slot is still refused
  // (that is --force's job), so the assertion above is not just re-testing the
  // foreign guard.
  const noFlag = run(['adopt', '--json']);
  assert.notEqual(JSON.parse(noFlag.stdout).action, 'set');
});
