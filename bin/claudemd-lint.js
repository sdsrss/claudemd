#!/usr/bin/env node
// claudemd-lint — CLI surface for §10-V banned-vocab + transcript scanning.
// Built for use OUTSIDE Claude Code: git pre-commit hooks, GitHub Actions,
// other agent integrations (Codex / Cursor / OpenClaw). Reuses the same
// pattern file (hooks/banned-vocab.patterns) the in-CC bash hooks read,
// so enforcement is consistent across surfaces.
//
// Once published to npm:
//   npx claudemd-cli lint "your commit message here"
//   npx claudemd-cli lint --stdin < message.txt
//   npx claudemd-cli audit ~/.claude/projects/.../session.jsonl
//
// Pre-publish (this repo, dev mode):
//   node bin/claudemd-lint.js lint "..."
//   node bin/claudemd-lint.js audit transcript.jsonl

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  scan,
  readPatterns,
  parseTranscript,
  countStringContentAssistantRows,
  formatHumanReadable,
  formatJSON,
  stripGitCommitComments,
  looksLikeGitMessageFile,
} from '../scripts/lib/lint.js';
// Shared argv authority. It used to be a private function here, which is how
// scripts/lint-argv.js came to authenticate a CLI's argv contract by FUNCTION
// NAME — any file declaring a local `validateAndExpandFlags` satisfied the gate
// (audit-2026-08-22 条目 14). The gate now requires this import.
import { validateAndExpandFlags } from '../scripts/lib/argv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const USAGE = `claudemd-lint — §10-V banned-vocab + transcript scanner

Usage:
  claudemd-cli lint <text>            Scan text for banned-vocab.
  claudemd-cli lint --file <path>     Scan the contents of a file.
  claudemd-cli lint --stdin           Read text from stdin.
  claudemd-cli audit <jsonl-path>     Scan all assistant turns in a CC transcript.
  claudemd-cli --version              Print plugin version.
  claudemd-cli --help                 Print this message.

Flags:
  --json                              Emit machine-readable JSON instead of text.
  --include-ratio                     (audit only) Include @ratio patterns.
                                      Default OFF — chat prose has different
                                      baseline conventions from commit messages.
  --commit-msg / --no-commit-msg      (lint only) Force git commit-message
                                      cleanup on / off. Auto-ON for files named
                                      COMMIT_EDITMSG / MERGE_MSG / SQUASH_MSG /
                                      TAG_EDITMSG / NOTES_EDITMSG.
  --comment-char <c>                  (lint only) git core.commentChar. Default '#'.

Notes:
  A bare \`lint <arg>\` whose only positional is an existing regular file
  is auto-treated as \`--file <arg>\` so \`claudemd-cli lint .git/COMMIT_EDITMSG\`
  works as expected in pre-commit hooks. Pass --stdin or quote literal
  text to opt out.

  A commit-msg hook is handed the RAW message file, which still holds git's
  \`#\` template block and — under \`git commit -v\` — the staged diff below the
  \`>8\` scissors line. git drops both before storing the commit, so cleanup
  mode drops them too: only the text git will actually keep is scanned.
  Piping instead of passing a path? Use \`--commit-msg --stdin\`.

Exit codes:
  0   no hits
  1   one or more hits
  2   usage error (bad args, missing file)

Pattern source: <REPO>/hooks/banned-vocab.patterns
Spec: §10 Honesty rules — Specificity (HARD).`;

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// Resolve the repo's `commit.template` and return its lines, so cleanup can
// drop template text by exact match instead of by shape.
//
// Why this exists (0.68.3 pre-tag review, HIGH-1): `commit.template` +
// `commit.status=false` hands a commit-msg hook a buffer that is entirely
// git-authored comment lines — no `#\t` status prefix, no cut line — and git
// discards all of them. Both shape signals miss it, so lint scanned a checklist
// the author never committed and denied a clean commit. A §10-V checklist in a
// commit template is exactly what this project's own users write.
//
// Best-effort by construction: no git, no repo, unset config, unreadable file
// → null, and the caller falls back to the shape signals unchanged.
function readCommitTemplate(sourcePath) {
  // A commit-msg hook runs with cwd at the work tree root, so that is the first
  // place to ask. The message file's own directory is the fallback — and it is
  // usually `.git/`, where `rev-parse --show-toplevel` refuses to answer
  // ("this operation must be run in a work tree"), so the work tree is derived
  // from `--absolute-git-dir` instead of assumed.
  const starts = [process.cwd()];
  if (sourcePath) starts.push(path.dirname(path.resolve(sourcePath)));

  for (const cwd of starts) {
    try {
      const git = (...a) => spawnSync('git', a, {
        cwd, encoding: 'utf8', timeout: 5000, windowsHide: true,
      });

      const cfg = git('config', '--get', 'commit.template');
      if (cfg.status !== 0 || !cfg.stdout || !cfg.stdout.trim()) continue;
      let tmpl = cfg.stdout.trim();

      // git expands a leading `~/`; it does not expand shell variables.
      if (tmpl === '~' || tmpl.startsWith('~/')) {
        const home = os.homedir();
        if (home) tmpl = path.join(home, tmpl.slice(1));
      }
      if (!path.isAbsolute(tmpl)) tmpl = path.resolve(workTreeOf(git, cwd), tmpl);

      return fs.readFileSync(tmpl, 'utf8').split('\n');
    } catch {
      // fall through to the next candidate
    }
  }
  return null;
}

