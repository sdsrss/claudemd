// v0.23.0 — R3 Step 2: lesson-bypass detector. Joins memory-prompt-hint
// `suggest` events with subsequent transcript activity to compute cite-recall
// across recent sessions.
//
// Background: §11 MEMORY.md read-the-file is HARD but the startup banner has
// repeatedly shown cite-recall at 0–8% (per memory-prompt-hint.sh:8–11 prose).
// Until this script, that number came from a separate claude-mem-lite signal
// and was not observable from claudemd's own telemetry. R3 Step 2 closes the
// loop: claudemd's UserPromptSubmit hook emits `suggest` events (one per
// prompt that matched MEMORY.md tags); this script joins those against the
// session transcript to ask "did the agent actually read or cite the
// suggested file?"
//
// Definitions:
//   - Suggest event: one row in rule-hits.jsonl with hook=memory-prompt-hint
//     event=suggest. `extra.suggested` is the priority-ranked FULL match list;
//     only its first EMIT_CAP entries were emitted to the model, so this
//     audit slices to that prefix before scoring.
//   - Applied: after the suggest's timestamp, the session transcript contains
//     the filename (either as Read tool input or in any text block — assistant
//     prose, user prompt, tool_result). Treats user-prompted reads as applied
//     (the lesson surfaced through the user channel still counts).
//   - Bypassed: no occurrence of the filename in transcript after the suggest.
//   - Missing transcript: session transcript file not present (deleted /
//     session was synthetic / cwd mismatch). Not counted as applied or
//     bypassed; surfaced separately so the operator can size the unmeasurable
//     fraction.
//
// Output: per-session and per-memory aggregates; cite-recall = applied /
// (applied + bypassed). Wraps via commands/claudemd-bypass-audit.md.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logsDir, resolvePluginRoot } from './lib/paths.js';
import { readHits, excludeTestSessions } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/lesson-bypass-audit.js [--days=N] [--cwd=<path>] [--json]

R3 Step 2 — lesson-bypass detector. Joins memory-prompt-hint suggest events
with subsequent Read/cite activity in CC transcripts to compute cite-recall
across recent sessions.

Options:
  --days=N       Window in days (positive integer, default 30).
  --cwd=PATH     CC project cwd to audit (default: current process.cwd()).
                 Mapped to ~/.claude/projects/<encoded>/ for transcript lookup.
  --json         Emit JSON (default: prose summary).
  --help, -h     Print this message and exit.

Env: CLAUDEMD_BYPASS_DAYS=N (overridden by --days=N when both set).

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const DEFAULT_WINDOW_DAYS = 30;

// CC project-dir encoding: every non-[a-zA-Z0-9-] char → '-'. Per
// feedback_cc_cwd_encoding_dots.md (v0.9.15: '_' included), but the safe
// universal form is tr '/._' — matches memory-prompt-hint.sh:50 exactly.
export function encodeCcCwd(cwd) {
  return cwd.replace(/[/._]/g, '-');
}

export function readTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch { /* skip malformed line */ }
  }
  return rows;
}

// Extract searchable text from a transcript row. Handles three content
// shapes (string / array of typed blocks / undefined). For tool_use blocks,
// stringify name+input so `Read({file_path: "feedback_X.md"})` matches the
// filename search below.
export function rowText(row) {
  const msg = row?.message;
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const block of c) {
    if (typeof block === 'string') { parts.push(block); continue; }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      parts.push(String(block.name || ''));
      try { parts.push(JSON.stringify(block.input || {})); } catch { /* skip */ }
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') parts.push(block.content);
      else if (Array.isArray(block.content)) {
        for (const inner of block.content) {
          if (inner && typeof inner === 'object' && typeof inner.text === 'string') {
            parts.push(inner.text);
          }
        }
      }
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking);
    }
  }
  return parts.join(' ');
}

// Did the session's transcript reference the memory file at or after the
// suggest timestamp? Matches by filename basename (suggest emits relative
// names like `feedback_xxx.md`; Read tool typically uses the full memory-dir
// path; either form should count).
export function wasApplied(transcript, suggestTs, memoryFile) {
  const filename = path.basename(memoryFile);
  if (!filename) return false;
  const cutoff = new Date(suggestTs).getTime();
  if (!Number.isFinite(cutoff)) return false;
  for (const row of transcript) {
    const t = new Date(row.timestamp).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (rowText(row).includes(filename)) return true;
  }
  return false;
}

