#!/usr/bin/env node
// claim-drift — list the prose lines a change may have made untrue.
//
// docs/audit/20260926-180700.md 9.6 D3. Across two releases, 7 of 13 pre-ship
// "claims" findings were introduced by the repair commit itself: a hook, flag or
// field changed, and a CHANGELOG line, a README row or a hook header comment
// elsewhere kept describing the old behaviour. Whether such a line is now wrong
// takes reading; finding the lines does not. This script extracts the names a
// diff touches and lists every line OUTSIDE the diff that mentions one, in the
// prose files a reader trusts. It is a candidate list for the author to reread
// before committing a repair, never a gate: most listed lines are still true.
//
// Names taken from the diff: the base name of each changed hook, script or
// command file; UPPER_CASE environment names, `--flags`, shell and JS function
// names, and rule-hits event names on changed lines.
// Files searched: CHANGELOG.md and spec/CLAUDE-changelog.md (top entry only: older
// entries record what shipped then), README.md, CONTRIBUTING.md, docs/**/*.md
// except docs/audit/ and dated records, spec/*.md, commands/*.md, and hook comment lines.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/claim-drift.js [--range=BASE..HEAD] [--limit=N] [--json]

List lines outside a diff that mention a name the diff changed, in the prose
files a reader trusts (CHANGELOG, README, docs/, spec/, commands/, hook header
comments). A candidate list to reread before committing, not a gate.

Options:
  --range=A..B   Commit range to read (default HEAD~1..HEAD).
  --limit=N      Mentions listed per name (default 12; the rest are counted).
  --json         Machine-readable output.
  --help, -h     Print this message and exit.

