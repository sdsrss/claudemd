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
//   3. Plugin semver agreement (v0.47.4): the plugin's own semver MUST be
//      identical in `package.json#version`, `.claude-plugin/plugin.json#version`,
//      `.claude-plugin/marketplace.json#metadata.version`, and
//      `.claude-plugin/marketplace.json#plugins[0].version`. Distinct from check
//      1, which is about the SPEC version (v6.X) — the plugin semver and the spec
//      semver are independent by policy (see CHANGELOG "Versioning policy").
//
// History (failure modes these guards exist for):
//   - v0.47.1 / v0.47.2 / v0.47.3 all shipped with `package.json` still at
//     0.47.0 while both `.claude-plugin/` manifests advanced. The ship runbook's
//     step-2 grep list is `spec/ tests/ scripts/ README.md .claude-plugin/` —
//     package.json is not in it, so three consecutive releases followed the
//     runbook faithfully and missed the same file. It matters because
//     `scripts/lib/paths.js#readPluginVersion` reads **package.json**, not
//     plugin.json: install.js stamps that value into
//     `~/.claude/.claudemd-manifest.json`, so /claudemd-status and /claudemd-doctor
//     reported 0.47.0 for a live 0.47.3 install, and the v0.36.0 stale-root guard
//     — which compares exactly this number — could not tell 0.47.0 from 0.47.3.
//     Memory rule was not the fix; this check is (mechanical > remembered).
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

// Token regex is derived per-run from the spec major (see specMajorTokenRe),
// NOT a fixed `/v6\./`. Scanning a fixed major means that after a `v7.0.0`
// bump the check goes silent — a stale `v7.5` in README/plugin.json never
// matches `/v6\./`, so the cascade-staleness it exists to catch (v0.17.6 /
// v0.19.0 incidents) slips through with ok:true. Deriving the major from
// spec_version keeps the check live across major bumps while still ignoring
// the plugin's own `v0.x` version tokens that share these files.
function specMajorTokenRe(specVersion) {
  const m = specVersion.match(/^v(\d+)\./);
  if (!m) throw new Error(`spec_version '${specVersion}' is not v<major>.<minor>[.patch]`);
  return new RegExp(`v${m[1]}\\.\\d+(?:\\.\\d+)?`, 'g');
}

function toMinor(token) {
  // "v6.13.0" → "v6.13" ; "v6.13" → "v6.13"
  const m = token.match(/^(v\d+\.\d+)/);
  return m ? m[1] : token;
}

// Check 3 — the plugin's own semver must agree across every manifest that
// carries it. `package.json` is listed FIRST deliberately: it is the one
// readPluginVersion() actually reads, and the one three consecutive releases
// forgot. Missing file or missing key => a site with value null, which cannot
// equal `expected`, so the check fails loudly rather than skipping.
export function runPluginSemverCheck({ root }) {
  const readJson = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
    catch { return null; }
  };
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  const market = readJson('.claude-plugin/marketplace.json');
  const sites = [
    { file: 'package.json', path: 'version', value: pkg?.version ?? null },
    { file: '.claude-plugin/plugin.json', path: 'version', value: plugin?.version ?? null },
    { file: '.claude-plugin/marketplace.json', path: 'metadata.version', value: market?.metadata?.version ?? null },
    { file: '.claude-plugin/marketplace.json', path: 'plugins[0].version', value: market?.plugins?.[0]?.version ?? null },
  ];
  // package.json is the reference: it is what install.js stamps into the manifest.
  const expected = sites[0].value;
  const ok = expected != null && sites.every(s => s.value === expected);
  return { ok, expected, sites };
}

