#!/usr/bin/env node
// ext-read.mjs — how often interactive sessions load ~/.claude/CLAUDE-extended.md,
// and how often they invoke any Skill. Reproduces docs/audit/20260926-180700.md §10.2.
//
// Usage: node ext-read.mjs [since=YYYY-MM-DD] [--by-project]
// Corpus: ~/.claude/projects/*/*.jsonl (main sessions only; subagents/ not scanned),
// file mtime >= since, entrypoint "cli" only, >= 1 human string prompt.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const since = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-09-05';
const byProject = args.includes('--by-project');
const root = path.join(os.homedir(), '.claude/projects');
const extPath = path.join(os.homedir(), '.claude/CLAUDE-extended.md');

const tot = { sessions: 0, extRead: 0, extAny: 0, extTargeted: 0, skillSessions: 0, toolUses: 0 };
const skills = {};
const perProject = {};

for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtime.toISOString().slice(0, 10) < since) continue;
    let human = 0, headless = false, read = false, any = false, targeted = 0, skill = false, uses = 0;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.entrypoint && o.entrypoint !== 'cli') headless = true;
      if (o.type === 'user' && typeof o.message?.content === 'string' && !o.isMeta) human++;
      const c = o.message?.content;
      if (o.type !== 'assistant' || !Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type !== 'tool_use') continue;
        uses++;
        const i = b.input || {};
        if (b.name === 'Read' && i.file_path === extPath) {
          read = any = true;
          if (i.offset || i.limit) targeted++;
        }
        if (b.name === 'Bash' && (i.command || '').includes('.claude/CLAUDE-extended.md')) any = true;
        if (b.name === 'Skill') { skill = true; skills[i.skill] = (skills[i.skill] || 0) + 1; }
      }
    }
    if (headless || human < 1) continue;
    tot.sessions++; tot.toolUses += uses; tot.extTargeted += targeted;
    if (read) tot.extRead++;
    if (any) tot.extAny++;
    if (skill) tot.skillSessions++;
    const k = d.replace(/^-home-[^-]+-(dev-)?/, '');
    perProject[k] ??= { sessions: 0, extRead: 0 };
    perProject[k].sessions++;
    if (read) perProject[k].extRead++;
  }
}

console.log(JSON.stringify({ since, ...tot, skills }, null, 2));
if (byProject) {
  for (const [k, v] of Object.entries(perProject).sort((a, b) => b[1].sessions - a[1].sessions)) {
    console.log(`${String(v.extRead).padStart(4)} / ${String(v.sessions).padEnd(4)} ${k}`);
  }
}
