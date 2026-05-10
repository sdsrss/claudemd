// sparkline.js — R-N9 (v0.8.4): rule-usage trend sparkline for §13.1/§13.2
// version-discipline accounting.
//
// Reads `~/.claude/logs/claudemd.jsonl`, counts signal events
// (deny + warn + advisory + bypass-escape-hatch) per `spec_section` across
// 3 cumulative windows (default 30 / 60 / 90 days), and emits a markdown
// block suitable for pasting into the CHANGELOG header before a release.
//
// Each row: `§X-Y    A / B / C  arrow [annotation]`
//   A = events in last 30d, B = last 60d, C = last 90d (cumulative).
//   Arrow compares the per-period RATE (count / window-days):
//     ↗ recent > mid > old
//     ↘ recent < mid < old
//     ≈ otherwise
//   Annotation: (newly active) when oldest-bucket count == 0 and recent > 0,
//     (silenced) when recent == 0 and an older bucket has events.
//
// CLI:
//   node scripts/sparkline.js                        # default 30,60,90
//   node scripts/sparkline.js --days=7,14,28
//   CLAUDEMD_SPARKLINE_DAYS=14,28,56 node scripts/sparkline.js
//
// Skips the `(unset)` bucket — pre-v0.7.0 rows with no spec_section are
// noise for the version-discipline question this report answers.

import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupBySection, logFirstTs } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/sparkline.js [--days=W1,W2,W3]

Emit rule-usage trend sparkline as a markdown block (deny+warn+advisory+
bypass per spec_section across multiple windows).

Options:
  --days=W1,...  Comma-separated positive integers (default 30,60,90).
                 Requires ≥2 windows.
  --help, -h     Print this message and exit.

Env: CLAUDEMD_SPARKLINE_DAYS=W1,W2,W3 (overridden by --days when both set).
Wrapped by /claudemd-sparkline.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const DEFAULT_WINDOWS = [30, 60, 90];
const SIGNAL_EVENTS = new Set(['deny', 'warn', 'advisory', 'bypass-escape-hatch']);

export function sparkline({ windows = DEFAULT_WINDOWS, logPath } = {}) {
  const log = logPath || path.join(logsDir(), 'claudemd.jsonl');
  const sortedWindows = [...windows].sort((a, b) => a - b);
  const longest = sortedWindows[sortedWindows.length - 1];

  const allHits = readHits(log, longest).hits
    .filter(h => SIGNAL_EVENTS.has(h.event))
    .filter(h => h.spec_section); // drop (unset)

  // Log-span check. When the log doesn't reach back as far as the shortest
  // window, every prior bucket is necessarily 0 — the `newly active` heuristic
  // (= "recent has events AND all older buckets are zero") fires for EVERY
  // section, regardless of true trend. Mirror hard-rules-audit.js' insufficient-
  // data defense: surface log-span info to the operator and suppress the
  // misleading annotation.
  const firstTs = logFirstTs(log);
  const now = Date.now();
  const logSpanDays = firstTs === null
    ? 0
    : Math.round(((now - firstTs) / 86400000) * 10) / 10;
  const shortest = sortedWindows[0];
  const insufficientSpan = firstTs === null || logSpanDays < shortest;
  // Per-window coverage: each window with `days > logSpanDays` is "not
  // covered" by the log. Used to annotate row arrows for the under-covered
  // window subset.
  const windowCoverage = sortedWindows.map(days => ({
    days,
    covered: firstTs !== null && logSpanDays >= days,
  }));

  const perWindow = sortedWindows.map(days => {
    const cutoff = now - days * 86400 * 1000;
    const filtered = allHits.filter(h => new Date(h.ts).getTime() >= cutoff);
    return { days, grouped: groupBySection(filtered) };
  });

  const sectionSet = new Set();
  for (const w of perWindow) for (const k of Object.keys(w.grouped)) sectionSet.add(k);

  const rows = [];
  for (const section of sectionSet) {
    const counts = perWindow.map(w => w.grouped[section]?.total || 0);
    const trend = computeTrend(counts, sortedWindows, { insufficientSpan });
    rows.push({ section, counts, windows: sortedWindows, trend });
  }
  // Sort: most active in shortest window first; tie-break by total.
  rows.sort((a, b) => {
    if (b.counts[0] !== a.counts[0]) return b.counts[0] - a.counts[0];
    const aTotal = a.counts[a.counts.length - 1];
    const bTotal = b.counts[b.counts.length - 1];
    return bTotal - aTotal;
  });

  return {
    windows: sortedWindows,
    rows,
    logSpanDays,
    insufficientSpan,
    windowCoverage,
  };
}

