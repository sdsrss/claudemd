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
import { logsDir, resolvePluginRoot, encodeProjectCwd, projectDir as projectDirFor } from './lib/paths.js';
import { readHits, excludeTestSessions } from './lib/rule-hits-parse.js';
import { ArgvError, parseStrict, printHelpAndExit, resolveDaysFlag } from './lib/argv.js';

const USAGE = `Usage: node scripts/lesson-bypass-audit.js [--days=N] [--cwd=<path>] [--json]

R3 Step 2 — lesson-bypass detector. Joins memory-prompt-hint suggest events
with subsequent Read/cite activity in CC transcripts to compute cite-recall
across recent sessions.

Options:
  --days=N       Window in days (positive integer, default 30).
  --cwd=PATH     CC project cwd to audit (default: current process.cwd()).
                 Mapped to ~/.claude/projects/<encoded>/ for transcript lookup.
  --project=PATH Alias for --cwd. spec-coherence-audit spells this same concept
                 --project; accepting both means neither spelling is a silent
                 argv-shape error depending on which tool you reached for.
  --json         Emit JSON (default: prose summary).
  --help, -h     Print this message and exit.

Env: CLAUDEMD_BYPASS_DAYS=N (overridden by --days=N when both set).

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const DEFAULT_WINDOW_DAYS = 30;

// CC project-dir encoding — single source in paths.js (must match the hooks'
// `hook_encode_project`, a per-CHARACTER loop; the `tr -c` form it replaced in
// 2026-07-17 was byte-wise and disagreed on every CJK char). Re-exported under
// the historical name so callers
// and the regression test keep one import; the prior local `/[/._]/g` form was
// a silent divergence that mis-located transcripts for cwds with a space/+/@.
export const encodeCcCwd = encodeProjectCwd;

// `integrity` (out param, optional): `{ badLines }` written back for the rows
// this drops. A malformed line here does not just shrink the sample — it flips
// a verdict: wasApplied() scans the rows it was handed, so a corrupt row that
// held the Read of a suggested memory file scores that lesson as BYPASSED, and
// cite-recall (the one number this script exists to produce) moves in the
// alarming direction with nothing saying why. A fully-corrupt transcript is
// worse: rows.length === 0 is indistinguishable here from "file absent", so it
// lands in `missingTranscript` under a label that names the wrong cause
// (audit R11-24).
export function readTranscript(transcriptPath, integrity = null) {
  if (!fs.existsSync(transcriptPath)) return [];
  const rows = [];
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      if (integrity) integrity.badLines = (integrity.badLines || 0) + 1;
    }
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
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      parts.push(String(block.name || ''));
      try {
        parts.push(JSON.stringify(block.input || {}));
      } catch {
        /* skip */
      }
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

// The hint hook's own emission cap, read from its source rather than mirrored.
// This was a bare `const EMIT_CAP = 5` beside a comment naming the hook's MAX,
// with no test binding them (2026-07-26 audit): raising MAX would silently slice
// off the extra suggestions before scoring, understating the bypass rate. Falls
// back to 5 only when the hook is unreadable.
export const HOOK_EMIT_CAP_FALLBACK = 5;

// Returns { cap, source } rather than a bare number so the caller — and the
// test — can tell a DERIVED cap from a defaulted one. Silently falling back
// kept the audit dividing by a cap the hook no longer used, understating the
// bypass rate with nothing in the output saying the join had broken
// (audit-2026-08-22 条目 24).
export function readHookEmitCap(pluginRoot) {
  let src;
  try {
    src = fs.readFileSync(path.join(pluginRoot, 'hooks/memory-prompt-hint.sh'), 'utf8');
  } catch {
    // Hook file absent (extracted package, partial checkout): nothing to read,
    // and the fallback IS the documented default. Not worth a warning.
    return { cap: HOOK_EMIT_CAP_FALLBACK, source: 'fallback-missing-file' };
  }
  const m = src.match(/^MAX=(\d+)/m);
  if (m) return { cap: Number(m[1]), source: 'hook' };
  // The file is there and the anchor did not match — an indent, a rename, a
  // move into a case block. That is a broken join, not a missing input.
  process.emitWarning(
    `lesson-bypass-audit: hooks/memory-prompt-hint.sh has no line matching /^MAX=(\\d+)/ — ` +
      `falling back to ${HOOK_EMIT_CAP_FALLBACK}. If the hook's emit cap changed, this audit's ` +
      `bypass rate is computed against the wrong denominator.`
  );
  return { cap: HOOK_EMIT_CAP_FALLBACK, source: 'fallback-no-anchor' };
}

export function lessonBypassAudit({ days = DEFAULT_WINDOW_DAYS, cwd, pluginRoot, logPath, projectDir } = {}) {
  if (!cwd) cwd = process.cwd();
  if (!pluginRoot) pluginRoot = resolvePluginRoot(import.meta.url);
  if (!logPath) logPath = path.join(logsDir(), 'claudemd.jsonl');
  if (!projectDir) {
    projectDir = projectDirFor({ cwd });
  }

  const { hits } = readHits(logPath, days);
  const suggestEvents = excludeTestSessions(hits).filter(
    h => h.hook === 'memory-prompt-hint' && h.event === 'suggest'
  );

  const perSession = {};
  const perMemory = {};
  let totalSuggestions = 0;
  let totalApplied = 0;
  let totalBypassed = 0;
  let totalMissingTranscript = 0;
  // Transcript lines that did not parse, summed once per distinct session (the
  // cache means a multi-suggest session is read once; counting per event would
  // multiply the same corruption by its suggestion count).
  let totalMalformedLines = 0;

  // Cache transcripts so multi-event sessions don't re-read the file.
  const transcriptCache = {};

  // Emission cap of memory-prompt-hint.sh (MAX). extra.suggested logs the
  // FULL match list, but only the first EMIT_CAP entries were shown to the
  // model — counting capped-out entries as "bypassed" penalizes lessons the
  // agent never saw (2026-07-11 pre-ship review; live rows exist with
  // match_count 8/10). suggested is priority-ordered, so the shown set is
  // exactly the first min(EMIT_CAP, length) entries.
  const EMIT_CAP = readHookEmitCap(pluginRoot).cap;

  for (const ev of suggestEvents) {
    const sessionId = ev.session_id;
    const suggested = Array.isArray(ev.extra?.suggested) ? ev.extra.suggested.slice(0, EMIT_CAP) : null;
    if (!sessionId || !suggested || suggested.length === 0) continue;
    if (!(sessionId in transcriptCache)) {
      // Resolve the transcript in the PROJECT THE ROW CAME FROM, falling back to
      // the --cwd project. readHits reads the whole rule-hits log (every project),
      // but this looked every session up under one project dir, so rows from other
      // repos missed and were counted as `missingTranscript` — 183 of 240 suggest
      // events on the live log, of which 35 were resolvable from the row's own
      // top-level `project` field. cite-recall, the metric this script exists to produce,
      // was computed on the remainder while `totalSuggestEvents` counted all
      // projects: two different denominators printed side by side (2026-07-25).
      // The row's own top-level `project` field is the CC-encoded project dir
      // (`classifyProject` already reads it), so it names exactly the directory
      // the transcript lives in.
      const rowProject = typeof ev.project === 'string' ? ev.project : '';
      const candidates = [];
      if (rowProject) candidates.push(projectDirFor({ encoded: rowProject }));
      candidates.push(projectDir);
      let rows = [];
      // MAX across candidates, not last-wins. Last-wins loses the count in the
      // one case that matters most: a FULLY corrupt transcript yields
      // `rows.length === 0`, so the loop does not break, and the next (usually
      // absent) candidate overwrites badLines with 0 — the file then lands in
      // `missingTranscript` reporting `malformedLines: 0`, which is precisely
      // the "names the wrong cause" failure the readTranscript docstring
      // describes. Only one candidate can ever be non-zero here (the others do
      // not exist), so max is exact rather than a heuristic.
      let badLines = 0;
      for (const dir of candidates) {
        const integrity = { badLines: 0 };
        rows = readTranscript(path.join(dir, `${sessionId}.jsonl`), integrity);
        badLines = Math.max(badLines, integrity.badLines);
        if (rows.length > 0) break;
      }
      transcriptCache[sessionId] = { rows, badLines };
    }
    const { rows: transcript, badLines: sessionBadLines } = transcriptCache[sessionId];
    const transcriptMissing = transcript.length === 0;

    if (!(sessionId in perSession)) totalMalformedLines += sessionBadLines;
    perSession[sessionId] ||= {
      applied: 0,
      bypassed: 0,
      missingTranscript: 0,
      suggestions: 0,
      transcriptMissing,
      malformedLines: sessionBadLines,
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
    totalMalformedLines,
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
    parsed = parseStrict(process.argv.slice(2), {
      values: ['--days', '--cwd', '--project'],
      bools: ['--json'],
    });
  } catch (e) {
    if (e instanceof ArgvError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  const { raw, days } = resolveDaysFlag(parsed, { env: 'CLAUDEMD_BYPASS_DAYS', dflt: DEFAULT_WINDOW_DAYS });
  // parsePositiveInt rejects '2.7' (truncation footgun) AND '0x1e'/'1e2'
  // (Number() over-coercion) — this site was missed by the round-1 sweep.
  if (days === null) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
        `  Examples: --days=30 (default), --days=7, --days=90.`
    );
    process.exit(1);
  }
  // Both spellings given with DIFFERENT values is a mistake, not a preference:
  // silently picking one would audit a project the operator did not name.
  const aliasCwd = parsed.values['--cwd'];
  const aliasProject = parsed.values['--project'];
  if (aliasCwd != null && aliasProject != null && aliasCwd !== aliasProject) {
    console.error(
      `--cwd and --project are aliases but were given different values ` +
        `('${aliasCwd}' vs '${aliasProject}'). Pass one.`
    );
    process.exit(1);
  }
  const cwd = aliasCwd ?? aliasProject ?? process.cwd();
  // One-line failure, not a bare V8 stack (audit-2026-08-22 条目 16, extended
  // to the sync entry points by the 2026-08-29 audit R10-20). The throwing part
  // is this call — it reads the rule-hits log and every session transcript it
  // names; the printing below cannot throw. Exiting rather than setting
  // exitCode because the report has nothing to print without a result.
  let result;
  try {
    result = lessonBypassAudit({ days, cwd });
  } catch (err) {
    console.error(`[claudemd] lesson-bypass-audit failed: ${err && err.message ? err.message : err}`);
    if (process.env.CLAUDEMD_DEBUG) console.error(err);
    process.exit(1);
  }

  if (parsed.bools.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`lesson-bypass-audit (${days}d window, cwd=${cwd}):`);
    console.log(`  suggest events:      ${result.totalSuggestEvents}`);
    console.log(`  total suggestions:   ${result.totalSuggestions}`);
    console.log(`  applied:             ${result.totalApplied}`);
    console.log(`  bypassed:            ${result.totalBypassed}`);
    if (result.totalMissingTranscript) {
      console.log(
        `  missing transcript:  ${result.totalMissingTranscript} (session file absent — synthetic dogfood / deleted / cwd mismatch)`
      );
    }
    if (result.totalMalformedLines) {
      console.log(
        `  malformed lines:     ${result.totalMalformedLines} (transcript rows that did not parse — a dropped row holding a Read scores that lesson as bypassed)`
      );
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
