// subject-set-drift.test.js — one gate for a defect CLASS this repo keeps
// re-creating: a file hand-copies a SUBSET of a set that has a single source,
// then asserts or documents something about "all" of it.
//
// Why a class gate rather than three more per-site tests (audit-2026-08-22,
// 条目 7 / 8 / 11 — and 条目 2 in the P1 batch before them):
//
//   - 4 eviction assertions each hand-copied a different subset of the 15 hook
//     names (15 / 10 / 8 / 8) and all four printed "0 claudemd hook entries
//     remain". A hook outside a given list could leak and that list stays green.
//   - clean-residue's USAGE named 4 of the 6 state classes `--apply` deletes.
//   - the kill-switch drift gate only knows the `DISABLE_*_HOOK` axis, so the
//     8 sub-feature toggles could go undocumented forever while
//     commands/claudemd-status.md advertised a "full kill-switch reference".
//
// The shape is always the same: a set with ONE source, a consumer that names
// part of it from memory, and no join back. So the check is generic —
// `assertEnumerationsComplete` takes the source-derived members and fails any
// enumeration that names ≥MIN of them but not all of them. A consumer gets to
// green exactly three ways, in preference order:
//
//   1. derive the list from the source at run time (grep for the source path),
//   2. name every member,
//   3. appear in EXEMPT below with a written reason — visible and reviewable,
//      not a silent skip.
//
// A partial list that is *deliberately* partial (doctor's liveness table) is
// still required to name its complement, so the union is checked against the
// source. See PARTITIONS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOOK_REGISTRY, HOOK_BASENAMES } from '../../scripts/lib/hook-registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIN_MEMBERS = 3;

