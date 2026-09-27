// offline-eval.test.js — the pure parts of scripts/offline-eval/run.mjs. The
// harness itself calls claude -p and costs money; these pin the three things a
// wrong run would silently get wrong: which projects dir it deletes, which hooks
// it installs with which HOME, and what the judges read from a stream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeCwd,
  sandboxHooks,
  parseStream,
  claudeArgs,
  childEnv,
} from '../../scripts/offline-eval/run.mjs';
import { TASKS } from '../../scripts/offline-eval/tasks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('offline-eval: projects-dir name matches what Claude Code wrote in the 12.4 probe', () => {
  assert.equal(
    encodeCwd('/tmp/claude-1000/-home-ai-dev-claudemd/2efe47ad/scratchpad/probe'),
    '-tmp-claude-1000--home-ai-dev-claudemd-2efe47ad-scratchpad-probe'
  );
});

test('offline-eval: hooks run from this repo with the sandbox HOME; install hooks are left out', () => {
  const h = sandboxHooks(REPO, '/sbx/home');
  const cmds = Object.values(h).flatMap(gs => gs.flatMap(g => g.hooks.map(x => x.command)));
  assert.ok(cmds.length >= 15, `expected the plugin's hooks, got ${cmds.length}`);
  for (const c of cmds) {
    assert.ok(c.startsWith("HOME='/sbx/home' "), c);
    assert.ok(!c.includes('${CLAUDE_PLUGIN_ROOT}'), c);
    assert.ok(c.includes(`${REPO}/hooks/`), c);
  }
  assert.ok(!cmds.some(c => /session-start-check|version-sync/.test(c)));
  assert.ok(
    cmds.some(c => c.includes('pre-bash-safety-check.sh')),
    'the §8 gate is installed'
  );
});

test('offline-eval: parseStream pairs tool results, reads cost, and finds spec reads', () => {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 's1', cwd: '/sbx/repo' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          {
            type: 'tool_use',
            id: 'a',
            name: 'Read',
            input: { file_path: '/sbx/home/.claude/CLAUDE-extended.md' },
          },
        ],
      },
    },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] } },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'rm -rf "$OUT"' } }],
      },
    },
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'b', content: '§8 SAFETY: denied', is_error: true }],
      },
    },
    { type: 'result', result: 'done', total_cost_usd: 0.5, num_turns: 3, duration_ms: 1000 },
  ].map(o => JSON.stringify(o));
  const r = parseStream(lines.join('\n'), '/sbx/home');
  assert.equal(r.uses.length, 2);
  assert.equal(r.uses[1].isError, true);
  assert.match(r.uses[1].resultText, /§8/);
  assert.equal(r.extRead, true);
  assert.deepEqual([r.cost, r.turns, r.final, r.cwd], [0.5, 3, 'done', '/sbx/repo']);
});

test('offline-eval: every task has a prompt, a setup and a judge', () => {
  for (const [id, t] of Object.entries(TASKS)) {
    assert.equal(typeof t.prompt, 'string', id);
    assert.equal(typeof t.setup, 'function', id);
    assert.equal(typeof t.judge, 'function', id);
  }
  assert.deepEqual(Object.keys(TASKS), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']);
});

test('trigger-calibrate: ship reads the whole prompt, other modules only its head', async () => {
  const { windowFor, measure } = await import('../../scripts/offline-eval/trigger-calibrate.mjs');
  const long = 'x'.repeat(400) + ' please fix the bug and ship it';
  assert.equal(windowFor('ship', long, 300), long);
  assert.equal(windowFor('debug', long, 300).length, 300);
  const m = measure([{ prompts: [{ idx: 1, text: long }], firstRelease: 2 }], 300);
  assert.deepEqual([m.perModule.ship, m.perModule.debug, m.shipRecall], [1, 0, '1/1']);
});

test('offline-eval: parseStream counts tier-2 injections from UserPromptSubmit hook output', async () => {
  const { specBytes } = await import('../../scripts/offline-eval/run.mjs');
  const ctx =
    '[claudemd] system-injected — spec module `ship`\n\n<spec-module name="ship">\nrules\n</spec-module>\n';
  const out = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
  });
  const lines = [
    { type: 'system', subtype: 'hook_response', hook_event: 'UserPromptSubmit', output: out },
    { type: 'system', subtype: 'hook_response', hook_event: 'UserPromptSubmit', output: '{}' },
    { type: 'result', result: 'ok' },
  ].map(o => JSON.stringify(o));
  const r = parseStream(lines.join('\n'), '/sbx/home');
  assert.deepEqual(r.injected, ['ship']);
  assert.equal(r.injectedBytes, Buffer.byteLength(ctx));
  assert.equal(specBytes(r, '/sbx/home'), Buffer.byteLength(ctx), 'no file read: only the injection counts');
  assert.equal(r.moduleReads, 0);
});

test('offline-eval: claude -p is asked for hook events, or tier-2 injections go unrecorded', () => {
  const args = claudeArgs({ model: 'm', effort: 'high' }, 'ship it');
  assert.ok(args.includes('--include-hook-events'), args.join(' '));
  assert.equal(args.at(-1), 'ship it');
  assert.equal(args.at(-2), '--');
});

test('offline-eval: runs never inherit coordinator mode or the calling session', () => {
  // ~/.bashrc here exports CLAUDE_CODE_COORDINATOR_MODE=1; inherited, it left
  // main with 6 tools and no Read/Edit/Bash, so every B4-B7 run had to delegate
  // to a worker (tasks/specs/v7.1-core.md, harness finding).
  const env = childEnv(
    {
      PATH: '/usr/bin',
      LANG: 'C',
      CLAUDE_CODE_COORDINATOR_MODE: '1',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_MESSAGING_SOCKET: '/x',
      CLAUDE_CODE_MESSAGING_TOKEN: 't',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_PID: '1',
      CLAUDE_EFFORT: 'max',
    },
    '/sbx/bin'
  );
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'LANG', 'PATH']);
  assert.equal(env.PATH, '/sbx/bin:/usr/bin');
  assert.equal(childEnv({ PATH: '/usr/bin' }, null).PATH, '/usr/bin');
});

test('offline-eval: parseStream records the tools main was given', () => {
  const text = JSON.stringify({ type: 'system', subtype: 'init', tools: ['Task', 'Bash', 'Read'] });
  assert.deepEqual(parseStream(text, '/sbx/home').mainTools, ['Task', 'Bash', 'Read']);
});
