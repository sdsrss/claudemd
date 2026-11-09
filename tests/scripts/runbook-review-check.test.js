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

// Shapes from the live corpus on 2026-11-03: doctor flagged 4 of 9 runbooks,
// and two of them (gsd-lite, claude-mem-lite) had a review step before the tag
// in words the fingerprint did not know. The controls are the other two: they
// name a reviewer in other words ("a pre-ship reviewer", "fresh context"), so
// they stay flagged. The patterns match anywhere in the file, lessons included.
test('a pre-tag review or fresh-subagent spawn step counts; a reviewer named in other words does not', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-rrc-'));
  try {
    const mk = (project, content) => {
      const dir = path.join(tmp, project, 'memory');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ship-runbook.md'), content);
    };
    mk(
      '-p-india',
      '# india runbook\nOne fresh-subagent pre-tag review (HARD) briefed on code diff.\ngit tag -a vX.Y.Z; git push origin vX.Y.Z\n'
    );
    mk(
      '-p-juliet',
      '# juliet runbook\n6. r1: two fresh blind subagents, defects and claims, spawned without names.\n8. git tag -a vX.Y.Z; push main\n'
    );
    mk(
      '-p-kilo',
      '# kilo runbook\nTwo review rounds is the norm: spawn the reviewers early (fresh context, `general-purpose`, never a fork).\ngit tag → gh release create\n'
    );
    mk(
      '-p-lima',
      '# lima runbook\n**A pre-ship reviewer earns its cost against the author.**\nSubagent dispatch synchrony is not stable.\ngit tag → push origin main\n'
    );
    const out = scanRunbookReviewSteps({ rootDir: tmp });
    assert.deepEqual(out.missing.map(m => m.project).sort(), ['-p-kilo', '-p-lima']);
    assert.equal(out.scannedRunbooks, 4);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 0.120.0 pre-tag review M4: `fresh` had no word boundary in front, so
// "/claudemd-refresh so subagents load it" read as a review step.
test('"refresh … subagents" is not a fresh-subagent review step; "fresh-subagent" alone is', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-rrc-'));
  try {
    const dir = path.join(tmp, '-p-mike', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'ship-runbook.md'),
      '# mike runbook\n4. /claudemd-refresh so subagents load it\n5. git tag -a vX.Y.Z; git push origin vX.Y.Z\n'
    );
    // 0.120.0 pre-tag review round 2 L6: the hyphenated form alone, with no
    // other fingerprint in the file, still counts.
    const dir2 = path.join(tmp, '-p-november', 'memory');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(
      path.join(dir2, 'ship-runbook.md'),
      '# november runbook\n4. One fresh-subagent spawn checks the diff.\n5. git tag -a vX.Y.Z; git push origin vX.Y.Z\n'
    );
    const out = scanRunbookReviewSteps({ rootDir: tmp });
    assert.deepEqual(
      out.missing.map(m => m.project),
      ['-p-mike']
    );
    assert.equal(out.scannedRunbooks, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
