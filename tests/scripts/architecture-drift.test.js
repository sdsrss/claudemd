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

// --- State-locations drift gate (2026-07-28 audit M1) -----------------------
// The taxonomy gate above exists because a doc section claimed source-of-truth
// with nothing behind it. The State-locations list in the SAME file had exactly
// that problem and was left outside the gate: it documented 6 entries while 14
// kinds existed on disk, including a `mem-coverage-*` class whose producing hook
// was deleted in v0.23.12. The remedy is the same one — derive from source.
function statePathsInSource() {
  const out = new Set();
  const files = [];
  const walk = (dir, exts) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, exts);
      else if (exts.some(x => e.name.endsWith(x))) files.push(full);
    }
  };
  walk(HOOKS_DIR, ['.sh']);
  walk(path.join(ROOT, 'scripts'), ['.js']);

  // Interpolations collapse to `*`: `ext-read-${SAFE_SID}.ts` and
  // `ext-read-<sid>.ts` are the same documented kind.
  const norm = s => s
    .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '*')
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '*')
    .replace(/\*+/g, '*');

  for (const full of files) {
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/\.claudemd-state\/([A-Za-z0-9._${}-]+)/g)) out.add(norm(m[1]));
    // Any variable whose name ENDS in STATE_DIR, not just the two spellings
    // someone happened to grep for. The first draft matched `$STATE_DIR` and
    // `$state_dir` only, and transcript-vocab-scan.sh builds its sentinel path
    // from `$VS_STATE_DIR` — so a whole per-session leak class was invisible to
    // the gate written to catch exactly that. Scope narrower than subject, in
    // the fix for scope narrower than subject.
    for (const m of src.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?\/([A-Za-z0-9._${}-]+)/g)) {
      if (/state_dir$/i.test(m[1])) out.add(norm(m[2]));
    }
    for (const m of src.matchAll(/stateDir\(\)\s*,\s*'([A-Za-z0-9._-]+)'/g)) out.add(norm(m[1]));
  }
  return out;
}

// Extraction artifacts and paths documented elsewhere in the file, each with a
// reason — an ignore entry is a claim someone can check, not a silencer.
const STATE_IGNORE = new Map([
  ['*', 'bare interpolation — a variable-only path with no literal stem to document'],
  ['*_*.sentinel', 'normalized from a fully-dynamic sentinel name built at runtime'],
  ['ext-read-', 'prefix fragment from an `rm -f` glob, not a distinct kind'],
  ['last-session-', 'prefix fragment from a line-wrapped path, not a distinct kind'],
  ['l2-task-counter.', 'trailing period is prose punctuation captured by the char class'],
  ['installed.json', 'pre-v0.1.9 legacy manifest location, documented in the manifest bullet above'],
]);

test('ARCHITECTURE.md State locations lists every state path the source writes', () => {
  const doc = fs.readFileSync(ARCH_DOC, 'utf8');
  const found = statePathsInSource();

  assert.ok(found.size >= 8,
    `state-path extraction returned only ${found.size} — parser or source shape changed. ` +
    `This gate must never validate an empty set.`);

  const missing = [...found]
    .filter(p => !STATE_IGNORE.has(p))
    // `ext-read-*.ts` in source vs `ext-read-<sid>.ts` in prose: compare on the
    // literal stem before the first wildcard, which is what a reader searches for.
    .filter(p => !doc.includes(p.split('*')[0]))
    .sort();

  assert.deepEqual(missing, [],
    `docs/ARCHITECTURE.md "State locations" is missing path(s) the source writes:\n` +
    missing.map(p => `  ${p}`).join('\n') +
    `\nDocument them, or add a STATE_IGNORE entry stating why the path is not a kind.`);
});
