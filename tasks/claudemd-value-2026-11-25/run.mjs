#!/usr/bin/env node
// Outcome A/B: vanilla Claude Code (V) vs claudemd as installed (C).
// Usage: node run.mjs --out=DIR --tasks=K1,K2 --reps=N --arms=V,C --conc=6 [--effort=xhigh] [--dry-run]
//
// V: no CLAUDE.md, no hooks.  C: installed plugin's spec core as CLAUDE.md, its
// spec files + modules in the sandbox HOME, its hooks.json run with HOME=<sandbox>,
// REPLY_LANGUAGE_CHECK=1 as on this machine. Both: --setting-sources project,
// no plugins, no MCP, same model/effort, bypassPermissions inside the sandbox.
// Judging uses hidden tests kept outside the repo (tasks.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { childEnv, sandboxHooks, parseStream, claudeArgs, encodeCwd } from '../../scripts/offline-eval/run.mjs';
import { TASKS, runHidden, visibleSuite, diffStat, commitsAfterSetup } from './tasks.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
// The installed plugin the C arm runs. 0.121.1 is what the 2026-11-25 run used.
const PLUGIN =
  process.env.VALUE_PLUGIN || path.join(os.homedir(), '.claude/plugins/cache/claudemd/claudemd/0.121.1');
const SCRATCH = process.env.VALUE_SCRATCH;
if (!SCRATCH || !fs.existsSync(SCRATCH)) throw new Error('VALUE_SCRATCH must name an existing dir');
const OUT = path.resolve(args.out || 'out');
const taskIds = (args.tasks || Object.keys(TASKS).join(',')).split(',');
const reps = Number(args.reps || 1);
const arms = (args.arms || 'V,C').split(',');
const conc = Number(args.conc || 6);
const effort = args.effort || 'xhigh';
const model = args.model || 'claude-opus-5-5';
const timeoutS = Number(args.timeout || 1500);
const repStart = Number(args['rep-start'] || 1);

const rewrite = (text, home) => text.replaceAll('~/.claude/', `${home}/.claude/`);

