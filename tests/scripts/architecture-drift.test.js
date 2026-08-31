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
import { hookEmittedSections } from '../lib/emitted-sections.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOKS_DIR = path.join(ROOT, 'hooks');
const ARCH_DOC = path.join(ROOT, 'docs/ARCHITECTURE.md');

// Extractor lives in tests/lib/emitted-sections.mjs — the single source both
// this gate and hard-rules-drift.test.js read (2026-08-29 audit R10-17a).
const emittedSections = () => hookEmittedSections(HOOKS_DIR);

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
// Returns Map<normalized-name, family> where family is 'state' (lives in
// ~/.claude/.claudemd-state) or 'tmp' (the $TMPDIR claudemd-* sentinel family).
// The ARCHITECTURE.md gate below wants both; the uninstall join at the end of
// this file wants only the state-dir half, since that is all its regex covers.
function statePathsInSource() {
  const out = new Map();
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
    for (const m of src.matchAll(/\.claudemd-state\/([A-Za-z0-9._${}-]+)/g)) out.set(norm(m[1]), 'state');
    // Any variable whose name ENDS in STATE_DIR, not just the two spellings
    // someone happened to grep for. The first draft matched `$STATE_DIR` and
    // `$state_dir` only, and transcript-vocab-scan.sh builds its sentinel path
    // from `$VS_STATE_DIR` — so a whole per-session leak class was invisible to
    // the gate written to catch exactly that. Scope narrower than subject, in
    // the fix for scope narrower than subject.
    for (const m of src.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?\/([A-Za-z0-9._${}-]+)/g)) {
      if (/state_dir$/i.test(m[1])) out.set(norm(m[2]), 'state');
    }
    for (const m of src.matchAll(/stateDir\(\)\s*,\s*'([A-Za-z0-9._-]+)'/g)) out.set(norm(m[1]), 'state');
    // $TMPDIR-family state (audit-2026-08-22 条目 15). The three matchers above
    // all key on the state DIRECTORY, so a whole sentinel family living under
    // $TMPDIR was structurally invisible to this gate: version-sync.sh has
    // written `$TMP_BASE/claudemd-sync-$SCOPE` since v0.3.1 and
    // hooks/lib/memory-tags.sh spills `claudemd-memtags-hay-*` there, and
    // neither appeared in the inventory this test claims to be checking. The
    // gate's scope was narrower than its subject — again, and this time in a
    // gate written to close that exact class. Keyed on the `claudemd-` prefix,
    // which is what makes a file in a shared temp dir ours.
    for (const m of src.matchAll(/\$\{?[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}?\/(claudemd-[A-Za-z0-9.*_${}-]+)/g)) {
      out.set(norm(m[1]).replace(/X{3,}$/, '*'), 'tmp');
    }
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
  // Only the bullet LIST counts, not the whole file. The section's closing
  // paragraph explains which families the extractor covers and names them, so
  // a whole-file `includes` is satisfied by the prose ABOUT the gate — verified:
  // deleting the `$TMPDIR/claudemd-sync-<scope>` bullet left this test green
  // because the paragraph below still said "claudemd-sync-*". A check a
  // document can satisfy by describing itself is not a check.
  const full = fs.readFileSync(ARCH_DOC, 'utf8');
  const section = full.match(/^## State locations$([\s\S]*?)^(?=[^-\n])/m);
  assert.ok(section, 'docs/ARCHITECTURE.md has no "## State locations" bullet list — the extraction anchor moved');
  // A path counts as documented only when it is the SUBJECT of a bullet — the
  // first backticked token — not when it appears anywhere in the prose. Second
  // control: deleting the `session-summary-<sid>.lastrun` bullet still left the
  // stem inside another bullet's explanatory clause, so the whole-bullet-text
  // form stayed green on a deleted entry too.
  const subjects = section[1].split('\n')
    .filter(l => l.startsWith('- '))
    .map(l => (l.match(/`([^`]+)`/) || [])[1])
    .filter(Boolean);
  const doc = subjects.join('\n');
  assert.ok(subjects.length >= 15, `State-locations list resolved ${subjects.length} bullet subject(s) — too few to be the real inventory`);
  const found = new Set(statePathsInSource().keys());

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

// --- 2026-08-29 audit R10-13: uninstall's state-file regex had no join ------
//
// scripts/uninstall.js carries CLAUDEMD_STATE_FILE_RE, a hand-copied list of
// the stems claudemd writes into its state dir, used on the --purge branch that
// refuses to recurse into a non-canonically-named CLAUDEMD_STATE_DIR. The stems
// happened to be correct on the day they were written and nothing held them
// there: `grep -rn CLAUDEMD_STATE_FILE_RE tests/ scripts/` found the definition
// and nothing else, while the extractor above already derives the same set.
// subject-set-drift covers the hook-name / DISABLE / prose axes, not this one.
//
// The failure is quiet by construction — an unmatched stem is skipped, i.e.
// residue survives an explicit purge — so it would never surface as a bug
// report. Joined here rather than in a new file because this is where the
// single source of the set already lives.
test('R10-13: uninstall CLAUDEMD_STATE_FILE_RE matches every state path the source writes', async () => {
  const { CLAUDEMD_STATE_FILE_RE } = await import('../../scripts/uninstall.js');
  const stateOnly = [...statePathsInSource()]
    .filter(([, family]) => family === 'state')
    .map(([name]) => name)
    .filter(name => !STATE_IGNORE.has(name))
    // A bare/leading interpolation carries no literal stem to match on.
    .filter(name => !name.startsWith('*'));

  assert.ok(stateOnly.length >= 8,
    `state-family extraction returned only ${stateOnly.length} — this join must never validate an empty set`);

  const unmatched = stateOnly.filter(name => !CLAUDEMD_STATE_FILE_RE.test(name)).sort();
  assert.deepEqual(unmatched, [],
    `scripts/uninstall.js CLAUDEMD_STATE_FILE_RE does not match state file(s) the source writes:\n` +
    unmatched.map(n => `  ${n}`).join('\n') +
    `\n--purge would leave these behind on a non-canonically-named state dir.`);
});

test('R10-13: the join is capable of failing (mutation control)', () => {
  // A join whose predicate can never be false is decoration. Drop one stem from
  // the regex and the same comparison must name it. `statusline-prev` is the
  // dropped stem: it is genuinely in the extracted set, unlike `installed.json`
  // (a STATE_IGNORE entry) — a mutation the filters swallow proves nothing, and
  // the first draft of this control picked exactly that one.
  const mutated = /^(ext-read-|failopen-|mem-coverage-|vocab-scan-|session-start|tmp-baseline|session-summary|upstream-check|last-session-summary|bootstrap-failed|l2-task-counter|ship-baseline-recent|mem-audit\.lastrun|installed\.json)/;
  const stateOnly = [...statePathsInSource()]
    .filter(([, family]) => family === 'state')
    .map(([name]) => name)
    .filter(name => !STATE_IGNORE.has(name) && !name.startsWith('*'));
  const unmatched = stateOnly.filter(name => !mutated.test(name));
  assert.ok(unmatched.length > 0,
    'dropping `statusline-prev` from the regex left the join green — the predicate cannot fail');
});
