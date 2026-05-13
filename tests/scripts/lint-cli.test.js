// lint-cli.test.js — spawn-based CLI surface tests for bin/claudemd-lint.js.
// Asserts argv parsing, exit codes, output channel (stdout vs stderr),
// and JSON output shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO_ROOT, 'bin/claudemd-lint.js');

const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], {
  input,
  encoding: 'utf8',
  timeout: 10000,
});

test('CLI: audit <directory> rejects with friendly error (exit 2, not Node EISDIR stack)', () => {
  // Pre-fix: `audit .` crashed with raw `EISDIR: illegal operation on a
  // directory, read` Node stack trace + exit 1 — colliding with documented
  // "1 = hits found" semantics so CI pipelines couldn't distinguish a usage
  // error from a real banned-vocab hit. Fix added an isFile() guard.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-lint-cli-'));
  try {
    const r = run(['audit', tmpDir]);
    assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /is not a regular file/);
    assert.doesNotMatch(r.stderr, /EISDIR/, 'must not surface raw Node EISDIR error');
    assert.doesNotMatch(r.stderr, /at Object\.readFileSync/, 'must not leak Node stack');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: lint honors [allow-banned-vocab] escape hatch (Round-4 contract symmetry)', () => {
  // Pre-fix: hooks/banned-vocab-check.sh:36 honored the escape hatch in
  // CC sessions, but `claudemd-cli lint --file=COMMIT_EDITMSG` did NOT —
  // same input, different verdict across surfaces. A git pre-commit hook
  // wired to `claudemd-cli lint` would block commits with the marker that
  // the documented in-CC path lets through. This test locks the symmetry.
  const r = run(['lint', 'feat: robust system [allow-banned-vocab]']);
  assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /bypassed via \[allow-banned-vocab\]/);
});

test('CLI: lint --json marks bypass field on escape hatch', () => {
  const r = run(['lint', '--json', '[allow-banned-vocab] robust']);
  assert.equal(r.status, 0);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.bypass, 'allow-banned-vocab');
  assert.deepEqual(obj.hits, []);
});

test('CLI: lint baseline-context (numeric arrow) suppresses @ratio hits', () => {
  // `10x faster` is an @ratio pattern — without baseline it should hit.
  // With a numeric arrow `580 → 140` in the same text, the bash hook
  // (banned-vocab-check.sh:71) suppresses ratio-class hits. Mirror it.
  const r = run(['lint', 'p99 580ms → 140ms (10x faster)']);
  assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
});

test('CLI: lint baseline-context (literal `baseline` keyword) suppresses @ratio hits', () => {
  const r = run(['lint', '10x faster than v1 — baseline 100ms']);
  assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
});

test('CLI: lint baseline-context does NOT suppress non-ratio hedges', () => {
  // Hedges / evaluative adjectives are NOT @ratio patterns and must still
  // deny even under a baseline anchor. Mirrors the bash hook's "non-ratio
  // hedges/adjectives still deny regardless" comment.
  const r = run(['lint', 'robust system; baseline 100ms → 50ms']);
  assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout}`);
  assert.match(r.stderr, /robust/);
});

test('CLI: lint --file <directory> rejects with friendly error (exit 2)', () => {
  // Symmetry: positional `lint <dir>` already rejected cleanly; `lint --file
  // <dir>` used to surface raw EISDIR. Fix added the same isFile() guard.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-lint-cli-'));
  try {
    const r = run(['lint', '--file', tmpDir]);
    assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /is not a regular file/);
    assert.doesNotMatch(r.stderr, /EISDIR/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: --help exits 0, prints usage to stdout', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /lint <text>/);
  assert.match(r.stdout, /audit <jsonl-path>/);
});

test('CLI: no args exits 2 + prints usage', () => {
  const r = run([]);
  assert.equal(r.status, 2, 'bare invocation must exit 2 (usage error)');
  assert.match(r.stdout, /Usage:/);
});

test('CLI: --version exits 0, prints package version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('CLI: lint clean text → exit 0, stdout "OK"', () => {
  const r = run(['lint', 'added pagination cursor; 1453 → 1490 (+2.5%)']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK/);
  assert.equal(r.stderr, '');
});

test('CLI: lint hit → exit 1, stderr describes hit, stdout empty', () => {
  const r = run(['lint', 'this is significantly better']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '', 'human-readable hits go to stderr, not stdout');
  assert.match(r.stderr, /significantly/);
  assert.match(r.stderr, /§10-V drift/);
});