export function lessonBypassAudit({
  days = DEFAULT_WINDOW_DAYS,
  cwd,
  pluginRoot,
  logPath,
  projectDir,
} = {}) {
  if (!cwd) cwd = process.cwd();
  if (!pluginRoot) pluginRoot = resolvePluginRoot(import.meta.url);
  if (!logPath) logPath = path.join(logsDir(), 'claudemd.jsonl');
  if (!projectDir) {
    projectDir = path.join(os.homedir(), '.claude/projects', encodeCcCwd(cwd));
  }

  const { hits } = readHits(logPath, days);
  const suggestEvents = excludeTestSessions(hits)
    .filter(h => h.hook === 'memory-prompt-hint' && h.event === 'suggest');

  const perSession = {};
  const perMemory = {};
  let totalSuggestions = 0;
  let totalApplied = 0;
  let totalBypassed = 0;
  let totalMissingTranscript = 0;

  // Cache transcripts so multi-event sessions don't re-read the file.
  const transcriptCache = {};

  // Emission cap of memory-prompt-hint.sh (MAX). extra.suggested logs the
  // FULL match list, but only the first EMIT_CAP entries were shown to the
  // model — counting capped-out entries as "bypassed" penalizes lessons the
  // agent never saw (2026-07-11 pre-ship review; live rows exist with
  // match_count 8/10). suggested is priority-ordered, so the shown set is
  // exactly the first min(EMIT_CAP, length) entries.
  const EMIT_CAP = 5;

  for (const ev of suggestEvents) {
    const sessionId = ev.session_id;
    const suggested = Array.isArray(ev.extra?.suggested)
      ? ev.extra.suggested.slice(0, EMIT_CAP)
      : null;
    if (!sessionId || !suggested || suggested.length === 0) continue;
    if (!(sessionId in transcriptCache)) {
      const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
      transcriptCache[sessionId] = readTranscript(transcriptPath);
    }
    const transcript = transcriptCache[sessionId];
    const transcriptMissing = transcript.length === 0;

    perSession[sessionId] ||= {
      applied: 0,
      bypassed: 0,
      missingTranscript: 0,
      suggestions: 0,
      transcriptMissing,
    };

    for (const memFile of suggested) {
      totalSuggestions++;
      perSession[sessionId].suggestions++;
      perMemory[memFile] ||= { applied: 0, bypassed: 0, missingTranscript: 0 };
      if (transcriptMissing) {
        totalMissingTranscript++;
        perSession[sessionId].missingTranscript++;
        perMemory[memFile].missingTranscript++;
        continue;
      }
      if (wasApplied(transcript, ev.ts, memFile)) {
        totalApplied++;
        perSession[sessionId].applied++;
        perMemory[memFile].applied++;
      } else {
        totalBypassed++;
        perSession[sessionId].bypassed++;
        perMemory[memFile].bypassed++;
      }
    }
  }

  const measured = totalApplied + totalBypassed;
  // citeRecall = applied / (applied + bypassed). null when no measurable data.
  const citeRecall = measured > 0 ? totalApplied / measured : null;
  const bypassRate = measured > 0 ? totalBypassed / measured : null;

  return {
    windowDays: days,
    cwd,
    projectDir,
    totalSuggestEvents: suggestEvents.length,
    totalSuggestions,
    totalApplied,
    totalBypassed,
    totalMissingTranscript,
    citeRecall,
    bypassRate,
    perMemory,
    perSession,
  };
}

function formatPercent(v) {
  if (v === null) return 'n/a';
  return `${(v * 100).toFixed(1)}%`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { values: ['--days', '--cwd'], bools: ['--json'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_BYPASS_DAYS || String(DEFAULT_WINDOW_DAYS));
  // parsePositiveInt rejects '2.7' (truncation footgun) AND '0x1e'/'1e2'
  // (Number() over-coercion) — this site was missed by the round-1 sweep.
  const days = parsePositiveInt(raw);
  if (days === null) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
      `  Examples: --days=30 (default), --days=7, --days=90.`
    );
    process.exit(1);
  }
  const cwd = parsed.values['--cwd'] ?? process.cwd();
  const result = lessonBypassAudit({ days, cwd });

  if (parsed.bools.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`lesson-bypass-audit (${days}d window, cwd=${cwd}):`);
    console.log(`  suggest events:      ${result.totalSuggestEvents}`);
    console.log(`  total suggestions:   ${result.totalSuggestions}`);
    console.log(`  applied:             ${result.totalApplied}`);
    console.log(`  bypassed:            ${result.totalBypassed}`);
    if (result.totalMissingTranscript) {
      console.log(`  missing transcript:  ${result.totalMissingTranscript} (session file absent — synthetic dogfood / deleted / cwd mismatch)`);
    }
    console.log(`  cite-recall:         ${formatPercent(result.citeRecall)}`);
    console.log(`  bypass-rate:         ${formatPercent(result.bypassRate)}`);

    const ranked = Object.entries(result.perMemory)
      .filter(([, m]) => m.bypassed > 0)
      .sort((a, b) => b[1].bypassed - a[1].bypassed)
      .slice(0, 5);
    if (ranked.length) {
      console.log(`\n  Top bypassed memories:`);
      for (const [file, m] of ranked) {
        const measurable = m.applied + m.bypassed;
        const rate = measurable > 0 ? m.bypassed / measurable : 0;
        console.log(`    ${file}: ${m.bypassed}/${measurable} bypassed (${(rate * 100).toFixed(0)}%)`);
      }
    }
  }
}