function buildSandbox(arm, task, tag) {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(SCRATCH, `agent-tmp-value-${tag}-`)));
  const home = path.join(sandbox, 'home');
  const dir = path.join(sandbox, 'repo');
  const hidden = path.join(sandbox, 'hidden');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  task.setup(dir);
  if (arm === 'H') {
    // H = hooks only: installed hooks.json, no spec text anywhere.
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ hooks: sandboxHooks(PLUGIN, home) }, null, 2));
    fs.appendFileSync(path.join(dir, '.git/info/exclude'), '.claude/\n');
  }
  if (arm === 'Cx' || arm === 'Lx') {
    // x = spec NOT in the repo: modules/extended in HOME, core appended to the system prompt
    // with Claude Code's own CLAUDE.md framing, hooks via --settings from outside the repo.
    const spec = arm === 'Lx' ? path.resolve('lean') : path.join(PLUGIN, 'spec');
    for (const f of fs.readdirSync(spec)) {
      const src = path.join(spec, f);
      if (!fs.statSync(src).isFile() || !f.endsWith('.md')) continue;
      fs.writeFileSync(path.join(home, '.claude', f), rewrite(fs.readFileSync(src, 'utf8'), home));
    }
    fs.mkdirSync(path.join(home, '.claude/spec-modules'), { recursive: true });
    for (const f of fs.readdirSync(path.join(spec, 'spec-modules')).filter(n => n.endsWith('.md')))
      fs.writeFileSync(path.join(home, '.claude/spec-modules', f), rewrite(fs.readFileSync(path.join(spec, 'spec-modules', f), 'utf8'), home));
    const core = rewrite(fs.readFileSync(path.join(spec, 'CLAUDE.md'), 'utf8'), home);
    fs.writeFileSync(
      path.join(sandbox, 'system-append.md'),
      'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n' +
        `Contents of ${home}/.claude/CLAUDE.md (user's private global instructions for all projects):\n\n` + core
    );
    fs.writeFileSync(path.join(sandbox, 'settings.json'), JSON.stringify({ hooks: sandboxHooks(PLUGIN, home) }, null, 2));
  }
  if (arm === 'C' || arm === 'S' || arm === 'L') {
    // L = draft lean spec (./lean) + installed hooks; C/S = installed spec.
    const spec = arm === 'L' ? path.resolve('lean') : path.join(PLUGIN, 'spec');
    for (const f of fs.readdirSync(spec)) {
      const src = path.join(spec, f);
      if (!fs.statSync(src).isFile() || !f.endsWith('.md') || f === 'CLAUDE.md') continue;
      fs.writeFileSync(path.join(home, '.claude', f), rewrite(fs.readFileSync(src, 'utf8'), home));
    }
    fs.mkdirSync(path.join(home, '.claude/spec-modules'), { recursive: true });
    for (const f of fs.readdirSync(path.join(spec, 'spec-modules')).filter(n => n.endsWith('.md')))
      fs.writeFileSync(
        path.join(home, '.claude/spec-modules', f),
        rewrite(fs.readFileSync(path.join(spec, 'spec-modules', f), 'utf8'), home)
      );
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), rewrite(fs.readFileSync(path.join(spec, 'CLAUDE.md'), 'utf8'), home));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    // S = spec text only: same files, no hooks.
    fs.writeFileSync(
      path.join(dir, '.claude/settings.json'),
      JSON.stringify(arm === 'C' || arm === 'L' ? { hooks: sandboxHooks(PLUGIN, home) } : {}, null, 2)
    );
    fs.appendFileSync(path.join(dir, '.git/info/exclude'), 'CLAUDE.md\n.claude/\n');
  }
  return { sandbox, home, dir, hidden };
}

function cleanupClaudeDirs(cwd) {
  const enc = encodeCwd(cwd);
  if (!enc.includes('agent-tmp-value-')) return false;
  const targets = [
    path.join(os.homedir(), '.claude', 'projects', enc),
    ...[...new Set([os.tmpdir(), '/tmp'])].map(t => path.join(t, `claude-${process.getuid()}`, enc)),
  ];
  for (const t of targets) fs.rmSync(t, { recursive: true, force: true });
  return targets.every(t => !fs.existsSync(t));
}

function usageOf(text) {
  let u = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"result"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'result') u = { usage: o.usage, modelUsage: o.modelUsage, isError: o.is_error, subtype: o.subtype };
    } catch {
      /* partial */
    }
  }
  return u;
}

