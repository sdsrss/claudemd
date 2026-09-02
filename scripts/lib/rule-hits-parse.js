import fs from 'node:fs';

// readLogRows — the file read plus one JSON.parse per line, done once.
//
// `audit()` called readHits twice (two windows), then detectCutover, then
// logFirstTs; each of the four re-read the whole log and re-parsed every line,
// so one report made four passes over one file (2026-08-29 audit R10-20). The
// three still take a path and behave identically when called on their own —
// passing `pre` in is what skips the repeat.
//
// `t` is computed here rather than by each caller so the `row.ts == null` guard
// documented under readHits has exactly one home: `new Date(null).getTime()` is
// 0 (finite, epoch) while `new Date(undefined)` is NaN, and treating a missing
// ts as a valid 1970 event is the corruption these counters exist to surface.
// The log's rotated generations that actually exist, oldest → newest.
//
// hooks/lib/rule-hits.sh has rotated `claudemd.jsonl` → `.1` → `.2` at 5 MB
// since v0.9.x, and until the 2026-09-02 audit (R11-06) not one reader on
// either side ever opened `.1` — `grep -rn 'jsonl\.1' scripts bin` found a
// single comment in uninstall.js. The failure was time-fused rather than
// latent: at ~26 KB/day the first rotation was ~68 days out, and on that day
// the primary file is near-empty. Consumers with a `logFirstTs` span guard
// would have reported a suddenly-tiny window; the two without one
// (memory-maintenance's 90-day liveness set, lesson-bypass-audit's
// cite-recall) would have reported a confident wrong answer — every durable
// memory "never mentioned" — with nothing in the output to say why.
//
// Fixing it here rather than at the call sites is what makes it one change:
// readHits / logFirstTs / detectCutover and all five scripts downstream of
// them read through this function.
export function logGenerations(logPath) {
  return [`${logPath}.2`, `${logPath}.1`, logPath].filter(p => fs.existsSync(p));
}

export function readLogRows(path) {
  const rows = [];
  let totalLines = 0;
  let badJson = 0;
  for (const gen of logGenerations(path)) {
    const lines = fs.readFileSync(gen, 'utf8').split('\n').filter(Boolean);
    totalLines += lines.length;
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        badJson++;
        continue;
      }
      rows.push({ row, t: (row.ts == null) ? NaN : new Date(row.ts).getTime() });
    }
  }
  return { rows, totalLines, badJson };
}

// readHits — returns parsed hits within the daysBack window, alongside
// data-integrity counters so the operator can detect silent corruption.
//
// Pre-fix readHits returned `[]` on malformed lines, no-counter — a 33%
// corruption was invisible in `/claudemd-audit` output. The §13.1 demote
// review depends on hit counts; biased input → biased demote decisions.
//
// Returns: { hits, totalLines, parsed, skipped }
//   hits        — array of parsed rows within the window (existing contract)
//   totalLines  — total non-empty lines read from the file
//   parsed      — usable rows: JSON.parse'd AND carry a finite `ts` (any window)
//   skipped     — corrupt rows: failed JSON.parse OR missing/unparseable `ts`
//
// `parsed + skipped === totalLines` always. Out-of-window (finite-ts) rows
// count as `parsed`, not `skipped`. A row that JSON-parses but has a
// missing/null/non-date `ts` is corruption, not a valid out-of-window row:
// `new Date(bad).getTime()` is NaN, `NaN >= cutoff` is false, so pre-fix it
// vanished from `hits` while still counting as `parsed` with `skipped:0` — a
// false 0% skipRatio that hid truncated rows from §13.1 demote reviewers.
export function readHits(path, daysBack = 30, pre = null) {
  // Missing file and empty file both arrive here as zero rows and fall through
  // the loop to the same { [], 0, 0, 0 } the explicit existsSync guard used to
  // return, so there is no separate early exit any more.
  const { rows, totalLines, badJson } = pre ?? readLogRows(path);
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const hits = [];
  let parsed = 0;
  let skipped = badJson;
  for (const { row, t } of rows) {
    if (!Number.isFinite(t)) { skipped++; continue; }
    parsed++;
    if (t >= cutoff) hits.push(row);
  }
  return { hits, totalLines, parsed, skipped };
}

