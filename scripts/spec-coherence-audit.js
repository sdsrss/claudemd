// v0.12.0 — Spec ↔ implementation coherence audit. Read-only.
//
// Borrowed from github/spec-kit's /analyze coherence-check pattern, scoped
// to claudemd's three highest-value drift surfaces:
//
//   1. §EXT cross-ref resolution. Every `§EXT §<id>` ref in spec/CLAUDE.md
//      must resolve to a `##+ §<id>` heading in spec/CLAUDE-extended.md.
//      Catches the "core cites §X-EXT but the section never landed" drift
//      family that today only surfaces by reader catching it manually.
//
//   2. Sizing line accuracy. The Sizing line in spec/CLAUDE-extended.md
//      claims byte counts via `wc -c`. Verify actual size matches the
//      claimed post-edit number within ±20B (per feedback_spec_sizing_
//      recursive_rewrite.md's accepted drift envelope).
//
//   3. MEMORY.md ↔ files bidirectional. Every `(file.md)` ref in the
//      project's MEMORY.md index must point to an existing file in the
//      memory dir, and every memory file on disk must appear in the index.
//      Catches dangling refs after deletes + orphan files after creates.
//
// Out of scope (covered elsewhere — see /claudemd-doctor + safety-coverage-audit):
//   - HARD-rule → hook enforcement coverage (safety-coverage-audit.js Phase B)
//   - hard-rules.json section_anchor resolution (hard-rules-drift.test.js)
//   - MEMORY.md tag-specificity (claudemd-doctor memory-tag-specificity)
//
// Severity (Spec Kit borrowed):
//   CRITICAL — drift that breaks the spec's own structural contract
//              (unresolved §EXT ref).
//   HIGH     — drift outside accepted tolerance with audit-discipline cost
//              (Sizing line off by >20B).
//   MEDIUM   — drift that bricks runtime behavior (MEMORY.md ref to
//              missing file).
//   LOW      — drift that adds noise but doesn't bind (orphan memory file).
//
// Exit codes: 0 always (read-only). --strict → 1 on CRITICAL/HIGH count > 0.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolvePluginRoot, encodeProjectCwd } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';
import { readPatterns, scan } from './lib/lint.js';

const USAGE = `Usage: node scripts/spec-coherence-audit.js [--json] [--strict] [--project=<cwd>]

Read-only audit of claudemd spec-ecosystem coherence:
  - §EXT cross-refs resolve (core → extended)
  - Sizing line matches actual wc -c (±20B tolerance)
  - MEMORY.md index ↔ memory files bidirectional
  - §10-V quick-check terms ↔ banned-vocab.patterns coverage

Output: human-readable by default; --json for machine-readable.

Options:
  --json             Emit JSON instead of human-readable.
  --strict           Exit non-zero (1) when CRITICAL or HIGH findings present.
                     Default: always exit 0 (advisory).
  --project=<cwd>    MEMORY.md scan target cwd (default: process.cwd()).
  --help, -h         Print this message and exit.

Exit codes: 0 success | 1 strict-mode CRITICAL/HIGH | 2 argv-shape error.`;

const SIZING_TOLERANCE_BYTES = 20;

// v0.23.8 — §0.1 HARD char caps, mechanized (CHECK 4). core ≤25K / extended
// ≤50K. The danger ratio (0.97) is the standing-advisory band: once a file
// crosses it, §0.1 says the next addition must pair with a net-delete.
const CORE_CAP_BYTES = 25000;
const EXT_CAP_BYTES = 50000;
const HEADROOM_DANGER_RATIO = 0.97;

// CHECK 1 — §EXT cross-ref resolution -----------------------------------------

