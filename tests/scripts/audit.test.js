import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit } from '../../scripts/audit.js';

const AUDIT_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/audit.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-au-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  // Mix: 2 v0.7.0 rows with spec_section + 1 legacy v0.6.x row missing the
  // field (audit `bySection` must surface it under the `(unset)` bucket so
  // pre-upgrade data is visible during the audit-window transition).
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["70% faster"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","extra":null}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","spec_section":"§10-V","extra":{"token":"allow-banned-vocab"}}\n` +
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-rm-rf-var","extra":{"token":"allow-rm-rf-var"}}\n` +
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-rm-rf-var","extra":{"token":"allow-rm-rf-var"}}\n`
  );
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('audit aggregates by hook', async () => {
  const r = await audit({ days: 30 });
  assert.equal(r.byHook['banned-vocab'].total, 3);
  assert.equal(r.byHook['banned-vocab'].byEvent.deny, 2);
  assert.equal(r.byHook['banned-vocab'].byEvent['bypass-escape-hatch'], 1);
  assert.equal(r.byHook['ship-baseline'].total, 1);
  assert.equal(r.byHook['pre-bash-safety'].total, 2);
});

test('audit top patterns for banned-vocab', async () => {
  const r = await audit({ days: 30 });
  assert.ok(r.topPatterns.length >= 2);
  const names = r.topPatterns.map(([name]) => name);
  assert.ok(names.includes('significantly'));
});

