import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../scripts/doctor.js';

const DOCTOR_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/doctor.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.1.0', entries: []
  }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('doctor returns checks array with at least 5 entries', async () => {
  const r = await doctor({});
  assert.ok(Array.isArray(r.checks));
  assert.ok(r.checks.length >= 5);
});

test('doctor --prune-backups removes old backups', async () => {
  for (const iso of ['20260101T000000Z','20260201T000000Z','20260301T000000Z',
                     '20260401T000000Z','20260501T000000Z','20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const r = await doctor({ pruneBackups: 3 });
  assert.equal(r.pruned.length, 3);
});

test('doctor CLI rejects --prune-backups=0 (F9)', () => {
  // Regression: --prune-backups=0 meant "retain zero", which deleted ALL
  // backups silently. Users reasonably read "0" as "prune zero of them".
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'must exit non-zero on prune=0');
  assert.match(result.stderr, /positive integer/i);
});

test('doctor logs check reports size and warns above threshold (L5)', async () => {
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
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
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(logPath, `{"ts":"2026-04-22T00:00:00Z","hook":"x","event":"pass","extra":null}\n`);
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.equal(logs.ok, true);
  assert.match(logs.detail, /1 rule-hits row/);
});

test('doctor runs banned-vocab self-test and reports pass when hook denies synthetic trigger', async () => {
  // Requires jq + bash on PATH; CI installs both. Skip assertion if absent.
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest, 'self-test check must exist');
  assert.equal(selftest.ok, true,
    `self-test must pass on a clean tree; detail="${selftest.detail}"`);
  assert.match(selftest.detail, /significantly/);
  // Clean env: no kill-switch note should appear.
  assert.doesNotMatch(selftest.detail, /kill-switch engaged/);
});

test('doctor self-test detail notes kill-switch when user has disabled the hook via settings.json', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  // Write a settings.json with the per-hook kill-switch engaged. The self-test
  // still runs against the hook CODE (with env cleared in spawn), but its
  // detail must call out that live enforcement is OFF for this user.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_BANNED_VOCAB_HOOK: '1' } }));
  const r = await doctor({});
  const selftest = r.checks.find(c => c.name === 'banned-vocab self-test');
  assert.ok(selftest);
  assert.equal(selftest.ok, true, 'hook code still denies synthetic trigger regardless of kill-switch');
  assert.match(selftest.detail, /kill-switch engaged/);
  assert.match(selftest.detail, /will NOT fire in practice/);
});

test('doctor pre-bash-safety self-test:rm-rf-var passes when hook denies synthetic trigger (v0.19.1 A2)', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'pre-bash-safety self-test:rm-rf-var');
  assert.ok(t, 'pre-bash-safety self-test:rm-rf-var check must exist');
  assert.equal(t.ok, true,
    `rm-rf-var self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /§8-rm-rf-var/);
  assert.match(t.detail, /UNSAFE_VAR/);
});

test('doctor pre-bash-safety self-test:npx-unpinned passes when hook denies synthetic trigger (v0.19.1 A2)', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'pre-bash-safety self-test:npx-unpinned');
  assert.ok(t, 'pre-bash-safety self-test:npx-unpinned check must exist');
  assert.equal(t.ok, true,
    `npx-unpinned self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /§8-npx/);
  assert.match(t.detail, /unknown-pkg-x9z2/);
});

test('doctor runs banned-vocab self-test:prose-scan and passes when Path 2 denies synthetic transcript trigger (v0.21.1)', async () => {
  // Closes the gap between v0.21.0 ship and doctor coverage: Path 2 was test-
  // suite-only — the region-marker docstring-FP bug (silent 0-pattern scan)
  // would have shipped green through doctor. This selfTest stages a synthetic
  // transcript at HOME/.claude/projects/<encoded>/<sid>.jsonl with a §10-V
  // high-fire token, then drives the hook with `git push`. Must deny.
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  const r = await doctor({});
  const t = r.checks.find(c => c.name === 'banned-vocab self-test:prose-scan');
  assert.ok(t, 'banned-vocab self-test:prose-scan check must exist');
  assert.equal(t.ok, true,
    `Path 2 self-test must pass on a clean tree; detail="${t.detail}"`);
  assert.match(t.detail, /Path 2/);
  assert.match(t.detail, /significantly/);
});

