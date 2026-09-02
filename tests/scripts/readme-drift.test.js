// readme-drift.test.js — locks README claims that have drifted before
// (QA loop 2026-07-11: 6 of 8 findings were README↔implementation drift).
// Two mechanically checkable classes:
//   1. §Project layout counts (commands/*.md, scripts/*.js) vs the filesystem.
//   2. Opt-in gated hooks (`[[ "${VAR:-0}" == "1" ]] || exit 0`) that appear
//      in the "Hooks (what fires when)" table must say "Opt-in" in their row —
//      the transcript-vocab-scan row shipped without it and read as
//      default-active.
// Sibling of kill-switch-doc-drift.test.js (env-var list) — same philosophy,
// different README surfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const README = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

test('README §Project layout: commands count matches commands/*.md', () => {
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'commands')).filter(f => f.endsWith('.md')).length;
  const m = README.match(/├── commands\/\s+# (\d+) slash-command/);
  assert.ok(m, 'README §Project layout commands/ line with a count not found');
  assert.equal(Number(m[1]), actual, `README says ${m[1]} slash-command files, commands/ has ${actual}`);
});

test('README §Project layout: scripts count matches scripts/*.js', () => {
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'scripts')).filter(f => f.endsWith('.js')).length;
  const m = README.match(/├── scripts\/\s+# (\d+) Node\.js scripts/);
  assert.ok(m, 'README §Project layout scripts/ line with a count not found');
  assert.equal(Number(m[1]), actual, `README says ${m[1]} Node.js scripts, scripts/ has ${actual}`);
});

test('README "N shell hooks" count(s) match hooks/*.sh', () => {
  // TEST-2 (roadmap): the "16 shell hooks" claim appears twice (§capabilities
  // table row + §Project layout tree) and was previously guarded only
  // indirectly via HOOK_REGISTRY.length in hook-registry.test.js — the README
  // text itself could drift silently (a hook added without bumping the number).
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'hooks')).filter(f => f.endsWith('.sh')).length;
  const counts = [...README.matchAll(/(\d+) shell hooks/g)].map(m => Number(m[1]));
  assert.ok(counts.length >= 2, `expected ≥2 "N shell hooks" mentions in README, found ${counts.length}`);
  for (const c of counts) {
    assert.equal(c, actual, `README says "${c} shell hooks" but hooks/ has ${actual} .sh files`);
  }
});

test('README §capabilities hook list enumerates exactly the real hooks/*.sh', () => {
  // Stronger than the count alone: the ·-separated enumerated row must name
  // every hook and only real hooks — catches a hook silently dropped from the
  // table (or a renamed/stale entry) even if the number still happens to match.
  const actual = fs
    .readdirSync(path.join(REPO_ROOT, 'hooks'))
    .filter(f => f.endsWith('.sh'))
    .map(f => f.replace(/\.sh$/, ''))
    .sort();
  const row = README.split('\n').find(l => /\|\s*\d+ shell hooks\s*\|/.test(l));
  assert.ok(row, '§capabilities "N shell hooks" table row not found');
  const listed = [...row.matchAll(/`([a-z0-9-]+)`/g)].map(m => m[1]).sort();
  assert.deepEqual(
    listed,
    actual,
    `README hook list ≠ hooks/*.sh.\n  only in README: ${listed.filter(h => !actual.includes(h))}\n  only on disk:   ${actual.filter(h => !listed.includes(h))}`
  );
});

test('README hooks table: every opt-in gated hook with a table row says Opt-in', () => {
  const hooksDir = path.join(REPO_ROOT, 'hooks');
  const optInHooks = fs
    .readdirSync(hooksDir)
    .filter(f => f.endsWith('.sh'))
    .filter(f => {
      const src = fs.readFileSync(path.join(hooksDir, f), 'utf8');
      return /\[\[ "\$\{[A-Z0-9_]+:-0\}" == "1" \]\] \|\| exit 0/.test(src);
    })
    .map(f => f.replace(/\.sh$/, ''));
  assert.ok(optInHooks.length >= 2, `expected ≥2 opt-in gated hooks, found: ${optInHooks}`);

  // "what fires when" table rows: | trigger | `hook-name` ... | description |
  const tableRows = README.split('\n').filter(l => /^\|.+\|.+\|.+\|$/.test(l));
  for (const hook of optInHooks) {
    const row = tableRows.find(l => l.includes(`\`${hook}\``) && !l.includes('DISABLE_'));
    if (!row) continue; // not in the fires-when table — nothing to mislead
    assert.match(
      row,
      /[Oo]pt-in/,
      `hooks/${hook}.sh is opt-in gated but its README table row does not say "Opt-in":\n${row}`
    );
  }
});