test('CLI: lint --stdin reads from stdin', () => {
  const r = run(['lint', '--stdin'], 'this is significantly improved\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /significantly/);
});

test('CLI: lint --json emits parseable JSON to stdout regardless of hit/clean', () => {
  // Clean
  const okRun = run(['lint', '--json', 'clean prose 30 → 60']);
  assert.equal(okRun.status, 0);
  const okPayload = JSON.parse(okRun.stdout);
  assert.equal(okPayload.scope, 'lint');
  assert.equal(okPayload.hits.length, 0);
  // Hit
  const hitRun = run(['lint', '--json', 'this is significantly better']);
  assert.equal(hitRun.status, 1);
  const hitPayload = JSON.parse(hitRun.stdout);
  assert.equal(hitPayload.hits.length >= 1, true);
  assert.equal(hitPayload.hits[0].match.toLowerCase(), 'significantly');
});

test('CLI: lint with no positional arg + no --stdin → exit 2 usage error', () => {
  const r = run(['lint']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /text required/);
});

test('CLI: audit clean transcript → exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'added cursor; tests 30 → 35' }] },
  }) + '\n');
  try {
    const r = run(['audit', transcript]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^OK/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit transcript with banned word → exit 1, names line + turn', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'this is significantly improved' }] } }),
  ].join('\n') + '\n');
  try {
    const r = run(['audit', transcript]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /significantly/);
    assert.match(r.stderr, /1 of 1 assistant turn/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit missing file → exit 2', () => {
  const r = run(['audit', '/nonexistent/transcript.jsonl']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /file not found/);
});

