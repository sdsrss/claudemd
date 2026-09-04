import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor, isAdvisoryCheck } from '../../scripts/doctor.js';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';
import {
  cleanStateDir,
  readRetentionFromClaudeMd,
  DEFAULT_RETENTION_DAYS,
} from '../../scripts/clean-residue.js';

const DOCTOR_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/doctor.js');

// R11-27: HOME *and* every CLAUDEMD_*_DIR seam, from the one definition. This
// suite's own literal set HOME alone, so `stateDir()` landed in the sandbox only
// while the ambient environment happened not to export CLAUDEMD_STATE_DIR — and
// the state-dir tests below read that directory.
const box = useHomeSandbox('dr');

beforeEach(() => {
  fs.mkdirSync(box.claude('logs'), { recursive: true });
  fs.writeFileSync(
    box.claude('.claudemd-manifest.json'),
    JSON.stringify({
      version: '0.1.0',
      entries: [],
    })
  );
});

test('doctor returns checks array with at least 5 entries', async () => {
  const r = await doctor({});
  assert.ok(Array.isArray(r.checks));
  assert.ok(r.checks.length >= 5);
});

test('plugin cache staleness: flags pluginRoot older than marketplace (v0.36.0)', async () => {
  const staleRoot = path.join(box.home, 'cache/0.1.0');
  fs.mkdirSync(staleRoot, { recursive: true });
  fs.writeFileSync(path.join(staleRoot, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  const mkt = path.join(box.home, '.claude/plugins/marketplaces/claudemd');
  fs.mkdirSync(mkt, { recursive: true });
  fs.writeFileSync(path.join(mkt, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(
    path.join(box.home, '.claude/.claudemd-manifest.json'),
    JSON.stringify({
      version: '0.1.0',
      pluginRoot: staleRoot,
      entries: [],
    })
  );
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'plugin cache:staleness');
  assert.ok(c, 'staleness check must exist when pluginRoot + marketplace are comparable');
  assert.equal(c.ok, false);
  assert.match(c.detail, /stale registration/);
  assert.match(c.detail, /reload-plugins/);
});

test('plugin cache staleness: ok when pluginRoot is current vs marketplace (v0.36.0)', async () => {
  const root = path.join(box.home, 'cache/9.9.9');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const mkt = path.join(box.home, '.claude/plugins/marketplaces/claudemd');
  fs.mkdirSync(mkt, { recursive: true });
  fs.writeFileSync(path.join(mkt, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(
    path.join(box.home, '.claude/.claudemd-manifest.json'),
    JSON.stringify({
      version: '9.9.9',
      pluginRoot: root,
      entries: [],
    })
  );
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'plugin cache:staleness');
  assert.ok(c);
  assert.equal(c.ok, true);
  assert.match(c.detail, /current/);
});

test('plugin cache staleness: absent when marketplace has no comparable version (v0.36.0)', async () => {
  // beforeEach manifest has no pluginRoot; give it one but no marketplace dir.
  const root = path.join(box.home, 'cache/1.2.3');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(
    path.join(box.home, '.claude/.claudemd-manifest.json'),
    JSON.stringify({
      version: '1.2.3',
      pluginRoot: root,
      entries: [],
    })
  );
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'plugin cache:staleness');
  assert.equal(c, undefined, 'no staleness row when versions are not comparable');
});

test('doctor --prune-backups removes old backups', async () => {
  for (const iso of [
    '20260101T000000Z',
    '20260201T000000Z',
    '20260301T000000Z',
    '20260401T000000Z',
    '20260501T000000Z',
    '20260601T000000Z',
  ]) {
    fs.mkdirSync(path.join(box.home, `.claude/backup-${iso}`));
  }
  const r = await doctor({ pruneBackups: 3 });
  assert.equal(r.pruned.length, 3);
});

test('doctor CLI rejects --prune-backups=0 (F9)', () => {
  // Regression: --prune-backups=0 meant "retain zero", which deleted ALL
  // backups silently. Users reasonably read "0" as "prune zero of them".
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups=0'], {
    env: box.env(),
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'must exit non-zero on prune=0');
  assert.match(result.stderr, /positive integer/i);
});

test('doctor logs check reports size and warns above threshold (L5)', async () => {
  const logPath = path.join(box.home, '.claude/logs/claudemd.jsonl');
  // 6 MB of pseudo-entries — beyond the 5 MB warn threshold.
  const row = `{"ts":"2026-04-22T00:00:00Z","hook":"banned-vocab","event":"deny","extra":null}\n`;
  const rowsNeeded = Math.ceil((6 * 1024 * 1024) / row.length);
  fs.writeFileSync(logPath, row.repeat(rowsNeeded));
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.ok(logs, 'logs check must exist');
  assert.equal(logs.ok, false, 'must fail when log exceeds 5 MB threshold');
  assert.match(logs.detail, /MB/);
  assert.match(logs.detail, /truncate/i);
});

test('doctor logs check ok when small (L5)', async () => {
  const logPath = path.join(box.home, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(logPath, `{"ts":"2026-04-22T00:00:00Z","hook":"x","event":"pass","extra":null}\n`);
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.equal(logs.ok, true);
  assert.match(logs.detail, /1 rule-hits row/);
});

test('doctor runs banned-vocab self-test and reports pass when hook denies synthetic trigger', async () => {
  // Requires jq + bash on PATH; CI installs both. Skip assertion if absent.
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest, 'self-test check must exist');
  assert.equal(selftest.ok, true, `self-test must pass on a clean tree; detail="${selftest.detail}"`);
  assert.match(selftest.detail, /significantly/);
  // Clean env: no kill-switch note should appear.
  assert.doesNotMatch(selftest.detail, /kill-switch engaged/);
});

test('doctor OBS-2: all 12 advisory-hook liveness checks exist and pass on a clean tree', async () => {
  // Requires jq + bash; CI installs both. The deny self-tests cover only
  // banned-vocab + pre-bash-safety (2/16); these liveness checks close the
  // gap on the 6 Stop hooks + PostToolUse + the other advisory hooks that
  // never emit a deny. A hook dropped from the livenessTests list → find()
  // returns undefined → this test fails (coverage lock). session-start-check
  // + version-sync are intentionally excluded (bootstrap/network side-effects).
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const EXPECTED = [
    'memory-read-check',
    'ship-baseline-check',
    'session-extended-read',
    'transcript-vocab-scan',
    'session-end-check',
    'session-summary',
    'mem-audit',
    'residue-audit',
    'sandbox-disposal-check',
    'transcript-structure-scan',
    'memory-prompt-hint',
  ];
  const r = await doctor({});
  for (const h of EXPECTED) {
    const c = r.checks.find(x => x.name === `${h} liveness`);
    assert.ok(c, `liveness check for ${h} must exist`);
    assert.equal(c.ok, true, `${h} liveness must pass on a clean tree; detail="${c.detail}"`);
  }
});

test('doctor self-test detail notes kill-switch when user has disabled the hook via settings.json', async () => {
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  // Write a settings.json with the per-hook kill-switch engaged. The self-test
  // still runs against the hook CODE (with env cleared in spawn), but its
  // detail must call out that live enforcement is OFF for this user.
  fs.writeFileSync(
    path.join(box.home, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_BANNED_VOCAB_HOOK: '1' } })
  );
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest);
  assert.equal(selftest.ok, true, 'hook code still denies synthetic trigger regardless of kill-switch');
  assert.match(selftest.detail, /kill-switch engaged/);
  assert.match(selftest.detail, /will NOT fire in practice/);
});

