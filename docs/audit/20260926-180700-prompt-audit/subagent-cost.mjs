#!/usr/bin/env node
// Section 9 reproduction: wall time, tool time, tokens and suite re-runs per subagent transcript.
// Usage: node subagent-cost.mjs [projectDir] [--list]   (default: this repo's Claude Code project dir)
// Reads <projectDir>/<session>/subagents/*.jsonl only — two fixed levels, no recursive walk.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const P = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(os.homedir(), '.claude/projects/-home-ai-dev-claudemd');
// Pre-ship / pre-tag / audit reviewers, named by the spawning session. Per-task sp reviews are the control.
const REVIEWER = /preship|pretag|review|r3|delta|verif|rev-|ar1[67]|ar630/;
const TASK = /task\d/;
const SP_REVIEW = /task\d-(re)?review/;
// Any test execution (full suite or one file) vs. the full suite only.
const TEST_RUN = /npm (run )?(test|check|smoke)|run-all\.sh|node --test|vitest|\b(ba)?sh tests\//;
const FULL_SUITE = /npm (run )?(test|check)\b|run-all\.sh/;

const files = [];
for (const s of fs.readdirSync(P)) {
  const d = path.join(P, s, 'subagents');
  if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) files.push(path.join(d, f));
}

const rows = [];
for (const f of files) {
  const recs = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.timestamp);
  if (!recs.length) continue;
  const name = path.basename(f).slice(6, -6).replace(/-[0-9a-f]{16,17}$/, '');
  const pending = new Map();
  const tool = { tests: 0, sleep: 0, other: 0 };
  let peak = 0, billed = 0, out = 0, calls = 0, suite = 0, full = 0, model = null;
  for (const r of recs) {
    const c = r.message?.content;
    if (r.type === 'assistant') {
      const u = r.message.usage || {};
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      peak = Math.max(peak, ctx); billed += ctx; out += u.output_tokens || 0; model = r.message.model || model;
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type !== 'tool_use') continue;
        calls++;
        const cmd = b.name === 'Bash' ? b.input?.command || '' : '';
        const cat = !cmd ? 'other' : TEST_RUN.test(cmd) ? 'tests' : /\bsleep\b/.test(cmd) ? 'sleep' : 'other';
        if (cat === 'tests') suite++;
        if (FULL_SUITE.test(cmd)) full++;
        pending.set(b.id, [Date.parse(r.timestamp), cat]);
      }
    } else if (r.type === 'user' && Array.isArray(c)) {
      for (const b of c) {
        if (b?.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
        const [t0, cat] = pending.get(b.tool_use_id);
        pending.delete(b.tool_use_id);
        tool[cat] += (Date.parse(r.timestamp) - t0) / 60000;
      }
    }
  }
  const ts = recs.map((r) => Date.parse(r.timestamp)).sort((a, b) => a - b);
  rows.push({ name, start: new Date(ts[0]).toISOString().slice(0, 16), model,
    min: (ts.at(-1) - ts[0]) / 60000, peak, billed, out, calls, suite, full, tool });
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = (a) => [...a].sort((x, y) => x - y)[Math.floor(0.9 * a.length)];
const r1 = (x) => Math.round(x * 10) / 10;
function summary(label, g) {
  if (!g.length) return console.log(`${label}: n=0`);
  const wall = g.reduce((s, r) => s + r.min, 0);
  const t = (k) => g.reduce((s, r) => s + r.tool[k], 0);
  console.log(`${label}: n=${g.length}`);
  console.log(`  median min ${r1(med(g.map((r) => r.min)))}  p90 ${r1(p90(g.map((r) => r.min)))}  total h ${r1(wall / 60)}`);
  console.log(`  median peak ctx ${Math.round(med(g.map((r) => r.peak)) / 1000)}k  median out ${Math.round(med(g.map((r) => r.out)) / 1000)}k  median billed input ${r1(med(g.map((r) => r.billed)) / 1e6)}M`);
  console.log(`  median calls ${med(g.map((r) => r.calls))}  median test runs ${med(g.map((r) => r.suite))}  median full-suite runs ${med(g.map((r) => r.full))}`);
  const pct = (x) => `${Math.round(x)} min (${Math.round((100 * x) / wall)}%)`;
  console.log(`  wall ${Math.round(wall)} min: tests ${pct(t('tests'))}, sleep ${pct(t('sleep'))}, other tools ${pct(t('other'))}, remainder (model) ${pct(wall - t('tests') - t('sleep') - t('other'))}`);
}

const named = rows.filter((r) => REVIEWER.test(r.name) && !TASK.test(r.name));
summary('named pre-ship/audit reviewers', named);
summary('sp per-task reviewers', rows.filter((r) => SP_REVIEW.test(r.name)));
summary('all subagents on claude-opus-5-5', rows.filter((r) => r.model === 'claude-opus-5-5'));
console.log(`\nall subagent transcripts: ${rows.length}`);
if (process.argv.includes('--list')) {
  for (const r of rows.sort((a, b) => a.start.localeCompare(b.start))) {
    console.log(r.start, r.name.slice(0, 32).padEnd(32), `${r1(r.min)}m`, `tests=${r1(r.tool.tests)}m sleep=${r1(r.tool.sleep)}m full=${r.full}`, r.model);
  }
}
