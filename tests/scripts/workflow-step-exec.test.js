// The publish gate's shell steps are EXECUTED here, against a fixture git
// repository, instead of being read as text.
//
// Round-14 audit REL-M5 added a "Verify the tagged commit is on main" step to
// npm-publish.yml, and it shipped with `git fetch --no-tags --depth=0`. In git,
// `--depth=0` is not "no limit" — it is an invalid value rejected during
// argument parsing (`fatal: depth 0 is not a positive number`, exit 128). The
// step body opens with `set -eu`, so that aborts the step, fails the `publish`
// job, and `npm publish --provenance` never runs: every tag from that release
// onward would have published nothing to npm while the marketplace channel,
// which has no gate at all, still served the tag.
//
// Nothing in the repo could have caught it. Four files mention npm-publish.yml
// and all four read it as TEXT — actions-sha-pin.test.js for the SHA pins,
// contributing-rollback-drift.test.js for the `needs:` string. A step body that
// parses as YAML and fails as shell is invisible to every one of them.
//
// So this file runs the body. It is deliberately narrow: only steps whose
// behaviour is decidable in a fixture repo belong here. Steps that need the
// network, npm credentials or a real runner do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/npm-publish.yml');

/**
 * The bounds of the `publish` job: [first line, first line of the next job).
 *
 * Round 2 anchored on `nameIdx > jobIdx`, which is a LOWER bound and not
 * membership — `publish:` happens to be the last job today, so a step moved
 * into a new job appended after it still satisfied it, and the uniqueness
 * check (computed over the whole file) was satisfied too because the step
 * still occurred once. `npm publish` then ran with no ancestry check in its
 * job at all, suite green (v0.81.0 round-3 review, HIGH-2).
 */
function publishJob(src) {
  const start = src.findIndex(l => l === '  publish:');
  assert.notEqual(start, -1, 'npm-publish.yml has no `publish:` job');
  const after = src.findIndex((l, i) => i > start && /^ {2}[A-Za-z]/.test(l));
  const end = after === -1 ? src.length : after;
  // A job-level guard disables every step in it, which is strictly worse than
  // disabling one step — and it sits at 4 spaces, invisible to the step-level
  // check below (round-3 review, HIGH-3).
  const header = src.slice(
    start,
    src.findIndex((l, i) => i > start && /^ {6}- /.test(l))
  );
  assert.ok(
    !header.some(l => /^ {4}if\s*:/.test(l)),
    'the publish job carries a job-level `if:` — none of its steps may run in CI, so executing one here proves nothing'
  );
  return { start, end };
}

/**
 * The `run:` body of a named step in the `publish` job, dedented.
 *
 * ANCHORED ON THE JOB, unique by name, and refused if the step is conditional.
 * The first draft found `- name: <name>` anywhere in the file and executed the
 * first `run: |` after it, so an `if: false` on the real step left it green and
 * a same-name decoy above a gutted step made it run the dead copy — the same
 * "reads the first match, not the subject" defect the `needs:` gate one file
 * over was repaired for.
 */
function stepBody(stepName) {
  const src = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const { start: jobIdx, end: jobEnd } = publishJob(src);

  const hits = src.map((l, i) => (l.trim() === `- name: ${stepName}` ? i : -1)).filter(i => i >= 0);
  assert.equal(
    hits.length,
    1,
    `npm-publish.yml must name the step ${JSON.stringify(stepName)} exactly once, found ${hits.length} — ` +
      'more than one means a decoy, and this extractor would run whichever came first'
  );
  const nameIdx = hits[0];
  assert.ok(
    nameIdx > jobIdx && nameIdx < jobEnd,
    `step ${JSON.stringify(stepName)} is not inside the publish job — a step that has moved to another ` +
      'job is not a gate on publishing, however correct its body is'
  );

  // The step's own key block, bounded by the JOB as well as by the next step:
  // a body must never be borrowed across a job boundary.
  const nextStep = src.findIndex((l, i) => i > nameIdx && /^ {6}- /.test(l));
  assert.ok(
    nextStep !== -1 || jobEnd === src.length,
    'no following step at 6-space indent — this file has been re-indented, and every anchor here reads the wrong block'
  );
  const stepEnd = Math.min(nextStep === -1 ? jobEnd : nextStep, jobEnd);
  const keys = src.slice(nameIdx, stepEnd);
  assert.ok(
    !keys.some(l => /^ {8}if\s*:/.test(l)),
    `step ${JSON.stringify(stepName)} carries an \`if:\` guard — it may not run in CI at all, so ` +
      'executing its body here would prove nothing'
  );

  const runOffset = keys.findIndex(l => /^\s*run: \|\s*$/.test(l));
  assert.notEqual(
    runOffset,
    -1,
    `step ${JSON.stringify(stepName)} has no block \`run: |\` of its own (\`|-\` and \`|+\` are ` +
      'valid YAML and deliberately not accepted — they change trailing-newline handling)'
  );
  const runIdx = nameIdx + runOffset;

  const first = src[runIdx + 1];
  assert.ok(
    first !== undefined && first.trim() !== '',
    `step ${JSON.stringify(stepName)}: the body's first line is blank, so its indent cannot be read`
  );
  const indent = first.match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIdx + 1; i < stepEnd; i++) {
    const line = src[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  const text = body.join('\n').trimEnd();
  assert.ok(text.length > 0, `step ${JSON.stringify(stepName)} has an empty body`);
  return text;
}

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });

