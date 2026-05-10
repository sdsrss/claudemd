// v0.9.31 — Static audit of claudemd hooks for spec §8 SAFETY partial-impl
// gaps. Catches the v0.9.30 signature: hook header / deny message quotes a
// multi-link spec rule (e.g. "lockfile → local → pinned whitelist; none →
// [AUTH REQUIRED]") but only one link has implementing code. Header comments
// and deny strings are documentation, not proof — see
// feedback_hook_header_quote_partial_impl.md.
//
// Heuristic, not exhaustive:
//   1. arrow-claim sweep — every '→' in any hook surfaces as a claim site;
//      clauses split on '→' and ';' get keyword-grepped against the hook's
//      code body. A clause with zero keyword hits → partial-impl candidate.
//   2. rule cross-ref — for each spec/hard-rules.json entry with
//      enforcement=hook|both, find a hook calling hook_record with its
//      rule_hits_section. Missing → unimplemented.
//   3. spec anchor checks — known-shape checks for rules whose spec text
//      enumerates a fixed list (currently: §8 rm-rf var whitelist).
//
// Exit code 0 always — heuristic; output is the artifact.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/safety-coverage-audit.js [--json] [--hook=<basename>]

Static analysis of claudemd hooks for spec §8 SAFETY partial-implementation
gaps. Catches the v0.9.30 signature: hook header / deny message quotes a
multi-link spec rule but only one link has code.

Detects:
  - Multi-clause arrow claims (text containing '→') in hook headers / deny
    strings, with per-clause keyword grep against the hook's code body.
  - hard-rules.json entries with enforcement=hook|both that no hook records
    under (unimplemented).
  - §8 rm-rf $VAR whitelist anchor: every spec-named whitelisted var
    (HOME/PWD/OLDPWD/TMPDIR) must appear in the hook's case statement.

Output: human-readable report by default; '--json' emits structured JSON.

Options:
  --json              Emit JSON instead of human-readable report.
  --hook=<basename>   Audit only the named hook (e.g. 'pre-bash-safety-check.sh').
  --help, -h          Print this message and exit.

Exit codes: 0 success | 2 argv-shape error.`;

const HOOKS_DIR = 'hooks';

// Spec quotes wrap arrows in whitespace ("lockfile → local"). Regex literals
// pack arrows against meta chars ("(→|->|=>)" in banned-vocab-check.sh:81).
// Require whitespace bounds to keep the audit on the spec-quote shape.
const ARROW_CLAIM_RE = /(?:^|\s)→(?:\s|$)/;

// Stop words: grammatical / context tokens that shouldn't drive coverage.
// 'none' is grammatical here ("none of the above"), not a code keyword.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'or', 'and', 'no', 'not', 'none', 'with', 'without',
  'in', 'on', 'of', 'to', 'is', 'are', 'be', 'as', 'by', 'for', 'from',
  'spec', 'rule', 'this', 'that', 'these', 'those', 'then', 'else',
  'pkg', 'cwd', 'var', 'etc', 'fix', 'link', 'note',
]);

function splitClauses(text) {
  return text.split(/[→;]/).map(s => s.trim()).filter(Boolean);
}

function clauseKeywords(clause) {
  return clause
    .toLowerCase()
    .replace(/[`"'\[\]()]/g, '')
    .split(/[\s/,]+/)
    .map(w => w.replace(/[^a-z0-9_§.]/g, ''))
    .filter(w => w && !STOP_WORDS.has(w) && w.length >= 3);
}

function clauseCoverage(clause, codeBody) {
  const keywords = clauseKeywords(clause);
  if (keywords.length === 0) return { clause, coverage: 'unknown', keywords, keywordHits: [] };
  const lower = codeBody.toLowerCase();
  const hits = keywords.filter(kw => lower.includes(kw));
  return {
    clause,
    coverage: hits.length > 0 ? 'covered' : 'gap',
    keywords,
    keywordHits: hits,
  };
}