// Earliest ts in the rule-hits log, in ms since epoch. Returns null when the
// file is missing, empty, or all rows are unparseable. Used by audit + trend
// reports to detect "log too short for the requested window" — without this,
// "0 hits in 30d" against a 17-day-old log produces false-positive demote
// signals (a rule that didn't exist 30 days ago looks identical to a rule
// that's been silent for 30 days). The example used to say 90d, which stopped
// being the window in v6.11.15.
export function logFirstTs(path, pre = null) {
  const { rows } = pre ?? readLogRows(path);
  let firstTs = null;
  for (const { t } of rows) {
    if (!Number.isFinite(t)) continue;
    if (firstTs === null || t < firstTs) firstTs = t;
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
export function detectCutover(path, pre = null) {
  const { rows } = pre ?? readLogRows(path);
  let cutover = null;
  for (const { row, t } of rows) {
    if (row.spec_section == null) continue;
    // The null/missing-ts → NaN guard now lives in readLogRows. It stays
    // load-bearing here for the same reason: a section-bearing null-ts row
    // treated as epoch-0 would set cutover to 1970 and collapse the
    // (unset-historical)/(unset-current) split, dropping every null-section row
    // into (unset-current).
    if (!Number.isFinite(t)) continue;
    if (cutover === null || t < cutover) cutover = t;
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
// from "Claude fast-retry within same second" (not a bug). Dedup key
// (v0.23.21): (ts, hook, session_id, tool_use_id, event, extra). The
// original four-field key mis-counted MULTI-EMIT hooks: pre-bash-safety
// logs one row per matched pattern in a compound command (distinct
// extra.var, or mixed §8-rm-rf-var + §8-npx sections), all sharing one
// (ts, hook, session_id, tool_use_id) — so every row after the first was
// counted as a duplicate, faking the registration double-fire signal (77
// phantom duplicate_rows_real on a 30-day live-log window, 2026-07-02
// audit). Including (event, extra) makes the metric mean what its doc
// claims — a true double-fire emits BYTE-IDENTICAL rows (same event+extra)
// and still collides. When tool_use_id is null (Stop / SessionStart /
// SessionEnd / UserPromptSubmit hooks), it contributes '' to the key —
// for non-tool events, same-second + same-session + same event+extra is
// genuinely one event.
//
// Returns: per-hook count of distinct invocations + dupe split.
//   { hook: { rows, unique_invocations, duplicate_rows,
//             duplicate_rows_real, duplicate_rows_legacy, legacy_rows } }
//
// **Reading the dupe metrics** (v0.21.7 split — fixes the "duplicate_rows
// looks alarming but is all legacy collision noise" misread that surfaced
// in the v0.21.5 audit):
// - `duplicate_rows_real` — collision row has non-null tool_use_id AND is
//   byte-identical (same event+extra) to an earlier row in the same
//   invocation. This is the TRUE single-invocation double-fire signal
//   (registration / lib bug). PreToolUse / PostToolUse hook with this > 0
//   = investigate — BUT for MULTI-EMIT hooks (pre-bash-safety) a residual
//   can still arise when one command repeats the SAME pattern
//   (`rm -rf $D; …; rm -rf $D` → two identical rows); telemetry can't
//   tell that from a double-registration, so confirm against the source
//   command before treating it as a bug.
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
// v0.23.22 — canonicalize `extra` before it enters the dedup key. The key
// compares (event, extra) to separate a real double-fire (byte-identical
// rows) from legitimate multi-emit (differing extra), so it depends on stable
// key order in the serialized extra. Today every hook builds `extra` from
// fixed literal templates or single-key objects, and the only multi-key extra
// (mem-audit `{missing,drift}`) is emitted with a null tool_use_id so it never
// reaches `_real` — but a future multi-key extra on a tool_use_id-bearing hook
// built from an unordered source (`declare -A` iteration) would let a genuine
// double-fire evade detection. Sorting top-level keys closes that hazard with
// zero behavior change on current data (single-key / null / array extras are
// unaffected). Extras are shallow by convention, so top-level order is the
// whole surface.
function stableExtraKey(extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    return JSON.stringify(extra ?? null);
  }
  const sorted = {};
  for (const k of Object.keys(extra).sort()) sorted[k] = extra[k];
  return JSON.stringify(sorted);
}

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
    const key = `${h.ts}|${hook}|${h.session_id ?? ''}|${h.tool_use_id ?? ''}|${h.event ?? ''}|${stableExtraKey(h.extra)}`;
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

// blockingDenyCount(byEvent) — sum every blocking-deny-family event in a
// groupBySection `byEvent` map (deny + deny-repeat + deny-prose, excluding the
// advisory deny-prose-dry-run). Callers that hardcoded `byEvent.deny` undercount
// real blocks: banned-vocab Path-2 emits `deny-prose`, ship-baseline + memory-
// read-check emit `deny-repeat`. Undercounting the deny side inflates the
// bypass:deny ratio and can FALSELY flag a healthy rule as a §0.1 demote
// candidate (doctor.js) or misreport per-rule blocks (hard-rules-audit.js).
export function blockingDenyCount(byEvent) {
  if (!byEvent) return 0;
  let n = 0;
  for (const [event, count] of Object.entries(byEvent)) {
    if (isBlockingDeny(event)) n += count;
  }
  return n;
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
//
// v0.23.20 — manual hook debugging writes ad-hoc sentinels too ('s', 'p',
// 'probe', 'r4-test'); on 2026-06-09 eight ship-baseline fixture rows with
// session_id='s' slipped past the full-match set, inflating self-deny counts
// and faking a duplicate_rows_real double-fire signal in /claudemd-audit.
// Real CC session ids are 36-char UUIDs, so any non-null id of ≤7 chars is
// synthetic. Longer one-off sentinels ('dogfood-fresh', 'smoke-test') are
// deliberately NOT filtered — 7 rows all-time, they age out of every window.
const TEST_SESSION_SENTINELS = new Set(['t', 'test']);
const SENTINEL_MAX_LEN = 7;

export function excludeTestSessions(hits) {
  return hits.filter(h => {
    if (h.session_id == null) return true;
    // A non-string session_id used to be dropped silently: `(12345).length` is
    // undefined and `undefined > 7` is false, so the row vanished from every
    // audit view without being counted anywhere — unlike the deliberate sentinel
    // filter, which reports `testSessionsFiltered` (2026-07-26 audit). Hooks write
    // strings or null today, so this is latent; keep such a row rather than lose
    // it, since only the SENTINEL shapes are meant to be excluded.
    if (typeof h.session_id !== 'string') return true;
    return !TEST_SESSION_SENTINELS.has(h.session_id) && h.session_id.length > SENTINEL_MAX_LEN;
  });
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
      const t = (h.ts == null) ? NaN : new Date(h.ts).getTime();
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
// v0.64.0 — `bySubject` answers the question a token count cannot: not "how often
// was this hatch used" but "used AGAINST WHAT". A token count says §8-npx was
// overridden 12 times; it cannot distinguish 12 overrides of one badly-worded rule
// from 12 different legitimate one-offs, and those imply opposite actions. Subject
// keys are the small credential-free descriptors the hooks record (`vars` /
// `runner` / `rule` / `shape` / `source`→`sink`); rows predating the emitters group
// under `(no subject)` so a series spanning the change is visibly split rather than
// silently averaged. Purely additive: `byToken` keeps its shape for existing callers.
export function byBypass(hits) {
  const byToken = {};
  for (const h of hits) {
    if (h.event !== 'bypass-escape-hatch') continue;
    const token = h.extra?.token || '(unspecified)';
    byToken[token] ||= { total: 0, byHook: {}, bySubject: {} };
    byToken[token].total++;
    byToken[token].byHook[h.hook] = (byToken[token].byHook[h.hook] || 0) + 1;
    const subject = bypassSubject(h.extra);
    byToken[token].bySubject[subject] = (byToken[token].bySubject[subject] || 0) + 1;
  }
  return byToken;
}

// One descriptor per row, in the order the emitters set them. Kept as a function
// rather than inlined so a new emitter field has exactly one place to be taught,
// and so the "which key wins" decision is greppable instead of implied.
export function bypassSubject(extra) {
  if (!extra || typeof extra !== 'object') return '(no subject)';
  if (extra.rule) return String(extra.rule);
  if (extra.shape) {
    return extra.source && extra.sink
      ? `${extra.shape}:${extra.source}->${extra.sink}`
      : String(extra.shape);
  }
  if (extra.runner) return String(extra.runner);
  if (extra.vars) return `vars:${extra.vars}`;
  if (Array.isArray(extra.matched) && extra.matched.length) return String(extra.matched[0]);
  if (extra.bypass_reason) return String(extra.bypass_reason);
  return '(no subject)';
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
    const t = (h.ts == null) ? NaN : new Date(h.ts).getTime();
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
