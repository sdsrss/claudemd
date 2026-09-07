// CONTRIBUTING.md and docs/ROLLBACK.md were the two shipped docs no gate read
// (Round-14 audit REL-L1), and both had drifted from the thing they describe:
// CONTRIBUTING named four steps of a five-step `npm run lint` and said `docs/`
// is untracked when `docs/audit/*.md` is tracked, while ROLLBACK's headline
// claim about the npm gate named a `needs:` list that has since changed.
//
// Every assertion here joins a doc sentence to a machine-readable source — a
// package.json script, a workflow key, a file on disk — so the doc cannot be
// half-updated. Claims that are prose about intent are deliberately NOT gated;
// they are what a reviewer is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** The sub-scripts `npm run lint` chains, in order. */
function lintChain(lintScript) {
  return [...lintScript.matchAll(/npm run ([\w:-]+)/g)].map(m => m[1]);
}

/** The step names CONTRIBUTING lists for `npm run lint`, in order. */
function documentedLintChain(contributing) {
  const m = contributing.match(/`npm run lint` \(= ([^)]*)\)/s);
  assert.ok(m, 'CONTRIBUTING.md: could not find the `npm run lint` step list');
  return [...m[1].matchAll(/`([\w:-]+)`/g)].map(x => x[1]);
}

test('REL-L1: CONTRIBUTING lists every step `npm run lint` actually runs, in order', () => {
  const actual = lintChain(pkg.scripts.lint);
  assert.ok(actual.length >= 4, `package.json lint chain looks empty: ${pkg.scripts.lint}`);
  assert.deepEqual(
    documentedLintChain(read('CONTRIBUTING.md')),
    actual,
    'CONTRIBUTING.md names a different set or order of lint steps than package.json runs'
  );
});

test('REL-L1: the lint-chain join is capable of failing (mutation control)', () => {
  const mutated = 'npm run lint:argv && npm run version-check && npm run lint:sh';
  assert.notDeepEqual(documentedLintChain(read('CONTRIBUTING.md')), lintChain(mutated));
});

test('REL-L1: every `npm run <script>` CONTRIBUTING offers exists in package.json', () => {
  const named = [...read('CONTRIBUTING.md').matchAll(/`npm run ([\w:-]+)`/g)].map(m => m[1]);
  assert.ok(named.length >= 5, `expected CONTRIBUTING to name several scripts, found ${named.length}`);
  const missing = [...new Set(named)].filter(n => !(n in pkg.scripts));
  assert.deepEqual(missing, [], 'CONTRIBUTING.md offers a script package.json does not define');
});

test('REL-L1: every docs/ file CONTRIBUTING points at exists', () => {
  const named = [...read('CONTRIBUTING.md').matchAll(/`(docs\/[A-Za-z0-9._/-]+\.md)`/g)].map(m => m[1]);
  assert.ok(named.length >= 4, `expected CONTRIBUTING to point at several docs, found ${named.length}`);
  const missing = [...new Set(named)].filter(p => !fs.existsSync(path.join(REPO_ROOT, p)));
  assert.deepEqual(missing, [], 'CONTRIBUTING.md points at a doc that is not in the tree');
});

test('REL-L1: CONTRIBUTING does not claim docs/ is wholly untracked', () => {
  // `.gitignore` carries `docs/*` plus an allowlist, and `!docs/audit/` is in
  // it — the round reports are tracked. The old sentence ("`docs/` is
  // ignore-by-default", offered as the reason no baseline is checked in) read
  // as "nothing under docs/ is in git".
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^!docs\/audit\/$/m, 'the allowlist entry this test is about is gone');
  const c = read('CONTRIBUTING.md');
  assert.match(
    c,
    /docs\/audit/,
    'CONTRIBUTING.md describes docs/ as ignore-by-default without naming the tracked round reports under docs/audit/'
  );
  assert.match(
    c,
    /tracked allowlist/,
    'CONTRIBUTING.md does not tell the reader that the .gitignore carries an allowlist'
  );
});

