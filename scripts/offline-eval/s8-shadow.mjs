#!/usr/bin/env node
// Shadow comparison of the §8 rm-rf-var rule: the shipped text gate
// (hooks/pre-bash-safety-check.sh) against the parsed-AST arm in
// scripts/offline-eval/s8-ast/ (shfmt --to-json + jq). Proposal R2 step 1,
// docs/oss-benchmark-2026-09-28.md. Offline research: nothing here is a hook,
// and no runtime verdict depends on it.
//
// Every command is only ANALYZED. The gate reads it as a PreToolUse event on
// stdin; the AST arm reads it on stdin and hands it to shfmt. Neither runs it.
// The gate runs with a sandbox HOME and TMPDIR, DISABLE_RULE_HITS_LOG=1, and
// every DISABLE_* / CLAUDEMD_* / BASH_SAFETY* / BASH_READONLY* knob removed from
// the environment, so it takes its shipped defaults and writes nothing outside
// the sandbox, which is deleted on exit.
//
// Only commands that contain an `rm` or `find` word are compared: the AST arm
// judges the rm rule and nothing else, so a gate deny for another §8 section
// (npx, curl|sh) counts as an rm allow here and is flagged `gateOtherDeny`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit, parsePositiveInt } from '../lib/argv.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AST_ARM = path.join(REPO, 'scripts/offline-eval/s8-ast/ast-rm.sh');
const DEFAULT_CORPUS = path.join(REPO, 'tests/fixtures/bash-safety/corpus.tsv');

const USAGE = `Usage: node scripts/offline-eval/s8-shadow.mjs [--corpus=PATH] [--cmds=PATH] [--hook-dir=DIR]
       [--jobs=N] [--sample=N] [--gate-cache=PATH] [--json]

Compare the §8 rm-rf-var verdicts of the text gate and the shfmt AST arm.
Commands are analyzed, never executed. Requires SHFMT (shfmt >= 3.14.0) in the
environment; nothing is downloaded.

Options:
  --corpus=PATH      A corpus.tsv (label, note, command, env). Default when no
                     --cmds is given: tests/fixtures/bash-safety/corpus.tsv.
  --cmds=PATH        A JSON array of command strings (e.g. a replay set).
  --hook-dir=DIR     Directory holding pre-bash-safety-check.sh and lib/
                     (default: this checkout's hooks/). Pass a snapshot
                     (git archive <sha> hooks) for a baseline that cannot move.
  --jobs=N           Parallel commands (default 8). Use 1 for latency figures.
  --sample=N         Compare N commands drawn with a fixed seed.
  --gate-cache=PATH  Reuse gate verdicts from PATH and write new ones back;
                     keyed by the hook files' sha256, so a changed gate starts empty.
  --json             Machine-readable output, including every disagreement.
  --help, -h         Print this message and exit.

Exit codes: 0 compared | 1 setup error (shfmt, hook dir, input) | 2 argv-shape error.`;

export const CLASSES = [
  'both-deny',
  'both-allow',
  'gate-only-deny',
  'ast-only-deny',
  'ast-parse-error',
  'error',
];

/** Does the command contain `rm` or `find` as a word (`/bin/rm` and `\rm` included)? */
export const mentionsRmOrFind = cmd => /(^|[^A-Za-z0-9_.-])(rm|find)(?![A-Za-z0-9_.-])/.test(cmd);

/** corpus.tsv rows: label, note, command (`__NL__` → LF), env. Comments and blanks skipped. */
export function parseCorpus(text) {
  const rows = [];
  text.split('\n').forEach((line, i) => {
    if (!line || line.startsWith('#')) return;
    const [label, note = '', command = '', env = ''] = line.split('\t');
    if (!label) return;
    rows.push({ line: i + 1, label, note, command: command.replaceAll('__NL__', '\n'), env });
  });
  return rows;
}

