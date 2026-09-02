// structure-scan-parity.test.js — three §10/§7 rules have TWO implementations,
// and until audit-2026-08-22 条目 9 nothing made them agree.
//
//   hooks/transcript-structure-scan.sh — live Stop-hook advisory (opt-in).
//   scripts/sampling-audit.js          — retrospective batch scan whose rates
//                                        feed §13.2 staleReviews calibration.
//
// They are near-identical by intent (same label forms, same 50-line window,
// same 14-line evidence window) and were maintained separately, which is the
// "one rule, two truths" shape this repo has hit before — §10-V avoided it by
// putting the patterns in one file both engines read, and the turn-boundary
// definition did not, and drifted three ways.
//
// What that cost here, measured by the first run of this file: the bash side
// accepts `due to / owing to / 由于 / 鉴于` as rationale connectors — added as a
// documented false-positive fix, because a 中文 report writing the equally
// canonical `由于 …` DOES state a reason — and the JS side still had only
// `because / since / 因为`. So four canonical forms counted as reasonless hedges
// in the measurement while the live hook stayed silent on them, and the wrong
// engine was the one producing the numbers.
//
// This is a DIFFERENTIAL test, not a mirrored-expectations one: it runs both
// engines over one corpus and requires identical verdicts. Mirrored expectations
// would have passed throughout the divergence, because each side's own suite
// asserted its own behaviour and both were internally consistent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanStructure, scanHonesty } from '../../scripts/sampling-audit.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(REPO_ROOT, 'hooks/transcript-structure-scan.sh');

// Each entry is a shape one engine could plausibly read differently from the
// other. The connector rows are the four that actually diverged.
const CORPUS = {
  'honesty: `due to` connector': 'Uncertain: skipped due to a missing fixture',
  'honesty: `owing to` connector': 'Uncertain: deferred owing to the sandbox limit',
  'honesty: 由于 connector': 'Uncertain: 跳过了，由于缺少 fixture',
  'honesty: 鉴于 connector': 'Uncertain: 跳过了，鉴于时间不够',
  'honesty: `because` connector': 'Uncertain: skipped because the fixture is missing',
  'honesty: bare hedge, no reason': 'Uncertain: maybe broken',
  'honesty: explicit none': 'Uncertain: (none)',
  'honesty: long line without connector': `Uncertain: ${'x'.repeat(90)}`,
  'four-section: in order':
    'Done: fixed it (12 tests passed)\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'four-section: out of order':
    'Uncertain: z because reasons\nDone: fixed it (12 tests passed)\nNot done: x\nFailed: y',
  'four-section: labels >50 lines apart': `Done: fixed it (12 tests passed)\n${'filler\n'.repeat(60)}Not done: x\nFailed: y\nUncertain: z because reasons`,
  'iron-law-2: Done with no evidence':
    'Done: refactored the parser\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'iron-law-2: Done with test count':
    'Done: refactored the parser (12 tests passed)\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'iron-law-2: Done with file:line':
    'Done: fixed scripts/audit.js:42\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'iron-law-2: Done: (none) placeholder':
    'Done: (none)\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'iron-law-2: markdown-header form':
    '## Done\nrefactored the parser\n## Not done\nx\n## Failed\ny\n## Uncertain\nz because reasons',
  'no report structure at all': 'Just some prose about the change, with no section labels.',
  // Firing shapes. A corpus where neither engine ever fires agrees perfectly
  // and proves nothing, so the reach floor below requires several of these.
  'honesty: 中文 bare hedge': 'Uncertain: 可能有问题',
  'four-section: Failed before Not done':
    'Done: fixed it (12 tests passed)\nFailed: y\nNot done: x\nUncertain: z because reasons',
  'iron-law-2: two evidence-less Done lines':
    'Done: refactored the parser\nDone: renamed the flag\nNot done: x\nFailed: y\nUncertain: z because reasons',
  'iron-law-2 + honesty in one report':
    'Done: refactored the parser\nNot done: x\nFailed: y\nUncertain: maybe',
};