test('doctor pre-bash-safety self-test detail notes per-hook kill-switch from settings.json (v0.19.1 A2)', async () => {
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
  if (!have('jq') || !have('bash')) return;
  // Per-hook kill-switch (NOT global) — must still pass code-integrity check
  // while emitting the kill-switch note in detail. Verifies the matrix
  // implementation reads each hook's own ksEnvVar, not just the global one.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ env: { DISABLE_PRE_BASH_SAFETY_HOOK: '1' } }));
  const r = await doctor({});
  const rmrf = r.checks.find(c => c.name === 'pre-bash-safety self-test:rm-rf-var');
  const npx  = r.checks.find(c => c.name === 'pre-bash-safety self-test:npx-unpinned');
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
  const have = (b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0;
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
  const ghostPluginRoot = path.join(tmpHome, 'plugins/cache/claudemd/claudemd/9.9.9-removed');
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '9.9.9-removed',
    installedAt: new Date().toISOString(),
    pluginRoot: ghostPluginRoot,
    entries: [],
  }));
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
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'fake spec body\n');
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
  const mktRoot = path.join(tmpHome, '.claude/plugins/marketplaces/claudemd');
  // Mirror source hooks/ into market so missing-in-market doesn't dominate.
  fs.cpSync(sourceHooks, path.join(mktRoot, 'hooks'), { recursive: true });
  // Then break ONE file (the canonical drift target) to simulate the real
  // v0.9.15 silent fix that didn't propagate to the marketplace install.
  fs.writeFileSync(path.join(mktRoot, 'hooks/lib/rule-hits.sh'),
    "#!/usr/bin/env bash\n# stale (pre-v0.9.15)\nrule_hits_append() { :; }\n");

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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(5),
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

test('R-N6: rule-usage marks healthy when bypass:deny ratio ≤ 50%', async () => {
  // 5 denies + 1 bypass = 17% override rate — below threshold, healthy.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n`.repeat(5),
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(log,
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(5),
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"memory-read-check","event":"bypass-escape-hatch","spec_section":"§11-memory-read","extra":{"token":"skip-memory-check"}}\n`.repeat(3),
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-npx","extra":{"token":"allow-npx-unpinned"}}\n`.repeat(5),
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows =
    `{"ts":"${now}","hook":"banned-vocab","event":"fail-open","spec_section":"§hooks-fail-open","extra":{"reason":"bad-event"},"session_id":null}\n`.repeat(2);
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows =
    `{"ts":"${now}","hook":"banned-vocab","event":"fail-open","spec_section":"§hooks-fail-open","extra":{"reason":"patterns-missing"},"session_id":null}\n`;
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n`.repeat(5),
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
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  const rows = [
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","extra":{"token":"allow-banned-vocab"}}\n`.repeat(5),
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await doctor({});
  const unset = r.checks.find(c => c.name === 'rule-usage:(unset)');
  assert.equal(unset, undefined, '(unset) bucket must not generate a rule-usage check');
});

test('doctor CLI rejects space-form --prune-backups 5 (was silent default)', () => {
  // v0.9.16 antipattern recurrence: pre-fix, space-form was silently dropped,
  // doctor ran without prune, exited 0 — same family as audit.js / sparkline.js
  // / clean-residue.js fixes shipped in v0.9.16.
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups', '5'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, `expected exit 2, stderr: ${result.stderr}`);
  assert.match(result.stderr, /requires '=value' form/);
});

test('doctor CLI rejects unknown flag (was silent ignore)', () => {
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--bogus=1'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag.*--bogus/);
});

test('D8: plugin cache check passes when manifest.pluginRoot exists', async () => {
  const realPluginRoot = path.join(tmpHome, 'plugins/cache/claudemd/claudemd/0.5.4');
  fs.mkdirSync(realPluginRoot, { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.5.4',
    installedAt: new Date().toISOString(),
    pluginRoot: realPluginRoot,
    entries: [],
  }));
  const r = await doctor({});
  const pc = r.checks.find(c => c.name === 'plugin cache');
  assert.ok(pc);
  assert.equal(pc.ok, true);
  assert.match(pc.detail, /present at/);
});