// --- 2026-08-29 audit R10-14: behavioural claims a reader acts on ----------
//
// The two classes above cover counts and opt-in labels. These cover PROSE that
// tells a user how the software behaves — the widest problem surface this
// audit round found, and the one with no gate at all: README said hook 3 has
// no fast-path (it has had one since 0.68.x) and docs/HOOK-PROTOCOL.md listed
// five readers of `tool_use_id` where six exist, in a document created to stop
// the next hook author re-deriving this from source.

const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');
const hookSources = () =>
  fs
    .readdirSync(HOOKS_DIR)
    .filter(f => f.endsWith('.sh'))
    .map(f => ({ name: f, src: fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8') }));
// Comment lines are excluded before matching: a fix commit that documents the
// old spelling in prose would otherwise match its own description
// (feedback_self_referential_marker_regex).
const codeOf = src =>
  src
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');

test('R10-14: README does not claim a PreToolUse:Bash hook lacks the readonly fast-path', () => {
  const withFastPath = hookSources()
    .filter(h => /hook_is_readonly_bash/.test(codeOf(h.src)))
    .map(h => h.name.replace(/\.sh$/, ''))
    .sort();
  assert.ok(withFastPath.length >= 4, `expected >= 4 hooks with the fast-path, found ${withFastPath.length}`);

  const para = README.split('\n').find(l => l.includes('**Readonly fast-path**'));
  assert.ok(para, 'README "Readonly fast-path" paragraph not found — the anchor moved');
  // The specific false shape: naming a numbered subset, or excusing one hook.
  assert.doesNotMatch(
    para,
    /hooks? \d(,| and )/,
    `the fast-path paragraph names a numbered subset while all ${withFastPath.length} Bash hooks carry it:\n${para}`
  );
  assert.doesNotMatch(
    para,
    /fast-path doesn't apply|fast-path does not apply/,
    `the fast-path paragraph excuses a hook that in fact has the fast-path:\n${para}`
  );
});

// A hook reads an event field either directly or through a hook-common helper
// that reads it on the hook's behalf. R10-23 moved session_id / tool_use_id /
// cwd behind `hook_read_telemetry_ids` and tool_name / command behind
// `hook_read_bash_fields`, which made four real readers invisible to a
// source-literal derivation — caught here by this gate's own `>= 3` premise
// floor rather than by a silently shortened list.
//
// The helper→field mapping is derived from hook-common.sh, not written down: a
// hand-copied mapping is the same drift one level in.
function helperFields() {
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'hooks/lib/hook-common.sh'), 'utf8');
  const map = new Map();
  for (const m of lib.matchAll(/^(hook_read_[a-z_]+)\(\)\s*\{([\s\S]*?)\n\}/gm)) {
    map.set(m[1], m[2]);
  }
  return map;
}

test('R10-14: HOOK-PROTOCOL.md field-reader lists match the hooks that read them', () => {
  const proto = fs.readFileSync(path.join(REPO_ROOT, 'docs/HOOK-PROTOCOL.md'), 'utf8');
  const helpers = helperFields();
  assert.ok(
    helpers.size >= 2,
    `expected >= 2 hook_read_* helpers in hook-common.sh, found ${helpers.size} — ` +
      `the indirection this derivation follows was renamed or removed.`
  );
  for (const field of ['tool_use_id', 'transcript_path']) {
    const fieldRe = new RegExp(`\\.${field}`);
    const viaHelper = [...helpers].filter(([, body]) => fieldRe.test(body)).map(([name]) => name);
    const readers = hookSources()
      .filter(h => {
        const code = codeOf(h.src);
        return fieldRe.test(code) || viaHelper.some(fn => new RegExp(`\\b${fn}\\b`).test(code));
      })
      .map(h => h.name)
      .sort();
    assert.ok(readers.length >= 3, `expected >= 3 readers of ${field}, found ${readers.length}`);

    // The bullet that introduces the field, up to the next bullet.
    const m = proto.match(new RegExp(`^- \`${field}\`[\\s\\S]*?(?=\\n- \`|\\n\\n)`, 'm'));
    assert.ok(m, `docs/HOOK-PROTOCOL.md has no "- \`${field}\`" bullet`);
    const missing = readers.filter(r => !m[0].includes(r));
    assert.deepEqual(
      missing,
      [],
      `docs/HOOK-PROTOCOL.md's ${field} reader list omits hook(s) that read it:\n` +
        missing.map(r => `  ${r}`).join('\n')
    );

    // Reverse: a hook named as a reader must still read it.
    const named = [...m[0].matchAll(/`([a-z0-9-]+\.sh)`/g)].map(x => x[1]);
    const stale = named.filter(n => !readers.includes(n)).sort();
    assert.deepEqual(
      stale,
      [],
      `docs/HOOK-PROTOCOL.md lists hook(s) as ${field} readers that no longer read it:\n` +
        stale.map(r => `  ${r}`).join('\n')
    );
  }
});
