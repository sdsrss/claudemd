import fs from 'node:fs';

// readHits — returns parsed hits within the daysBack window, alongside
// data-integrity counters so the operator can detect silent corruption.
//
// Pre-fix readHits returned `[]` on malformed lines, no-counter — a 33%
// corruption was invisible in `/claudemd-audit` output. §13.1 quarterly
// review depends on hit counts; biased input → biased demote decisions.
//
// Returns: { hits, totalLines, parsed, skipped }
//   hits        — array of parsed rows within the window (existing contract)
//   totalLines  — total non-empty lines read from the file
//   parsed      — lines that JSON.parse'd successfully (regardless of window)
//   skipped     — lines that failed JSON.parse (malformed / truncated)
//
// Out-of-window rows count as `parsed`, not `skipped` — `skipped` is reserved
// for parse-time corruption signals.
export function readHits(path, daysBack = 30) {
  if (!fs.existsSync(path)) return { hits: [], totalLines: 0, parsed: 0, skipped: 0 };
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const hits = [];
  let parsed = 0;
  let skipped = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      parsed++;
      if (new Date(row.ts).getTime() >= cutoff) hits.push(row);
    } catch {
      skipped++;
    }
  }
  return { hits, totalLines: lines.length, parsed, skipped };
}

// Earliest ts in the rule-hits log, in ms since epoch. Returns null when the
// file is missing, empty, or all rows are unparseable. Used by audit + trend
// reports to detect "log too short for the requested window" — without this,
// "0 hits in 90d" against a 17-day-old log produces false-positive demote
// signals (a rule that didn't exist 90 days ago looks identical to a rule
// that's been silent for 90 days).
export function logFirstTs(path) {
  if (!fs.existsSync(path)) return null;
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let firstTs = null;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const t = new Date(row.ts).getTime();
      if (!Number.isFinite(t)) continue;
      if (firstTs === null || t < firstTs) firstTs = t;
    } catch { /* skip malformed */ }
  }
  return firstTs;
}

// v0.9.37 — auto-detect the spec_section emit cutover. Returns ms-since-epoch
// of the earliest row carrying a non-null `spec_section`, or null when no
// such row exists (log entirely pre-v0.7.0).
//
// Why: the `(unset)` bucket in `groupBySection` conflates two different
// row kinds —
//   (a) pre-cutover historical data (legacy rows from v0.6.x and earlier
//       that physically can't have a spec_section field; will age out of
//       the audit window naturally)
//   (b) post-cutover intentional null-section events (session-start
//       bootstrap, version-sync, upstream-banner — non-spec-enforcing
//       housekeeping events, by design no section)
//   (c) post-cutover BUG: a spec-enforcing hook forgot to pass section
//       (instrumentation regression).
//
// Without cutover, (a) overwhelms (b) and (c) in steady-state; with cutover,
// `(unset-historical)` isolates (a) and `(unset-current)` exposes (b)+(c) —
// operator scans the byHook breakdown to tell intentional housekeeping from
// real instrumentation bugs.
export function detectCutover(path) {
  if (!fs.existsSync(path)) return null;
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let cutover = null;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.spec_section == null) continue;
      const t = new Date(row.ts).getTime();
      if (!Number.isFinite(t)) continue;
      if (cutover === null || t < cutover) cutover = t;
    } catch { /* skip malformed */ }
  }
  return cutover;
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