test('REL-H1: ROLLBACK states the npm gate that npm-publish.yml actually declares — both ways', () => {
  // ANCHORED on the sentence that names the workflow (v0.81.0 round-3 review,
  // MEDIUM-1). The forward half searched the whole doc for any `needs:` line
  // carrying the job name and the over-state half read the doc's FIRST
  // `needs: [...]` phrase, so adding one plausible sentence about a different
  // workflow let the headline drift to `needs: [test]` with both halves green.
  // One extraction, one set comparison, so under- and over-stating both fail.
  const declared = publishNeeds(read('.github/workflows/npm-publish.yml'));
  const m = read('docs/ROLLBACK.md').match(/needs:\s*\[([^\]]*)\][^\n]*npm-publish\.yml/);
  assert.ok(
    m,
    'docs/ROLLBACK.md no longer describes the npm-publish gate with a `needs: [...]` phrase naming the workflow'
  );
  const named = m[1]
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  assert.ok(named.length > 0, 'the doc names no jobs — this check would pass over nothing');
  assert.deepEqual(
    named.slice().sort(),
    declared.slice().sort(),
    `docs/ROLLBACK.md and npm-publish.yml disagree about the publish gate: doc says [${named}], workflow requires [${declared}]`
  );
});

function publishNeeds(wf) {
  const publishIdx = wf.indexOf('\n  publish:');
  assert.notEqual(publishIdx, -1, 'npm-publish.yml has no `publish:` job');
  // `[^\\S\\n]*`, not `\\s*`: the latter spans the newline, so a `needs:` written
  // as a YAML block sequence captured only its first item with the `- ` marker
  // and the failure blamed the doc (v0.81.0 round-3 review, LOW-1). Refusing to
  // match across a line makes the assert below fire honestly instead.
  const m = wf.slice(publishIdx).match(/^ {4}needs:[^\S\n]*(\S[^\n]*)$/m);
  assert.ok(m, 'npm-publish.yml: no `needs:` on the publish job');
  return m[1]
    .replace(/[[\]]/g, '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

test('REL-H1: the publish-job anchoring ignores a `needs:` on an earlier job', () => {
  // A resident case, not a one-time mutation of the real file (v0.81.0 round-2
  // review, LOW-2): reverting the anchoring to the first-match regex it replaced
  // left the whole node leg green, so nothing held the repair in place.
  const decoy = [
    'jobs:',
    '  static:',
    '    needs: [decoy-should-not-be-read]',
    '    runs-on: ubuntu-latest',
    '  publish:',
    '    needs: [test, static]',
    '    runs-on: ubuntu-latest',
    '',
  ].join('\n');
  assert.deepEqual(publishNeeds(decoy), ['test', 'static']);
});

test('REL-H1: the revert route names the three mechanisms that make a bare revert invisible', () => {
  // The section used to say a plain `git revert && git push` reaches users via
  // the upgrade banner. It does not: all three of these refuse or ignore a
  // version that is not HIGHER than the installed one, and a revert produces no
  // tag. Each string is asserted against the source that implements it, so the
  // doc cannot outlive the behaviour it describes.
  const rollback = read('docs/ROLLBACK.md');
  assert.match(rollback, /would downgrade/, 'ROLLBACK.md no longer cites the version-sync skip');
  assert.match(
    read('hooks/version-sync.sh'),
    /would downgrade/,
    'version-sync.sh no longer skips on downgrade'
  );

  assert.match(rollback, /CLAUDEMD_ALLOW_DOWNGRADE/, 'ROLLBACK.md no longer cites the install refusal');
  assert.match(read('scripts/install.js'), /CLAUDEMD_ALLOW_DOWNGRADE/);

  assert.match(
    rollback,
    /revert produces no\s+tag|revert produces no tag/,
    'ROLLBACK.md no longer states that a revert produces no tag'
  );
});