// computeTrend: arrow + optional annotation. counts and windows are both
// shortest-first. Cumulative counts are converted to per-period rates so that
// "rule still firing at the old steady-state rate" reads as ≈, not ↗ just
// because the cumulative number grew with the window.
function computeTrend(counts, windows, { insufficientSpan = false } = {}) {
  if (counts.length < 2) return { arrow: '', annotation: null };
  // Per-bucket counts: bucket i contains events in (windows[i-1], windows[i]] days ago.
  // bucket 0 = (0, windows[0]] = events 0 to windows[0] days ago = counts[0].
  const buckets = counts.map((c, i) => i === 0 ? c : c - counts[i - 1]);
  const bucketDays = windows.map((w, i) => i === 0 ? w : w - windows[i - 1]);
  const rates = buckets.map((b, i) => bucketDays[i] === 0 ? 0 : b / bucketDays[i]);

  const recent = rates[0];
  const oldestRate = rates[rates.length - 1];

  // newly active: recent has events AND every older bucket is empty
  //   (cumulative count never grew past the recent bucket).
  // silenced: recent has zero events AND some older bucket fired
  //   (cumulative grew but stopped). This catches "fired 30-60d ago, dead now"
  //   cases that the older "oldest-bucket-only" check missed when activity
  //   was concentrated in a middle window.
  let annotation = null;
  const olderBuckets = buckets.slice(1);
  // Suppress `newly active` when the log span is shorter than the shortest
  // window — every section trivially satisfies "older buckets all zero"
  // because the log doesn't reach those buckets at all. The signal is
  // structurally meaningless under insufficient span.
  if (counts[0] > 0 && olderBuckets.every(b => b === 0) && !insufficientSpan) annotation = 'newly active';
  else if (counts[0] === 0 && counts[counts.length - 1] > 0) annotation = 'silenced';

  let arrow = '≈';
  if (recent > oldestRate * 1.2) arrow = '↗';
  else if (recent < oldestRate * 0.8) arrow = '↘';
  // Newly-active dominates direction; silenced too.
  if (annotation === 'newly active') arrow = '↗';
  if (annotation === 'silenced') arrow = '↘';

  return { arrow, annotation };
}

export function formatMarkdown(report) {
  const { windows, rows, logSpanDays, insufficientSpan, windowCoverage } = report;
  const header = `Rule usage trend (${windows.map(w => `${w}d`).join(' / ')}, signal events only):`;

  // Insufficient-span banner — when log doesn't reach the shortest window.
  // Tells the operator the trend annotations are structurally unreliable so
  // they don't act on virtual `↗ (newly active)` signals (which are now
  // suppressed in computeTrend). Surfaced in markdown only; the JSON shape
  // already carries `insufficientSpan` + `logSpanDays`.
  let banner = '';
  if (insufficientSpan) {
    banner = `\n  [insufficient log span: ${logSpanDays}d — trend annotations suppressed; need ≥${windows[0]}d]`;
  } else if (windowCoverage && windowCoverage.some(w => !w.covered)) {
    const uncoveredFrom = windowCoverage.find(w => !w.covered);
    if (uncoveredFrom) {
      banner = `\n  [partial coverage: log spans ${logSpanDays}d; ≥${uncoveredFrom.days}d windows are not fully covered]`;
    }
  }

  if (rows.length === 0) {
    return `${header}${banner}\n  (no signal events in any window)\n`;
  }
  const sectionWidth = Math.max(...rows.map(r => r.section.length), 8);
  const numWidth = Math.max(...rows.flatMap(r => r.counts.map(c => String(c).length)), 1);
  const lines = rows.map(r => {
    const sec = r.section.padEnd(sectionWidth);
    const nums = r.counts.map(c => String(c).padStart(numWidth)).join(' / ');
    const ann = r.trend.annotation ? ` (${r.trend.annotation})` : '';
    return `  ${sec}  ${nums}  ${r.trend.arrow}${ann}`;
  });
  return `${header}${banner}\n${lines.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { values: ['--days'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_SPARKLINE_DAYS || '30,60,90');
  // `Number()` (not `parseInt`) so '1.5' yields 1.5 — `isInteger(1.5)` rejects.
  // Pre-fix `parseInt('1.5,2,3', 10)` silently truncated to [1,2,3] and ran
  // with the wrong window header. Same silent-fallback family.
  const windows = raw.split(',').map(s => Number(s.trim()));
  if (!windows.every(w => Number.isInteger(w) && w >= 1) || windows.length < 2) {
    console.error(
      `--days expects ≥2 comma-separated positive integers (got '${raw}').\n` +
      `  Examples: --days=30,60,90 (default), --days=7,14,28.`
    );
    process.exit(1);
  }
  const report = sparkline({ windows });
  process.stdout.write(formatMarkdown(report));
}