// Extract §EXT refs from core. Pattern: `§EXT §<id>` where <id> is a section
// identifier (digits + dots, optionally suffixed with `-EXT`). Strip the
// trailing dot/punctuation that would be a sentence boundary.
//
// Excludes `§EXT §X-EXT` (the literal placeholder used in §0.1 prose to
// describe the pattern itself — not a real ref).
function extractExtRefs(coreText) {
  const refs = new Set();
  // Capture the FULL suffix (-EXT / -R / -V / -O / …), not just `-EXT`. Pre-fix
  // `§10-R` normalized to `10` (suffix dropped) on both ref and heading sides,
  // so a dangling `§10-R` ref matched an unrelated `§10-V` heading — defeating
  // CHECK 1 (the audit's flagship "core cites §X but section never landed") for
  // every suffix except -EXT.
  // Multi-suffix ids (`§11-EXT-MEM`, `§7-EXT-TMP`) are one id — `*` not `?`
  // (v6.20.1 made duplicate anchors unique via a second suffix segment).
  // Dot segments must carry an alnum tail (`4.FULL`, `2.S`, `5.1`) so a
  // sentence-terminating dot after `§EXT §12.` is never captured.
  const re = /§EXT[ \t]+§([0-9]+(?:\.[0-9A-Za-z]+)*(?:-[A-Za-z]+)*)/g;
  let m;
  while ((m = re.exec(coreText)) !== null) {
    let id = m[1];
    if (id === 'X-EXT') continue;
    // Strip a trailing dot if it's a sentence terminator (regex grabs it
    // when an id like §12 ends a sentence and "§EXT §12." precedes a space).
    id = id.replace(/\.+$/, '');
    refs.add(id);
  }
  return refs;
}

// Extract section anchors from extended. Pattern: `^##+ §<id>` at line start.
// Returns { sections: Set<id>, duplicates: [{id, count}] }. Duplicates matter
// because refs resolve into a Set: two `## §11-EXT …` headings both "resolve",
// but a reader following a bare `§EXT §11-EXT` pointer lands on whichever they
// read first — the exact ambiguity the 2026-07-24 audit flagged (P2-14). The
// v6.20.1 rename made today's set unique; this check keeps it that way.
function extractExtendedSections(extendedText) {
  const counts = new Map();
  const lines = extendedText.split('\n');
  // Same token shape as extractExtRefs. The dot-segment alnum tail matters
  // here too: the old `[0-9.]+` collapsed `### §4.FULL` and `### §4.FULL-lite`
  // both to id `4.` — a phantom duplicate the moment duplicates were counted.
  const re = /^#{2,}\s+§([0-9]+(?:\.[0-9A-Za-z]+)*(?:-[A-Za-z]+)*)/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return {
    sections: new Set(counts.keys()),
    duplicates: [...counts.entries()].filter(([, n]) => n > 1)
      .map(([id, count]) => ({ id, count })),
  };
}

function checkExtCrossRefs(specDir) {
  const corePath = path.join(specDir, 'CLAUDE.md');
  const extPath = path.join(specDir, 'CLAUDE-extended.md');
  if (!fs.existsSync(corePath) || !fs.existsSync(extPath)) {
    return {
      name: 'ext-cross-refs',
      ok: false,
      severity: 'CRITICAL',
      findings: [{ severity: 'CRITICAL', detail: `spec files missing (core=${fs.existsSync(corePath)}, extended=${fs.existsSync(extPath)})` }],
      stats: {},
    };
  }
  const coreText = fs.readFileSync(corePath, 'utf8');
  const extText = fs.readFileSync(extPath, 'utf8');
  const refs = extractExtRefs(coreText);
  const { sections, duplicates } = extractExtendedSections(extText);
  const unresolved = [...refs].filter(r => !sections.has(r)).sort();
  const findings = unresolved.map(id => ({
    severity: 'CRITICAL',
    detail: `core references §${id} but no matching ##+ §${id} heading in spec/CLAUDE-extended.md`,
  }));
  // Duplicate heading ids: resolution "succeeds" but the target is ambiguous.
  // HIGH (not CRITICAL): navigation trap, not a broken contract.
  for (const d of duplicates) {
    findings.push({
      severity: 'HIGH',
      detail: `spec/CLAUDE-extended.md has ${d.count} \`##+ §${d.id}\` headings — a §EXT §${d.id} pointer is ambiguous; give each a unique suffix (e.g. §${d.id}-TMP)`,
    });
  }
  return {
    name: 'ext-cross-refs',
    ok: findings.length === 0,
    severity: findings.some(f => f.severity === 'CRITICAL') ? 'CRITICAL'
      : (findings.length > 0 ? 'HIGH' : null),
    findings,
    stats: {
      refsFound: refs.size,
      sectionsFound: sections.size,
      unresolvedCount: unresolved.length,
      duplicateHeadingCount: duplicates.length,
    },
  };
}