// Strip the leading header comment block (#! shebang + initial '#' lines +
// blank lines until the first real code) so keyword grep against "code body"
// doesn't trivially hit the comment we're auditing. Mid-file comments stay
// in body — they often annotate the implementation.
function stripHeaderComments(source) {
  const lines = source.split('\n');
  let i = 0;
  if (i < lines.length && lines[i].startsWith('#!')) i++;
  while (i < lines.length && (/^\s*#/.test(lines[i]) || /^\s*$/.test(lines[i]))) i++;
  return lines.slice(i).join('\n');
}

// Scan source for every line containing '→'. Group adjacent comment lines
// into a single block so claims wrapped across two #-lines stay together.
// Non-comment arrow lines (e.g. the REASON_TEXT deny string) are reported
// per-line.
function findArrowClaimSites(source, hookRel) {
  const lines = source.split('\n');
  const sites = [];

  // Phase 1: contiguous comment blocks containing any '→'.
  let i = 0;
  while (i < lines.length) {
    if (/^\s*#/.test(lines[i])) {
      const start = i;
      const buf = [];
      while (i < lines.length && /^\s*#/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*#\s?/, ''));
        i++;
      }
      const block = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (ARROW_CLAIM_RE.test(block)) {
        sites.push({
          hook: hookRel,
          startLine: start + 1,
          endLine: start + buf.length,
          location: 'header',
          text: block,
          clauses: splitClauses(block),
        });
      }
      continue;
    }
    i++;
  }

  // Phase 2: non-comment lines containing arrows (deny strings, REASON_TEXT).
  // String-spanning multi-line REASON_TEXT — collapse adjacent non-comment
  // arrow-bearing lines under the same start line.
  let lastEnd = -1;
  for (let j = 0; j < lines.length; j++) {
    if (/^\s*#/.test(lines[j])) continue;
    if (!ARROW_CLAIM_RE.test(lines[j])) continue;
    if (j === lastEnd + 1) {
      // Extend the previous string-claim site.
      const prev = sites[sites.length - 1];
      prev.endLine = j + 1;
      prev.text = (prev.text + ' ' + lines[j].trim()).replace(/\s+/g, ' ').trim();
      prev.clauses = splitClauses(prev.text);
      lastEnd = j;
      continue;
    }
    sites.push({
      hook: hookRel,
      startLine: j + 1,
      endLine: j + 1,
      location: 'string',
      text: lines[j].trim(),
      clauses: splitClauses(lines[j]),
    });
    lastEnd = j;
  }

  return sites;
}

// Spec anchor: §8 rm-rf $VAR whitelist. Spec text is "rm -rf $VAR without
// validating VAR" — the hook chose HOME/PWD/OLDPWD/TMPDIR as the always-set
// low-blast set. Verify every var in that set appears as a case-arm token
// in pre-bash-safety-check.sh, not only in the header comment.
function checkRmRfWhitelist(hooksDir) {
  const expected = ['HOME', 'PWD', 'OLDPWD', 'TMPDIR'];
  const target = path.join(hooksDir, 'pre-bash-safety-check.sh');
  if (!fs.existsSync(target)) {
    return { status: 'unknown', present: [], missing: expected, source: target, note: 'hook missing' };
  }
  const src = fs.readFileSync(target, 'utf8');
  const codeBody = stripHeaderComments(src);
  // Extract case-arm token list — match `case "$var" in PATTERN_LIST)` then
  // walk forward gathering the patterns up to esac. Conservative: just grep
  // for any case arm whose pattern set contains all four vars on one line.
  // Real shape (line 203): `case "$varname" in HOME|PWD|OLDPWD|TMPDIR) ;;`
  const caseArmRe = /case\s+"?\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?"?\s+in\b([\s\S]*?)\besac\b/g;
  let present = [];
  let armSnippet = '';
  let m;
  while ((m = caseArmRe.exec(codeBody)) !== null) {
    const armBody = m[1];
    const found = expected.filter(v => new RegExp(`(^|[\\s|(])${v}([\\s|)])`).test(armBody));
    if (found.length > present.length) {
      present = found;
      armSnippet = armBody.split('\n').find(l => found.some(v => l.includes(v))) || '';
    }
  }
  const missing = expected.filter(v => !present.includes(v));
  return {
    status: missing.length === 0 ? 'covered' : 'gap',
    expected,
    present,
    missing,
    source: `${HOOKS_DIR}/pre-bash-safety-check.sh`,
    armSnippet: armSnippet.trim(),
  };
}

export async function auditSafetyCoverage({ pluginRoot, hookFilter = null } = {}) {
  if (!pluginRoot) pluginRoot = resolvePluginRoot(import.meta.url);
  const hooksDir = path.join(pluginRoot, HOOKS_DIR);
  if (!fs.existsSync(hooksDir)) {
    throw new Error(`safety-coverage-audit: hooks dir not found: ${hooksDir}`);
  }

  const allHookFiles = fs.readdirSync(hooksDir)
    .filter(f => f.endsWith('.sh'))
    .sort();
  const auditedHookFiles = hookFilter
    ? allHookFiles.filter(f => f === hookFilter)
    : allHookFiles;

  // Phase A — arrow-claim sites + per-clause coverage.
  const claimSites = [];
  for (const f of auditedHookFiles) {
    const full = path.join(hooksDir, f);
    const src = fs.readFileSync(full, 'utf8');
    const codeBody = stripHeaderComments(src);
    const sites = findArrowClaimSites(src, `${HOOKS_DIR}/${f}`);
    for (const site of sites) {
      site.clauseCoverage = site.clauses.map(c => clauseCoverage(c, codeBody));
      site.gapClauses = site.clauseCoverage
        .filter(cc => cc.coverage === 'gap')
        .map(cc => cc.clause);
    }
    claimSites.push(...sites);
  }

  // Phase B — hard-rules.json cross-ref (always full set, ignores hookFilter).
  const manifestPath = path.join(pluginRoot, 'spec/hard-rules.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error(`safety-coverage-audit: failed to load ${manifestPath}: ${e.message}`);
  }

  const allHookSources = {};
  for (const f of allHookFiles) {
    allHookSources[f] = fs.readFileSync(path.join(hooksDir, f), 'utf8');
  }

  const ruleEnforcement = manifest.rules
    .filter(r => r.enforcement === 'hook' || r.enforcement === 'both')
    .map(r => {
      const section = r.rule_hits_section;
      const implementingHooks = section
        ? Object.entries(allHookSources)
            .filter(([_, src]) => src.includes(`'${section}'`))
            .map(([f]) => `${HOOKS_DIR}/${f}`)
        : [];
      return {
        id: r.id,
        name: r.name,
        rule_hits_section: section,
        scope: r.scope,
        enforcement: r.enforcement,
        implementingHooks,
        status: implementingHooks.length === 0 ? 'unimplemented' : 'implemented',
      };
    });

  // Phase C — spec-anchor checks (rm-rf whitelist; extensible).
  const specAnchorChecks = {
    rmRfWhitelist: checkRmRfWhitelist(hooksDir),
  };

  // Aggregations.
  const partialCandidates = claimSites.filter(s => s.gapClauses.length > 0);
  const unimplementedRules = ruleEnforcement
    .filter(r => r.status === 'unimplemented')
    .map(r => r.id);
  const anchorGaps = Object.entries(specAnchorChecks)
    .filter(([_, v]) => v.status === 'gap')
    .map(([k]) => k);

  return {
    spec_version: manifest.spec_version,
    claimSites,
    ruleEnforcement,
    specAnchorChecks,
    summary: {
      hooksAudited: auditedHookFiles.length,
      claimSiteCount: claimSites.length,
      partialCandidates: partialCandidates.length,
      partialCandidateRefs: partialCandidates.map(s => ({
        hook: s.hook,
        startLine: s.startLine,
        location: s.location,
        gapClauses: s.gapClauses,
      })),
      hookEnforcedRules: ruleEnforcement.length,
      unimplementedRules,
      anchorGaps,
    },
  };
}

function formatHuman(r) {
  const out = [];
  out.push(`Spec ${r.spec_version}`);
  out.push(`Hooks audited: ${r.summary.hooksAudited} | Arrow-claim sites: ${r.summary.claimSiteCount}`);
  out.push('');

  out.push('## Multi-clause claim sites');
  if (r.claimSites.length === 0) {
    out.push('  (none)');
  }
  for (const s of r.claimSites) {
    const range = s.startLine === s.endLine ? `${s.startLine}` : `${s.startLine}-${s.endLine}`;
    out.push(`  ${s.hook}:${range} (${s.location})`);
    const trimmed = s.text.length > 200 ? s.text.slice(0, 200) + '…' : s.text;
    out.push(`    Quote: ${trimmed}`);
    for (const cc of s.clauseCoverage) {
      const mark = cc.coverage === 'covered' ? '✓' : cc.coverage === 'gap' ? '✗' : '?';
      const hits = cc.keywordHits.length > 0
        ? ` [hits: ${cc.keywordHits.slice(0, 4).join(', ')}]`
        : ` [keywords: ${cc.keywords.slice(0, 4).join(', ') || '(none)'}]`;
      out.push(`      [${mark}] ${cc.clause}${hits}`);
    }
  }
  out.push('');

  out.push('## Spec hard-rules.json cross-reference (enforcement=hook|both)');
  for (const re of r.ruleEnforcement) {
    const mark = re.status === 'implemented' ? '✓' : '✗';
    const impl = re.implementingHooks.length > 0
      ? re.implementingHooks.join(', ')
      : '(no hook records under this section)';
    out.push(`  [${mark}] ${re.id} (${re.rule_hits_section || 'no rule_hits_section'}) → ${impl}`);
  }
  out.push('');

  out.push('## Spec anchor checks');
  const wl = r.specAnchorChecks.rmRfWhitelist;
  const wlMark = wl.status === 'covered' ? '✓' : wl.status === 'gap' ? '✗' : '?';
  out.push(`  [${wlMark}] §8 rm-rf $VAR whitelist (${wl.source})`);
  out.push(`      expected: ${wl.expected.join(', ')}`);
  out.push(`      present:  ${wl.present.join(', ') || '(none)'}`);
  if (wl.missing.length > 0) {
    out.push(`      MISSING:  ${wl.missing.join(', ')}`);
  }
  if (wl.armSnippet) {
    out.push(`      arm:      ${wl.armSnippet}`);
  }
  out.push('');

  out.push('## Summary');
  out.push(`  Partial-impl candidates: ${r.summary.partialCandidates}`);
  if (r.summary.partialCandidates > 0) {
    for (const ref of r.summary.partialCandidateRefs) {
      out.push(`    - ${ref.hook}:${ref.startLine} (${ref.location}) gap: [${ref.gapClauses.join(' | ')}]`);
    }
  }
  out.push(`  Unimplemented rules: ${r.summary.unimplementedRules.length}` +
    (r.summary.unimplementedRules.length ? ` — ${r.summary.unimplementedRules.join(', ')}` : ''));
  out.push(`  Anchor gaps: ${r.summary.anchorGaps.length}` +
    (r.summary.anchorGaps.length ? ` — ${r.summary.anchorGaps.join(', ')}` : ''));

  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), {
      bools: ['--json'],
      values: ['--hook'],
    });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const json = parsed.bools.has('--json');
  const hookFilter = parsed.values['--hook'] ?? null;
  const pluginRoot = resolvePluginRoot(import.meta.url);
  auditSafetyCoverage({ pluginRoot, hookFilter }).then(r => {
    console.log(json ? JSON.stringify(r, null, 2) : formatHuman(r));
  });
}
