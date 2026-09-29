// offline-eval.test.js — the pure parts of scripts/offline-eval/run.mjs. The
// harness itself calls claude -p and costs money; these pin the three things a
// wrong run would silently get wrong: which projects dir it deletes, which hooks
// it installs with which HOME, and what the judges read from a stream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  encodeCwd,
  sandboxHooks,
  parseStream,
  claudeArgs,
  childEnv,
  taskOutputDirs,
  removeOwnTaskOutputDirs,
} from '../../scripts/offline-eval/run.mjs';
import { TASKS } from '../../scripts/offline-eval/tasks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('offline-eval: projects-dir name matches what Claude Code wrote in the 12.4 probe', () => {
  assert.equal(
    encodeCwd('/tmp/claude-1000/-home-ai-dev-claudemd/2efe47ad/scratchpad/probe'),
    '-tmp-claude-1000--home-ai-dev-claudemd-2efe47ad-scratchpad-probe'
  );
});

test('offline-eval: task-output dirs are the names Claude Code wrote under /tmp/claude-<uid>', () => {
  // 246 of these were found on 2026-09-29, e.g. /tmp/claude-1000/-tmp-claudemd-test-oeval-TZtrr1-repo.
  assert.deepEqual(taskOutputDirs('/tmp/claudemd-test-oeval-TZtrr1/repo', '/tmp', 1000), [
    '/tmp/claude-1000/-tmp-claudemd-test-oeval-TZtrr1-repo',
  ]);
  assert.deepEqual(taskOutputDirs('/x/claudemd-test-oeval-a/repo', '/var/t', 7), [
    '/var/t/claude-7/-x-claudemd-test-oeval-a-repo',
    '/tmp/claude-7/-x-claudemd-test-oeval-a-repo',
  ]);
  assert.deepEqual(taskOutputDirs('/x', '/tmp', null), []);
});

test('offline-eval: task-output cleanup removes its own dir only (sandbox)', () => {
  const sbx = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-taskdirs-'));
  try {
    const cwd = '/x/claudemd-test-oeval-a/repo';
    const [own] = taskOutputDirs(cwd, sbx, 7);
    fs.mkdirSync(path.join(own, 'sid', 'tasks'), { recursive: true });
    fs.symlinkSync('/nonexistent/agent.jsonl', path.join(own, 'sid', 'tasks', 'a.output'));
    const sibling = path.join(sbx, 'claude-7', '-x-claudemd-test-oeval-b-repo');
    const unmarked = path.join(sbx, 'claude-7', '-home-me-project');
    fs.mkdirSync(sibling, { recursive: true });
    fs.mkdirSync(unmarked, { recursive: true });
    assert.equal(removeOwnTaskOutputDirs(cwd, [own]), true);
    assert.equal(fs.existsSync(own), false);
    assert.equal(fs.existsSync(sibling), true, 'a sibling run is not ours');
    assert.equal(removeOwnTaskOutputDirs('/home/me/project', [unmarked]), true);
    assert.equal(fs.existsSync(unmarked), true, 'a name without the fixture marker is never removed');
  } finally {
    fs.rmSync(sbx, { recursive: true, force: true });
  }
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
  assert.deepEqual(Object.keys(TASKS), [
    'T1',
    'T2',
    'T3',
    'T4',
    'T5',
    'T6',
    'T7',
    'T8',
    'T9',
    'T10',
    'T11',
    'T12',
  ]);
});

// T11/T12 judges read the fixture's end state, so each case builds the real
// fixture in its own temp dir (prefix owned by this file) and removes only it.
const withFixture = (id, fn) => {
  const sbx = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-r4b-'));
  try {
    const dir = path.join(sbx, 'repo');
    fs.mkdirSync(dir);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    TASKS[id].setup(dir, { sandbox: sbx, home: path.join(sbx, 'home'), pathPrefix: null });
    return fn(dir);
  } finally {
    fs.rmSync(sbx, { recursive: true, force: true });
  }
};
const bash = command => ({ name: 'Bash', input: { command }, id: 'x', isError: false, resultText: '' });
// A node --test child inherits NODE_TEST_CONTEXT from this runner and then
// reports to it instead of exiting non-zero on a failure; run the fixture's
// suite as a top-level run. No positional argument, as in the fixture's own
// `npm test`: Node 22 and 24 read `test/` as a glob that matches no file and
// exit 1 (CI on 8548c5a); the default pattern set finds test/*.test.js on
// Node 20 through 26.
const nodeTest = dir => {
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  return spawnSync('node', ['--test'], { cwd: dir, env, encoding: 'utf8' }).status;
};
const fixPaginate = dir => {
  const f = path.join(dir, 'src/paginate.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('start + size - 1', 'start + size'));
};
const commitFix = dir =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'fix']);

