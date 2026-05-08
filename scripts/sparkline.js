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
import { readHits, groupBySection } from './lib/rule-hits-parse.js';

const DEFAULT_WINDOWS = [30, 60, 90];
const SIGNAL_EVENTS = new Set(['deny', 'warn', 'advisory', 'bypass-escape-hatch']);

export function sparkline({ windows = DEFAULT_WINDOWS, logPath } = {}) {
  const log = logPath || path.join(logsDir(), 'claudemd.jsonl');
  const sortedWindows = [...windows].sort((a, b) => a - b);
  const longest = sortedWindows[sortedWindows.length - 1];

  const allHits = readHits(log, longest)
    .filter(h => SIGNAL_EVENTS.has(h.event))
    .filter(h => h.spec_section); // drop (unset)

  const now = Date.now();
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
    const trend = computeTrend(counts, sortedWindows);
    rows.push({ section, counts, windows: sortedWindows, trend });
  }
  // Sort: most active in shortest window first; tie-break by total.
  rows.sort((a, b) => {
    if (b.counts[0] !== a.counts[0]) return b.counts[0] - a.counts[0];
    const aTotal = a.counts[a.counts.length - 1];
    const bTotal = b.counts[b.counts.length - 1];
    return bTotal - aTotal;
  });

  return { windows: sortedWindows, rows };
}

// computeTrend: arrow + optional annotation. counts and windows are both
// shortest-first. Cumulative counts are converted to per-period rates so that
// "rule still firing at the old steady-state rate" reads as ≈, not ↗ just
// because the cumulative number grew with the window.
function computeTrend(counts, windows) {
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
  if (counts[0] > 0 && olderBuckets.every(b => b === 0)) annotation = 'newly active';
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
  const { windows, rows } = report;
  const header = `Rule usage trend (${windows.map(w => `${w}d`).join(' / ')}, signal events only):`;
  if (rows.length === 0) {
    return `${header}\n  (no signal events in any window)\n`;
  }
  const sectionWidth = Math.max(...rows.map(r => r.section.length), 8);
  const numWidth = Math.max(...rows.flatMap(r => r.counts.map(c => String(c).length)), 1);
  const lines = rows.map(r => {
    const sec = r.section.padEnd(sectionWidth);
    const nums = r.counts.map(c => String(c).padStart(numWidth)).join(' / ');
    const ann = r.trend.annotation ? ` (${r.trend.annotation})` : '';
    return `  ${sec}  ${nums}  ${r.trend.arrow}${ann}`;
  });
  return `${header}\n${lines.join('\n')}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const raw = daysArg ? daysArg.split('=')[1] : (process.env.CLAUDEMD_SPARKLINE_DAYS || '30,60,90');
  const windows = raw.split(',').map(s => parseInt(s.trim(), 10));
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