// v0.9.34 — R1 instrumentation point 2: unique_invocations dedup view.
// Distinguishes "one CC invocation logged twice" (registration / lib bug)
// from "Claude fast-retry within same second" (not a bug). Dedup key:
// (ts, hook, session_id, tool_use_id). When tool_use_id is null (Stop /
// SessionStart / SessionEnd / UserPromptSubmit hooks), falls back to
// (ts, hook, session_id) — for non-tool events, same-second + same-session
// is genuinely one event.
//
// Returns: per-hook count of distinct invocations + dupe split.
//   { hook: { rows, unique_invocations, duplicate_rows,
//             duplicate_rows_real, duplicate_rows_legacy, legacy_rows } }
//
// **Reading the dupe metrics** (v0.21.7 split — fixes the "duplicate_rows
// looks alarming but is all legacy collision noise" misread that surfaced
// in the v0.21.5 audit):
// - `duplicate_rows_real` — collision row has non-null tool_use_id.
//   This is the TRUE single-invocation double-fire signal (registration /
//   lib bug). PreToolUse / PostToolUse hook with this > 0 = investigate.
// - `duplicate_rows_legacy` — collision row has null tool_use_id. Two
//   sub-causes lumped together because both are expected behavior:
//     (a) pre-v0.9.34 legacy rows (session_id+tool_use_id both null),
//         where seconds-precision ts collisions across distinct
//         invocations are unavoidable noise.
//     (b) Stop / SessionStart / SessionEnd / UserPromptSubmit hooks
//         (tool_use_id legitimately null even post-v0.9.34) where same
//         second + same session + same hook can be one or many events
//         — the dedup key can't tell, and erring toward "one" is fine.
// - `duplicate_rows` (= `_real` + `_legacy`) — kept for backward compat.
//   Don't gate bug reports on this alone; check `_real` specifically.
//
// `legacy_rows` (separate counter) — rows where session_id AND tool_use_id
// are both null. Surfaces "N legacy rows weren't reliably deduped" so the
// operator can discount the noise floor.
export function uniqueInvocations(hits) {
  const out = {};
  for (const h of hits) {
    const hook = h.hook;
    out[hook] ||= {
      rows: 0,
      unique_invocations: 0,
      duplicate_rows: 0,
      duplicate_rows_real: 0,
      duplicate_rows_legacy: 0,
      legacy_rows: 0,
      _seen: new Set(),
    };
    out[hook].rows++;
    if (h.session_id == null && h.tool_use_id == null) {
      out[hook].legacy_rows++;
    }
    const key = `${h.ts}|${hook}|${h.session_id ?? ''}|${h.tool_use_id ?? ''}`;
    if (out[hook]._seen.has(key)) {
      out[hook].duplicate_rows++;
      if (h.tool_use_id == null) {
        out[hook].duplicate_rows_legacy++;
      } else {
        out[hook].duplicate_rows_real++;
      }
    } else {
      out[hook]._seen.add(key);
      out[hook].unique_invocations++;
    }
  }
  // Strip internal _seen Set before return.
  for (const hook of Object.keys(out)) delete out[hook]._seen;
  return out;
}

