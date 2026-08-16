// The identifier-strip (sanitize) stage exists in THREE engines: the blocking
// Path 2 in hooks/banned-vocab-check.sh, the advisory Stop scan in
// hooks/transcript-vocab-scan.sh, and scripts/lib/lint.js#stripIdentifiers.
// The 2026-08-16 audit (F1) found the bare `name.ext` strip clause present in
// two of them but missing from the ONLY blocking engine — an assistant turn
// mentioning `comprehensive-parser.js` would deny the next ship-flow command
// (the v0.23.19 field-report deny-loop class, resurrected on one engine).
//
// This gate parses the sed program out of each hook source (no hand-copied
// mirror — the mirror comment in transcript-vocab-scan.sh:84 was itself wrong
// while the engines diverged) and runs all three engines over shared probes.
// banned-vocab-engine-parity.test.js covers the PATTERN engines; this file
// covers the sanitize stage those patterns run after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripIdentifiers } from '../../scripts/lib/lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/** Extract the single-quoted sed -E program from a hook's sanitize pipeline. */
function sedProgramOf(hookRel) {
  const src = fs.readFileSync(path.join(REPO_ROOT, hookRel), 'utf8');
  const lines = src.split('\n').filter(l => /\|\s*sed -E '/.test(l));
  assert.equal(lines.length, 1,
    `${hookRel}: expected exactly one sanitize "sed -E" line, got ${lines.length}`);
  const m = lines[0].match(/sed -E '(.+)'\)?$/);
  assert.ok(m, `${hookRel}: could not extract sed program from: ${lines[0]}`);
  return m[1].replace(/'\)$/, '');
}

/** Run a hook's sanitize stage (fence-awk + extracted sed) over one probe. */
function hookSanitize(sedProgram, text) {
  return execFileSync('bash', ['-c',
    `printf '%s\\n' "$1" | awk '/^[[:space:]]*\`\`\`/{f=!f; next} !f' | sed -E "$2"`,
    'bash', text, sedProgram,
  ], { encoding: 'utf8' });
}

const ENGINES = () => ({
  'banned-vocab-check.sh': t => hookSanitize(sedProgramOf('hooks/banned-vocab-check.sh'), t),
  'transcript-vocab-scan.sh': t => hookSanitize(sedProgramOf('hooks/transcript-vocab-scan.sh'), t),
  'lint.js#stripIdentifiers': t => stripIdentifiers(t),
});

// Each probe: [input, survives] — survives=false means the high-fire word must
// NOT be matchable after sanitize; survives=true guards against over-strip
// (a bare-prose claim must stay detectable).
const PROBES = [
  ['refactor comprehensive-parser.js now', false],   // bare name.ext — the F1 gap
  ['see docs/comprehensive-audit.md for detail', false], // slashed path
  ['the `comprehensive` flag', false],               // inline backtick span
  ['renamed robust-check.ts in this pass', false],   // bare name.ext, second pattern word
  ['the coverage is comprehensive', true],           // bare-word claim — MUST survive
  ['results look robust overall', true],             // bare-word claim — MUST survive
  ['3.5x faster on the robust path', true],          // decimals/versions must NOT be eaten by the name.ext clause
];

const HIGH_FIRE = /\b(comprehensive|robust)\b/i;

test('sanitize stage: all three engines agree on every probe shape', () => {
  const engines = ENGINES();
  for (const [input, survives] of PROBES) {
    for (const [name, run] of Object.entries(engines)) {
      const out = run(input);
      assert.equal(HIGH_FIRE.test(out), survives,
        `${name}: probe ${JSON.stringify(input)} — expected high-fire word ` +
        `${survives ? 'to SURVIVE (over-strip)' : 'to be STRIPPED (divergence)'}; ` +
        `sanitized output: ${JSON.stringify(out)}`);
    }
  }
});
