// Consumer-enumeration gate for the jq fail-open contract (2026-07-28 audit H2).
//
// `hook_record_failopen` was added by roadmap OBS-1 so an operator could tell
// "hook silently bypassed" from "rule never fired". It was then wired into the
// hooks someone thought of — fail-open.test.sh T5-T7 names three safety hooks
// plus banned-vocab — and 5 of the 10 `hook_require_jq` callers were left with
// no instrumentation at all. `session-extended-read` enforces the HARD rule
// §13.1-extended-read and recorded nothing; `transcript-vocab-scan` carries
// §10-V Path 2 and recorded nothing.
//
// That is the same root the 0.62.x hotfixes shared: a shared helper is extracted
// (or added) and nothing enumerates its consumer set, so the set drifts silently.
// The project's own remedy is a gate that derives the consumer set FROM SOURCE
// and asserts a floor, rather than a hand-copied list with a "keep in sync"
// comment — see tests/scripts/architecture-drift.test.js and contract.test.sh.
//
// This gate answers: "every hook that guards on jq must also be observable when
// that guard trips, or be explicitly exempt with a stated reason."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOKS_DIR = path.join(ROOT, 'hooks');

// Exemptions are a decision record, not a suppression list: each entry states
// WHY the hook emits nothing, so the next reader can re-litigate it on facts.
const EXEMPT = new Map([
  ['session-summary.sh',
    'Enforces no spec rule — it aggregates rows written by other hooks into a ' +
    'state file for the SessionStart banner. docs/ARCHITECTURE.md and ' +
    'docs/RULE-HITS-SCHEMA.md both declare it the one hook that never writes to ' +
    'the log; a fail-open row from it would carry no enforcement signal. ' +
    'Contradicting two shipped invariants to satisfy this gate would be backwards.'],
]);

function hookFiles() {
  return fs.readdirSync(HOOKS_DIR)
    .filter(f => f.endsWith('.sh'))
    .sort();
}

// 2026-08-16 audit F4: deriving the set from `hook_require_jq` alone let two
// hooks (session-start-check, sandbox-disposal — plus residue-audit, which the
// audit itself missed and THIS widened extraction caught) parse the event with
// an inline `command -v jq` guard, invisible to both tests below. The subject
// of this gate is "every hook that depends on jq", so the extraction matches
// any jq guard shape, not one helper's name.
function jqGuardConsumers() {
  return hookFiles().filter(f => {
    const src = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8');
    return /\bhook_require_jq\b/.test(src) || /command -v jq\b/.test(src);
  });
}

// Hooks that read the stdin event at all — `hook_read_event` or a raw
// `EVENT=$(cat …)`. These have a "first parse" that must attribute a broken jq.
function eventReaders() {
  return hookFiles().filter(f =>
    /\b(?:hook_read_event\b|EVENT=\$\(\s*cat\b)/.test(
      fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8')));
}

test('every jq-guarded hook records a fail-open, or is explicitly exempt', () => {
  const consumers = jqGuardConsumers();

  // Floor: catches the extraction silently returning nothing (a rename of the
  // helper, a hooks/ layout change) — the failure mode where a gate reports
  // green because it checked an empty set.
  assert.ok(consumers.length >= 9,
    `only ${consumers.length} hook_require_jq consumer(s) found — extraction broke ` +
    `(helper renamed? hooks/ moved?). This gate must never validate an empty set.`);

  const unwired = [];
  for (const f of consumers) {
    if (EXEMPT.has(f)) continue;
    const src = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8');
    if (!/hook_record_failopen\s+\S+\s+jq-missing/.test(src)) unwired.push(f);
  }

  assert.deepEqual(unwired, [],
    `hook(s) guarding on jq with no jq-missing fail-open row:\n` +
    unwired.map(f => `  ${f}`).join('\n') +
    `\nA jq-less environment turns these into silent no-ops that the §13.1 audit\n` +
    `cannot distinguish from "rule never fired". Wire hook_record_failopen, or\n` +
    `add an EXEMPT entry in this file stating why the hook emits nothing.`);
});

test('every hook that parses its event detects a broken jq at the first parse', () => {
  // Scope: hooks that read the stdin event AT ALL (hook_read_event or raw
  // `EVENT=$(cat …)`) — not just the ones using the blessed helper. A hook that
  // never reads EVENT has no first parse to guard.
  const readers = eventReaders();
  assert.ok(readers.length >= 9,
    `only ${readers.length} event-reading hook(s) found — extraction broke. ` +
    `This gate must never validate an empty set.`);

  const unwired = [];
  for (const f of readers) {
    if (EXEMPT.has(f)) continue;
    const src = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8');
    if (!/hook_jq_field\s/.test(src)) unwired.push(f);
  }

  assert.deepEqual(unwired, [],
    `hook(s) parsing the event with no hook_jq_field call:\n` +
    unwired.map(f => `  ${f}`).join('\n') +
    `\n\`hook_require_jq\` tests PRESENCE, not usability: a jq that is present but\n` +
    `fails (stub on PATH, corrupt binary, missing shared lib, resource limit)\n` +
    `passes the guard, then \`jq -r … 2>/dev/null\` yields "" and the hook takes its\n` +
    `ordinary "not my tool/event" early exit — indistinguishable from "rule not\n` +
    `applicable" (2026-07-28 audit H1). Route the FIRST parse through\n` +
    `hook_jq_field so the failure is attributed and recorded.`);
});

test('fail-open telemetry does not itself depend on jq', () => {
  // The reasons that mean "jq is unusable" can only be recorded if the row
  // builder works without jq. Until v0.65.0 `rule_hits_append` built every row
  // with `jq -cn`, so jq-missing set its rate-limit marker and wrote zero rows.
  // Behavioural proof lives in fail-open.test.sh T8/T9/T12; this asserts the
  // structural property so a future refactor cannot quietly reintroduce it.
  const src = fs.readFileSync(path.join(HOOKS_DIR, 'lib/rule-hits.sh'), 'utf8');
  assert.match(src, /_rule_hits_fallback_row\s*\(\)/,
    'rule-hits.sh lost its jq-free fallback row builder — every fail-open reason ' +
    'implying jq is unusable becomes unrecordable again.');
  assert.match(src, /row=\$\(_rule_hits_fallback_row/,
    'the jq-free fallback builder exists but is no longer invoked on the jq-failure path.');
});
