// v0.8.0 R-N2 — HARD-rules manifest audit.
// Cross-references spec/hard-rules.json with ~/.claude/logs/claudemd.jsonl
// to drive §13.1 demote review (rules with 0 hits in 30d) and surface
// hook-vs-self enforcement split. v0.13.1 lowered the default window from
// 90d to 30d after audit data showed the 90d gate was structurally
// unreachable (log span typically 18-25d → demoteSuppressed permanent).
// 30d is enough rule-hits density to distinguish "cold" from "rare" while
// staying within typical operator log retention. Pre-fix, §13.1 / §13.2
// budget rules were operator-eyeball-only — operator had to grep the
// spec, count HARD tags by hand, and remember which had fired recently.
// This script makes it one command.

import fs from 'node:fs';
import path from 'node:path';
import { logsDir, resolvePluginRoot } from './lib/paths.js';
import {
  readHits,
  groupBySection,
  logFirstTs,
  excludeTestSessions,
  blockingDenyCount,
} from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/hard-rules-audit.js [--days=N]

Audit the HARD-rules manifest. Cross-references spec/hard-rules.json with
rule-hits.jsonl bySection over the last N days. Surfaces §13.1 demote
demote candidates and stale-review entries.

Options:
  --days=N       Window in days (positive integer, default 30).
  --help, -h     Print this message and exit.

Env: CLAUDEMD_RULES_DAYS=N (overridden by --days=N when both set).
Wrapped by /claudemd-rules.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const DEFAULT_WINDOW_DAYS = 30;

// §13.1 review cadence, per OPERATOR.md: "every ~50 L2+ tasks OR 4 weeks,
// whichever first". Independent of the hit-counting window, which is what
// `--days` sets. 90 was picked first and contradicted the handbook by 3x.
const REVIEW_CADENCE_DAYS = 28;

