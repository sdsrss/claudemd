import path from 'node:path';
import { logsDir } from './lib/paths.js';
import {
  readHits,
  readLogRows,
  groupByHook,
  topPatterns,
  groupBySection,
  byBypass,
  byTrend,
  byFailOpen,
  uniqueInvocations,
  detectCutover,
  excludeTestSessions,
  byProjectClass,
  logFirstTs,
} from './lib/rule-hits-parse.js';
import { ArgvError, parseStrict, printHelpAndExit, resolveDaysFlag, invokedAsMain } from './lib/argv.js';
import { samplingAudit, PRECISION_GATE } from './sampling-audit.js';

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
  // One read + one JSON.parse pass for all four consumers below. They each used
  // to re-read and re-parse the whole log — four passes over one file per report
  // (2026-08-29 audit R10-20). Reading once also removes a smaller hazard: the
  // four passes could observe DIFFERENT file contents, since hooks append to
  // this log while the audit runs.
  const pre = readLogRows(log);
  const { hits, totalLines, parsed, skipped } = readHits(log, days, pre);
  // v0.8.0 R-N3 — byTrend computes recent vs prior window ratios; needs 2x
  // trendDays of data. If days < 2x trendDays, byTrend will produce a
  // truncated view (still informative — `prior` half just has less data).
  const trendHits = readHits(log, Math.max(days, 2 * trendDays), pre).hits;
  // v0.9.37 — cutoverTs splits the legacy `(unset)` bucket into
  // `(unset-historical)` + `(unset-current)`. Detected from the log (earliest
  // row with non-null spec_section); null when the log is entirely pre-v0.7.0
  // (no row ever carried a section), in which case bySection falls back to
  // the single-bucket `(unset)` behavior.
  const cutoverTs = detectCutover(log, pre);
  const firstTs = logFirstTs(log, pre);
  // v0.17.7 — strip session_id='t'/'test' sentinels (hook unit-test traffic;
  // v0.23.20 also ≤7-char ad-hoc debug sentinels like 's'/'probe')
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
      // v0.17.7 — diagnostic: how many test-sentinel rows were
      // stripped from every view. Lets the operator confirm the filter ran
      // and quantify hook-test traffic without grepping the raw log.
      testSessionsFiltered: hits.length - realHits.length,
      // 2026-08-16 audit GROWTH-1 — window-coverage guard. Rotation is
      // size-triggered (5MB) while this report's window is time-based and
      // reads only the primary file, so post-rotation (or on a young log)
      // "0 hits in Nd" can mean "the log only goes back M<N days".
      // hard-rules-audit and sparkline already call logFirstTs for this;
      // audit.js was the one consumer that didn't.
      logFirstTs: firstTs != null ? new Date(firstTs).toISOString() : null,
      logSpanDays: firstTs != null ? Math.round(((Date.now() - firstTs) / 86400000) * 10) / 10 : null,
      // false ⇒ counts near the window's far edge are truncated, not dormant.
      windowCovered: firstTs != null ? firstTs <= Date.now() - days * 86400000 : null,
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
    // v0.28.0 A5 — self-enforced-rule compliance from the retrospective
    // transcript scan (current project, same window). A4 pre-registered gate:
    // a rule's `rate` stays null (withheld) until hand-labeled precision ≥
    // PRECISION_GATE — heuristic counts are collected, not presented, before
    // calibration. See scripts/sampling-audit.js header + plan A2/A4.
    selfCompliance: await selfCompliance(days),
  };
}

async function selfCompliance(days) {
  const sa = await samplingAudit({ days });
  const rules = {};
  for (const [k, v] of Object.entries(sa.byRule)) {
    const calibrated = v.precision != null && v.precision >= PRECISION_GATE;
    // Honor the CALIBRATION record's status verbatim (2026-07-25 audit,
    // loop-F1): recomputing from precision alone showed permanently-CLOSED
    // detectors as 'collecting' — advertising exactly the "keep collecting"
    // posture the 2026-07-24 labeling pass rejected. Rate stays A4-withheld
    // for closed detectors (their precision upper bounds sit below the gate).
    rules[k] = {
      opportunities: v.opportunities,
      violations: v.violations,
      rate:
        calibrated && v.opportunities > 0 ? Math.round((v.violations / v.opportunities) * 1000) / 1000 : null,
      precision: v.precision,
      status:
        v.status === 'closed'
          ? 'closed'
          : calibrated
            ? 'calibrated'
            : `collecting (rate withheld until hand-labeled precision >= ${PRECISION_GATE})`,
      ...(v.closedReason ? { closedReason: v.closedReason } : {}),
    };
  }
  return {
    windowDays: sa.windowDays,
    scannedTranscripts: sa.scannedTranscripts,
    totalTurns: sa.totalTurns,
    metricContract: sa.metricContract,
    rules,
  };
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { values: ['--days'] });
  } catch (e) {
    if (e instanceof ArgvError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  const { raw, days } = resolveDaysFlag(parsed, { env: 'CLAUDEMD_AUDIT_DAYS', dflt: '30' });
  // parsePositiveInt rejects '1.5' (truncation footgun), '0x1e'/'1e2'
  // (Number() over-coercion), and 0/negatives — only a plain positive integer
  // passes. Same silent-fallback family as feedback_cli_flag_shape_silent_fallback.md.
  if (days === null) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` + `  Examples: --days=30 (default), --days=90.`
    );
    process.exit(1);
  }
  audit({ days })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => {
      // Same handler as status.js / doctor.js: a throw inside audit()
      // otherwise prints a bare unhandled-rejection stack instead of the
      // report (audit-2026-08-22 条目 16 — one of three entries missing it).
      console.error(`[claudemd] audit failed: ${err && err.message ? err.message : err}`);
      if (process.env.CLAUDEMD_DEBUG) console.error(err);
      process.exitCode = 1;
    });
}