/** The environment one gate run sees: the caller's minus every claudemd knob,
 *  with the sandbox HOME/TMPDIR and telemetry off, then the corpus row's own
 *  env column applied (`KEY=VAL` sets, `-KEY` unsets), as the hook suite does. */
export function gateEnv(base, { home, tmpdir }, rowEnv = '') {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(DISABLE_|CLAUDEMD_|BASH_SAFETY|BASH_READONLY)/.test(k)) continue;
    env[k] = v;
  }
  env.HOME = home;
  env.TMPDIR = tmpdir;
  env.DISABLE_RULE_HITS_LOG = '1';
  for (const tok of rowEnv.split(/\s+/).filter(Boolean)) {
    if (tok.length > 1 && tok.startsWith('-')) delete env[tok.slice(1)];
    else if (tok.indexOf('=') > 0) env[tok.slice(0, tok.indexOf('='))] = tok.slice(tok.indexOf('=') + 1);
  }
  return env;
}

// A deny bullet the rm arm wrote: `  - rm -rf with unvalidated $X`, `  - rm -f
// target leaves $X through …`, `  - find … -delete/-exec rm on bare $HOME …`.
const RM_BULLET = /^ {2}- (rm (-\S+|--recursive|--force)|find … -delete\/-exec rm)(\s|$)/;
const RM_VAR = [
  /\$(\S+) (?:whose only subpath|with no subpath)/,
  /with unvalidated \$(\S+)$/,
  /target leaves \$(\S+) through/,
  /on bare \$(\S+) with no selection primary/,
];

/** The gate's stdout → { verdict: deny|allow|error, rm, vars, other }.
 *  `rm` is true when at least one deny bullet came from the rm arm; `other`
 *  when a bullet came from another §8 section. */
export function parseGateOutput(stdout, code = 0) {
  const out = String(stdout || '').trim();
  if (!out)
    return code === 0
      ? { verdict: 'allow', rm: false, vars: [], other: false }
      : { verdict: 'error', rm: false, vars: [], other: false, detail: `exit ${code}, empty stdout` };
  let d;
  try {
    d = JSON.parse(out)?.hookSpecificOutput;
  } catch {
    return { verdict: 'error', rm: false, vars: [], other: false, detail: 'stdout is not JSON' };
  }
  if (d?.permissionDecision !== 'deny') return { verdict: 'allow', rm: false, vars: [], other: false };
  const bullets = String(d.permissionDecisionReason || '')
    .split('\n')
    .filter(l => l.startsWith('  - '));
  const rmBullets = bullets.filter(l => RM_BULLET.test(l));
  const vars = [];
  for (const b of rmBullets) {
    for (const re of RM_VAR) {
      const m = b.match(re);
      if (m) {
        vars.push(m[1].replace(/[.:]$/, ''));
        break;
      }
    }
  }
  return {
    verdict: 'deny',
    rm: rmBullets.length > 0,
    vars: [...new Set(vars)].sort(),
    other: rmBullets.length < bullets.length,
  };
}

/** ast-rm.sh's stdout → { verdict: deny|allow|parse-error|error, vars }. */
export function parseAstOutput(stdout, code = 0) {
  const out = String(stdout || '').trim();
  if (code === 0 && out === 'allow') return { verdict: 'allow', vars: [] };
  if (code === 0 && out === 'parse-error') return { verdict: 'parse-error', vars: [] };
  const m = code === 0 ? out.match(/^deny (.+)$/) : null;
  if (m) return { verdict: 'deny', vars: m[1].split(/\s+/).filter(Boolean).sort() };
  return { verdict: 'error', vars: [], detail: `exit ${code}: ${out.slice(0, 200)}` };
}