// CHECK 2 — Sizing line accuracy ----------------------------------------------

// Parse the canonical Sizing line. Shape:
//   **Sizing** (...): core <N1> → <N2> bytes ...; extended <M1> → <M2> bytes ...
// We compare <N2> (current claim post-edit) against actual wc -c.
function parseSizingClaim(extendedText) {
  // Capture core after-arrow and extended after-arrow. Allow both `→` and
  // ASCII `->` to future-proof if the spec drift to ASCII arrows.
  const re = /\*\*Sizing\*\*[^:]*:\s*core\s+\d+\s*(?:→|->)\s*(\d+)\s*bytes[^;]*;\s*extended\s+\d+\s*(?:→|->)\s*(\d+)\s*bytes/i;
  const m = re.exec(extendedText);
  if (!m) return null;
  return { coreClaim: Number(m[1]), extendedClaim: Number(m[2]) };
}

function checkSizingAccuracy(specDir) {
  const corePath = path.join(specDir, 'CLAUDE.md');
  const extPath = path.join(specDir, 'CLAUDE-extended.md');
  const extText = fs.existsSync(extPath) ? fs.readFileSync(extPath, 'utf8') : '';
  const claim = parseSizingClaim(extText);
  if (!claim) {
    return {
      name: 'sizing-accuracy',
      ok: false,
      severity: 'HIGH',
      findings: [{ severity: 'HIGH', detail: 'Sizing line not found or unparseable in spec/CLAUDE-extended.md' }],
      stats: {},
    };
  }
  const coreActual = fs.existsSync(corePath) ? fs.statSync(corePath).size : 0;
  const extActual = fs.existsSync(extPath) ? fs.statSync(extPath).size : 0;
  const coreDelta = coreActual - claim.coreClaim;
  const extDelta = extActual - claim.extendedClaim;
  const findings = [];
  if (Math.abs(coreDelta) > SIZING_TOLERANCE_BYTES) {
    findings.push({
      severity: 'HIGH',
      detail: `core: claimed ${claim.coreClaim}, actual ${coreActual} (delta ${coreDelta >= 0 ? '+' : ''}${coreDelta}, beyond ±${SIZING_TOLERANCE_BYTES}B)`,
    });
  }
  if (Math.abs(extDelta) > SIZING_TOLERANCE_BYTES) {
    findings.push({
      severity: 'HIGH',
      detail: `extended: claimed ${claim.extendedClaim}, actual ${extActual} (delta ${extDelta >= 0 ? '+' : ''}${extDelta}, beyond ±${SIZING_TOLERANCE_BYTES}B)`,
    });
  }
  return {
    name: 'sizing-accuracy',
    ok: findings.length === 0,
    severity: findings.length > 0 ? 'HIGH' : null,
    findings,
    stats: {
      coreClaim: claim.coreClaim,
      coreActual,
      coreDelta,
      extendedClaim: claim.extendedClaim,
      extendedActual: extActual,
      extendedDelta: extDelta,
      toleranceBytes: SIZING_TOLERANCE_BYTES,
    },
  };
}

