// doctor-hook-selftests.test.js — converge round 4 (2026-09-14), "补验证".
//
// `scripts/lib/doctor-hook-tests.js` had no suite of its own. It was reachable
// only by spawning `doctor.js` from doctor.test.js, which asserts on doctor's
// aggregate output — so the one claim this module exists to make was never
// stated anywhere as a test: that `/claudemd-doctor` tells the truth about
// whether enforcement is LIVE, separately from whether the hook CODE works.
//
// That distinction is the module's own stated purpose ("so /claudemd-doctor
// output doesn't look like everything is enforced when it isn't"). Its failure
// mode is silent and user-facing in the worst direction: a user who has
// disabled a hook sees a clean green doctor and believes they are guarded.
//
// Scope note, because this module is a SOURCE-TEXT subject of two other gates:
// this suite calls it as a VALUE. Completeness of the liveness table against
// HOOK_REGISTRY stays with subject-set-drift.test.js (PARTITIONS), which reads
// the file as text — duplicating it here would be a second, weaker copy of a
// join that already exists. Nothing below enumerates hook names; the one
// basename that appears is a single anchor, not a list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookSelfTests } from '../../scripts/lib/doctor-hook-tests.js';
import { HOOK_REGISTRY } from '../../scripts/lib/hook-registry.js';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every spawn below inherits HOME from the sandbox: the deny self-tests pass
// `...process.env` through to the hook, so without this they would run against
// the real ~/.claude. R11-27's helper rather than a private literal, for the
// reason that gate records.
const box = useHomeSandbox('doctor-selftest');

// A real lookup, not a stub: the module pushes a `prerequisite missing` row
// when jq or bash is absent, and a stub that always answers truthfully-ish
// would turn that documented degradation into a spawn failure reported as a
// hook defect.
function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next PATH entry */
    }
  }
  return null;
}

function collect(pluginRoot = REPO_ROOT) {
  const rows = [];
  runHookSelfTests({
    push: (name, ok, detail) => rows.push({ name, ok, detail }),
    which,
    pluginRoot,
  });
  return rows;
}

const denyRows = rows => rows.filter(r => r.name.includes('self-test'));
const livenessRows = rows => rows.filter(r => r.name.endsWith(' liveness'));

// The anchor row for the kill-switch assertions. One basename, derived through
// the registry rather than a second hand-written DISABLE_* spelling — the
// fourth-parallel-list defect the module's own comment records.
const ANCHOR_HOOK = 'banned-vocab-check.sh';
const ANCHOR_KS = `DISABLE_${HOOK_REGISTRY.find(h => h.basename === ANCHOR_HOOK).envVarSuffix}_HOOK`;
const anchorRow = rows => rows.find(r => r.name === 'banned-vocab self-test');

// Set env vars for one call and put them back exactly as they were, including
// "was not set at all" — the distinction `process.env.X === '1'` turns on.
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('doctor self-tests: the shipped hooks deny every synthetic trigger', () => {
  if (!which('jq') || !which('bash')) {
    assert.fail('jq + bash are prerequisites of the suite (CONTRIBUTING lists both)');
  }
  const rows = collect();
  const deny = denyRows(rows);
  const live = livenessRows(rows);
  console.log(`  doctor self-test gate: ${deny.length} deny row(s), ${live.length} liveness row(s)`);
  // Floors on the judged set: "all green" and "there was nothing to run" print
  // the same pass otherwise.
  assert.ok(deny.length >= 4, `expected >=4 deny self-tests, got ${deny.length}`);
  assert.ok(live.length >= 10, `expected >=10 liveness probes, got ${live.length}`);

  const failed = rows.filter(r => !r.ok).map(r => `${r.name}: ${r.detail}`);
  assert.deepEqual(failed, [], `doctor self-tests report a broken hook:\n  ${failed.join('\n  ')}`);
});

test('doctor self-tests: a user kill-switch does not silence the note, and does not fake a pass', () => {
  const rows = withEnv({ [ANCHOR_KS]: '1' }, () => collect());
  const row = anchorRow(rows);
  assert.ok(row, 'the anchor deny self-test row is gone — this test no longer checks anything');

  // Two halves, and they pull in opposite directions on purpose.
  //
  // (a) It still PASSES. The self-test clears the kill-switch per spawn, so a
  //     user cannot make doctor green by disabling the very hook being checked.
  assert.equal(row.ok, true, `a user kill-switch turned the code-integrity check itself red: ${row.detail}`);
  // (b) It says so. Without this the user reads an unqualified green while the
  //     hook will not fire at all — the failure this module was written for.
  assert.match(
    row.detail,
    /kill-switch engaged/,
    `the row passed but never says enforcement is off: ${row.detail}`
  );
  assert.match(row.detail, /will NOT fire in practice/, `the note lost its consequence: ${row.detail}`);
});

test('doctor self-tests: the note is absent when no kill-switch is engaged', () => {
  // The discriminating half of the test above: if `kill-switch engaged` were
  // appended unconditionally, that assertion would pass for the wrong reason
  // and doctor would cry wolf on every clean run.
  const row = anchorRow(withEnv({ [ANCHOR_KS]: '' }, () => collect()));
  assert.ok(row, 'the anchor deny self-test row is gone');
  assert.equal(row.ok, true, `clean run should pass: ${row.detail}`);
  assert.doesNotMatch(
    row.detail,
    /kill-switch engaged/,
    `the note fires with no kill-switch set: ${row.detail}`
  );
});

test('doctor self-tests: the plugin-wide kill-switch is surfaced too', () => {
  // DISABLE_CLAUDEMD_HOOKS is read once, before the per-spawn env clear, and
  // has to reach every deny row — a per-hook-only read would leave a user who
  // turned the whole plugin off with an unqualified green.
  const rows = withEnv({ DISABLE_CLAUDEMD_HOOKS: '1' }, () => collect());
  const unnoted = denyRows(rows)
    .filter(r => !/kill-switch engaged/.test(r.detail))
    .map(r => r.name);
  assert.deepEqual(
    unnoted,
    [],
    `plugin-wide kill-switch left these deny rows unqualified:\n  ${unnoted.join('\n  ')}`
  );
});

test('doctor self-tests: a missing hook tree fails closed on every row', () => {
  // Fails CLOSED, not silently: an install whose hooks directory is gone must
  // report red rows, not an empty check list that reads as healthy. No spawns —
  // every row short-circuits on the existence check.
  const rows = collect(box.home);
  assert.ok(rows.length >= 14, `expected a row per hook even when absent, got ${rows.length}`);
  const notMissing = rows.filter(r => r.ok || !/hook missing at/.test(r.detail)).map(r => r.name);
  assert.deepEqual(
    notMissing,
    [],
    `rows that did not fail closed against an empty plugin root:\n  ${notMissing.join('\n  ')}`
  );
});
