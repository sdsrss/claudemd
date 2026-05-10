import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupByHook, topPatterns, groupBySection, byBypass, byTrend, byFailOpen, uniqueInvocations, detectCutover } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const DEFAULT_TREND_DAYS = 7;

const USAGE = `Usage: node scripts/audit.js [--days=N]

Aggregate claudemd rule-hits over the last N days.
Reads ~/.claude/logs/claudemd.jsonl. Output: JSON.

Options:
  --days=N       Window in days (positive integer, default 30).
  --help, -h     Print this message and exit.

Env: CLAUDEMD_AUDIT_DAYS=N (overridden by --days=N when both set).
Wrapped by /claudemd-audit.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

export async function audit({ days = 30, trendDays = DEFAULT_TREND_DAYS } = {}) {
  const log = path.join(logsDir(), 'claudemd.jsonl');
  const { hits, totalLines, parsed, skipped } = readHits(log, days);
  // v0.8.0 R-N3 — byTrend computes recent vs prior window ratios; needs 2x
  // trendDays of data. If days < 2x trendDays, byTrend will produce a
  // truncated view (still informative — `prior` half just has less data).
  const trendHits = readHits(log, Math.max(days, 2 * trendDays)).hits;
  // v0.9.37 — cutoverTs splits the legacy `(unset)` bucket into
  // `(unset-historical)` + `(unset-current)`. Detected from the log (earliest
  // row with non-null spec_section); null when the log is entirely pre-v0.7.0
  // (no row ever carried a section), in which case bySection falls back to
  // the single-bucket `(unset)` behavior.
  const cutoverTs = detectCutover(log);
  return {
    windowDays: days,
    totalHits: hits.length,
    // dataIntegrity surfaces silent log corruption so §13.1 reviewers can
    // tell "0 hits because rule is dormant" vs "0 hits because half the
    // log lines failed JSON.parse". skipRatio in [0, 1].
    dataIntegrity: {
      totalLines,
      parsed,
      skipped,
      skipRatio: totalLines > 0 ? Math.round((skipped / totalLines) * 1000) / 1000 : 0,
      // ISO-8601 UTC. null ⇒ no spec_section row ever observed; null-section
      // rows in bySection / byTrend collapse to legacy `(unset)`.
      cutoverTs: cutoverTs != null ? new Date(cutoverTs).toISOString() : null,
    },
    byHook: groupByHook(hits),
    bySection: groupBySection(hits, cutoverTs),
    byBypass: byBypass(hits),
    byFailOpen: byFailOpen(hits),
    byTrend: byTrend(trendHits, trendDays, cutoverTs),
    // v0.9.34 R1 — per-hook dedup view; surfaces true single-invocation
    // double-fire (registration / lib bug) vs Claude fast-retry. See
    // hooks/lib/rule-hits.sh tool_use_id doc and uniqueInvocations() comment.
    uniqueInvocations: uniqueInvocations(hits),
    topPatterns: topPatterns(hits, 'banned-vocab'),
  };
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
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_AUDIT_DAYS || '30');
  // `Number()` (not `parseInt`) so '1.5' yields 1.5 — `isInteger(1.5)` rejects.
  // Pre-fix `parseInt('1.5', 10) === 1` silently truncated and ran with the
  // wrong window. Same silent-fallback family as feedback_cli_flag_shape_silent_fallback.md.
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
      `  Examples: --days=30 (default), --days=90.`
    );
    process.exit(1);
  }
  audit({ days }).then(r => console.log(JSON.stringify(r, null, 2)));
}
