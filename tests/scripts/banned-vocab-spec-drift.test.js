// banned-vocab-spec-drift.test.js — CHECK 5 of spec-coherence-audit.
//
// spec/CLAUDE.md §10 names a quick-check list of banned terms AND, in the same
// sentence, declares where the complete list lives:
//
//   **Banned-vocab quick-check** (top-5 EN): `…`. 中文 quick-check: `…`.
//   Full enumeration → plugin `banned-vocab.patterns` (mechanical gate)
//
// So a term the spec names in its own quick-check but the pattern file cannot
// match is a contract breach on the spec's own words: the mechanical gate is
// narrower than the enumeration it is declared to be. Measured 2026-08-16 on
// v0.67.1 — `应该可以` was named in the 中文 quick-check and matched by nothing
// in hooks/banned-vocab.patterns (nor by any other gate in the repo).
//
// spec-coherence-audit.js:24 had listed this exact check as "deferred to
// v0.13.0"; it had not landed by v0.67.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditSpecCoherence, checkBannedVocabSpecDrift } from '../../scripts/spec-coherence-audit.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const withSpec = (coreText, patternsText, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-vocabdrift-'));
  try {
    fs.mkdirSync(path.join(dir, 'spec'));
    fs.mkdirSync(path.join(dir, 'hooks'));
    fs.writeFileSync(path.join(dir, 'spec/CLAUDE.md'), coreText);
    fs.writeFileSync(path.join(dir, 'hooks/banned-vocab.patterns'), patternsText);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const QUICK_CHECK_LINE = (en, zh) =>
  `- **Banned-vocab quick-check** (top-5 EN): \`${en}\`. 中文 quick-check: \`${zh}\`. ` +
  'Full enumeration → plugin `banned-vocab.patterns` (mechanical gate).\n';

test('check reports a spec-named term that no pattern can match', () => {
  // NOT one of the acknowledged-unmechanized terms — those are waived by
  // design and are covered by their own test below.
  withSpec(
    QUICK_CHECK_LINE('robust', '显著提升 / 十分给力'),
    '显著提升|值述无具体数字\nrobust|评价性形容词\n',
    root => {
      const c = checkBannedVocabSpecDrift(root);
      assert.equal(c.ok, false);
      assert.equal(c.stats.uncoveredCount, 1);
      assert.ok(
        c.findings.some(f => f.detail.includes('十分给力')),
        `expected 十分给力 in findings, got ${JSON.stringify(c.findings)}`
      );
      assert.equal(c.findings[0].severity, 'MEDIUM');
    }
  );
});

test('an acknowledged-unmechanized term is waived instead of raised', () => {
  withSpec(
    QUICK_CHECK_LINE('robust', '显著提升 / 应该可以'),
    '显著提升|值述无具体数字\nrobust|评价性形容词\n',
    root => {
      const c = checkBannedVocabSpecDrift(root);
      assert.equal(c.ok, true, JSON.stringify(c.findings));
      assert.equal(c.stats.uncoveredCount, 0);
      assert.equal(c.stats.acknowledgedCount, 1);
      assert.match(c.stats.note, /应该可以/);
      assert.match(
        c.stats.note,
        /不应该可以访问后台/,
        'the waiver must cite a measured FP, not a hypothetical'
      );
    }
  );
});

test('check is clean when every spec-named term is matched by a pattern', () => {
  withSpec(QUICK_CHECK_LINE('robust', '显著提升'), '显著提升|值述无具体数字\nrobust|评价性形容词\n', root => {
    const c = checkBannedVocabSpecDrift(root);
    assert.equal(c.ok, true, JSON.stringify(c.findings));
    assert.equal(c.stats.uncoveredCount, 0);
    assert.equal(c.stats.termCount, 2);
  });
});

test('placeholder terms are probed with a substituted value, and the probe is reported', () => {
  // `N× faster (no baseline)` is a SHAPE, not a literal — probing it verbatim
  // would report a permanent false drift. Substitute the placeholder, drop the
  // parenthetical, and show the probe string so the result is auditable.
  withSpec(
    QUICK_CHECK_LINE('N× faster (no baseline)', '显著提升'),
    '[0-9]+(\\.[0-9]+)?[x×][[:space:]]*faster|@ratio 无 baseline\n显著提升|值述\n',
    root => {
      const c = checkBannedVocabSpecDrift(root);
      assert.equal(c.stats.uncoveredCount, 0, JSON.stringify(c.findings));
      const probed = c.stats.probes.find(p => p.term.includes('faster'));
      assert.ok(probed, 'placeholder term must appear in the probe list');
      assert.notEqual(probed.probe, probed.term, 'probe string must show the substitution');
      assert.ok(!probed.probe.includes('('), 'parenthetical note must be dropped from the probe');
    }
  );
});

test('a spec with no quick-check line is skipped, not failed', () => {
  withSpec('## §10 REPORT\n\nnothing to see here\n', 'robust|x\n', root => {
    const c = checkBannedVocabSpecDrift(root);
    assert.equal(c.ok, true);
    assert.equal(c.stats.status, 'no-quick-check-line');
  });
});

test('a missing patterns file is reported, not silently clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-vocabdrift-'));
  try {
    fs.mkdirSync(path.join(dir, 'spec'));
    fs.writeFileSync(path.join(dir, 'spec/CLAUDE.md'), QUICK_CHECK_LINE('robust', '显著提升'));
    const c = checkBannedVocabSpecDrift(dir);
    assert.equal(c.ok, false);
    assert.equal(c.stats.status, 'patterns-missing');
    assert.equal(c.findings[0].severity, 'HIGH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the check is wired into auditSpecCoherence and FAILS the suite on real drift', () => {
  // Pre-tag review: this test previously asserted only `termCount > 0`, and
  // `--strict` exits non-zero on CRITICAL/HIGH only while the check emits
  // MEDIUM — and the script is not invoked in CI at all. So the drift the
  // check was built to catch could be re-introduced with `npm test` still
  // green. `npm test` is the gate; this assertion is what makes it one.
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: REPO_ROOT });
  const c = r.checks.find(x => x.name === 'banned-vocab-spec-drift');
  assert.ok(c, `check not wired in; got ${r.checks.map(x => x.name).join(', ')}`);
  assert.ok(c.stats.termCount > 0, 'real spec must yield at least one quick-check term');
  assert.equal(
    c.stats.uncoveredCount,
    0,
    `spec §10 names a banned term the pattern file cannot match:\n${JSON.stringify(c.findings, null, 2)}`
  );
});

