import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toggle } from '../../scripts/toggle.js';

const TOGGLE_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/toggle.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-tg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({ env: {} }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('toggle enables banned-vocab kill-switch', async () => {
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.env.DISABLE_BANNED_VOCAB_HOOK, '1');
  assert.equal(r.newState, 'disabled');
});

test('toggle re-enables banned-vocab (clears kill-switch)', async () => {
  await toggle('banned-vocab');
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.ok(!s.env.DISABLE_BANNED_VOCAB_HOOK);
  assert.equal(r.newState, 'enabled');
});

test('toggle unknown name → error', async () => {
  await assert.rejects(() => toggle('not-a-hook'), /unknown hook/i);
});

test('toggle names the nearest hook when given the README file-name spelling', () => {
  // README's "15 shell hooks" row is the only place a user finds hook names in
  // bulk, and it lists them by FILE — `banned-vocab-check`, `pre-bash-safety-check`,
  // `ship-baseline-check`. Three of the fifteen differ from the display name
  // NAME_MAP is keyed by, so copying from that row produced a bare
  // `unknown hook: banned-vocab-check` and exit 1: no valid list (that prints
  // only on the no-argument path the user did not take), no suggestion, no way
  // forward short of reading the source.
  //
  // Each pair is (what README gives, what toggle accepts). The ASSERTION is on
  // the SUGGESTION, not merely on the failure — the pre-fix message already
  // failed, so a case that only checked the exit code would have passed against
  // the bug.
  for (const [given, expected] of [
    ['banned-vocab-check', 'banned-vocab'],
    ['pre-bash-safety-check', 'pre-bash-safety'],
    ['ship-baseline-check', 'ship-baseline'],
    ['banned-vocab-check.sh', 'banned-vocab'],
  ]) {
    const r = spawnSync(process.execPath, [TOGGLE_JS, given], {
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1, `${given}: expected exit 1; stderr=${r.stderr}`);
    assert.match(r.stderr, /unknown hook/i, `${given}: keep the documented error phrase`);
    assert.match(
      r.stderr,
      new RegExp(`did you mean '${expected}'`),
      `${given}: the error must name the accepted spelling, got: ${r.stderr}`
    );
  }
});

test('toggle rejects Object.prototype keys instead of writing junk into settings.json', () => {
  // `NAME_MAP[name]` is a bare bracket lookup on a plain object, so it walks the
  // prototype chain: `NAME_MAP.constructor` is truthy, `if (!upper)` is false,
  // and the unknown-hook path — including the suggestion and the valid-set
  // listing — is never reached. `toggle.js constructor` exited 0, reported
  // `"newState": "disabled"`, and wrote the key
  // `DISABLE_function Object() { [native code] }_HOOK` into the user's real
  // ~/.claude/settings.json (0.88.0 pre-tag review, Low-1).
  //
  // Pre-dates the suggestion work — the same input does the same thing on the
  // parent commit — but it is the exact "unknown hook name" path that work set
  // out to repair, and the sibling case below missed it by choosing a fixture
  // (`nonsense-hook`) that is not a prototype member. THAT is why the assertion
  // here is on the file contents and not only on the exit code: a guard that
  // rejected the name while still having written would pass an exit-code-only
  // check.
  const before = fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8');
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
    const r = spawnSync(process.execPath, [TOGGLE_JS, name], {
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1, `${name}: expected exit 1 (unknown hook); stdout=${r.stdout}`);
    assert.match(r.stderr, /unknown hook/i, `${name}: must take the unknown-hook path`);
    assert.equal(
      fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'),
      before,
      `${name}: settings.json must be left byte-identical`
    );
  }
});

test('toggle prints the valid set for a name with no near match', () => {
  // The suggestion above only covers the three README spellings. Any other
  // typo must still land somewhere: print the set rather than a dead end.
  const r = spawnSync(process.execPath, [TOGGLE_JS, 'nonsense-hook'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown hook/i);
  assert.doesNotMatch(r.stderr, /did you mean/, 'no near match exists, so none should be claimed');
  assert.match(r.stderr, /banned-vocab/, 'the valid names must be listed');
  assert.match(r.stderr, /session-end-check/, 'the whole set, not a prefix of it');
});

test('toggle CLI with no argument prints usage (F18)', () => {
  // Regression: bare `node toggle.js` printed "unknown hook: undefined" —
  // unhelpful. Should print usage with the valid names.
  const result = spawnSync(process.execPath, [TOGGLE_JS], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
  assert.match(result.stderr, /banned-vocab/);
});

test('toggle CLI --help exits 0 with usage on stdout (Round-2 discoverability)', () => {
  // Pre-fix: `toggle --help` returned `unknown hook: --help` exit 1 — same
  // discoverability family as the parseStrict scripts before they got
  // printHelpAndExit. The hook-name lookup ate the flag.
  const result = spawnSync(process.execPath, [TOGGLE_JS, '--help'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.match(result.stdout, /Usage:.*toggle\.js/);
  assert.match(result.stdout, /banned-vocab/);
});

test('toggle CLI -h exits 0 with usage on stdout', () => {
  const result = spawnSync(process.execPath, [TOGGLE_JS, '-h'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.match(result.stdout, /Usage:.*toggle\.js/);
});

test('SCRIPT-2: unknown trailing flag rejects with exit 2 (no silent drop)', () => {
  // `toggle banned-vocab --json` previously flipped the hook and dropped --json.
  // The sandbox HOME is bound to a name so it can be disposed (§8.V4): inlined
  // into the env literal it was unreachable and every `npm test` run leaked it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgl-'));
  try {
    const r = spawnSync(process.execPath, [TOGGLE_JS, 'banned-vocab', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(r.status, 2, `expected exit 2 (shape error); stderr=${r.stderr}`);
    assert.match(r.stderr, /Unknown flag|Unknown argument/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('SCRIPT-2: extra positional rejects with exit 2', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgl-'));
  try {
    const r = spawnSync(process.execPath, [TOGGLE_JS, 'banned-vocab', 'pre-bash-safety'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(r.status, 2, `expected exit 2; stderr=${r.stderr}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('SCR-L2: a settings.json that is an ARRAY is refused, not silently un-written', () => {
  // `s.env ||= {}` works on an array, `JSON.stringify` drops non-index
  // properties, and toggle reported the new state for a hook that stayed on —
  // a success message for a write that never happened (Round-14 audit SCR-L2).
  for (const [shape, body] of [
    ['an array', '[]'],
    ['null', 'null'],
    ['a JSON number', '3'],
  ]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgl-shape-'));
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude/settings.json'), body);
      const r = spawnSync(process.execPath, [TOGGLE_JS, 'banned-vocab'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      });
      assert.notEqual(r.status, 0, `${shape}: toggle reported success on a file it cannot write`);
      assert.match(r.stderr, /not a JSON object/, `${shape}: the error must name the shape problem`);
      assert.equal(
        fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'),
        body,
        `${shape}: the file must be left exactly as it was`
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});
