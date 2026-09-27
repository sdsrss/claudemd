#!/usr/bin/env node
// build-spec-modules — write spec/spec-modules/<name>.md from the marked
// sections of spec/CLAUDE-extended.md (scripts/lib/spec-modules.js). The
// outputs are committed and shipped like any spec file; --check fails when
// they differ from what the source builds, so an edit to the source without a
// rebuild cannot ship.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';
import { buildFromRoot, MODULE_DIR } from './lib/spec-modules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `Usage: node scripts/build-spec-modules.js [--check]

Build spec/${MODULE_DIR}/<name>.md from the module markers in spec/CLAUDE-extended.md.

Options:
  --check        Write nothing; exit 1 if any module on disk differs from the build.
  --help, -h     Print this message and exit.

Exit codes: 0 built or up to date | 1 out of date or build error | 2 argv-shape error.`;

export function plan(root = ROOT) {
  const built = buildFromRoot(root);
  const dir = path.join(root, 'spec', MODULE_DIR);
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
  const stale = Object.entries(built)
    .filter(([n, text]) => {
      const f = path.join(dir, `${n}.md`);
      return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text;
    })
    .map(([n]) => n);
  const orphans = onDisk.map(f => f.replace(/\.md$/, '')).filter(n => !built[n]);
  return { built, dir, stale, orphans };
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const p = parseStrictOrExit(process.argv.slice(2), { bools: ['--check'] });
  let r;
  try {
    r = plan();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (p.bools.has('--check')) {
    if (r.stale.length || r.orphans.length) {
      console.error(
        `spec modules out of date: stale ${r.stale.join(', ') || '-'}; orphans ${r.orphans.join(', ') || '-'}. Run: node scripts/build-spec-modules.js`
      );
      process.exit(1);
    }
    console.log(`spec modules up to date (${Object.keys(r.built).length})`);
  } else {
    fs.mkdirSync(r.dir, { recursive: true });
    for (const n of r.orphans) fs.rmSync(path.join(r.dir, `${n}.md`), { force: true });
    for (const [n, text] of Object.entries(r.built)) fs.writeFileSync(path.join(r.dir, `${n}.md`), text);
    console.log(`wrote ${Object.keys(r.built).length} module(s) to spec/${MODULE_DIR}/`);
  }
}
