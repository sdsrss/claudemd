#!/usr/bin/env node
// doc-check — mechanical self-check for a long-form markdown analysis document.
//
// Origin: `docs/spec-optimization-roadmap-2026-09-21.md` shipped with a
// single-purpose scratchpad checker (`doccheck.mjs`,附 A) whose five checks were
// hardcoded to that one document — the invariants, the forbidden claims and the
// repo root were all literals. This is that checker with the document-specific
// half moved INTO the document: the four structural checks derive their subject
// from the text, and the two judgement calls (which claims are retracted, which
// ratios are asserted in prose rather than in `A/B = P%` form) come from a
// ```doc-check fenced block the document carries itself.
//
// Why a gate at all: this repo's recurring defect is prose that outlives its
// subject — a path that moved, a §-anchor that was renamed, a count written as a
// constant and never re-derived (claude-mem-lite #108: zero code defects, ten
// prose defects, five review rounds). Every check here answers a question a
// reviewer would otherwise have to answer by hand, once per round.
//
// Run: node scripts/doc-check.mjs <doc.md> [--allow-untracked-missing]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/doc-check.mjs <doc.md> [--allow-untracked-missing]

Mechanical self-check for a long-form markdown document. Five checks:

  paths     every backtick-quoted repo path and ~/.claude path exists
  anchors   every §-anchor resolves in one of the spec sources
  g-refs    every G<n> reference has a matching "### G<n>" heading
  ratios    every inline "A/B ... P%" recomputes, plus ratio: config lines
  stale     retracted claims (stale: config lines) appear only where allowed

The document may carry a \`\`\`doc-check fenced block with these repeatable
keys: stale, stale-section-exempt, stale-line-exempt, skip-line, spec-source,
ratio. Without the block the first four checks still run.

Options:
  --allow-untracked-missing   A referenced path that is absent AND not
                              git-tracked is reported, not failed. For CI,
                              where the operator's local-only files do not
                              exist. Absent tracked paths still fail.
  --help, -h                  Print this message and exit.

Exit codes: 0 clean | 1 problem found | 2 argv-shape error.`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

// Where a §-anchor may be defined. Repo-relative on purpose: the installed spec
// under ~/.claude is a DIFFERENT artifact (possibly a different version, and
// absent in CI), so resolving anchors against it would make the gate's verdict
// depend on the machine. Overridable per document with `spec-source:`.
export const DEFAULT_SPEC_SOURCES = [
  'spec/CLAUDE.md',
  'spec/CLAUDE-extended.md',
  'spec/hard-rules.json',
  'scripts/sampling-audit.js',
];

/** Parse the optional ```doc-check fenced block. Unknown keys are an error. */
export function parseConfig(text) {
  const cfg = {
    stale: [],
    staleSectionExempt: [],
    staleLineExempt: [],
    skipLine: [],
    specSource: [],
    ratio: [],
  };
  const errors = [];
  const block = text.match(/^```doc-check[ \t]*\n([\s\S]*?)^```[ \t]*$/m);
  if (!block) return { cfg, errors, present: false };
  for (const [i, raw] of block[1].split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at === -1) {
      errors.push(`doc-check block line ${i + 1}: no "key: value" separator`);
      continue;
    }
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!value) {
      errors.push(`doc-check block line ${i + 1}: empty value for "${key}"`);
      continue;
    }
    switch (key) {
      case 'stale':
        cfg.stale.push(value);
        break;
      case 'stale-section-exempt':
        cfg.staleSectionExempt.push(value);
        break;
      case 'stale-line-exempt':
        cfg.staleLineExempt.push(value);
        break;
      case 'skip-line':
        cfg.skipLine.push(value);
        break;
      case 'spec-source':
        cfg.specSource.push(value);
        break;
      case 'ratio':
        cfg.ratio.push(value);
        break;
      default:
        errors.push(`doc-check block line ${i + 1}: unknown key "${key}"`);
    }
  }
  return { cfg, errors, present: true };
}

function compileAll(patterns, label, errors) {
  const out = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p));
    } catch (e) {
      errors.push(`${label}: not a valid regex: ${p} (${e.message})`);
    }
  }
  return out;
}

/** Top-level directory names in the repo — the prefixes a doc path may start with. */
export function repoTopDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => e.name);
}

