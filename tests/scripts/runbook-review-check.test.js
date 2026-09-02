import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanRunbookReviewSteps } from '../../scripts/lib/runbook-review-check.js';

// Fixture shapes mirror the 2026-07-27 live corpus (7 real runbooks across 6
// projects) — including the FP worst-case class: a file NAMED *release* that is
// not a ship flow (mem's feedback_build_release.md, about cargo build --release)
// and a FIXED runbook that legitimately CONTAINS "self-review" prose. Detection
// direction is ABSENCE of a review step in real runbooks, never keyword-hit
// (tasks/deferred-2026-07-27-doctor-runbook-review-check.md).

function stage() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-rrc-'));
  const mk = (project, name, content) => {
    const dir = path.join(tmp, project, 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  };

  // tier 1: covers-stamp file, review step MISSING → flagged
  mk(
    '-p-alpha',
    'feedback_alpha_ship_atomic.md',
    '# alpha ship runbook\npre-ship checks → git tag → gh release create\n\ncovers: §EXT §12 @ v6.23.0\n'
  );
  // tier 2: filename says runbook, review step MISSING → flagged
  mk(
    '-p-bravo',
    'ship-runbook.md',
    '# bravo 发布 runbook\n① bump 版本 → ② git push origin main → ③ 打 tag → ④ npm publish\n'
  );
  // tier 2 + fingerprint present (incl. legitimate "self-review" prose) → NOT flagged
  mk(
    '-p-charlie',
    'project_ship_runbook.md',
    '# charlie runbook\nReview BEFORE tag (§EXT §12 Author ≠ reviewer, HARD): fresh-subagent review;\n' +
      'self-review 只是被点名的降级。\ngit tag → git push origin vX.Y.Z\n'
  );
  // name matches release but NOT a ship flow (0 flow tokens) → not a candidate
  mk(
    '-p-delta',
    'feedback_build_release.md',
    'Always use cargo build --release, never debug builds - debug is slow.\n'
  );
  // tier 3: name matches, ≥2 flow tokens, review MISSING → flagged
  mk(
    '-p-echo',
    'feedback_release_workflow.md',
    'push vX.Y.Z tag → publish.yml → npm publish → GitHub Release 自动建。\ngit tag vX.Y.Z && git push origin vX.Y.Z\n'
  );
  // project with no memory dir at all → skipped silently
  fs.mkdirSync(path.join(tmp, '-p-foxtrot'), { recursive: true });
  // flow-tier suppression: project already has a FINGERPRINTED runbook →
  // release-adjacent flow-tier lessons are not asked to repeat the step
  // (§11-EXT-MEM: ship tags belong to ONE file per project). name/stamp
  // tiers are never suppressed.
  mk(
    '-p-hotel',
    'project_ship_runbook.md',
    '# hotel runbook\nReview BEFORE tag (Author ≠ reviewer): fresh-subagent review.\ngit tag → push origin main\n'
  );
  mk(
    '-p-hotel',
    'feedback_release_ci_refs.md',
    'release.yml takes inputs.tag || github.ref; git tag re-push re-runs it.\nnpm publish rides the tag.\n'
  );

  return tmp;
}

test('flags runbooks lacking a review-before-tag step; skips non-runbooks and fingerprinted ones', () => {
  const tmp = stage();
  try {
    const out = scanRunbookReviewSteps({ rootDir: tmp });
    const flaggedFiles = out.missing.map(m => m.file).sort();
    assert.deepEqual(flaggedFiles, [
      'feedback_alpha_ship_atomic.md',
      'feedback_release_workflow.md',
      'ship-runbook.md',
    ]);
    // tier attribution: stamp beats filename beats content-tokens
    const byFile = Object.fromEntries(out.missing.map(m => [m.file, m.tier]));
    assert.equal(byFile['feedback_alpha_ship_atomic.md'], 'stamp');
    assert.equal(byFile['ship-runbook.md'], 'name');
    assert.equal(byFile['feedback_release_workflow.md'], 'flow');
    // charlie + hotel runbooks (fingerprinted) counted as scanned-and-ok;
    // hotel's flow-tier sibling is scanned but suppressed from missing
    assert.equal(out.scannedRunbooks, 6);
    // delta (cargo build --release) is not a runbook candidate at all
    assert.ok(!out.missing.some(m => m.file === 'feedback_build_release.md'));
    // hotel's release-adjacent lesson is NOT flagged (project runbook has the step)
    assert.ok(!out.missing.some(m => m.file === 'feedback_release_ci_refs.md'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing root dir degrades to empty result, not throw', () => {
  const out = scanRunbookReviewSteps({
    rootDir: path.join(os.tmpdir(), 'claudemd-rrc-absent-' + process.pid),
  });
  assert.deepEqual(out.missing, []);
  assert.equal(out.scannedRunbooks, 0);
});

test('中文 review fingerprint (tag 前……评审) is recognized', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-rrc-'));
  try {
    const dir = path.join(tmp, '-p-golf', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'ship-runbook.md'),
      '# golf 发版 runbook\n打 tag 前先做独立评审(fresh-subagent),再 git push origin main。\n'
    );
    const out = scanRunbookReviewSteps({ rootDir: tmp });
    assert.deepEqual(out.missing, []);
    assert.equal(out.scannedRunbooks, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
