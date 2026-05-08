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

// v0.7.0 — R1 §0.1/§13.1/§13.2 instrumentation. Group rule-hits by spec
// section so /claudemd-audit can answer "which spec rule is firing", not
// just "which hook is firing". `spec_section` is populated on rows written
// by v0.7.0+; legacy rows surface under the `(unset)` bucket so the operator
// can see how much pre-upgrade data is in the window.
export function groupBySection(hits) {
  const bySection = {};
  for (const h of hits) {
    const key = h.spec_section || '(unset)';
    bySection[key] ||= { total: 0, byEvent: {}, byHook: {} };
    bySection[key].total++;
    bySection[key].byEvent[h.event] = (bySection[key].byEvent[h.event] || 0) + 1;
    bySection[key].byHook[h.hook] = (bySection[key].byHook[h.hook] || 0) + 1;
  }
  return bySection;
}

// v0.7.0 — R3 bypass-escape-hatch dashboard. Per-token aggregation over
// `bypass-escape-hatch` events: how often each escape token (`allow-banned-
// vocab` / `allow-rm-rf-var` / `allow-npx-unpinned` / `skip-memory-check`)
// has been used, broken down by hook. High counts on a single token signal
// a rule that's too strict / poorly worded — the §0.1 demotion candidate
// indicator. Pre-v0.7.0 these events sat in the log unaggregated; only
// raw `jq` queries against `~/.claude/logs/claudemd.jsonl` could surface them.
export function byBypass(hits) {
  const byToken = {};
  for (const h of hits) {
    if (h.event !== 'bypass-escape-hatch') continue;
    const token = h.extra?.token || '(unspecified)';
    byToken[token] ||= { total: 0, byHook: {} };
    byToken[token].total++;
    byToken[token].byHook[h.hook] = (byToken[token].byHook[h.hook] || 0) + 1;
  }
  return byToken;
}

// v0.8.0 — R-N3 week-over-week regression. Splits hits into two windows
// (recent N days vs prior N days) and reports per-section ratio change.
// Surfaces hot spots — "§11-memory-read deny rate doubled this week" —
// that single-window aggregations miss. Sections firing only in one half
// emit ratio Infinity (new) or 0 (silenced) so the operator can spot
// activation/deactivation transitions.
//
// Inputs: hits already filtered to the combined window (both halves);
// windowDays = days per half. Caller must pass 2× window when reading.
export function byTrend(hits, windowDays = 7) {
  const now = Date.now();
  const halfMs = windowDays * 86400 * 1000;
  const recentCutoff = now - halfMs;
  const priorCutoff = now - 2 * halfMs;

  const recent = {};
  const prior = {};
  for (const h of hits) {
    const t = new Date(h.ts).getTime();
    const key = h.spec_section || '(unset)';
    if (t >= recentCutoff) {
      recent[key] = (recent[key] || 0) + 1;
    } else if (t >= priorCutoff) {
      prior[key] = (prior[key] || 0) + 1;
    }
  }

  const sections = new Set([...Object.keys(recent), ...Object.keys(prior)]);
  const trend = {};
  for (const s of sections) {
    const r = recent[s] || 0;
    const p = prior[s] || 0;
    let ratio;
    let flag = 'stable';
    if (p === 0 && r === 0) continue; // shouldn't happen, defensive
    if (p === 0) {
      ratio = null; // newly active — ratio undefined
      flag = 'newly_active';
    } else if (r === 0) {
      ratio = 0;
      flag = 'silenced';
    } else {
      ratio = r / p;
      if (ratio >= 2) flag = 'regression';
      else if (ratio <= 0.5) flag = 'recovery';
    }
    trend[s] = { recent: r, prior: p, ratio, flag, windowDays };
  }
  return trend;
}