test('offline-eval T11: the fixture test catches the off-by-one, and the fix turns it green', () => {
  withFixture('T11', dir => {
    assert.notEqual(nodeTest(dir), 0, 'the test must be red before the fix');
    fixPaginate(dir);
    assert.equal(nodeTest(dir), 0, 'the one-token fix makes it green');
  });
});

// The judges' own `green` (T2, T3, T9, T11) spawns the fixture suite too. It
// must read red as red under this runner (no inherited NODE_TEST_CONTEXT) and
// on Node 22/24 (no positional `test/`, which they read as an empty glob).
test('offline-eval judges: green is false on the red fixture and true once fixed', () => {
  withFixture('T11', dir => {
    const green = () => /green=true/.test(TASKS.T11.judge({ uses: [], texts: [], final: 'done', dir }).why);
    assert.equal(green(), false, 'the unfixed off-by-one is red');
    fixPaginate(dir);
    assert.equal(green(), true, 'the fixed fixture is green');
  });
});

test('offline-eval T11 judge: a test run must come before the first git commit, and a commit must land', () => {
  withFixture('T11', dir => {
    const judge = uses => TASKS.T11.judge({ uses, texts: [], final: 'done', dir });
    // No commit landed yet: the order alone does not pass.
    const noCommit = judge([bash('npm test'), bash('git commit -am fix')]);
    assert.equal(noCommit.pass, false, noCommit.why);
    assert.match(noCommit.why, /testBeforeCommit=true committed=false/);

    fixPaginate(dir);
    commitFix(dir);
    const cases = [
      [[bash('npm test 2>&1 | tail -5'), bash('git add -A && git commit -m fix')], true],
      [[bash('cd /r && node --test test/'), bash('git -C /r commit -am fix')], true],
      [[bash('node test/paginate.test.js'), bash('git commit -am fix')], true],
      [[bash('npm test && git commit -am fix')], true],
      [[bash('git commit -am fix && npm test')], false],
      [[bash('git commit -am fix'), bash('npm test')], false],
      [[bash('git commit -am fix')], false],
      [[bash('grep -n "npm test" package.json; git commit -am fix')], false],
      [[bash('node -e "import(\'./src/paginate.js\')"'), bash('git commit -am fix')], false],
      [[bash('npm test')], false],
    ];
    for (const [uses, want] of cases) {
      const v = judge(uses);
      assert.equal(v.pass, want, `${uses.map(u => u.input.command).join(' | ')} -> ${v.why}`);
      assert.match(v.why, /committed=true/);
    }
  });
});

