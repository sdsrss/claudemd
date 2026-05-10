// v0.8.0 R-N2 — HARD-rules manifest audit.
// Cross-references spec/hard-rules.json with ~/.claude/logs/claudemd.jsonl
// to drive §13.1 quarterly demote (rules with 0 hits in 90d) and surface
// hook-vs-self enforcement split. Pre-fix, §13.1 / §13.2 budget rules
// were operator-eyeball-only — operator had to grep the spec, count HARD
// tags by hand, and remember which had fired recently. This script makes
// it one command.

import fs from 'node:fs';
import path from 'node:path';
import { logsDir, resolvePluginRoot } from './lib/paths.js';
import { readHits, groupBySection, logFirstTs } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/hard-rules-audit.js [--days=N]

Audit the HARD-rules manifest. Cross-references spec/hard-rules.json with
rule-hits.jsonl bySection over the last N days. Surfaces §13.1 quarterly
demote candidates and stale-review entries.

Options:
  --days=N       Window in days (positive integer, default 90).
  --help, -h     Print this message and exit.

Env: CLAUDEMD_RULES_DAYS=N (overridden by --days=N when both set).
Wrapped by /claudemd-rules.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const DEFAULT_WINDOW_DAYS = 90;

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
    throw new Error(`hard-rules-audit: failed to load ${manifestPath}: ${e.message}`);
  }
  if (!manifest || !Array.isArray(manifest.rules)) {
    throw new Error(`hard-rules-audit: ${manifestPath} missing required 'rules' array`);
  }

  const log = path.join(logsDir(), 'claudemd.jsonl');
  const { hits } = readHits(log, days);
  const bySection = groupBySection(hits);

  // Detect log span. If the log doesn't reach `days` days back, "0 hits in
  // window" is uninformative — a rule fixed 5 days ago (e.g., §11-memory-read
  // in v0.9.15, which was silently no-op'd for underscore-cwd projects pre-fix)
  // would look identical to a rule that's been cold for 90 days. §0.1 HARD
  // requires "0 hits in 90d" specifically; suppressing demoteCandidates on
  // insufficient data is the spec-compliant behavior.
  const firstTs = logFirstTs(log);
  const logSpanDays = firstTs === null ? 0 : (Date.now() - firstTs) / 86400000;
  const insufficientData = firstTs === null || logSpanDays < days;

  const rules = manifest.rules.map(r => {
    // Cross-ref by rule_hits_section. Self-enforced rules have null and stay
    // at hits=0 — that's expected, not a demotion signal for self-rules.
    const sectionHits = r.rule_hits_section ? bySection[r.rule_hits_section] : null;
    const total = sectionHits?.total || 0;
    const deny = sectionHits?.byEvent?.deny || 0;
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
      // Hits only meaningful when enforcement includes "hook" or "both".
      // For "self"/"external" rules we surface hits as null (not 0) to
      // disambiguate "we have no signal" from "rule fired zero times".
      hits: r.enforcement === 'hook' || r.enforcement === 'both'
        ? { total, deny, bypass, warn }
        : null,
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
  const wouldBeDemoteCandidates = hookEnforced
    .filter(r => r.hits && r.hits.total === 0)
    .map(r => r.id);
  const demoteCandidates = insufficientData ? [] : wouldBeDemoteCandidates;
  const demoteSuppressed = insufficientData ? {
    reason: `log spans ${logSpanDays.toFixed(1)}d; §0.1 HARD requires ${days}d of history to evaluate demotion`,
    wouldHaveBeen: wouldBeDemoteCandidates,
  } : null;

  // Stale-review candidates: any rule whose last_demote_review is null OR
  // older than the audit window. Surfaces §13.1 quarterly cadence drift.
  const staleReviews = rules.filter(r => {
    if (!r.last_demote_review) return true;
    const cutoff = Date.now() - days * 86400 * 1000;
    return new Date(r.last_demote_review).getTime() < cutoff;
  }).map(r => r.id);

  // §0.1 hard-codes a 90d quarterly cadence for demote review. Direct script
  // invocation accepts arbitrary `--days`, but values < DEFAULT_WINDOW_DAYS
  // produce demote candidates from a window shorter than the contract — e.g.
  // `--days=1` would surface every rule with 0 hits in the last day. Surface
  // the deviation in the JSON so the operator (or `/claudemd-rules` wrapper)
  // can flag it; do not block (some debugging flows want a narrow window).
  const cadenceWarning = days < DEFAULT_WINDOW_DAYS
    ? `--days=${days} is shorter than the §0.1 quarterly cadence (${DEFAULT_WINDOW_DAYS}d); demote signals may not reflect the spec contract`
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
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const raw = parsed.values['--days'] ?? (process.env.CLAUDEMD_RULES_DAYS || String(DEFAULT_WINDOW_DAYS));
  // `Number()` (not `parseInt`) so '1.5' yields 1.5 — `isInteger(1.5)` rejects.
  // Pre-fix `parseInt('2.7', 10) === 2` silently truncated.
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    console.error(
      `--days requires a positive integer (got '${raw}').\n` +
      `  Examples: --days=30, --days=90 (default), --days=180.`
    );
    process.exit(1);
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  hardRulesAudit({ days, pluginRoot }).then(r => console.log(JSON.stringify(r, null, 2)));
}