Exit codes: 0 success | 1 git error | 2 argv-shape error.`;

const STOP = new Set([
  'HOME',
  'PATH',
  'TMPDIR',
  'CLAUDE',
  'TODO',
  'NOTE',
  'JSON',
  'HEAD',
  'README',
  'CHANGELOG',
]);

/** Names a unified diff (from `git diff -U0`) touches. */
export function extractNames(diffText) {
  const names = new Set();
  for (const line of diffText.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line) || /^--- a\/(.+)$/.exec(line);
    if (m) {
      const fm = /^(hooks|scripts|commands)\/(?:lib\/)?([A-Za-z0-9._-]+)\.(sh|js|mjs|md)$/.exec(m[1]);
      if (fm) names.add(fm[2]);
      continue;
    }
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const body = line.slice(1);
    for (const e of body.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g)) if (!STOP.has(e[0])) names.add(e[0]);
    for (const f of body.matchAll(/(?<![\w-])--[a-z][a-z0-9-]{2,}\b/g)) names.add(f[0]);
    const sh = /^\s*([a-z_][a-z0-9_]{3,})\(\)\s*\{/.exec(body);
    if (sh) names.add(sh[1]);
    for (const j of body.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]{3,})\s*\(/g)) names.add(j[1]);
    for (const j of body.matchAll(
      /\bconst\s+([A-Za-z_][A-Za-z0-9_]{3,})\s*=\s*(?:\(|async\s*\(|[a-z_]+\s*=>)/g
    ))
      names.add(j[1]);
    for (const h of body.matchAll(/\bhook_record(?:_failopen)?\s+[a-z0-9-]+\s+([a-z][a-z0-9-]{3,})/g))
      names.add(h[1]);
  }
  return names;
}

/** Line numbers the diff added or changed in the new version, per file. */
export function changedLines(diffText) {
  const out = new Map();
  let file = null;
  for (const line of diffText.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) {
      file = m[1];
      if (!out.has(file)) out.set(file, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const n = h[2] === undefined ? 1 : Number(h[2]);
      for (let i = 0; i < n; i++) out.get(file).add(start + i);
    }
  }
  return out;
}

/** The prose files to search, from a list of tracked paths. */
export function proseFiles(tracked) {
  return tracked.filter(
    f =>
      ['CHANGELOG.md', 'README.md', 'CONTRIBUTING.md'].includes(f) ||
      // Dated plans, designs and analyses are records of their day, like old
      // changelog entries; the living docs carry no date in their path.
      (/^docs\/.+\.md$/.test(f) && !f.startsWith('docs/audit/') && !/\d{4}-\d{2}-\d{2}/.test(f)) ||
      /^spec\/[^/]+\.md$/.test(f) ||
      /^commands\/[^/]+\.md$/.test(f) ||
      /^hooks\/.+\.sh$/.test(f)
  );
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mentions of each name outside the changed lines. `read(file)` returns its text. */
export function findMentions(names, files, changed, read) {
  const res = new Map([...names].map(n => [n, []]));
  const res0 = [...names].map(n => [n, new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(n)}(?![A-Za-z0-9_-])`)]);
  for (const f of files) {
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    const skip = changed.get(f) || new Set();
    const isHook = f.endsWith('.sh');
    // A changelog's older entries record what shipped then; only its top entry
    // (the one being written) can still be made untrue. An entry heading
    // STARTS with its version (`## [0.107.0] - …`, `## v7.2.0 (…)`): a version
    // anywhere in the line also matched `## Versioning policy (set in v0.2.1)`
    // above the first entry, and the search stopped before reading it.
    const lines = text.split('\n');
    let stop = lines.length;
    if (/(^|\/)(CHANGELOG\.md|CLAUDE-changelog\.md)$/.test(f)) {
      const heads = lines.flatMap((l, i) => (/^## \[?v?\d+\.\d+\.\d+/.test(l) ? [i] : []));
      if (heads.length > 1) stop = heads[1];
    }
    lines.slice(0, stop).forEach((line, i) => {
      if (skip.has(i + 1)) return;
      if (isHook && !/^\s*#/.test(line)) return;
      for (const [n, re] of res0)
        if (re.test(line)) res.get(n).push({ file: f, line: i + 1, text: line.trim() });
    });
  }
  return res;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main(p) {
  const range = p.values['--range'] || 'HEAD~1..HEAD';
  const limit = Number(p.values['--limit'] || 12);
  if (!/^[^\s.][^\s]*\.\.[^\s.][^\s]*$/.test(range) || !Number.isInteger(limit) || limit < 1) {
    console.error(
      `claim-drift: --range must be A..B and --limit a positive integer (got ${range}, ${p.values['--limit']})`
    );
    process.exit(2);
  }
  // Every git call runs from the top level: from a subdirectory `ls-files`
  // lists only that subtree, relative to it, and no prose file matched.
  let diff, tracked, root;
  try {
    root = git(['rev-parse', '--show-toplevel']).trim();
    diff = git(['diff', '-U0', '--no-color', range], root);
    tracked = git(['ls-files'], root).split('\n').filter(Boolean);
  } catch (e) {
    console.error(`claim-drift: git failed: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
  const names = extractNames(diff);
  const found = findMentions(names, proseFiles(tracked), changedLines(diff), f =>
    fs.readFileSync(path.join(root, f), 'utf8')
  );
  const rows = [...found].filter(([, v]) => v.length > 0).sort((a, b) => b[1].length - a[1].length);
  if (p.bools.has('--json')) {
    process.stdout.write(
      JSON.stringify(
        { range, names: names.size, withMentions: rows.length, mentions: Object.fromEntries(rows) },
        null,
        2
      ) + '\n'
    );
    return;
  }
  console.log(
    `claim-drift ${range}: ${names.size} name(s) changed, ${rows.length} mentioned outside the diff.`
  );
  console.log('Reread each line below and decide whether it is still true. Not every line is wrong.\n');
  for (const [n, list] of rows) {
    console.log(`${n} (${list.length})`);
    for (const m of list.slice(0, limit)) console.log(`  ${m.file}:${m.line}: ${m.text.slice(0, 160)}`);
    if (list.length > limit) console.log(`  … ${list.length - limit} more`);
  }
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  main(parseStrictOrExit(process.argv.slice(2), { bools: ['--json'], values: ['--range', '--limit'] }));
}
