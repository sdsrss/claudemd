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
//   - Banned-vocab patterns ↔ spec list drift (deferred to v0.13.0)
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
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/spec-coherence-audit.js [--json] [--strict] [--project=<cwd>]

Read-only audit of claudemd spec-ecosystem coherence:
  - §EXT cross-refs resolve (core → extended)
  - Sizing line matches actual wc -c (±20B tolerance)
  - MEMORY.md index ↔ memory files bidirectional

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
  const re = /§EXT[ \t]+§([0-9.]+(?:-[A-Za-z]+)?)/g;
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
// Returns a Set of <id> strings.
function extractExtendedSections(extendedText) {
  const sections = new Set();
  const lines = extendedText.split('\n');
  const re = /^#{2,}\s+§([0-9.]+(?:-[A-Za-z]+)?)/;  // full suffix, see extractExtRefs
  for (const line of lines) {
    const m = re.exec(line);
    if (m) sections.add(m[1]);
  }
  return sections;
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
  const sections = extractExtendedSections(extText);
  const unresolved = [...refs].filter(r => !sections.has(r)).sort();
  return {
    name: 'ext-cross-refs',
    ok: unresolved.length === 0,
    severity: unresolved.length > 0 ? 'CRITICAL' : null,
    findings: unresolved.map(id => ({
      severity: 'CRITICAL',
      detail: `core references §${id} but no matching ##+ §${id} heading in spec/CLAUDE-extended.md`,
    })),
    stats: {
      refsFound: refs.size,
      sectionsFound: sections.size,
      unresolvedCount: unresolved.length,
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

// CC encoding: every non-`[a-zA-Z0-9-]` char in the cwd path becomes `-`.
// Matches hooks/memory-read-check.sh:84 + hooks/memory-prompt-hint.sh:46.
function encodeProjectDir(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

function checkMemoryIndex(projectCwd) {
  const encoded = encodeProjectDir(projectCwd);
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
  const indexedFiles = new Set();
  const indexRefRe = /\(([^)]+\.md)\)/g;
  let m;
  while ((m = indexRefRe.exec(indexText)) !== null) {
    indexedFiles.add(m[1]);
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
      .filter(([k]) => !['note', 'memDir'].includes(k))
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
