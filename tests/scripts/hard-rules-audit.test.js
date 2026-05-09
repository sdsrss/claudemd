import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { hardRulesAudit } from '../../scripts/hard-rules-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

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
  // Self-enforced rules: hits is null (we have no signal vs zero firings).
  const ironLaw2 = r.rules.find(rl => rl.id === '§iron-law-2');
  assert.equal(ironLaw2.hits, null, 'self-enforced rules must surface hits=null');
});

test('demoteCandidates list hook-rules with zero hits', async () => {
  // Empty log under tmp HOME — no rule fires in window.
  const r = await hardRulesAudit({ days: 30, pluginRoot: REPO_ROOT });
  // §8-rm-rf-var is enforcement="hook" — should appear as candidate when log is empty.
  assert.ok(r.demoteCandidates.includes('§8-rm-rf-var'),
    'empty log must surface §8-rm-rf-var as demote candidate');
  // §iron-law-2 is enforcement="self" — must NOT appear (would be false signal).
  assert.ok(!r.demoteCandidates.includes('§iron-law-2'),
    'self-enforced rules must NOT be demote candidates');
});
