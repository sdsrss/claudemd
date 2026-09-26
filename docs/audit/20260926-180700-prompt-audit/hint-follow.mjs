#!/usr/bin/env node
// hint-follow.mjs — reproduces docs/audit/20260926-180700.md §12.3.
// (1) When claudemd's memory-hint (UserPromptSubmit) names files to read, does the
//     model Read any of them before the next human prompt? Split by model.
// (2) How selective would keyword triggers on the human prompt be, if §10.6 layer 2
//     matched module triggers the same way? TRIG below is a DRAFT list, not a proposal.
//
// Usage: node hint-follow.mjs [since=YYYY-MM-DD]
// Corpus: ~/.claude/projects/*/*.jsonl (main sessions only, fixed depth; subagents/ not
// scanned), file mtime >= since, entrypoint "cli", >= 1 human string prompt.
// Upper bound: a Read that would have happened without the hint still counts as followed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const since = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-09-05';
const root = path.join(os.homedir(), '.claude/projects');
const HINT = 'memory-hint: your prompt matches MEMORY.md tags';

const TRIG = {
  ship: /发版|发布|打\s*tag|\b(ship|release|publish|deploy)\b|npm publish|gh release/i,
  bugfix: /修复|修一下|报错|bug|\bfix\b|错误|失败|不工作|崩溃|\berror\b|broken|crash|regression/i,
  review: /评审|审核|审查|\breview\b|code review/i,
  test: /测试|\btest(s|ing)?\b|验证|覆盖率/i,
  research: /联网|搜索|调研|查一下|文档|\bdocs?\b|research|怎么用/i,
  plan: /架构|重构|方案|规划|设计|\bplan\b|refactor|architecture|migration|迁移/i,
  memory: /记住|记忆|remember|memory/i,
};

const isHuman = (o) => {
  if (o.type !== 'user' || o.isMeta || typeof o.message?.content !== 'string') return false;
  const t = o.message.content;
  return !t.startsWith('<command-') && !t.startsWith('<local-command') && !t.startsWith('<task-notification');
};

const tot = { sessions: 0, prompts: 0, hintedTurns: 0, hintedTurnsFollowed: 0, hintedPaths: 0, hintedPathsRead: 0 };
const modules = { 0: 0, 1: 0, 2: 0, '3+': 0 };
const short = { prompts: 0, anyModule: 0 };
const perTrig = Object.fromEntries(Object.keys(TRIG).map((k) => [k, 0]));
const byModel = {};

for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtime.toISOString().slice(0, 10) < since) continue;
    let headless = false;
    let model = '?';
    let pending = null;
    const turns = [];
    const prompts = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.entrypoint && o.entrypoint !== 'cli') headless = true;
      if (isHuman(o)) {
        if (pending) turns.push(pending);
        pending = null;
        prompts.push(o.message.content);
        continue;
      }
      const a = o.attachment;
      if (a?.type === 'hook_additional_context') {
        const txt = [].concat(a.content || []).join('\n');
        if (txt.includes(HINT)) {
          pending = { paths: new Set([...txt.matchAll(/ - (\/\S+\.md) \(tag:/g)].map((m) => m[1])), read: new Set(), model: '?' };
        }
      }
      if (o.type !== 'assistant') continue;
      if (o.message?.model) model = o.message.model;
      if (!pending) continue;
      if (pending.model === '?') pending.model = model;
      for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (b.type !== 'tool_use') continue;
        const i = b.input || {};
        const cmd = b.name === 'Bash' ? i.command || '' : '';
        for (const q of pending.paths) {
          if ((b.name === 'Read' && i.file_path === q) || cmd.includes(path.basename(q))) pending.read.add(q);
        }
      }
    }
    if (pending) turns.push(pending);
    if (headless || prompts.length < 1) continue;
    tot.sessions++;
    tot.prompts += prompts.length;
    for (const t of prompts) {
      let n = 0;
      for (const [k, re] of Object.entries(TRIG)) if (re.test(t)) { perTrig[k]++; n++; }
      modules[n >= 3 ? '3+' : n]++;
      if (t.length <= 300) { short.prompts++; if (n) short.anyModule++; }
    }
    for (const t of turns) {
      tot.hintedTurns++;
      tot.hintedPaths += t.paths.size;
      tot.hintedPathsRead += t.read.size;
      if (t.read.size) tot.hintedTurnsFollowed++;
      const m = (byModel[t.model] ??= { hintedTurns: 0, followed: 0 });
      m.hintedTurns++;
      if (t.read.size) m.followed++;
    }
  }
}
console.log(JSON.stringify({ since, ...tot, byModel, modulesPerPrompt: modules, promptsUpTo300Chars: short, perTrig }, null, 2));
