// lint-commit-msg.test.js — git commit-message cleanup parity for `lint`.
//
// Ground truth (git 2.43.0, verified empirically 2026-08-16): a `commit-msg`
// hook receives the RAW `.git/COMMIT_EDITMSG`, which under `git commit -v`
// carries (a) the `#`-prefixed template/status block and (b) the full staged
// diff below the `# ---- >8 ----` scissors line. git discards both before
// storing the commit — `git log -1 --format=%B` keeps only the subject/body.
//
// Pre-fix, `claudemd-cli lint .git/COMMIT_EDITMSG` — the usage the CLI's own
// --help and README document for pre-commit hooks — scanned that raw text, so
// a banned word living in the user's STAGED DIFF or in git's own status block
// blocked a commit whose actual message was clean. False positive on the
// primary external entry point, with a bypass note pointing at a message the
// word does not appear in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripGitCommitComments, looksLikeGitMessageFile } from '../../scripts/lib/lint.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO_ROOT, 'bin/claudemd-lint.js');

const run = (args, input) =>
  spawnSync(process.execPath, [BIN, ...args], {
    input,
    encoding: 'utf8',
    timeout: 10000,
  });

// Byte-shape mirror of a real `git commit -v` COMMIT_EDITMSG (captured from
// git 2.43.0, not hand-invented — per feedback_test_fixture_format_drift).
const BANNED = 'signi' + 'ficantly'; // split so this fixture never trips the repo's own gates
const REAL_EDITMSG = [
  'fix: null deref at parser.js:42 (7/7 tests pass)',
  '',
  '# Please enter the commit message for your changes. Lines starting',
  "# with '#' will be ignored, and an empty message aborts the commit.",
  '#',
  '# On branch main',
  '# Changes to be committed:',
  '#\tmodified:   src/perf.js',
  '#',
  '# ------------------------ >8 ------------------------',
  '# Do not modify or remove the line above.',
  '# Everything below it will be ignored.',
  'diff --git a/src/perf.js b/src/perf.js',
  'index 1111111..2222222 100644',
  '--- a/src/perf.js',
  '+++ b/src/perf.js',
  '@@ -1,2 +1,2 @@',
  `-  // this path is ${BANNED} slower`,
  '+  // hot path should work for the common case',
  '',
].join('\n');

const withTmp = fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-commitmsg-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('lib: stripGitCommitComments drops # lines and everything below the scissors line', () => {
  const out = stripGitCommitComments(REAL_EDITMSG);
  assert.equal(out.trim(), 'fix: null deref at parser.js:42 (7/7 tests pass)');
  assert.ok(!out.includes(BANNED), 'staged-diff text must not survive cleanup');
  assert.ok(!out.includes('should work'), 'staged-diff text must not survive cleanup');
});

test('lib: stripGitCommitComments keeps INDENTED # lines (git strips only column 0)', () => {
  // git's strbuf_stripspace() matches the comment prefix at the start of the
  // line with no leading-whitespace tolerance, so `  # note` stays in the
  // stored message. Over-stripping here would be a false NEGATIVE.
  const out = stripGitCommitComments(`subject\n\n  # indented note about ${BANNED} gains\n`);
  assert.ok(out.includes(BANNED), 'indented comment is part of the real message');
});

test('lib: stripGitCommitComments honors a custom comment char (core.commentChar)', () => {
  // Template-shaped on purpose: since the review fix, stripping is conditional
  // on a git-authored template being present, so a lone comment line is (now
  // correctly) left in scope. The comment char under test is what decides
  // which lines COUNT as the template.
  //
  // The status file list carries the `<commentChar>`+TAB prefix git writes with
  // core.commentChar=';' — the real shape, and since P1-3 the only template
  // signal there is (the run-of-3 heuristic this fixture used to lean on was a
  // silent-miss vector on `-F` bodies).
  const src = [
    'subject',
    '',
    '; Please enter the commit message for your changes. Lines starting',
    "; with ';' will be ignored, and an empty message aborts the commit.",
    ';',
    '; Changes to be committed:',
    `;\tmodified:   src/${BANNED}-parser.js`,
    ';',
    '',
  ].join('\n');
  assert.ok(
    !stripGitCommitComments(src, ';').includes(BANNED),
    "with commentChar=';' the block is git's template and is stripped"
  );
  // …and with the default '#' the ';' lines are ordinary message text.
  assert.ok(
    stripGitCommitComments(src).includes(BANNED),
    "with the default '#' nothing here is a comment, so it all stays in scope"
  );
});