/** One consistency class per command, from the two parsed verdicts. */
export function classify(gate, ast) {
  if (gate.verdict === 'error' || ast.verdict === 'error') return 'error';
  if (ast.verdict === 'parse-error') return 'ast-parse-error';
  const g = gate.verdict === 'deny' && gate.rm;
  const a = ast.verdict === 'deny';
  if (g && a) return 'both-deny';
  if (g) return 'gate-only-deny';
  if (a) return 'ast-only-deny';
  return 'both-allow';
}

const emptyTable = () => Object.fromEntries(CLASSES.map(c => [c, 0]));

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Aggregate compared rows ({source, label?, class, gate, ast, msGate, msAst}). */
export function summarize(rows) {
  const table = emptyTable();
  const bySource = {};
  const byLabel = {};
  let varsDiffer = 0;
  let gateOtherOnly = 0;
  for (const r of rows) {
    table[r.class]++;
    if (r.gate.verdict === 'deny' && !r.gate.rm) gateOtherOnly++;
    (bySource[r.source] ??= emptyTable())[r.class]++;
    if (r.label) (byLabel[r.label] ??= emptyTable())[r.class]++;
    if (r.class === 'both-deny' && r.gate.vars.join(' ') !== r.ast.vars.join(' ')) varsDiffer++;
  }
  const lab = (label, pred) => {
    const xs = rows.filter(r => r.label === label);
    return { of: xs.length, n: xs.filter(pred).length };
  };
  const lat = key => {
    const xs = rows
      .map(r => r[key])
      .filter(x => typeof x === 'number')
      .sort((a, b) => a - b);
    return {
      n: xs.length,
      p50: percentile(xs, 0.5),
      p99: percentile(xs, 0.99),
      max: xs.length ? xs[xs.length - 1] : null,
    };
  };
  return {
    table,
    bySource,
    byLabel,
    bothDenyVarsDiffer: varsDiffer,
    // The gate denied for another §8 section only (npx, curl|sh): an rm allow here.
    gateOtherDenyOnly: gateOtherOnly,
    residuals: {
      xfnAstDeny: lab('xfn', r => r.ast.verdict === 'deny'),
      xfpAstAllow: lab('xfp', r => r.ast.verdict === 'allow'),
      passAstDeny: lab('pass', r => r.ast.verdict === 'deny'),
    },
    latencyMs: { gate: lat('msGate'), ast: lat('msAst') },
  };
}