function trackedFiles() {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Historical records, not live consumers: CHANGELOG entries describe what a
// past release did (rewriting them to match today's registry would falsify
// them), and docs/superpowers/ holds imported 2026-04 planning documents.
const OUT_OF_SCOPE = [
  /^CHANGELOG\.md$/,
  /^docs\/superpowers\//,
  /^docs\/audit\//,
  /^tasks\//,
  /^scripts\/lib\/hook-registry\.js$/, // the source itself
];

// Written reasons, one per exempted enumeration site. An entry here is a
// decision, not a skip: it says "this list is allowed to be partial and no
// completeness claim rides on it".
const EXEMPT = {
  'hooks/hooks.json':
    'Registration manifest — membership/event/matcher/timeout are gated field-by-field by hook-registry.test.js, which is a stronger join than this one.',
  'tests/scripts/doctor.test.js':
    'Fixture rows for specific hooks (rule-hits log lines with a `hook` field). No completeness claim: the assertions are per-row, and doctor.js own liveness coverage is gated by PARTITIONS below.',
  'tests/scripts/hook-registry.test.js':
    'The registry gate itself — it pins expected membership by hand ON PURPOSE, so that a bad edit to the registry has something to disagree with.',
  'scripts/doctor.js':
    'The liveness table is partial by design; its completeness is enforced by the PARTITIONS check below, which is stricter than this one (it requires the complement to be written out with a reason).',
};

// Deliberately partial lists that must name their complement. The union of the
// two extractions has to equal the source set, so adding a hook forces a
// decision (cover it, or say why not) instead of silently landing outside both.
const PARTITIONS = [
  {
    file: 'scripts/doctor.js',
    label: 'doctor liveness self-test',
    // The table entries: `{ hook: 'name.sh', ks: ksFor(...)`
    covered: src => [...src.matchAll(/\{\s*hook:\s*'([^']+\.sh)'/g)].map(m => m[1]),
    // The written-out complement: `LIVENESS_SKIPPED = [...]`
    skipped: src => {
      const block = src.match(/const LIVENESS_SKIPPED = \{([\s\S]*?)\n\s*\};/);
      if (!block) return null;
      return [...block[1].matchAll(/'([^']+\.sh)'\s*:/g)].map(m => m[1]);
    },
  },
];

/** Pull every hand-written enumeration out of a file.
 *
 * Two syntactic shapes carry this defect in this repo:
 *   - regex/jq alternation:  (a|b|c)
 *   - array literal:         ['a', 'b', 'c']
 * Both are extracted structurally rather than by scanning for names anywhere in
 * the file: prose that happens to mention three hooks in three paragraphs is
 * not a list anyone will forget to update, and treating it as one would make
 * the gate unusable in docs.
 */
function enumerationsIn(src, members) {
  const canon = s => s.trim().replace(/\\/g, '').replace(/\.sh$/, '');
  const memberSet = new Set(members.map(canon));
  const out = [];
  for (const m of src.matchAll(/\(([^()\n]*\|[^()\n]*)\)/g)) {
    const hit = m[1].split('|').map(canon).filter(s => memberSet.has(s));
    const uniq = new Set(hit);
    if (uniq.size >= MIN_MEMBERS) out.push({ kind: 'alternation', hit: uniq, text: m[0] });
  }
  for (const m of src.matchAll(/\[[^[\]]*\]/g)) {
    const hit = [...m[0].matchAll(/['"`]([^'"`]+?)['"`]/g)]
      .map(x => canon(x[1])).filter(s => memberSet.has(s));
    // Distinct members, not occurrences: status.js's SUB_FEATURE_TOGGLES names
    // session-start-check.sh in five `partOf` fields, which is one hook
    // mentioned five times, not five members of a list.
    const uniq = new Set(hit);
    if (uniq.size >= MIN_MEMBERS) out.push({ kind: 'array', hit: uniq, text: m[0] });
  }
  return out;
}

test('hook-name enumerations are complete, derived, or exempted with a reason', () => {
  const files = trackedFiles();
  assert.ok(files.length > 100, `git ls-files resolved ${files.length} file(s) — refusing to report a green scan over nothing`);

  const members = HOOK_BASENAMES;
  const canonMembers = members.map(b => b.replace(/\.sh$/, ''));
  const failures = [];
  let scanned = 0;
  let derived = 0;

  for (const rel of files) {
    if (OUT_OF_SCOPE.some(re => re.test(rel))) continue;
    if (EXEMPT[rel]) continue;
    let src;
    try { src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch { continue; }
    if (!src.includes('-check') && !src.includes('-audit') && !src.includes('-scan')) continue;
    scanned++;
    // No file-level "it imports the registry, so trust it" escape. The first
    // control run for this gate proved why: injecting a 3-name literal back
    // into settings-merge.test.js did NOT redden it, because the file also
    // carried the registry import. Importing the source and hand-copying part
    // of it in the same file is precisely the state this gate exists to catch.
    // A file that genuinely derives has no literal enumeration to find.
    const enums = enumerationsIn(src, members);
    if (!enums.length) { derived++; continue; }
    for (const e of enums) {
      const missing = canonMembers.filter(n => !e.hit.has(n));
      if (missing.length) {
        failures.push(
          `${rel}: hand-written ${e.kind} names ${e.hit.size}/${canonMembers.length} hooks, missing [${missing.join(', ')}]\n` +
          `      ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`,
        );
      }
    }
  }

  assert.deepEqual(
    failures, [],
    'Hand-copied hook lists drift. Derive from scripts/lib/hook-registry.js, name every hook, ' +
    `or add the file to EXEMPT with a reason:\n      ${failures.join('\n      ')}`,
  );
  assert.ok(scanned > 20, `only ${scanned} file(s) reached the enumeration scan — the pre-filter is too tight to prove anything`);
});

test('deliberately partial hook lists name their complement', () => {
  for (const p of PARTITIONS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, p.file), 'utf8');
    const covered = p.covered(src);
    const skipped = p.skipped(src);
    assert.ok(skipped !== null, `${p.file}: ${p.label} has no written complement — a hook added tomorrow lands in neither list and nothing notices`);
    const union = new Set([...covered, ...skipped]);
    const missing = HOOK_BASENAMES.filter(b => !union.has(b));
    const unknown = [...union].filter(b => !HOOK_BASENAMES.includes(b));
    assert.deepEqual(missing, [], `${p.file}: ${p.label} covers neither-nor for [${missing.join(', ')}] — add it to the table or to the skip map with a reason`);
    assert.deepEqual(unknown, [], `${p.file}: ${p.label} names [${unknown.join(', ')}], which are not in the registry`);
    assert.ok(covered.length >= 1, `${p.file}: extraction found 0 covered entries — the regex stopped matching, so this gate is asserting nothing`);
  }
});

// ---------------------------------------------------------------- toggles ---
// Second axis of the same class. kill-switch-doc-drift.test.js gates the
// per-hook `DISABLE_*_HOOK` family; the sub-feature toggles (banners,
// advisories, the rule-hits log) were outside every gate, and two of them
// (DISABLE_SPEC_DRIFT_BANNER, DISABLE_RULE_HITS_LOG) had zero README mentions
// while commands/claudemd-status.md promised a "full kill-switch reference".

const PER_HOOK_SUFFIXES = new Set(HOOK_REGISTRY.map(h => h.envVarSuffix));

function subFeatureToggles() {
  const dirs = ['hooks', 'hooks/lib', 'scripts', 'scripts/lib', 'bin'];
  const found = new Map(); // env var → file that reads it
  for (const d of dirs) {
    let entries;
    try { entries = fs.readdirSync(path.join(REPO_ROOT, d)); } catch { continue; }
    for (const f of entries) {
      if (!/\.(sh|js)$/.test(f)) continue;
      const rel = `${d}/${f}`;
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const m of src.matchAll(/\bDISABLE_([A-Z][A-Z0-9_]*)\b/g)) {
        const suffix = m[1];
        const envVar = `DISABLE_${suffix}`;
        if (envVar === 'DISABLE_CLAUDEMD_HOOKS') continue;      // plugin-wide, its own README block
        if (suffix === 'X_HOOK') continue;                       // USAGE placeholder in status.js
        if (suffix.endsWith('_HOOK') && PER_HOOK_SUFFIXES.has(suffix.replace(/_HOOK$/, ''))) continue;
        if (!found.has(envVar)) found.set(envVar, rel);
      }
    }
  }
  return found;
}

test('sub-feature kill switches are documented in README', () => {
  const toggles = subFeatureToggles();
  assert.ok(toggles.size >= 5, `only ${toggles.size} sub-feature toggle(s) extracted — the extraction broke, not the docs`);
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  // Word-boundary, not `includes`: the first control run renamed the README's
  // DISABLE_SPEC_DRIFT_BANNER to DISABLE_SPEC_DRIFT_BANNER_XX and the gate
  // stayed green, because a substring match is satisfied by any longer name.
  const documented = v => new RegExp(`\\b${v}\\b`).test(readme);
  const undocumented = [...toggles].filter(([v]) => !documented(v))
    .map(([v, f]) => `${v} (honored in ${f})`);
  assert.deepEqual(
    undocumented, [],
    `sub-feature kill switches a user cannot discover:\n      ${undocumented.join('\n      ')}`,
  );
});

test('status --verbose enumerates the sub-feature toggles it promises', () => {
  // commands/claudemd-status.md:3 sells `--verbose` as a "full kill-switch
  // reference". Before this, verbose emitted only the registry-derived per-hook
  // block, so "full" was false by 8 entries.
  const cmdDoc = fs.readFileSync(path.join(REPO_ROOT, 'commands/claudemd-status.md'), 'utf8');
  if (!/full kill-switch/i.test(cmdDoc)) return; // claim withdrawn → nothing to hold it to
  const statusSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/status.js'), 'utf8');
  assert.match(
    statusSrc, /subFeature/,
    'commands/claudemd-status.md advertises a full kill-switch reference, but status.js --verbose has no sub-feature group',
  );
  const toggles = [...subFeatureToggles().keys()];
  const missing = toggles.filter(v => !statusSrc.includes(v.replace(/^DISABLE_/, '')));
  assert.deepEqual(missing, [], `status --verbose omits sub-feature toggle(s): ${missing.join(', ')}`);
});

// ------------------------------------------------------- ephemeral state ---
// Third axis: `clean-residue.js --apply` deletes 6 classes of per-session state
// while its USAGE and slash-command doc named 4. The array is the source; the
// prose has to be able to name every kind in it.

function ephemeralKinds() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/clean-residue.js'), 'utf8');
  const block = src.match(/const STATE_EPHEMERAL = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'STATE_EPHEMERAL array not found in clean-residue.js — extraction broke');
  return [...block[1].matchAll(/re:\s*\/\^([a-z-]+)-/g)].map(m => m[1]);
}

test('clean-residue prose names every state class it deletes', () => {
  const kinds = ephemeralKinds();
  assert.ok(kinds.length >= 6, `extracted ${kinds.length} state class(es) from STATE_EPHEMERAL — expected at least 6`);
  const consumers = ['scripts/clean-residue.js', 'commands/claudemd-clean-residue.md'];
  for (const rel of consumers) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    // The USAGE string and the command doc both describe the same scope in prose.
    const prose = rel.endsWith('.js')
      ? src.match(/const USAGE = `([\s\S]*?)`;/)[1]
      : src;
    // `k + '-'`, not bare `k`: the prose deliberately names the sid-less
    // singletons it does NOT delete ("session-start.ref", "tmp-baseline.txt"),
    // and a bare substring test is satisfied by those — the control run for
    // this gate deleted `session-start-<sid>.ref` from the USAGE and the gate
    // stayed green. The trailing dash is what makes it the per-session form.
    const missing = kinds.filter(k => !prose.includes(`${k}-`));
    assert.deepEqual(
      missing, [],
      `${rel} describes the destructive scope without naming [${missing.join(', ')}] — what it tells the user is narrower than what it deletes`,
    );
  }
});
