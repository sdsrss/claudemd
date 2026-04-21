import fs from 'node:fs';

export function readHits(path, daysBack = 30) {
  if (!fs.existsSync(path)) return [];
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const hits = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (new Date(row.ts).getTime() >= cutoff) hits.push(row);
    } catch { /* skip malformed */ }
  }
  return hits;
}

export function groupByHook(hits) {
  const byHook = {};
  for (const h of hits) {
    byHook[h.hook] ||= { total: 0, byEvent: {} };
    byHook[h.hook].total++;
    byHook[h.hook].byEvent[h.event] = (byHook[h.hook].byEvent[h.event] || 0) + 1;
  }
  return byHook;
}

export function topPatterns(hits, hook = 'banned-vocab') {
  const counts = {};
  for (const h of hits) {
    if (h.hook !== hook || !h.extra?.matched) continue;
    for (const m of h.extra.matched) counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
