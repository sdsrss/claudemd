// spec-status-drift.test.js — a plan in tasks/specs/ that still says `approved`
// must still be an OPEN commitment.
//
// The defect this is written against: tasks/specs/s8-shared-tokenizer.md carried
// `status: approved` — "approved and not implemented, the oldest open commitment
// in specs/" — while every function it plans (`s8_split_segments`,
// `s8_strip_wrappers`, `S8_WRAP_ARGLESS`) had shipped in 8f39e37 and had since
// grown from the planned two consumers to four. The stale line was read as fact
// twice: once by the tasks/ index, once by an audit ledger, and both times the
// answer to "what is still owed here?" was wrong in the direction that costs the
// most — it invents work that is already done.
//
// Nothing related the claim to the tree. Frontmatter and the index agreed with
// each other, so a status-to-index join — the obvious gate, and the shape this
// repo reaches for — would have passed: they were both wrong together. The only
// reading that means anything is the one against the source
// (feedback_audit_finding_verify_vs_source).
//
// Scope note: tasks/INDEX.md is NOT tracked (tasks/ is ignore-by-default with a
// whitelist), so it cannot be an arm of a gate that has to run from a fresh
// checkout. The seven spec files are tracked and are the whole subject here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KNOWN_STATUSES = ['draft', 'approved', 'implemented', 'rejected'];

// Statuses that assert the work is NOT done yet, and so can be contradicted by
// the tree. `draft` is in the set because of the second instance, found by hand
// the same day this file shipped: tasks/specs/routing-single-source.md was
// executed in d801dd1 on the day it was written and sat at `status: draft` for
// 113 days. The first version of this gate judged `approved` only and would
// have walked past it — the drift does not care which of the two open words the
// header uses. A draft that plans to CHANGE existing symbols still passes: it
// has to declare every one of them as an artifact it produces, and a plan to
// modify does not.
const OPEN_STATUSES = ['approved', 'draft'];

// Floor over the whole spec set, not over the open subset. Zero open specs is
// the correct steady state — every commitment met — so an empty subset must be
// allowed to pass, and the thing that has to be non-empty is the set the
// machinery walked to get there. What the floor cannot do is tell an empty
// subset from an unevaluated one; that is the second test's job, below.
const SPEC_FLOOR = 5;