/** Drive the real hook over `text` and count the rule labels it emits. */
function bashVerdict(text, sandbox) {
  const tx = path.join(sandbox, 'transcript.jsonl');
  fs.writeFileSync(
    tx,
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    }) + '\n'
  );
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ session_id: 'parity', transcript_path: tx }),
    encoding: 'utf8',
    timeout: 20000,
    // `...process.env` MINUS the claudemd knobs. README teaches users to export
    // DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK, and inheriting it makes this
    // parity gate report a bash verdict of "nothing" for every case — a false
    // red on a maintainer's own shell. The bash suites scrub these at entry
    // (tests/lib/env-hygiene.sh); the node-side spawns never followed
    // (2026-08-29 audit R10-19).
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !/^(DISABLE_|CLAUDEMD_|BASH_READONLY_FAST_PATH$|BANNED_VOCAB_)/.test(k)
        )
      ),
      HOME: sandbox,
      TRANSCRIPT_STRUCTURE_SCAN: '1',
      // Manual probes must not land in the real corpus
      // (feedback_manual_hook_probe_pollutes_telemetry).
      DISABLE_RULE_HITS_LOG: '1',
    },
  });
  assert.equal(
    r.status,
    0,
    `hook exited ${r.status} — it is advisory and must always exit 0. stderr: ${r.stderr}`
  );
  const err = r.stderr || '';
  return {
    order: /§10-four-section-order/.test(err) ? 1 : 0,
    ironLaw2: (err.match(/§iron-law-2/g) || []).length,
    honesty: (err.match(/§10-honesty/g) || []).length,
  };
}

function jsVerdict(text) {
  const st = scanStructure(text);
  const ho = scanHonesty(text);
  return { order: st.orderViolation, ironLaw2: st.ironLaw2, honesty: ho.hits };
}

test('the Stop hook and the sampling audit reach the same verdict on every shape', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-ssparity-'));
  try {
    fs.mkdirSync(path.join(sandbox, '.claude/logs'), { recursive: true });
    const rows = Object.entries(CORPUS);
    assert.ok(rows.length >= 15, `corpus resolved ${rows.length} case(s) — too thin to prove agreement`);
    const disagreements = [];
    const RULES = ['order', 'ironLaw2', 'honesty'];
    let reached = 0;
    const firedPerRule = Object.fromEntries(RULES.map(r => [r, 0]));
    for (const [name, text] of rows) {
      const bash = bashVerdict(text, sandbox);
      const js = jsVerdict(text);
      if (bash.order + bash.ironLaw2 + bash.honesty + js.order + js.ironLaw2 + js.honesty > 0) reached++;
      for (const rule of RULES) {
        if (bash[rule] > 0 || js[rule] > 0) firedPerRule[rule]++;
        if (bash[rule] !== js[rule]) {
          disagreements.push(`${name} — ${rule}: hook=${bash[rule]} sampling-audit=${js[rule]}`);
        }
      }
    }
    // A corpus on which NEITHER engine ever fires would agree perfectly and
    // prove nothing — the always-green harness this repo has been burned by.
    assert.ok(
      reached >= 5,
      `only ${reached} case(s) made either engine fire — this corpus cannot detect disagreement`
    );
    // Per-rule, not just in aggregate (2026-08-29 audit R10-19: the corpus is
    // hand-written, so nothing made it keep up with the engines). Eleven honesty
    // cases and zero four-section cases would clear a total-count floor while
    // proving parity for one rule out of three — and the two engines are
    // separately implemented per rule, so that is exactly where they can drift.
    const unexercised = RULES.filter(r => firedPerRule[r] === 0);
    assert.deepEqual(
      unexercised,
      [],
      `no corpus case makes either engine fire for: ${unexercised.join(', ')}.\n` +
        `      Parity is being claimed for a rule that never ran. Add a firing shape ` +
        `for it to CORPUS rather than lowering this floor.`
    );
    assert.deepEqual(
      disagreements,
      [],
      'the live hook and the retrospective scanner disagree — one rule, two truths:\n      ' +
        disagreements.join('\n      ') +
        '\n      Converge the two implementations; do not adjust one side to match the corpus.'
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
