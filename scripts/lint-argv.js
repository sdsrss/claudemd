#!/usr/bin/env node
// lint-argv — repo-wide guard against the argv-shape silent-fallback antipattern
// that recurred 5× across v0.9.14–v0.9.18:
//   v0.9.14  bin/claudemd-lint.js positional <path> silent-text-scan
//   v0.9.15  hooks/memory-read-check.sh grep flag-vs-arg with --tag
//   v0.9.16  scripts/{clean-residue,audit,sparkline}.js args.find startsWith
//   v0.9.17  scripts/{doctor,hard-rules-audit}.js same
//   v0.9.18  bin/claudemd-lint.js args.includes / args.indexOf on '--*'
// Each release fixed the call sites the prior release tripped on but never
// the antipattern as a class. This script greps the union of three known
// signatures across bin/ + scripts/, exits 1 on any hit. Inline allowlist:
// append `// argv-lint:allow` to a vetted line. File allowlist: add to
// FILE_ALLOWLIST below with a one-line reason.
//
// Run: node scripts/lint-argv.js   (or `npm run lint:argv`)
// Module:  import { scan } from './scripts/lint-argv.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/lint-argv.js

Repo-wide lint for the argv-shape silent-fallback antipattern. Scans
bin/ + scripts/ for three known signatures (args.includes / args.find +
startsWith / args.indexOf on '--literal') and exits 1 on any hit.

No flags. Inline allowlist token: \`// argv-lint:allow\`.

Options:
  --help, -h     Print this message and exit.

Exit codes: 0 clean | 1 antipattern hit | 2 argv-shape error.`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

export const SCAN_DIRS = ['bin', 'scripts'];
export const SCAN_EXT = ['.js'];

// File-level allowlist. Each entry MUST have a reason — these files contain
// antipattern strings as part of detector code or documentation, NOT runtime
// parsing. The lint-argv gate is per-line by design; whole-file exemption
// only when the file is itself the gate or the parser library.
export const FILE_ALLOWLIST = {
  'scripts/lib/argv.js': 'parseStrict implementation; pattern shapes appear in comments + error messages',
  'scripts/lint-argv.js': 'this gate (the detector itself)',
};

