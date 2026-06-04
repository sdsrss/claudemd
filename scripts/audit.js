import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupByHook, topPatterns, groupBySection, byBypass, byTrend, byFailOpen, uniqueInvocations, detectCutover, excludeTestSessions, byProjectClass } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';

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
  // v0.17.7 — strip session_id='t'/'test' sentinels (hook unit-test traffic)
  // from every behavior view. Initial design filtered only bySection/byTrend
  // and left byHook raw, which produced a 4.7× internal inconsistency
  // (byHook.banned-vocab.deny=345 vs bySection["§10-V"].deny=73 on the same
  // run) — operator could not tell which was authoritative. dataIntegrity
  // alone counts the full set + surfaces the strip-count.
  const realHits = excludeTestSessions(hits);
  const realTrendHits = excludeTestSessions(trendHits);
  return {
    windowDays: days,
    totalHits: realHits.length,
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
      // v0.17.7 — diagnostic: how many session_id='t'/'test' rows were
      // stripped from every view. Lets the operator confirm the filter ran
      // and quantify hook-test traffic without grepping the raw log.
      testSessionsFiltered: hits.length - realHits.length,
    },
    byHook: groupByHook(realHits),
    bySection: groupBySection(realHits, cutoverTs),
    byBypass: byBypass(realHits),
    byFailOpen: byFailOpen(realHits),
    byTrend: byTrend(realTrendHits, trendDays, cutoverTs),
    // v0.9.34 R1 — per-hook dedup view; surfaces true single-invocation
    // double-fire (registration / lib bug) vs Claude fast-retry. See
    // hooks/lib/rule-hits.sh tool_use_id doc and uniqueInvocations() comment.
    uniqueInvocations: uniqueInvocations(realHits),
    topPatterns: topPatterns(realHits, 'banned-vocab'),
    // v0.23.8 — deny self-dogfood vs external split. Raw deny counts overstate
    // enforcement value when the plugin's own repo is the dominant traffic
    // source (e.g. banned-vocab 498/516 historically self). This view
    // separates real downstream interception from self-dogfood, per hook.
    // Scoped to the blocking-deny family (deny / deny-repeat / deny-prose;
    // excludes deny-prose-dry-run which doesn't block). See byProjectClass +
    // isBlockingDeny + classifyProject in rule-hits-parse.js.
    denyByProjectClass: byProjectClass(realHits, { mode: 'deny' }),
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
  // parsePositiveInt rejects '1.5' (truncation footgun), '0x1e'/'1e2'
  // (Number() over-coercion), and 0/negatives — only a plain positive integer
  // passes. Same silent-fallback family as feedback_cli_flag_shape_silent_fallback.md.
  const days = parsePositiveInt(raw);
  if (days === null) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
      `  Examples: --days=30 (default), --days=90.`
    );
    process.exit(1);
  }
  audit({ days }).then(r => console.log(JSON.stringify(r, null, 2)));
}
