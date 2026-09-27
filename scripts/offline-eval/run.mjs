#!/usr/bin/env node
// Offline spec evaluation harness (docs/audit/20260926-180700.md 10.10, 12.4).
//
// Runs fixed tasks through `claude -p` with a given spec arm and scores each run
// from its stream-json transcript and the fixture's end state. Isolation, as
// probed on Claude Code 2.1.283 (12.4):
//   * --setting-sources project: only the fixture's CLAUDE.md and
//     .claude/settings.json load — no user spec, no plugins, no user hooks;
//   * the arm's core spec IS the fixture's CLAUDE.md, delivered where a real
//     session gets its CLAUDE.md, with ~/.claude/ rewritten to the sandbox HOME;
//   * this repo's hooks run from the fixture's settings with HOME=<sandbox>, so
//     their logs and state stay in the sandbox while claude keeps its login;
//   * sessions are persisted (a hook reading transcript_path needs the file) and
//     the one projects dir each run creates is deleted afterwards, by exact name;
//   * default tools, --permission-mode bypassPermissions, inside the sandbox only.
//
// Outputs go under --out (default tasks/offline-eval/<arm>), which is not tracked.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from '../lib/argv.js';
import { TASKS } from './tasks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const USAGE = `Usage: node scripts/offline-eval/run.mjs --arm=NAME [--spec-dir=DIR] [--tasks=T1,T2] [--reps=N]
       [--model=ID] [--effort=LEVEL] [--timeout=SECONDS] [--out=DIR] [--dry-run]

Run the offline evaluation tasks through claude -p with one spec arm.

Options:
  --arm=NAME        Label for this arm (output subdirectory).
  --spec-dir=DIR    Directory holding CLAUDE.md, CLAUDE-extended.md and any other
                    spec files for the arm (default: spec/).
  --tasks=LIST      Comma-separated task ids (default: all of ${Object.keys(TASKS).join(',')}).
  --reps=N          Runs per task (default 1).
  --model=ID        Model (default claude-opus-5-5).
  --effort=LEVEL    Effort (default high).
  --timeout=SEC     Per-run limit (default 900).
  --out=DIR         Output root (default tasks/offline-eval).
  --dry-run         Build one fixture per task, print the command, run nothing.
  --help, -h        Print this message and exit.

