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

test('every command except the description-routed ones is user-invoked only', () => {
  const names = fs
    .readdirSync(COMMANDS)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3));
  assert.ok(names.length >= 16, `expected at least 16 commands, found ${names.length}`);
  for (const name of names) {
    const fm = frontmatter(path.join(COMMANDS, `${name}.md`));
    const userOnly = /^disable-model-invocation:\s*true\s*$/m.test(fm);
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
