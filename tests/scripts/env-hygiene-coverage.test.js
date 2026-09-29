// env-hygiene-coverage.test.js — every opt-in knob a hook reads is scrubbed.
//
// tests/lib/env-hygiene.sh unsets the DISABLE_* and CLAUDEMD_* families by
// prefix, and every other knob by an explicit list. 0.105.0 added three opt-ins
// (EVIDENCE_WTREE, EVIDENCE_GATE_DELIVER, DEBUG_ON_TEST_FAILURE) without adding
// them to the list, and SPEC_MODULE_GATE (0.101.0) was never on it. A machine
// that sets EVIDENCE_WTREE=1 in its settings env then ran verify-log.test.sh
// with the flag inherited, and three cases that assert the flag-off behaviour
// failed there while CI, which sets nothing, stayed green.
//
// A knob is recognised by how hooks read it: a default expansion
// (`${NAME:-…}` / `${NAME-…}`) of a name that no hook or hook library ever
// assigns. Harness variables and the prefixed families are left out. The
// check then exports every such name, runs claudemd_reset_test_env, and lists
// what survived. A knob that some hook also assigns (`X="${X:-0}"`) is not
// found this way; the explicit list still covers those by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = new Set([
  'HOME',
  'PATH',
  'PWD',
  'TMPDIR',
  'IFS',
  'OLDPWD',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
]);

function hookFiles() {
  const out = [];
  for (const dir of ['hooks', 'hooks/lib']) {
    for (const f of fs.readdirSync(path.join(REPO, dir))) {
      if (f.endsWith('.sh')) out.push(path.join(REPO, dir, f));
    }
  }
  return out;
}

export function knobsReadByHooks(files = hookFiles()) {
  const read = new Set();
  const assigned = new Set();
  for (const f of files) {
    const src = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter(l => !l.trimStart().startsWith('#'))
      .join('\n');
    for (const m of src.matchAll(/\$\{([A-Z][A-Z0-9_]+):?-/g)) read.add(m[1]);
    for (const m of src.matchAll(
      /(?:^|[\s;&(!])(?:local\s+|declare\s+(?:-\w+\s+)?|export\s+|readonly\s+)?([A-Z][A-Z0-9_]+)\+?=/gm
    )) {
      assigned.add(m[1]);
    }
    // `read [opts] NAME…`: every upper-case word up to a redirection or the end
    // of the command, so `read -r -d '' AWK <<'X'` and `read -r A B C` count.
    for (const m of src.matchAll(/\bread\b([^\n;|&<]*)/g)) {
      for (const w of m[1].matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)) assigned.add(w[1]);
    }
    for (const m of src.matchAll(/\bfor\s+([A-Z][A-Z0-9_]+)\s+in\b/g)) assigned.add(m[1]);
  }
  return [...read]
    .filter(n => !assigned.has(n) && !HARNESS.has(n) && !/^(DISABLE_|CLAUDEMD_|CLAUDE_)/.test(n))
    .sort();
}

function survivorsOfReset(names) {
  const script = [
    ...names.map(n => `export ${n}=1`),
    `source ${JSON.stringify(path.join(REPO, 'tests/lib/env-hygiene.sh'))}`,
    'claudemd_reset_test_env',
    `for n in ${names.join(' ')}; do [[ -n "\${!n+x}" ]] && printf '%s\\n' "$n"; done`,
    'exit 0',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter(Boolean);
}

test('the knob detector finds the known opt-ins and skips internal state', () => {
  const knobs = knobsReadByHooks();
  // Liveness: a detector that finds nothing would make the next test vacuous.
  for (const k of ['REWORK_BREAKER', 'REPLY_LANGUAGE_CHECK', 'EVIDENCE_WTREE', 'SPEC_MODULE_GATE']) {
    assert.ok(knobs.includes(k), `detector lost ${k}: ${knobs.join(' ')}`);
  }
  // Awk programs read into a variable by `read -r -d ''` are state, not knobs.
  for (const k of ['HOOK_HEREDOC_AWK', 'MEMTAGS_AWK', 'SESSION_ID']) {
    assert.ok(!knobs.includes(k), `detector counted internal ${k} as a knob`);
  }
});

test('claudemd_reset_test_env unsets every knob a hook reads', () => {
  const survivors = survivorsOfReset(knobsReadByHooks());
  assert.deepEqual(
    survivors,
    [],
    `inherited by every suite: ${survivors.join(' ')} — add them to the explicit unset list in tests/lib/env-hygiene.sh`
  );
});
