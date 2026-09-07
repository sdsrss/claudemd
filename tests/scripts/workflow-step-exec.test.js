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
 * The `run:` body of a named step, dedented.
 *
 * Extracted rather than copied: a copy would let the workflow and the thing
 * under test drift apart, which is the whole defect class this file exists for.
 */
function stepBody(stepName) {
  const src = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const nameIdx = src.findIndex(l => l.trim() === `- name: ${stepName}`);
  assert.notEqual(nameIdx, -1, `npm-publish.yml has no step named ${JSON.stringify(stepName)}`);
  const runIdx = src.findIndex((l, i) => i > nameIdx && /^\s*run: \|\s*$/.test(l));
  assert.notEqual(runIdx, -1, `step ${JSON.stringify(stepName)} has no block \`run: |\``);
  const indent = src[runIdx + 1].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIdx + 1; i < src.length; i++) {
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
  fs.writeFileSync(path.join(origin, 'f.txt'), 'one\n');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'one');

  if (!onMain) {
    git(origin, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(origin, 'f.txt'), 'two\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'not on main');
  }
  const tagged = git(origin, 'rev-parse', 'HEAD').trim();
  git(origin, 'tag', '-a', 'v9.9.9', '-m', 'v9.9.9');
  git(origin, 'checkout', '-q', 'main');

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