/**
 * origin with `main`, plus a clone whose HEAD is an annotated tag.
 * `onMain: false` puts the tag on a commit that never reached main.
 */
function fixture({ onMain }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-wfstep-'));
  const origin = path.join(root, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  // FIVE commits, with the tag two behind the tip — the shape of every real
  // release, and the shape a one-commit main cannot express (v0.81.0 round-2
  // review, MEDIUM-2). Against a single commit, changing the fetch to
  // `--depth=1` stayed green while refusing every real tag in CI.
  for (const n of ['one', 'two', 'three']) {
    fs.writeFileSync(path.join(origin, 'f.txt'), `${n}\n`);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', n);
  }

  if (!onMain) {
    git(origin, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(origin, 'f.txt'), 'two\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'not on main');
  }
  const tagged = git(origin, 'rev-parse', 'HEAD').trim();
  git(origin, 'tag', '-a', 'v9.9.9', '-m', 'v9.9.9');
  git(origin, 'checkout', '-q', 'main');
  if (onMain) {
    // Two more on main AFTER the tag: the atomic ship flow pushes main and then
    // the tag, and a later commit must not invalidate an in-flight publish.
    for (const n of ['four', 'five']) {
      fs.writeFileSync(path.join(origin, 'f.txt'), `${n}\n`);
      git(origin, 'add', '-A');
      git(origin, 'commit', '-q', '-m', n);
    }
  }

  const checkout = path.join(root, 'checkout');
  git(root, 'clone', '-q', origin, checkout);
  git(checkout, 'checkout', '-q', 'v9.9.9');
  return { root, checkout, tagged };
}

/** Run a step body the way a GitHub `run:` block runs it. */
function runStep(body, cwd, env) {
  return spawnSync('bash', ['-e', '-c', body], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('REL-M5: the main-ancestry step passes for a tag whose commit is on main', () => {
  const body = stepBody('Verify the tagged commit is on main');
  const { root, checkout, tagged } = fixture({ onMain: true });
  try {
    const r = runStep(body, checkout, { GITHUB_SHA: tagged, GITHUB_REF_NAME: 'v9.9.9' });
    assert.equal(
      r.status,
      0,
      `the step must succeed on a tag that IS on main.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`
    );
    assert.match(r.stdout, /OK: .* is reachable from origin\/main/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REL-M5: the main-ancestry step refuses a tag whose commit never reached main', () => {
  // The control. Without it, a step that exits 0 unconditionally would satisfy
  // the case above — which is the shape this gate is here to reject.
  const body = stepBody('Verify the tagged commit is on main');
  const { root, checkout, tagged } = fixture({ onMain: false });
  try {
    const r = runStep(body, checkout, { GITHUB_SHA: tagged, GITHUB_REF_NAME: 'v9.9.9' });
    assert.equal(
      r.status,
      1,
      `the step must refuse an unmerged tag.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`
    );
    assert.match(r.stdout, /::error::tag v9\.9\.9 points at .* not on origin\/main/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REL-M5: the version-match step compares the tag against package.json', () => {
  // Same family, same fixture shape: a step body whose failure mode is shell,
  // not YAML. It has always been correct; running it keeps it that way and
  // proves the extractor above is not the only thing under test.
  const body = stepBody('Verify package.json version matches the tag');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-wfver-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3' }));
    const ok = runStep(body, root, { GITHUB_REF_NAME: 'v1.2.3' });
    assert.equal(ok.status, 0, `matching version must pass.\nstdout: ${ok.stdout}\nstderr: ${ok.stderr}`);
    const bad = runStep(body, root, { GITHUB_REF_NAME: 'v9.9.9' });
    assert.equal(bad.status, 1, 'a tag that disagrees with package.json must refuse');
    assert.match(bad.stdout, /::error::tag v9\.9\.9 ≠ package\.json version 1\.2\.3/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REL-M5: the publish job checks out full history, which merge-base needs', () => {
  // Anchored on the CHECKOUT STEP, not on a range (v0.81.0 round-3 review,
  // HIGH-1). The first draft sliced from `publish:` to the first NAMED step —
  // and the job's first two steps are unnamed — so it answered "does
  // `fetch-depth: 0` appear anywhere in that span". Moving the key onto
  // setup-node's `with:` block left the publish checkout shallow and the gate
  // green, which is the precise false negative this case says it prevents.
  const src = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const { start: jobIdx, end: jobEnd } = publishJob(src);
  const coIdx = src.findIndex(
    (l, i) => i > jobIdx && i < jobEnd && /^ {6}- uses: actions\/checkout@/.test(l)
  );
  assert.notEqual(coIdx, -1, 'the publish job has no actions/checkout step');
  const next = src.findIndex((l, i) => i > coIdx && /^ {6}- /.test(l));
  const checkout = src.slice(coIdx, Math.min(next === -1 ? jobEnd : next, jobEnd));
  assert.ok(
    checkout.some(l => /^\s*fetch-depth: 0\s*$/.test(l)),
    "the publish job's checkout step must set `fetch-depth: 0` — the ancestry step's merge-base " +
      'cannot answer over a shallow object store'
  );
});

test('REL-M4: the publish step derives its dist-tag, so a prerelease cannot take `latest`', () => {
  // Round-17 REL-M4. The trigger is `v*.*.*`, which `v1.0.0-rc.1` satisfies, and
  // `npm publish` with no `--tag` writes `dist-tags.latest` — the tag a cold
  // `npx claudemd-cli` resolves, and README's quick start is an `npx` line. The
  // first prerelease ever tagged would have become what every new user installs.
  //
  // The step BODY is executed, against an `npm` shim that records its argv: a
  // regex over the YAML would be satisfied by the string `--tag` appearing in a
  // comment, which is how the neighbouring gates in this file were written wrong
  // the first time.
  const body = stepBody('Publish to npm');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-wfdist-'));
  try {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const argvLog = path.join(root, 'npm-argv.txt');
    fs.writeFileSync(
      path.join(bin, 'npm'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > ${JSON.stringify(argvLog)}\n`
    );
    fs.chmodSync(path.join(bin, 'npm'), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}` };

    const publishedTag = version => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version }));
      fs.rmSync(argvLog, { force: true });
      const r = runStep(body, root, env);
      assert.equal(
        r.status,
        0,
        `the step must succeed for ${version}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`
      );
      const argv = fs.readFileSync(argvLog, 'utf8');
      const m = argv.match(/--tag (\S+)/);
      assert.ok(m, `npm was invoked without --tag for ${version}: ${argv}`);
      return m[1];
    };

    assert.equal(publishedTag('1.2.3'), 'latest', 'a release must still take the latest dist-tag');
    assert.equal(publishedTag('1.2.3-rc.1'), 'next', 'a prerelease must not take the latest dist-tag');
    assert.equal(publishedTag('2.0.0-beta.4'), 'next', 'any prerelease identifier, not just rc');
    // Build metadata is not a prerelease and must stay on `latest` — the `-`
    // test is about the semver prerelease separator, not about punctuation.
    assert.equal(publishedTag('1.2.3+build.9'), 'latest', 'build metadata is not a prerelease');
    // Build-metadata identifiers may themselves contain hyphens (semver BNF), so a
    // `*-*` match over the whole version string reads `1.2.3+build-9` as a prerelease
    // and would ship a release to `next`. The `+build.9` case above does not reach this.
    assert.equal(
      publishedTag('1.2.3+build-9'),
      'latest',
      'a hyphen inside build metadata is not a prerelease separator'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REL-L3: every workflow declares its own top-level permissions', () => {
  // Round-17 REL-L3. With no `permissions:` block the GITHUB_TOKEN takes the
  // repository-wide default, which a settings change can widen without touching
  // any file in this tree. ci.yml runs on `pull_request`, so that token is in
  // scope for whatever the matrix executes.
  const dir = path.join(REPO_ROOT, '.github/workflows');
  const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 2, `expected several workflows, found ${files.length}`);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(
      src,
      // `permissions: {}` is the STRICTEST declaration GitHub offers, and a
      // block-mapping-only pattern rejected it: rewriting ci.yml that way took this
      // suite to 5/6, i.e. the gate whose purpose is least privilege failed a
      // tightening (0.92.0 pre-ship review, F7). Both forms count as declared.
      /^permissions:[ \t]*(\{[ \t]*\}|\n[ \t]+\S+:)/m,
      `.github/workflows/${f} declares no top-level permissions: block, so its GITHUB_TOKEN inherits the repository default`
    );
  }
});
