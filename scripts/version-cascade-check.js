// version-cascade-check — pre-tag sanity for spec ship pipeline. Two checks:
//
//   1. Minor-version cascade: every `v6.\d+(?:\.\d+)?` token in README.md +
//      `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` MUST
//      match (at minor granularity) `spec/hard-rules.json#spec_version`.
//
//   2. Spec sizing drift (v0.21.2): the **Sizing** line in
//      `spec/CLAUDE-extended.md` claims byte counts for core / extended /
//      OPERATOR.md; actual `fs.statSync` sizes MUST be within ±20B of those
//      claims. Drift envelope is the ±20B from `feedback_spec_sizing_
//      recursive_rewrite.md` (writing the Sizing line itself changes
//      extended.md's byte count, hence the floor isn't 0).
//
// History (failure modes these guards exist for):
//   - v0.17.6 minor-bump shipped with 3 cascade files still pointing at the
//     prior spec version. Captured as `feedback_spec_version_bump_cascade_grep.md`
//     — "grep OLD_VER across spec/hard-rules.json + tests/ before listing
//     modify-targets." Rule remembered, execution skipped.
//   - v0.19.0 minor-bump shipped with README.md (7 v6.11 mentions) and
//     marketplace.json description (2 v6.11 mentions) stale; a docs-only
//     catch-up commit (d044194) repaired them after the fact.
//   - v6.11.12 + v6.13.1 (multiple sessions): operator wrote the Sizing line,
//     post-edit `wc -c` showed claim diverged from actual by 100-400 bytes;
//     iterated to convergence by hand. `feedback_spec_sizing_recursive_rewrite.md`
//     flagged option 1 (accept ±20B) or option 2 (mechanical check). This
//     script is option 2.
//
// The feedback is the rule; this script is the mechanical enforcement.
//
// What it does NOT check:
//   - spec/CLAUDE*.md cascade tokens (the spec is its own source of truth —
//     version line inside the spec IS the canonical, not a derived copy).
//     The Sizing-drift branch DOES read spec/CLAUDE-extended.md, but only
//     the **Sizing** line and only against fs.statSync output.
//   - spec/CLAUDE-changelog.md (historical entries reference prior versions
//     intentionally and forever).
//   - tests/* (test fixtures may pin historical versions in upgrade-lifecycle
//     phase setup; tests/scripts/spec-structure.test.js already asserts the
//     current version explicitly).
//
// Exit codes: 0 ok | 1 cascade or sizing drift found | 2 argv-shape error.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/version-cascade-check.js [--json]

Pre-tag guard. Verifies two invariants:

  1. Spec minor version (v6.X) is consistent across README.md, plugin.json,
     and marketplace.json (vs. spec/hard-rules.json#spec_version).
  2. Spec **Sizing** line in spec/CLAUDE-extended.md matches actual byte
     counts of spec/CLAUDE.md, spec/CLAUDE-extended.md, spec/OPERATOR.md
     within ±20B (the recursive-rewrite drift envelope).

Options:
  --json       Emit JSON instead of human-readable.
  --help, -h   Print this message and exit.

Exit codes: 0 success | 1 cascade or sizing drift | 2 argv-shape error.`;

const SCANNED_FILES = [
  'README.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
];

const VERSION_TOKEN = /v6\.\d+(?:\.\d+)?/g;

function toMinor(token) {
  // "v6.13.0" → "v6.13" ; "v6.13" → "v6.13"
  const m = token.match(/^(v\d+\.\d+)/);
  return m ? m[1] : token;
}

export function runVersionCascadeCheck({ root }) {
  const manifestPath = path.join(root, 'spec/hard-rules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const specVersion = manifest.spec_version;
  if (typeof specVersion !== 'string') {
    throw new Error(`spec/hard-rules.json#spec_version missing or not a string (got: ${typeof specVersion})`);
  }
  const expectedMinor = toMinor(specVersion);

  const offenders = [];
  const filesChecked = [];

  for (const rel of SCANNED_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      offenders.push({ file: rel, line: 0, found: null, expected: expectedMinor, context: '<file missing>' });
      continue;
    }
    filesChecked.push(rel);
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.match(VERSION_TOKEN);
      if (!matches) continue;
      for (const token of matches) {
        const tokenMinor = toMinor(token);
        if (tokenMinor !== expectedMinor) {
          offenders.push({
            file: rel,
            line: i + 1,
            found: token,
            expected: expectedMinor,
            context: line.trim().slice(0, 140),
          });
        }
      }
    }
  }

  return {
    ok: offenders.length === 0,
    specVersion,
    expectedMinor,
    filesChecked,
    offenders,
  };
}

// v0.21.2 — spec **Sizing** line drift check. Parses the canonical Sizing
// line in spec/CLAUDE-extended.md and asserts actual fs.statSync sizes are
// within ±20B of the claimed counts. The ±20B envelope is from
// feedback_spec_sizing_recursive_rewrite.md (rewriting the Sizing line
// changes extended.md size, hence floor isn't 0).
//
// Expected line shape (canonical v6.13.1 form):
//   **Sizing** (...): core NNNNN → NNNNN bytes (Δ ...); extended NNNNN →
//   NNNNN bytes (...); OPERATOR.md NNNNN → NNNNN bytes (...). Size budget:
//   core NNNNN/25000 (...); extended NNNNN/50000 (...). ...
//
// We extract the post-arrow number (current/claimed byte count) for each of
// the three named targets. Also tolerates the plain "core NNNNN bytes" form
// (no arrow) in case operator opts out of the diff-arrow convention.
const SIZING_TARGETS = [
  { name: 'core',        file: 'spec/CLAUDE.md',          threshold: 20 },
  { name: 'extended',    file: 'spec/CLAUDE-extended.md', threshold: 20 },
  { name: 'OPERATOR.md', file: 'spec/OPERATOR.md',        threshold: 20 },
];