// CHECK 4 — Sizing headroom / HARD cap gate ----------------------------------
//
// v0.23.8 — mechanize §0.1's HARD char caps so CI catches a breach instead of
// relying on the human Sizing-line ritual (the 2026-06-03 maturity audit
// flagged that net-zero discipline was doc-only self-enforcement). Two bands:
//   actual > cap            → HIGH: §0.1 HARD cap breached; next version MUST
//                             net-delete or refuse the addition. --strict
//                             fails CI — this is the real enforcement edge.
//   cap·0.97 < actual ≤ cap → LOW: headroom critical; any addition this
//                             version must pair with a net-delete (§0.1).
//                             Advisory only — net-zero near the cap is the
//                             permanent posture (section-demote #4 rejected
//                             2026-06-03), so a hard fail in this band would
//                             wrongly block every release.
function checkSizingHeadroom(specDir) {
  const targets = [
    { label: 'core', file: 'CLAUDE.md', cap: CORE_CAP_BYTES },
    { label: 'extended', file: 'CLAUDE-extended.md', cap: EXT_CAP_BYTES },
  ];
  const findings = [];
  const stats = {};
  for (const t of targets) {
    const p = path.join(specDir, t.file);
    const actual = fs.existsSync(p) ? fs.statSync(p).size : 0;
    const pct = t.cap > 0 ? Math.round((actual / t.cap) * 1000) / 10 : 0;
    stats[`${t.label}Actual`] = actual;
    stats[`${t.label}Cap`] = t.cap;
    stats[`${t.label}Pct`] = pct;
    if (actual > t.cap) {
      findings.push({
        severity: 'HIGH',
        detail: `${t.label}: ${actual}B exceeds §0.1 HARD cap ${t.cap}B (${pct}%) — next version MUST net-delete or refuse the addition`,
      });
    } else if (actual > t.cap * HEADROOM_DANGER_RATIO) {
      findings.push({
        severity: 'LOW',
        detail: `${t.label}: ${actual}B at ${pct}% of ${t.cap}B cap (${t.cap - actual}B headroom) — any addition this version must pair with a net-delete (§0.1)`,
      });
    }
  }
  const hasHigh = findings.some(f => f.severity === 'HIGH');
  return {
    name: 'sizing-headroom',
    ok: findings.length === 0,
    severity: hasHigh ? 'HIGH' : (findings.length > 0 ? 'LOW' : null),
    findings,
    stats: { ...stats, dangerRatio: HEADROOM_DANGER_RATIO },
  };
}

// CHECK 3 — MEMORY.md ↔ files bidirectional ----------------------------------

function checkMemoryIndex(projectCwd) {
  const encoded = encodeProjectCwd(projectCwd);
  const memDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');
  const memIndex = path.join(memDir, 'MEMORY.md');

  if (!fs.existsSync(memIndex)) {
    return {
      name: 'memory-index',
      ok: true,
      severity: null,
      findings: [],
      stats: { memDir, status: 'no-index', note: 'MEMORY.md absent — skipped (project has no memory yet)' },
    };
  }

  const indexText = fs.readFileSync(memIndex, 'utf8');
  // One `.md` link per index line — the LAST match, matching memory-tags.js and
  // the memory-read-check hook. This was a second copy of the regex that added
  // EVERY match on the line, and memory-tags.js:121 documents exactly why that is
  // wrong: a title may itself embed a `(foo.md)` token, e.g.
  // `- [Some feature (see also legacy.md)](file.md) — desc`, which this counted
  // as two indexed files and then reported one of them dangling (2026-07-25).
  const indexedFiles = new Set();
  for (const line of indexText.split('\n')) {
    const matches = [...line.matchAll(/\(([^)]+\.md)\)/g)];
    if (matches.length === 0) continue;
    indexedFiles.add(matches[matches.length - 1][1]);
  }

  const onDisk = new Set(
    fs.readdirSync(memDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
  );

  const danglingRefs = [...indexedFiles].filter(f => !onDisk.has(f)).sort();
  const orphanFiles = [...onDisk].filter(f => !indexedFiles.has(f)).sort();

  const findings = [];
  for (const f of danglingRefs) {
    findings.push({
      severity: 'MEDIUM',
      detail: `MEMORY.md references ${f} but no such file exists in ${memDir}`,
    });
  }
  for (const f of orphanFiles) {
    findings.push({
      severity: 'LOW',
      detail: `memory file ${f} exists on disk but is not in MEMORY.md index`,
    });
  }

  return {
    name: 'memory-index',
    ok: findings.length === 0,
    severity: danglingRefs.length > 0 ? 'MEDIUM' : (orphanFiles.length > 0 ? 'LOW' : null),
    findings,
    stats: {
      memDir,
      indexedCount: indexedFiles.size,
      onDiskCount: onDisk.size,
      danglingCount: danglingRefs.length,
      orphanCount: orphanFiles.length,
    },
  };
}

