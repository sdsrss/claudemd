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
  const hits = scan();
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