test('doctor pre-bash-safety self-test:rm-rf-var passes when hook denies synthetic trigger (v0.19.1 A2)', async () => {
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'pre-bash-safety self-test:rm-rf-var');
  assert.ok(t, 'pre-bash-safety self-test:rm-rf-var check must exist');
  assert.equal(t.ok, true, `rm-rf-var self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /§8-rm-rf-var/);
  assert.match(t.detail, /UNSAFE_VAR/);
});

test('doctor pre-bash-safety self-test:npx-unpinned passes when hook denies synthetic trigger (v0.19.1 A2)', async () => {
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'pre-bash-safety self-test:npx-unpinned');
  assert.ok(t, 'pre-bash-safety self-test:npx-unpinned check must exist');
  assert.equal(t.ok, true, `npx-unpinned self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /§8-npx/);
  assert.match(t.detail, /unknown-pkg-x9z2/);
});

test('doctor runs banned-vocab self-test:prose-scan and passes when Path 2 denies synthetic transcript trigger (v0.21.1)', async () => {
  // Closes the gap between v0.21.0 ship and doctor coverage: Path 2 was test-
  // suite-only — the region-marker docstring-FP bug (silent 0-pattern scan)
  // would have shipped green through doctor. This selfTest stages a synthetic
  // transcript at HOME/.claude/projects/<encoded>/<sid>.jsonl with a §10-V
  // high-fire token, then drives the hook with `git push`. Must deny.
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'banned-vocab self-test:prose-scan');
  assert.ok(t, 'banned-vocab self-test:prose-scan check must exist');
  assert.equal(t.ok, true, `Path 2 self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /Path 2/);
  assert.match(t.detail, /significantly/);
});

test('doctor pre-bash-safety self-test detail notes per-hook kill-switch from settings.json (v0.19.1 A2)', async () => {
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  // Per-hook kill-switch (NOT global) — must still pass code-integrity check
  // while emitting the kill-switch note in detail. Verifies the matrix
  // implementation reads each hook's own ksEnvVar, not just the global one.
  fs.writeFileSync(
    path.join(box.home, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_PRE_BASH_SAFETY_HOOK: '1' } })
  );
  const r = await doctor({});
  const rmrf = r.checks.find(c => c.name === 'pre-bash-safety self-test:rm-rf-var');
  const npx = r.checks.find(c => c.name === 'pre-bash-safety self-test:npx-unpinned');
  const banned = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.equal(rmrf.ok, true);
  assert.match(rmrf.detail, /kill-switch engaged/);
  assert.equal(npx.ok, true);
  assert.match(npx.detail, /kill-switch engaged/);
  // banned-vocab uses DISABLE_BANNED_VOCAB_HOOK, which we did NOT set —
  // its detail must NOT carry the kill-switch note.
  assert.equal(banned.ok, true);
  assert.doesNotMatch(banned.detail, /kill-switch engaged/);
});

test('doctor self-test detail notes kill-switch when DISABLE_CLAUDEMD_HOOKS=1 in process env', async () => {
  const have = b => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const saved = process.env.DISABLE_CLAUDEMD_HOOKS;
  process.env.DISABLE_CLAUDEMD_HOOKS = '1';
  try {
    const r = await doctor({});
    const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
    assert.ok(selftest);
    assert.equal(selftest.ok, true);
    assert.match(selftest.detail, /kill-switch engaged/);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_CLAUDEMD_HOOKS;
    else process.env.DISABLE_CLAUDEMD_HOOKS = saved;
  }
});

test('D8: orphan manifest detected when manifest.pluginRoot path is absent', async () => {
  // User scenario: ran /plugin uninstall claudemd@claudemd without the
  // /claudemd-uninstall step. Plugin cache is gone; manifest survives with
  // a now-stale pluginRoot. doctor must flag this so the user knows what to clean up.
  const ghostPluginRoot = path.join(box.home, 'plugins/cache/claudemd/claudemd/9.9.9-removed');
  fs.writeFileSync(
    path.join(box.home, '.claude/.claudemd-manifest.json'),
    JSON.stringify({
      version: '9.9.9-removed',
      installedAt: new Date().toISOString(),
      pluginRoot: ghostPluginRoot,
      entries: [],
    })
  );
  const r = await doctor({});
  const pc = r.checks.find(c => c.name === 'plugin cache');
  assert.ok(pc, 'plugin cache check must exist');
  assert.equal(pc.ok, false, 'must report fail when pluginRoot is absent');
  assert.match(pc.detail, /orphan manifest/);
  assert.match(pc.detail, /claudemd-uninstall/);
});

test('doctor surfaces spec-hash drift when installed differs from shipped (v0.6.0)', async () => {
  // Write installed spec content that cannot match the real shipped spec —
  // proves drift is detected, not silently green.
  fs.writeFileSync(path.join(box.home, '.claude/CLAUDE.md'), 'fake spec body\n');
  const r = await doctor({});
  const main = r.checks.find(c => c.name === 'spec-hash:CLAUDE.md');
  assert.ok(main, 'spec-hash:CLAUDE.md check must exist');
  assert.equal(main.ok, false);
  assert.match(main.detail, /≠ shipped/);
  assert.match(main.detail, /claudemd-update/);
});

test('doctor reports spec-hash:* missing when installed spec absent (v0.6.0)', async () => {
  // Default beforeEach does NOT write a CLAUDE.md to ~/.claude — so the
  // "installed missing" branch fires. This is the fresh-install state
  // before /plugin install runs the postInstall hook.
  const r = await doctor({});
  const main = r.checks.find(c => c.name === 'spec-hash:CLAUDE.md');
  assert.ok(main);
  assert.equal(main.ok, false);
  assert.match(main.detail, /installed spec missing/);
});

test('hook-drift check skips when no marketplace install exists (v0.9.22)', async () => {
  // beforeEach gives a clean ~/.claude with no plugins/marketplaces/claudemd.
  // The drift check must not fail-loudly for fresh-install / npm-CLI-only
  // users — skip with reason.
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'hook-drift');
  assert.ok(c, 'hook-drift check must exist');
  assert.equal(c.ok, true);
  assert.match(c.detail, /skipped/);
  assert.match(c.detail, /market-root-missing/);
});

test('hook-drift flags differing hooks when marketplace install lags source (v0.9.22)', async () => {
  // Reproduces the v0.9.15 install-drift scenario: source ships
  // tr '/._' '-' but marketplaces/claudemd/hooks/lib/rule-hits.sh still
  // has the pre-fix tr '/.' '-'. doctor must surface it, not green-rubberstamp.
  const sourceHooks = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../hooks');
  const mktRoot = path.join(box.home, '.claude/plugins/marketplaces/claudemd');
  // Mirror source hooks/ into market so missing-in-market doesn't dominate.
  fs.cpSync(sourceHooks, path.join(mktRoot, 'hooks'), { recursive: true });
  // Then break ONE file (the canonical drift target) to simulate the real
  // v0.9.15 silent fix that didn't propagate to the marketplace install.
  fs.writeFileSync(
    path.join(mktRoot, 'hooks/lib/rule-hits.sh'),
    '#!/usr/bin/env bash\n# stale (pre-v0.9.15)\nrule_hits_append() { :; }\n'
  );

  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'hook-drift');
  assert.ok(c);
  assert.equal(c.ok, false, 'must flag drift');
  assert.match(c.detail, /hooks\/lib\/rule-hits\.sh \(differs\)/);
  assert.match(c.detail, /uninstall claudemd@claudemd/);
});

test('R-N6: rule-usage flags §0.1 demotion candidate when bypass:deny ratio > 50%', async () => {
  // 6 events on §11-memory-read: 5 bypasses + 1 deny = 83% override rate.
  // Doctor must flag this as a demotion candidate (rule too strict / wording
  // confuses, users routinely escape-hatch).
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":{"missing":["x.md"]}}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§11-memory-read');
  assert.ok(usage, 'rule-usage:§11-memory-read check must exist');
  assert.equal(usage.ok, false, 'must fail (demotion candidate) when bypass:deny > 50%');
  assert.match(usage.detail, /demotion candidate/);
  assert.match(usage.detail, /deny=1/);
  assert.match(usage.detail, /bypass=5/);
  assert.match(usage.detail, /83%/);
});

test('v0.23.11: rule-usage counts the deny FAMILY (deny-repeat) — no false demote flag', async () => {
  // §11-memory-read emits `deny-repeat` for re-denies. 1 deny + 2 deny-repeat
  // = 3 real blocks vs 2 bypasses → true ratio 40% (healthy). Pre-fix doctor
  // counted only literal `deny` (=1) → ratio 67% → FALSE demote candidate.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":null}\n`,
    `{"ts":"${now}","hook":"memory-read-check","event":"deny-repeat","spec_section":"§11-memory-read","extra":null}\n`.repeat(
      2
    ),
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(
      2
    ),
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§11-memory-read');
  assert.ok(usage);
  assert.equal(usage.ok, true, 'deny-family count must keep this healthy');
  assert.match(usage.detail, /deny=3/);
  assert.match(usage.detail, /healthy/);
});