export function topPatterns(hits, hook = 'banned-vocab') {
  const counts = {};
  for (const h of hits) {
    if (h.hook !== hook || !h.extra?.matched) continue;
    for (const m of h.extra.matched) counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// v0.23.8 — self-dogfood vs external classification. The plugin's own repo
// generates the bulk of banned-vocab / §8 deny traffic (writing spec/CHANGELOG
// cites banned vocab; hook-dev sessions probe `rm -rf $VAR` with placeholder
// vars), so a raw deny count overstates real-world enforcement value — the
// 2026-06-03 maturity audit measured 498/516 banned-vocab denies as claudemd's
// own dogfood. `self` = the project path's trailing segment is `claudemd`
// (matches both the current `…-projects-claudemd` form and the legacy
// underscore-encoded `…-data_ssd-…-claudemd` form; only the basename matters).
// `unknown` = no project field (pre-v0.6.2 rows / bare CLI invocations).
export function classifyProject(project) {
  if (project == null || project === '') return 'unknown';
  // Anchor on the trailing path SEGMENT, not a bare substring: CC encodes
  // every path separator to '-', so the plugin's own repo always ends in
  // '-claudemd' (or is the literal string 'claudemd'). `/claudemd$/` alone
  // would misclassify a downstream repo like '…-myclaudemd' as self.
  return /(^|-)claudemd$/.test(project) ? 'self' : 'external';
}

// Blocking-deny family. The emitting hooks use distinct event labels for the
// same actual block — ship-baseline emits `deny` OR `deny-repeat` (both call
// hook_deny), banned-vocab emits `deny` OR `deny-prose` (both block) — so
// scoping to the literal string 'deny' undercounts real downstream
// interception (live: ship-baseline external 33 vs true 37). `deny-prose-dry-
// run` is the lone exception: it EXITS 0 (observability, no block) so it is
// NOT a real deny and must stay excluded.
const NON_BLOCKING_DENY = new Set(['deny-prose-dry-run']);
export function isBlockingDeny(event) {
  return typeof event === 'string' && event.startsWith('deny') && !NON_BLOCKING_DENY.has(event);
}

// byProjectClass — split events per hook into self / external / unknown so
// /claudemd-audit can report "banned-vocab 198 deny = 11 external / 187 self"
// instead of a misleading raw 198. `mode`:
//   'deny' (default) — the blocking-deny family (isBlockingDeny); the real
//                      enforcement-value question.
//   'all'            — every event regardless of type.
export function byProjectClass(hits, { mode = 'deny' } = {}) {
  const out = {};
  for (const h of hits) {
    if (mode === 'deny' && !isBlockingDeny(h.event)) continue;
    const hook = h.hook || '(unknown)';
    const cls = classifyProject(h.project);
    out[hook] ||= { total: 0, self: 0, external: 0, unknown: 0 };
    out[hook].total++;
    out[hook][cls]++;
  }
  return out;
}

// v0.17.7 — test-session sentinel filter. Hook unit tests run with
// session_id='t' or 'test' (see tests/hooks/*.test.sh) so the harness can
// distinguish synthetic traffic from real CC sessions. /claudemd-audit
// initially aggregated both together, which inflated byTrend regression
// ratios when a hook test suite ran (~150 test events in a 30d window).
// Filter is applied to every audit view (byHook / bySection / byTrend /
// byBypass / byFailOpen / uniqueInvocations / topPatterns); only
// dataIntegrity keeps full counts and exposes `testSessionsFiltered` so
// the operator can quantify hook-test traffic without parsing the raw log.
//
// Scope rationale: session_id=null is NOT filtered. ~80% of historical rows
// carry null because pre-v0.9.34 Stop / SessionStart / UserPromptSubmit
// hooks did not pass session_id, and bash CLI script invocations lack
// CC_SESSION_ID. Filtering null would drop legitimate hook fires en masse.
// Only the explicit 't' / 'test' sentinels (~7% of total) are filtered.
const TEST_SESSION_SENTINELS = new Set(['t', 'test']);

export function excludeTestSessions(hits) {
  return hits.filter(h => !TEST_SESSION_SENTINELS.has(h.session_id));
}

// v0.7.0 — R1 §0.1/§13.1/§13.2 instrumentation. Group rule-hits by spec
// section so /claudemd-audit can answer "which spec rule is firing", not
// just "which hook is firing". `spec_section` is populated on rows written
// by v0.7.0+; legacy rows surface under the `(unset)` bucket so the operator
// can see how much pre-upgrade data is in the window.
// groupBySection(hits, cutoverTs?) — v0.9.37 adds optional cutoverTs (ms
// since epoch). When provided, the legacy `(unset)` bucket splits into
// `(unset-historical)` (ts < cutoverTs) and `(unset-current)` (ts ≥ cutoverTs).
// When omitted (callers pre-dating v0.9.37), behavior is unchanged: all
// null-section rows collapse to `(unset)`.
export function groupBySection(hits, cutoverTs = null) {
  const bySection = {};
  for (const h of hits) {
    let key;
    if (h.spec_section) {
      key = h.spec_section;
    } else if (cutoverTs == null) {
      key = '(unset)';
    } else {
      const t = new Date(h.ts).getTime();
      key = (Number.isFinite(t) && t < cutoverTs) ? '(unset-historical)' : '(unset-current)';
    }
    bySection[key] ||= { total: 0, byEvent: {}, byHook: {} };
    bySection[key].total++;
    bySection[key].byEvent[h.event] = (bySection[key].byEvent[h.event] || 0) + 1;
    bySection[key].byHook[h.hook] = (bySection[key].byHook[h.hook] || 0) + 1;
  }
  return bySection;
}

// Round-6: hook fail-open accountability. Aggregates `event: "fail-open"`
// rows by (hook, reason) so /claudemd-audit + /claudemd-doctor can see
// "banned-vocab silently skipped 12× yesterday because jq was missing on
// the runner" — a class of incident pre-fix had zero log trace.
export function byFailOpen(hits) {
  const out = {};
  for (const h of hits) {
    if (h.event !== 'fail-open') continue;
    const hook = h.hook || '(unknown)';
    const reason = h.extra?.reason || '(unspecified)';
    out[hook] ||= { total: 0, byReason: {} };
    out[hook].total++;
    out[hook].byReason[reason] = (out[hook].byReason[reason] || 0) + 1;
  }
  return out;
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
export function byTrend(hits, windowDays = 7, cutoverTs = null) {
  const now = Date.now();
  const halfMs = windowDays * 86400 * 1000;
  const recentCutoff = now - halfMs;
  const priorCutoff = now - 2 * halfMs;

  const recent = {};
  const prior = {};
  for (const h of hits) {
    const t = new Date(h.ts).getTime();
    let key;
    if (h.spec_section) {
      key = h.spec_section;
    } else if (cutoverTs == null) {
      key = '(unset)';
    } else {
      key = (Number.isFinite(t) && t < cutoverTs) ? '(unset-historical)' : '(unset-current)';
    }
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