function trackedFiles(root) {
  try {
    return new Set(
      // stderr muted: pointed at a non-repo (the unit fixtures are bare temp
      // dirs) git writes "not a git repository" before the non-zero exit the
      // catch below already handles, and a gate that prints a fatal on a clean
      // run trains its reader to ignore its output.
      execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/**
 * Check 1 — every backtick-quoted path that names a repo directory or ~/.claude
 * resolves. Globs and <placeholder> templates are not paths and are skipped, as
 * are lines matching a `skip-line:` regex (a document describing an artifact it
 * is about to create references a path that does not exist yet, by design).
 */
export function checkPaths(text, opts) {
  const { root, topDirs, tracked, allowUntrackedMissing, skipLine, home } = opts;
  const problems = [];
  const prefix = topDirs.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('`((?:' + prefix + ')/[^`\\s]+|~/\\.claude/[^`\\s]*)`', 'g');
  const seen = new Set();
  const stats = { checked: 0, skippedUntracked: [], skippedHome: 0, skippedLine: 0 };
  const homeExists = home !== null && fs.existsSync(path.join(home, '.claude'));
  for (const m of text.matchAll(re)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineEndRaw = text.indexOf('\n', m.index);
    const line = text.slice(lineStart, lineEndRaw === -1 ? text.length : lineEndRaw);
    if (skipLine.some(r => r.test(line))) {
      stats.skippedLine++;
      continue;
    }
    const p = m[1].replace(/[),.;:]+$/, '');
    if (p.includes('*') || p.includes('<') || p.includes('{')) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    if (p.startsWith('~/')) {
      if (!homeExists) {
        stats.skippedHome++;
        continue;
      }
      stats.checked++;
      if (!fs.existsSync(path.join(home, p.slice(2)))) problems.push(`path missing: ${p}`);
      continue;
    }
    if (fs.existsSync(path.join(root, p))) {
      stats.checked++;
      continue;
    }
    // Absent. A TRACKED path that is absent is a broken repo, not a local-only
    // file — that case fails whatever the flag says.
    if (allowUntrackedMissing && !tracked.has(p)) {
      stats.skippedUntracked.push(p);
      continue;
    }
    stats.checked++;
    problems.push(`path missing: ${p}`);
  }
  return { problems, stats, total: seen.size };
}

/**
 * Check 2 — every §-anchor the document cites exists in one of the spec sources.
 * `§EXT`, `§iron-law-2` and `§8.V3` are all anchors here: the id is whatever
 * follows the sign, minus trailing sentence punctuation.
 */
export function checkAnchors(text, sources) {
  const problems = [];
  const ids = new Set();
  for (const m of text.matchAll(/§([A-Za-z0-9][\w.-]*)/g)) {
    const id = m[1].replace(/[.-]+$/, '');
    if (id) ids.add(id);
  }
  for (const id of ids)
    if (!sources.some(s => s.includes('§' + id))) problems.push(`§${id} not found in spec sources`);
  return { problems, total: ids.size };
}

/**
 * Check 3 — a G-number referenced in prose has a "### G<n>" heading. Runs only
 * when the document defines at least one such heading; a document with no
 * G-sections is not making the claim this checks.
 */
export function checkGRefs(text) {
  const defined = new Set([...text.matchAll(/^### (G\d+)\b/gm)].map(m => m[1]));
  if (defined.size === 0) return { problems: [], defined, refs: new Set(), skipped: true };
  const refs = new Set([...text.matchAll(/\bG(\d+)(?![a-z\d])/g)].map(m => 'G' + m[1]));
  const problems = [...refs]
    .filter(g => !defined.has(g))
    .sort()
    .map(g => `${g} referenced but no "### ${g}" heading`);
  return { problems, defined, refs, skipped: false };
}

const num = s => Number(String(s).replace(/,/g, ''));

/**
 * Check 4 — recompute every ratio the document states. Two sources: inline
 * `A/B ... P%` (the shape 3.2/3.3 use) and `ratio:` config lines for ratios
 * stated in prose ("Agent 是 Skill 的 6.4 倍"), which no regex can find.
 *
 * The stated value is compared at ITS OWN precision: "58.7%" must equal
 * toFixed(1), "22%" must equal toFixed(0). Asserting more digits than the
 * document wrote would fail a correctly-rounded number.
 */
export function checkRatios(text, ratioLines) {
  const problems = [];
  let checked = 0;
  const verify = (a, b, stated, form, where) => {
    checked++;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
      problems.push(`${where}: not a computable ratio (${a}/${b})`);
      return;
    }
    const decimals = (stated.split('.')[1] || '').length;
    const actual = form === '%' ? (a / b) * 100 : a / b;
    if (actual.toFixed(decimals) !== Number(stated).toFixed(decimals))
      problems.push(
        `${where}: ${a}/${b} = ${actual.toFixed(decimals)}${form}, document says ${stated}${form}`
      );
  };
  // Inline: A/B, then the percentage within 16 characters that contain no other
  // digit — enough for " = ", "(**" and a short unit word, not enough to reach
  // across into an unrelated number.
  for (const m of text.matchAll(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)[^0-9%\n]{0,16}?(\d+(?:\.\d+)?)\s*%/g))
    verify(num(m[1]), num(m[2]), m[3], '%', `inline "${m[0].replace(/\s+/g, ' ')}"`);
  for (const raw of ratioLines) {
    const m = raw.match(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*=\s*(\d+(?:\.\d+)?)\s*([%x×])$/);
    if (!m) {
      problems.push(`ratio config: expected "A/B = N%" or "A/B = N x", got: ${raw}`);
      continue;
    }
    verify(num(m[1]), num(m[2]), m[3], m[4] === '%' ? '%' : '×', `ratio config "${raw}"`);
  }
  return { problems, checked };
}

/**
 * Check 5 — a claim the document has retracted must not be live anywhere except
 * the sections that record the retraction, or a line that marks itself as a
 * quotation of the old version.
 *
 * This is the half that cannot be derived: only the author knows which sentence
 * was withdrawn. The document declares them; the gate keeps them withdrawn.
 */
export function checkStale(text, { stale, sectionExempt, lineExempt }) {
  const problems = [];
  if (stale.length === 0) return { problems, skipped: true, checked: 0 };
  const lines = text.split('\n');
  let section = '';
  let checked = 0;
  for (const [i, ln] of lines.entries()) {
    if (/^## /.test(ln)) section = ln;
    if (sectionExempt.some(r => r.test(section))) continue;
    checked++;
    if (lineExempt.some(r => r.test(ln))) continue;
    for (const r of stale) if (r.test(ln)) problems.push(`retracted claim live at line ${i + 1}: ${r}`);
  }
  return { problems, skipped: false, checked };
}

export function docCheck(docPath, { root = REPO_ROOT, allowUntrackedMissing = false, home = null } = {}) {
  const text = fs.readFileSync(docPath, 'utf8');
  const out = [];
  const problems = [];
  const { cfg, errors, present } = parseConfig(text);
  problems.push(...errors);

  const sourcePaths = cfg.specSource.length ? cfg.specSource : DEFAULT_SPEC_SOURCES;
  const sources = [];
  for (const rel of sourcePaths) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) sources.push(fs.readFileSync(abs, 'utf8'));
    else problems.push(`spec source missing: ${rel}`);
  }

  const skipLine = compileAll(cfg.skipLine, 'skip-line', problems);
  const stale = compileAll(cfg.stale, 'stale', problems);
  const sectionExempt = compileAll(cfg.staleSectionExempt, 'stale-section-exempt', problems);
  const lineExempt = compileAll(cfg.staleLineExempt, 'stale-line-exempt', problems);

  const p = checkPaths(text, {
    root,
    topDirs: repoTopDirs(root),
    tracked: trackedFiles(root),
    allowUntrackedMissing,
    skipLine,
    home,
  });
  problems.push(...p.problems);
  out.push(
    `paths: ${p.stats.checked} checked of ${p.total} referenced` +
      (p.stats.skippedHome ? `, ${p.stats.skippedHome} ~/.claude skipped (no ~/.claude here)` : '') +
      (p.stats.skippedLine ? `, ${p.stats.skippedLine} on skip-line lines` : '') +
      (p.stats.skippedUntracked.length
        ? `, ${p.stats.skippedUntracked.length} absent+untracked skipped (${p.stats.skippedUntracked.join(', ')})`
        : '')
  );

  const a = checkAnchors(text, sources);
  problems.push(...a.problems);
  out.push(`anchors: ${a.total} distinct §-refs resolved against ${sources.length} spec source(s)`);

  const g = checkGRefs(text);
  problems.push(...g.problems);
  out.push(
    g.skipped
      ? 'g-refs: skipped (document defines no "### G<n>" heading)'
      : `g-refs: ${[...g.refs].sort().join(' ')} · defined ${[...g.defined].sort().join(' ')}`
  );

  const r = checkRatios(text, cfg.ratio);
  problems.push(...r.problems);
  out.push(`ratios: ${r.checked} recomputed (${cfg.ratio.length} from config)`);

  const s = checkStale(text, { stale, sectionExempt, lineExempt });
  problems.push(...s.problems);
  out.push(
    s.skipped
      ? 'stale: skipped (no stale: entries in the doc-check block)'
      : `stale: ${stale.length} retracted claim(s) checked against ${s.checked} eligible line(s)`
  );

  if (!present) out.push('note: document carries no ```doc-check block — stale check inactive');
  return { problems, lines: out };
}

if (invokedAsMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const positionals = argv.filter(a => !a.startsWith('-'));
  const flags = argv.filter(a => a.startsWith('-'));
  const parsed = parseStrictOrExit(flags, { bools: ['--allow-untracked-missing'] });
  if (positionals.length !== 1) {
    console.error(
      positionals.length === 0
        ? 'Missing argument: <doc.md>. See --help.'
        : `Expected exactly one <doc.md>, got ${positionals.length}: ${positionals.join(', ')}.`
    );
    process.exit(2);
  }
  const doc = path.resolve(positionals[0]);
  if (!fs.existsSync(doc)) {
    console.error(`No such document: ${positionals[0]}`);
    process.exit(2);
  }
  const { problems, lines } = docCheck(doc, {
    allowUntrackedMissing: parsed.bools.has('--allow-untracked-missing'),
    home: process.env.HOME || null,
  });
  for (const l of lines) console.log(l);
  for (const p of problems) console.log('  ✗ ' + p);
  if (problems.length) {
    console.log(`\nFAIL: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('\nOK: all checks passed');
  process.exit(0);
}