test('a spec-named term may be waived only via the acknowledged list, and stays visible', () => {
  // The waiver is not silence: an acknowledged term is excluded from findings
  // but named, with its reason, in the check's note.
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: REPO_ROOT });
  const c = r.checks.find(x => x.name === 'banned-vocab-spec-drift');
  if (c.stats.acknowledgedCount > 0) {
    assert.match(c.stats.note ?? '', /deliberately NOT mechanized/);
    // Every acknowledged term must carry a reason long enough to be a reason.
    for (const p of c.stats.probes.filter(x => !x.covered)) {
      assert.match(
        c.stats.note,
        new RegExp(p.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `uncovered term ${p.term} is neither a finding nor named in the note`
      );
    }
  }
});

test('the quick-check subject survives a reflow of the spec bullet', () => {
  // The subject is one markdown bullet, and this repo reflows/compresses the
  // spec routinely. A `[^\n]*` capture silently narrowed 8 terms → 5 when the
  // 中文 span moved to line 2 — the gate shrinking instead of failing.
  const reflowed =
    '- **Banned-vocab quick-check** (top-5 EN): `robust / comprehensive`.\n' +
    '  中文 quick-check: `显著提升 / 基本可用`. Full enumeration → plugin\n' +
    '  `banned-vocab.patterns` (mechanical gate).\n\n' +
    '- next bullet with an unrelated `span / of / words`\n';
  withSpec(reflowed, '显著提升|x\n基本可用|x\nrobust|x\ncomprehensive|x\n', root => {
    const c = checkBannedVocabSpecDrift(root);
    assert.equal(c.stats.termCount, 4, `terms lost to reflow: ${JSON.stringify(c.stats.probes)}`);
    assert.equal(c.stats.uncoveredCount, 0, JSON.stringify(c.findings));
  });
});