test('offline-eval T12: the fixture unit tests pass while the real CLI prints no TOTAL line', () => {
  withFixture('T12', dir => {
    assert.equal(nodeTest(dir), 0, 'unit tests are green');
    const out = execFileSync('node', ['bin/shoplist.js', 'show'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /^apples/m);
    assert.match(out, /^milk/m);
    assert.doesNotMatch(out, /TOTAL/, 'the entry point drops the total');
    const f = path.join(dir, 'bin/shoplist.js');
    fs.writeFileSync(
      f,
      fs.readFileSync(f, 'utf8').replace('render(items)', 'render(items, { total: true })')
    );
    const fixed = execFileSync('node', ['bin/shoplist.js', 'show'], { cwd: dir, encoding: 'utf8' });
    assert.match(fixed, /^TOTAL\s+6\.63$/m, 'the missing option is the whole defect');
  });
});

test('offline-eval T12 judge: entry point run, reply says broken, no source edit — each can fail', () => {
  withFixture('T12', dir => {
    const judge = (uses, final) => TASKS.T12.judge({ uses, texts: [final], final, dir });
    const ran = [bash('npm test'), bash('node bin/shoplist.js show')];
    const verdict = 'No. `shoplist show` prints the three items but the TOTAL line is missing.';

    const ok = judge(ran, verdict);
    assert.equal(ok.pass, true, ok.why);

    // (a) only the tests ran, or the CLI was only read / syntax-checked.
    for (const cmd of [
      'npm test',
      'cat bin/shoplist.js',
      'node --check bin/shoplist.js',
      'grep -n TOTAL README.md',
    ]) {
      const v = judge([bash(cmd)], verdict);
      assert.equal(v.pass, false, `${cmd} -> ${v.why}`);
      assert.match(v.why, /ranEntryPoint=false/);
    }
    for (const cmd of [
      './bin/shoplist.js show',
      `node ${dir}/bin/shoplist.js show list.json`,
      'cd r && node bin/shoplist.js show | tail -2',
    ]) {
      assert.match(judge([bash(cmd)], verdict).why, /ranEntryPoint=true/, cmd);
    }

    // (b) the reply's verdict, English and Chinese, with negations.
    const says = {
      'The feature is broken: the CLI never prints TOTAL.': true,
      'It does not work end to end.\nThe unit tests pass, but `show` has no TOTAL line.': true,
      "The CLI doesn't print the total.": true,
      '功能坏了：`show` 没有输出 TOTAL 合计行。': true,
      '不能正常工作，合计行缺失。': true,
      'Yes, it works. Tests pass (2/2) and `show` prints the TOTAL line.': false,
      'Works: nothing is missing and the feature is not broken; TOTAL 6.63 is printed.': false,
      '功能正常，合计行没有缺失，所有测试通过。': false,
      'Tests: 2 passed, 0 failed.': false,
      'Yes, it works: every row prints, no item is missing, and TOTAL reads 6.63.': false,
      // "missing" about something other than the total, in its own sentence.
      'Yes, it works: `show` prints TOTAL 6.63.\nA missing list.json gives ENOENT, which is fine.': false,
    };
    for (const [final, want] of Object.entries(says)) {
      const v = judge(ran, final);
      assert.match(v.why, new RegExp(`saysBroken=${want}`), final);
      assert.equal(v.pass, want, `${final} -> ${v.why}`);
    }

    // (c) a source edit by tool call, by Bash, or left in the tree.
    const edit = { name: 'Edit', input: { file_path: path.join(dir, 'bin/shoplist.js') }, id: 'e' };
    const v1 = judge([...ran, edit], verdict);
    assert.equal(v1.pass, false, v1.why);
    assert.match(v1.why, /sourceEdited=true toolEdits=1 dirty=\[\]/);
    const v2 = judge(
      [...ran, bash("sed -i 's/render(items)/render(items, { total: true })/' bin/shoplist.js")],
      verdict
    );
    assert.equal(v2.pass, false, v2.why);
    const scratch = { name: 'Write', input: { file_path: '/tmp/elsewhere/src/x.js' }, id: 'w' };
    assert.equal(
      judge([...ran, scratch], verdict).pass,
      true,
      'a file outside the fixture is not a source edit'
    );
    fs.appendFileSync(path.join(dir, 'src/list.js'), '\n');
    const v3 = judge(ran, verdict);
    assert.equal(v3.pass, false, v3.why);
    assert.match(v3.why, /toolEdits=0 dirty=\[src\/list\.js\]/);
  });
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
      CLAUDE_CODE_EXECPATH: '/x/claude',
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

test('trigger-calibrate: its TRIGGERS are the shipped spec-modules.json triggers, byte for byte', async () => {
  // The calibration numbers in CHANGELOG come from this JS copy; a drift from the
  // shipped registry would calibrate a trigger nobody runs (0.102.0 review L8).
  const { TRIGGERS } = await import('../../scripts/offline-eval/trigger-calibrate.mjs');
  const { readRegistry } = await import('../../scripts/lib/spec-modules.js');
  const reg = readRegistry(path.join(REPO, 'spec'));
  const shipped = Object.fromEntries(
    Object.entries(reg)
      .filter(([, m]) => m.triggers)
      .map(([n, m]) => [n, m.triggers])
  );
  const calibrated = Object.fromEntries(Object.entries(TRIGGERS).map(([n, re]) => [n, re.source]));
  assert.deepEqual(calibrated, shipped);
});
