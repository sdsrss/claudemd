// v0.30.0 E2 — cross-layer memory maintenance report (plan P5,
// docs/spec-optimization-plan-2026-07-10.md). The two memory layers (durable
// ~/.claude/projects/<cwd>/memory/ vs claude-mem-lite recall) fail SILENTLY
// when a fact lands in the wrong layer: a hot plugin lesson never becomes
// durable, a plugin-absent recall_*.md fallback lingers after the plugin
// returns, a durable file nobody's keywords ever match rots in the index.
// This module only LISTS candidates — migration is a §5-scoped write and
// stays the operator's call.
//
// (a) promote-to-durable: mem-lite lesson cited ≥ CITE_MIN times and alive
//     ≥ PROMOTE_MIN_AGE_DAYS — high-frequency recall is de-facto long-term
//     knowledge that belongs in MEMORY.md.
// (b) recall-repatriation: durable recall_*.md (the documented plugin-absent
//     fallback, feedback_memory_layer_routing.md) older than RECALL_MAX_AGE_DAYS
//     — the plugin is back (or the note went stale); migrate or delete.
// (c) stale-durable: durable file older than STALE_AGE_DAYS with zero
//     mentions in the claudemd telemetry log inside the same window — no
//     memory-read-check / memory-prompt-hint keyword match ever fired for it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeProjectCwd } from './paths.js';

export const CITE_MIN = 3;
export const PROMOTE_MIN_AGE_DAYS = 30;
export const RECALL_MAX_AGE_DAYS = 30;
export const STALE_AGE_DAYS = 90;

const DAY_MS = 86400000;

// claude-mem-lite canonical project name: "<parent-dir-basename>--<basename>"
// (mem project-utils.mjs inferProject convention, verified 2026-07-10).
function memLiteProject(cwd) {
  return `${path.basename(path.dirname(cwd))}--${path.basename(cwd)}`;
}

function listMdFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        try { return { name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }; }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return null; // dir missing
  }
}

// Collect every *.md basename mentioned anywhere in the telemetry log within
// the window. memory-read-check deny rows carry extra.missing[], memory-
// prompt-hint suggest rows carry extra.suggested[] — but any mention (bypass
// reasons, CHANGELOG self-quotes) counts as keyword-liveness for (c): the
// point is "does anything ever match this file", not "was it read".
function mentionedMdBasenames(logPath, sinceMs) {
  const set = new Set();
  let raw;
  try { raw = fs.readFileSync(logPath, 'utf8'); } catch { return set; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const tsMatch = line.match(/"ts":"([^"]+)"/);
    if (tsMatch) {
      const t = Date.parse(tsMatch[1]);
      if (Number.isFinite(t) && t < sinceMs) continue;
    }
    for (const m of line.matchAll(/[A-Za-z0-9_][A-Za-z0-9_.-]*\.md\b/g)) {
      set.add(m[0]);
    }
  }
  return set;
}

async function promoteCandidates(dbPath, project, now) {
  if (!fs.existsSync(dbPath)) return { candidates: [], skipped: 'mem-lite DB not found' };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return { candidates: [], skipped: 'node:sqlite unavailable (Node < 22.5)' };
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    // created_at_epoch is MILLISECONDS (verified against live DB 2026-07-10).
    const rows = db.prepare(
      'SELECT id, title, cited_count FROM observations ' +
      'WHERE project = ? AND lesson_learned IS NOT NULL AND lesson_learned != \'\' ' +
      'AND cited_count >= ? AND created_at_epoch <= ? ' +
      'AND superseded_at IS NULL AND demoted_at IS NULL ' +
      'ORDER BY cited_count DESC, id DESC LIMIT 10'
    ).all(project, CITE_MIN, now - PROMOTE_MIN_AGE_DAYS * DAY_MS);
    return { candidates: rows.map(r => ({ id: r.id, title: r.title, citedCount: r.cited_count })), skipped: null };
  } catch (e) {
    return { candidates: [], skipped: `mem-lite DB unreadable: ${e.message}` };
  } finally {
    try { db && db.close(); } catch { /* already closed */ }
  }
}

export async function memoryMaintenance({
  cwd = process.cwd(),
  homeDir = os.homedir(),
  now = Date.now(),
  memDir,
  logPath,
  memLiteDbPath,
  memLiteProjectName,
} = {}) {
  if (!memDir) memDir = path.join(homeDir, '.claude/projects', encodeProjectCwd(cwd), 'memory');
  if (!logPath) logPath = path.join(homeDir, '.claude/logs/claudemd.jsonl');
  if (!memLiteDbPath) memLiteDbPath = path.join(homeDir, '.claude-mem-lite/claude-mem-lite.db');
  if (!memLiteProjectName) memLiteProjectName = memLiteProject(cwd);

  const out = {
    memDir,
    promoteToDurable: [],
    promoteSkipped: null,
    recallRepatriation: [],
    staleDurable: [],
    scannedDurableFiles: 0,
  };

  const promote = await promoteCandidates(memLiteDbPath, memLiteProjectName, now);
  out.promoteToDurable = promote.candidates;
  out.promoteSkipped = promote.skipped;

  const files = listMdFiles(memDir);
  if (files === null) return out; // no durable dir — (b)/(c) have nothing to say

  const mentioned = mentionedMdBasenames(logPath, now - STALE_AGE_DAYS * DAY_MS);
  for (const f of files) {
    if (f.name === 'MEMORY.md') continue;
    out.scannedDurableFiles += 1;
    const ageDays = Math.floor((now - f.mtimeMs) / DAY_MS);
    if (f.name.startsWith('recall_')) {
      if (ageDays > RECALL_MAX_AGE_DAYS) out.recallRepatriation.push({ file: f.name, ageDays });
      continue; // recall files are (b)'s domain — don't double-list under (c)
    }
    if (ageDays > STALE_AGE_DAYS && !mentioned.has(f.name)) {
      out.staleDurable.push({ file: f.name, ageDays });
    }
  }
  out.recallRepatriation.sort((a, b) => b.ageDays - a.ageDays);
  out.staleDurable.sort((a, b) => b.ageDays - a.ageDays);
  return out;
}
