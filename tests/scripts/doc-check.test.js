// doc-check.test.js — 12.1 项 1 (docs/spec-optimization-roadmap-2026-09-21.md §12).
//
// scripts/doc-check.mjs generalises a one-document scratchpad checker. The risk
// a generalisation carries is that a check keeps REPORTING while no longer
// DISCRIMINATING: an anchor set that resolves everything, a ratio regex that
// matches nothing, a stale scan whose exempt clause swallows the document. So
// every check below is driven twice over the same fixture — once clean, once
// with exactly one defect injected — and the assertion is on the DIFFERENCE.
// A check that cannot tell the two apart fails here, which is the property
// `feedback_mutate_the_rows_you_author` asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { docCheck, parseConfig, checkRatios, checkAnchors, checkGRefs } from '../../scripts/doc-check.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts/doc-check.mjs');

/** A minimal repo the checker can be pointed at: spec sources + one real path. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-doccheck-'));
  fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec/CLAUDE.md'), '# core\n\n## §7 VALIDATE\n\n### §2.1 ROUTE\n');
  fs.writeFileSync(path.join(root, 'spec/CLAUDE-extended.md'), '# ext\n\n## §12 PLUGINS\n');
  fs.writeFileSync(path.join(root, 'spec/hard-rules.json'), '{"rules":[{"id":"§iron-law-2"}]}\n');
  fs.writeFileSync(path.join(root, 'scripts/sampling-audit.js'), '// §10-V\n');
  fs.writeFileSync(path.join(root, 'scripts/real-file.js'), '// exists\n');
  return root;
}

function writeDoc(root, body) {
  const p = path.join(root, 'docs/doc.md');
  fs.writeFileSync(p, body);
  return p;
}

const CLEAN = `# Fixture

Refers to \`scripts/real-file.js\` and spec anchors §7, §2.1, §12, §iron-law-2, §10-V.

## 3 Numbers

74/126 = 58.7% of sessions; 9/17(**52.9%**) in the self stratum.

## 7 Roadmap

### G0 — measurement

G0 feeds G1.

### G1 — the gate

## 附 A Self-check

\`\`\`doc-check
stale-section-exempt: 附 A
stale-line-exempt: 撤回
stale: 核心零命中
ratio: 393/61 = 6.4x
\`\`\`
`;

const run = (root, body, opts = {}) => docCheck(writeDoc(root, body), { root, home: null, ...opts });

test('doc-check: a clean document reports every check and no problem', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN);
    assert.deepEqual(r.problems, [], `unexpected problems: ${r.problems.join(' | ')}`);
    // Each check must say what it judged: "clean" and "judged nothing" print
    // the same PASS otherwise (the instrument-reach rule this repo applies to
    // its hook gates).
    assert.match(r.lines.join('\n'), /paths: 1 checked of 1 referenced/);
    assert.match(r.lines.join('\n'), /anchors: 5 distinct §-refs/);
    assert.match(r.lines.join('\n'), /g-refs: G0 G1 · defined G0 G1/);
    assert.match(r.lines.join('\n'), /ratios: 3 recomputed \(1 from config\)/);
    assert.match(r.lines.join('\n'), /stale: 1 retracted claim\(s\) checked/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: a path that does not exist fails, and only that path', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('scripts/real-file.js', 'scripts/gone.js'));
    assert.deepEqual(r.problems, ['path missing: scripts/gone.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: an absent path that git does not track fails by default, passes under the flag', () => {
  const root = makeRepo();
  try {
    const body = CLEAN.replace('scripts/real-file.js', 'docs/local-only.md');
    assert.deepEqual(run(root, body).problems, ['path missing: docs/local-only.md']);
    const lax = run(root, body, { allowUntrackedMissing: true });
    assert.deepEqual(lax.problems, []);
    // Skipping silently would make the CI run a different, weaker gate that
    // says the same PASS. The skipped path is named in the output.
    assert.match(lax.lines.join('\n'), /1 absent\+untracked skipped \(docs\/local-only\.md\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: an unresolvable §-anchor fails', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('§2.1', '§2.9'));
    assert.deepEqual(r.problems, ['§2.9 not found in spec sources or the document headings']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// An analysis cites its own numbered sections (`见 §9.4`, `§3.6 的表`) as often
// as it cites the spec, and every such reference failed: all 8 anchor problems
// docs/spec-model-capability-review-2026-10-15.md reported on 2026-10-23 were
// its own headings. A heading resolves only the number it carries; a body line
// that starts with the same number defines nothing.
test('doc-check: a §-ref to one of the document own numbered headings resolves, and says so', () => {
  const doc = '## 3. 证据\n\n### 9.4 中期数\n\n见 §9.4 与 §3，规范见 §7。\n';
  const r = checkAnchors(doc, ['§7']);
  assert.deepEqual(r.problems, []);
  assert.equal(r.total, 3);
  assert.equal(r.internal, 2);
  // Same reference, heading gone: it fails again.
  assert.deepEqual(checkAnchors(doc.replace('### 9.4 中期数', '### 9.3 中期数'), ['§7']).problems, [
    '§9.4 not found in spec sources or the document headings',
  ]);
  // A number at the start of a body line is not a heading.
  assert.deepEqual(checkAnchors('9.4 中期数\n\n见 §9.4。\n', []).problems, [
    '§9.4 not found in spec sources or the document headings',
  ]);
  const root = makeRepo();
  try {
    const own = run(root, CLEAN.replace('## 7 Roadmap', '## 7 Roadmap\n\nSee §3 and §7.'));
    assert.deepEqual(own.problems, []);
    assert.match(
      own.lines.join('\n'),
      /anchors: 6 distinct §-refs resolved against 4 spec source\(s\); 1 by the document's own headings/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: anchors ignore trailing sentence punctuation', () => {
  // `见 §12.` is a reference to §12, not to a section called "12.".
  assert.deepEqual(checkAnchors('见 §12. 又见 §7-EXT-TMP,', ['§12 §7-EXT-TMP']).problems, []);
});

test('doc-check: a G-reference with no heading fails; a doc with no G headings skips', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('G0 feeds G1.', 'G0 feeds G4.'));
    assert.deepEqual(r.problems, ['G4 referenced but no "### G4" heading']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const skipped = checkGRefs('no G headings here, but G9 is mentioned');
  assert.equal(skipped.skipped, true);
  assert.deepEqual(skipped.problems, []);
});

test('doc-check: a mis-stated inline ratio fails and names both numbers', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('74/126 = 58.7%', '74/126 = 68.7%'));
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /74\/126 = 58\.7%, document says 68\.7%/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: a ratio is judged at the precision the document states, not more', () => {
  // 50/28,099 is 0.1779%. Written as "0.2%" it is correct; written as "0.18%"
  // it is correct; written as "0.1%" it is not. A gate that compared at a fixed
  // precision would reject the first, which is how a correctly-rounded number
  // becomes a false finding.
  assert.deepEqual(checkRatios('50/28,099(**0.2%**)', []).problems, []);
  assert.deepEqual(checkRatios('50/28,099 = 0.18%', []).problems, []);
  assert.equal(checkRatios('50/28,099 = 0.1%', []).problems.length, 1);
  // A ratio right after a comma is still read (0.113.3 pre-tag review L2: the
  // digit-run guard had excluded every A preceded by a comma), while a comma
  // inside a number still cannot start one.
  const listed = checkRatios('pass rates 3/4=75%,1/2=40%', []);
  assert.equal(listed.checked, 2);
  assert.equal(listed.problems.length, 1, listed.problems.join('; '));
  assert.equal(checkRatios('1,234/2,468 = 50%', []).checked, 1);
});

test('doc-check: a config ratio (stated in prose, not as A/B = P%) is recomputed', () => {
  assert.deepEqual(checkRatios('', ['393/61 = 6.4x']).problems, []);
  const bad = checkRatios('', ['393/61 = 7.4x']);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0], /393\/61 = 6\.4×, document says 7\.4×/);
  assert.match(checkRatios('', ['393 vs 61']).problems[0], /expected "A\/B = N%"/);
});

test('doc-check: a retracted claim fails when live, passes in an exempt section or a marked line', () => {
  const root = makeRepo();
  try {
    const live = CLEAN.replace('## 3 Numbers', '## 3 Numbers\n\n核心零命中,所以…');
    const r = run(root, live);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /retracted claim live at line \d+/);

    // Same sentence under an exempt heading: allowed.
    const exempt = CLEAN.replace('## 附 A Self-check', '## 附 A Self-check\n\n核心零命中(旧版说法)');
    assert.deepEqual(run(root, exempt).problems, []);

    // Same sentence, live section, marked as a quotation of the retracted text.
    const marked = CLEAN.replace('## 3 Numbers', '## 3 Numbers\n\n第一版说"核心零命中",已撤回。');
    assert.deepEqual(run(root, marked).problems, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: the stale check reports inactive rather than passing when the doc declares none', () => {
  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('stale: 核心零命中\n', ''));
    assert.deepEqual(r.problems, []);
    assert.match(r.lines.join('\n'), /stale: skipped \(no stale: entries/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doc-check: an unknown key or an uncompilable regex in the config block is a problem', () => {
  const { cfg, errors, present } = parseConfig('```doc-check\nnope: x\nstale: ok\nbare line\n```\n');
  assert.equal(present, true);
  assert.deepEqual(cfg.stale, ['ok']);
  assert.equal(errors.length, 2);
  assert.match(errors.join(' '), /unknown key "nope"/);
  assert.match(errors.join(' '), /no "key: value" separator/);

  const root = makeRepo();
  try {
    const r = run(root, CLEAN.replace('stale: 核心零命中', 'stale: (unclosed'));
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /stale: not a valid regex/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A CRLF document and an unclosed fence both read as "no block": the stale
// check went inactive and a live retracted claim passed.
test('doc-check: a CRLF document keeps its config block; an unclosed block is a problem', () => {
  const root = makeRepo();
  try {
    const live = CLEAN.replace('## 3 Numbers', '## 3 Numbers\n\n核心零命中,所以…');
    assert.match(run(root, live).problems.join(' '), /retracted claim live/, 'LF control');
    assert.match(run(root, live.replace(/\n/g, '\r\n')).problems.join(' '), /retracted claim live/, 'CRLF');
    const clean = run(root, CLEAN.replace(/\n/g, '\r\n'));
    assert.deepEqual(clean.problems, []);
    assert.match(clean.lines.join('\n'), /ratios: 3 recomputed \(1 from config\)/);
    const unclosed = CLEAN.slice(0, CLEAN.lastIndexOf('```'));
    assert.deepEqual(run(root, unclosed).problems, ['doc-check block opened at line 19 is never closed']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// trackedFiles answered an empty set whenever git failed, so with git off PATH
// every absent path read as untracked and the flag skipped a tracked one too.
test('doc-check: without git, an absent tracked path still fails under the flag', () => {
  const root = makeRepo();
  try {
    spawnSync('git', ['-C', root, 'init', '-q']);
    fs.writeFileSync(path.join(root, 'docs/tracked.md'), 'x\n');
    assert.equal(spawnSync('git', ['-C', root, 'add', 'docs/tracked.md']).status, 0);
    fs.rmSync(path.join(root, 'docs/tracked.md'));
    const body = CLEAN.replace('scripts/real-file.js', 'docs/tracked.md');
    const want = ['path missing: docs/tracked.md'];
    assert.deepEqual(run(root, body, { allowUntrackedMissing: true }).problems, want, 'with git');
    const saved = process.env.PATH;
    process.env.PATH = path.join(root, 'no-bin');
    try {
      assert.deepEqual(run(root, body, { allowUntrackedMissing: true }).problems, want, 'without git');
    } finally {
      process.env.PATH = saved;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The inline-ratio regex retried from every offset of a digit run and rescanned
// its tail each time: 2,775 ms on 80,000 digits, 4,732 ms after "1/" (node 26).
test('doc-check: the inline-ratio scan stays bounded on an 80,000-digit run', () => {
  for (const text of ['1'.repeat(80000), '1/' + '1'.repeat(80000), '1/2 ' + '1'.repeat(80000)]) {
    const t = process.hrtime.bigint();
    assert.equal(checkRatios(text, []).checked, 0);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 500, `${text.slice(0, 4)}…: ${ms.toFixed(0)} ms (budget 500)`);
  }
  // The shapes the check exists for still match.
  assert.equal(checkRatios('74/126 = 58.7% and 9/17(**52.9%**), 50/28,099 = 0.18%', []).checked, 3);
});

test('doc-check CLI: a directory argument is a one-line usage error, not a stack trace', () => {
  const r = spawnSync(process.execPath, [CLI, 'docs'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^[^\n]*docs[^\n]*\n$/);
});

test('doc-check CLI: --help exits 0, a bogus flag exits 2, a missing doc exits 2', () => {
  const r = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 20000 });
  const help = r('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:.*doc-check\.mjs/);

  assert.equal(r('--zzz=1', 'x.md').status, 2);
  assert.equal(r().status, 2);
  assert.match(r().stderr, /Missing argument/);
  assert.equal(r('docs/nope-not-here.md').status, 2);
});

test('doc-check CLI: the tracked roadmap passes its own self-check', () => {
  // The document this script was extracted from. Run with
  // --allow-untracked-missing because it cites tasks/sampling-audit-2026-09-07.md,
  // a local-only analysis file that is deliberately not in git — the four checks
  // that catch prose drift (anchors / G-refs / ratios / retracted claims) are
  // unaffected by the flag, and path existence is verified strictly on the
  // operator's machine where those files live.
  const doc = 'docs/spec-optimization-roadmap-2026-09-21.md';
  assert.ok(fs.existsSync(path.join(REPO_ROOT, doc)), `${doc} must be tracked for this gate to run`);
  const res = spawnSync(process.execPath, [CLI, doc, '--allow-untracked-missing'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});
