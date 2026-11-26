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

test('REL-H1: ROLLBACK names every check the publish job runs before publishing', () => {
  // From 0.123.0 the publish job has no `needs:`: it re-ran no tests and checks
  // the release PR's green ci run instead. The doc names each `Verify …` step
  // the job declares, so a check added or dropped there is a red here.
  const wf = read('.github/workflows/npm-publish.yml');
  const publishIdx = wf.indexOf('\n  publish:');
  assert.notEqual(publishIdx, -1, 'npm-publish.yml has no `publish:` job');
  const steps = [...wf.slice(publishIdx).matchAll(/^ {6}- name: (Verify [^\n]+)$/gm)].map(m => m[1].trim());
  assert.ok(steps.length >= 3, `only ${steps.length} Verify step(s) found — the extraction broke`);
  const doc = read('docs/ROLLBACK.md').replace(/\s+/g, ' ');
  for (const step of steps) {
    assert.ok(doc.includes(`"${step}"`), `docs/ROLLBACK.md does not name the publish check "${step}"`);
  }
});

test('0.82.0: ROLLBACK names the rulesets it describes, and their load-bearing rules', () => {
  // The ruleset paragraph added in 0.82.0 is repo STATE, not intent — a UI click
  // changes it and nothing in the tree would notice (0.82.0 pre-tag review,
  // MEDIUM-5: the commit reported "16/16 pass" beside "both places are updated",
  // and none of those 16 read a sentence it had changed). The expectation file is
  // written from `gh api …/rulesets`; reading rulesets needs admin scope, which
  // the Actions GITHUB_TOKEN does not have, so this join is offline-only: it
  // catches the DOC drifting from the file, not the file drifting from GitHub.
  const expected = JSON.parse(read('.github/rulesets.expected.json'));
  const rollback = read('docs/ROLLBACK.md');
  assert.ok(expected.rulesets.length >= 2, 'the expectation file lists fewer than two rulesets');
  for (const rs of expected.rulesets) {
    assert.ok(
      rollback.includes(rs.name),
      `docs/ROLLBACK.md does not name the ruleset \`${rs.name}\` that .github/rulesets.expected.json records`
    );
  }
  const tagRs = expected.rulesets.find(r => r.target === 'tag');
  assert.ok(tagRs, 'no tag-target ruleset in the expectation file');
  assert.ok(
    tagRs.rules.includes('update') && tagRs.rules.includes('deletion'),
    "the tag ruleset must block update and deletion — ROLLBACK's claim that a published version " +
      'string cannot be repointed at different code rests on both, and npm-publish.yml repeats it'
  );
  assert.equal(
    tagRs.bypass_actors,
    0,
    'a bypass actor on the tag ruleset makes the immutability claim in docs/ROLLBACK.md and in ' +
      "npm-publish.yml's main-ancestry comment false for that actor"
  );
  // The three assertions above read the expectation FILE, which is the file
  // checking itself; the doc side was only checked for two literal names. A
  // review mutation that rewrote ROLLBACK to "blocks deletion; moving a tag is
  // still allowed" — unsaying the claim npm-publish.yml repeats — left the suite
  // green (0.82.0 pre-tag review round 2). These give the doc, `enforcement` and
  // `ref_include` a consumer each.
  assert.match(
    rollback,
    new RegExp(`\`${tagRs.name}\`[^.]*${tagRs.rules.join('[^.]*')}`),
    `docs/ROLLBACK.md must restate the tag ruleset's rules (${tagRs.rules.join(', ')}) in order, ` +
      'in the sentence that names it — a doc that keeps the name and drops a rule is the ' +
      'half-updated shape this file exists to catch'
  );
  for (const rs of expected.rulesets) {
    assert.equal(
      rs.enforcement,
      'active',
      `${rs.name} is recorded as ${rs.enforcement}; a ruleset that is not active protects nothing, ` +
        'and both docs describe these as in force'
    );
    for (const ref of rs.ref_include) {
      assert.ok(
        rollback.includes(ref) || ref === '~DEFAULT_BRANCH',
        `docs/ROLLBACK.md does not name the refs ${rs.name} applies to (${ref})`
      );
    }
  }
});

test('REL-H1: ROLLBACK says who gates a red tag, pinned whole-line', () => {
  // Round-17 REL-H1. This doc claimed the ship runbook has a "wait for the tag's
  // CI to go green before `gh release create`" step and called that step "the only
  // thing standing between a red tag and marketplace consumers". The runbook has
  // no such step — it pushes the tag, creates the release immediately, and
  // verifies afterwards — and no step there could be one: consumers never read
  // the release object. This suite was 9/9 green over that sentence for two
  // releases, because everything it pins is job names, ruleset names and revert
  // mechanisms, and prose is not a job name.
  //
  // WHOLE LINE, exactly once. A substring join catches deletion and never
  // reversal: `, but a green tag CI is still required first` appended here would
  // satisfy any match on a fragment. The pin covers THIS line and nothing
  // adjacent — the required-status-check rationale above it and the tag-ruleset
  // immutability note below it are not constrained by this test.
  const CLAIM =
    'Nothing stands between a red tag and marketplace consumers, and no release-time step could: pushing the tag IS the marketplace publish.';
  const hits = read('docs/ROLLBACK.md')
    .split('\n')
    .filter(l => l.trim() === CLAIM);
  assert.equal(hits.length, 1, `docs/ROLLBACK.md must carry this line verbatim, exactly once:\n  ${CLAIM}`);

  // And it has to stay true, which rests on one mechanism: the upgrade banner
  // polls REFS, so the tag push is itself the thing consumers see.
  const sessionStart = read('hooks/session-start-check.sh');
  assert.match(
    sessionStart,
    /git ls-remote/,
    'session-start-check.sh no longer polls tags — the pinned claim rests on it'
  );
  assert.doesNotMatch(
    sessionStart,
    /gh release/,
    'session-start-check.sh now reads release objects, which would make the pinned claim false'
  );
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

test('D#434: the local rollback pins the marketplace this repo publishes, whole lines', () => {
  // ROLLBACK said "make the plugin Claude Code loads the old version first" and
  // never said how. The recipe it gives now was run in a scratch HOME; this
  // joins its command lines to the marketplace name and repository they must
  // name, so a rename cannot leave a recipe that adds some other marketplace.
  const mkt = JSON.parse(read('.claude-plugin/marketplace.json'));
  const plugin = mkt.plugins[0].name;
  const repo = pkg.repository.url.match(/github\.com\/([^/]+\/[^/.]+)(\.git)?$/)[1];
  const section = read('docs/ROLLBACK.md').split('## Local machine needs the previous version back')[1];
  assert.ok(section, 'ROLLBACK.md lost its local-rollback section');
  const lines = section.split('\n').map(l => l.trim());
  for (const want of [
    `claude plugin marketplace remove ${mkt.name}`,
    `claude plugin marketplace add ${repo}#vX.Y.Z`,
    `claude plugin install ${plugin}@${mkt.name}`,
    `\`CLAUDEMD_ALLOW_DOWNGRADE=1 node ~/.claude/plugins/cache/${mkt.name}/${plugin}/X.Y.Z/scripts/install.js\`.`,
  ]) {
    assert.ok(lines.includes(want), `ROLLBACK.md local rollback is missing the line: ${want}`);
  }
});