test('R-N6: rule-usage marks healthy when bypass:deny ratio ≤ 50%', async () => {
  // 5 denies + 1 bypass = 17% override rate — below threshold, healthy.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","spec_section":"§10-V","extra":{"token":"allow-banned-vocab"}}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§10-V');
  assert.ok(usage);
  assert.equal(usage.ok, true);
  assert.match(usage.detail, /healthy/);
  assert.match(usage.detail, /17%/);
});

test('R-N6: rule-usage skips sections below statistical floor (< 3 events)', async () => {
  // Single deny on §10-V — too few to draw a ratio conclusion. No check emitted.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(
    log,
    `{"ts":"${new Date().toISOString()}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["robust"]}}\n`
  );
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§10-V');
  assert.equal(usage, undefined, 'no rule-usage check should fire below RULE_USAGE_MIN_TOTAL=3');
});

test('R-N6+: demotion-candidate detail names the dominant bypass token (single token)', async () => {
  // 5 bypasses, all via [skip-memory-check], 1 deny — single-token
  // 80% override means the rule is being defeated through one specific
  // escape hatch. Operator should see the token name in the detail line,
  // not have to cross-reference /claudemd-audit byBypass.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":{"missing":["x.md"]}}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§11-memory-read');
  assert.ok(usage);
  assert.equal(usage.ok, false);
  assert.match(usage.detail, /\[skip-memory-check\]×5/, 'detail must surface bypass token + count');
});

