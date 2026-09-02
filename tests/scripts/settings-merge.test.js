import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readSettings,
  writeSettings,
  mergeHook,
  unmergeHook,
  isClaudemdLegacyHookCommand,
} from '../../scripts/lib/settings-merge.js';
import { HOOK_BASENAMES } from '../../scripts/lib/hook-registry.js';

// Derived, not hand-copied (audit-2026-08-22 条目 8). This list was 8 of the 15
// hooks while the eviction assertions below reported "no claudemd entries
// remain" — a residue in any of the other 7 would have been invisible to them.
const CLAUDEMD_HOOK_BASENAMES = HOOK_BASENAMES;

let tmpHome, savedHome;
const FIX = new URL('../fixtures/settings-samples/', import.meta.url).pathname;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sm-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const settingsFile = () => path.join(tmpHome, '.claude/settings.json');
const loadFixture = name => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

const HOOK_SPEC = {
  event: 'PreToolUse',
  matcher: 'Bash',
  command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"',
  timeout: 5,
  tag: 'claudemd',
};

test('1: missing settings.json → readSettings returns {}', () => {
  assert.deepEqual(readSettings(), {});
});

test('2: empty object settings → mergeHook adds new event+matcher', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  const { added } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('3: pre-existing same matcher → appends to hooks array', () => {
  fs.writeFileSync(settingsFile(), JSON.stringify(loadFixture('with-claude-mem-lite.json')));
  const s = readSettings();
  const { added } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  const bashMatcher = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.equal(bashMatcher.hooks.length, 2);
});

test('4: identical command already present → idempotent (added=false)', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, HOOK_SPEC);
  const second = mergeHook(s, HOOK_SPEC);
  assert.equal(second.added, false);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('5: unmergeHook removes only matching entries', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  mergeHook(s, HOOK_SPEC);
  const { removed } = unmergeHook(s, { commandPredicate: c => c.includes('ship-baseline-check.sh') });
  assert.equal(removed, 1);
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.equal(bash.hooks.length, 1);
});

test('6: unmergeHook preserves other-plugin entries', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  unmergeHook(s, { commandPredicate: c => c.includes('claudemd') });
  const userPrompt = s.hooks.UserPromptSubmit;
  assert.equal(userPrompt[0].hooks[0].command.includes('claude-mem-lite'), true);
});

test('7: writeSettings + readSettings round-trip', () => {
  writeSettings({ hooks: { Stop: [{ matcher: '*', hooks: [] }] } });
  const s = readSettings();
  assert.equal(s.hooks.Stop[0].matcher, '*');
});

test('8: writeSettings validates JSON parseable post-write', () => {
  writeSettings({ ok: true });
  const raw = fs.readFileSync(settingsFile(), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('9: mergeHook preserves existing same-matcher order', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  mergeHook(s, HOOK_SPEC);
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.ok(bash.hooks[0].command.includes('banned-vocab'), 'existing first');
  assert.ok(bash.hooks[1].command.includes('ship-baseline'), 'new second');
});

test('10: mergeHook on new event creates event + matcher array', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, { ...HOOK_SPEC, event: 'SessionStart', matcher: 'startup' });
  assert.equal(s.hooks.SessionStart.length, 1);
});

test('11: BOM in settings.json → readSettings strips and parses', () => {
  fs.writeFileSync(settingsFile(), '\uFEFF{"hooks":{}}');
  assert.doesNotThrow(() => readSettings());
});

test('12: malformed settings.json → readSettings throws with clear error', () => {
  fs.writeFileSync(settingsFile(), '{"broken",');
  assert.throws(() => readSettings(), /settings\.json/i);
});

test('13: mergeHook with duplicate command but different timeout → rejects (idempotent)', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, HOOK_SPEC);
  const second = mergeHook(s, { ...HOOK_SPEC, timeout: 999 });
  assert.equal(second.added, false);
});

