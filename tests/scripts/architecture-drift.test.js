// docs/ARCHITECTURE.md drift gate.
//
// The hook-taxonomy table there declares itself source-of-truth for the literal
// `spec_section` arguments hooks pass to hook_record, but nothing checked it. By
// the 2026-07-26 audit it had drifted twice: `§8-curl-sh` was absent though the
// curl|sh gate had been filing denies under it since v0.51.x, and
// `session-start-check` was listed `n/a` while emitting `§11-post-compaction`.
// README's hook counts had readme-drift.test.js; this file was the one shipped
// doc with a source-of-truth claim and no gate behind it.
//
// Same principle as contract.test.sh and hard-rules-drift.test.js after the same
// audit: a gate parses the artifact it names. This one extracts sections from
// hooks/**/*.sh and requires each to appear somewhere in the table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOKS_DIR = path.join(ROOT, 'hooks');
const ARCH_DOC = path.join(ROOT, 'docs/ARCHITECTURE.md');

// Every idiom that attaches a spec_section to an emitted row. Kept in step with
// hookEmittedSections() in hard-rules-drift.test.js — both answer "what sections
// does the source actually emit", for different consumers.
function emittedSections() {
  const out = new Set();
  const files = [
    ...fs.readdirSync(HOOKS_DIR).map(f => path.join(HOOKS_DIR, f)),
    ...(fs.existsSync(path.join(HOOKS_DIR, 'lib'))
      ? fs.readdirSync(path.join(HOOKS_DIR, 'lib')).map(f => path.join(HOOKS_DIR, 'lib', f))
      : []),
  ];
  for (const full of files) {
    if (!path.basename(full).endsWith('.sh')) continue;
    // Join backslash continuations: a multi-line hook_record call puts the
    // section argument on a later physical line.
    const src = fs.readFileSync(full, 'utf8').replace(/\\\n\s*/g, ' ');
    for (const m of src.matchAll(/HIT_SECTIONS\+=\('([^']+)'\)/g)) out.add(m[1]);
    for (const m of src.matchAll(/hook_record\s+\S+\s+\S+\s+.*?'(§[^']+)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/HITS\+=\("(§[^|"]+)\|/g)) out.add(m[1]);
    for (const m of src.matchAll(/record_section_deny\s+'(§[^']+)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/rule_hits_append\s+\S+\s+\S+\s+.*?'(§[^']+)'/g)) out.add(m[1]);
  }
  return out;
}

// Plugin-internal observability, deliberately absent from a table about SPEC
// enforcement. Anything else must be listed.
const NOT_IN_TABLE = new Set(['§hooks-fail-open']);

test('ARCHITECTURE.md hook taxonomy lists every spec_section the hooks emit', () => {
  const doc = fs.readFileSync(ARCH_DOC, 'utf8');
  const emitted = emittedSections();
  assert.ok(emitted.size > 5, `section extraction returned only ${emitted.size} — parser or hook shape changed`);

  const missing = [...emitted]
    .filter(s => !NOT_IN_TABLE.has(s))
    .filter(s => !doc.includes(`\`${s}\``))
    .sort();

  assert.deepEqual(missing, [],
    `docs/ARCHITECTURE.md hook taxonomy is missing section(s) the hooks emit:\n` +
    missing.map(s => `  ${s}`).join('\n') +
    `\nThe table calls itself source-of-truth — re-extract it from hooks/**/*.sh.`);
});

test('ARCHITECTURE.md hook taxonomy has one row per registered hook', () => {
  const doc = fs.readFileSync(ARCH_DOC, 'utf8');
  const onDisk = fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.sh')).sort();

  const missing = onDisk.filter(f => !doc.includes(`\`${f}\``));
  assert.deepEqual(missing, [],
    `hook(s) on disk with no row in the ARCHITECTURE.md taxonomy table:\n` +
    missing.map(f => `  ${f}`).join('\n'));

  // Reverse: a retired hook must not linger in the table (v0.57.0 removed
  // mid-spine-yield-scan and the table kept its heading count). Shared libs under
  // hooks/lib/ are legitimately named in the prose around the table, so they
  // count as existing files even though they get no row of their own.
  const libFiles = fs.existsSync(path.join(HOOKS_DIR, 'lib'))
    ? fs.readdirSync(path.join(HOOKS_DIR, 'lib')).filter(f => f.endsWith('.sh'))
    : [];
  const known = new Set([...onDisk, ...libFiles]);
  const listed = [...doc.matchAll(/`([a-z0-9-]+\.sh)`/g)].map(m => m[1]);
  const stale = [...new Set(listed)].filter(f => !known.has(f)).sort();
  assert.deepEqual(stale, [],
    `ARCHITECTURE.md names hook file(s) that no longer exist:\n` +
    stale.map(f => `  ${f}`).join('\n'));
});