test('R-N6+: demotion-candidate detail sorts mixed tokens by count desc', async () => {
  // §11-memory-read (a demotable, non-immutable section): 3× skip-memory-check
  // + 1× force-skip + 1 deny. ratio 80%, two tokens, output must list them
  // sorted by count desc: [skip-memory-check]×3, [force-skip]×1.
  // (§8 sections are immutable-exempt — see the dedicated test below.)
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(
      3
    ),
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"force-skip"}}\n`,
    `{"ts":"${now}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§11-memory-read');
  assert.ok(usage);
  assert.equal(usage.ok, false);
  // Sort order: count desc → [skip-memory-check]×3 must appear BEFORE
  // [force-skip]×1 in the detail string.
  const idxHi = usage.detail.indexOf('[skip-memory-check]×3');
  const idxLo = usage.detail.indexOf('[force-skip]×1');
  assert.ok(idxHi > -1 && idxLo > -1, `both tokens must appear; detail="${usage.detail}"`);
  assert.ok(idxHi < idxLo, 'higher-count token must come first');
});

test('v0.23.6: rule-usage never flags an immutable §8 section as a demotion candidate', async () => {
  // §8 SAFETY is §5.1 Never-downgrade. An 83%-bypass ratio (5 bypass + 1 deny,
  // above the 50% demote threshold) must surface for visibility but NOT carry
  // the "§0.1 demotion candidate"
  // label — that would recommend an action the policy forbids.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-npx","extra":{"token":"allow-npx-unpinned"}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"pre-bash-safety","event":"deny","spec_section":"§8-npx","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§8-npx');
  assert.ok(usage, 'rule-usage:§8-npx check must exist (visibility preserved)');
  assert.equal(usage.ok, true, 'immutable §8 must not fail as a demotion candidate');
  assert.doesNotMatch(usage.detail, /demotion candidate/, 'must not label immutable §8 a demotion candidate');
  assert.match(usage.detail, /immutable §8 SAFETY/);
});

test('v0.23.6: hook-fail-open — bad-event fail-open is advisory (ok:true)', async () => {
  // Row shape matches real hook output: hook_record_failopen never threads
  // session_id, so the row is session_id:null. reason=bad-event = empty stdin
  // (`echo "" | hook`, fail-open.test.sh leak) — impossible on a live
  // PreToolUse pipe → advisory, must NOT false-flag a healthy install.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows =
    `{"ts":"${now}","hook":"banned-vocab","event":"fail-open","spec_section":"§hooks-fail-open","extra":{"reason":"bad-event"},"session_id":null}\n`.repeat(
      2
    );
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'hook-fail-open');
  assert.ok(c, 'hook-fail-open check must exist');
  assert.equal(c.ok, true, 'bad-event fail-open must be advisory, not ok:false');
  assert.match(c.detail, /bad-event/);
});

test('v0.23.6: hook-fail-open — patterns-missing fail-open flags a live bypass (ok:false)', async () => {
  // Row shape matches real hook output (session_id:null — hook_record_failopen
  // does not thread it; verified by running banned-vocab-check.sh with an
  // unreadable patterns file). reason=patterns-missing / jq-missing is a
  // genuine live-env failure that disables enforcement → ok:false. Gating on
  // reason (not session_id) is what makes this branch reachable in production.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = `{"ts":"${now}","hook":"banned-vocab","event":"fail-open","spec_section":"§hooks-fail-open","extra":{"reason":"patterns-missing"},"session_id":null}\n`;
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'hook-fail-open');
  assert.ok(c, 'hook-fail-open check must exist');
  assert.equal(c.ok, false, 'live-env fail-open must flag a bypass regardless of null session_id');
  assert.match(c.detail, /patterns-missing/);
});

test('R-N6+: healthy rows stay terse — no token detail attached', async () => {
  // Healthy section: detail must NOT include token breakdown. Per-token
  // forensics are only useful when the rule is being defeated.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","spec_section":"§10-V","extra":{"token":"allow-banned-vocab"}}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§10-V');
  assert.equal(usage.ok, true);
  assert.match(usage.detail, /healthy/);
  assert.doesNotMatch(usage.detail, /\[allow-banned-vocab\]/, 'healthy detail must not carry token detail');
});