test('14: large settings.json (>500KB) round-trips', () => {
  const big = { hooks: {}, padding: 'x'.repeat(600_000) };
  writeSettings(big);
  const s = readSettings();
  assert.equal(s.padding.length, 600_000);
});

test('15: mergeHook result is stable across multiple calls', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  for (let i = 0; i < 5; i++) mergeHook(s, HOOK_SPEC);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('16: unmergeHook on empty settings no-op', () => {
  const s = {};
  const { removed } = unmergeHook(s, { commandPredicate: () => true });
  assert.equal(removed, 0);
});

test('17: unmergeHook removes entire matcher block + event key + hooks key when all drop (v0.1.9)', () => {
  const s = { hooks: { PreToolUse: [{ matcher: 'X', hooks: [{ type: 'command', command: 'ours' }] }] } };
  unmergeHook(s, { commandPredicate: c => c === 'ours' });
  // Empty event keys and the top-level hooks object are pruned so repeated
  // install/uninstall cycles leave settings.json without `"PreToolUse": []`
  // scaffolding residue.
  assert.equal(s.hooks, undefined);
});

test('17b (v0.23.18): unmergeHook tolerates malformed-but-valid-JSON settings without throwing', () => {
  // Hand-edited / third-party-written settings.json can be valid JSON yet have
  // a shape unmergeHook did not expect. Pre-fix these threw a cryptic
  // `Cannot read properties of undefined (reading 'length')` that surfaced as
  // "install failed: …" during the adopter's first-touch flow. Each must now
  // no-op gracefully and leave the malformed structure untouched.
  const malformed = [
    { hooks: { PreToolUse: 'oops' } }, // event value not an array
    { hooks: { PreToolUse: [{ matcher: 'Bash' }] } }, // block missing hooks[]
    { hooks: { PreToolUse: [null] } }, // null block
    { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [null] }] } }, // null hook entry
    { hooks: [] }, // hooks itself an array
  ];
  for (const s of malformed) {
    const snapshot = JSON.stringify(s);
    const { removed } = unmergeHook(s, { commandPredicate: () => true });
    assert.equal(removed, 0, `expected no removals for ${snapshot}`);
    assert.equal(JSON.stringify(s), snapshot, `malformed structure must be left untouched: ${snapshot}`);
  }
});

test('17c (v0.23.18): unmergeHook still evicts claudemd + preserves a user hook in a mixed block', () => {
  // Well-formed path is unchanged by the malformed-tolerance guards: evict the
  // claudemd entry, keep the user's own hook, keep the (still non-empty) block.
  const s = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: '/home/me/mine.sh' },
            { type: 'command', command: '/x/plugins/cache/claudemd/hooks/h.sh' },
          ],
        },
      ],
    },
  };
  const { removed } = unmergeHook(s, { commandPredicate: c => c.includes('claudemd') });
  assert.equal(removed, 1);
  const cmds = s.hooks.PreToolUse[0].hooks.map(h => h.command);
  assert.deepEqual(cmds, ['/home/me/mine.sh']);
});

test('18: mergeHook handles settings where hooks key is missing', () => {
  const s = { env: { FOO: 'bar' } };
  mergeHook(s, HOOK_SPEC);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.env.FOO, 'bar');
});

test('19: writeSettings is atomic (rename-from-temp)', () => {
  writeSettings({ marker: 1 });
  const files = fs.readdirSync(path.join(tmpHome, '.claude'));
  assert.ok(files.includes('settings.json'));
  assert.ok(!files.some(f => f.endsWith('.tmp')));
});

test('20: mergeHook tag in SHA256 manifest-friendly form', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  const { added, entry } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  assert.ok(entry && entry.command.includes('ship-baseline-check.sh'));
});

// D6 (v0.5.4): isClaudemdLegacyHookCommand path-anchoring tests.
// Pre-fix substring `c.includes('/hooks/${b}')` would match any plugin's
// hook of the same basename. The 3-OR predicate enumerates only the
// residue forms claudemd has ever written.