function extractSizingClaim(line, prefix) {
  const esc = prefix.replace(/\./g, '\\.');
  // Arrowed form: "core 24417 → 24417 bytes" or "core 24417 -> 24417 bytes".
  const arrowed = new RegExp(`\\b${esc}\\s+\\d+\\s*(?:→|->)\\s*(\\d+)\\s*bytes`, 'i').exec(line);
  if (arrowed) return Number(arrowed[1]);
  // Plain form: "core 24417 bytes" (no arrow / no diff).
  const plain = new RegExp(`\\b${esc}\\s+(\\d+)\\s*bytes`, 'i').exec(line);
  return plain ? Number(plain[1]) : null;
}

export function runSpecSizingCheck({ root }) {
  const extPath = path.join(root, 'spec/CLAUDE-extended.md');
  if (!fs.existsSync(extPath)) {
    return { ok: true, drifts: [], skipped: 'extended-missing' };
  }
  const content = fs.readFileSync(extPath, 'utf8');
  const lineMatch = content.match(/^\*\*Sizing\*\*.*$/m);
  if (!lineMatch) {
    return {
      ok: false,
      drifts: [],
      skipped: 'sizing-line-missing',
      detail: 'no `**Sizing**` line found in spec/CLAUDE-extended.md — was it removed?',
    };
  }
  const sizingLine = lineMatch[0];

  const drifts = [];
  for (const t of SIZING_TARGETS) {
    const claimed = extractSizingClaim(sizingLine, t.name);
    if (claimed == null) {
      drifts.push({
        name: t.name, file: t.file, claimed: null, actual: null, delta: null,
        threshold: t.threshold, reason: 'claim-parse-failed',
      });
      continue;
    }
    const abs = path.join(root, t.file);
    if (!fs.existsSync(abs)) {
      drifts.push({
        name: t.name, file: t.file, claimed, actual: null, delta: null,
        threshold: t.threshold, reason: 'file-missing',
      });
      continue;
    }
    const actual = fs.statSync(abs).size;
    const delta = actual - claimed;
    if (Math.abs(delta) > t.threshold) {
      drifts.push({
        name: t.name, file: t.file, claimed, actual, delta,
        threshold: t.threshold, reason: 'over-threshold',
      });
    }
  }
  return { ok: drifts.length === 0, drifts };
}

// CLI wrapper — only fires when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    printHelpAndExit(process.argv.slice(2), USAGE);
    const argv = parseStrict(process.argv.slice(2), { bools: ['--json'] });
    const root = resolvePluginRoot(import.meta.url);
    const cascadeResult = runVersionCascadeCheck({ root });
    const sizingResult = runSpecSizingCheck({ root });
    const overallOk = cascadeResult.ok && sizingResult.ok;

    if (argv.bools.has('--json')) {
      process.stdout.write(JSON.stringify({
        ok: overallOk,
        cascade: cascadeResult,
        sizing: sizingResult,
      }, null, 2) + '\n');
    } else if (overallOk) {
      process.stdout.write(
        `version-cascade-check: ok (${cascadeResult.expectedMinor} consistent across ${cascadeResult.filesChecked.length} file(s); ` +
        `Sizing drift within ±20B for ${SIZING_TARGETS.length} target(s))\n`
      );
    } else {
      if (!cascadeResult.ok) {
        process.stderr.write(
          `version-cascade-check: ${cascadeResult.offenders.length} stale mention(s) (expected ${cascadeResult.expectedMinor}):\n`
        );
        for (const o of cascadeResult.offenders) {
          process.stderr.write(`  ${o.file}:${o.line} — found ${o.found ?? '<missing>'} (expected ${o.expected})\n`);
          process.stderr.write(`    > ${o.context}\n`);
        }
        process.stderr.write(
          `\nFix cascade: update each line to use ${cascadeResult.expectedMinor}, or move historical refs into CLAUDE-changelog.md.\n`
        );
      }
      if (!sizingResult.ok) {
        if (sizingResult.skipped) {
          process.stderr.write(
            `\nspec-sizing-check: skipped (${sizingResult.skipped}${sizingResult.detail ? ` — ${sizingResult.detail}` : ''}).\n`
          );
        } else {
          process.stderr.write(
            `\nspec-sizing-check: ${sizingResult.drifts.length} drift(s) beyond ±20B envelope:\n`
          );
          for (const d of sizingResult.drifts) {
            if (d.reason === 'claim-parse-failed') {
              process.stderr.write(`  ${d.file}: Sizing-line claim for "${d.name}" not parseable (regex miss)\n`);
            } else if (d.reason === 'file-missing') {
              process.stderr.write(`  ${d.file}: claimed ${d.claimed}B, actual <file missing>\n`);
            } else {
              const sign = d.delta > 0 ? '+' : '';
              process.stderr.write(`  ${d.file}: claimed ${d.claimed}B, actual ${d.actual}B (Δ ${sign}${d.delta}B, exceeds ±${d.threshold}B)\n`);
            }
          }
          process.stderr.write(
            `\nFix sizing: update the **Sizing** line in spec/CLAUDE-extended.md so each "<name> N → M bytes" reflects actual fs sizes. ` +
            `Iterate until \`node scripts/version-cascade-check.js\` exits 0 (drift ≤ ±20B for each target).\n`
          );
        }
      }
    }
    process.exit(overallOk ? 0 : 1);
  } catch (e) {
    if (e instanceof ArgvError) {
      process.stderr.write(`version-cascade-check: ${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`version-cascade-check: ${e.message}\n`);
    process.exit(2);
  }
}
