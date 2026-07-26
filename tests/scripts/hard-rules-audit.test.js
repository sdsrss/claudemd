import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hardRulesAudit } from '../../scripts/hard-rules-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const HARD_RULES_AUDIT_JS = path.resolve(HERE, '../../scripts/hard-rules-audit.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hra-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Production-byte-exact assertion (per project memory
// feedback_test_fixture_format_drift): at least one test reads the real
// committed spec/hard-rules.json so the test + impl can't drift into a
// self-consistent-but-wrong pair. Catches schema renames + manifest body
// breakage in one shot.
test('hardRulesAudit on real spec/hard-rules.json — byte-exact production fixture', async () => {
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  assert.ok(r.spec_version.startsWith('v6.'), `spec_version sanity: ${r.spec_version}`);
  assert.ok(r.totalRules >= 16, `expected ≥16 HARD rules, got ${r.totalRules}`);
  // Categories partition exactly — sum equals totalRules.
  const sum = r.byEnforcement.hook + r.byEnforcement.self
            + r.byEnforcement.external + r.byEnforcement.both;
  assert.equal(sum, r.totalRules, 'byEnforcement must partition rules exactly');
  // Sanity: scope buckets sum to total too.
  assert.equal(r.byScope.core + r.byScope.extended, r.totalRules);
  // Known anchor rule that has lived in core since v6.5 — if this disappears,
  // either the rule was demoted (intentional) or the manifest broke (bug).
  const ironLaw2 = r.rules.find(rl => rl.id === '§iron-law-2');
  assert.ok(ironLaw2, 'expected §iron-law-2 in manifest');
  assert.equal(ironLaw2.scope, 'core');
  assert.equal(ironLaw2.enforcement, 'self');
});

test('hardRulesAudit throws clear error when manifest missing', async () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hra-fake-'));
  try {
    await assert.rejects(
      () => hardRulesAudit({ days: 30, pluginRoot: fakeRoot }),
      err => /hard-rules-audit: failed to load .+spec\/hard-rules\.json/.test(err.message),
      'error must cite the missing path'
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test('hardRulesAudit throws clear error on malformed JSON', async () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hra-bad-'));
  try {
    fs.mkdirSync(path.join(fakeRoot, 'spec'));
    fs.writeFileSync(path.join(fakeRoot, 'spec/hard-rules.json'), '{ not: valid json,,, }');
    await assert.rejects(
      () => hardRulesAudit({ days: 30, pluginRoot: fakeRoot }),
      err => /hard-rules-audit: failed to load/.test(err.message)
            && /spec\/hard-rules\.json/.test(err.message),
      'error must name the failing file'
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test('hardRulesAudit throws when rules array missing', async () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-hra-norules-'));
  try {
    fs.mkdirSync(path.join(fakeRoot, 'spec'));
    fs.writeFileSync(path.join(fakeRoot, 'spec/hard-rules.json'),
      JSON.stringify({ spec_version: 'v6.99.0' }));
    await assert.rejects(
      () => hardRulesAudit({ days: 30, pluginRoot: fakeRoot }),
      err => /missing required 'rules' array/.test(err.message),
      'error must explain what is missing'
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test('hardRulesAudit cross-refs rule_hits_section to real log', async () => {
  // Seed a real claudemd.jsonl under tmp HOME with §10-V deny rows; expect
  // §10-specificity rule's hits.deny > 0 in audit output.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["robust"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","spec_section":"§7-ship-baseline","extra":null}\n`
  );
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  const specificity = r.rules.find(rl => rl.id === '§10-specificity');
  assert.ok(specificity, 'expected §10-specificity in manifest');
  assert.ok(specificity.hits, '§10-specificity is enforcement="both" — hits must be present');
  assert.equal(specificity.hits.deny, 2, '§10-V deny rows must reach §10-specificity');
  const shipBaseline = r.rules.find(rl => rl.id === '§7-ship-baseline');
  assert.ok(shipBaseline.hits);
  assert.equal(shipBaseline.hits.deny, 1);
  // A self-enforced rule that DECLARES a rule_hits_section now reports its rows
  // (contract changed 2026-07-25). Keying `hits` off `enforcement` made the five
  // self-rules with advisory hooks report null — indistinguishable from "no
  // telemetry surface" — so §13.1 demote review computed 0 for them by
  // construction. null is now reserved for rules with no section at all.
  const ironLaw2 = r.rules.find(rl => rl.id === '§iron-law-2');
  assert.ok(ironLaw2.hits, 'self-enforced rule with a declared section must report hits');
  const noSurface = r.rules.find(rl => rl.id === '§9-parallel-path');
  assert.equal(noSurface.hits, null, 'a rule with no rule_hits_section must surface hits=null');
});

test('hard-rules-audit CLI rejects space-form --days 30 (was silent default)', () => {
  // v0.9.16 antipattern recurrence: pre-fix, `--days 30` was silently dropped,
  // audit ran with the default window, exited 0 — same family as audit.js
  // / sparkline.js / clean-residue.js fixes shipped in v0.9.16.
  const result = spawnSync(process.execPath, [HARD_RULES_AUDIT_JS, '--days', '30'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, `expected exit 2, stderr: ${result.stderr}`);
  assert.match(result.stderr, /requires '=value' form/);
});

test('hard-rules-audit CLI rejects unknown flag (was silent ignore)', () => {
  const result = spawnSync(process.execPath, [HARD_RULES_AUDIT_JS, '--bogus=1'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag.*--bogus/);
});

test('demoteCandidates list hook-rules with zero hits (sufficient log span)', async () => {
  // To exercise demoteCandidates we need log span >= window. Seed a sentinel
  // row 31 days old so logSpan > 30d window, then no signal events in window.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const old = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${old}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`
  );
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  assert.equal(r.insufficientData, false, 'log span 31d > window 30d → sufficient');
  // §11-memory-read is enforcement="hook" and NOT safety-class — it should
  // appear as a candidate when no signal in window AND log span is sufficient.
  assert.ok(r.demoteCandidates.includes('§11-memory-read'),
    'sufficient-span empty-window must surface §11-memory-read as demote candidate');
  // §iron-law-2 is enforcement="self" — must NOT appear (would be false signal).
  assert.ok(!r.demoteCandidates.includes('§iron-law-2'),
    'self-enforced rules must NOT be demote candidates');
  // v0.57.0: §8 rules are §5.1 Never-downgrade AND sparse by design (the attack
  // surface they guard is rare, not absent) — listing them recommends a
  // forbidden action. They move to safetyClassExempt, still visible.
  for (const id of ['§8-rm-rf-var', '§8-npx', '§8-curl-sh']) {
    assert.ok(!r.demoteCandidates.includes(id),
      `safety-class ${id} must not be a demote candidate`);
    assert.ok(r.safetyClassExempt.includes(id),
      `safety-class ${id} must still surface under safetyClassExempt`);
  }
});

// Bug surfaced v0.9.20 in dogfood session: log span 17d < requested 90d window
// → demoteCandidates included §11-memory-read, which had been silently no-op'd
// in projects with `_` in the cwd path until v0.9.15 fixed it. The rule wasn't
// cold; the data couldn't see it firing because the rule itself was broken.
// Generalizes to any rule where "0 hits in N days" is uninformative because
// the log doesn't reach back N days.

test('insufficientData flag set when log span < requested window', async () => {
  // Empty log under tmp HOME → logSpan = 0 < 30 → insufficient.
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  assert.equal(r.insufficientData, true);
  assert.equal(r.logSpanDays, 0);
  assert.deepEqual(r.demoteCandidates, [],
    'insufficient-data must suppress demoteCandidates to prevent false demote signals');
  assert.ok(r.demoteSuppressed, 'demoteSuppressed must surface when insufficient');
  assert.match(r.demoteSuppressed.reason, /log spans 0\.0d.*requires 30d/);
  assert.ok(!r.demoteSuppressed.wouldHaveBeen.some(id => id.startsWith('§8')),
    'safety-class rules stay out of wouldHaveBeen too (exempt before suppression)');
  assert.ok(Array.isArray(r.demoteSuppressed.wouldHaveBeen),
    'wouldHaveBeen surfaces what would have been demoted with sufficient data');
  assert.ok(r.demoteSuppressed.wouldHaveBeen.includes('§11-memory-read'),
    'wouldHaveBeen retains the candidates so operator can see them as provisional');
});

test('insufficientData false when log spans the requested window exactly', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // 35 days old > 30-day window — sufficient.
  const old = new Date(Date.now() - 35 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${old}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`
  );
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  assert.equal(r.insufficientData, false);
  assert.ok(r.logSpanDays > 30, `logSpanDays ${r.logSpanDays} must exceed window 30`);
  assert.equal(r.demoteSuppressed, null);
});

test('logSpanDays surfaced even when sufficient (operator transparency)', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const old = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${old}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`
  );
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  assert.ok(r.logSpanDays >= 100,
    `logSpanDays ${r.logSpanDays} must reflect actual log reach, not the window`);
});

test('staleReviews uses the §13.1 cadence, not the --days hit window', async () => {
  // 2026-07-26 audit: the threshold was `days`, so "which rules are overdue for
  // review" moved with a flag about how far back to count HITS — --days=30
  // returned none, --days=7 returned all of them. The two windows are unrelated.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(log, `{"ts":"${new Date().toISOString()}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`);
  const a = await hardRulesAudit({ days: 7, pluginRoot: REPO_ROOT });
  const b = await hardRulesAudit({ days: 90, pluginRoot: REPO_ROOT });
  assert.deepEqual(a.staleReviews, b.staleReviews,
    'staleReviews must not depend on --days');
});

test('an unparseable last_demote_review counts as stale, not as fresh', async () => {
  // `new Date('garbage').getTime()` is NaN and `NaN < cutoff` is false, so a
  // corrupt date read as "reviewed recently" — the wrong direction to fail in.
  const manifestPath = path.join(tmpHome, 'spec/hard-rules.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const real = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'spec/hard-rules.json'), 'utf8'));
  const target = real.rules.find(r => r.last_demote_review !== null);
  assert.ok(target, 'fixture needs a rule carrying a review date');
  const targetId = target.id;
  target.last_demote_review = 'not-a-date';
  fs.writeFileSync(manifestPath, JSON.stringify(real));
  fs.mkdirSync(path.join(tmpHome, 'spec'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'spec/CLAUDE.md'), path.join(tmpHome, 'spec/CLAUDE.md'));
  fs.copyFileSync(path.join(REPO_ROOT, 'spec/CLAUDE-extended.md'), path.join(tmpHome, 'spec/CLAUDE-extended.md'));

  const r = await hardRulesAudit({ days: 30, pluginRoot: tmpHome });
  assert.ok(r.staleReviews.includes(targetId),
    `unparseable date must surface in staleReviews; got ${JSON.stringify(r.staleReviews)}`);
});
