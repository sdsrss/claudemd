import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  parseUntilMs,
  samplingAudit,
  samplingAuditGlobal,
  PRECISION_GATE,
  OVER_CEREMONY_THRESHOLD,
  ASK_ASSENT_THRESHOLD,
  ASK_DECISION_MIN_ANSWERS,
  ASK_RATE_PRECISION,
  formatMarkdown,
  askDispositionVerdict,
  h4ByClassLines,
  loadVocabPatterns,
  scanVocab,
  scanStructure,
  yieldTellSuppressed,
  scanBehavior,
  emptyBehavior,
  isTestFile,
  REWORK_THRESHOLD,
  behaviorLines,
} from '../../scripts/sampling-audit.js';
import { encodeProjectCwd } from '../../scripts/lib/paths.js';

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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('order-violation fixture: §10-four-section-order fires', async () => {
  const dir = stageFixture('order-violation');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-four-section-order'].hits, 1);
    assert.equal(r.byRule['§10-four-section-order'].transcriptsAffected, 1);
    // Done has tests evidence → no iron-law-2 hit.
    assert.equal(r.byRule['§iron-law-2'].hits, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('honesty-bare fixture: §10-honesty fires on bare Uncertain', async () => {
  const dir = stageFixture('honesty-bare');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§10-honesty'].hits, 1);
    assert.equal(r.byRule['§10-honesty'].transcriptsAffected, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-turn fixture: detects per-turn hits across one transcript', async () => {
  const dir = stageFixture('multi-turn');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // 3 assistant turns: clean / vocab-hit / honesty-bare → 2 distinct rule hits.
    assert.ok(r.byRule['§10-V'].hits >= 1, 'expected vocab hit on turn 2');
    assert.equal(r.byRule['§10-honesty'].hits, 1, 'expected honesty hit on turn 3');
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.totalAssistantTextRows, 3, 'expected 3 assistant text turns counted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('days window: mtime older than window is excluded', async () => {
  const dir = stageFixture('vocab-hit', { mtimeDaysAgo: 60 });
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 0, 'old transcript should be filtered out');
    assert.equal(r.byRule['§10-V'].hits, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    assert.equal(typeof r.totalAssistantTextRows, 'number');
    assert.ok(Array.isArray(r.perTranscript), 'perTranscript must be array');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    assert.equal(r.byRule['§10-V'].opportunities, r.totalAssistantTextRows);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A2 §10-V violations = turns with ≥1 match (rate stays ≤ 1), hits = raw matches', async () => {
  const dir = stageFixture('vocab-hit');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Single turn matching 3 patterns: hits ≥ 3 raw, violations = 1 turn.
    assert.ok(r.byRule['§10-V'].hits >= 3, `expected ≥3 raw matches, got ${r.byRule['§10-V'].hits}`);
    assert.equal(r.byRule['§10-V'].violations, 1);
    assert.equal(r.byRule['§10-V'].opportunities, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A4 calibration gate: all 8 rules present, precision null, status collecting-or-closed, gate pre-registered at 0.8', async () => {
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
      // 'closed' joined 'collecting' in the 2026-07-24 labeling pass: a
      // detector that was labeled, failed the 0.8 gate, and is not worth
      // repairing stops presenting itself as pending work. The invariant that
      // still binds is the one that matters — NO rate is ever presented.
      assert.ok(['collecting', 'closed'].includes(v.status), `${k} unexpected status ${v.status}`);
    }
    assert.match(
      r.metricContract,
      /violations\s*\/\s*opportunities/,
      'A2 metric contract must ride in the result'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A2 stratification: samplingAuditGlobal splits byClass self vs external', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-root-'));
  try {
    // Dir names mirror CC cwd-encoding; classifyProject keys on the trailing
    // segment: '…-claudemd' → self, anything else → external.
    const selfDir = path.join(root, '-mnt-x-dev-claudemd');
    const extDir = path.join(root, '-home-u-dev-daagu');
    fs.mkdirSync(selfDir);
    fs.mkdirSync(extDir);
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
      brainstorming: 1,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    assert.equal(
      fs.existsSync(path.join(fakeCwd, 'tasks')),
      false,
      'tasks/ must not be created on a zero-transcript run'
    );
    // The message is the operator's only signal that a bound emptied the
    // window, so it has to name the bound. Unpinned, deleting the
    // interpolation left the suite green (delta review, M6).
    const bounded = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), '--days=30', '--until=2020-06-01'],
      { cwd: fakeCwd, env: { ...process.env, HOME: fakeHome }, encoding: 'utf8', timeout: 15000 }
    );
    assert.equal(bounded.status, 0, `stderr=${bounded.stderr}`);
    assert.match(bounded.stdout, /--until/, 'the empty-window message names the bound that emptied it');
    assert.match(bounded.stdout, /2020-06-01/, 'and the instant it was set to');
    assert.doesNotMatch(r.stdout, /--until/, 'control: the unbounded run does not claim a bound');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// DRIFT-1 (2026-07-12 audit): sampling-audit's §10-V matcher must share lint.js's
// parser/scanner, not a divergent inline copy. The prior inline loader used
// indexOf('|') (truncates alternation regexes) and omitted posixClassesToJs.
test('DRIFT-1: loadVocabPatterns delegates to lint.js readPatterns (parity)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift1-'));
  try {
    const pf = path.join(tmp, 'hooks/banned-vocab.patterns');
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(
      pf,
      [
        '# fixture patterns',
        '\\b(foo|bar)\\b|alternation reason', // FIRST-bar indexOf would truncate to `\b(foo`
        'quick[[:space:]]+win|posix class reason', // needs posixClassesToJs
        '\\bcheapish\\b|@ratio ratio-tagged reason', // must be excluded by excludeRatio
      ].join('\n') + '\n'
    );

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
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('DRIFT-1: scanVocab matches alternation + POSIX class, excludes @ratio', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-drift1b-'));
  try {
    const pf = path.join(tmp, 'hooks/banned-vocab.patterns');
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(
      pf,
      [
        '\\b(foo|bar)\\b|alternation reason',
        'quick[[:space:]]+win|posix class reason',
        '\\bcheapish\\b|@ratio ratio-tagged reason',
      ].join('\n') + '\n'
    );
    const pats = loadVocabPatterns(tmp);

    // alternation: both arms match (old indexOf loader dropped this pattern entirely)
    assert.deepEqual(scanVocab('this bar is here', pats), ['bar']);
    // POSIX class translated → matches real whitespace (old loader mis-matched)
    assert.deepEqual(scanVocab('a quick   win today', pats), ['quick   win']);
    // @ratio excluded
    assert.deepEqual(scanVocab('this is cheapish', pats), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// DRIFT-2 (2026-07-24 labeling): the header claims the fixtures "pin both this
// script and the bash hooks to the same expected hit-counts on identical
// inputs" — but no test ever ran the bash hook, so the two silently diverged.
// hooks/transcript-vocab-scan.sh has sanitized identifier/path spans since
// v0.23.19 (its lines 92-94); scanVocab did not, so a bare path like
// `docs/comprehensive-audit-….md` fired `\bcomprehensive\b` node-side only.
// 7 of the 8 §10-V "violations" in the 30d sampling audit were this class.
// This is the missing join test: same transcript, both engines, same verdict.
function bashVocabHit(transcriptPath, homeDir) {
  const hook = path.join(REPO_ROOT, 'hooks/transcript-vocab-scan.sh');
  const r = spawnSync('bash', [hook], {
    input: JSON.stringify({ session_id: 'parity-test', tool_use_id: 'tu', transcript_path: transcriptPath }),
    encoding: 'utf8',
    // Explicit env, not a spread of process.env: operator shells carry
    // DISABLE_*/TRANSCRIPT_* knobs that would silently no-op the hook
    // (feedback_hook_env_test_hermeticity). DISABLE_RULE_HITS_LOG keeps the
    // probe out of live telemetry.
    env: { PATH: process.env.PATH, HOME: homeDir, TRANSCRIPT_VOCAB_SCAN: '1', DISABLE_RULE_HITS_LOG: '1' },
  });
  return /§10-V drift detected/.test(r.stderr || '');
}

test('parity: node scanVocab and the bash transcript-vocab hook agree (path-only text)', () => {
  const dir = stageFixture('vocab-path-only');
  try {
    const tp = path.join(dir, 'vocab-path-only.jsonl');
    const text = JSON.parse(fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean)[1])
      .message.content.map(c => c.text)
      .join(' ');
    const nodeHit = scanVocab(text, loadVocabPatterns(REPO_ROOT)).length > 0;
    const bashHit = bashVocabHit(tp, dir);
    assert.equal(nodeHit, bashHit, `parity broken: node=${nodeHit} bash=${bashHit} on path-only text`);
    // Both must be silent: the only banned word sits inside a file path, which
    // is an identifier mention, not a value claim about the agent's own work.
    assert.equal(nodeHit, false, 'a banned word inside a file path is not a §10-V value claim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parity: node scanVocab and the bash transcript-vocab hook agree (unterminated fence)', () => {
  // 2026-07-25 audit: node blanked an unterminated fence to EOF while the
  // bash hook (jq gsub newline-flattening makes its fence-awk inert) scanned
  // the claim after the ``` — node=miss/bash=hit, the one divergence in a
  // 12-shape differential. Terminator guard in stripIdentifiers restores
  // parity in the HIT direction; both engines must flag the trailing claim.
  const dir = stageFixture('vocab-fence-unterminated');
  try {
    const tp = path.join(dir, 'vocab-fence-unterminated.jsonl');
    const text = JSON.parse(fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean)[1])
      .message.content.map(c => c.text)
      .join(' ');
    const nodeHit = scanVocab(text, loadVocabPatterns(REPO_ROOT)).length > 0;
    const bashHit = bashVocabHit(tp, dir);
    assert.equal(nodeHit, bashHit, `parity broken: node=${nodeHit} bash=${bashHit} on unterminated fence`);
    assert.equal(nodeHit, true, 'claim after an unterminated fence is scannable text');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('yieldTellSuppressed: bare 么 inside 什么/这么 is not an ask (2 reproduced FPs)', () => {
  // Mid-work statements, no question — must NOT suppress-exempt:
  assert.equal(yieldTellSuppressed('我看了一下这个函数要处理什么边界情况，先记下来。'), false);
  assert.equal(yieldTellSuppressed('改动要这么写才能过 lint，我已经落盘了。'), false);
  // True asks keep firing (control arms):
  assert.equal(yieldTellSuppressed('要继续么'), true);
  assert.equal(yieldTellSuppressed('要继续吗？'), true);
});

test('parity: node scanVocab and the bash transcript-vocab hook agree (real claim)', () => {
  const dir = stageFixture('vocab-hit');
  try {
    const tp = path.join(dir, 'vocab-hit.jsonl');
    const text = JSON.parse(fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean)[1])
      .message.content.map(c => c.text)
      .join(' ');
    const nodeHit = scanVocab(text, loadVocabPatterns(REPO_ROOT)).length > 0;
    const bashHit = bashVocabHit(tp, dir);
    assert.equal(nodeHit, bashHit, `parity broken: node=${nodeHit} bash=${bashHit} on a real claim`);
    // Control arm: a bare-word value claim must still fire on BOTH sides —
    // without this, "sanitize everything" would pass the parity test too.
    assert.equal(nodeHit, true, 'a bare-word value claim must still be caught');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A4 labeling 2026-07-24: `继续` after a turn that ASKED is the user answering,
// not a "why did you stop" tell. 37/37 external-stratum flags were this class;
// twice the agent had literally written "说一声或 `继续`". Spec §11 now carries
// the precondition — these lock its mechanical form.
test('turn-yield precondition: an asking prior turn suppresses the tell', () => {
  assert.equal(yieldTellSuppressed('下一步建议 M5.2：fw-rules 静态分析器。要继续吗？'), true);
  assert.equal(yieldTellSuppressed('继续 M2（采集与白名单），还是先停在这里？'), true);
  assert.equal(yieldTellSuppressed('说一声(或 `继续`),我接着干。默认我会走 M12-a-2 → b4。'), true);
  assert.equal(yieldTellSuppressed('下一步在你:拍板 D0 四决策点,我即可接 M12-c 开工。'), true);
  assert.equal(yieldTellSuppressed('backlog 全为触发型,等你的信号或新需求。'), true);
});

test('turn-yield precondition: a closed four-section turn suppresses the tell', () => {
  assert.equal(
    yieldTellSuppressed('Done: x landed.\n\nNot done: 无。\n\nFailed: 无。\n\nUncertain: 无。'),
    true
  );
  assert.equal(yieldTellSuppressed('## Done\nx\n## Failed\n无'), true);
});

test('turn-yield precondition: an untermined/empty prior turn is not attributable', () => {
  assert.equal(yieldTellSuppressed(''), true);
  assert.equal(yieldTellSuppressed('   '), true);
  assert.equal(yieldTellSuppressed(undefined), true);
});

test('turn-yield precondition: a plain mid-work statement still counts as a tell', () => {
  // Control arm — without this, "suppress everything" would pass the tests above.
  assert.equal(
    yieldTellSuppressed('I found the null deref; the fix is to guard the empty-input branch.'),
    false
  );
  assert.equal(yieldTellSuppressed('读完了 parser，问题在空输入分支。'), false);
});

// Spec v6.26.0 gave §11 a fourth yield trigger: awaiting a spawned subagent. A
// turn that ends naming what it waits for is a LEGAL stop — the subagent's
// completion is what resumes it — but it neither asks nor closes four-section,
// so the tell fired on every one of them.
//
// The first fix read the PROSE for an await construction. The 0.78.0 delta
// review broke it with 13 probes, 12 of which suppressed: negations ("I did not
// wait for the reviewer", "我没有等子代理"), passing mentions ("Refactored the
// wait loop so agents no longer spin"), a wait on a HUMAN reviewer, and a
// 3 279-char turn whose only mention sat 3 236 chars from the end. Same root
// cause as the spec-gate defect in the same release: a regex cannot decide what
// prose means.
//
// So the suppression is STRUCTURAL now and lives in scanSequence, not here: a
// turn that issued an `Agent` tool_use spawned a subagent, and that is a fact in
// the transcript rather than a reading of it. `yieldTellSuppressed` is back to
// its three prose preconditions and deliberately does NOT suppress on any
// await-shaped sentence — these cases pin that, so a prose arm cannot be
// reintroduced without failing them.
test('turn-yield precondition: await-shaped prose alone never suppresses', () => {
  for (const probe of [
    'Yielding here: waiting on the reviewer subagent to deliver its findings.',
    '等 reviewer-spec 和 reviewer-claims 的报告，不 sleep 不催。',
    'Patched the parser. I did not wait for the reviewer to weigh in on the naming.',
    'You should never wait for an agent to self-report; poll the file instead.',
    'Waiting on the reviewer (a human) to open the PR — nothing for me to do.',
    'Refactored the wait loop so agents no longer spin. Stopping here.',
    '我没有等子代理，直接自己改完了。',
    '等一下，这个 reviewer 的意见我还没看完。',
  ]) {
    assert.equal(
      yieldTellSuppressed(probe),
      false,
      `prose suppression reintroduced — this probe should not suppress: ${probe}`
    );
  }
});

test('turn-yield: only a same-turn main-line Agent spawn suppresses the tell', async () => {
  const dir = stageFixture('turn-yield-subagent');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Four typed nudges, each after a tool-active turn. Only the first follows a
    // turn that spawned a subagent on the main line, and only that one is the
    // legal §11 yield. The other three are premature stops:
    //   2. an ordinary Edit turn;
    //   3. an Agent call that lives in a SIDECHAIN — the scanner drops
    //      sidechains, so it must not reach the main-line spawn flag (0.78.0
    //      round-3 review LOW-2: this arm had no fixture behind it);
    //   4. a spawn turn separated from the stop by a COMPACTION boundary. That
    //      record is `user-typed` with compactSummary set, so it took neither
    //      branch of the reset and the flag leaked forward (round-3 MEDIUM-1).
    assert.equal(r.byRule['§11-turn-yield'].opportunities, 4);
    assert.equal(
      r.byRule['§11-turn-yield'].violations,
      3,
      'only the same-turn main-line spawn may suppress — sidechain spawns and pre-compaction spawns must not'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turn-yield-asked fixture: opportunities counted, tells suppressed', async () => {
  const dir = stageFixture('turn-yield-asked');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§11-turn-yield'].opportunities, 2, 'both 继续 messages follow tool-active turns');
    assert.equal(
      r.byRule['§11-turn-yield'].violations,
      0,
      'one prior turn asked, the other closed four-section'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CALIBRATION closure: six detectors report closed with a reason, two stay collecting', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    const closed = Object.entries(r.byRule).filter(([, v]) => v.status === 'closed');
    assert.equal(closed.length, 6, `expected 6 closed detectors, got ${closed.map(([k]) => k).join(',')}`);
    for (const [k, v] of closed) {
      assert.ok(v.closedReason && v.closedReason.length > 10, `${k} closed without a reason`);
      assert.equal(v.precision, null, `${k} must not present a rate while closed`);
    }
    assert.equal(r.byRule['§10-V'].status, 'collecting');
    assert.equal(r.byRule['§11-turn-yield'].status, 'collecting');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A2 stratification: per-class rows carry closure status (the stratified view is the read path)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-cls-'));
  try {
    const proj = path.join(root, '-mnt-data-ssd-dev-projects-claudemd');
    fs.mkdirSync(proj);
    fs.copyFileSync(path.join(FIXTURE_DIR, 'clean.jsonl'), path.join(proj, 'c.jsonl'));
    const r = await samplingAuditGlobal({ projectsRoot: root, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(
      r.byClass.self.byRule['§5-hard-auth'].status,
      'closed',
      'a closed detector must read as closed in the stratified view too'
    );
    assert.ok(r.byClass.self.byRule['§5-hard-auth'].closedReason);
    assert.equal(r.byClass.self.byRule['§10-V'].status, 'collecting');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R10-20: an unreadable transcript is reported, not silently dropped', async () => {
  // Transcripts are the only unbounded input this tool has. A read failure used
  // to shrink the denominators with nothing to say so — "we sampled 2 of 2" and
  // "we sampled 2 of 3, one was unreadable" published the same number.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-unread-'));
  try {
    const good = path.join(dir, 'good.jsonl');
    fs.writeFileSync(
      good,
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
      }) + '\n'
    );
    // Unreadable by mode, not by absence: an absent file is a different case.
    const bad = path.join(dir, 'bad.jsonl');
    fs.writeFileSync(bad, '{}\n');
    fs.chmodSync(bad, 0o000);

    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    if (r.scannedTranscripts === 2) {
      // Running as root (or a filesystem ignoring mode bits) — the premise of
      // the case does not hold here, so say so rather than passing vacuously.
      assert.ok(
        process.getuid && process.getuid() === 0,
        'the unreadable file was read anyway — only expected as root'
      );
      return;
    }
    assert.ok(Array.isArray(r.unreadableTranscripts));
    assert.equal(r.unreadableTranscripts.length, 1);
    assert.equal(r.unreadableTranscripts[0].file, 'bad.jsonl');
    assert.ok(r.unreadableTranscripts[0].reason, 'the row must carry why');
    assert.equal(r.scannedTranscripts, 1, 'the readable one still counts');
  } finally {
    try {
      fs.chmodSync(path.join(dir, 'bad.jsonl'), 0o600);
    } catch {
      /* already gone */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R10-20: a clean run reports an empty unreadable list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-clean-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
      }) + '\n'
    );
    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    assert.deepEqual(r.unreadableTranscripts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// R11-24 (2026-09-03 audit): an unreadable transcript was reported; a
// transcript with unreadable LINES was not. Both shrink the §13.2 opportunity
// denominators, and the second one does it while still counting the file as
// fully sampled.
test('R11-24: unparseable lines are counted per transcript, not silently dropped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-bad-'));
  try {
    const row = t => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
    // 2 good rows, 3 corrupt: a half-corrupt file, which is the shape the
    // whole-file pre-flight elsewhere cannot see.
    fs.writeFileSync(
      path.join(dir, 'half.jsonl'),
      [
        row('Done: fixed it.'),
        '{not json',
        row('Done: fixed it again.'),
        'plain log line',
        '{"unterminated": ',
      ].join('\n') + '\n'
    );
    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    assert.equal(r.scannedTranscripts, 1, 'the file still counts as scanned — that is the trap');
    assert.equal(r.totalAssistantTextRows, 2, 'only the rows that parsed became turns');
    assert.ok(Array.isArray(r.malformedTranscripts));
    assert.equal(r.malformedTranscripts.length, 1);
    assert.equal(r.malformedTranscripts[0].file, 'half.jsonl');
    assert.equal(r.malformedTranscripts[0].lines, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R11-24: a clean run reports an empty malformed list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-nobad-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'a.jsonl'),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
      }) + '\n'
    );
    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    assert.deepEqual(r.malformedTranscripts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R11-24: --global labels malformed transcripts with their project dir', async () => {
  // At --global scope a bare basename is ambiguous across projects, and the
  // aggregate is the caliber whose rates get published.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-gbad-'));
  try {
    const proj = path.join(root, '-mnt-data-ssd-dev-projects-claudemd');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(
      path.join(proj, 's.jsonl'),
      [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
        }),
        '{oops',
      ].join('\n') + '\n'
    );
    const r = await samplingAuditGlobal({ projectsRoot: root, days: 3650, pluginRoot: REPO_ROOT });
    assert.equal(r.malformedTranscripts.length, 1);
    assert.equal(r.malformedTranscripts[0].file, '-mnt-data-ssd-dev-projects-claudemd/s.jsonl');
    assert.equal(r.malformedTranscripts[0].lines, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// R11-26 (2026-09-03 audit): --global and --sample= had zero occurrences in
// tests/. samplingAuditGlobal() was covered as a library call, but the CLI
// flag that selects it — and therefore the whole byClass section of the
// published report — could have regressed green.
test('R11-26 CLI: --global --json emits the byClass stratification', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-global-'));
  const fakeHome = path.join(tmp, 'home');
  const fakeCwd = path.join(tmp, 'cwd');
  const projects = path.join(fakeHome, '.claude', 'projects');
  const selfProj = path.join(projects, '-mnt-data-ssd-dev-projects-claudemd');
  const extProj = path.join(projects, '-home-someone-other-repo');
  fs.mkdirSync(selfProj, { recursive: true });
  fs.mkdirSync(extProj, { recursive: true });
  fs.mkdirSync(fakeCwd, { recursive: true });
  const row = t =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }) + '\n';
  fs.writeFileSync(path.join(selfProj, 'a.jsonl'), row('Done: fixed it (Checked: repro then test).'));
  fs.writeFileSync(path.join(extProj, 'b.jsonl'), row('Done: fixed it (Checked: repro then test).'));
  try {
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), '--global', '--json', '--days=3650'],
      { cwd: fakeCwd, env: { ...process.env, HOME: fakeHome }, encoding: 'utf8', timeout: 20000 }
    );
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(out.byClass, '--global must produce byClass; the non-global path does not');
    assert.equal(out.byClass.self.scannedTranscripts, 1);
    assert.equal(out.byClass.external.scannedTranscripts, 1);
    assert.equal(out.scannedTranscripts, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('R11-26: --sample=N caps the transcripts scanned per project dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sa-sample-'));
  try {
    const row =
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
      }) + '\n';
    for (const n of ['a', 'b', 'c', 'd', 'e']) fs.writeFileSync(path.join(dir, `${n}.jsonl`), row);
    const r = await samplingAudit({ projectsDir: dir, days: 3650, sample: 2 });
    assert.equal(r.scannedTranscripts, 2, 'sample=2 over 5 files must scan exactly 2');
    // sample larger than the population is a no-op, not a truncation.
    const all = await samplingAudit({ projectsDir: dir, days: 3650, sample: 99 });
    assert.equal(all.scannedTranscripts, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R11-26 CLI: --sample rejects a non-positive-integer with exit 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-sample-'));
  const fakeHome = path.join(tmp, 'home');
  fs.mkdirSync(path.join(fakeHome, '.claude', 'projects'), { recursive: true });
  try {
    for (const bad of ['--sample=0', '--sample=2.7', '--sample=abc']) {
      const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), bad], {
        cwd: tmp,
        env: { ...process.env, HOME: fakeHome },
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(r.status, 1, `${bad} must exit 1 (validation), got ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /--sample requires a positive integer/);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The counters reached the --json result only. The markdown file is the read
// path a human opens, and it printed the denominators with nothing beside them
// saying whether they were complete. The line prints in BOTH states on purpose:
// one that speaks up only on trouble cannot be told from one that stopped
// printing (memory: a gate must report its cardinality).
function runCliReport(transcriptLines) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-md-'));
  const fakeHome = path.join(tmp, 'home');
  const fakeCwd = path.join(tmp, 'cwd');
  fs.mkdirSync(fakeCwd, { recursive: true });
  const proj = path.join(fakeHome, '.claude', 'projects', encodeProjectCwd(fakeCwd));
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.jsonl'), transcriptLines.join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), '--days=3650'], {
    cwd: fakeCwd,
    env: { ...process.env, HOME: fakeHome },
    encoding: 'utf8',
    timeout: 20000,
  });
  // Local calendar day — must match sampling-audit.js#todayLocal (R11-33).
  // Computing it as UTC here made the assertion pass or fail by wall-clock hour
  // on any zone east of Greenwich.
  const today = new Date().toLocaleDateString('en-CA');
  const reportPath = path.join(fakeCwd, 'tasks', `sampling-audit-${today}.md`);
  const md = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null;
  fs.rmSync(tmp, { recursive: true, force: true });
  return { r, md };
}

test('R11-24: the markdown report states reader integrity in both states', () => {
  const good = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Done: fixed it.' }] },
  });

  const clean = runCliReport([good]);
  assert.equal(clean.r.status, 0, `stderr=${clean.r.stderr}`);
  assert.ok(clean.md, 'the CLI must have written the report');
  assert.match(
    clean.md,
    /Reader integrity: every transcript read in full \(0 unreadable, 0 malformed lines\)/
  );

  const dirty = runCliReport([good, '{corrupt', 'not json at all']);
  assert.equal(dirty.r.status, 0, `stderr=${dirty.r.stderr}`);
  assert.ok(dirty.md, 'the CLI must have written the report');
  assert.match(dirty.md, /the denominators below are short/);
  assert.match(dirty.md, /2 unparseable line\(s\) across 1 transcript\(s\).*a\.jsonl.*×2/);
  assert.doesNotMatch(dirty.md, /every transcript read in full/);
  // …and stdout says so too, so an operator who never opens the file still sees it.
  assert.match(dirty.r.stdout, /Reader integrity:.*denominators below are short/);
});

// --- H4 default-ASK measure (audit 20260906-231957 §7.2) -------------------
//
// The fixture is three tasks: one ask answered with assent ("就按你说的"), one
// ask answered with direction, one task that never asks. The numbers below are
// the whole contract — an assent classifier that drifts either way changes a
// pre-registered disposition, so they are asserted exactly rather than as
// bounds.
test('H4 ask-rate fixture: asks counted, assent separated from direction', async () => {
  const dir = stageFixture('ask-rate');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.deepEqual(r.askRate, { segments: 3, asks: 2, assent: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("H4 ask-rate: answering an ask continues the task, so its denominator is not C1's", async () => {
  const dir = stageFixture('ask-rate');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    // Same transcript, two segmentations on purpose: C1 starts a task at every
    // typed message, the ask measure folds an answer back into the task that
    // provoked it (§1.5 continuation). If these ever coincide, one of the two
    // definitions was quietly changed.
    assert.equal(r.overCeremony.totalSegments, 5);
    assert.equal(r.askRate.segments, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('H4 ask-rate: a task with no ask contributes a segment and no ask', async () => {
  const dir = stageFixture('clean');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.ok(r.askRate.segments >= 1, `expected ≥1 segment, got ${r.askRate.segments}`);
    assert.equal(r.askRate.asks, 0);
    assert.equal(r.askRate.assent, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('H4 disposition thresholds are pre-registered constants, not computed', () => {
  // Fixed 2026-09-07 before any data existed. A later edit that moves either
  // number to fit a measurement is the failure mode the audit warned about;
  // this test makes moving one a visible diff rather than a silent retune.
  assert.equal(ASK_ASSENT_THRESHOLD, 0.5);
  assert.equal(ASK_DECISION_MIN_ANSWERS, 30);
  assert.equal(OVER_CEREMONY_THRESHOLD, 0.05);
});

// --- v0.80.0 pre-tag review repairs ---------------------------------------

test("LOW-3: a compaction boundary ends the question's reach, and does not merge two tasks", async () => {
  // Before the fix this fixture returned {segments:1, asks:1}: the pre-compaction
  // question was scored as answered by a brand-new unrelated task, and because an
  // ask-answer suppresses the segment boundary, the two tasks merged into one.
  const dir = stageFixture('ask-rate-compaction');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.deepEqual(r.askRate, { segments: 2, asks: 0, assent: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('LOW-5: a slash command is a task, but never the answer to a question', async () => {
  // Before the fix: {segments:1, asks:1} — `/claudemd-status` typed after an ask
  // scored as answered-with-direction. isUserTurn drops <system-reminder> and
  // isMeta rows but not <command-name>.
  //
  // segments is 2, not 1: the fix must stop the slash row being an ANSWER
  // without also stopping it being a TASK. The first version skipped the row
  // outright and pinned 1 here, which locked in a −19-segment shift on this
  // repo's corpus under a test name that mentioned only the answer half
  // (verification M-3). Both halves are asserted now.
  const dir = stageFixture('ask-rate-slash');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.deepEqual(r.askRate, { segments: 2, asks: 0, assent: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HIGH-1: a transcript with no question in it still scores asks at 100% assent', async () => {
  // This fixture is the finding, kept executable. Eight tasks, not one question
  // mark, agent signs off with "有问题说一声", user replies "好". YIELD_ASK_RE's
  // non-`?` alternatives are unanchored inside the 260-char tail, so the sign-off
  // fires the ask predicate and the bare word satisfies the assent one.
  //
  // The test asserts the DEFECT, not a fix: the predicate is the turn-yield
  // precondition reused, and narrowing it is a calibration job, not a patch. What
  // must hold is that this cannot reach the disposition — see the next test.
  const dir = stageFixture('ask-rate-noise');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.deepEqual(r.askRate, { segments: 8, asks: 8, assent: 8 });
    assert.equal(r.askRate.assent / r.askRate.asks, 1, 'assent rate is 100% on zero questions');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HIGH-1: the report never declares the disposition readable while precision is null', async () => {
  // The pre-registered rule says "with ≥30 answered asks, assent ≥50% → flip
  // core §0's default". The count is reachable by noise (previous test), so
  // volume must not be what unlocks it. Take a real scan result and drive its
  // askRate far past the bar, then assert the renderer still refuses.
  assert.equal(ASK_RATE_PRECISION, null, 'precision must stay null until a labeling pass sets it');
  const dir = stageFixture('ask-rate-noise');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    r.askRate = { segments: 200, asks: ASK_DECISION_MIN_ANSWERS * 10, assent: 999 };
    const md = formatMarkdown(r);
    assert.match(md, /NOT YET READABLE/, 'the disposition must be gated on calibration, not on volume');
    assert.doesNotMatch(md, /the disposition below can be read/);
    // MEDIUM-1: no per-task ratio. A false ask inflates `asks` AND suppresses the
    // segment boundary it would be divided by, so the quotient is not a rate.
    assert.doesNotMatch(md, /asks per task/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M-4: the disposition verdict has three branches and all of them are reachable', () => {
  // Round-3 M-4: the verdict was inlined and a test pinned ASK_RATE_PRECISION to
  // null, so the only way to execute the calibrated arms was to fail the suite —
  // i.e. the documented next step (hand-label, then set the precision) was
  // blocked by the gate meant to hold it until then. The verdict is a pure
  // function now, and the boundary is under test.
  assert.equal(PRECISION_GATE, 0.8);
  assert.match(askDispositionVerdict(null)[0], /NOT YET READABLE — precision is null/);
  assert.match(askDispositionVerdict(0.5)[0], /NOT YET READABLE — labeled precision 0\.5 is below/);
  assert.match(askDispositionVerdict(0.79)[0], /NOT YET READABLE/);
  // at the gate, not merely above it
  assert.match(askDispositionVerdict(PRECISION_GATE)[0], /^> READABLE/);
  assert.match(askDispositionVerdict(0.92)[0], /^> READABLE/);
});

test('M-4: today the shipped constant still lands on the uncalibrated branch', () => {
  // Separated from the branch test on purpose. This one asserts the CURRENT
  // configuration; the one above asserts the function. Setting a labeled
  // precision should change this assertion, not break the branch coverage.
  assert.equal(ASK_RATE_PRECISION, null);
  assert.match(askDispositionVerdict(ASK_RATE_PRECISION)[0], /NOT YET READABLE/);
});

test('L-3: the by-class line renders every populated class, and sums to pooled', () => {
  // Printing self+external only made the line silently disagree with the pooled
  // figure beside it whenever `unknown` was non-empty.
  const r = {
    askRate: { segments: 167, asks: 29, assent: 1 },
    byClass: {
      self: { askRate: { segments: 45, asks: 6, assent: 0 } },
      external: { askRate: { segments: 115, asks: 21, assent: 0 } },
      unknown: { askRate: { segments: 7, asks: 2, assent: 1 } },
    },
  };
  const [line] = h4ByClassLines(r);
  assert.ok(line && line.startsWith('H4 by class'), 'the by-class line must render');
  assert.match(line, /unknown: 2 ask\(s\), 1 assent, 7 segment\(s\)/);
  const asks = [...line.matchAll(/(\d+) ask\(s\)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const segs = [...line.matchAll(/(\d+) segment\(s\)/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(asks, r.askRate.asks, 'class asks must sum to pooled');
  assert.equal(segs, r.askRate.segments, 'class segments must sum to pooled');
  // an empty class contributes nothing rather than a zero-filled fragment
  assert.deepEqual(
    h4ByClassLines({ byClass: { self: { askRate: { segments: 0, asks: 0, assent: 0 } } } }),
    []
  );
  assert.deepEqual(h4ByClassLines({}), []);
});

// ============================================================================
// Round-14 audit — the two live detectors were about to publish precision
// against the wrong denominator or the wrong predicate.
// ============================================================================

test('ALG-H2: a single-line `Done:` report closes the cycle, so `next` is not a tell', async () => {
  // §10's short form IS the prescribed L1 report ("Failed+Uncertain empty →
  // `Done: <what>.`"), and L1-bugfix defaults to a single `Done:` line. The
  // CLOSED predicate required a Failed/Uncertain heading, so the shape the spec
  // prescribes scored a §11 violation the moment the user typed anything.
  const dir = stageFixture('turn-yield-done-line');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§11-turn-yield'].opportunities, 1, 'the turn used tools, so it is an opportunity');
    assert.equal(r.byRule['§11-turn-yield'].violations, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-H2: yieldTellSuppressed pins where a Done line does and does not close', () => {
  assert.equal(yieldTellSuppressed('Done: fixed it (Checked: 3/3).'), true);
  assert.equal(yieldTellSuppressed('**Done:** fixed it (Checked: 3/3).'), true);
  assert.equal(yieldTellSuppressed('## Done: fixed it'), true);
  // A `Done:` line far from the end is narrative, not a report tail.
  assert.equal(yieldTellSuppressed('Done: step one.\n' + 'x'.repeat(900)), false);
  // And an ordinary working turn still does not close.
  assert.equal(yieldTellSuppressed('Reading the config now, will report back.'), false);
});

test('ALG-M3: an AUTH signal with no user turn after it is not coverage', async () => {
  // §5 says the signal "blocks until user confirms", so the confirmation is a
  // USER TURN. The detector only asked whether the marker was in the last 10
  // assistant texts, so emitting `[AUTH REQUIRED …]` and force-pushing in the
  // same turn scored 0 violations out of 1 opportunity.
  const dir = stageFixture('hard-auth-same-turn');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§5-hard-auth'].opportunities, 1);
    assert.equal(r.byRule['§5-hard-auth'].violations, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M3: isHardOp reaches the force-push and migration shapes an agent types', async () => {
  // `--force` was the only force-push spelling, and §5 Hard lists
  // "migration/DB schema" while the detector knew only SQL DDL — so `git push
  // -f`, a `+branch` refspec, and every migration runner were not opportunities
  // at all. Under-reporting is the direction that makes a detector look clean.
  const dir = stageFixture('hard-auth-shapes');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byRule['§5-hard-auth'].opportunities, 5, 'five hard ops, five opportunities');
    assert.equal(r.byRule['§5-hard-auth'].violations, 5, 'none of them carried an AUTH signal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M2: the §10-V denominator is named for what it counts', async () => {
  // It counts assistant message ROWS carrying text, sidechains included — a
  // turn making four tool calls with prose between them contributes four — and
  // the report called it "Total assistant turns" for the life of the field.
  const dir = stageFixture('multi-turn');
  try {
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(typeof r.totalAssistantTextRows, 'number');
    assert.equal(r.byRule['§10-V'].opportunities, r.totalAssistantTextRows);
    const md = formatMarkdown(r);
    assert.match(md, /Assistant message rows with text \(sidechains included\)/);
    assert.doesNotMatch(md, /Total assistant turns/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-L2: bold and heading section labels are seen, so the order check can fire on them', () => {
  // `§10-four-section-order` is closed on "zero positives across 14056 turns".
  // The label scanner saw `Done:` and `## Done` only, so `**Done**` / `### Done`
  // / `- **Done:**` could not produce a positive at all — the zero was evidence
  // about the regex. These are the same four labels in the spellings agents
  // actually write.
  const bold = [
    '**Done**: moved the write ahead of the rename (Checked: 51/51 pass).',
    '**Not done**: the marketplace gate.',
    '**Uncertain**: whether the macOS leg times out for the same reason.',
    '**Failed**: nothing.',
  ].join('\n\n');
  const s = scanStructure(bold);
  assert.equal(s.fourSection, 1, 'a bold-label report must register as a four-section block');
  assert.equal(s.orderViolation, 1, 'Uncertain before Failed is an order violation');

  const heading = ['### Done', 'x', '### Not done', 'y', '### Failed', 'z', '### Uncertain', 'w'].join('\n');
  const h = scanStructure(heading);
  assert.equal(h.fourSection, 1, 'ATX headings must register too');
  assert.equal(h.orderViolation, 0, 'and this one is in the right order');

  const listItem = ['- **Done:** a', '- **Not done:** b', '- **Failed:** c', '- **Uncertain:** d'].join('\n');
  assert.equal(scanStructure(listItem).fourSection, 1, 'list-item labels must register');

  // Control: prose that merely mentions the words is still not a report.
  assert.equal(scanStructure('I am done with the failed test and uncertain about the rest').fourSection, 0);
});

// ---------------------------------------------------------------------------
// G0 behaviour metrics (docs/spec-optimization-roadmap-2026-09-21.md §7 G0).
//
// These are exact counts, so the test is arithmetic rather than calibration:
// every assertion below states the input shape and the number it must produce,
// and each threshold is driven on BOTH sides of its boundary. A count that
// cannot distinguish 7 edits from 8 is a count nobody can act on.

const ev = (...toolUses) => ({ kind: 'assistant', text: '', hasText: false, toolUses, sidechain: false });
const edit = (file_path, old_string = '', new_string = '') => ({
  name: 'Edit',
  input: { file_path, old_string, new_string },
});
const write = file_path => ({ name: 'Write', input: { file_path, content: 'x' } });
const editsTo = (file, n) => Array.from({ length: n }, () => ev(edit(file)));

test('G0 isTestFile: code extension AND test dir/name — `spec/` alone does not qualify', () => {
  assert.equal(isTestFile('tests/run.test.js'), true);
  assert.equal(isTestFile('pkg/tests/helper.js'), true, 'a code file under tests/ qualifies');
  assert.equal(isTestFile('src/parser.test.ts'), true);
  assert.equal(isTestFile('src/parser_test.go'), true);
  assert.equal(isTestFile('__tests__/a.rs'), true);
  // The named exclusion. This repo's own spec/ holds CLAUDE.md and
  // hard-rules.json; a matcher that counted `spec/` would report spec edits as
  // test edits, and on this corpus that is where the difference lands.
  assert.equal(isTestFile('spec/CLAUDE.md'), false, '`spec/` is not a test directory');
  assert.equal(isTestFile('spec/hard-rules.json'), false);
  assert.equal(isTestFile('tests/fixtures/sample.jsonl'), false, 'not a code extension');
  assert.equal(isTestFile('docs/tests.md'), false);
  assert.equal(isTestFile('src/parser.js'), false, 'plain source is not a test');
});

test('G0 rework: the threshold fires at 8 and not at 7, on both denominators', () => {
  assert.equal(REWORK_THRESHOLD, 8, 'pre-registered before data collection — must not be tuned');

  const seven = scanBehavior(editsTo('/p/src/a.js', 7));
  assert.equal(seven.editedSessions, 1);
  assert.equal(seven.reworkSessions, 0, '7 edits is below the threshold');
  assert.equal(seven.editBuckets['5-7'], 1);

  const eight = scanBehavior(editsTo('/p/src/a.js', 8));
  assert.equal(eight.reworkSessions, 1, '8 edits is at the threshold');
  assert.equal(eight.reworkSessionsCodeOnly, 1);
  assert.equal(eight.editBuckets['8-14'], 1);
  assert.equal(eight.editBuckets['5-7'], 0, 'a session lands in exactly one bucket');

  // The count is per FILE, not per session: eight edits spread over two files
  // is four apiece and not rework.
  const spread = scanBehavior([...editsTo('/p/src/a.js', 4), ...editsTo('/p/src/b.js', 4)]);
  assert.equal(spread.reworkSessions, 0);
  assert.equal(spread.editBuckets['3-4'], 1);

  // Write counts toward the same per-file tally as Edit (a rewrite is rework).
  assert.equal(scanBehavior([...editsTo('/p/src/a.js', 7), ev(write('/p/src/a.js'))]).reworkSessions, 1);

  // Non-code churn moves the any-file counter and not the code-only one — the
  // two rates in 3.2(b) differ by exactly this.
  const docs = scanBehavior(editsTo('/p/docs/notes.md', 9));
  assert.equal(docs.editedSessions, 1);
  assert.equal(docs.reworkSessions, 1);
  assert.equal(docs.codeEditedSessions, 0);
  assert.equal(docs.reworkSessionsCodeOnly, 0);
});

test('G0 test-edit disposition: the four classes partition the edits', () => {
  const b = scanBehavior([
    ev(edit('tests/a.test.js', 'assert(1)', 'assert(1); assert(2)')), // +1 assertion
    ev(edit('tests/a.test.js', 'assert(1)', 'assert(2)')), // unchanged
    ev(edit('tests/a.test.js', 'assert(1); assert(2)', 'assert(1)')), // −1 assertion
    ev(
      edit(
        'tests/a.test.js',
        'test("a", () => assert(1))\ntest("b", () => assert(2))',
        'test("a", () => assert(1))'
      )
    ),
    ev(edit('src/impl.js', 'assert(1); assert(2)', 'assert(1)')), // not a test file
    ev(edit('spec/CLAUDE.md', 'assert(1); assert(2)', '')), // not a test file
    ev(write('tests/b.test.js')), // Write has no old_string to compare
  ]);
  assert.equal(b.testEdits, 4, 'only Edit calls on test files enter the denominator');
  assert.equal(b.testStrengthened, 1);
  assert.equal(b.testNeutral, 1);
  assert.equal(b.testWeakened, 1);
  assert.equal(b.testCasesDeleted, 1);
  assert.equal(
    b.testStrengthened + b.testNeutral + b.testWeakened + b.testCasesDeleted,
    b.testEdits,
    'the four classes must sum to the denominator — no edit counted twice or dropped'
  );
});

test('G0 skill rate: Skill calls counted by name against every tool_use', () => {
  const b = scanBehavior([
    ev({ name: 'Skill', input: { skill: 'superpowers:brainstorming' } }),
    ev({ name: 'Skill', input: { skill: 'superpowers:brainstorming' } }),
    ev({ name: 'Skill', input: {} }),
    ev({ name: 'Bash', input: { command: 'ls' } }, { name: 'Read', input: { file_path: '/p/x.js' } }),
  ]);
  assert.equal(b.toolUses, 5, 'every tool_use is in the denominator, Skill included');
  assert.equal(b.skillInvocations, 3);
  assert.deepEqual(b.skillsByName, { 'superpowers:brainstorming': 2, '(unnamed)': 1 });
  // Read carries a file_path and must not count as an edit.
  assert.equal(b.editedSessions, 0);
});

// Analysis 2026-09-26 B1: Opus 5.5 routes most edits through Bash heredocs,
// and a rework count that reads only Edit/Write reported 0/17 for a week that
// was 8/21. The pre-registered tool-only pair must NOT move; the any-channel
// pair must see the Bash edits, per file, merged with the tool edits.
const bashEdit = (...files) => ({ kind: 'bash-edit', files, sidechain: false });

test('B1 any-channel rework: Bash edits merge per file, the tool-only pair does not move', () => {
  // 4 tool edits + 4 Bash edits to ONE file: rework on the merged count only.
  const mixed = scanBehavior([
    ...editsTo('/p/src/a.js', 4),
    ...Array.from({ length: 4 }, () => bashEdit('/p/src/a.js')),
  ]);
  assert.equal(mixed.reworkSessions, 0, 'the pre-registered tool-only count sees 4 edits');
  assert.equal(mixed.reworkSessionsAnyChannel, 1, 'the merged count sees 8');
  assert.equal(mixed.editsViaTool, 4);
  assert.equal(mixed.editsViaBash, 4);
  // Control: 4 + 3 is still below the threshold on the merged count, so the
  // case above is about the merge and not about Bash edits always counting.
  const below = scanBehavior([
    ...editsTo('/p/src/a.js', 4),
    ...Array.from({ length: 3 }, () => bashEdit('/p/src/a.js')),
  ]);
  assert.equal(below.reworkSessionsAnyChannel, 0);
  // A Bash-only session is an edited session on the merged count and not on
  // the tool-only one — this is the population the 0/17 week was missing.
  const bashOnly = scanBehavior(Array.from({ length: 8 }, () => bashEdit('/p/src/b.py')));
  assert.equal(bashOnly.editedSessions, 0);
  assert.equal(bashOnly.editedSessionsAnyChannel, 1);
  assert.equal(bashOnly.reworkSessionsAnyChannel, 1);
  // One command touching two files is two file edits, not one.
  assert.equal(scanBehavior([bashEdit('/p/a.js', '/p/b.js')]).editsViaBash, 2);
});

// Review H1: `skillInvocations` is the PRE-REGISTERED G0 field ("tool_use.name
// === 'Skill'", roadmap 2026-09-21) and keeps counting every call; failed
// lookups are reported BESIDE it, never subtracted from it.
test('B4 skill rate: an errored Skill call stays in skillInvocations and is also counted as an error', () => {
  const b = scanBehavior([
    ev({ id: 'tu_ok', name: 'Skill', input: { skill: 'superpowers:tdd' } }),
    ev({ id: 'tu_bad', name: 'Skill', input: { skill: 'ship' } }),
    { kind: 'tool-error', id: 'tu_bad', sidechain: false },
    // An error on a DIFFERENT id must not touch the Skill calls.
    { kind: 'tool-error', id: 'tu_other', sidechain: false },
  ]);
  assert.equal(b.skillInvocations, 2, 'pre-registered: every Skill tool_use');
  assert.equal(b.skillInvocationErrors, 1);
  assert.deepEqual(b.skillsByName, { 'superpowers:tdd': 1, ship: 1 });
  assert.deepEqual(b.skillErrorsByName, { ship: 1 });
  assert.equal(b.toolUses, 2, 'a failed call is still a tool_use');
});

test('B1/B2/B4 end-to-end: bashEditDiff, tool errors and subagent files reach the result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-b12-'));
  try {
    const ts = new Date().toISOString();
    const bashRow = (id, file) => [
      {
        type: 'assistant',
        timestamp: ts,
        version: '2.1.283',
        message: {
          content: [{ type: 'tool_use', id, name: 'Bash', input: { command: "python3 - <<'PY'" } }],
        },
      },
      {
        type: 'user',
        timestamp: ts,
        version: '2.1.283',
        message: { content: [{ type: 'tool_result', tool_use_id: id, content: '' }] },
        toolUseResult: { stdout: '', bashEditDiff: { files: [{ filePath: file, hunks: [] }] } },
      },
    ];
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => bashRow(`tu_b${i}`, '/p/src/a.py')).flat(),
      {
        type: 'assistant',
        timestamp: ts,
        message: { content: [{ type: 'tool_use', id: 'tu_s', name: 'Skill', input: { skill: 'ship' } }] },
      },
      {
        type: 'user',
        timestamp: ts,
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_s', is_error: true, content: 'Unknown skill: ship' },
          ],
        },
      },
    ];
    const write = (f, rs) => fs.writeFileSync(f, rs.map(r => JSON.stringify(r)).join('\n') + '\n');
    write(path.join(dir, 'sess1.jsonl'), rows);
    const subDir = path.join(dir, 'sess1', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    write(path.join(subDir, 'agent-a1.jsonl'), [
      {
        type: 'assistant',
        timestamp: ts,
        isSidechain: true,
        message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] },
      },
      {
        type: 'assistant',
        timestamp: ts,
        isSidechain: true,
        message: { content: [{ type: 'tool_use', id: 'y', name: 'Skill', input: { skill: 'sp:tdd' } }] },
      },
    ]);
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    const b = r.behaviorMetrics;
    assert.equal(b.editedSessions, 0, 'no Edit/Write — the tool-only count is empty');
    assert.equal(b.reworkSessionsAnyChannel, 1, '8 Bash edits to one file');
    assert.equal(b.editsViaBash, 8);
    assert.equal(b.bashEditCapableSessions, 1);
    assert.equal(b.skillInvocations, 1, 'the failed call is still an invocation (pre-registered)');
    assert.equal(b.skillInvocationErrors, 1);
    assert.equal(b.toolUses, 9, 'the subagent file does not leak into the main block');
    assert.equal(r.subagentTranscripts, 1);
    assert.equal(r.subagentBehaviorMetrics.toolUses, 2);
    assert.equal(r.subagentBehaviorMetrics.skillInvocations, 1);
    const md = behaviorLines(r).join('\n');
    assert.match(md, /any channel \(Edit\/Write \+ bashEditDiff\): 1\/1/);
    assert.match(md, /of which failed: 1/);
    assert.match(md, /Subagent transcripts \(1, counted separately\): tool_use 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Review M4/M5: the subagent pass is bounded by the window like the main
// files, feeds BOTH --global aggregates, keeps its reader errors out of the
// pre-existing unreadable/malformed lists, and the Bash-edit capability flag
// follows the CLI version.
test('B2 subagent pass: window, --global pooled + per-class merge, separate reader-error lists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-b2g-'));
  try {
    const ts = new Date().toISOString();
    const row = name =>
      JSON.stringify({
        type: 'assistant',
        timestamp: ts,
        message: { content: [{ type: 'tool_use', id: 'x', name, input: {} }] },
      });
    const proj = path.join(root, encodeProjectCwd('/home/u/dev/claudemd'));
    const subDir = path.join(proj, 's1', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(proj, 's1.jsonl'), row('Read') + '\n');
    fs.writeFileSync(path.join(subDir, 'agent-fresh.jsonl'), row('Read') + '\n' + row('Grep') + '\n');
    const old = path.join(subDir, 'agent-old.jsonl');
    fs.writeFileSync(old, row('Read') + '\n');
    const t = (Date.now() - 90 * 86400000) / 1000;
    fs.utimesSync(old, t, t);
    fs.writeFileSync(path.join(subDir, 'agent-bad.jsonl'), 'not json\n');
    const r = await samplingAuditGlobal({ projectsRoot: root, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.subagentTranscripts, 2, 'the 90-day-old subagent file is outside the window');
    assert.equal(r.subagentBehaviorMetrics.toolUses, 2, 'pooled --global merge');
    assert.equal(r.byClass.self.subagentBehaviorMetrics.toolUses, 2, 'per-class --global merge');
    assert.equal(r.byClass.self.subagentTranscripts, 2);
    assert.deepEqual(r.malformedTranscripts, [], 'a subagent file does not move the pre-existing list');
    assert.equal(r.subagentMalformedTranscripts.length, 1);
    assert.match(r.subagentMalformedTranscripts[0].file, /s1\/subagents\/agent-bad\.jsonl$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('B1 bashEditCapableSessions follows the CLI version, not mere presence of a version field', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-b1v-'));
  try {
    const ts = new Date().toISOString();
    const u = v =>
      JSON.stringify({
        type: 'user',
        timestamp: ts,
        version: v,
        permissionMode: 'bypassPermissions',
        message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '' }] },
      });
    fs.writeFileSync(path.join(dir, 'old.jsonl'), u('2.1.277') + '\n');
    fs.writeFileSync(path.join(dir, 'new.jsonl'), u('2.1.278') + '\n');
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.behaviorMetrics.bashEditCapableSessions, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// D#88 probe (CC 2.1.283 binary + two headless runs): bashEditDiff is recorded
// only when the feature is on — by default in auto / bypassPermissions mode, or
// forced by CLAUDE_CODE_BASH_EDIT_DIFF. A default-mode or headless session on a
// new CLI records none, so version alone over-counts the capable denominator
// (5 of 99 sessions on this machine, 2026-09-26).
test('B1 bashEditCapableSessions also needs a permission mode that records Bash edits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-b1m-'));
  try {
    const ts = new Date().toISOString();
    const u = (mode, extra = {}) =>
      JSON.stringify({
        type: 'user',
        timestamp: ts,
        version: '2.1.283',
        ...(mode ? { permissionMode: mode } : {}),
        message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '' }] },
        ...extra,
      });
    fs.writeFileSync(path.join(dir, 'default.jsonl'), u('default') + '\n');
    fs.writeFileSync(path.join(dir, 'nomode.jsonl'), u(null) + '\n');
    fs.writeFileSync(path.join(dir, 'plan.jsonl'), u('plan') + '\n');
    fs.writeFileSync(path.join(dir, 'auto.jsonl'), u('auto') + '\n');
    fs.writeFileSync(path.join(dir, 'bypass.jsonl'), u('bypassPermissions') + '\n');
    // Mode seen on a LATER row than the version still counts, once.
    fs.writeFileSync(
      path.join(dir, 'late.jsonl'),
      u(null) + '\n' + u('bypassPermissions') + '\n' + u('bypassPermissions') + '\n'
    );
    // Env-forced: default mode, but a bashEditDiff was recorded — capable.
    fs.writeFileSync(
      path.join(dir, 'forced.jsonl'),
      u('default', { toolUseResult: { stdout: '', bashEditDiff: { files: [{ filePath: '/p/a.py' }] } } }) +
        '\n'
    );
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.behaviorMetrics.bashEditCapableSessions, 4, 'auto, bypass, late, forced');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('G0 end-to-end: behaviorMetrics reaches the result with its threshold and validity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-g0-'));
  try {
    // A transcript whose assistant rows carry NO text — only tool calls. The
    // text detectors skip it; the behaviour metrics must not, because their
    // denominators are sessions-that-edited and tool_use.
    const rows = [
      ...Array.from({ length: 8 }, () => ({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/src/a.js' } }] },
      })),
      {
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'sp:tdd' } }] },
      },
    ];
    fs.writeFileSync(path.join(dir, 'x.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const r = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.scannedTranscripts, 0, 'no assistant TEXT rows — the text-detector sample is empty');
    assert.equal(r.behaviorMetrics.editedSessions, 1, 'and the behaviour sample is not');
    assert.equal(r.behaviorMetrics.reworkSessions, 1);
    assert.equal(r.behaviorMetrics.toolUses, 9);
    assert.equal(r.behaviorMetrics.skillInvocations, 1);
    assert.equal(r.behaviorMetrics.reworkThreshold, REWORK_THRESHOLD);
    // The validity statement is the thing these metrics carry INSTEAD of a
    // precision label, so it has to travel with the numbers in --json.
    assert.match(r.behaviorMetrics.validity, /Exact counts, not heuristics/);
    assert.match(r.behaviorMetrics.validity, /EDIT SHAPE/);
    assert.match(r.behaviorMetrics.validity, /UPPER BOUND/);
    assert.match(r.behaviorMetrics.validity, /isSidechain=0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('G0 stratification: the pooled behaviour counts equal the sum of the classes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-g0g-'));
  try {
    const mk = (dirName, file, n) => {
      const d = path.join(root, dirName);
      fs.mkdirSync(d, { recursive: true });
      const rows = Array.from({ length: n }, () => ({
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
      }));
      fs.writeFileSync(path.join(d, 's.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    };
    mk(encodeProjectCwd('/home/u/dev/claudemd'), '/home/u/dev/claudemd/src/a.js', 8);
    mk(encodeProjectCwd('/home/u/dev/other'), '/home/u/dev/other/src/b.js', 3);

    const r = await samplingAuditGlobal({ projectsRoot: root, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(r.byClass.self.behaviorMetrics.reworkSessions, 1);
    assert.equal(r.byClass.external.behaviorMetrics.reworkSessions, 0);
    const sum = k => r.byClass.self.behaviorMetrics[k] + r.byClass.external.behaviorMetrics[k];
    for (const k of ['editedSessions', 'reworkSessions', 'testEdits', 'toolUses', 'skillInvocations']) {
      assert.equal(r.behaviorMetrics[k], sum(k), `pooled ${k} must equal self + external`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G0 report: every behaviour rate is printed with its denominator, and the line tracks the data', () => {
  const base = {
    windowDays: 30,
    projectsDir: '/x',
    scannedTranscripts: 1,
    totalAssistantTextRows: 1,
    unreadableTranscripts: [],
    malformedTranscripts: [],
    byRule: Object.fromEntries(
      [
        '§10-V',
        '§iron-law-2',
        '§10-four-section-order',
        '§10-honesty',
        '§11-turn-yield',
        '§7-bugfix-anchor',
        '§11-post-compaction',
        '§5-hard-auth',
      ].map(k => [
        k,
        {
          hits: 0,
          violations: 0,
          opportunities: 0,
          transcriptsAffected: 0,
          precision: null,
          status: 'closed',
        },
      ])
    ),
    perTranscript: [],
    behaviorMetrics: {
      ...emptyBehavior(),
      editedSessions: 100,
      reworkSessions: 40,
      codeEditedSessions: 80,
      reworkSessionsCodeOnly: 30,
      testEdits: 200,
      testStrengthened: 100,
      testNeutral: 90,
      testWeakened: 8,
      testCasesDeleted: 2,
      toolUses: 1000,
      skillInvocations: 5,
      reworkThreshold: REWORK_THRESHOLD,
      validity: 'V-STATEMENT',
    },
  };
  const md = formatMarkdown(base);
  assert.match(md, /Rework \(≥8 edits to one file in one session\): 40\/100 sessions with any edit = 40\.0%/);
  assert.match(
    md,
    /code files only: 30\/100 of edit-sessions = 30\.0% · 30\/80 of code-edit sessions = 37\.5%/
  );
  assert.match(md, /Test-file Edits: 200 · strengthened 100 \(50\.0%\)/);
  assert.match(md, /weakened\+deleted 10 \(5\.0%\)/);
  assert.match(md, /Skill invocations: 5\/1000 tool_use = 0\.5%/);
  assert.match(md, /> Validity \(pre-registered, G0\): V-STATEMENT/);

  // Mutation control: the renderer must be reading these fields, not printing a
  // shape that happens to contain the right digits. One field moves; the line
  // must move with it and the others must not.
  const mutated = formatMarkdown({
    ...base,
    behaviorMetrics: { ...base.behaviorMetrics, reworkSessions: 41 },
  });
  assert.notEqual(mutated, md, 'changing reworkSessions changed nothing — the renderer is not reading it');
  assert.match(mutated, /40\.0%|41\/100/);
  assert.doesNotMatch(mutated, /: 40\/100 sessions with any edit/);
  assert.match(mutated, /Skill invocations: 5\/1000 tool_use = 0\.5%/, 'unrelated lines must not move');
});

// --- `--until`: the window's missing upper bound ---------------------------
//
// `--days` bounded only the OLD side, so a pre-registered measurement could not
// be re-derived once the corpus grew past it — and a baseline nobody can
// reproduce is not a baseline. That is not hypothetical: §3.2/3.3 of the
// roadmap are a snapshot taken at one instant on 2026-09-21, and by the time
// G0 shipped the same command returned different denominators. With both ends
// closed, `--until=1790021507` reproduces that snapshot's test-edit split
// exactly (804/763/37/14), which is what settled which matcher produced it.

test('--until: rows after the bound are excluded, rows before it are kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-until-'));
  try {
    const at = t => new Date(t).toISOString();
    const edit = (t, f) => ({
      type: 'assistant',
      timestamp: at(t),
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] },
    });
    const T0 = Date.now() - 3600_000; // an hour ago, inside any 30d window
    const rows = [
      edit(T0, '/p/src/early.js'),
      edit(T0 + 1000, '/p/src/early.js'),
      edit(T0 + 600_000, '/p/src/late.js'), // ten minutes later
    ];
    fs.writeFileSync(path.join(dir, 's.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

    const all = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(all.behaviorMetrics.toolUses, 3, 'unbounded: every row counts');

    const bounded = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: T0 + 60_000,
    });
    assert.equal(bounded.behaviorMetrics.toolUses, 2, 'bounded: the later row is out of window');
    assert.equal(bounded.untilMs, T0 + 60_000, 'the bound is carried in the result for the reader');

    // The bound must be a bound, not a filter that also drops the old side.
    const wide = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: T0 + 3600_000,
    });
    assert.equal(wide.behaviorMetrics.toolUses, 3, 'a bound past every row changes nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A bound written at second granularity means that whole second, not its
// `.000` edge. Found in the v0.91.0 pre-ship review, and it had already cost
// two published reproductions: `--until=1790021570` printed 33,139 tool calls
// beside a sentence saying the instant was the one where the count reaches
// 33,140, and `--until=1790021507` printed a test-edit split of 804/762/37/14
// under a claim of 804/763/37/14. Both commands were short by exactly the rows
// inside their own second, and both errors ran against the author — the real
// reconciliation was the exact one, so nothing downstream noticed.
//
// The rule: a value that names no fraction of a second is inclusive to the end
// of that second; a value that names one is taken exactly.
test('--until: a second-granularity bound includes that whole second', () => {
  const S = 1790021570; // 2026-09-21T20:12:50Z
  assert.equal(parseUntilMs('1790021570'), S * 1000 + 999, 'epoch seconds cover their own second');
  assert.equal(
    parseUntilMs('2026-09-21T20:12:50Z'),
    S * 1000 + 999,
    'ISO with no fraction covers its own second, same as the epoch form'
  );
  assert.equal(
    parseUntilMs('2026-09-21T20:12:50.999Z'),
    S * 1000 + 999,
    'an explicit .999 is the same instant, spelled out'
  );
  assert.equal(
    parseUntilMs('2026-09-21T20:12:50.000Z'),
    S * 1000,
    'an explicit fraction is taken exactly — .000 still means the edge'
  );
  assert.equal(
    parseUntilMs('2026-09-21T20:12:50.4Z'),
    S * 1000 + 400,
    'a one-digit fraction is a fraction, not a missing one'
  );
  assert.ok(!Number.isFinite(parseUntilMs('nonsense')), 'an unparseable value stays unparseable');
  // The same rule one unit up and one unit down: the bound covers the finest
  // unit the value actually names.
  assert.equal(
    parseUntilMs('2026-09-21T20:12Z'),
    Date.UTC(2026, 8, 21, 20, 12, 59, 999),
    'a minute-granularity time covers its minute'
  );
  assert.equal(
    parseUntilMs('2026-09-21'),
    Date.UTC(2026, 8, 21, 23, 59, 59, 999),
    'a bare date covers its day'
  );
});

// Every numeric form that is not epoch seconds used to parse into a silent
// nonsense bound: 13-digit epoch-MILLISECONDS multiplied to the year 58694 and
// bounded nothing at all — the exact silent-widening the flag's own comment
// claimed to have closed — while `20260921` and `2026` landed in 1970 and
// emptied the window. A plausibility range catches all of them in one place.
test('--until: a value that resolves to an implausible instant is rejected, not used', () => {
  for (const raw of ['1790054707000', '20260921', '2026', '1']) {
    assert.ok(
      !Number.isFinite(parseUntilMs(raw)),
      `${raw} must be rejected — it resolves outside 2020-01-01..+1y`
    );
  }
  // Control: the correct form of the same instant is accepted, so the range
  // check is rejecting the SPELLING and not the date.
  assert.ok(
    Number.isFinite(parseUntilMs('1790054707')),
    'epoch seconds for the same instant are still accepted'
  );
});

// Two spellings of the same minute-granularity instant must give the same
// bound. Reading the unit off the raw string counted the OFFSET's colon and put
// `+08:00` in the seconds branch, 59s from where `+0800` landed (delta review,
// M5). The unit now comes from the matched groups.
test('--until: the named unit is read from the shape, not from punctuation', () => {
  assert.equal(
    parseUntilMs('2026-09-21T20:12+08:00'),
    parseUntilMs('2026-09-21T20:12+0800'),
    'two spellings of one offset must not differ by a minute'
  );
  assert.equal(
    parseUntilMs('2026-09-21T20:12+08:00'),
    Date.UTC(2026, 8, 21, 12, 12, 59, 999),
    'and both cover the minute they name'
  );
});

// `Date.parse` also accepts a space separator and RFC-ish prose. A `/T/` test in
// front of it read `2026-09-21 20:12:50` as a bare DATE and widened the bound by
// 24 hours, and found the `T` of `GMT` in `Sep 21 2026 … GMT+0000`. Neither is
// visible to the range check, because both land on plausible instants — the same
// shape as the `.000` defect this release repaired (delta review, H2).
test('--until: only a literal-T ISO shape is accepted', () => {
  for (const raw of [
    '2026-09-21 20:12:50Z',
    '2026-09-21 20:12:50',
    'Sep 21 2026 20:12:50 GMT+0000',
    '2026/09/21T20:12:50Z',
  ]) {
    assert.ok(!Number.isFinite(parseUntilMs(raw)), `${raw} must be rejected, not reinterpreted`);
  }
  // Control: the canonical spelling of the same instant is accepted and is NOT
  // widened to the end of its day.
  assert.equal(
    parseUntilMs('2026-09-21T20:12:50Z'),
    Date.UTC(2026, 8, 21, 20, 12, 50, 999),
    'the T form covers its second, not its day'
  );
});

// `Date.parse` reads a bare local time in the runner's zone — a 16-hour spread
// on the same command line, in the one flag whose purpose is that a baseline
// stays reproducible. A bare DATE is unambiguous per ISO-8601 and stays legal.
test('--until: an ISO time without an explicit offset is rejected', () => {
  assert.ok(!Number.isFinite(parseUntilMs('2026-09-21T12:00:00')), 'bare local time is ambiguous');
  for (const raw of ['2026-09-21T12:00:00Z', '2026-09-21T12:00:00+09:00', '2026-09-21T12:00:00+0900']) {
    assert.ok(Number.isFinite(parseUntilMs(raw)), `${raw} carries an offset and must be accepted`);
  }
  assert.equal(
    parseUntilMs('2026-09-21T12:00:00+09:00'),
    Date.UTC(2026, 8, 21, 3, 0, 0, 999),
    'the offset is applied, not ignored'
  );
});

test('--until: the rounding is visible end to end, not only in the parser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-untilsec-'));
  try {
    const edit = (t, f) => ({
      type: 'assistant',
      timestamp: new Date(t).toISOString(),
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] },
    });
    // A whole second, with a row at its edge and a row 400ms into it. The
    // second is an hour ago so it sits inside any 30-day window.
    const SEC = Math.floor((Date.now() - 3600_000) / 1000) * 1000;
    fs.writeFileSync(
      path.join(dir, 's.jsonl'),
      [edit(SEC, '/p/src/a.js'), edit(SEC + 400, '/p/src/b.js')].map(r => JSON.stringify(r)).join('\n') + '\n'
    );
    const bounded = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: parseUntilMs(String(SEC / 1000)),
    });
    assert.equal(bounded.behaviorMetrics.toolUses, 2, 'both rows inside the named second are in window');
    // Control: the edge form, spelled explicitly, keeps only the first row —
    // so the assertion above is about the rounding and not about the fixture.
    const edge = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: parseUntilMs(new Date(SEC).toISOString()),
    });
    assert.equal(edge.behaviorMetrics.toolUses, 1, 'an explicit .000 stops at the edge');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// `--days` stayed anchored to Date.now() while `--until` bounded the new end,
// so `--days=30 --until=<fixed instant>` named a DIFFERENT window every day it
// ran and went empty once the instant was more than 30 days old — the
// reproducibility failure this flag exists to close, reintroduced at the other
// end (v0.91.0 pre-ship review, S1).
test('--until: --days is measured back from the bound, not from now', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-untilanchor-'));
  try {
    const edit = (t, f) => ({
      type: 'assistant',
      timestamp: new Date(t).toISOString(),
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] },
    });
    const DAY = 86400000;
    const now = Date.now();
    // Rows at 200, 100 and 1 days ago, one per file so file-mtime prefiltering
    // cannot be what decides the outcome.
    const rows = [
      [now - 200 * DAY, 'old.jsonl'],
      [now - 100 * DAY, 'mid.jsonl'],
      [now - 1 * DAY, 'new.jsonl'],
    ];
    for (const [t, name] of rows) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(edit(t, '/p/src/a.js')) + '\n');
    }
    const run = (days, untilMs) => samplingAudit({ projectsDir: dir, days, pluginRoot: REPO_ROOT, untilMs });

    // A 30-day window ending 100 days ago holds the -100d row and nothing else.
    // Anchored to Date.now() this returned zero, silently.
    const anchored = await run(30, now - 100 * DAY + 1000);
    assert.equal(anchored.behaviorMetrics.toolUses, 1, '--days is counted back from --until');

    // Controls: a bound whose window sits entirely BETWEEN two rows, and the
    // same window with no bound at all. (A 1-day window ending at the -100d
    // row still contains it — that is the row's own instant, not a gap.)
    const between = await run(1, now - 98 * DAY);
    assert.equal(between.behaviorMetrics.toolUses, 0, 'a window between two rows holds neither');
    const unbounded = await run(30, null);
    assert.equal(unbounded.behaviorMetrics.toolUses, 1, 'unbounded 30d still means the last 30 days');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A row with no parseable timestamp cannot be placed inside a bounded window.
// Keeping it made the "reproducible" baseline drift upward as unstamped rows
// accumulated after the bound (v0.91.0 pre-ship review, S6).
test('--until: rows with no timestamp are dropped from a bounded run only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-untilnots-'));
  try {
    const tool = f => ({ type: 'tool_use', name: 'Edit', input: { file_path: f } });
    const stamped = {
      type: 'assistant',
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      message: { content: [tool('/p/src/a.js')] },
    };
    const unstamped = { type: 'assistant', message: { content: [tool('/p/src/b.js')] } };
    fs.writeFileSync(
      path.join(dir, 's.jsonl'),
      [stamped, unstamped].map(r => JSON.stringify(r)).join('\n') + '\n'
    );
    const unbounded = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    assert.equal(unbounded.behaviorMetrics.toolUses, 2, 'unbounded: the old rule is unchanged');
    const bounded = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: Date.now(),
    });
    assert.equal(bounded.behaviorMetrics.toolUses, 1, 'bounded: the unplaceable row is dropped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The markdown report is the artifact a baseline IS — hand-annotated
// calibration records live in it — and its filename carries the RUN date, not
// the window's end. Without the bound in the header a bounded run and an
// unbounded one read identically (v0.91.0 pre-ship review, S4).
test('--until: the written report records the bound it was taken under', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-untilrep-'));
  try {
    const at = Date.now() - 3600_000;
    fs.writeFileSync(
      path.join(dir, 's.jsonl'),
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(at - 60_000).toISOString(),
        message: { content: [{ type: 'text', text: 'Done: a thing.' }] },
      }) + '\n'
    );
    const bounded = await samplingAudit({
      projectsDir: dir,
      days: 30,
      pluginRoot: REPO_ROOT,
      untilMs: at,
    });
    const withBound = formatMarkdown(bounded);
    assert.match(withBound, /--until/, 'a bounded report names the flag');
    assert.ok(
      withBound.includes(new Date(at).toISOString()),
      `the exact bound is missing from the header: ${withBound.split('\n').slice(0, 6).join(' | ')}`
    );
    const unbounded = await samplingAudit({ projectsDir: dir, days: 30, pluginRoot: REPO_ROOT });
    const without = formatMarkdown(unbounded);
    assert.doesNotMatch(without, /--until/, 'an unbounded report does not claim a bound');
    assert.match(without, /ending now/, 'and says what its window ends at instead');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--until CLI: a value that is not a time is rejected, not silently ignored', () => {
  // Silently ignoring it would publish a WIDER window under a narrower-looking
  // command line — the argv silent-fallback shape this repo has a lint for.
  const run = args =>
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/sampling-audit.js'), ...args], {
      encoding: 'utf8',
      timeout: 20000,
    });
  const bad = run(['--until=nonsense', '--json']);
  assert.equal(bad.status, 1, `expected exit 1; stdout=${bad.stdout}`);
  assert.match(bad.stderr, /--until requires ISO-8601 with an explicit UTC offset/);
  // The message has to name every constraint the parser enforces, or the
  // operator learns them one rejected command at a time.
  assert.match(bad.stderr, /epoch SECONDS/);
  assert.match(bad.stderr, /2020-01-01/);
  for (const raw of ['1790054707000', '2026-09-21T12:00:00']) {
    const r = run([`--until=${raw}`, '--json']);
    assert.equal(r.status, 1, `${raw} must exit 1, got ${r.status}: ${r.stdout.slice(0, 120)}`);
  }
  assert.match(run(['--help']).stdout, /--until=T/, 'the flag must be discoverable from --help');
});