// CHECK 5 — §10-V quick-check terms ↔ banned-vocab.patterns -------------------
//
// spec/CLAUDE.md §10 names a short quick-check list AND, in the same sentence,
// declares where the complete list lives: "Full enumeration → plugin
// `banned-vocab.patterns` (mechanical gate)". A term the spec names in its own
// quick-check that no pattern can match therefore breaks the spec's own words —
// the gate is narrower than the enumeration it is declared to be, and the
// narrowing is silent (nothing denies, so nothing shows up in rule-hits).
//
// Found live on v0.67.1: `应该可以` was named in the 中文 quick-check and matched
// by nothing in the patterns file, nor by any other gate in the repo. This
// check was listed at the top of this file as "deferred to v0.13.0" and had not
// landed 54 minor versions later — precisely the drift class that needs a gate
// rather than a reader.
//
// Deliberately scoped to §10's list only. §7 Iron Law #2 carries its own
// "Banned phrasings" list (`看上去 ok / 跑过了 / 能跑 / it runs / …`), but §7 does
// NOT declare banned-vocab.patterns as its enumeration and several of those
// terms are FP-hostile as literals (`能跑` matches 不能跑 / 能跑通 / 能跑多快;
// `it runs` matches "it runs on Node 20"). Reporting them as findings would be
// permanent noise against a contract that was never made, so they are counted
// in stats as coverage information and never raised.
// Terms §10 names that are DELIBERATELY not mechanized, with the reason. This
// is the same judgement §7's list gets, applied consistently: a literal whose
// legitimate uses are as common as its violating ones is a coin flip, and a
// coin-flip gate blocks real work. Entries are reported in the check's `note`
// so the decision stays visible instead of looking like coverage.
//
// Adding a term here silences a finding — the reason string is the control, and
// it must name a demonstrated false positive, not a hypothetical one.
const ACKNOWLEDGED_UNMECHANIZED = {
  '应该可以': 'literal denies legitimate negation ("越权用户不应该可以访问后台") and ' +
    'requirement prose ("主题应该可以自定义") as readily as the hedge sense — both measured ' +
    'on 2026-08-16. POSIX ERE has no lookbehind and a multibyte bracket negation is ' +
    'byte-wise under a C locale, so "not preceded by 不" is not portably expressible ' +
    'in the bash engine. Same standard that keeps §7\'s 能跑 / it runs unmechanized',
};