test('CLI: unknown subcommand → exit 2 + usage', () => {
  const r = run(['nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown subcommand/);
  assert.match(r.stderr, /Usage:/);
});

test('CLI: lint --file PATH reads file contents (hit)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const msg = path.join(tmp, 'msg.txt');
  fs.writeFileSync(msg, 'this commit significantly improves things\n');
  try {
    const r = run(['lint', '--file', msg]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /significantly/);
    assert.equal(r.stdout, '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: lint --file PATH on clean content → exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const msg = path.join(tmp, 'msg.txt');
  fs.writeFileSync(msg, 'added cursor; tests 30 → 35\n');
  try {
    const r = run(['lint', '--file', msg]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^OK/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: lint --file <missing> → exit 2 file-not-found', () => {
  const r = run(['lint', '--file', '/nonexistent/msg.txt']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /file not found/);
});

test('CLI: lint --file without arg → exit 2', () => {
  const r = run(['lint', '--file']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--file requires a path/);
});

test('CLI: lint <existing-file-path> auto-detects --file (the bug fix)', () => {
  // Regression for the silent-success bug: pre-fix, passing a file path as
  // positional scanned the path STRING (no banned vocab) and exit 0. Now it
  // reads the file contents. Critical for git pre-commit / CI use cases.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const msg = path.join(tmp, 'COMMIT_EDITMSG');
  fs.writeFileSync(msg, 'this is robust and production-ready\n');
  try {
    const r = run(['lint', msg]);
    assert.equal(r.status, 1, 'positional existing-file should be auto-treated as --file');
    assert.match(r.stderr, /robust|production-ready/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: lint with literal text that is not a path stays text', () => {
  const r = run(['lint', 'this is just a sentence with no banned terms']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK/);
});

test('CLI: lint --file + positional → exit 2 (mutually exclusive)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const msg = path.join(tmp, 'msg.txt');
  fs.writeFileSync(msg, 'clean text');
  try {
    const r = run(['lint', '--file', msg, 'extra positional']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /mutually exclusive/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: lint --stdin + --file → exit 2', () => {
  const r = run(['lint', '--stdin', '--file', '/tmp/x'], 'hi\n');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not both/);
});

// v0.9.21 — path-shape silent-fall-through (v0.9.14 regression family).
// The v0.9.14 fix made `lint <existing-file>` auto-treat as --file. But when
// the positional looked like a path AND didn't resolve to a regular file
// (missing path, directory, basename containing a banned word), the script
// silently scanned the literal positional string and exited based on that —
// the same silent-success the v0.9.14 fix targeted. Variants A/B/D below
// previously returned exit 0 (silent OK); variant E returned a misleading
// exit 1 from scanning the path's basename. All four must now exit 2.

test('CLI: lint /path/missing.txt (path-shape, missing) → exit 2 file-not-found', () => {
  const r = run(['lint', '/tmp/claudemd-dogfood-nonexistent-msg.txt']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /file not found|not a regular file/);
});

test('CLI: lint <directory> → exit 2 not-a-regular-file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-dir-'));
  try {
    const r = run(['lint', tmp]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a regular file|is a directory/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: lint /path/with-banned-word-in-name (missing) → exit 2, not false-positive deny', () => {
  // Pre-fix: `lint /tmp/significantly-improved.txt` scanned the path STRING,
  // matched "significantly" in the basename, and exited 1 — looking like a
  // legitimate banned-vocab hit when actually nothing was scanned. Worse than
  // a silent OK because it falsely accuses the user.
  const r = run(['lint', '/tmp/claudemd-dogfood-significantly-improved.txt']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /file not found|not a regular file/);
});

test('CLI: lint <single-word-no-slash> stays text scan (no false path-error)', () => {
  // Anchor that the fix does NOT regress non-path-shape literals. A single
  // word with no `/` is plausibly text the caller wanted to scan; preserve
  // v0.9.14's "treat as text" fallback for that shape.
  const r = run(['lint', 'message.txt']);  // has dot but no slash
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK/);
});

test('CLI: lint "sentence with /file:line citation" stays text scan (whitespace disqualifies path-shape)', () => {
  // Regression: pre-fix, `lint "Fixed crash in scripts/audit.js:42 (12/12 tests pass)"`
  // exited 2 with "file not found" because the path-shape heuristic only checked
  // for `/`. Whitespace-containing positionals are almost always inline sentences
  // — real paths are token-shaped. Test both the clean-text case (exit 0) and
  // the banned-vocab case (exit 1) to anchor that the route is text-scan, not
  // file-scan.
  const r1 = run(['lint', 'Fixed crash in scripts/audit.js:42 (12/12 tests pass)']);
  assert.equal(r1.status, 0, 'whitespace + slash should route to text scan, not file lookup');
  assert.match(r1.stdout, /^OK/);

  const r2 = run(['lint', 'this is robust in src/foo.ts']);
  assert.equal(r2.status, 1, 'still flags banned vocab in path-citing sentences');
  assert.match(r2.stderr, /robust/);
});

// v0.9.18 — argv-shape silent-fallback regression coverage on the public CLI
// (same antipattern fixed in slash-command CLIs in v0.9.16/0.9.17). These
// previously silently dropped → either scanned wrong text or returned the
// wrong output channel. Each must now exit 2 with a parser error.

test('CLI: lint --jzon (typo flag) → exit 2 unknown-flag', () => {
  const r = run(['lint', '--jzon', 'this is robust']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag.*--jzon/);
});

test('CLI: lint --json=yes (bool with value) → exit 2', () => {
  const r = run(['lint', '--json=yes', 'clean text']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /boolean flag.*does not take a value/);
});

test('CLI: lint --file=PATH (= form) reads file contents', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const msg = path.join(tmp, 'msg.txt');
  fs.writeFileSync(msg, 'this commit is robust\n');
  try {
    const r = run(['lint', `--file=${msg}`]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /robust/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit on non-JSONL file (plain log / CSV) → exit 2, not silent OK', () => {
  // Regression: pre-fix, pointing audit at a non-JSONL file silently exited 0
  // with "0 assistant turn(s)" because parseTranscript skips unparseable rows.
  // CI hooks that audit transcript files would falsely greenlight a corrupt
  // or wrong-format input. Symmetric with the v0.9.21 lint silent-fall-through.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const bad = path.join(tmp, 'not-jsonl.log');
  fs.writeFileSync(bad, '2025-01-01 INFO server started\n2025-01-01 ERROR boom\nthis is robust and significantly improved\n');
  try {
    const r = run(['audit', bad]);
    assert.equal(r.status, 2, 'non-JSONL file should fail loudly, not exit 0');
    assert.match(r.stderr, /no parseable JSON rows|expected JSONL/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit on empty file → exit 0 (degenerate but valid)', () => {
  // Anchor that the silent-success guard does NOT regress the empty-file path.
  // An empty file has no lines to fail on; "0 turns scanned" is correct.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const empty = path.join(tmp, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  try {
    const r = run(['audit', empty]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OK.*0 assistant turn/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit on JSONL with one corrupt + one valid row → exit 0 (preserves silent-skip on partial corruption)', () => {
  // Anchor: parseTranscript's documented contract is to silently skip corrupt
  // rows. The audit-level "no parseable rows" guard fires ONLY when 100% of
  // non-empty lines fail to parse, not when SOME rows parse. Mid-write
  // truncation (CC writes transcripts as one-JSON-per-line append) should
  // still scan whatever IS parseable.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const mixed = path.join(tmp, 'mixed.jsonl');
  fs.writeFileSync(mixed, '{"partial":\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'clean' }] } }) + '\n');
  try {
    const r = run(['audit', mixed]);
    assert.equal(r.status, 0, 'one parseable row is enough to clear the guard');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: audit --include-ratiox (typo flag) → exit 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmlc-'));
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'clean' }] },
  }) + '\n');
  try {
    const r = run(['audit', '--include-ratiox', transcript]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag.*--include-ratiox/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