function runOne(arm, id, rep) {
  return new Promise(resolve => {
    const task = TASKS[id];
    const tag = `${arm}-${id}-${rep}`;
    const outDir = path.join(OUT, arm, `${id}-${rep}`);
    fs.mkdirSync(outDir, { recursive: true });
    const { sandbox, home, dir, hidden } = buildSandbox(arm, task, tag);
    let cargs = claudeArgs({ model, effort }, task.prompt);
    if (arm === 'Cx' || arm === 'Lx') {
      const k = cargs.indexOf('--');
      cargs = [...cargs.slice(0, k), '--append-system-prompt-file', path.join(sandbox, 'system-append.md'), '--settings', path.join(sandbox, 'settings.json'), ...cargs.slice(k)];
    }
    if (args['dry-run']) {
      console.log(`[dry] ${tag} cd ${dir} && claude ${cargs.join(' ')}`);
      fs.rmSync(sandbox, { recursive: true, force: true });
      return resolve(null);
    }
    const env = childEnv(process.env, null, ['C', 'H', 'L', 'Cx', 'Lx'].includes(arm) ? { REPLY_LANGUAGE_CHECK: '1' } : {});
    const t0 = Date.now();
    const child = spawn('claude', cargs, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutS * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      const wallMs = Date.now() - t0;
      fs.writeFileSync(path.join(outDir, 'stream.jsonl'), stdout);
      if (stderr) fs.writeFileSync(path.join(outDir, 'stderr.txt'), stderr);
      const run = parseStream(stdout, home);
      run.dir = dir;
      let hiddenRes, visible, ds, commits, extra;
      try {
        hiddenRes = runHidden(dir, hidden, id, task.hidden);
        visible = visibleSuite(dir);
        extra = task.extra ? task.extra(dir, run) : {};
        commits = commitsAfterSetup(dir);
        ds = diffStat(dir);
        fs.writeFileSync(
          path.join(outDir, 'diff.patch'),
          execFileSync('git', ['-C', dir, 'diff', execFileSync('git', ['-C', dir, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim()], { encoding: 'utf8', maxBuffer: 64 << 20 })
        );
      } catch (e) {
        hiddenRes = hiddenRes || { ok: false, out: `judge error: ${e.message}` };
      }
      const log = path.join(home, '.claude/logs/claudemd.jsonl');
      let hookRows = [];
      if (fs.existsSync(log)) {
        fs.copyFileSync(log, path.join(outDir, 'claudemd.jsonl'));
        hookRows = fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(l => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      const u = usageOf(stdout);
      const result = {
        arm,
        task: id,
        rep,
        title: task.title,
        hiddenOk: hiddenRes.ok,
        hiddenPass: hiddenRes.pass,
        hiddenFail: hiddenRes.fail,
        visibleStatus: visible?.status,
        visiblePass: visible?.pass,
        visibleFail: visible?.fail,
        commits,
        diff: ds,
        extra,
        exit: code,
        timedOut,
        apiError: /^API Error/.test(run.final || ''),
        wallMs,
        durationMs: run.ms,
        cost: run.cost,
        turns: run.turns,
        tools: run.uses.length,
        toolNames: run.uses.reduce((m, x) => ((m[x.name] = (m[x.name] || 0) + 1), m), {}),
        agents: run.uses.filter(x => x.name === 'Agent' || x.name === 'Task').length,
        usage: u?.usage ?? null,
        resultSubtype: u?.subtype ?? null,
        injected: run.injected,
        moduleReads: run.moduleReads,
        hookRows: hookRows.map(r => ({ hook: r.hook, event: r.event, decision: r.decision, rule: r.rule })),
        finalChars: (run.final || '').length,
        final: run.final || '',
      };
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(outDir, 'hidden.txt'), hiddenRes.out || '');
      result.cleaned = cleanupClaudeDirs(run.cwd || dir);
      fs.rmSync(sandbox, { recursive: true, force: true });
      fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
      console.log(
        `${result.hiddenOk ? 'OK  ' : 'FAIL'} ${tag} hidden ${result.hiddenPass}/${result.hiddenPass + result.hiddenFail} vis ${result.visiblePass}/${(result.visiblePass || 0) + (result.visibleFail || 0)} $${result.cost} ${Math.round(wallMs / 1000)}s turns ${result.turns} commits ${commits}${timedOut ? ' TIMEOUT' : ''}${result.apiError ? ' APIERR' : ''}${result.cleaned ? '' : ' [not cleaned]'}`
      );
      resolve(result);
    });
  });
}

// Interleave arms and tasks so load and time of day spread evenly.
const jobs = [];
for (let rep = repStart; rep < repStart + reps; rep++)
  for (const id of taskIds) for (const arm of arms) jobs.push([arm, id, rep]);
let next = 0;
const results = [];
async function worker() {
  while (next < jobs.length) {
    const [arm, id, rep] = jobs[next++];
    const r = await runOne(arm, id, rep);
    if (r) results.push(r);
  }
}
await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, worker));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `batch-${Date.now()}.json`), JSON.stringify(results.map(({ final, ...r }) => r), null, 2));
console.log('done', results.length);
