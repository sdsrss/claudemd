// v0.9.31 — Static-analysis audit of claudemd hooks vs spec §8 SAFETY claims.
// Locked to real production hooks per feedback_test_fixture_format_drift.md
// (byte-exact assertions catch hook-rename / claim-text drift in one shot).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSafetyCoverage } from '../../scripts/safety-coverage-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

test('audit runs on real hooks and returns structured report', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  assert.ok(r.spec_version.startsWith('v6.'), `spec_version sanity: ${r.spec_version}`);
  assert.ok(r.summary.hooksAudited >= 10, `expected ≥10 hooks audited, got ${r.summary.hooksAudited}`);
  assert.ok(Array.isArray(r.claimSites));
  assert.ok(Array.isArray(r.ruleEnforcement));
});

test('§8-npx rule is implemented in pre-bash-safety-check.sh', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const npxRule = r.ruleEnforcement.find(x => x.id === '§8-npx');
  assert.ok(npxRule, 'expected §8-npx in ruleEnforcement');
  assert.equal(npxRule.status, 'implemented');
  assert.ok(
    npxRule.implementingHooks.some(h => h.endsWith('pre-bash-safety-check.sh')),
    `pre-bash-safety-check.sh should implement §8-npx; got: ${JSON.stringify(npxRule.implementingHooks)}`
  );
});

test('§8-rm-rf-var rule is implemented in pre-bash-safety-check.sh', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const rmRule = r.ruleEnforcement.find(x => x.id === '§8-rm-rf-var');
  assert.ok(rmRule, 'expected §8-rm-rf-var in ruleEnforcement');
  assert.equal(rmRule.status, 'implemented');
});

test('§8.V4-sandbox-disposal rule is implemented in sandbox-disposal-check.sh', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const v4 = r.ruleEnforcement.find(x => x.id === '§8.V4-sandbox-disposal');
  assert.ok(v4, 'expected §8.V4-sandbox-disposal in ruleEnforcement');
  assert.equal(v4.status, 'implemented');
  assert.ok(
    v4.implementingHooks.some(h => h.endsWith('sandbox-disposal-check.sh')),
    `sandbox-disposal-check.sh should implement §8.V4; got: ${JSON.stringify(v4.implementingHooks)}`
  );
});

test('§7-user-global-state rule is implemented in residue-audit.sh', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const ug = r.ruleEnforcement.find(x => x.id === '§7-user-global-state');
  assert.ok(ug, 'expected §7-user-global-state in ruleEnforcement');
  assert.equal(ug.status, 'implemented');
  assert.ok(
    ug.implementingHooks.some(h => h.endsWith('residue-audit.sh')),
    `residue-audit.sh should implement §7-user-global-state; got: ${JSON.stringify(ug.implementingHooks)}`
  );
});

test('multi-clause arrow claim in pre-bash-safety-check.sh is detected', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  // Post-v0.9.30: pre-bash-safety quotes "lockfile → local → pinned whitelist;
  // none → [AUTH REQUIRED]" in BOTH header (line ~8) and deny REASON_TEXT (~270).
  // The audit MUST find both — that's the v0.9.30 partial-impl signature.
  const preBash = r.claimSites.filter(s => s.hook.endsWith('pre-bash-safety-check.sh'));
  assert.ok(preBash.length >= 1,
    `expected ≥1 arrow-claim site in pre-bash-safety-check.sh, got ${preBash.length}`);
  const lockfileQuote = preBash.find(s => s.text.includes('lockfile') && s.text.includes('pinned'));
  assert.ok(lockfileQuote,
    `expected the NPX "lockfile → local → pinned" claim quote; sites: ${JSON.stringify(preBash.map(s => s.text.slice(0, 80)))}`);
  // Clause split must enumerate ≥3 distinct steps (lockfile, local, pinned).
  assert.ok(lockfileQuote.clauses.length >= 3,
    `expected ≥3 clauses in NPX claim, got ${lockfileQuote.clauses.length}: ${JSON.stringify(lockfileQuote.clauses)}`);
});

test('post-v0.9.30 NPX claim has its core clauses covered in code body', async () => {
  // Iron Law #2 evidence: this is the regression test for v0.9.30 — when the
  // NPX claim quoted lockfile/local/pinned but only the pinned arm had code,
  // 'lockfile' and 'node_modules' keywords would be absent from the code body.
  // After the fix, both must appear.
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const npxClaims = r.claimSites.filter(s =>
    s.hook.endsWith('pre-bash-safety-check.sh') && s.text.includes('lockfile')
  );
  assert.ok(npxClaims.length >= 1);
  for (const claim of npxClaims) {
    const lockfileClause = claim.clauseCoverage.find(cc =>
      cc.clause.toLowerCase().includes('lockfile')
    );
    assert.ok(lockfileClause, 'expected a lockfile clause in NPX claim');
    assert.equal(lockfileClause.coverage, 'covered',
      `lockfile clause must be covered post-v0.9.30 (keywords: ${JSON.stringify(lockfileClause.keywords)}, hits: ${JSON.stringify(lockfileClause.keywordHits)})`);
  }
});

test('rm-rf $VAR whitelist all four vars present in pre-bash-safety-check.sh', async () => {
  // Spec §8: rm -rf $VAR without validating VAR. Pre-bash-safety whitelists
  // $HOME/$PWD/$OLDPWD/$TMPDIR. Anchor check: every whitelist var must appear
  // in the hook's case statement, not just the comment.
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  const wl = r.specAnchorChecks.rmRfWhitelist;
  assert.ok(wl, 'expected specAnchorChecks.rmRfWhitelist');
  assert.equal(wl.status, 'covered',
    `rm-rf whitelist anchor check failed; missing: ${JSON.stringify(wl.missing)}`);
  // Byte-exact: all four vars present in case branch.
  for (const varName of ['HOME', 'PWD', 'OLDPWD', 'TMPDIR']) {
    assert.ok(wl.present.includes(varName),
      `expected ${varName} in case branch; present: ${JSON.stringify(wl.present)}`);
  }
});

test('audit exits 0 with current hooks (no partial-impl candidates)', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT });
  assert.equal(r.summary.partialCandidates, 0,
    `expected zero partial-impl candidates; got: ${JSON.stringify(r.summary.partialCandidateRefs, null, 2)}`);
  assert.equal(r.summary.unimplementedRules.length, 0,
    `expected all hook-enforced rules implemented; missing: ${JSON.stringify(r.summary.unimplementedRules)}`);
});

test('--hook filter restricts audit to single hook', async () => {
  const r = await auditSafetyCoverage({ pluginRoot: REPO_ROOT, hookFilter: 'sandbox-disposal-check.sh' });
  assert.equal(r.summary.hooksAudited, 1);
  for (const site of r.claimSites) {
    assert.ok(site.hook.endsWith('sandbox-disposal-check.sh'),
      `claim site outside filter: ${site.hook}`);
  }
});