// The work tree a relative `commit.template` resolves against.
function workTreeOf(git, cwd) {
  const top = git('rev-parse', '--show-toplevel');
  if (top.status === 0 && top.stdout.trim()) return top.stdout.trim();
  // Called from inside the git dir: the work tree is its parent. `.git` for a
  // normal repo, `.git/worktrees/<name>` for a linked one — hence common-dir.
  const common = git('rev-parse', '--git-common-dir');
  if (common.status === 0 && common.stdout.trim()) {
    return path.dirname(path.resolve(cwd, common.stdout.trim()));
  }
  return cwd;
}

function lintCmd(rawArgs) {
  const args = validateAndExpandFlags(
    rawArgs,
    ['--json', '--stdin', '--commit-msg', '--no-commit-msg'],
    ['--file', '--comment-char'],
    'lint',
  );
  const json = args.includes('--json');     // argv-lint:allow — validated upstream by validateAndExpandFlags
  const stdin = args.includes('--stdin');   // argv-lint:allow — validated upstream by validateAndExpandFlags

  // Commit-message cleanup mode. `--commit-msg` forces it on (needed for the
  // `cat "$1" | claudemd-cli lint --stdin` shape, where there is no filename
  // to key off), `--no-commit-msg` forces it off, otherwise it is inferred
  // from the input FILENAME below.
  const forceCommitMsg = args.includes('--commit-msg');       // argv-lint:allow — validated upstream by validateAndExpandFlags
  const denyCommitMsg = args.includes('--no-commit-msg');     // argv-lint:allow — validated upstream by validateAndExpandFlags
  if (forceCommitMsg && denyCommitMsg) {
    process.stderr.write('lint: choose one of --commit-msg or --no-commit-msg, not both\n');
    process.exit(2);
  }
  let commentChar = '#';
  // ALL occurrences, not indexOf(): with only the first value slot filtered out
  // of `positional`, `--comment-char ';' --comment-char significantly` fed the
  // second value into the scanned text and reported a "hit" on a word the user
  // never submitted — the same silent-value-swallow family validateAndExpandFlags
  // exists to close, reopened one occurrence deep.
  const ccIdxs = args.reduce((acc, a, i) => (a === '--comment-char' ? acc.concat(i) : acc), []); // argv-lint:allow — validated upstream by validateAndExpandFlags
  if (ccIdxs.length > 1) {
    process.stderr.write('lint: --comment-char given more than once — pass it exactly once\n');
    process.exit(2);
  }
  const ccIdx = ccIdxs.length === 1 ? ccIdxs[0] : -1;
  if (ccIdx !== -1) {
    const next = args[ccIdx + 1];
    // Single ASCII char: git's core.commentChar is one byte, and `length` counts
    // UTF-16 units so a bare length check accepted `×` (and rejected `🙂` only
    // because it is a surrogate pair).
    if (!next || next.length !== 1 || next.codePointAt(0) > 0x7f) {
      process.stderr.write('lint: --comment-char requires a single ASCII character (git core.commentChar)\n');
      process.exit(2);
    }
    commentChar = next;
  }

  // --file <path> consumes the next non-flag arg.
  let filePath = null;
  const fileIdx = args.indexOf('--file');   // argv-lint:allow — validated upstream by validateAndExpandFlags
  if (fileIdx !== -1) {
    const next = args[fileIdx + 1];
    if (!next || next.startsWith('--')) {
      process.stderr.write('lint: --file requires a path argument\n');
      process.exit(2);
    }
    filePath = next;
  }
  const positional = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (fileIdx !== -1 && i === fileIdx + 1) return false;
    // …and the value slot of every other value-taking flag, or
    // `lint --comment-char ';' --stdin` would treat ';' as literal text to scan
    // (and then trip the "--stdin and positional text are mutually exclusive"
    // guard) — the same silent-value-swallow family validateAndExpandFlags exists to
    // prevent.
    if (ccIdx !== -1 && i === ccIdx + 1) return false;
    return true;
  });

  // Mutual-exclusion: pick one source — stdin > --file > positional.
  if (stdin && filePath) {
    process.stderr.write('lint: choose one of --stdin or --file, not both\n');
    process.exit(2);
  }
  if (stdin && positional.length > 0) {
    process.stderr.write('lint: --stdin and positional text are mutually exclusive\n');
    process.exit(2);
  }
  if (filePath && positional.length > 0) {
    process.stderr.write('lint: --file and positional text are mutually exclusive\n');
    process.exit(2);
  }

  let text;
  // Path the text was read FROM, when there is one — the auto-detect key for
  // commit-message cleanup. stdin leaves it null (no filename to key off), which
  // is exactly why --commit-msg exists.
  let sourcePath = null;
  if (stdin) {
    try {
      text = fs.readFileSync(0, 'utf8');
    } catch (e) {
      process.stderr.write(`lint: failed to read stdin: ${e.message}\n`);
      process.exit(2);
    }
  } else if (filePath) {
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`lint: file not found: ${filePath}\n`);
      process.exit(2);
    }
    // Pre-fix, `lint --file <dir>` fell through to readFileSync and surfaced
    // a raw Node `EISDIR: illegal operation on a directory, read` — asymmetric
    // with the positional path which already rejects directories cleanly
    // (line ~191 below). Keep the friendly error shape consistent across both
    // entry shapes.
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) {
        process.stderr.write(`lint: '${filePath}' is not a regular file (got ${st.isDirectory() ? 'directory' : 'special file'})\n`);
        process.exit(2);
      }
    } catch (e) {
      process.stderr.write(`lint: failed to stat ${filePath}: ${e.message}\n`);
      process.exit(2);
    }
    try {
      text = fs.readFileSync(filePath, 'utf8');
      sourcePath = filePath;
    } catch (e) {
      process.stderr.write(`lint: failed to read ${filePath}: ${e.message}\n`);
      process.exit(2);
    }
  } else if (positional.length > 0) {
    // Auto-detect: a bare single positional that is an existing regular file
    // is overwhelmingly the user's intent (they're piping a commit-msg path
    // from a git pre-commit hook). Without this, `claudemd-cli lint message.txt`
    // silently scans the LITERAL STRING "message.txt" → exits 0 even when
    // the file contents would deny.
    //
    // v0.9.21 — close the v0.9.14 silent-fall-through residual: when the
    // positional looks like a PATH (contains '/' or is '.' / '..') AND the
    // path doesn't resolve to a regular file, error out instead of scanning
    // the literal string. Pre-fix, `lint /tmp/missing.txt` scanned the path
    // string (exit 0); `lint /tmp` (existing dir) scanned '/tmp' (exit 0);
    // `lint /tmp/significantly-improved.txt` (missing) matched "significantly"
    // in the basename and falsely exited 1. Same silent-success family the
    // v0.9.14 fix targeted; the fix was scoped only to the "file exists" branch.
    //
    // Non-path-shape positionals (single word, no slash) keep the v0.9.14
    // text fallback — `lint significantly` MUST stay a text scan because it's
    // a single literal word, not a typo'd path. `lint message.txt` (no slash,
    // missing file) stays text — it's ambiguous between "literal text" and
    // "filename in cwd"; pre-existing-file behavior wins to preserve the
    // pre-commit-hook ergonomic where `--file` is explicit.
    if (positional.length === 1) {
      const arg = positional[0];
      // Path-shape heuristic: contains `/`, or is `.`/`..`. Whitespace disqualifies
      // — `lint "Fixed crash in scripts/audit.js:42 (12/12 tests pass)"` is one
      // quoted positional whose `/` came from a file:line citation inside a
      // sentence, not a literal file path. Without this guard, the auto-detect
      // branch saw `/` and exited 2 with "file not found", forcing users to
      // either omit citations from inline text or explicitly switch to --stdin.
      const looksLikePath = (arg.includes('/') || arg === '.' || arg === '..') && !/\s/.test(arg);
      try {
        const st = fs.statSync(arg);
        if (st.isFile()) {
          text = fs.readFileSync(arg, 'utf8');
          sourcePath = arg;
        } else if (looksLikePath) {
          process.stderr.write(`lint: '${arg}' is not a regular file (use --file PATH for explicit file scan or quote literal text)\n`);
          process.exit(2);
        }
        // Non-path-shape + non-file (e.g. a symlink loop, fifo) → fall through to text scan.
      } catch (e) {
        if (looksLikePath) {
          process.stderr.write(`lint: file not found: ${arg}\n`);
          process.exit(2);
        }
        // Non-path-shape miss → fall through to text scan.
      }
    }
    if (text === undefined) text = positional.join(' ');
  } else {
    process.stderr.write('lint: text required (positional arg, --file PATH, or --stdin)\n');
    process.exit(2);
  }

  // Git commit-message cleanup. A `commit-msg` hook is handed the RAW
  // COMMIT_EDITMSG, which still carries git's `#` template/status block and —
  // under `git commit -v` — the whole staged diff below the scissors line.
  // git discards all of it before storing the message (verified against git
  // 2.43.0: a 26-line COMMIT_EDITMSG stored a 1-line message), so scanning it
  // raw denied commits over words the author never wrote — in their own staged
  // diff, or in git's status block listing a file named e.g. `comprehensive.js`.
  // The bypass note then pointed at a message the word does not appear in.
  //
  // Runs BEFORE the escape-hatch check on purpose: `[allow-banned-vocab]`
  // sitting in a `#` line git will discard is not in the commit message either.
  const commitMsgCleanup = !denyCommitMsg && (forceCommitMsg || looksLikeGitMessageFile(sourcePath));
  if (commitMsgCleanup) {
    text = stripGitCommitComments(text, commentChar, {
      templateLines: readCommitTemplate(sourcePath),
    });
  }

  // Per-commit escape hatch — mirrors hooks/banned-vocab-check.sh:36. Without
  // this, `claudemd-cli lint --file=.git/COMMIT_EDITMSG` in a git pre-commit
  // hook silently disagreed with the in-CC bash hook: the same commit message
  // with `[allow-banned-vocab]` would pass the bash gate (exit 0) but the CLI
  // would still exit 1 and block the commit. Same input → different verdict =
  // contract violation across surfaces of the same feature.
  const ESCAPE_HATCH = '[allow-banned-vocab]';
  if (text.includes(ESCAPE_HATCH)) {
    if (json) {
      process.stdout.write(formatJSON({ scope: 'lint', text, hits: [], bypass: 'allow-banned-vocab', commitMsgCleanup }) + '\n');
    } else {
      process.stdout.write(`OK: §10-V scan bypassed via ${ESCAPE_HATCH}.\n`);
    }
    process.exit(0);
  }

  // Baseline-context exemption — mirrors banned-vocab-check.sh:65-75. When
  // the text carries an explicit before-after anchor (digit ... → / -> / =>
  // ... digit) OR the literal word `baseline`, ratio-class patterns (tagged
  // `@ratio` in their reason column) are suppressed. Non-ratio hedges /
  // adjectives still match.
  // `\S{0,64}`, not `\S*` (2026-09-02 audit R11-12): with an unbounded run and
  // no arrow present, the unanchored scan retries from every offset and
  // rescans the tail — quadratic, 710ms on a 20k digit run, and this runs on
  // the RAW file before scan(), so lint.js:150-157's sanitizer fix for the same
  // family never covered it. A digit-dense lockfile or hash dump hung the
  // pre-commit hook. 64 is far past any real anchor (`p99 580ms→140ms` is 15).
  const HAS_NUMERIC_ARROW = /\d\S{0,64}\s*(?:→|->|=>)\s*\d/;
  const HAS_BASELINE = /baseline/i;
  const baselineExempt = HAS_NUMERIC_ARROW.test(text) || HAS_BASELINE.test(text);

  const hits = scan(text, { excludeRatio: baselineExempt, sanitize: true });
  if (json) {
    process.stdout.write(formatJSON({ scope: 'lint', text, hits, commitMsgCleanup }) + '\n');
  } else {
    const out = formatHumanReadable({ scope: 'lint', hits });
    if (hits.length === 0) process.stdout.write(out + '\n');
    else process.stderr.write(out + '\n');
  }
  process.exit(hits.length === 0 ? 0 : 1);
}