test('R-N6: rule-usage skips (unset) bucket carrying pre-v0.7.0 rows', async () => {
  // Legacy rows (no spec_section) accumulate under (unset). Demoting on
  // these would misattribute pre-upgrade behavior to current rule design.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","extra":{"token":"allow-banned-vocab"}}\n`.repeat(
      5
    ),
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const unset = r.checks.find(c => c.name === 'rule-usage:(unset)');
  assert.equal(unset, undefined, '(unset) bucket must not generate a rule-usage check');
});

test('rule-usage excludes test-session/probe rows (parity with audit.js)', async () => {
  // Bug (2026-07-03 audit F1): doctor computed rule-usage from UNFILTERED
  // hits, so manual-probe / sentinel-session rows (session_id ≤7 chars — the
  // excludeTestSessions cohort, e.g. v0.23.20's 8 session_id='s' ship-baseline
  // fixtures) inflated deny counts. audit.js filters via excludeTestSessions;
  // doctor did not → same 30d window showed doctor ship-baseline deny=17 vs
  // audit deny=9. §0.1 demote verdicts are downstream of this count, so they
  // must count REAL sessions only.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const realUuid = '11111111-2222-3333-4444-555555555555'; // 36-char real session
  const rows = [
    // 3 real denies (kept)
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","spec_section":"§7-ship-baseline","session_id":"${realUuid}","extra":null}\n`.repeat(
      3
    ),
    // 5 sentinel denies (session_id='s' — manual probe, must be excluded)
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","spec_section":"§7-ship-baseline","session_id":"s","extra":null}\n`.repeat(
      5
    ),
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§7-ship-baseline');
  assert.ok(usage, 'rule-usage:§7-ship-baseline check must exist');
  // Pre-fix: deny=8 (3 real + 5 sentinel). Post-fix: deny=3 (real only).
  assert.match(usage.detail, /deny=3\b/, `sentinel-session rows must be excluded; detail="${usage.detail}"`);
  assert.doesNotMatch(usage.detail, /deny=8/, 'must not count sentinel-session rows');
});

test('rule-usage demote token breakdown also excludes sentinel bypasses', async () => {
  // The demote-candidate token breakdown iterates the hit list a SECOND time
  // (parallel consumer of the same data). It must filter sentinels identically
  // to the count, else "bypass=N" and the [token]×k breakdown disagree.
  const log = path.join(box.home, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const realUuid = '11111111-2222-3333-4444-555555555555';
  const rows = [
    // Real: 3 bypass via skip-memory-check + 1 deny → 75% override (demote candidate)
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","session_id":"${realUuid}","extra":{"token":"skip-memory-check"}}\n`.repeat(
      3
    ),
    `{"ts":"${now}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","session_id":"${realUuid}","extra":null}\n`,
    // Sentinel: 4 bypass via force-skip (manual probe) — must NOT appear anywhere
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","session_id":"probe","extra":{"token":"force-skip"}}\n`.repeat(
      4
    ),
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const usage = r.checks.find(c => c.name === 'rule-usage:§11-memory-read');
  assert.ok(usage);
  assert.equal(usage.ok, false, 'real-only 3 bypass / 1 deny = 75% → demote candidate');
  assert.match(usage.detail, /bypass=3\b/, 'count must exclude sentinel bypasses');
  assert.match(usage.detail, /\[skip-memory-check\]×3/, 'real bypass token present');
  assert.doesNotMatch(usage.detail, /force-skip/, 'sentinel-session token must not appear in breakdown');
});

test('doctor CLI rejects space-form --prune-backups 5 (was silent default)', () => {
  // v0.9.16 antipattern recurrence: pre-fix, space-form was silently dropped,
  // doctor ran without prune, exited 0 — same family as audit.js / sparkline.js
  // / clean-residue.js fixes shipped in v0.9.16.
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups', '5'], {
    env: box.env(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, `expected exit 2, stderr: ${result.stderr}`);
  assert.match(result.stderr, /requires '=value' form/);
});

test('doctor CLI rejects unknown flag (was silent ignore)', () => {
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--bogus=1'], {
    env: box.env(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag.*--bogus/);
});

test('D8: plugin cache check passes when manifest.pluginRoot exists', async () => {
  const realPluginRoot = path.join(box.home, 'plugins/cache/claudemd/claudemd/0.5.4');
  fs.mkdirSync(realPluginRoot, { recursive: true });
  fs.writeFileSync(
    path.join(box.home, '.claude/.claudemd-manifest.json'),
    JSON.stringify({
      version: '0.5.4',
      installedAt: new Date().toISOString(),
      pluginRoot: realPluginRoot,
      entries: [],
    })
  );
  const r = await doctor({});
  const pc = r.checks.find(c => c.name === 'plugin cache');
  assert.ok(pc);
  assert.equal(pc.ok, true);
  assert.match(pc.detail, /present at/);
});

test('spec-cache-drift flags installed vs marketplace-shipped fork (2026-08-16 audit F3)', async () => {
  // The v0.66.0 incident shape: a post-tag edit left installed ~/.claude spec
  // differing from the marketplace clone at the SAME version. The SessionStart
  // banner fired 713 times over 4 days while doctor — whose axis 1 self-compares
  // source vs installed when run from the repo — exited 0. This axis mirrors
  // what hook-drift has done for hooks/ since v0.9.22.
  fs.writeFileSync(path.join(box.home, '.claude/CLAUDE-extended.md'), 'installed body\n');
  const mktSpec = path.join(box.home, '.claude/plugins/marketplaces/claudemd/spec');
  fs.mkdirSync(mktSpec, { recursive: true });
  fs.writeFileSync(path.join(mktSpec, 'CLAUDE-extended.md'), 'cache body\n');
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'spec-cache-drift');
  assert.ok(c, 'spec-cache-drift check must exist');
  assert.equal(c.ok, false, 'same-version content fork must be flagged');
  assert.match(c.detail, /CLAUDE-extended\.md/);
  assert.match(c.detail, /version bump|claudemd-update/);
});