test('audit denyByProjectClass splits self-dogfood vs external (deny-family)', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","project":"-mnt-data-ssd-dev-projects-claudemd","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","project":"-mnt-data_ssd-dev-projects-claudemd","spec_section":"§10-V","extra":{"matched":["robust"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","project":"-home-u-dev-daagu","spec_section":"§10-V","extra":{"matched":["robust"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny-prose-dry-run","project":"-home-u-dev-daagu","spec_section":"§10-V","extra":{"matched":["clearly"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","project":"-home-u-dev-daagu","extra":null}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny-repeat","project":"-home-u-dev-gsd","extra":null}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","project":"-home-u-dev-daagu","extra":{"token":"allow-banned-vocab"}}\n`
  );
  const r = await audit({ days: 30 });
  // banned-vocab: 2 self (both cwd encodings of the plugin's own repo) + 1
  // external (daagu); the dry-run row (exits 0) and the bypass row are excluded.
  assert.deepEqual(r.denyByProjectClass['banned-vocab'], { total: 3, self: 2, external: 1, unknown: 0 });
  // ship-baseline: deny + deny-repeat both blocked → 2 external (the deny-repeat
  // undercount the adversarial verifier caught).
  assert.deepEqual(r.denyByProjectClass['ship-baseline'], { total: 2, self: 0, external: 2, unknown: 0 });
});

test('audit bySection aggregates v0.7.0 spec_section field', async () => {
  const r = await audit({ days: 30 });
  // §10-V fired 3× (2 deny + 1 bypass on banned-vocab)
  assert.equal(r.bySection['§10-V'].total, 3);
  assert.equal(r.bySection['§10-V'].byEvent.deny, 2);
  assert.equal(r.bySection['§10-V'].byEvent['bypass-escape-hatch'], 1);
  assert.equal(r.bySection['§10-V'].byHook['banned-vocab'], 3);
  // §8-rm-rf-var fired 2× (both bypass on pre-bash-safety)
  assert.equal(r.bySection['§8-rm-rf-var'].total, 2);
});

test('audit bySection surfaces null-section rows under (unset-current) post-cutover', async () => {
  // The ship-baseline row in the fixture has no spec_section field. All
  // rows share `now` as ts so detectCutover ⇒ now; the null-section row is
  // ts >= cutoverTs ⇒ goes to (unset-current). v0.9.37 split: pre-cutover
  // ⇒ (unset-historical), post-cutover ⇒ (unset-current). Legacy `(unset)`
  // bucket no longer appears when any spec_section row exists in the log.
  const r = await audit({ days: 30 });
  assert.equal(r.bySection['(unset)'], undefined, 'legacy (unset) must NOT appear when cutoverTs is detectable');
  assert.ok(r.bySection['(unset-current)'], '(unset-current) bucket must exist for post-cutover null-section rows');
  assert.equal(r.bySection['(unset-current)'].total, 1);
  assert.equal(r.bySection['(unset-current)'].byHook['ship-baseline'], 1);
  // dataIntegrity surfaces the detected cutoverTs (ISO-8601 UTC).
  assert.ok(r.dataIntegrity.cutoverTs, 'dataIntegrity.cutoverTs must be set when log has spec_section rows');
  assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(r.dataIntegrity.cutoverTs));
});

test('audit byBypass aggregates per-token override usage', async () => {
  const r = await audit({ days: 30 });
  // 1× allow-banned-vocab + 2× allow-rm-rf-var in fixture
  assert.equal(r.byBypass['allow-banned-vocab'].total, 1);
  assert.equal(r.byBypass['allow-banned-vocab'].byHook['banned-vocab'], 1);
  assert.equal(r.byBypass['allow-rm-rf-var'].total, 2);
  assert.equal(r.byBypass['allow-rm-rf-var'].byHook['pre-bash-safety'], 2);
});

test('v0.9.37: bySection cutover-split with mixed pre/post rows', async () => {
  // Rewrite fixture with explicit pre-cutover + post-cutover timestamps.
  // cutoverTs := earliest ts where spec_section != null. Pre-cutover null-
  // section rows → (unset-historical); post-cutover → (unset-current).
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const fakeNowIso = new Date().toISOString();
  const fakeNowMinus3dIso = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    // Pre-cutover null-section legacy rows (3d ago, simulating v0.6.x data).
    `{"ts":"${fakeNowMinus3dIso}","hook":"sandbox-disposal","event":"warn","extra":null}\n` +
    `{"ts":"${fakeNowMinus3dIso}","hook":"ship-baseline","event":"pass","extra":null}\n` +
    // Cutover row: first one carrying a spec_section. ts ≈ now-1d.
    `{"ts":"${new Date(Date.now() - 86400 * 1000).toISOString()}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["x"]}}\n` +
    // Post-cutover null-section row (intentional housekeeping — session-start
    // bootstrap is by-design null). Should land in (unset-current).
    `{"ts":"${fakeNowIso}","hook":"session-start","event":"bootstrap","extra":null}\n`
  );
  const r = await audit({ days: 30 });
  // Cutover detected.
  assert.ok(r.dataIntegrity.cutoverTs, 'cutoverTs detected');
  // Split executed.
  assert.equal(r.bySection['(unset-historical)'].total, 2);
  assert.deepEqual(Object.keys(r.bySection['(unset-historical)'].byHook).sort(),
    ['sandbox-disposal', 'ship-baseline']);
  assert.equal(r.bySection['(unset-current)'].total, 1);
  assert.equal(r.bySection['(unset-current)'].byHook['session-start'], 1);
  assert.equal(r.bySection['§10-V'].total, 1);
  // Legacy single-bucket name must not appear when split was performed.
  assert.equal(r.bySection['(unset)'], undefined);
});

