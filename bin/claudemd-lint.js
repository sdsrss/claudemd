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
  claudemd lint --stdin           Read text from stdin.
  claudemd audit <jsonl-path>     Scan all assistant turns in a CC transcript.
  claudemd --version              Print plugin version.
  claudemd --help                 Print this message.

Flags:
  --json                          Emit machine-readable JSON instead of text.
  --include-ratio                 (audit only) Include @ratio patterns.
                                  Default OFF — chat prose has different
                                  baseline conventions from commit messages.

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

function lintCmd(args) {
  const json = args.includes('--json');
  const stdin = args.includes('--stdin');
  const positional = args.filter(a => !a.startsWith('--'));

  let text;
  if (stdin) {
    try {
      text = fs.readFileSync(0, 'utf8');
    } catch (e) {
      process.stderr.write(`lint: failed to read stdin: ${e.message}\n`);
      process.exit(2);
    }
  } else if (positional.length > 0) {
    text = positional.join(' ');
  } else {
    process.stderr.write('lint: text required (positional arg or --stdin)\n');
    process.exit(2);
  }

  const hits = scan(text);
  if (json) {
    process.stdout.write(formatJSON({ scope: 'lint', text, hits }) + '\n');
  } else {
    const out = formatHumanReadable({ scope: 'lint', hits });
    if (hits.length === 0) process.stdout.write(out + '\n');
    else process.stderr.write(out + '\n');
  }
  process.exit(hits.length === 0 ? 0 : 1);
}

function auditCmd(args) {
  const json = args.includes('--json');
  const includeRatio = args.includes('--include-ratio');
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
