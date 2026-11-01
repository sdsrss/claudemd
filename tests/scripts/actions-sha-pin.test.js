// actions-sha-pin.test.js — every third-party GitHub Action this repo runs must
// be referenced by an immutable commit SHA, not by a moving tag.
//
// 2026-09-02 audit R11-33, the one item in that batch that needed authorisation
// (§5 hard: CI config). `actions/checkout@v6` is a branch-like ref the upstream
// owner can repoint at any commit at any time. npm-publish.yml's publish job
// has `id-token: write`, which npm trusted publishing exchanges for a publish
// credential, so a repointed tag in any step of that job executes
// attacker-chosen code that can publish to npm under this package's name and
// mint its provenance attestation. The
// marketplace channel is worse in one respect: it serves the tag directly and
// `ci.yml` only reports, so nothing about a compromised run would look red.
//
// A SHA pin costs manual updates. That is the trade, and it is why every pinned
// ref carries a trailing `# vX.Y.Z` comment: without it the workflow becomes a
// wall of hex that nobody can tell is nine months stale. The comment is
// documentation, NOT the thing that runs — which is exactly why the test below
// asserts on both halves separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

// Floors, not exact counts: a workflow may legitimately gain or drop a step.
// What may not happen is the parser resolving nothing and this file reporting a
// green pin over an empty set (feedback_gate_must_report_its_cardinality — the
// count that matters is of the judged subject, and a gate that cannot judge its
// subject has to be red rather than quiet).
const WORKFLOW_FLOOR = 2;
const USES_FLOOR = 5;

// Workflows that legitimately run no actions at all (`run:`-only). Empty today.
// It exists because the "read no steps" failure below used to tell the reader to
// "drop them from this floor deliberately" while offering nowhere to drop them:
// adding a plain `run:`-only workflow turned the gate red and the only way out
// was editing the test. A promised affordance that does not exist is worse than
// no affordance — the next person edits the predicate instead of the list.
const NO_ACTION_WORKFLOWS = [];