test('D6.1: matches pre-0.1.5 ${CLAUDE_PLUGIN_ROOT} literal form', () => {
  const cmd = 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), true);
});

test('D6.2: matches ≤0.1.1 absolute plugin-cache path form', () => {
  const cmd = 'bash "/home/user/.claude/plugins/cache/claudemd/claudemd/0.1.3/hooks/ship-baseline-check.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), true);
});

test('D6.3: matches v0 hand-install form under the USER home ~/.claude/hooks/<basename>', () => {
  // v0.23.11: predicate now anchors to the actual HOME (tmpHome), not any
  // `/.claude/hooks/`, so this path is built from the test's HOME.
  const cmd = `bash "${path.join(tmpHome, '.claude/hooks/memory-read-check.sh')}"`;
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), true);
});

test('D6.7 (v0.23.11): does NOT evict a FOREIGN plugin reusing a claudemd basename under a different root', () => {
  // The bug: `/opt/otherplugin/.claude/hooks/banned-vocab-check.sh` contains
  // `/.claude/hooks/banned-vocab-check.sh` but is NOT under the user's home —
  // claudemd uninstall must not remove it.
  const cmd = 'bash "/opt/otherplugin/.claude/hooks/banned-vocab-check.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), false);
});

test('D6.4: does NOT match same-basename hook from a different plugin', () => {
  // Future-plugin scenario: another plugin happens to ship a hook named
  // banned-vocab-check.sh (no namespacing collision policy in CC). We must
  // not evict it — pre-0.5.4 substring predicate would have.
  const cmd = 'bash "/home/user/.claude/plugins/cache/some-other-plugin/0.1.0/hooks/banned-vocab-check.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), false);
});

test('D6.5: does NOT match non-claudemd hook basenames', () => {
  const cmd = 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/some-foreign-hook.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), false);
});

test('D6.6: does NOT match foreign hook in /.claude/hooks/ with non-claudemd basename', () => {
  const cmd = 'bash "/home/user/.claude/hooks/my-personal-hook.sh"';
  assert.equal(isClaudemdLegacyHookCommand(cmd, CLAUDEMD_HOOK_BASENAMES), false);
});

// --- R11-01 (2026-09-02 audit): writeSettings must preserve the file's shape ---
// settings.json `env` is where users put ANTHROPIC_API_KEY, and the file may be
// a symlink into a dotfiles repo. Pre-fix `writeFileSync(tmp) + rename(tmp, p)`
// created the tmp with the process umask (0600 → 0664 here) and replaced the
// symlink with a regular file, stranding the dotfiles target on old content.

test('R11-01.1: writeSettings preserves a restrictive file mode (0600 stays 0600)', () => {
  fs.writeFileSync(settingsFile(), JSON.stringify({ env: { A: '1' } }, null, 2), { mode: 0o600 });
  fs.chmodSync(settingsFile(), 0o600);
  writeSettings({ env: { A: '2' } });
  assert.equal(fs.statSync(settingsFile()).mode & 0o777, 0o600);
  assert.deepEqual(readSettings(), { env: { A: '2' } });
});

test('R11-01.2: writeSettings writes THROUGH a symlink, leaving the link intact', () => {
  const target = path.join(tmpHome, 'dotfiles-settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ env: { A: '1' } }, null, 2), { mode: 0o600 });
  fs.symlinkSync(target, settingsFile());

  writeSettings({ env: { A: '2' } });

  assert.equal(fs.lstatSync(settingsFile()).isSymbolicLink(), true, 'settings.json must still be a symlink');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(target, 'utf8')),
    { env: { A: '2' } },
    'symlink target must carry the new content'
  );
  assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'target mode preserved');
});

test('R11-01.3: writeSettings leaves no .tmp residue beside the file', () => {
  writeSettings({ env: { A: '1' } });
  const residue = fs.readdirSync(path.join(tmpHome, '.claude')).filter(n => n.includes('.tmp'));
  assert.deepEqual(residue, []);
});
