import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupByHook, topPatterns } from './lib/rule-hits-parse.js';

export async function audit({ days = 30 } = {}) {
  const log = path.join(logsDir(), 'claudemd.jsonl');
  const hits = readHits(log, days);
  return {
    windowDays: days,
    totalHits: hits.length,
    byHook: groupByHook(hits),
    topPatterns: topPatterns(hits, 'banned-vocab'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const raw = daysArg ? daysArg.split('=')[1] : (process.env.CLAUDEMD_AUDIT_DAYS || '30');
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