export const PATTERNS = [
  {
    name: 'args.includes(--literal)',
    regex: /\b\w+\.includes\s*\(\s*['"]--/,
    why: 'Silent-drop on --key=value form. Use parseStrict bools or run validateAndExpandFlags upstream and add argv-lint:allow.',
  },
  {
    name: 'args.find(a => a.startsWith(--))',
    regex: /\.find\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.startsWith\s*\(\s*['"]--/,
    why: 'Silent-drop on space-form / unknown flag / bool-with-value. Use parseStrict.',
  },
  {
    name: 'args.indexOf(--literal)',
    regex: /\b\w+\.indexOf\s*\(\s*['"]--/,
    why: 'Silent-miss on --key=value form. Use parseStrict values or run validateAndExpandFlags upstream and add argv-lint:allow.',
  },
];

const ALLOW_TOKEN = 'argv-lint:allow';

// Round-6: structural blind-spot closure. The three regex PATTERNS above
// detect *wrong-shape* argv reads. They cannot detect "main block exists
// but never reads argv at all" — the v0.9.x → Round-1/Round-5 family
// (status.js / lint-argv.js / install.js / uninstall.js / update.js) where
// `--help` and `--bogus` were silently swallowed because no validation ran.
//
// scanMainBlockMissingArgv: for each .js under bin/ + scripts/ (excluding
// scripts/lib/), if the file has a main-block guard
// `if (import.meta.url === \`file://${process.argv[1]}\`) {`, the body must
// call EITHER parseStrict( OR printHelpAndExit( OR validateAndExpandFlags(
// (bin/claudemd-lint.js path). Files without a main block are ignored.
const MAIN_BLOCK_GUARD_RE = /if\s*\(\s*import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/;
const REQUIRED_CALL_RE = /\b(parseStrict|printHelpAndExit|validateAndExpandFlags)\s*\(/;
// Files that legitimately have a main block but no argv contract — must be
// allowlisted with a one-line reason. Empty by default; entries here represent
// considered exemptions, not "I forgot to wire parseStrict."
export const MAIN_BLOCK_ALLOWLIST = {};

export function scanMainBlockMissingArgv({
  root = REPO_ROOT,
  dirs = SCAN_DIRS,
  exts = SCAN_EXT,
  fileAllowlist = FILE_ALLOWLIST,
  mainBlockAllowlist = MAIN_BLOCK_ALLOWLIST,
} = {}) {
  const hits = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkJsFiles(abs, exts)) {
      const rel = path.relative(root, file);
      // Skip lib/ — internal modules don't have CLI main blocks.
      if (rel.includes(`${path.sep}lib${path.sep}`)) continue;
      if (fileAllowlist[rel]) continue;
      if (mainBlockAllowlist[rel]) continue;
      const text = fs.readFileSync(file, 'utf8');
      const guardMatch = text.match(MAIN_BLOCK_GUARD_RE);
      if (!guardMatch) continue;
      const body = text.slice(guardMatch.index);
      if (REQUIRED_CALL_RE.test(body)) continue;
      // Find line number of the main block guard for actionable error.
      const before = text.slice(0, guardMatch.index);
      const line = before.split('\n').length;
      hits.push({
        file: rel,
        line,
        pattern: 'main-block-without-argv-validation',
        why: 'Main block ignores process.argv — `--help`/`--bogus` silently run the script. Add `printHelpAndExit + parseStrict` (or validateAndExpandFlags for bin/claudemd-lint.js).',
        text: '<main block guard>',
      });
    }
  }
  return hits;
}

function* walkJsFiles(dir, exts) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkJsFiles(full, exts);
    } else if (exts.includes(path.extname(ent.name))) {
      yield full;
    }
  }
}

export function scan({
  root = REPO_ROOT,
  dirs = SCAN_DIRS,
  exts = SCAN_EXT,
  fileAllowlist = FILE_ALLOWLIST,
  patterns = PATTERNS,
} = {}) {
  const hits = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkJsFiles(abs, exts)) {
      const rel = path.relative(root, file);
      if (fileAllowlist[rel]) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes(ALLOW_TOKEN)) return;
        // Skip pure `//` comment lines (documentation that mentions the
        // antipattern as a literal — the validator's own docstring quotes
        // `args.includes('--json')` etc. as the bug it prevents). End-of-line
        // comments on a code line are NOT skipped: `code(); // note` still
        // scans the code portion.
        if (line.trimStart().startsWith('//')) return;
        for (const p of patterns) {
          if (p.regex.test(line)) {
            hits.push({ file: rel, line: i + 1, pattern: p.name, why: p.why, text: line.trim() });
          }
        }
      });
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  // The validator validating itself: lint-argv takes no flags, so any arg
  // (including `--help` after the helper above returns false on absence) is
  // unknown. Pre-fix it silently ignored ALL arguments and exited 0 — the
  // exact silent-fallback class this gate is supposed to detect.
  try {
    parseStrict(process.argv.slice(2), {});
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const patternHits = scan();
  const structuralHits = scanMainBlockMissingArgv();
  const hits = [...patternHits, ...structuralHits];
  if (hits.length === 0) {
    process.stdout.write(`argv-lint: 0 hits across ${SCAN_DIRS.join(' + ')}/.\n`);
    process.exit(0);
  }
  process.stderr.write(`argv-lint: ${hits.length} antipattern hit(s):\n\n`);
  for (const h of hits) {
    process.stderr.write(`  ${h.file}:${h.line}  [${h.pattern}]\n`);
    process.stderr.write(`    ${h.text}\n`);
    process.stderr.write(`    why: ${h.why}\n\n`);
  }
  process.stderr.write(`Fix: route flag parsing through scripts/lib/argv.js#parseStrict (slash-command CLIs)\n`);
  process.stderr.write(`     or validateAndExpandFlags (bin/claudemd-lint.js, supports both --key=v and --key v).\n`);
  process.stderr.write(`     If the line is genuinely safe (validator runs upstream), append \`// ${ALLOW_TOKEN}\` to it.\n`);
  process.exit(1);
}
