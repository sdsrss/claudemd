#!/usr/bin/env node
// Calibrate tier-2 module triggers on this machine's historical human prompts
// (tasks/specs/spec-modules.md success criterion 2; docs/audit/20260926-180700.md
// §12.3). Reads ~/.claude/projects/*/*.jsonl at fixed depth, main sessions only.
//
// Reports, per trigger set and per match window (whole prompt vs its first N
// characters): modules matched per prompt (median, share with >= 2), and ship
// recall — of the sessions that later ran a release command, how many had a
// prompt matching `ship` before that command.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from '../lib/argv.js';

const USAGE = `Usage: node scripts/offline-eval/trigger-calibrate.mjs [--since=YYYY-MM-DD] [--head=N] [--json]

Measure how selective the tier-2 module triggers are on historical prompts.

Options:
  --since=DATE   Transcripts modified on or after DATE (default 2026-09-05).
  --head=N       Also report matching on each prompt's first N characters (default 300).
  --json         Machine-readable output.
  --help, -h     Print this message and exit.

Exit codes: 0 measured | 2 argv-shape error.`;

/** Draft triggers per module. Modules with no prompt-level signal have none. */
export const TRIGGERS = {
  ship: /发版|发布(新)?版本|(?<![开触研出批激散引])发\s*v?[0-9]+(\.[0-9]+)+|(推送|合并)\S{0,4}\s*发布|打\s*tag|(?<![A-Za-z0-9_])ship(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])cut a release(?![A-Za-z0-9_])|create-release|merge-and-push|(?<![A-Za-z0-9_])release(?![A-Za-z0-9_]).{0,40}(?<![A-Za-z0-9_])to npm(?![A-Za-z0-9_])|npm publish|gh release|(?<![A-Za-z0-9_])deploy(?![A-Za-z0-9_])|上线/i,
  review:
    /评审|审查|审核一下|code review|(?<![A-Za-z0-9_])review (the|this|my|it)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])PR review(?![A-Za-z0-9_])/i,
  // A typo or spelling fix ("Fix the typo …", 修复错别字) is L0, not debugging (B7 A/B: T1
  // drew debug.md). Only those words: formatting, link, comment … also name code.
  debug:
    /报错|修复(?!(一下)?(错别字|拼写))|修一下|(?<![A-Za-z0-9_])bug(?![A-Za-z0-9_])|崩溃|不工作|(?<![A-Za-z0-9_])fix (the|this|a)(?![A-Za-z0-9_])(?! (typos?|spelling)(?![A-Za-z0-9_]))|(?<![A-Za-z0-9_])failing(?![A-Za-z0-9_])|stack ?trace|(?<![A-Za-z0-9_])exception(?![A-Za-z0-9_])/i,
  plan: /架构|重构|规划|实施方案|设计方案|(?<![A-Za-z0-9_])refactor(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])migration(?![A-Za-z0-9_])|迁移|(?<![A-Za-z0-9_])L3(?![A-Za-z0-9_])/i,
  memory:
    /记住|记下来|(?<![A-Za-z0-9_])remember (this|that)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])mem_save(?![A-Za-z0-9_])/i,
  orchestrate:
    /并行|子代理|(?<![A-Za-z0-9_])subagents?(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])in parallel(?![A-Za-z0-9_])|fan out/i,
};

const RELEASE_CMD =
  /(^|[;&|\n]\s*)(git\s+tag\s+-a\s+v\d|git\s+tag\s+v\d|git\s+push\s+\S+\s+v\d[\w.]*\s*$|gh\s+release\s+create\s+v\d|npm\s+publish\b(?!.*--dry-run))/m;

const isHuman = o =>
  o.type === 'user' &&
  !o.isMeta &&
  typeof o.message?.content === 'string' &&
  // The machine-sent turns spec-module-inject.sh skips, plus every `<command-…`
  // row: the hook lists `<command-name` only, and a transcript also holds
  // `<command-message` rows (a slash command's expansion), which this leaves out.
  !/^\s*(<(command-|local-command|task-notification|agent-message|teammate-message|system-reminder)|Another Claude session sent a message)/.test(
    o.message.content
  );

export function sessionRows(file) {
  const prompts = [];
  let firstRelease = -1;
  let headless = false;
  let idx = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    if (o.entrypoint && o.entrypoint !== 'cli') headless = true;
    idx++;
    if (isHuman(o)) prompts.push({ idx, text: o.message.content });
    if (firstRelease < 0 && o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'tool_use' && b.name === 'Bash' && RELEASE_CMD.test(String(b.input?.command || ''))) {
          firstRelease = idx;
          break;
        }
      }
    }
  }
  return { prompts, firstRelease, headless };
}

/** The text a module's trigger sees: ship reads the whole prompt (tier 3 guards
 *  it too, recall first); every other module reads the prompt's head, where the
 *  request usually is, so pasted material does not fan out into every module. */
export const windowFor = (module, text, head) => (module === 'ship' || !head ? text : text.slice(0, head));

export function measure(sessions, head) {
  const counts = [];
  const per = Object.fromEntries(Object.keys(TRIGGERS).map(k => [k, 0]));
  let shipSessions = 0;
  let shipRecalled = 0;
  for (const s of sessions) {
    for (const p of s.prompts) {
      let n = 0;
      for (const [k, re] of Object.entries(TRIGGERS)) {
        if (re.test(windowFor(k, p.text, head))) {
          per[k]++;
          n++;
        }
      }
      counts.push(n);
    }
    if (s.firstRelease >= 0) {
      shipSessions++;
      if (s.prompts.some(p => p.idx < s.firstRelease && TRIGGERS.ship.test(p.text))) shipRecalled++;
    }
  }
  counts.sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const multi = counts.filter(n => n >= 2).length;
  return {
    window: head ? `ship whole, others first ${head} chars` : 'whole prompt',
    prompts: counts.length,
    medianModules: median,
    multiModuleShare: counts.length ? Number((multi / counts.length).toFixed(3)) : 0,
    anyModuleShare: counts.length
      ? Number((counts.filter(n => n >= 1).length / counts.length).toFixed(3))
      : 0,
    perModule: per,
    shipRecall: `${shipRecalled}/${shipSessions}`,
  };
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const p = parseStrictOrExit(process.argv.slice(2), { bools: ['--json'], values: ['--since', '--head'] });
  const since = p.values['--since'] || '2026-09-05';
  const head = Number(p.values['--head'] || 300);
  const root = path.join(os.homedir(), '.claude', 'projects');
  const sessions = [];
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      if (fs.statSync(file).mtime.toISOString().slice(0, 10) < since) continue;
      const s = sessionRows(file);
      if (!s.headless && s.prompts.length) sessions.push(s);
    }
  }
  const out = {
    since,
    sessions: sessions.length,
    whole: measure(sessions, 0),
    head: measure(sessions, head),
  };
  if (p.bools.has('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${out.sessions} sessions since ${since}`);
    for (const m of [out.whole, out.head]) {
      console.log(
        `${m.window}: ${m.prompts} prompts, median ${m.medianModules} module(s), >=2 modules ${(m.multiModuleShare * 100).toFixed(1)}%, any ${(m.anyModuleShare * 100).toFixed(1)}%, ship recall ${m.shipRecall}`
      );
      console.log('  per module:', JSON.stringify(m.perModule));
    }
  }
}