export async function hardRulesAudit({ days = DEFAULT_WINDOW_DAYS, pluginRoot } = {}) {
  if (!pluginRoot) {
    pluginRoot = resolvePluginRoot(import.meta.url);
  }
  const manifestPath = path.join(pluginRoot, 'spec/hard-rules.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    // Surface the failing path — without this, ENOENT / SyntaxError lands
    // with no context and operators waste turns guessing which file is broken.
    throw new Error(`hard-rules-audit: failed to load ${manifestPath}: ${e.message}`, { cause: e });
  }
  if (!manifest || !Array.isArray(manifest.rules)) {
    throw new Error(`hard-rules-audit: ${manifestPath} missing required 'rules' array`);
  }

  const log = path.join(logsDir(), 'claudemd.jsonl');
  // Strip hook-unit-test sentinels (session_id 't'/'test') BEFORE grouping —
  // mirrors audit.js. Without it, ~150 test events/window can mask a genuinely
  // cold rule from §13.1 demotion (the script's primary purpose).
  const { hits } = readHits(log, days);
  const bySection = groupBySection(excludeTestSessions(hits));

  // Detect log span. If the log doesn't reach `days` days back, "0 hits in
  // window" is uninformative — a rule fixed 5 days ago (e.g., §11-memory-read
  // in v0.9.15, which was silently no-op'd for underscore-cwd projects pre-fix)
  // would look identical to a rule that's been cold for the full window.
  // OPERATOR.md §13.1 requires "0 hits in 30d" specifically (the clause moved out of core §0.1 in v6.15.1); suppressing
  // demoteCandidates on insufficient data is the spec-compliant behavior.
  const firstTs = logFirstTs(log);
  const logSpanDays = firstTs === null ? 0 : (Date.now() - firstTs) / 86400000;
  const insufficientData = firstTs === null || logSpanDays < days;

  const rules = manifest.rules.map(r => {
    // Cross-ref by rule_hits_section. A rule with no section has no telemetry
    // surface at all and reports null (see below).
    const sectionHits = r.rule_hits_section ? bySection[r.rule_hits_section] : null;
    const total = sectionHits?.total || 0;
    const deny = blockingDenyCount(sectionHits?.byEvent); // deny + deny-repeat + deny-prose, not just literal `deny`
    const bypass = sectionHits?.byEvent?.['bypass-escape-hatch'] || 0;
    const warn = sectionHits?.byEvent?.warn || 0;
    return {
      id: r.id,
      name: r.name,
      scope: r.scope,
      enforcement: r.enforcement,
      confidence: r.confidence,
      added_version: r.added_version,
      last_demote_review: r.last_demote_review,
      // Hits are meaningful whenever the rule DECLARES a rule_hits_section —
      // not only when enforcement is hook/both (2026-07-25 audit). Five
      // self-enforced rules have advisory hooks emitting real rows under their
      // section (§11-session-exit had 39 in the live log); keying off
      // `enforcement` made those report null, i.e. "no signal", so §13.1 demote
      // review could never see them. null now means exactly one thing: the rule
      // has no telemetry surface to read.
      hits: r.rule_hits_section ? { total, deny, bypass, warn } : null,
    };
  });

  // Aggregations for §13.1/§13.2 review. The four enforcement categories
  // partition `rules` exactly — hook + self + external + both = totalRules.
  // `hookEnforced` (used for demoteCandidates below) is the union of `hook`
  // and `both`, computed inline rather than as a separate count to avoid
  // making the published `byEnforcement` shape look overlapping.
  const hookOnly = rules.filter(r => r.enforcement === 'hook');
  const selfEnforced = rules.filter(r => r.enforcement === 'self');
  const externalEnforced = rules.filter(r => r.enforcement === 'external');
  const bothEnforced = rules.filter(r => r.enforcement === 'both');
  const hookEnforced = [...hookOnly, ...bothEnforced]; // union: rules whose denials reach rule-hits.jsonl

  // Demotion candidates: hook-enforced rules with 0 hits in the audit window.
  // Self-enforced rules are excluded — their "hits" are agent-text patterns
  // not captured in rule-hits.jsonl (R-N8 transcript-side scan would fix
  // that; deferred to v0.8.1). When `insufficientData` is true (log span <
  // requested window), candidates are suppressed but surfaced in `demoteSuppressed`
  // so the operator sees what's potentially cold without auto-acting on it.
  // Safety-class exemption (v0.57.0): §8 rules are §5.1 Never-downgrade — they
  // cannot be demoted whatever the count, and their hit counts are sparse BY
  // DESIGN (the attack surface they guard is rare, not absent). Listing them as
  // demote candidates recommends a forbidden action and costs a re-adjudication
  // every review — `§8-curl-sh` sat in the queue with `demoteSuppressed: null`
  // through the 2026-07-25 audit. Same anchoring as doctor's IMMUTABLE_SECTION_RE.
  // They still appear in `safetyClassExempt` so a zero-hit safety rule is
  // visible (a gate that never fires may be broken — that is a correctness
  // question for the FN matrix, not a demotion question).
  const isSafetyClass = r => /^§8([.-]|$)/.test(r.id);
  const safetyClassExempt = hookEnforced
    .filter(r => isSafetyClass(r) && r.hits && r.hits.total === 0)
    .map(r => r.id);
  const wouldBeDemoteCandidates = hookEnforced
    .filter(r => !isSafetyClass(r) && r.hits && r.hits.total === 0)
    .map(r => r.id);
  const demoteCandidates = insufficientData ? [] : wouldBeDemoteCandidates;
  const demoteSuppressed = insufficientData
    ? {
        reason: `log spans ${logSpanDays.toFixed(1)}d; OPERATOR.md §13.1 requires ${days}d of history to evaluate demotion`,
        wouldHaveBeen: wouldBeDemoteCandidates,
      }
    : null;

  // Stale-review candidates: any rule whose last_demote_review is null, older
  // than the §13.1 cadence, or unparseable.
  //
  // The threshold is REVIEW_CADENCE_DAYS, not `days` (2026-07-26 audit). Reusing
  // the audit window made the answer to "which rules are overdue for review" move
  // with an unrelated flag: `--days=30` returned none, `--days=7` returned all 23.
  // The window says how far back to count HITS; the cadence says how long a review
  // stays fresh. An unparseable date also yielded NaN, and `NaN < cutoff` is false
  // — garbage read as "reviewed recently", the wrong direction to fail in.
  const cadenceCutoff = Date.now() - REVIEW_CADENCE_DAYS * 86400 * 1000;
  const staleReviews = rules
    .filter(r => {
      if (!r.last_demote_review) return true;
      const t = new Date(r.last_demote_review).getTime();
      if (!Number.isFinite(t)) return true;
      return t < cadenceCutoff;
    })
    .map(r => r.id);

  // OPERATOR.md §13.1 sets the demote-evaluation window at 30d (moved out of
  // core §0.1 in v6.15.1). Direct script
  // invocation accepts arbitrary `--days`, but values < DEFAULT_WINDOW_DAYS
  // produce demote candidates from a window shorter than the contract — e.g.
  // `--days=1` would surface every rule with 0 hits in the last day. Surface
  // the deviation in the JSON so the operator (or `/claudemd-rules` wrapper)
  // can flag it; do not block (some debugging flows want a narrow window).
  const cadenceWarning =
    days < DEFAULT_WINDOW_DAYS
      ? `--days=${days} is shorter than the OPERATOR.md §13.1 demote-evaluation window (${DEFAULT_WINDOW_DAYS}d); demote signals may not reflect the spec contract`
      : null;

  return {
    spec_version: manifest.spec_version,
    windowDays: days,
    cadenceWarning,
    totalRules: rules.length,
    byScope: {
      core: rules.filter(r => r.scope === 'core').length,
      extended: rules.filter(r => r.scope === 'extended').length,
    },
    // Categories partition rules exactly — sum equals totalRules.
    byEnforcement: {
      hook: hookOnly.length,
      self: selfEnforced.length,
      external: externalEnforced.length,
      both: bothEnforced.length,
    },
    byConfidence: {
      high: rules.filter(r => r.confidence === 'high').length,
      medium: rules.filter(r => r.confidence === 'medium').length,
      low: rules.filter(r => r.confidence === 'low').length,
    },
    logSpanDays: Math.round(logSpanDays * 10) / 10,
    insufficientData,
    demoteCandidates,
    demoteSuppressed,
    safetyClassExempt,
    staleReviews,
    rules,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_RULES_DAYS || String(DEFAULT_WINDOW_DAYS));
  // parsePositiveInt rejects '2.7' (truncation footgun) + '0x1e'/'1e2'
  // (Number() over-coercion) + 0/negatives — only a plain positive integer passes.
  const days = parsePositiveInt(raw);
  if (days === null) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
        `  Examples: --days=30 (default), --days=90, --days=180.`
    );
    process.exit(1);
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  hardRulesAudit({ days, pluginRoot })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => {
      console.error(`[claudemd] hard-rules-audit failed: ${err && err.message ? err.message : err}`);
      if (process.env.CLAUDEMD_DEBUG) console.error(err);
      process.exitCode = 1;
    });
}