test('lib: looksLikeGitMessageFile recognizes git message filenames only', () => {
  assert.equal(looksLikeGitMessageFile('.git/COMMIT_EDITMSG'), true);
  assert.equal(looksLikeGitMessageFile('/repo/.git/MERGE_MSG'), true);
  assert.equal(looksLikeGitMessageFile('TAG_EDITMSG'), true);
  assert.equal(looksLikeGitMessageFile('notes.md'), false);
  assert.equal(looksLikeGitMessageFile('/docs/README.md'), false);
});

test('CLI: lint .git/COMMIT_EDITMSG ignores the -v diff and the # template block', () => {
  withTmp(dir => {
    const gitDir = path.join(dir, '.git');
    fs.mkdirSync(gitDir);
    const p = path.join(gitDir, 'COMMIT_EDITMSG');
    fs.writeFileSync(p, REAL_EDITMSG);
    const r = run(['lint', p]);
    assert.equal(r.status, 0, `clean commit subject must pass; stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

test('CLI: --file .git/COMMIT_EDITMSG gets the same cleanup as the positional form', () => {
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(p, REAL_EDITMSG);
    const r = run(['lint', '--file', p]);
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

test('CLI: a banned word in the REAL message still denies after cleanup', () => {
  // The fix must not become a blanket mute — only git-discarded text is dropped.
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(
      p,
      REAL_EDITMSG.replace(
        'fix: null deref at parser.js:42 (7/7 tests pass)',
        `perf: ${BANNED} faster parser`
      )
    );
    const r = run(['lint', p]);
    assert.equal(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, new RegExp(BANNED));
  });
});

test('CLI: --commit-msg applies cleanup to --stdin (commitlint-style piping)', () => {
  const r = run(['lint', '--commit-msg', '--stdin'], REAL_EDITMSG);
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  // Without the flag, stdin has no filename to auto-detect from → still denies.
  const bare = run(['lint', '--stdin'], REAL_EDITMSG);
  assert.equal(bare.status, 1, 'stdin without --commit-msg keeps raw-scan behavior');
});

test('CLI: --no-commit-msg opts out of auto-detection', () => {
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(p, REAL_EDITMSG);
    const r = run(['lint', '--no-commit-msg', '--file', p]);
    assert.equal(r.status, 1, 'explicit opt-out restores the raw scan');
  });
});

test('CLI: a non-git-named file is NOT cleaned (# headings stay in scope)', () => {
  // False-negative guard: `lint --file notes.md` must keep scanning markdown
  // headings — auto-detect is filename-scoped, not content-sniffed.
  withTmp(dir => {
    const p = path.join(dir, 'notes.md');
    fs.writeFileSync(p, `# release notes\n\nthis release is ${BANNED} faster\n`);
    const r = run(['lint', '--file', p]);
    assert.equal(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

// --- Pre-tag review findings (2026-08-16) ----------------------------------
//
// git only strips `#` lines under cleanup=strip/scissors, which is the EDITOR
// path. Under `-m` / `-F` / `--cleanup=whitespace|verbatim` the mode is
// `whitespace` and column-0 `#` lines are KEPT in the stored commit. Measured
// on git 2.43.0 across six invocation shapes:
//
//   shape                     cutline  #\t   max-#-run   git KEPT # lines
//   editor default              0       2       13             0
//   editor -v                   1       3       14             0
//   -m with a # line            0       0        1             1  ← kept
//   -m --cleanup=verbatim       0       0        1             1  ← kept
//   -F file                     0       0        1             1  ← kept
//   editor commit.status=false  0       0        0             0  (none to strip)
//
// Stripping unconditionally therefore muted real violations on the very entry
// point this feature exists for — a false NEGATIVE traded for the false
// positive, the exact swap the implementation comment says it avoids.

test('review-HIGH: a user # line in a -m style message is NOT stripped', () => {
  // No git template anywhere: one comment line the author typed themselves.
  // git keeps it, so lint must scan it.
  const msg = `subject\n\n# note: this release is ${BANNED} faster\n`;
  assert.ok(
    stripGitCommitComments(msg).includes(BANNED),
    'a lone # line has no git template around it — git keeps it, so it stays in scope'
  );
});

test('review-HIGH: git-template # blocks are still stripped (the FP fix survives)', () => {
  assert.ok(!stripGitCommitComments(REAL_EDITMSG).includes(BANNED));
  // …and the template-less-but-status-listed shape (`#\t` file list, no -v diff).
  const editorNoVerbose = [
    'fix: subject',
    '',
    '# Please enter the commit message for your changes. Lines starting',
    "# with '#' will be ignored, and an empty message aborts the commit.",
    '#',
    '# Changes to be committed:',
    `#\tmodified:   src/${BANNED}-parser.js`,
    '#',
    '',
  ].join('\n');
  assert.ok(
    !stripGitCommitComments(editorNoVerbose).includes(BANNED),
    'git status block must still be stripped — it is git-authored, not the message'
  );
});

test('review-HIGH: CLI end-to-end — a banned word in a -m style # line still denies', () => {
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(p, `subject\n\n# note: ${BANNED} faster\n`);
    const r = run(['lint', p]);
    assert.equal(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

// --- audit-2026-08-22 P1-3: the run-of-3 heuristic was a silent miss --------
//
// `hasGitTemplate` treated "≥3 contiguous comment lines ending at EOF" as a git
// template signal. Read against the measured table above, no git shape NEEDS
// that signal: both editor shapes carry `#\t` status lines, and the
// `commit.status=false` shape emits no comment lines at all. What it did reach
// was `git commit -F notes.md` — cleanup=whitespace, so git KEEPS those lines —
// whenever the body happened to end in three of them. The violation inside was
// then stripped before the scan and the CLI exited 0. Reproduced at 2 trailing
// `#` lines → exit 1, at 3 → `OK: no §10-V hits`, exit 0: the failure mode gets
// MORE likely as the commented block gets longer, which is backwards.

test('P1-3: three trailing # lines in a -F body are message text, not a template', () => {
  const msg = [
    'docs: release notes',
    '',
    '# leftover notes, kept by cleanup=whitespace:',
    `# this release is ${BANNED} faster`,
    '# (todo: trim before tagging)',
    '',
  ].join('\n');
  assert.ok(
    stripGitCommitComments(msg).includes(BANNED),
    'no git-authored template here — three # lines the author typed must stay in scope'
  );
});

test('P1-3: CLI end-to-end — a violation inside a 3-line # block still denies', () => {
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(
      p,
      [
        'docs: release notes',
        '',
        '# leftover notes:',
        `# this release is ${BANNED} faster`,
        '# (todo: trim)',
        '',
      ].join('\n')
    );
    const r = run(['lint', p]);
    assert.equal(r.status, 1, `3-line # block must not mute the scan; stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

test('P1-3: the FP fix is unchanged — a status-listed template is still stripped', () => {
  // Regression fence for the removal: every git shape that has comment lines to
  // strip also carries the locale-proof `#\t` status prefix or the cut line.
  assert.ok(!stripGitCommitComments(REAL_EDITMSG).includes(BANNED));
  const statusOnly = [
    'fix: subject',
    '',
    '# Changes to be committed:',
    `#\tmodified:   src/${BANNED}-parser.js`,
    '#',
    '',
  ].join('\n');
  assert.ok(!stripGitCommitComments(statusOnly).includes(BANNED));
});

test('review-MEDIUM: a hand-written near-scissors line does not truncate the scan', () => {
  // git matches its cut line as an exact literal (comment char, space, 24
  // dashes, ` >8 `, 24 dashes) and truncates only under -v / cleanup=scissors.
  // A loose `-{2,}` regex let a user-authored `# -- >8 --` silently drop the
  // rest of the message from the scan.
  const msg = `subject\n# -- >8 --\nthis release is ${BANNED} faster\n`;
  assert.ok(stripGitCommitComments(msg).includes(BANNED), "only git's exact cut line may truncate");
});

test("review-MEDIUM: git's real cut line still truncates", () => {
  const cut = '# ------------------------ >8 ------------------------';
  const msg = `subject\n${cut}\ndiff text with ${BANNED} in it\n`;
  assert.ok(!stripGitCommitComments(msg).includes(BANNED));
});

test('review-LOW: a repeated --comment-char is rejected, not silently scanned', () => {
  // args.indexOf() found only the first occurrence, so the second value slot
  // fell through to positional text: `--comment-char ';' --comment-char <word>`
  // scanned <word> as if the user had submitted it.
  const r = run(['lint', '--comment-char', ';', '--comment-char', BANNED]);
  assert.equal(r.status, 2, `expected usage error; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /more than once|repeated/i);
});

test('review-LOW: --comment-char rejects a non-ASCII character', () => {
  // git requires a single ASCII char; `next.length !== 1` counts UTF-16 units,
  // so `×` passed.
  const r = run(['lint', '--comment-char', '×', '--commit-msg', '--stdin'], 'subject\n');
  assert.equal(r.status, 2, `stdout=${r.stdout} stderr=${r.stderr}`);
});

// --- 0.68.3 pre-tag review HIGH-1: the shape the P1-3 table did not measure ---
//
// The six-shape table above measured `editor commit.status=false` with NO
// `commit.template` configured — which is why its row reads "0 comment lines,
// none to strip". Configure a template and the same shape hands the hook a
// buffer that is ENTIRELY git-authored comment lines with no `#\t` status
// prefix and no cut line. git discards every one of them; since P1-3 removed
// the run-of-3 signal, lint scans them all.
//
// Reproduced on git 2.43.0 through a real `git commit` with a capture editor:
// buffer = 3 template comment lines, 0 lines matching `#\t`, stored message =
// `fix: correct the off-by-one in the parser`. HEAD exits 1 on a checklist
// template that asks "does it just look like it should work?"; v0.68.2 exited 0.
// A §10-V checklist is exactly what a claudemd user puts in a commit template,
// so the FP lands on this project's own audience.
//
// The fix is not a third heuristic. git knows which lines are template lines
// because it copied them out of `commit.template` — so the CLI resolves that
// file and passes its comment lines in, and the strip becomes an exact match
// instead of a guess. Lines the AUTHOR typed still get scanned (P1-3 holds).

const TEMPLATE_LINES = [
  '# Checklist before you commit:',
  `#  - is the claim verified, or does it just look ${BANNED} better?`,
  '#  - tests green?',
];

test('HIGH-1: commit.template comment lines are git-authored — not scanned', () => {
  const buf = TEMPLATE_LINES.join('\n') + '\n';
  const out = stripGitCommitComments(buf, '#', { templateLines: TEMPLATE_LINES });
  assert.ok(
    !out.includes(BANNED),
    'git discards template lines before storing — scanning them is a false positive'
  );
});

test('HIGH-1: a real message above a template keeps its own text in scope', () => {
  const buf = [`fix: subject that is ${BANNED} wrong`, '', ...TEMPLATE_LINES, ''].join('\n');
  const out = stripGitCommitComments(buf, '#', { templateLines: TEMPLATE_LINES });
  assert.ok(
    out.includes(`fix: subject that is ${BANNED} wrong`),
    'only the template lines are git-authored; the subject is the message'
  );
});

test("HIGH-1: P1-3 holds — the author's own # lines survive a configured template", () => {
  // Template is configured, but these three comment lines are NOT from it: they
  // are a `-F` body's own text, which git keeps under cleanup=whitespace.
  const buf = [
    'docs: release notes',
    '',
    '# leftover notes, kept by cleanup=whitespace:',
    `# this release is ${BANNED} faster`,
    '# (todo: trim before tagging)',
    '',
  ].join('\n');
  const out = stripGitCommitComments(buf, '#', { templateLines: TEMPLATE_LINES });
  assert.ok(out.includes(BANNED), "lines absent from the template are the author's — P1-3 must not regress");
});

test('HIGH-1: no template configured → behavior is exactly as before', () => {
  const buf = TEMPLATE_LINES.join('\n') + '\n';
  assert.equal(
    stripGitCommitComments(buf, '#', { templateLines: [] }),
    stripGitCommitComments(buf, '#'),
    'the opt-in argument must not change the no-template path'
  );
});

test('HIGH-1: CLI end-to-end — a real commit.template commit is not blocked', () => {
  withTmp(dir => {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 10000 });
    const init = git('init', '-q', '.');
    if (init.status !== 0) return; // no git in this environment — nothing to assert
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'tmpl.txt'), TEMPLATE_LINES.join('\n') + '\n');
    git('config', 'commit.template', 'tmpl.txt');
    git('config', 'commit.status', 'false');

    // The buffer git hands a commit-msg hook for this config: template only.
    const msgFile = path.join(dir, '.git', 'COMMIT_EDITMSG');
    fs.writeFileSync(msgFile, TEMPLATE_LINES.join('\n') + '\n');

    const r = spawnSync(process.execPath, [BIN, 'lint', msgFile], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(r.status, 0, `template-only buffer must not deny; stdout=${r.stdout} stderr=${r.stderr}`);
  });
});

test('HIGH-1: CLI end-to-end — a violation the author typed still denies under a template', () => {
  withTmp(dir => {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 10000 });
    if (git('init', '-q', '.').status !== 0) return;
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'tmpl.txt'), TEMPLATE_LINES.join('\n') + '\n');
    git('config', 'commit.template', 'tmpl.txt');

    const msgFile = path.join(dir, '.git', 'COMMIT_EDITMSG');
    fs.writeFileSync(msgFile, [`fix: this is ${BANNED} faster`, '', ...TEMPLATE_LINES, ''].join('\n'));

    const r = spawnSync(process.execPath, [BIN, 'lint', msgFile], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(
      r.status,
      1,
      `the author's own subject must still be scanned; stdout=${r.stdout} stderr=${r.stderr}`
    );
  });
});

test('CLI: --json reports whether commit-msg cleanup was applied', () => {
  withTmp(dir => {
    const p = path.join(dir, 'COMMIT_EDITMSG');
    fs.writeFileSync(p, REAL_EDITMSG);
    const r = run(['lint', '--json', p]);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.commitMsgCleanup, true);
    assert.ok(!payload.text.includes(BANNED), 'scanned text is the post-cleanup text');
  });
});

// --- 0.68.3 delta review MEDIUM-4 -------------------------------------------
//
// `templateComments` documents a load-bearing property — only the template's
// COMMENT lines are git-authored; its non-comment lines git KEEPS in the stored
// message, so they are the author's text and must stay scannable. The property
// was guarded twice (in templateComments and again in the body filter), so no
// single-guard mutation was observable and the review found that removing BOTH
// left every test green. A claim in a comment with nothing asserting it is the
// exact shape this release exists to correct.

test("MEDIUM-4: a non-comment template line is the author's text and stays in scope", () => {
  // A template whose subject line is real message text git will store.
  const tmpl = [
    `refactor: it is ${BANNED} tidier now`, // no comment char — git KEEPS this
    '# Checklist:',
    '#  - tests green?',
  ];
  const out = stripGitCommitComments(tmpl.join('\n') + '\n', '#', { templateLines: tmpl });
  assert.ok(
    out.includes(BANNED),
    'git stores this line verbatim, so a §10-V violation in it must still be found'
  );
  assert.ok(!out.includes('Checklist'), 'the comment lines of the same template are still dropped');
});

test("MEDIUM-4: CLI end-to-end — a violation on a template's non-comment line denies", () => {
  withTmp(dir => {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 10000 });
    if (git('init', '-q', '.').status !== 0) return;
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    const tmpl = [`refactor: it is ${BANNED} tidier now`, '# Checklist:', '#  - tests green?'];
    fs.writeFileSync(path.join(dir, 'tmpl.txt'), tmpl.join('\n') + '\n');
    git('config', 'commit.template', 'tmpl.txt');

    const msgFile = path.join(dir, '.git', 'COMMIT_EDITMSG');
    fs.writeFileSync(msgFile, tmpl.join('\n') + '\n');

    const r = spawnSync(process.execPath, [BIN, 'lint', msgFile], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(
      r.status,
      1,
      `a template line git will STORE must be scanned; stdout=${r.stdout} stderr=${r.stderr}`
    );
  });
});
