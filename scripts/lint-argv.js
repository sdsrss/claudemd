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
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

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
const FILE_ALLOWLIST = {
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
  {
    // Same silent-fallback family, one layer up: not "the flag was misread" but
    // "the CLI never ran". node resolves import.meta.url through symlinks and
    // percent-encodes the URL, argv[1] does neither, so this comparison is
    // false whenever the script is reached through a linked dir or a path with
    // a space — exit 0, empty stdout, indistinguishable from success
    // (2026-09-05 audit P0-1; install.js returned "ok" and wrote no manifest).
    name: 'import.meta.url === file:// + argv[1] (main guard)',
    regex: /import\.meta\.url\s*===\s*`file:/,
    why: 'Main guard silently false under a symlinked dir or a space in the path. Use invokedAsMain(import.meta.url) from scripts/lib/argv.js.',
  },
];

const ALLOW_TOKEN = 'argv-lint:allow';
// Preceding-line form: the comment must OPEN with the token. Derived from
// ALLOW_TOKEN so the two spellings cannot drift.
const ALLOW_LINE_RE = new RegExp(`^//\\s*${ALLOW_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

// Round-6: structural blind-spot closure. The three regex PATTERNS above
// detect *wrong-shape* argv reads. They cannot detect "main block exists
// but never reads argv at all" — the v0.9.x → Round-1/Round-5 family
// (status.js / lint-argv.js / install.js / uninstall.js / update.js) where
// `--help` and `--bogus` were silently swallowed because no validation ran.
//
// scanMainBlockMissingArgv: for each .js under bin/ + scripts/ (excluding
// scripts/lib/), if the file has a main-block guard, the body must call EITHER
// parseStrict( OR printHelpAndExit( OR validateAndExpandFlags(
// (bin/claudemd-lint.js path). Files without a main block are ignored.
//
// THREE guard shapes are recognised, and recognising all of them is the point:
// a guard this function cannot see makes the file "not a CLI", so the gate
// skips it silently — the failure mode it was written to prevent. The canonical
// shape is `invokedAsMain(import.meta.url)` (scripts/lib/argv.js). The other
// two are the hand-rolled ancestors: the href compare, which PATTERNS above now
// rejects outright because it is false under a symlink or a space in the path
// (2026-09-05 audit P0-1), and the realpath IIFE that two scripts carried
// before the helper existed (R11-33). Both are still DETECTED here so that a
// file re-introducing one is judged for argv validation rather than skipped.
const MAIN_BLOCK_HREF_RE = /if\s*\(\s*import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/;
// The realpath form is two statements: an IIFE comparing realpaths bound to a
// name, then `if (<name>)`. Keyed on the IIFE (which is what makes it a main
// guard) rather than on the identifier spelling, so renaming `invokedAsMain`
// does not reopen the hole.
const MAIN_BLOCK_REALPATH_DECL_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,400}?realpathSync\s*\([\s\S]{0,200}?process\.argv\[1\]/;
// Canonical shape: `if (<binding>(import.meta.url))`, where <binding> is what
// this file imported invokedAsMain AS. Keyed on the import binding rather than
// on the literal name for the same reason the validator join is (R10-20): a
// local function called invokedAsMain would satisfy a name match while doing
// something else, and an aliased import would evade one.
const MAIN_GUARD_HELPER = 'invokedAsMain';

// → {index} like a RegExp match, or null. Exported so the gate's own test can
// pin BOTH shapes against fixtures rather than against the two real files that
// happen to be compliant today.
export function findMainBlockGuard(text) {
  const href = text.match(MAIN_BLOCK_HREF_RE);
  const decl = text.match(MAIN_BLOCK_REALPATH_DECL_RE);
  let realpathIdx = -1;
  if (decl) {
    const use = new RegExp(`if\\s*\\(\\s*${decl[1]}\\s*\\)`).exec(text.slice(decl.index));
    if (use) realpathIdx = decl.index + use.index;
  }
  let helperIdx = -1;
  for (const name of importedBindings(text, [MAIN_GUARD_HELPER])) {
    const use = new RegExp(`if\\s*\\(\\s*${name}\\s*\\(`).exec(text);
    if (use && (helperIdx < 0 || use.index < helperIdx)) helperIdx = use.index;
  }
  const candidates = [href ? href.index : -1, realpathIdx, helperIdx].filter(i => i >= 0);
  if (candidates.length === 0) return null;
  return { index: Math.min(...candidates) };
}
const ARGV_VALIDATORS = ['parseStrict', 'parseStrictOrExit', 'printHelpAndExit', 'validateAndExpandFlags'];
// The call alone is not authentication (audit-2026-08-22 条目 14). A file that
// declares its own function by one of those names would validate nothing — and
// that was not hypothetical: the gate had been widened to admit
// `validateAndExpandFlags` precisely because bin/claudemd-lint.js kept a
// private copy, so the widening legitimised the duplicate instead of converging
// it. The validator now lives in scripts/lib/argv.js and the name must arrive
// by import from there.
//
// 2026-08-29 audit R10-20: that fix left residue. The check was
// `REQUIRED_CALL_RE.test(body) && ARGV_LIB_IMPORT_RE.test(text)` — two
// questions ("is a validator name called?", "does this file import ANYTHING
// from lib/argv.js?") that were never joined. Importing only `ArgvError` while
// calling a locally-declared `parseStrict` satisfied both, so the comment above
// described a stronger rule than the code asked for. The join is now on the
// LOCAL BINDING: the name the main block calls must be the name lib/argv.js
// bound in this file, alias included.
function importedBindings(text, names) {
  const bound = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*lib\/argv\.js['"]/g)) {
    for (const spec of m[1].split(',')) {
      const t = spec.trim();
      if (!t) continue;
      const [orig, alias] = t.split(/\s+as\s+/).map(s => s.trim());
      if (names.includes(orig)) bound.add(alias || orig);
    }
  }
  return bound;
}
// Files that legitimately have a main block but no argv contract — must be
// allowlisted with a one-line reason. Empty by default; entries here represent
// considered exemptions, not "I forgot to wire parseStrict."
const MAIN_BLOCK_ALLOWLIST = {};

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
      const guardMatch = findMainBlockGuard(text);
      if (!guardMatch) continue;
      const body = text.slice(guardMatch.index);
      // The name the main block calls must be a binding this file imported from
      // scripts/lib/argv.js. A locally-declared same-name function does not
      // pass, and neither does an unrelated import from that module.
      const bound = importedBindings(text, ARGV_VALIDATORS);
      if ([...bound].some(name => new RegExp(`\\b${name}\\s*\\(`).test(body))) continue;
      // Find line number of the main block guard for actionable error.
      const before = text.slice(0, guardMatch.index);
      const line = before.split('\n').length;
      hits.push({
        file: rel,
        line,
        pattern: 'main-block-without-argv-validation',
        why: 'Main block has no argv contract from scripts/lib/argv.js — `--help`/`--bogus` silently run the script. Import and call `printHelpAndExit + parseStrict` (or `validateAndExpandFlags` for the space-form CLI). A local function by the same name does not count.',
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
        // Same line, or the line immediately above. Trailing-comment-only was a
        // layout-coupled suppression: a formatter that wraps the line past
        // printWidth moves the comment onto its own line and SILENTLY RE-ARMS
        // the gate on code nobody touched. That is not hypothetical — running
        // `prettier --write` over this tree re-armed exactly one site
        // (bin/claudemd-lint.js's `--help`-in-any-position check, whose comment
        // pushed it past 110 columns). The preceding-line form is what every
        // other suppression convention uses (`eslint-disable-next-line`) and it
        // survives reflow. A blank line between the two does not count.
        if (line.includes(ALLOW_TOKEN)) return;
        // The preceding line must BE the suppression, not merely mention it:
        // `// argv-lint:allow …` at the start of the comment. `includes()` here
        // let a sentence explaining the convention ("append argv-lint:allow to
        // a vetted line") silence whatever code happened to follow it — the
        // 0.72.0 pre-tag review demonstrated that with a working example
        // (MEDIUM-2). A gate that reads prose as its own directive is the
        // feedback_gate_reads_prose_not_code shape.
        const above = i > 0 ? lines[i - 1].trimStart() : '';
        if (ALLOW_LINE_RE.test(above)) return;
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

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  // The validator validating itself: lint-argv takes no flags, so any arg
  // (including `--help` after the helper above returns false on absence) is
  // unknown. Pre-fix it silently ignored ALL arguments and exited 0 — the
  // exact silent-fallback class this gate is supposed to detect.
  parseStrictOrExit(process.argv.slice(2), {});
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
  process.stderr.write(
    `Fix: route flag parsing through scripts/lib/argv.js#parseStrict (slash-command CLIs)\n`
  );
  process.stderr.write(
    `     or validateAndExpandFlags (bin/claudemd-lint.js, supports both --key=v and --key v).\n`
  );
  process.stderr.write(
    `     If the line is genuinely safe (validator runs upstream), put \`// ${ALLOW_TOKEN} — <why>\`\n`
  );
  process.stderr.write(
    `     on the line ABOVE it (preferred — survives reformatting) or at the end of the line itself.\n`
  );
  process.exit(1);
}
