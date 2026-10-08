// Which claudemd commands Claude may invoke on its own (0.107.0).
//
// A command with `disable-model-invocation: true` keeps its description out of
// the model's skill listing (3,591 bytes per session for the 15 below). The
// one exception is reached through its description: a user asking in words to
// configure design specs. Adding a command, or flipping one, is a released
// default-behaviour change, so this list has to be edited on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMANDS = path.join(REPO, 'commands');
const MODEL_INVOKED = new Set(['claudemd-design-adopt']);

const frontmatter = file => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file} has no frontmatter block`);
  return m[1];
};

// Every `disable-model-invocation:` line in a frontmatter block, in order. A key
// written twice (true, then false) used to pass: the test found the `true` line,
// while a YAML reader that keeps the last value would load the command into the
// model's listing (0.107.0 delta review, D#201). The value only counts when
// the key appears once.
const invocationKeys = fm => [...fm.matchAll(/^disable-model-invocation:\s*(.*?)\s*$/gm)].map(m => m[1]);

test('a duplicated disable-model-invocation key is caught, not read as its first value', () => {
  assert.deepEqual(
    invocationKeys('name: x\ndisable-model-invocation: true\ndisable-model-invocation: false'),
    ['true', 'false']
  );
  assert.deepEqual(invocationKeys('name: x\ndisable-model-invocation: true'), ['true']);
  assert.deepEqual(invocationKeys('name: x'), []);
});

test('every command except the description-routed ones is user-invoked only', () => {
  const names = fs
    .readdirSync(COMMANDS)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3));
  assert.ok(names.length >= 16, `expected at least 16 commands, found ${names.length}`);
  for (const name of names) {
    const keys = invocationKeys(frontmatter(path.join(COMMANDS, `${name}.md`)));
    assert.ok(
      keys.length <= 1,
      `${name} sets disable-model-invocation ${keys.length} times (${keys.join(', ')})`
    );
    const userOnly = keys[0] === 'true';
    if (MODEL_INVOKED.has(name)) {
      assert.equal(userOnly, false, `${name} is routed by its description and must stay model-invocable`);
    } else {
      assert.equal(
        userOnly,
        true,
        `${name} lacks disable-model-invocation: true; its description would load into every session`
      );
    }
  }
});

test('the model-invoked allowlist names commands that exist', () => {
  for (const name of MODEL_INVOKED) {
    assert.ok(fs.existsSync(path.join(COMMANDS, `${name}.md`)), `${name}.md is missing`);
  }
});