Exit codes: 0 ran | 1 setup error | 2 argv-shape error.`;

/** Claude Code's projects-dir name for a cwd. */
export const encodeCwd = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** The arm's hooks as project settings: this repo's hooks.json, run with the sandbox HOME. */
export function sandboxHooks(repo, home) {
  const src = JSON.parse(fs.readFileSync(path.join(repo, 'hooks/hooks.json'), 'utf8')).hooks;
  const skip = /session-start-check\.sh|version-sync\.sh/; // install/network side effects; same for every arm
  const out = {};
  for (const [event, groups] of Object.entries(src)) {
    const kept = groups
      .map(g => ({
        ...g,
        hooks: g.hooks
          .filter(h => !skip.test(h.command))
          .map(h => ({
            ...h,
            command:
              `HOME='${home}' CLAUDE_PLUGIN_ROOT='${repo}' DISABLE_UPSTREAM_CHECK=1 ` +
              h.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', repo),
          })),
      }))
      .filter(g => g.hooks.length > 0);
    if (kept.length) out[event] = kept;
  }
  return out;
}

/** Parse a stream-json transcript into what the judges read. */
export function parseStream(text, home) {
  const run = {
    uses: [],
    texts: [],
    final: '',
    cost: null,
    turns: null,
    ms: null,
    sessionId: null,
    cwd: null,
  };
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === 'system' && o.subtype === 'init') {
      run.sessionId = o.session_id ?? null;
      run.cwd = o.cwd ?? null;
    }
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text) run.texts.push(b.text);
        if (b.type === 'tool_use') {
          const u = { name: b.name, input: b.input || {}, id: b.id, isError: false, resultText: '' };
          run.uses.push(u);
          byId.set(b.id, u);
        }
      }
    }
    if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type !== 'tool_result' || !byId.has(b.tool_use_id)) continue;
        const u = byId.get(b.tool_use_id);
        u.isError = b.is_error === true;
        u.resultText = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      }
    }
    if (o.type === 'result') {
      run.final = String(o.result ?? '');
      run.cost = o.total_cost_usd ?? null;
      run.turns = o.num_turns ?? null;
      run.ms = o.duration_ms ?? null;
    }
  }
  const specRoot = path.join(home, '.claude');
  run.specReads = run.uses
    .map((u, index) => {
      const p = u.name === 'Read' ? String(u.input.file_path || '') : '';
      const c = u.name === 'Bash' ? String(u.input.command || '') : '';
      const hit =
        (p.startsWith(specRoot) && p) || (c.includes(specRoot) && /\b(cat|head|sed|less)\b/.test(c) && c);
      return hit ? { index, what: hit } : null;
    })
    .filter(Boolean);
  run.extRead = run.specReads.some(r => r.what.includes('CLAUDE-extended.md'));
  return run;
}

const rewrite = (text, home) => text.replaceAll('~/.claude/', `${home}/.claude/`);

function buildSandbox(specDir, task) {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-oeval-')));
  const home = path.join(sandbox, 'home');
  const dir = path.join(sandbox, 'repo');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  for (const f of fs.readdirSync(specDir)) {
    const src = path.join(specDir, f);
    if (!fs.statSync(src).isFile() || !f.endsWith('.md') || f === 'CLAUDE.md') continue;
    fs.writeFileSync(path.join(home, '.claude', f), rewrite(fs.readFileSync(src, 'utf8'), home));
  }
  const ctx = { sandbox, home, pathPrefix: null };
  task.setup(dir, ctx);
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    rewrite(fs.readFileSync(path.join(specDir, 'CLAUDE.md'), 'utf8'), home)
  );
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude/settings.json'),
    JSON.stringify({ hooks: sandboxHooks(REPO, home) }, null, 2)
  );
  fs.appendFileSync(path.join(dir, '.git/info/exclude'), 'CLAUDE.md\n.claude/\n');
  return { sandbox, home, dir, ctx };
}

function removeOwnProjectsDir(cwd) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const target = path.join(root, encodeCwd(cwd));
  // Exact name derived from this run's own fixture path; never a glob.
  if (path.dirname(target) === root && target.includes('claudemd-test-oeval-')) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  return !fs.existsSync(target);
}

function runOne(opts, id, rep) {
  const task = TASKS[id];
  const { sandbox, home, dir, ctx } = buildSandbox(opts.specDir, task);
  const outDir = path.join(opts.out, opts.arm, `${id}-${rep}`);
  fs.mkdirSync(outDir, { recursive: true });
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--effort',
    opts.effort,
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--permission-mode',
    'bypassPermissions',
    '--',
    task.prompt,
  ];
  if (opts.dryRun) {
    console.log(`[dry-run] ${id}: cd ${dir} && claude ${args.map(a => JSON.stringify(a)).join(' ')}`);
    fs.rmSync(sandbox, { recursive: true, force: true });
    return null;
  }
  const env = { ...process.env, PATH: (ctx.pathPrefix ? `${ctx.pathPrefix}:` : '') + process.env.PATH };
  const t0 = Date.now();
  const r = spawnSync('claude', args, {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: opts.timeout * 1000,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  fs.writeFileSync(path.join(outDir, 'stream.jsonl'), r.stdout || '');
  if (r.stderr) fs.writeFileSync(path.join(outDir, 'stderr.txt'), r.stderr);
  const run = parseStream(r.stdout || '', home);
  run.dir = dir;
  let verdict;
  try {
    verdict = task.judge(run, ctx);
  } catch (e) {
    verdict = { pass: false, why: `judge error: ${e.message}` };
  }
  const cleaned = removeOwnProjectsDir(run.cwd || dir);
  const result = {
    arm: opts.arm,
    task: id,
    rep,
    title: task.title,
    pass: verdict.pass,
    why: verdict.why,
    exit: r.status,
    timedOut: r.error?.code === 'ETIMEDOUT',
    wallMs: Date.now() - t0,
    cost: run.cost,
    turns: run.turns,
    tools: run.uses.length,
    agents: run.uses.filter(u => u.name === 'Agent' || u.name === 'Task').length,
    specReads: run.specReads.map(s => s.what),
    final: run.final.slice(0, 2000),
    projectsDirRemoved: cleaned,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.rmSync(sandbox, { recursive: true, force: true });
  return result;
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const p = parseStrictOrExit(process.argv.slice(2), {
    bools: ['--dry-run'],
    values: ['--arm', '--spec-dir', '--tasks', '--reps', '--model', '--effort', '--timeout', '--out'],
  });
  const opts = {
    arm: p.values['--arm'],
    specDir: path.resolve(p.values['--spec-dir'] || path.join(REPO, 'spec')),
    tasks: (p.values['--tasks'] || Object.keys(TASKS).join(',')).split(','),
    reps: Number(p.values['--reps'] || 1),
    model: p.values['--model'] || 'claude-opus-5-5',
    effort: p.values['--effort'] || 'high',
    timeout: Number(p.values['--timeout'] || 900),
    out: path.resolve(p.values['--out'] || path.join(REPO, 'tasks/offline-eval')),
    dryRun: p.bools.has('--dry-run'),
  };
  const bad = [];
  if (!opts.arm || !/^[A-Za-z0-9._-]+$/.test(opts.arm)) bad.push('--arm must be a plain name');
  if (!fs.existsSync(path.join(opts.specDir, 'CLAUDE.md'))) bad.push(`no CLAUDE.md in ${opts.specDir}`);
  for (const t of opts.tasks) if (!TASKS[t]) bad.push(`unknown task ${t}`);
  if (!Number.isInteger(opts.reps) || opts.reps < 1) bad.push('--reps must be a positive integer');
  if (!Number.isInteger(opts.timeout) || opts.timeout < 30) bad.push('--timeout must be an integer >= 30');
  if (bad.length) {
    console.error(`offline-eval: ${bad.join('; ')}`);
    process.exit(1);
  }
  const results = [];
  for (const id of opts.tasks) {
    for (let rep = 1; rep <= opts.reps; rep++) {
      const r = runOne(opts, id, rep);
      if (!r) continue;
      results.push(r);
      console.log(
        `${r.pass ? 'PASS' : 'FAIL'} ${id}#${rep} ${r.title} — ${r.why} | $${r.cost ?? '?'} ${r.turns ?? '?'} turns ${Math.round(r.wallMs / 1000)}s` +
          (r.timedOut ? ' TIMEOUT' : '') +
          (r.projectsDirRemoved ? '' : ' [projects dir NOT removed]')
      );
    }
  }
  if (results.length) {
    const summary = {
      arm: opts.arm,
      model: opts.model,
      effort: opts.effort,
      runs: results.length,
      passed: results.filter(r => r.pass).length,
      costUsd: Number(results.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4)),
      results: results.map(({ task, rep, pass, why, cost, turns, wallMs, agents }) => ({
        task,
        rep,
        pass,
        why,
        cost,
        turns,
        wallMs,
        agents,
      })),
    };
    fs.writeFileSync(
      path.join(opts.out, opts.arm, `summary-${Date.now()}.json`),
      JSON.stringify(summary, null, 2)
    );
    console.log(`${opts.arm}: ${summary.passed}/${summary.runs} passed, total_cost_usd ${summary.costUsd}`);
  }
}