function trackedSpecs() {
  return execFileSync('git', ['ls-files', 'tasks/specs/*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

const statusOf = (text) => (text.match(/^status:[ \t]*(\S+)/m) || [])[1];

// Only a backtick token IMMEDIATELY after the marker counts as a declared
// artifact. `- Produces: a test asserting … \`CURLSH_WRAP\` …` names a symbol it
// REFERENCES, not one it creates, and counting that would let a spec be judged
// complete on someone else's work. Arguments after the name are dropped:
// `s8_split_segments <multiline-cmd>` declares `s8_split_segments`.
function declaredArtifacts(text) {
  return [...text.matchAll(/^- Produces: `([^`]+)`/gm)]
    .map((m) => m[1].split(/\s+/)[0])
    .filter((n) => /^[A-Za-z_][\w.-]*$/.test(n));
}

// The haystack deliberately excludes tasks/specs/ itself: a plan naming the
// function it intends to write is not an implementation of it, and a gate that
// counted it would report every approved spec as complete on the day it was
// written. Narrative files are out for the same reason — a CHANGELOG entry or an
// audit doc describing the work is prose about code, not code
// (feedback_gate_reads_prose_not_code). Comment lines are stripped from what is
// left, so a `# see s8_strip_wrappers` note cannot stand in for a call.
function codeHaystack() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('tasks/specs/'))
    .filter((f) => !f.startsWith('docs/'))
    .filter((f) => f !== 'CHANGELOG.md');
  const paths = new Set(files.map((f) => path.basename(f)));
  let code = '';
  for (const f of files) {
    if (!/\.(sh|js|mjs|json|tsv)$/.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    code += text.split('\n')
      .map((l) => l.replace(/(^|\s)(#|\/\/).*$/, ''))
      .join('\n');
    code += '\n';
  }
  return { code, paths };
}

test('every tracked spec carries a known status', () => {
  const specs = trackedSpecs();
  assert.ok(specs.length >= SPEC_FLOOR,
    `only ${specs.length} tracked spec(s) under tasks/specs/ (floor ${SPEC_FLOOR}) — ` +
    'the glob matched nothing or the layout moved; refusing to report a clean status scan over that few.');
  const bad = [];
  for (const s of specs) {
    const st = statusOf(fs.readFileSync(path.join(ROOT, s), 'utf8'));
    if (!KNOWN_STATUSES.includes(st)) bad.push(`${s} — status: ${st ?? '<missing>'}`);
  }
  assert.deepEqual(bad, [],
    `spec(s) with a missing or unrecognised status (expected one of ${KNOWN_STATUSES.join('/')}):\n      ` +
    bad.join('\n      '));
});

// The `continue` on a spec with fewer than two declared artifacts used to be
// silent, and that made "judged them all, every commitment is open" and "judged
// nothing at all" the same output. It was not a hypothetical: `- Produces:` is
// used by exactly one of the seven tracked specs — the one this gate was written
// against — so the subset actually evaluated was empty on the day it shipped,
// and the pre-tag review escaped it by restating an already-shipped plan in the
// prose style the other six use. A gate that cannot say how many objects it
// judged cannot be believed when it says they were clean.
//
// So the unevaluated ones are now a failure of their own rather than a skip:
// an open spec that declares no parseable artifact is a spec whose completion
// this gate cannot check, and saying so is the only honest report available.
test('no open spec has already been fully implemented', (t) => {
  const { code, paths } = codeHaystack();
  const specs = trackedSpecs();
  const stale = [];
  const unevaluable = [];
  let judged = 0;
  for (const s of specs) {
    const text = fs.readFileSync(path.join(ROOT, s), 'utf8');
    const status = statusOf(text);
    if (!OPEN_STATUSES.includes(status)) continue;
    const artifacts = declaredArtifacts(text);
    // Two or more, so a single generic name cannot condemn a spec by collision.
    if (artifacts.length < 2) {
      unevaluable.push(`${s} — status: ${status}, declares ${artifacts.length} parseable \`- Produces:\` artifact(s)`);
      continue;
    }
    judged++;
    const present = artifacts.filter((a) => (
      /\.(sh|js|mjs|tsv)$/.test(a)
        ? paths.has(a)
        : new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(code)
    ));
    if (present.length === artifacts.length) {
      stale.push(`${s} — declares [${artifacts.join(', ')}], all present in the tree`);
    }
  }

  // Printed on the green path too, which is the point: the count is the
  // difference between a clean scan and an empty one.
  t.diagnostic(`${specs.length} tracked spec(s); ${judged + unevaluable.length} open ` +
    `(${OPEN_STATUSES.join('/')}); ${judged} evaluated against the tree, ${unevaluable.length} not evaluable`);

  assert.deepEqual(stale, [],
    `a spec still marked open — i.e. an unmet commitment — has every artifact it plans ` +
    'already in the tree:\n      ' + stale.join('\n      ') +
    '\n      Flip it to `status: implemented` and record the commit that landed it. If the ' +
    'work really is outstanding, the names collided and the spec should say so.');

  assert.deepEqual(unevaluable, [],
    'an open spec declares nothing this gate can look for, so its completion was not ' +
    'checked — and a scan that reports green over an empty subset is the failure this ' +
    'gate exists to prevent:\n      ' + unevaluable.join('\n      ') +
    '\n      Give it two or more `- Produces: `name`` lines naming what it creates, or set ' +
    'its status to implemented/rejected if it is no longer an open commitment.');
});