export function runVersionCascadeCheck({ root }) {
  const manifestPath = path.join(root, 'spec/hard-rules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const specVersion = manifest.spec_version;
  if (typeof specVersion !== 'string') {
    throw new Error(`spec/hard-rules.json#spec_version missing or not a string (got: ${typeof specVersion})`);
  }
  const expectedMinor = toMinor(specVersion);
  const versionToken = specMajorTokenRe(specVersion);

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
      const matches = line.match(versionToken);
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

// v0.21.6 P6 — returns null when no claim found, else
//   { value, matched, suggestReplacement(actual) → string }
// so over-threshold drift reporting can emit copy-paste-ready OLD/NEW edits
// instead of just naming the bytes off. Saves the iterate-edit-iterate
// cycle observed across 4 in-session repros (see
// feedback_spec_sizing_recursive_rewrite.md).
function extractSizingClaim(line, prefix) {
  const esc = prefix.replace(/\./g, '\\.');
  // Arrowed form: "core 24417 → 24417 bytes" or "core 24417 -> 24417 bytes".
  const arrowedRe = new RegExp(`\\b${esc}\\s+(\\d+)\\s*(?:→|->)\\s*(\\d+)\\s*bytes`, 'i');
  const arrowed = arrowedRe.exec(line);
  if (arrowed) {
    return {
      value: Number(arrowed[2]),
      matched: arrowed[0],
      suggestReplacement: (actual) =>
        arrowed[0].replace(/(\s+(?:→|->)\s*)\d+(\s*bytes)/, `$1${actual}$2`),
    };
  }
  // Plain form: "core 24417 bytes" (no arrow / no diff).
  const plainRe = new RegExp(`\\b${esc}\\s+(\\d+)\\s*bytes`, 'i');
  const plain = plainRe.exec(line);
  if (plain) {
    return {
      value: Number(plain[1]),
      matched: plain[0],
      suggestReplacement: (actual) =>
        plain[0].replace(/\d+(\s*bytes)/, `${actual}$1`),
    };
  }
  return null;
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
    const claim = extractSizingClaim(sizingLine, t.name);
    if (claim == null) {
      drifts.push({
        name: t.name, file: t.file, claimed: null, actual: null, delta: null,
        threshold: t.threshold, reason: 'claim-parse-failed',
      });
      continue;
    }
    const claimed = claim.value;
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
        suggested: {
          old: claim.matched,
          new: claim.suggestReplacement(actual),
        },
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
    const semverResult = runPluginSemverCheck({ root });
    const overallOk = cascadeResult.ok && sizingResult.ok && semverResult.ok;

    if (argv.bools.has('--json')) {
      process.stdout.write(JSON.stringify({
        ok: overallOk,
        cascade: cascadeResult,
        sizing: sizingResult,
        pluginSemver: semverResult,
      }, null, 2) + '\n');
    } else if (overallOk) {
      process.stdout.write(
        `version-cascade-check: ok (${cascadeResult.expectedMinor} consistent across ${cascadeResult.filesChecked.length} file(s); ` +
        `Sizing drift within ±20B for ${SIZING_TARGETS.length} target(s); ` +
        `plugin semver ${semverResult.expected} consistent across ${semverResult.sites.length} site(s))\n`
      );
    } else {
      if (!semverResult.ok) {
        process.stderr.write(
          `version-cascade-check: plugin semver disagrees across manifests:\n`
        );
        for (const s of semverResult.sites) {
          process.stderr.write(`  ${s.value === semverResult.expected ? ' ' : '✗'} ${s.file}#${s.path} = ${s.value}\n`);
        }
        process.stderr.write(
          `\nAll four MUST match. package.json is the one the runbook's grep list historically missed, ` +
          `and it is the one that matters most: scripts/lib/paths.js#readPluginVersion reads package.json ` +
          `(NOT .claude-plugin/plugin.json), so a stale value there is what install.js stamps into ` +
          `~/.claude/.claudemd-manifest.json — making status/doctor report the wrong version and blinding ` +
          `the v0.36.0 stale-root guard, which compares exactly this number.\n`
        );
      }
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
              if (d.suggested) {
                process.stderr.write(`    Suggested edit in **Sizing** line:\n`);
                process.stderr.write(`      OLD: ${d.suggested.old}\n`);
                process.stderr.write(`      NEW: ${d.suggested.new}\n`);
              }
            }
          }
          process.stderr.write(
            `\nFix sizing: apply the "Suggested edit" OLD→NEW pairs above to the **Sizing** line in spec/CLAUDE-extended.md. ` +
            `A single corrective pass typically lands inside the ±20B envelope. ` +
            `Re-run \`node scripts/version-cascade-check.js\` to confirm exit 0.\n`
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