function auditCmd(rawArgs) {
  const args = validateAndExpandFlags(rawArgs, ['--json', '--include-ratio'], [], 'audit');
  const json = args.includes('--json');                   // argv-lint:allow — validated upstream by validateAndExpandFlags
  const includeRatio = args.includes('--include-ratio');  // argv-lint:allow — validated upstream by validateAndExpandFlags
  const positional = args.filter(a => !a.startsWith('--'));
  const transcriptPath = positional[0];

  if (!transcriptPath) {
    process.stderr.write('audit: <jsonl-path> required\n');
    process.exit(2);
  }
  if (!fs.existsSync(transcriptPath)) {
    process.stderr.write(`audit: file not found: ${transcriptPath}\n`);
    process.exit(2);
  }
  // Pre-fix, `audit <dir>` crashed with raw Node EISDIR + Node stack trace
  // and exit 1 — colliding with the documented "1 = hits found" semantic so
  // CI scripts couldn't tell a usage error from a real banned-vocab hit.
  try {
    const st = fs.statSync(transcriptPath);
    if (!st.isFile()) {
      process.stderr.write(`audit: '${transcriptPath}' is not a regular file (got ${st.isDirectory() ? 'directory' : 'special file'})\n`);
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`audit: failed to stat ${transcriptPath}: ${e.message}\n`);
    process.exit(2);
  }

  // Mirrors the `lint --file` read path above (R11-11). The existsSync/statSync
  // guards a few lines up both PASS on a mode-000 file, so an unreadable
  // transcript reached this line and exited 1 with a V8 stack — colliding with
  // the documented `1 = hits found`, which is what CI and pre-commit gate on.
  let jsonl;
  try {
    jsonl = fs.readFileSync(transcriptPath, 'utf8');
  } catch (e) {
    process.stderr.write(`audit: failed to read ${transcriptPath}: ${e.message}\n`);
    process.exit(2);
  }

  // Silent-success guard: parseTranscript intentionally skips unparseable rows
  // (matches transcript-vocab-scan.sh). But if the WHOLE file fails to parse
  // — user pointed audit at a CSV, plain log, or corrupted JSONL — `turns.length`
  // is 0 and the CLI happily prints "OK: 0 assistant turn(s)" exit 0. Same
  // silent-OK family as v0.9.14 / v0.9.21. Pre-flight: a non-empty file that
  // yields zero parseable JSON rows is malformed, not clean.
  const nonEmptyLines = jsonl.split('\n').filter(l => l.trim().length > 0);
  if (nonEmptyLines.length > 0) {
    let parsedAny = false;
    let sawTypeField = false;
    for (const l of nonEmptyLines) {
      let row;
      try { row = JSON.parse(l); } catch { continue; }
      parsedAny = true;
      if (row && typeof row === 'object' && row.type !== undefined) { sawTypeField = true; break; }
    }
    if (!parsedAny) {
      process.stderr.write(`audit: no parseable JSON rows in ${transcriptPath} (expected JSONL transcript with one JSON object per line)\n`);
      process.exit(2);
    }
    // Parseable JSON but NO row carries a `type` field → not a Claude Code
    // transcript (wrong file, other-agent export, or a coerced CSV/log). Every
    // real CC row carries `type` (assistant / user / system / summary / …).
    // Without this, parseTranscript yields 0 turns and audit prints
    // "OK: no §10-V hits across 0 assistant turn(s)" exit 0 — a silent
    // false-pass in CI, same silent-success family as the v0.9.14 / v0.9.21
    // literal-string-scan bugs. A legit transcript whose only rows are
    // non-assistant still has `type`, so it passes this gate and exits 0.
    if (!sawTypeField) {
      process.stderr.write(`audit: ${transcriptPath} parses as JSON but no row has a 'type' field — does not look like a Claude Code transcript (expected rows like {"type":"assistant",...}). Wrong file?\n`);
      process.exit(2);
    }
  }

  const turns = parseTranscript(jsonl);
  // QA ISSUE-002 (option c): string-shape assistant rows are outside the
  // block-array input domain and never reach the scanner. Keep the verdict
  // based on scanned turns, but say so on stderr — a silent skip here is the
  // same silent-success family as the isFile()/no-type guards above. User
  // rows are legitimately string-shape (typed prompts); only assistant rows
  // count.
  const skippedStringRows = countStringContentAssistantRows(jsonl);
  if (skippedStringRows > 0) {
    process.stderr.write(
      `audit: warning: skipped ${skippedStringRows} assistant row(s) with string-shape ` +
      `message.content — not the Claude Code block-array shape, so their text was NOT scanned. ` +
      `Non-CC transcript export?\n`
    );
  }
  const patterns = readPatterns();
  // NO escape hatch here, deliberately. A 2026-07-26 audit item read the
  // lint-honors/audit-ignores split as an asymmetry to close; it is not one.
  // `lint` scans text the caller hands it, so the token is that caller's explicit
  // intent. `audit` scans a TRANSCRIPT of assistant turns, where the token is
  // incidental text — and in this repo, turns discussing the escape hatch are
  // routine, so honoring it here lets a turn suppress its own scan by mentioning
  // it. The hook agrees: banned-vocab-check.sh:90 reads the token from the Bash
  // command, never from the prose it scans (pinned by banned-vocab.test.sh:243),
  // README.md:241 and status.js:24 both scope it to "commit message", and
  // sampling-audit.js does not honor it at all — adding it here would have moved
  // the asymmetry rather than removed it.
  const annotated = turns.map(t => ({
    ...t,
    hits: scan(t.text, { excludeRatio: !includeRatio, patterns, sanitize: true }),
  }));
  const flaggedCount = annotated.reduce((n, t) => n + (t.hits.length > 0 ? 1 : 0), 0);

  if (json) {
    process.stdout.write(formatJSON({ scope: 'audit', transcript: transcriptPath, turns: annotated }) + '\n');
  } else {
    const out = formatHumanReadable({ scope: 'audit', turns: annotated });
    if (flaggedCount === 0) process.stdout.write(out + '\n');
    else process.stderr.write(out + '\n');
  }
  process.exit(flaggedCount === 0 ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  // `--help` in ANY position (2026-07-26 audit). Recognizing it only as argv[0]
  // meant `claudemd-cli lint --help` exited 2 with "unknown flag '--help'" — the
  // exact discoverability bug lib/argv.js#printHelpAndExit was written to fix,
  // which this CLI predates.
  // argv-lint:allow — help detection runs before subcommand routing; --help takes no value
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE + '\n');
    process.exit(argv.length === 0 ? 2 : 0);
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(readPackageVersion() + '\n');
    process.exit(0);
  }
  const sub = argv[0];
  switch (sub) {
    case 'lint':  return lintCmd(argv.slice(1));
    case 'audit': return auditCmd(argv.slice(1));
    default:
      process.stderr.write(`unknown subcommand: ${sub}\n${USAGE}\n`);
      process.exit(2);
  }
}

main();