test('v0.9.37: cutoverTs is null when no spec_section row exists; legacy (unset) bucket used', async () => {
  // Fully pre-v0.7.0 log — no row ever had spec_section. detectCutover ⇒
  // null. Behavior falls back to single `(unset)` bucket (back-compat for
  // anyone analyzing a vintage log).
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"sandbox-disposal","event":"warn","extra":null}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"pass","extra":null}\n`
  );
  const r = await audit({ days: 30 });
  assert.equal(r.dataIntegrity.cutoverTs, null);
  assert.ok(r.bySection['(unset)'], 'legacy (unset) bucket must appear when no cutover detectable');
  assert.equal(r.bySection['(unset)'].total, 2);
  assert.equal(r.bySection['(unset-historical)'], undefined);
  assert.equal(r.bySection['(unset-current)'], undefined);
});

test('v0.9.34: uniqueInvocations dedups byte-identical rows; distinct tool_use_id stays unique', async () => {
  // Replace fixture with rows specifically designed to exercise dedup:
  //   - 2 banned-vocab rows at same ts with same tool_use_id → 1 dup
  //   - 1 banned-vocab row at same ts with different tool_use_id → unique
  //   - 1 sandbox-disposal Stop row with tool_use_id null → unique (no dedup
  //     possible without tool_use_id; same-second + same-session counts as
  //     one event for non-tool hooks)
  //   - 1 ship-baseline LEGACY row (session_id + tool_use_id null) → unique,
  //     but counted under legacy_rows.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // Relative timestamps — hardcoded dates ('2026-05-11') silently aged out
  // of the days:30 window and the bucket lookups threw on undefined.
  const base = Date.now() - 60_000;
  const ts1 = new Date(base).toISOString();
  const ts2 = new Date(base + 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${ts1}","hook":"banned-vocab","event":"deny","session_id":"sess-0001","tool_use_id":"toolu_A","extra":{"matched":["x"]}}\n` +
    `{"ts":"${ts1}","hook":"banned-vocab","event":"deny","session_id":"sess-0001","tool_use_id":"toolu_A","extra":{"matched":["x"]}}\n` +
    `{"ts":"${ts1}","hook":"banned-vocab","event":"deny","session_id":"sess-0001","tool_use_id":"toolu_B","extra":{"matched":["x"]}}\n` +
    `{"ts":"${ts2}","hook":"sandbox-disposal","event":"warn","session_id":"sess-0001","tool_use_id":null,"extra":{"count":1}}\n` +
    `{"ts":"${ts2}","hook":"ship-baseline","event":"deny","session_id":null,"tool_use_id":null,"extra":null}\n`
  );
  const r = await audit({ days: 30 });
  // banned-vocab: 3 rows, but two share (ts, session, tool_use_id) → 1 dup;
  // the dup row has non-null tool_use_id (toolu_A) → counted as _real.
  assert.equal(r.uniqueInvocations['banned-vocab'].rows, 3);
  assert.equal(r.uniqueInvocations['banned-vocab'].unique_invocations, 2);
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows, 1);
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows_real, 1);
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows_legacy, 0);
  assert.equal(r.uniqueInvocations['banned-vocab'].legacy_rows, 0);
  // sandbox-disposal: 1 row, no dup possible, not legacy (session_id present)
  assert.equal(r.uniqueInvocations['sandbox-disposal'].rows, 1);
  assert.equal(r.uniqueInvocations['sandbox-disposal'].unique_invocations, 1);
  assert.equal(r.uniqueInvocations['sandbox-disposal'].duplicate_rows, 0);
  assert.equal(r.uniqueInvocations['sandbox-disposal'].legacy_rows, 0);
  // ship-baseline: 1 legacy row (both null), counted under legacy_rows
  assert.equal(r.uniqueInvocations['ship-baseline'].rows, 1);
  assert.equal(r.uniqueInvocations['ship-baseline'].legacy_rows, 1);
});

