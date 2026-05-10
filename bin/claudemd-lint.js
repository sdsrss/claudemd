#!/usr/bin/env node
// claudemd-lint — CLI surface for §10-V banned-vocab + transcript scanning.
// Built for use OUTSIDE Claude Code: git pre-commit hooks, GitHub Actions,
// other agent integrations (Codex / Cursor / OpenClaw). Reuses the same
// pattern file (hooks/banned-vocab.patterns) the in-CC bash hooks read,
// so enforcement is consistent across surfaces.
//
// Once published to npm:
//   npx claudemd lint "your commit message here"
//   npx claudemd lint --stdin < message.txt
//   npx claudemd audit ~/.claude/projects/.../session.jsonl
//
// Pre-publish (this repo, dev mode):
//   node bin/claudemd-lint.js lint "..."
//   node bin/claudemd-lint.js audit transcript.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scan,
  readPatterns,
  parseTranscript,
  formatHumanReadable,
  formatJSON,
} from '../scripts/lib/lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const USAGE = `claudemd-lint — §10-V banned-vocab + transcript scanner

Usage:
  claudemd lint <text>            Scan text for banned-vocab.
  claudemd lint --file <path>     Scan the contents of a file.
  claudemd lint --stdin           Read text from stdin.
  claudemd audit <jsonl-path>     Scan all assistant turns in a CC transcript.
  claudemd --version              Print plugin version.
  claudemd --help                 Print this message.

Flags:
  --json                          Emit machine-readable JSON instead of text.
  --include-ratio                 (audit only) Include @ratio patterns.
                                  Default OFF — chat prose has different
                                  baseline conventions from commit messages.

Notes:
  A bare \`lint <arg>\` whose only positional is an existing regular file
  is auto-treated as \`--file <arg>\` so \`claudemd lint .git/COMMIT_EDITMSG\`
  works as expected in pre-commit hooks. Pass --stdin or quote literal
  text to opt out.

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

// Strict-validate flag-shaped args + normalize `--key=value` → `--key value`
// pairs so the existing space-form parsing below works on either shape.
// Catches the same antipattern the slash-command CLIs hit in v0.9.16/0.9.17:
// `args.includes('--json')` returns false for `--json=yes`, so the flag was
// silently dropped; `args.indexOf('--file')` returns -1 for `--file=PATH`,
// so the value was silently ignored; an unknown `--jzon` typo was silently
// stripped from positional and never surfaced. Each path now exits 2.
function validateAndExpandFlags(args, knownBools, knownValues, sub) {
  const out = [];
  const bools = new Set(knownBools);
  const values = new Set(knownValues);
  for (const a of args) {
    if (!a.startsWith('--')) { out.push(a); continue; }
    if (a.includes('=')) {
      const eq = a.indexOf('=');
      const k = a.slice(0, eq);
      const v = a.slice(eq + 1);
      if (bools.has(k)) {
        process.stderr.write(`${sub}: '${k}' is a boolean flag and does not take a value (got '${a}'). Drop the '=...' suffix.\n`);
        process.exit(2);
      }
      if (values.has(k)) {
        out.push(k);
        out.push(v);
        continue;
      }
      process.stderr.write(`${sub}: unknown flag '${k}' (got '${a}').\n`);
      process.exit(2);
    }
    if (bools.has(a) || values.has(a)) { out.push(a); continue; }
    process.stderr.write(`${sub}: unknown flag '${a}'.\n`);
    process.exit(2);
  }
  return out;
}

function lintCmd(rawArgs) {
  const args = validateAndExpandFlags(rawArgs, ['--json', '--stdin'], ['--file'], 'lint');
  const json = args.includes('--json');     // argv-lint:allow — validated upstream by validateAndExpandFlags
  const stdin = args.includes('--stdin');   // argv-lint:allow — validated upstream by validateAndExpandFlags

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
    } catch (e) {
      process.stderr.write(`lint: failed to read ${filePath}: ${e.message}\n`);
      process.exit(2);
    }
  } else if (positional.length > 0) {
    // Auto-detect: a bare single positional that is an existing regular file
    // is overwhelmingly the user's intent (they're piping a commit-msg path
    // from a git pre-commit hook). Without this, `claudemd lint message.txt`
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
      const looksLikePath = arg.includes('/') || arg === '.' || arg === '..';
      try {
        const st = fs.statSync(arg);
        if (st.isFile()) {
          text = fs.readFileSync(arg, 'utf8');
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

  // Per-commit escape hatch — mirrors hooks/banned-vocab-check.sh:36. Without
  // this, `claudemd-cli lint --file=.git/COMMIT_EDITMSG` in a git pre-commit
  // hook silently disagreed with the in-CC bash hook: the same commit message
  // with `[allow-banned-vocab]` would pass the bash gate (exit 0) but the CLI
  // would still exit 1 and block the commit. Same input → different verdict =
  // contract violation across surfaces of the same feature.
  const ESCAPE_HATCH = '[allow-banned-vocab]';
  if (text.includes(ESCAPE_HATCH)) {
    if (json) {
      process.stdout.write(formatJSON({ scope: 'lint', text, hits: [], bypass: 'allow-banned-vocab' }) + '\n');
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
  const HAS_NUMERIC_ARROW = /\d\S*\s*(?:→|->|=>)\s*\d/;
  const HAS_BASELINE = /baseline/i;
  const baselineExempt = HAS_NUMERIC_ARROW.test(text) || HAS_BASELINE.test(text);

  const hits = scan(text, { excludeRatio: baselineExempt });
  if (json) {
    process.stdout.write(formatJSON({ scope: 'lint', text, hits }) + '\n');
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

  const jsonl = fs.readFileSync(transcriptPath, 'utf8');
  const turns = parseTranscript(jsonl);
  const patterns = readPatterns();
  const annotated = turns.map(t => ({
    ...t,
    hits: scan(t.text, { excludeRatio: !includeRatio, patterns }),
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
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
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
