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
  const days = parseInt(process.env.CLAUDEMD_AUDIT_DAYS || '30', 10);
  audit({ days }).then(r => console.log(JSON.stringify(r, null, 2)));
}