test('v0.21.7: duplicate_rows split into real (non-null tool_use_id) vs legacy (null)', async () => {
  // Fixture covering all three collision shapes:
  //   - 2 banned-vocab rows: same (ts, session, tool_use_id) → real bug (tool_use_id non-null) → 1 dup_real
  //   - 2 mem-audit Stop rows: same (ts, session, hook), tool_use_id null →
  //       expected Stop-class collision (not a registration bug) → 1 dup_legacy
  //   - 2 pre-bash-safety legacy rows: same ts, session_id+tool_use_id BOTH null →
  //       pre-v0.9.34 seconds-precision noise → 1 dup_legacy + 2 legacy_rows
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // Relative timestamps — see v0.9.34 test above for the aging-out trap.
  const base = Date.now() - 60_000;
  const ts1 = new Date(base).toISOString();
  const ts2 = new Date(base + 1000).toISOString();
  const ts3 = new Date(base + 2000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${ts1}","hook":"banned-vocab","event":"deny","session_id":"sess-0001","tool_use_id":"toolu_X","extra":{"matched":["x"]}}\n` +
    `{"ts":"${ts1}","hook":"banned-vocab","event":"deny","session_id":"sess-0001","tool_use_id":"toolu_X","extra":{"matched":["x"]}}\n` +
    `{"ts":"${ts2}","hook":"mem-audit","event":"warn","session_id":"sess-0002","tool_use_id":null,"extra":null}\n` +
    `{"ts":"${ts2}","hook":"mem-audit","event":"warn","session_id":"sess-0002","tool_use_id":null,"extra":null}\n` +
    `{"ts":"${ts3}","hook":"pre-bash-safety","event":"deny","session_id":null,"tool_use_id":null,"extra":null}\n` +
    `{"ts":"${ts3}","hook":"pre-bash-safety","event":"deny","session_id":null,"tool_use_id":null,"extra":null}\n`
  );
  const r = await audit({ days: 30 });
  // banned-vocab: real double-fire signal.
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows, 1);
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows_real, 1);
  assert.equal(r.uniqueInvocations['banned-vocab'].duplicate_rows_legacy, 0);
  // mem-audit: Stop-class hook, collision is expected noise → legacy.
  assert.equal(r.uniqueInvocations['mem-audit'].duplicate_rows, 1);
  assert.equal(r.uniqueInvocations['mem-audit'].duplicate_rows_real, 0);
  assert.equal(r.uniqueInvocations['mem-audit'].duplicate_rows_legacy, 1);
  // pre-bash-safety: pre-v0.9.34 legacy → legacy dup + 2 legacy_rows.
  assert.equal(r.uniqueInvocations['pre-bash-safety'].duplicate_rows, 1);
  assert.equal(r.uniqueInvocations['pre-bash-safety'].duplicate_rows_real, 0);
  assert.equal(r.uniqueInvocations['pre-bash-safety'].duplicate_rows_legacy, 1);
  assert.equal(r.uniqueInvocations['pre-bash-safety'].legacy_rows, 2);
});

test('v0.23.21: multi-emit hook (distinct event/extra in one invocation) is not a double-fire', async () => {
  // pre-bash-safety logs one row per matched pattern in a compound command.
  // Rows sharing (ts, hook, session_id, tool_use_id) but differing in event
  // OR extra are legitimate multi-emit — NOT a registration double-fire.
  // Pre-v0.23.21 the 4-field dedup key counted every such row as
  // duplicate_rows_real (unique_invocations=3, _real=3 for this fixture),
  // faking the audit's "registration/lib bug candidate" signal — the exact
  // 77-phantom-_real FP a 2026-07-02 /claudemd-audit self-review surfaced.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // Relative timestamp — see the v0.9.34 test for the hardcoded-date aging trap.
  const base = Date.now() - 60_000;
  const ts1 = new Date(base).toISOString();
  fs.writeFileSync(log,
    // toolu_A: one command, two rm -rf validations, DIFFERENT extra.var → legit, 0 dup
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"rm-rf-allow-validated","session_id":"sess-0001","tool_use_id":"toolu_A","extra":{"var":"TMP"}}\n` +
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"rm-rf-allow-validated","session_id":"sess-0001","tool_use_id":"toolu_A","extra":{"var":"TMP2"}}\n` +
    // toolu_B: one compound command, mixed sections (DIFFERENT event) → legit, 0 dup
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"rm-rf-allow-validated","session_id":"sess-0001","tool_use_id":"toolu_B","extra":{"var":"D"}}\n` +
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"npx-allow-local","session_id":"sess-0001","tool_use_id":"toolu_B","extra":{"pkg":"eslint"}}\n` +
    // toolu_C: BYTE-IDENTICAL rows (same event+extra) in one invocation → residual
    //   _real=1 — indistinguishable from a double-fire by telemetry alone
    //   (documented multi-emit limitation; needs source-command confirmation).
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"rm-rf-allow-validated","session_id":"sess-0001","tool_use_id":"toolu_C","extra":{"var":"D"}}\n` +
    `{"ts":"${ts1}","hook":"pre-bash-safety","event":"rm-rf-allow-validated","session_id":"sess-0001","tool_use_id":"toolu_C","extra":{"var":"D"}}\n`
  );
  const r = await audit({ days: 30 });
  const u = r.uniqueInvocations['pre-bash-safety'];
  assert.equal(u.rows, 6);
  // A (2 distinct) + B (2 distinct) + C (1 unique) = 5 distinct invocations.
  assert.equal(u.unique_invocations, 5);
  assert.equal(u.duplicate_rows_real, 1);   // only the byte-identical toolu_C pair
  assert.equal(u.duplicate_rows_legacy, 0);
  assert.equal(u.legacy_rows, 0);
});

test('audit byBypass empty when no bypass-escape-hatch events present', async () => {
  // Replace fixture with deny-only data.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(log,
    `{"ts":"${new Date().toISOString()}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["robust"]}}\n`
  );
  const r = await audit({ days: 30 });
  assert.deepEqual(r.byBypass, {});
});