test('spec-cache-drift skips when no marketplace install exists (2026-08-16 audit F3)', async () => {
  // npm-CLI-only / fresh-install users have no marketplace clone — the check
  // must skip with a reason, mirroring hook-drift's skip contract.
  const r = await doctor({});
  const c = r.checks.find(x => x.name === 'spec-cache-drift');
  assert.ok(c, 'spec-cache-drift check must exist');
  assert.equal(c.ok, true);
  assert.match(c.detail, /skipped/);
  assert.match(c.detail, /market-root-missing/);
});

// --- 0.68.3: what is in ~/.claude must not stop doctor from running ---------
//
// Two separate defects met on this input. (1) `dirSize` statSync'd every entry
// of every backup dir unguarded, so one dangling symlink threw ENOENT out of
// listBackups — and rename(2) on a symlink moves the LINK, so a user who
// symlinks ~/.claude/CLAUDE.md into a dotfiles repo gets exactly that. (2)
// `doctor(...).then(...)` had no `.catch()`, so the throw surfaced as an
// unhandled rejection: a stack, no check lines, and — worse — exit 0, i.e. a
// health check reporting success while doing nothing. Both are fixed; the
// symlink is now handled rather than caught, and the handler is the backstop.

test('0.68.3: a dangling symlink in a backup dir does not stop the run', () => {
  const bk = path.join(box.home, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.symlinkSync(path.join(box.home, '.claude/gone-forever'), path.join(bk, 'dangling'));

  const r = spawnSync(process.execPath, [DOCTOR_JS], {
    env: box.env(),
    encoding: 'utf8',
  });

  assert.ok(
    !/UnhandledPromiseRejection/.test(r.stderr),
    `must not exit via unhandled rejection; stderr=${r.stderr}`
  );
  assert.match(r.stdout, /"checks"/, 'checks must still be printed');
  assert.match(r.stdout, /"backups"/, 'the backup inventory itself must still report');
});

test('0.68.3: a throw inside doctor() is named, not a bare stack, and is not exit 0', () => {
  // A directory where the rule-hits log should be: existsSync and statSync both
  // succeed, readFileSync throws EISDIR. Chosen because it exercises the
  // handler through real code rather than an injected throw.
  fs.mkdirSync(path.join(box.home, '.claude/logs/claudemd.jsonl'), { recursive: true });

  const r = spawnSync(process.execPath, [DOCTOR_JS], {
    env: box.env(),
    encoding: 'utf8',
  });

  assert.ok(
    !/UnhandledPromiseRejection/.test(r.stderr),
    `must not exit via unhandled rejection; stderr=${r.stderr}`
  );
  assert.match(r.stderr, /\[claudemd\] doctor failed:/, `expected a named failure line; stderr=${r.stderr}`);
  assert.notEqual(r.status, 0, 'a run that failed must not report success — pre-fix this exited 0');
});

test('R10-03: --prune-backups leaves the legacy dirs the same run reports', async () => {
  // The `backup-namespace-legacy` check says these are "not moved
  // automatically — the choice is the user's"; pre-fix the destructive flag in
  // the SAME run deleted the genuine personal backup and kept the spec-shaped
  // dirs, because on a pre-0.68.3 layout the legacy dirs are the newest ones.
  const SPEC = '# AI-CODING-SPEC v6.25.2 — Core\n';
  const personal = path.join(box.home, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(personal, 'CLAUDE.md'), '# My personal global instructions\n');
  const legacyDirs = ['20260201T000000Z', '20260301T000000Z'].map(s => {
    const d = path.join(box.home, `.claude/backup-${s}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), SPEC);
    return d;
  });

  const r = await doctor({ pruneBackups: 1 });

  assert.ok(fs.existsSync(path.join(personal, 'CLAUDE.md')), 'genuine personal backup survives the prune');
  for (const d of legacyDirs) assert.ok(fs.existsSync(d), 'legacy dir left for the user');
  assert.deepEqual(r.pruned, []);
  // One caliber: what the report named is exactly what the prune skipped.
  const check = r.checks.find(c => c.name === 'backup-namespace-legacy');
  assert.equal(check.ok, false);
  assert.equal(r.pruneSkippedLegacy.length, legacyDirs.length);
  for (const d of legacyDirs) assert.ok(r.pruneSkippedLegacy.includes(d));
});

test('R10-03: pruneSkippedLegacy is empty when the flag is not passed', async () => {
  const d = path.join(box.home, '.claude/backup-20260201T000000Z');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');
  const r = await doctor({});
  assert.deepEqual(r.pruneSkippedLegacy, [], 'nothing was pruned, so nothing was skipped');
  assert.ok(fs.existsSync(d));
});

// --- routing:skills-enabled (2026-09-01) -----------------------------------
// §4 routes work at named skills; skillOverrides can switch any of them off; for
// seven weeks nothing related the two, and eight primaries sat unreachable. The
// three cases below are the three answers the check can give, because "ok when
// clean" and "not ok when dirty" together still permit a check that reports a
// clean routing surface having parsed no table at all.
const stageExtSpec = (overrides, specText) => {
  fs.writeFileSync(
    path.join(box.home, '.claude/CLAUDE-extended.md'),
    specText ?? fs.readFileSync('spec/CLAUDE-extended.md', 'utf8')
  );
  fs.writeFileSync(
    path.join(box.home, '.claude/settings.json'),
    JSON.stringify({ skillOverrides: overrides })
  );
};
const routingCheck = r => r.checks.find(x => x.name === 'routing:skills-enabled');

test('routing:skills-enabled passes when no §4 primary is disabled', async () => {
  stageExtSpec({ 'some-unrelated-skill': 'off' });
  const c = routingCheck(await doctor({}));
  assert.ok(c, 'the check must run once an installed extended spec and settings.json exist');
  assert.equal(c.ok, true, c.detail);
  assert.match(c.detail, /all \d+ §4 Routing primaries are enabled/);
});

test('routing:skills-enabled names the §4 primaries that are off', async () => {
  // `investigate` is a §4 primary in every spec version this repo has shipped
  // (`gs:/investigate` on the env/staging/deploy row), which is what makes it a
  // safe fixture: the assertion below fails loudly if §4 is ever rewritten
  // around it rather than passing on a skill that quietly left the table.
  stageExtSpec({ investigate: 'off' });
  const c = routingCheck(await doctor({}));
  assert.equal(c.ok, false);
  assert.match(c.detail, /gs\/investigate/);
  assert.match(c.detail, /skillOverrides/);
});

test('routing:skills-enabled is advisory — it must not drive the exit code', () => {
  // The check's steady state is non-zero by adjudication (spec v6.25.4: §4 keeps
  // naming skills an operator may have switched off, and §12 is the degradation
  // path). Shipped outside the ADVISORY set it would have made
  // `/claudemd-doctor` exit 3 forever on any machine that disabled a routed
  // skill, in the same release whose CHANGELOG calls the check advisory —
  // caught by the pre-tag review of 0.71.1.
  //
  // Asserts the exported predicate the CLI exit-code branch actually calls, not
  // the comment above it. The negative arm is what makes that meaningful: a
  // predicate that returned true for everything would satisfy the first line
  // alone and silence the exit code entirely.
  assert.equal(isAdvisoryCheck('routing:skills-enabled'), true);
  assert.equal(isAdvisoryCheck('hook-fail-open'), false);
  assert.equal(isAdvisoryCheck('settings.json'), false);
});

test('routing:skills-enabled refuses to pass when §4 resolved too few primaries', async () => {
  // The floor. A spec whose §4 table moved or got truncated resolves nothing,
  // finds nothing disabled, and would otherwise report a clean routing surface
  // over zero skills — the empty-set pass this repo closes everywhere else.
  stageExtSpec({}, '# AI-CODING-SPEC — Extended\n\nNo routing table here.\n');
  const c = routingCheck(await doctor({}));
  assert.equal(c.ok, false);
  assert.match(c.detail, /resolved only 0 §4 Routing primary/);
});

// --- state-dir-orphans: the threshold judges the REAPABLE subset -------------
//
// v0.74.2. Measured on the maintainer's machine 2026-09-04: 189 ephemeral state
// files, 0 of them past the retention window. The check was red and told the
// operator to run `/claudemd-clean-residue --apply`, which would have deleted
// nothing — a permanently-red advisory whose own remedy is a no-op, which is
// how a health checker teaches people to ignore it. Three of the eight
// ephemeral kinds are written once per session and are SUPPOSED to sit there
// for the whole window, so the total is session-rate x window and crossing a
// fixed line says nothing about hygiene.
const stateCheck = r => r.checks.find(c => c.name === 'state-dir-orphans');

function seedState(n, { kind = 'session-ref', ageDays = 0 } = {}) {
  const spell = {
    'session-ref': i => `session-start-s${i}.ref`,
    'session-summary': i => `session-summary-s${i}.lastrun`,
    'ext-read': i => `ext-read-s${i}.ts`,
  }[kind];
  const when = new Date(Date.now() - ageDays * 86400000);
  for (let i = 0; i < n; i++) {
    const f = path.join(box.stateDir, spell(i));
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, when, when);
  }
}

test('state-dir-orphans stays green on a large population that is entirely inside the window', async () => {
  // The regression, in the shape that produced it: well past the 50-file line,
  // nothing reapable. Pre-fix this was ok:false.
  seedState(40, { kind: 'session-ref', ageDays: 0 });
  seedState(40, { kind: 'session-summary', ageDays: 3 });
  const c = stateCheck(await doctor({}));
  assert.equal(c.ok, true, `80 in-window files must not fire the advisory: ${c.detail}`);
  // Cardinality on the GREEN path too: "clean" and "nothing was decidable" must
  // not print the same sentence.
  assert.match(c.detail, /0 reapable of 80 ephemeral state file/);
  assert.match(c.detail, /session-ref=40/);
});

test('state-dir-orphans fires when the reapable subset itself exceeds the threshold', async () => {
  // The control the fix has to keep alive: past-window files still turn it red,
  // and the count it names is the count --apply would delete.
  seedState(51, { kind: 'ext-read', ageDays: 30 });
  seedState(10, { kind: 'session-ref', ageDays: 0 });
  const c = stateCheck(await doctor({}));
  assert.equal(c.ok, false, `51 files past the window must fire: ${c.detail}`);
  assert.match(c.detail, /51 reapable of 61 ephemeral state file/);
  assert.match(c.detail, /delete exactly those 51/);
  assert.match(c.detail, /ext-read=51/);
});

test('state-dir-orphans reports the same subset clean-residue would delete', async () => {
  // Not "a number that looks right" — the same population, from the same
  // function, so the advisory and its remedy cannot drift apart again.
  seedState(4, { kind: 'ext-read', ageDays: 30 });
  seedState(9, { kind: 'session-ref', ageDays: 1 });
  const c = stateCheck(await doctor({}));
  // The oracle resolves the window the way doctor does. It used to take
  // cleanStateDir's hardcoded default while doctor read the REPO's CLAUDE.md —
  // a config file outside everything this sandbox redirects — so adding
  // `TMP_RETENTION_DAYS: 30` to the repo made this case fail with a message
  // about reapable counts and no hint of the cause (pre-tag review, NOTE 5).
  const dry = cleanStateDir({
    stateDir: box.stateDir,
    retentionDays: readRetentionFromClaudeMd() ?? DEFAULT_RETENTION_DAYS,
  });
  assert.equal(dry.targets.length, 4);
  assert.equal(dry.scanned.length, 13);
  assert.match(c.detail, new RegExp(`${dry.targets.length} reapable of ${dry.scanned.length} `));
  assert.match(c.detail, new RegExp(`past the ${dry.retentionDays}-day window`));
});

test('state-dir-orphans still fails on an unbounded total, with a remedy that is not --apply', async () => {
  // The regression the pre-tag review caught: moving the threshold onto the
  // reapable subset left NO value of the total that could fail, and a runaway
  // writer (a session_id that changes per invocation) produces exactly that —
  // every file fresh, nothing ever reapable, the directory growing forever
  // behind a green check. Verified there at 5,000 files reporting ok=true.
  seedState(1001, { kind: 'session-ref', ageDays: 0 });
  const c = stateCheck(await doctor({}));
  assert.equal(c.ok, false, `1001 fresh files must fail the ceiling: ${c.detail}`);
  assert.match(c.detail, /0 reapable of 1001 /);
  assert.match(c.detail, /1000-file ceiling/);
  // The remedy must differ from the reapable branch's. Printing a red line
  // whose fix does nothing is the defect this whole release removes; it must
  // not come back one branch over.
  assert.match(c.detail, /--apply will NOT help/);
  assert.match(c.detail, /per INVOCATION/);
});

test('state-dir-orphans: the ceiling does not fire just below it', async () => {
  // Boundary control. Without it the ceiling could be off by any amount, or
  // firing on every population, and the test above would not notice.
  seedState(999, { kind: 'session-ref', ageDays: 0 });
  const c = stateCheck(await doctor({}));
  assert.equal(c.ok, true, `999 files are under the ceiling: ${c.detail}`);
  assert.match(c.detail, /0 reapable of 999 /);
});

// --- memory-index-size: judged against the budget the index declares --------
//
// v0.74.2. The 12KB default is one number applied to every project on the
// machine. Where the operator has judged an overage acceptable — this repo's
// own index is the spec's accumulated rule set — the check was red forever with
// a remedy that had already been declined, which is the same "permanently red,
// nothing to do" shape as state-dir-orphans above.
const indexCheck = r => r.checks.find(c => c.name === 'memory-index-size');

function seedIndex(slug, body) {
  const dir = box.claude('projects', slug, 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), body);
}
// Comfortably past the 12KB default.
const FAT_INDEX = `- [Fat](project_fat.md) \`[fat-tag]\` — ${'y'.repeat(20 * 1024)}\n`;

test('memory-index-size: an over-default index with no declaration still fails', async () => {
  // The control for the two below: without it, a check that passed everything
  // would satisfy them both.
  seedIndex('-proj-plain', FAT_INDEX);
  const c = indexCheck(await doctor({}));
  assert.equal(c.ok, false, c.detail);
  assert.match(c.detail, /1\/1 MEMORY\.md file\(s\) exceed their budget/);
  assert.match(c.detail, /index-budget: NNKB/, 'the remedy must name the declaration syntax');
});

test('memory-index-size: a declared budget passes and is named in the line it greens', async () => {
  seedIndex('-proj-declared', `<!-- index-budget: 64KB -->\n${FAT_INDEX}`);
  const c = indexCheck(await doctor({}));
  assert.equal(c.ok, true, c.detail);
  // Visible, not silent: the raised number appears in the green line, so the
  // decision cannot hide behind a passing check.
  assert.match(c.detail, /declared budget 64KB/);
  assert.match(c.detail, /1 declare their own budget/);
});

test('memory-index-size: a malformed declaration fails instead of reverting silently', async () => {
  // A knob that is quietly ignored is worse than one that refuses
  // (lib/argv.js's flag-shape rule). `28` without a unit is the shape that
  // would otherwise be read as 28 bytes or 28KB depending on who guesses.
  seedIndex('-proj-broken', `<!-- index-budget: 28 -->\n${FAT_INDEX}`);
  const c = indexCheck(await doctor({}));
  assert.equal(c.ok, false, c.detail);
  assert.match(c.detail, /unusable index-budget declaration/);
  assert.match(c.detail, /malformed index-budget declaration '28'/);
});

test('memory-index-size: a malformed declaration does not hide a genuine overage', async () => {
  // These are two independent faults and both must be reported. An earlier
  // draft branched malformed-else-overBudget, so one typo anywhere on the
  // machine suppressed every real over-budget index in the same run — an
  // advisory withholding the finding the operator needed (pre-tag review).
  seedIndex('-proj-typo', `<!-- index-budget: 28 -->\n${FAT_INDEX}`);
  seedIndex('-proj-genuine', FAT_INDEX);
  const c = indexCheck(await doctor({}));
  assert.equal(c.ok, false, c.detail);
  assert.match(c.detail, /unusable index-budget declaration/);
  assert.match(c.detail, /-proj-typo/);
  // The half that used to vanish. 2/2, not 1/2: the typo'd file falls back to
  // the 12KB default and is over that too, which is the point of saying the
  // default "is in force for those files".
  assert.match(c.detail, /2\/2 MEMORY\.md file\(s\) exceed their budget/);
  assert.match(c.detail, /-proj-genuine/);
});
