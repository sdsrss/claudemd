import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupByHook, topPatterns, groupBySection, byBypass, byTrend } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError } from './lib/argv.js';

const DEFAULT_TREND_DAYS = 7;

export async function audit({ days = 30, trendDays = DEFAULT_TREND_DAYS } = {}) {
  const log = path.join(logsDir(), 'claudemd.jsonl');
  const hits = readHits(log, days);
  // v0.8.0 R-N3 — byTrend computes recent vs prior window ratios; needs 2x
  // trendDays of data. If days < 2x trendDays, byTrend will produce a
  // truncated view (still informative — `prior` half just has less data).
  const trendHits = readHits(log, Math.max(days, 2 * trendDays));
  return {
    windowDays: days,
    totalHits: hits.length,
    byHook: groupByHook(hits),
    bySection: groupBySection(hits),
    byBypass: byBypass(hits),
    byTrend: byTrend(trendHits, trendDays),
    topPatterns: topPatterns(hits, 'banned-vocab'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { values: ['--days'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_AUDIT_DAYS || '30');
  const days = parseInt(raw, 10);
  if (!Number.isInteger(days) || days < 1) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
      `  Examples: --days=30 (default), --days=90.`
    );
    process.exit(1);
  }
  audit({ days }).then(r => console.log(JSON.stringify(r, null, 2)));
}