/** Deterministic sample of n items (mulberry32, fixed seed). */
export function sample(items, n, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function runProc(file, { input, env, cwd, timeoutMs }) {
  return new Promise(resolve => {
    const t0 = process.hrtime.bigint();
    const child = spawn('bash', [file], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.stdin.on('error', () => {}); // a child that exits early closes its stdin
    child.on('close', code => {
      clearTimeout(timer);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      resolve({ code: timedOut ? -1 : code, stdout, stderr, ms, timedOut });
    });
    child.stdin.end(input);
  });
}

function hookHash(hookDir) {
  const h = crypto.createHash('sha256');
  const files = [
    'pre-bash-safety-check.sh',
    ...fs.readdirSync(path.join(hookDir, 'lib')).map(f => `lib/${f}`),
  ].sort();
  for (const f of files) {
    const p = path.join(hookDir, f);
    if (fs.statSync(p).isFile()) h.update(f).update('\0').update(fs.readFileSync(p));
  }
  return h.digest('hex');
}

const cacheKey = (command, env) => crypto.createHash('sha256').update(`${command}\0${env}`).digest('hex');

async function pool(items, jobs, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  return out;
}

const oneLine = (s, n = 160) => {
  const t = s.replaceAll('\n', ' ⏎ ');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function fail(msg) {
  console.error(`s8-shadow: ${msg}`);
  process.exit(1);
}

if (invokedAsMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const p = parseStrictOrExit(argv, {
    bools: ['--json'],
    values: ['--corpus', '--cmds', '--hook-dir', '--jobs', '--sample', '--gate-cache'],
  });
  const jobs = p.values['--jobs'] === undefined ? 8 : parsePositiveInt(p.values['--jobs']);
  if (jobs === null) fail(`--jobs must be a positive integer (got '${p.values['--jobs']}').`);
  const sampleN = p.values['--sample'] === undefined ? null : parsePositiveInt(p.values['--sample']);
  if (p.values['--sample'] !== undefined && sampleN === null)
    fail(`--sample must be a positive integer (got '${p.values['--sample']}').`);
  const hookDir = path.resolve(p.values['--hook-dir'] || path.join(REPO, 'hooks'));
  const hook = path.join(hookDir, 'pre-bash-safety-check.sh');
  if (!fs.existsSync(hook) || !fs.existsSync(path.join(hookDir, 'lib')))
    fail(`no pre-bash-safety-check.sh + lib/ under ${hookDir}.`);
  const corpusPath = p.values['--corpus'] || (p.values['--cmds'] ? null : DEFAULT_CORPUS);

  const items = [];
  try {
    if (corpusPath) {
      for (const r of parseCorpus(fs.readFileSync(corpusPath, 'utf8'))) {
        if (mentionsRmOrFind(r.command)) items.push({ source: 'corpus', ...r });
      }
    }
    if (p.values['--cmds']) {
      const cmds = JSON.parse(fs.readFileSync(p.values['--cmds'], 'utf8'));
      if (!Array.isArray(cmds) || cmds.some(c => typeof c !== 'string'))
        throw new Error(`${p.values['--cmds']} is not a JSON array of strings`);
      cmds.forEach((command, index) => {
        if (mentionsRmOrFind(command)) items.push({ source: 'cmds', index, command, env: '' });
      });
    }
  } catch (e) {
    fail(e.message);
  }
  const chosen = sampleN ? sample(items, sampleN) : items;

  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-r2shadow-')));
  const cleanup = () => fs.rmSync(sandbox, { recursive: true, force: true });
  process.on('exit', cleanup);
  // Interrupted: remove the sandbox, then die of the same signal (no exit code of our own).
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      cleanup();
      process.kill(process.pid, sig);
    });
  }
  const home = path.join(sandbox, 'home');
  const tmpdir = path.join(sandbox, 'tmp');
  fs.mkdirSync(home);
  fs.mkdirSync(tmpdir);

  // The arm refuses (exit 2) without a usable shfmt; ask it once, up front.
  const probe = await runProc(AST_ARM, { input: 'true', env: process.env, cwd: sandbox, timeoutMs: 30000 });
  if (probe.code !== 0) fail(`the AST arm cannot run:\n${probe.stderr.trim()}`);

  const hash = hookHash(hookDir);
  const cachePath = p.values['--gate-cache'];
  let cache = { hookHash: hash, verdicts: {} };
  if (cachePath && fs.existsSync(cachePath)) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (c.hookHash === hash && c.verdicts) cache = c;
    } catch {
      /* unreadable cache: start empty */
    }
  }

  const rows = await pool(chosen, jobs, async it => {
    // One environment for both arms: the AST arm honours the same switches
    // (kill switch, BASH_SAFETY_INDIRECT_CALL=0) a corpus row may set.
    const env = gateEnv(process.env, { home, tmpdir }, it.env);
    const key = cacheKey(it.command, it.env);
    let gateRaw = cache.verdicts[key];
    let msGate = null;
    if (!gateRaw) {
      const event = JSON.stringify({
        session_id: 't',
        tool_name: 'Bash',
        tool_input: { command: it.command },
      });
      const g = await runProc(hook, { input: event, env, cwd: sandbox, timeoutMs: 60000 });
      gateRaw = { stdout: g.stdout, code: g.code };
      msGate = g.ms;
      if (!g.timedOut) cache.verdicts[key] = gateRaw;
    }
    const a = await runProc(AST_ARM, { input: it.command, env, cwd: sandbox, timeoutMs: 30000 });
    const gate = parseGateOutput(gateRaw.stdout, gateRaw.code);
    const ast = parseAstOutput(a.stdout, a.code);
    if (ast.verdict === 'error' && a.stderr) ast.detail += ` | ${a.stderr.trim().slice(0, 200)}`;
    return { ...it, gate, ast, class: classify(gate, ast), msGate, msAst: a.ms };
  });
  if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(cache));

  const summary = summarize(rows);
  const brief = r => ({
    class: r.class,
    source: r.source,
    ...(r.source === 'corpus' ? { label: r.label, note: r.note, line: r.line } : { index: r.index }),
    command: r.command,
    gate: {
      verdict: r.gate.verdict,
      rm: r.gate.rm,
      vars: r.gate.vars,
      otherDeny: r.gate.other,
      ...(r.gate.detail ? { detail: r.gate.detail } : {}),
    },
    ast: { verdict: r.ast.verdict, vars: r.ast.vars, ...(r.ast.detail ? { detail: r.ast.detail } : {}) },
  });
  const disagreements = rows.filter(r => !['both-deny', 'both-allow'].includes(r.class)).map(brief);
  // Both deny, but not for the same variables: agreement on the verdict only.
  const varDifferences = rows
    .filter(r => r.class === 'both-deny' && r.gate.vars.join(' ') !== r.ast.vars.join(' '))
    .map(brief);
  const out = {
    hookDir,
    hookHash: hash,
    shfmt: process.env.SHFMT,
    jobs,
    compared: rows.length,
    inputs: { corpus: corpusPath, cmds: p.values['--cmds'] || null, sample: sampleN },
    ...summary,
    disagreements,
    varDifferences,
  };
  if (p.bools.has('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(
      `compared ${rows.length} command(s) mentioning rm/find; gate ${hookDir} (sha256 ${hash.slice(0, 12)})`
    );
    const fmt = t => CLASSES.map(c => `${c} ${t[c]}`).join(' | ');
    console.log(`all:     ${fmt(summary.table)}`);
    for (const [s, t] of Object.entries(summary.bySource)) console.log(`${`${s}:`.padEnd(8)} ${fmt(t)}`);
    for (const [l, t] of Object.entries(summary.byLabel)) console.log(`  label ${l.padEnd(4)} ${fmt(t)}`);
    const rs = summary.residuals;
    if (rs.xfnAstDeny.of + rs.xfpAstAllow.of + rs.passAstDeny.of) {
      console.log(
        `residual rows: xfn the AST denies ${rs.xfnAstDeny.n}/${rs.xfnAstDeny.of}; xfp the AST allows ${rs.xfpAstAllow.n}/${rs.xfpAstAllow.of}; pass the AST denies ${rs.passAstDeny.n}/${rs.passAstDeny.of}`
      );
    }
    console.log(
      `both-deny with different var names: ${summary.bothDenyVarsDiffer}; gate denied for a non-rm section only: ${summary.gateOtherDenyOnly}`
    );
    const l = summary.latencyMs;
    const ms = x => (x === null ? '-' : x.toFixed(1));
    console.log(
      `latency ms (jobs=${jobs}${jobs > 1 ? ', contended' : ''}): gate n=${l.gate.n} p50 ${ms(l.gate.p50)} p99 ${ms(l.gate.p99)} | ast n=${l.ast.n} p50 ${ms(l.ast.p50)} p99 ${ms(l.ast.p99)}`
    );
    for (const d of disagreements) {
      const where = d.source === 'corpus' ? `corpus:${d.line} ${d.label}` : `cmds[${d.index}]`;
      console.log(
        `[${d.class}] ${where} gate=${d.gate.verdict}${d.gate.rm ? '' : d.gate.verdict === 'deny' ? '(non-rm)' : ''} ${d.gate.vars.join(',')} ast=${d.ast.verdict} ${d.ast.vars.join(',')} :: ${oneLine(d.command)}`
      );
    }
  }
}
