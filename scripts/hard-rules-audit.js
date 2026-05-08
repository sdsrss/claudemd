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
import { readHits, groupBySection } from './lib/rule-hits-parse.js';

const DEFAULT_WINDOW_DAYS = 90;

export async function hardRulesAudit({ days = DEFAULT_WINDOW_DAYS, pluginRoot } = {}) {
  if (!pluginRoot) {
    pluginRoot = resolvePluginRoot(import.meta.url);
  }
  const manifestPath = path.join(pluginRoot, 'spec/hard-rules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const log = path.join(logsDir(), 'claudemd.jsonl');
  const hits = readHits(log, days);
  const bySection = groupBySection(hits);

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
  // that; deferred to v0.8.1).
  const demoteCandidates = hookEnforced
    .filter(r => r.hits && r.hits.total === 0)
    .map(r => r.id);

  // Stale-review candidates: any rule whose last_demote_review is null OR
  // older than the audit window. Surfaces §13.1 quarterly cadence drift.
  const staleReviews = rules.filter(r => {
    if (!r.last_demote_review) return true;
    const cutoff = Date.now() - days * 86400 * 1000;
    return new Date(r.last_demote_review).getTime() < cutoff;
  }).map(r => r.id);

  return {
    spec_version: manifest.spec_version,
    windowDays: days,
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
    demoteCandidates,
    staleReviews,
    rules,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const raw = daysArg ? daysArg.split('=')[1] : (process.env.CLAUDEMD_RULES_DAYS || String(DEFAULT_WINDOW_DAYS));
  const days = parseInt(raw, 10);
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
