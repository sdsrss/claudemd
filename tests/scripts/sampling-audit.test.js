import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { samplingAudit, samplingAuditGlobal, PRECISION_GATE, OVER_CEREMONY_THRESHOLD, loadVocabPatterns, scanVocab } from '../../scripts/sampling-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests/fixtures/sampling-audit');

// Build a tmp "projects dir" containing one fixture file with mtime forced
// to `now` so the days-window filter accepts it. Real ~/.claude/projects/<cwd>/
// stores transcripts as UUID.jsonl at the top level of the cwd-encoded dir.
function stageFixture(name, { mtimeDaysAgo = 0 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-'));
  const dest = path.join(tmp, `${name}.jsonl`);
  fs.copyFileSync(path.join(FIXTURE_DIR, `${name}.jsonl`), dest);
  if (mtimeDaysAgo > 0) {
    const past = new Date(Date.now() - mtimeDaysAgo * 86400000);
    fs.utimesSync(dest, past, past);
  }
  return tmp;
}

test('clean fixture: no rule hits', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.byRule['§10-V'].hits, 0);
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
    assert.equal(r.byRule['§10-honesty'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('vocab-hit fixture: §10-V fires on "significantly" + "robust" + "production-ready"', async () => {
  const dir = stageFixture('vocab-hit');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.ok(r.byRule['§10-V'].hits >= 1, `expected ≥1 §10-V hit, got ${r.byRule['§10-V'].hits}`);
    assert.equal(r.byRule['§10-V'].transcriptsAffected, 1);
    // Iron-law-2 / order should NOT fire — fixture has no four-section block.
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('iron-law-2-miss fixture: §iron-law-2 fires on Done without evidence', async () => {
  const dir = stageFixture('iron-law-2-miss');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§iron-law-2'].hits, 1);
    assert.equal(r.byRule['§iron-law-2'].transcriptsAffected, 1);
    // Order is correct (Done<Not done<Failed<Uncertain) → no order hit.
    assert.equal(r.byRule['§10-four-section-order'].hits, 0);
    // Uncertain line has "because" → no honesty hit.
    assert.equal(r.byRule['§10-honesty'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('order-violation fixture: §10-four-section-order fires', async () => {
  const dir = stageFixture('order-violation');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-four-section-order'].hits, 1);
    assert.equal(r.byRule['§10-four-section-order'].transcriptsAffected, 1);
    // Done has tests evidence → no iron-law-2 hit.
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('honesty-bare fixture: §10-honesty fires on bare Uncertain', async () => {
  const dir = stageFixture('honesty-bare');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-honesty'].hits, 1);
    assert.equal(r.byRule['§10-honesty'].transcriptsAffected, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('multi-turn fixture: detects per-turn hits across one transcript', async () => {
  const dir = stageFixture('multi-turn');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // 3 assistant turns: clean / vocab-hit / honesty-bare → 2 distinct rule hits.
    assert.ok(r.byRule['§10-V'].hits >= 1, 'expected vocab hit on turn 2');
    assert.equal(r.byRule['§10-honesty'].hits, 1, 'expected honesty hit on turn 3');
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.totalTurns, 3, 'expected 3 assistant text turns counted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('days window: mtime older than window is excluded', async () => {
  const dir = stageFixture('vocab-hit', { mtimeDaysAgo: 60 });
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 0, 'old transcript should be filtered out');
    assert.equal(r.byRule['§10-V'].hits, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate shape: byRule keys are all 4 rules with hits+transcriptsAffected', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    for (const key of ['§10-V', '§iron-law-2', '§10-four-section-order', '§10-honesty']) {
      assert.ok(r.byRule[key], `missing rule ${key}`);
      assert.equal(typeof r.byRule[key].hits, 'number');
      assert.equal(typeof r.byRule[key].transcriptsAffected, 'number');
    }
    assert.equal(typeof r.windowDays, 'number');
    assert.equal(typeof r.scannedTranscripts, 'number');
    assert.equal(typeof r.totalTurns, 'number');
    assert.ok(Array.isArray(r.perTranscript), 'perTranscript must be array');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// —— v0.28.0 A2/A3: denominators + 4 new sequence/claim detectors ——————————

test('A3 turn-yield fixture: §11-turn-yield counts typed-after-tool-turn opportunities, tells as violations, ignores sidechains', async () => {
  const dir = stageFixture('turn-yield');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // 2 main-line typed messages follow a turn containing ≥1 tool_use:
    // "继续" (tell → violation) and "looks good, thanks" (benign). The
    // sidechain tool_use + sidechain "继续" pair must NOT count (would be 3/2).
    assert.equal(r.byRule['§11-turn-yield'].opportunities, 2);
    assert.equal(r.byRule['§11-turn-yield'].violations, 1);
    assert.equal(r.byRule['§11-turn-yield'].transcriptsAffected, 1);
    // Done line cites "was: TypeError" → bugfix-anchor opportunity, no violation.
    assert.equal(r.byRule['§7-bugfix-anchor'].opportunities, 1);
    assert.equal(r.byRule['§7-bugfix-anchor'].violations, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A3 bugfix-anchor fixture: §7-bugfix-anchor fires on fix-claim without prior-failing token', async () => {
  const dir = stageFixture('bugfix-anchor');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Turn 1 "Done: fixed the parser bug … 5 passed." has no prior-failing
    // token → violation. Turn 2 cites crash/pre-fix/TypeError → compliant.
    assert.equal(r.byRule['§7-bugfix-anchor'].opportunities, 2);
    assert.equal(r.byRule['§7-bugfix-anchor'].violations, 1);
    assert.equal(r.byRule['§7-bugfix-anchor'].transcriptsAffected, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A3 post-compaction fixture: §11-post-compaction dedups boundary+summary pair, flags missing plan/spec re-read', async () => {
  const dir = stageFixture('post-compaction');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // 2 compaction events (each = compact_boundary + isCompactSummary user
    // line — the pair must count ONCE, not twice). Event 1 is followed by a
    // Read of docs/…plan….md → compliant; event 2 runs npm test only → violation.
    assert.equal(r.byRule['§11-post-compaction'].opportunities, 2);
    assert.equal(r.byRule['§11-post-compaction'].violations, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A3 hard-auth fixture: §5-hard-auth covered op passes, op outside lookback window fires', async () => {
  const dir = stageFixture('hard-auth');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Write to ~/.claude/settings.json 2 assistant events after "[AUTH REQUIRED"
    // → covered. `npm install left-pad` after 10 filler assistant texts →
    // AUTH marker outside the 10-event lookback → violation.
    assert.equal(r.byRule['§5-hard-auth'].opportunities, 2);
    assert.equal(r.byRule['§5-hard-auth'].violations, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2 denominators: existing detectors expose opportunities alongside hits', async () => {
  const dir = stageFixture('iron-law-2-miss');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // One four-section block → 1 Done line examined, 1 order check, 1
    // substantive Uncertain line; 1 assistant text turn = 1 §10-V opportunity.
    assert.equal(r.byRule['§iron-law-2'].opportunities, 1);
    assert.equal(r.byRule['§iron-law-2'].violations, 1);
    assert.equal(r.byRule['§10-four-section-order'].opportunities, 1);
    assert.equal(r.byRule['§10-four-section-order'].violations, 0);
    assert.equal(r.byRule['§10-honesty'].opportunities, 1);
    assert.equal(r.byRule['§10-honesty'].violations, 0);
    assert.equal(r.byRule['§10-V'].opportunities, r.totalTurns);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2 §10-V violations = turns with ≥1 match (rate stays ≤ 1), hits = raw matches', async () => {
  const dir = stageFixture('vocab-hit');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Single turn matching 3 patterns: hits ≥ 3 raw, violations = 1 turn.
    assert.ok(r.byRule['§10-V'].hits >= 3, `expected ≥3 raw matches, got ${r.byRule['§10-V'].hits}`);
    assert.equal(r.byRule['§10-V'].violations, 1);
    assert.equal(r.byRule['§10-V'].opportunities, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A4 calibration gate: all 8 rules present, precision null, status collecting, gate pre-registered at 0.8', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(PRECISION_GATE, 0.8, 'pre-registered threshold (plan A4) must not drift');
    const keys = Object.keys(r.byRule);
    assert.equal(keys.length, 8, `expected 8 detectors, got ${keys.length}: ${keys.join(', ')}`);
    for (const [k, v] of Object.entries(r.byRule)) {
      assert.equal(typeof v.opportunities, 'number', `${k} missing opportunities`);
      assert.equal(typeof v.violations, 'number', `${k} missing violations`);
      assert.equal(v.precision, null, `${k} precision must start null (uncalibrated)`);
      assert.equal(v.status, 'collecting', `${k} status must start 'collecting'`);
    }
    assert.match(r.metricContract, /violations\s*\/\s*opportunities/,
      'A2 metric contract must ride in the result');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('A2 stratification: samplingAuditGlobal splits byClass self vs external', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-root-'));
  try {
    // Dir names mirror CC cwd-encoding; classifyProject keys on the trailing
    // segment: '…-claudemd' → self, anything else → external.
    const selfDir = path.join(root, '-mnt-x-dev-claudemd');
    const extDir = path.join(root, '-home-u-dev-daagu');
    fs.mkdirSync(selfDir); fs.mkdirSync(extDir);
    fs.copyFileSync(path.join(FIXTURE_DIR, 'vocab-hit.jsonl'), path.join(selfDir, 'a.jsonl'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'clean.jsonl'), path.join(extDir, 'b.jsonl'));
    const r = await samplingAuditGlobal({ projectsRoot: root, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 2);
    assert.equal(r.byClass.self.scannedTranscripts, 1);
    assert.equal(r.byClass.external.scannedTranscripts, 1);
    assert.ok(r.byClass.self.byRule['§10-V'].violations >= 1, 'self class must carry the vocab hit');
    assert.equal(r.byClass.external.byRule['§10-V'].violations, 0);
    assert.equal(r.byClass.external.byRule['§10-V'].opportunities, 1);
    // C1 aggregates across dirs in global mode too (1 typed segment each).
    assert.equal(r.overCeremony.totalSegments, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// —— v0.29.0 C1: over-ceremony detector (plan P3) ——————————————————————————

test('C1 over-ceremony fixture: ceremony skill on L0/L1-shaped segment counts; large-task ceremony does not; 继续 does not split segments', async () => {
  const dir = stageFixture('over-ceremony');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    const oc = r.overCeremony;
    assert.ok(oc, 'overCeremony section must exist');
    // 3 typed task segments (the bare "继续" continuation stays in segment 3).
    assert.equal(oc.totalSegments, 3);
    // Segments 1+2 are L0/L1-shaped (1 file, tiny est. LOC); segment 3 writes
    // 3 files → excluded even though it invoked brainstorming.
    assert.equal(oc.l0l1Segments, 2);
    // Only segment 1 (TDD skill on a typo edit) is over-ceremony.
    assert.equal(oc.overCeremonySegments, 1);
    assert.deepEqual(oc.ceremonyInvocations, {
      'test-driven-development': 1,
      'brainstorming': 1,
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('C1 threshold pre-registered at 5% (plan C2) — constant must not drift', async () => {
  assert.equal(OVER_CEREMONY_THRESHOLD, 0.05);
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // clean fixture: 1 typed segment, no edits → 0 L0/L1-shaped opportunities.
    assert.equal(r.overCeremony.totalSegments, 1);
    assert.equal(r.overCeremony.l0l1Segments, 0);
    assert.equal(r.overCeremony.overCeremonySegments, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing projectsDir: returns zero result, no throw', async () => {
  const r = await samplingAudit({
    projectsDir: '/nonexistent/path/that/does/not/exist',
    days: 30,
    pluginRoot: REPO_ROOT,
  });
  assert.equal(r.scannedTranscripts, 0);
});

test('CLI: zero scanned transcripts → no tasks/ report file written (skip message instead)', () => {
  // Pre-fix, a 0-transcript run still wrote tasks/sampling-audit-<date>.md —
  // an all-zeros stub that reads like a completed audit and litters tasks/
  // (observed live during the 2026-07-11 QA loop: sandbox run wrote a stub
  // into the real repo's tasks/). Zero data → say so on stdout, write nothing.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  const fakeHome = path.join(tmp, 'home');
  const fakeCwd = path.join(tmp, 'cwd');
  fs.mkdirSync(path.join(fakeHome, '.claude', 'projects'), { recursive: true });
  fs.mkdirSync(fakeCwd, { recursive: true });
  try {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), '--days=30'], {
      cwd: fakeCwd,
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.match(r.stdout, /skipped writing|no transcripts/i);
    assert.equal(fs.existsSync(path.join(fakeCwd, 'tasks')), false,
      'tasks/ must not be created on a zero-transcript run');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// DRIFT-1 (2026-07-12 audit): sampling-audit's §10-V matcher must share lint.js's
// parser/scanner, not a divergent inline copy. The prior inline loader used
// indexOf('|') (truncates alternation regexes) and omitted posixClassesToJs.
test('DRIFT-1: loadVocabPatterns delegates to lint.js readPatterns (parity)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift1-'));
  const pf = path.join(tmp, 'hooks/banned-vocab.patterns');
  fs.mkdirSync(path.dirname(pf), { recursive: true });
  fs.writeFileSync(pf, [
    '# fixture patterns',
    '\\b(foo|bar)\\b|alternation reason',          // FIRST-bar indexOf would truncate to `\b(foo`
    'quick[[:space:]]+win|posix class reason',      // needs posixClassesToJs
    '\\bcheapish\\b|@ratio ratio-tagged reason',    // must be excluded by excludeRatio
  ].join('\n') + '\n');

  const pats = loadVocabPatterns(tmp);
  // Assert the CONCRETE parse output — proves the parser produced the right
  // structure, not merely that it equals a second call to itself. The prior
  // `assert.deepEqual(pats, readPatterns(pf))` was tautological: loadVocabPatterns
  // internally IS readPatterns(pf), so it compared readPatterns(pf) to itself and
  // could not have caught a parse regression (2026-07-13 TEST-4).
  const byReason = r => pats.find(p => p.reason.includes(r));
  assert.equal(pats.length, 3, 'the 3 non-comment fixture lines parse to 3 patterns');
  // alternation regex survived intact (the old indexOf('|') bug truncated to `\b(foo`)
  assert.equal(byReason('alternation').regex, '\\b(foo|bar)\\b');
  assert.equal(byReason('alternation').isRatio, false);
  // POSIX class preserved verbatim in the stored source form (translated at scan time)
  assert.equal(byReason('posix class').regex, 'quick[[:space:]]+win');
  // @ratio-tagged line kept with its isRatio flag (excluded at scan, not at load)
  assert.equal(byReason('ratio-tagged').regex, '\\bcheapish\\b');
  assert.equal(byReason('ratio-tagged').isRatio, true);
});

test('DRIFT-1: scanVocab matches alternation + POSIX class, excludes @ratio', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift1b-'));
  const pf = path.join(tmp, 'hooks/banned-vocab.patterns');
  fs.mkdirSync(path.dirname(pf), { recursive: true });
  fs.writeFileSync(pf, [
    '\\b(foo|bar)\\b|alternation reason',
    'quick[[:space:]]+win|posix class reason',
    '\\bcheapish\\b|@ratio ratio-tagged reason',
  ].join('\n') + '\n');
  const pats = loadVocabPatterns(tmp);

  // alternation: both arms match (old indexOf loader dropped this pattern entirely)
  assert.deepEqual(scanVocab('this bar is here', pats), ['bar']);
  // POSIX class translated → matches real whitespace (old loader mis-matched)
  assert.deepEqual(scanVocab('a quick   win today', pats), ['quick   win']);
  // @ratio excluded
  assert.deepEqual(scanVocab('this is cheapish', pats), []);
});