test('R-N3: byTrend flags regression when recent doubles prior', async () => {
  // 5 events in last 7d, 1 event in 7-14d window → ratio 5.0 → regression.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 1 * 86400 * 1000).toISOString();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  const rows = [
    `{"ts":"${recent}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`.repeat(5),
    `{"ts":"${prior}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await audit({ days: 30, trendDays: 7 });
  assert.ok(r.byTrend, 'byTrend must be present');
  assert.equal(r.byTrend['§10-V'].recent, 5);
  assert.equal(r.byTrend['§10-V'].prior, 1);
  assert.equal(r.byTrend['§10-V'].ratio, 5);
  assert.equal(r.byTrend['§10-V'].flag, 'regression');
});

test('R-N3: byTrend flags newly_active when prior=0 recent>0', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 2 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${recent}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":null}\n`.repeat(3)
  );
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§11-memory-read'].recent, 3);
  assert.equal(r.byTrend['§11-memory-read'].prior, 0);
  assert.equal(r.byTrend['§11-memory-read'].ratio, null);
  assert.equal(r.byTrend['§11-memory-read'].flag, 'newly_active');
});

test('R-N3: byTrend flags silenced when recent=0 prior>0', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${prior}","hook":"sandbox-disposal","event":"warn","spec_section":"§8.V4","extra":null}\n`.repeat(4)
  );
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§8.V4'].recent, 0);
  assert.equal(r.byTrend['§8.V4'].prior, 4);
  assert.equal(r.byTrend['§8.V4'].ratio, 0);
  assert.equal(r.byTrend['§8.V4'].flag, 'silenced');
});

test('R-N3: byTrend marks recovery when ratio ≤ 0.5', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 1 * 86400 * 1000).toISOString();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  const rows = [
    `{"ts":"${recent}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`,
    `{"ts":"${prior}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`.repeat(4),
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§10-V'].recent, 1);
  assert.equal(r.byTrend['§10-V'].prior, 4);
  assert.equal(r.byTrend['§10-V'].ratio, 0.25);
  assert.equal(r.byTrend['§10-V'].flag, 'recovery');
});

test('audit CLI rejects non-numeric --days (L1)', () => {
  // Regression: parseInt('garbage', 10) → NaN → cutoff NaN → every row
  // filtered out silently. Previous runs returned 0 hits with no error.
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=garbage'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI rejects --days=0 (L1)', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI --days=N takes precedence over env var', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=1'], {
    env: { ...process.env, HOME: tmpHome, CLAUDEMD_AUDIT_DAYS: '90' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
  const r = JSON.parse(result.stdout);
  assert.equal(r.windowDays, 1);
});

test('audit CLI rejects space-form --days 7 (was silent default)', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days', '7'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, `expected exit 2, stderr: ${result.stderr}`);
  assert.match(result.stderr, /requires '=value' form/);
});

test('audit CLI rejects unknown flag (was silent ignore)', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--bogus=1'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown flag.*--bogus/);
});