// Matched over the whole spec with `[\s\S]*?` rather than `[^\n]*`: the subject is a bullet that
// can be REFLOWED across lines by a compression pass (this repo does that
// routinely), and a `[^\n]*` capture silently narrowed from 8 terms to 5 when
// the 中文 span moved to line 2 — the gate quietly shrinking rather than
// failing. Capture runs to the end of the bullet (next bullet or blank line).
const QUICK_CHECK_RE = /\*\*Banned-vocab quick-check\*\*[\s\S]*?(?=\n[ \t]*\n|\n[-*] |\n#|$)/g;
const IRONLAW_PHRASINGS_RE = /\*\*Banned phrasings\*\*[\s\S]*?(?=\n[ \t]*\n|\n[-*] |\n#|$)/g;

// `N× faster (no baseline)` is a SHAPE, not a literal term — probing it verbatim
// would report drift forever. Substitute the placeholder and drop the
// parenthetical gloss; the probe string is reported alongside the term so the
// verdict stays auditable rather than magic.
function probeStringFor(term) {
  return term
    .replace(/\([^)]*\)/g, '')      // drop parenthetical glosses
    .replace(/\bN\b/g, '3')         // N× faster → 3× faster
    .replace(/\s+/g, ' ')
    .trim();
}

// The same line also backticks the pointer to the pattern FILE
// (`banned-vocab.patterns`), which is not a term. Discriminate on shape rather
// than on the ` / ` separator: a one-term list is still a term list, so
// requiring a separator silently dropped single-term spans.
const FILENAME_SPAN_RE = /^[A-Za-z0-9._-]+\.[a-z][a-z0-9]*$/;

function termsFromBacktickSpans(line) {
  const terms = [];
  for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
    if (FILENAME_SPAN_RE.test(span.trim())) continue;
    // Split on a spaced slash only — a term is allowed to contain a bare `/`.
    for (const part of span.split(/\s+\/\s+/)) {
      const t = part.trim();
      if (t) terms.push(t);
    }
  }
  return terms;
}

export function checkBannedVocabSpecDrift(pluginRoot) {
  const corePath = path.join(pluginRoot, 'spec', 'CLAUDE.md');
  const patternsPath = path.join(pluginRoot, 'hooks', 'banned-vocab.patterns');
  const base = { name: 'banned-vocab-spec-drift', findings: [] };

  const coreText = fs.existsSync(corePath) ? fs.readFileSync(corePath, 'utf8') : '';
  // ALL occurrences, not the first: a second quick-check bullet would otherwise
  // be invisible to the gate.
  const qcBlocks = coreText.match(QUICK_CHECK_RE) ?? [];
  if (qcBlocks.length === 0) {
    return {
      ...base, ok: true, severity: null,
      stats: { status: 'no-quick-check-line', termCount: 0, uncoveredCount: 0, probes: [] },
    };
  }

  const terms = [...new Set(qcBlocks.flatMap(termsFromBacktickSpans))];

  if (!fs.existsSync(patternsPath)) {
    return {
      ...base,
      ok: false,
      severity: 'HIGH',
      findings: [{
        severity: 'HIGH',
        detail: `§10 declares banned-vocab.patterns the full enumeration but ${patternsPath} does not exist — the mechanical gate is absent entirely`,
      }],
      stats: { status: 'patterns-missing', termCount: terms.length, uncoveredCount: terms.length, probes: [] },
    };
  }

  const patterns = readPatterns(patternsPath);
  const probes = [];
  const findings = [];
  const acknowledged = [];
  for (const term of terms) {
    const probe = probeStringFor(term);
    // scan() without sanitize: the question is "can the gate match this term",
    // not "would it survive identifier-stripping in prose".
    const covered = probe.length > 0 && scan(probe, { patterns }).length > 0;
    probes.push({ term, probe, covered });
    if (covered) continue;
    if (Object.prototype.hasOwnProperty.call(ACKNOWLEDGED_UNMECHANIZED, term)) {
      acknowledged.push(term);
      continue;
    }
    findings.push({
      severity: 'MEDIUM',
      detail: `§10 quick-check names "${term}" but no pattern in banned-vocab.patterns matches it ` +
        `(probed as "${probe}") — §10 declares that file the full enumeration, so the mechanical gate is narrower than the rule`,
    });
  }

  // §7's list: counted, never raised. See the note above.
  const ironLawTerms = [...new Set((coreText.match(IRONLAW_PHRASINGS_RE) ?? []).flatMap(termsFromBacktickSpans))];
  const ironLawUncovered = ironLawTerms.filter(t => {
    const p = probeStringFor(t);
    return !(p.length > 0 && scan(p, { patterns }).length > 0);
  });

  return {
    ...base,
    ok: findings.length === 0,
    severity: findings.length > 0 ? 'MEDIUM' : null,
    findings,
    stats: {
      termCount: terms.length,
      uncoveredCount: findings.length,
      acknowledgedCount: acknowledged.length,
      probes,
      ironLaw2TermCount: ironLawTerms.length,
      ironLaw2Unenforced: ironLawUncovered.length,
      note: [
        acknowledged.length > 0
          ? `§10 term(s) deliberately NOT mechanized: ${acknowledged.map(t => `${t} — ${ACKNOWLEDGED_UNMECHANIZED[t]}`).join('; ')}`
          : null,
        ironLawUncovered.length > 0
          ? `§7 Iron Law #2 names ${ironLawUncovered.length}/${ironLawTerms.length} phrasing(s) no pattern matches ` +
            `(${ironLawUncovered.join(', ')}) — informational: §7 does not declare banned-vocab.patterns as its enumeration`
          : null,
      ].filter(Boolean).join('\n    ') || undefined,
    },
  };
}