// `uses:` as a YAML key. Not a substring search: the workflows explain
// themselves at length, and a comment or an `echo "uses: …"` inside a `run: |`
// block is prose, not a step. Comment lines are dropped first for the same
// reason the repo files under feedback_gate_reads_prose_not_code — twice,
// including once in a gate written to close that very class.
//
// Two spellings, because block form is not the only legal one. The pre-tag
// review of this release drove 14 shapes through the first version and found
// `- {uses: actions/checkout@v6}` and `steps: [{uses: …}]` — both valid GitHub
// Actions YAML — parsing to ZERO steps: a `{` between the `- ` and the `uses:`
// made the line invisible, and the per-file "read no steps" assertion cannot
// see it because such a step lives in a file whose other steps parse fine.
//
// Surrounding quotes are stripped: `uses: 'actions/checkout@<sha>'` is a
// correct pin, and leaving the quote on made the 40-hex test read 41 characters
// and fail it — a gate that reddens on a properly pinned step is as broken as
// one that greens on an unpinned one, just louder.
const stripQuotes = s => s.replace(/^['"]/, '').replace(/['"]$/, '');

function stepUses(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    // The trailing comment is taken from the LINE, not from what follows the
    // ref, so the version comment is found in either spelling.
    const c = raw.match(/#.*$/);
    const rest = c ? c[0].trim() : '';
    const anchored = raw.match(/^\s*-?\s*uses:\s*(\S+)/);
    if (anchored) {
      out.push({ line: i + 1, ref: stripQuotes(anchored[1]), rest });
      return;
    }
    for (const m of raw.matchAll(/[[{,]\s*uses:\s*(["']?)([^\s,}\]"']+)/g)) {
      out.push({ line: i + 1, ref: m[2], rest });
    }
  });
  return out;
}

// Local composite actions (`./.github/actions/x`) have no upstream ref to move,
// so there is nothing for a SHA to pin. This shape does not exist in the repo
// today; the rule is written down so that adding one does not read as an
// exemption someone invented at the time.
//
// `docker://` is NOT exempt, and the first version of this file said it was on
// the grounds that "container refs have no upstream tag to move". That reason
// is false — `docker://alpine:3.14` is exactly as repointable as
// `actions/checkout@v6`, by the same mechanism. What differs is only the
// spelling of a pin, so the predicate differs and the exemption does not.
const isLocal = ref => ref.startsWith('./');
const isContainer = ref => ref.startsWith('docker://');

// A container ref is pinned by digest (`image@sha256:<64 hex>`); an action ref
// is pinned by commit SHA (40 hex). Full-length only, in both cases: git
// resolves an abbreviated prefix and GitHub rejects it, so accepting one would
// certify a workflow that cannot run.
function isPinned(ref) {
  if (isContainer(ref)) return /@sha256:[0-9a-f]{64}$/.test(ref);
  const at = ref.lastIndexOf('@');
  return at !== -1 && /^[0-9a-f]{40}$/.test(ref.slice(at + 1));
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

test('the workflow scan resolves the set it claims to judge', t => {
  const files = workflowFiles();
  assert.ok(
    files.length >= WORKFLOW_FLOOR,
    `only ${files.length} workflow file(s) under .github/workflows — under the floor of ` +
      `${WORKFLOW_FLOOR}. Two empty sets pin equally well, so this fails before any pin check.`
  );

  // Per file, not just in total: a parse that silently returns nothing for one
  // workflow is how a whole file stops being judged while the aggregate count
  // still clears its floor.
  const silent = files.filter(
    f =>
      !NO_ACTION_WORKFLOWS.includes(f) &&
      stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length === 0
  );
  assert.deepEqual(
    silent,
    [],
    `workflow file(s) from which no \`uses:\` step could be read: ${silent.join(', ')}. ` +
      'Either the parser no longer recognises the step shape and is certifying a file it cannot ' +
      'see, or this workflow genuinely runs no actions — in which case add it to ' +
      'NO_ACTION_WORKFLOWS above, deliberately and in the open. There is no implicit exemption.'
  );

  const total = files.reduce(
    (n, f) => n + stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length,
    0
  );
  assert.ok(
    total >= USES_FLOOR,
    `${total} \`uses:\` step(s) resolved across ${files.length} workflow(s), under the floor of ${USES_FLOOR}`
  );
  t.diagnostic(`${total} uses: step(s) across ${files.length} workflow(s): ${files.join(', ')}`);
});

test('R11-33: every third-party action is pinned to an immutable digest', t => {
  const unpinned = [];
  let judged = 0;
  for (const f of workflowFiles()) {
    for (const { line, ref } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (isLocal(ref)) continue;
      judged++;
      if (!isPinned(ref)) unpinned.push(`${f}:${line}: ${ref}`);
    }
  }
  t.diagnostic(`${judged} third-party action reference(s) judged`);
  assert.ok(judged >= USES_FLOOR, `only ${judged} third-party reference(s) judged — nothing to certify`);
  assert.deepEqual(
    unpinned,
    [],
    'GitHub Action(s) referenced by a mutable tag or branch:\n      ' +
      unpinned.join('\n      ') +
      "\n      A tag is a pointer its owner can repoint; npm-publish.yml's publish job publishes with " +
      'id-token: write (npm trusted publishing). Pin an action to its full commit SHA (and a container to its ' +
      '@sha256: digest), and keep a trailing `# vX.Y.Z` comment.'
  );
});

test('R11-33: every pinned SHA carries the version it was pinned at', () => {
  const undocumented = [];
  for (const f of workflowFiles()) {
    for (const { line, ref, rest } of stepUses(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (isLocal(ref) || !isPinned(ref)) continue;
      if (!/^#\s*v?\d+\.\d+\.\d+/.test(rest)) undocumented.push(`${f}:${line}: ${ref} ${rest}`.trim());
    }
  }
  assert.deepEqual(
    undocumented,
    [],
    'pinned action(s) with no `# vX.Y.Z` comment saying which release the SHA is:\n      ' +
      undocumented.join('\n      ') +
      '\n      The SHA is what runs; the comment is the only thing that makes it maintainable.'
  );
});

test('R11-33: both pin predicates can return false (mutation control)', () => {
  // Against the two shapes drift actually takes: a step re-written back to a
  // tag, and a SHA pasted in without the version comment. Asserted on the
  // parser + predicate pair rather than on a hand-read string, because the
  // failure this repo keeps filing is a control that never made the predicate
  // false (feedback_probe_harness_controls_first).
  const SHA = '0'.repeat(40);
  const one = line => {
    const s = stepUses(line);
    assert.equal(
      s.length,
      1,
      `the parser read ${s.length} step(s) from \`${line.trim()}\` — control vacuous`
    );
    return s[0];
  };

  // Must be judged UNPINNED. Every entry is a shape the pre-tag review of this
  // release drove through by hand; encoding them is the difference between a
  // reviewer having checked once and the gate checking on every run.
  for (const line of [
    '      - uses: actions/checkout@v6',
    '      - uses: actions/checkout@main',
    `      - uses: actions/checkout@${SHA.slice(0, 7)}`, // abbreviated is not a pin
    `      - uses: actions/checkout@${'A'.repeat(40)}`, // uppercase hex is not what git prints
    '      - uses: actions/checkout@v6 # v6.1.0', // the comment must not stand in for the ref
    "      - uses: 'actions/checkout@v6'",
    '      - {uses: actions/checkout@v6}', // flow mapping — invisible to the first version
    '    steps: [{uses: actions/checkout@v6}]',
    '      - uses: docker://alpine:3.14', // a registry tag moves like any other
    '      - uses: some-org/reusable/.github/workflows/x.yml@main',
  ]) {
    assert.ok(!isPinned(one(line).ref), `this shape satisfied isPinned and must not: ${line.trim()}`);
  }

  // Must be judged PINNED — a gate that reddens on a correct pin is as broken as
  // one that greens on a bad one, and the quoted form cost exactly that.
  for (const line of [
    `      - uses: actions/checkout@${SHA}`,
    `      - uses: "actions/checkout@${SHA}"`,
    `      - {uses: actions/checkout@${SHA}}`,
    `      - uses: docker://alpine@sha256:${'a'.repeat(64)}`,
  ]) {
    assert.ok(isPinned(one(line).ref), `this shape is a correct pin and was rejected: ${line.trim()}`);
  }

  // The version comment is read from the line in either spelling, and its
  // absence is what the second predicate keys on.
  assert.ok(!/^#\s*v?\d+\.\d+\.\d+/.test(one(`      - uses: actions/checkout@${SHA}`).rest));
  assert.ok(/^#\s*v?\d+\.\d+\.\d+/.test(one(`      - {uses: actions/checkout@${SHA}} # v6.1.0`).rest));

  // Comments are not steps: the header of this very file writes `uses:` inside
  // prose, and both workflows explain their own steps at length.
  assert.equal(
    stepUses('      # - uses: actions/checkout@v6\n').length,
    0,
    'a commented-out step was read as a real one'
  );

  // Local composite actions are the only exemption, and it must stay narrow.
  assert.ok(isLocal('./.github/actions/build'));
  assert.ok(!isLocal('actions/checkout@v6') && !isLocal('docker://alpine:3.14'));
});

// ── what the CI installs may run (0.117.2 pre-tag review M1) ──
// Without a lockfile (D#612) the static jobs' `npm install` resolves the
// devDependencies' own dependencies fresh on every run, with no integrity pin,
// so every install passes `--ignore-scripts`, and the job that can mint an OIDC
// token (provenance; with npm trusted publishing, the publish credential)
// installs nothing: `id-token: write` belongs to npm-publish.yml's publish job.

// The code part of each line: a full-line comment becomes '', an inline one is
// cut at a `#` that follows whitespace (`${GITHUB_REF_NAME#v}` keeps its `#`).
function codeLines(text) {
  return text.split('\n').map((l, i) => ({ line: i + 1, code: l.replace(/(^|\s)#.*$/, '') }));
}

// npm's install family with every alias `npm <cmd> --help` lists (npm 11.19.0:
// install, ci, install-test, install-ci-test), as a word anywhere after `npm`,
// so options in front of it (`npm --prefix . install`) do not hide it (round 2
// L2: `npm add`, `npm cit` and that shape went unseen).
const NPM_INSTALL_RE =
  /\bnpm\b[^\n]*?\s(?:install|add|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|ci|clean-install|ic|install-clean|isntall-clean|install-test|it|install-ci-test|cit|clean-install-test|sit)(?=\s|$)/;
// `--ignore-scripts` or `--ignore-scripts=true`; `=false` turns scripts back on.
const IGNORE_SCRIPTS_RE = /\s--ignore-scripts(?:=true)?(?=\s|$)/;
// A grant of the OIDC token: `id-token: write` in block or flow form, quoted
// or not, or `permissions: write-all`, which grants every scope.
const ID_TOKEN_GRANT_RE =
  /\bid-token\s*:\s*(['"]?)write\1(?=[\s,}]|$)|\bpermissions\s*:\s*(['"]?)write-all\2(?=[\s,}]|$)/;

test('M1: every npm install / npm ci in a workflow passes --ignore-scripts', () => {
  const installs = [];
  for (const f of workflowFiles()) {
    for (const { line, code } of codeLines(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (NPM_INSTALL_RE.test(code)) installs.push({ at: `${f}:${line}`, code: code.trim() });
    }
  }
  assert.ok(
    installs.length >= 2,
    `only ${installs.length} npm install step(s) found — the scan is not reading them`
  );
  assert.deepEqual(
    installs.filter(i => !IGNORE_SCRIPTS_RE.test(i.code)).map(i => `${i.at}: ${i.code}`),
    [],
    'an npm install without --ignore-scripts runs whatever install script an unlocked dependency ships'
  );
});

test("M1: id-token: write is granted to npm-publish.yml's publish job only", () => {
  const grants = [];
  for (const f of workflowFiles()) {
    for (const { line, code } of codeLines(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (ID_TOKEN_GRANT_RE.test(code)) grants.push({ f, line });
    }
  }
  const lines = fs.readFileSync(path.join(WORKFLOW_DIR, 'npm-publish.yml'), 'utf8').split('\n');
  const start = lines.findIndex(l => /^ {2}publish:\s*$/.test(l));
  assert.notEqual(start, -1, 'npm-publish.yml has no `publish:` job');
  let end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l));
  if (end === -1) end = lines.length;
  const inPublish = g => g.f === 'npm-publish.yml' && g.line > start && g.line <= end;
  assert.deepEqual(
    grants.filter(g => !inPublish(g)).map(g => `${g.f}:${g.line}`),
    [],
    'id-token: write granted outside the publish job'
  );
  assert.equal(grants.length, 1, `expected one id-token grant, found ${grants.length}`);
});

test('M1: the patterns see the shapes they guard and skip comments (mutation control)', () => {
  const code = s => codeLines(s)[0].code;
  for (const yes of [
    '  id-token: write  # required for provenance',
    "  id-token: 'write'",
    '  id-token: "write"',
    '    permissions: { contents: read, id-token: write }',
    'permissions: write-all',
    "    permissions: 'write-all'",
  ]) {
    assert.ok(ID_TOKEN_GRANT_RE.test(code(yes)), `grant not seen: ${yes}`);
  }
  for (const no of [
    '# id-token: write is granted below',
    '  id-token: read',
    '  id-token: none',
    'permissions: read-all',
  ]) {
    assert.ok(!ID_TOKEN_GRANT_RE.test(code(no)), `not a grant: ${no}`);
  }
  for (const yes of [
    '      - run: npm install --ignore-scripts # x',
    '      - run: npm ci',
    '      - run: npm --prefix . install',
    '      - run: npm add eslint',
    '      - run: npm cit',
    '      - run: npm i',
  ]) {
    assert.ok(NPM_INSTALL_RE.test(code(yes)), `install not seen: ${yes}`);
  }
  for (const no of [
    '        run: npm run lint:js',
    '          npm publish --provenance --access public --tag "$dist_tag"',
    '      - run: npm run install-deps',
    '  group: npm-publish-${{ github.ref }}',
  ]) {
    assert.ok(!NPM_INSTALL_RE.test(code(no)), `not an install: ${no}`);
  }
  assert.ok(IGNORE_SCRIPTS_RE.test('npm install --ignore-scripts --no-audit'));
  assert.ok(IGNORE_SCRIPTS_RE.test('npm ci --ignore-scripts=true'));
  assert.ok(!IGNORE_SCRIPTS_RE.test('npm install --ignore-scripts=false --no-audit'));
  assert.equal(code('          tag="${GITHUB_REF_NAME#v}"'), '          tag="${GITHUB_REF_NAME#v}"');
});

// ── npm trusted publishing (OIDC) ──
// npm 11 tries OIDC first and, when the exchange fails, falls back to a token
// in the environment, logging the failure only in verbose output. With a token
// the package accepts, a wrong trust configuration on npmjs.com would still
// publish with the job green. claudemd-cli refuses tokens today (0.117.2's
// token publish got E403), so keeping every npm token out of the workflows
// means a green publish went through OIDC, and it stays that way if the
// package setting is ever relaxed.
// Secret names resolve case-insensitively, so `secrets.npm_token` is the same
// secret (0.117.3 review M2), and only full-line comments are skipped: a ` #`
// inside a quoted run-script string is not a comment (review L2).
const TOKEN_RE = /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b|_authToken|toJSON\(\s*secrets\s*\)|\bsecrets\s*\[/i;
const nonCommentLines = text =>
  text.split('\n').map((l, i) => ({ line: i + 1, code: /^\s*#/.test(l) ? '' : l }));

test('trusted publishing: no workflow supplies an npm token outside a full-line comment', t => {
  const hits = [];
  let judged = 0;
  for (const f of workflowFiles()) {
    for (const { line, code } of nonCommentLines(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))) {
      if (code.trim() === '') continue;
      judged++;
      if (TOKEN_RE.test(code)) hits.push(`${f}:${line}: ${code.trim()}`);
    }
  }
  t.diagnostic(`${judged} non-comment workflow line(s) judged`);
  assert.ok(judged >= 100, `only ${judged} non-comment line(s) read — the scan is not reading the workflows`);
  assert.deepEqual(
    hits,
    [],
    'npm token reference(s) in a workflow:\n      ' +
      hits.join('\n      ') +
      '\n      npm-publish.yml publishes through npm trusted publishing. With a token the package ' +
      'accepts, npm falls back to it when the OIDC exchange fails, so a wrong trust configuration ' +
      'publishes anyway and the job stays green. Fix the npmjs.com trusted publisher (organization ' +
      'or user, repository, workflow filename, environment, allowed actions incl. npm publish) instead.'
  );
});

test('trusted publishing: the token pattern sees the shapes it guards (mutation control)', () => {
  const code = s => nonCommentLines(s)[0].code;
  for (const yes of [
    '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}',
    '        env: { NODE_AUTH_TOKEN: x }',
    '          npm config set //registry.npmjs.org/:_authToken "${{ secrets.npm_token }}"',
    '          export T="$(echo \'${{ toJSON(secrets) }}\' | jq -r .npm_token)"',
    "          T=${{ secrets['NPM_TOKEN'] }}",
    '          echo "step #1"; export NODE_AUTH_TOKEN="${{ secrets.NPM_TOKEN }}"',
  ]) {
    assert.ok(TOKEN_RE.test(code(yes)), `token not seen: ${yes}`);
  }
  for (const no of [
    '# Required repo secret: NPM_TOKEN',
    '        # NODE_AUTH_TOKEN is not set here',
    '      id-token: write',
    '          npm publish --provenance --access public --tag "$dist_tag"',
  ]) {
    assert.ok(!TOKEN_RE.test(code(no)), `not a token: ${no}`);
  }
});