// Public API -----------------------------------------------------------------

export function auditSpecCoherence({ pluginRoot, projectCwd } = {}) {
  if (!pluginRoot) pluginRoot = resolvePluginRoot(import.meta.url);
  if (!projectCwd) projectCwd = process.cwd();
  const specDir = path.join(pluginRoot, 'spec');
  const checks = [
    checkExtCrossRefs(specDir),
    checkSizingAccuracy(specDir),
    checkSizingHeadroom(specDir),
    checkMemoryIndex(projectCwd),
    checkBannedVocabSpecDrift(pluginRoot),
  ];

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const c of checks) {
    for (const f of c.findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  }

  return {
    pluginRoot,
    projectCwd,
    specDir,
    checks,
    summary: {
      checksRun: checks.length,
      checksOk: checks.filter(c => c.ok).length,
      severityCounts: counts,
    },
  };
}

function formatHuman(r) {
  const out = [];
  out.push(`spec-coherence-audit (${r.specDir})`);
  out.push(`Project MEMORY.md scope: ${r.projectCwd}`);
  out.push('');
  for (const c of r.checks) {
    const mark = c.ok ? '✓' : (c.severity === 'CRITICAL' ? '✗' : c.severity === 'HIGH' ? '✗' : '△');
    out.push(`[${mark}] ${c.name}`);
    const statsLine = Object.entries(c.stats)
      // Skip prose/path keys AND any non-scalar: an array/object renders as
      // `[object Object],[object Object]` here, which is noise pretending to be
      // data. Structured detail belongs in --json (and in `note` for humans).
      .filter(([k, v]) => !['note', 'memDir'].includes(k) && (v === null || typeof v !== 'object'))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (statsLine) out.push(`    ${statsLine}`);
    if (c.stats.note) out.push(`    ${c.stats.note}`);
  }
  out.push('');
  out.push('## Findings');
  const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const c of r.checks) {
    for (const f of c.findings) {
      bySeverity[f.severity].push(`${c.name}: ${f.detail}`);
    }
  }
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
    const rows = bySeverity[sev];
    if (rows.length === 0) {
      out.push(`${sev}: (none)`);
    } else {
      out.push(`${sev}:`);
      for (const row of rows) out.push(`  - ${row}`);
    }
  }
  out.push('');
  out.push(`Summary: ${r.summary.checksOk}/${r.summary.checksRun} checks clean | ` +
    `severities: C=${r.summary.severityCounts.CRITICAL || 0} H=${r.summary.severityCounts.HIGH || 0} ` +
    `M=${r.summary.severityCounts.MEDIUM || 0} L=${r.summary.severityCounts.LOW || 0}`);
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), {
      bools: ['--json', '--strict'],
      values: ['--project'],
    });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const json = parsed.bools.has('--json');
  const strict = parsed.bools.has('--strict');
  const projectCwd = parsed.values['--project'] ?? process.cwd();
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const result = auditSpecCoherence({ pluginRoot, projectCwd });
  console.log(json ? JSON.stringify(result, null, 2) : formatHuman(result));
  if (strict) {
    const c = result.summary.severityCounts;
    if ((c.CRITICAL || 0) + (c.HIGH || 0) > 0) process.exit(1);
  }
}
