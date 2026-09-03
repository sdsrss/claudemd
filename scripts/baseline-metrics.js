#!/usr/bin/env node
// baseline-metrics.js — repeatable code-health baseline for this repo.
//
// One command, one report, so a number quoted in docs/audit/*.md can be
// re-measured instead of trusted (feedback_audit_tool_before_sweep: build the
// measuring tool before the sweep, then measure again after it). Everything
// here is derived from the tracked tree — `git ls-files` is the file set, and
// the per-metric scopes below say what they exclude and why.
//
// Metrics (in the order the baseline doc lists them):
//   files / lines        every tracked file, plus a per-top-level-dir breakdown
//   largest files        top N by line count (all tracked, and code-only)
//   long functions       JS via acorn (exact spans), bash via column-0 brace
//                        matching — bodies longer than --fn-threshold lines
//   duplication          jscpd over bin/ scripts/ hooks/ tests/ (js + bash)
//   cycles               static import graph (JS `import`/`import()`, bash
//                        `source`), back-edges reported as cycles
//   coverage             c8 around the node test leg (bin/ + scripts/ only —
//                        no line-coverage tool for the bash hooks; their
//                        suites are counted, not measured)
//   lint                 shellcheck warning+ / eslint / lint-argv /
//                        version-cascade-check / prettier --check
//
// Optional tooling (acorn, jscpd, c8, eslint, prettier) comes from
// devDependencies; a tree without `npm install` reports those cells as
// "n/a" rather than failing, so the script stays runnable from a marketplace
// clone. Nothing here writes into the repo: reports go to stdout, scratch to a
// mkdtemp that is removed on exit (§8.V4).
//
// Run:  node scripts/baseline-metrics.js            (markdown to stdout)
//       node scripts/baseline-metrics.js --json     (machine-readable)
//       npm run metrics
// Module: import { longFunctionsInSh, findCycles, countLines } from './scripts/baseline-metrics.js';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseStrict, parsePositiveInt, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/baseline-metrics.js [--json] [--fn-threshold=N] [--top=N]
                                        [--skip-coverage] [--skip-dup] [--skip-lint]

Measure the repo's code-health baseline: file/line counts, largest files,
functions longer than N lines, duplication rate, import cycles, node test
coverage and lint error counts. Reads the tracked tree via git ls-files;
writes nothing into the repo.

Options:
  --json              Emit JSON instead of markdown.
  --fn-threshold=N    Function-length threshold in lines (default 50).
  --top=N             Rows in the largest-files tables (default 10).
  --skip-coverage     Skip the c8 run (the slow part: the full node test leg).
  --skip-dup          Skip jscpd.
  --skip-lint         Skip shellcheck / eslint / lint-argv / version-check / prettier.
  --help, -h          Print this message and exit.

Optional tools (acorn, jscpd, c8, eslint, prettier) are devDependencies;
without \`npm install\` their cells read "n/a".

Exit codes: 0 report produced | 1 numeric-flag validation error | 2 argv-shape error.`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

const CODE_EXT = new Set(['.js', '.mjs', '.sh']);
const JS_EXT = new Set(['.js', '.mjs']);
// Fixtures are inputs to tests, not code this repo maintains; the design-detect
// fixtures in particular carry deliberately odd JS/TS/Vue that would skew every
// code metric below.
const FIXTURE_PREFIX = 'tests/fixtures/';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function localBin(name) {
  const p = path.join(REPO_ROOT, 'node_modules', '.bin', name);
  return fs.existsSync(p) ? p : null;
}

async function loadAcorn() {
  try {
    return await import('acorn');
  } catch {
    return null;
  }
}

// --- files / lines -----------------------------------------------------------

export function trackedFiles(root = REPO_ROOT) {
  const r = run('git', ['ls-files', '-z'], { cwd: root });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr.trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

// Line count as `wc -l` reports it (newline count), plus one for a final line
// with no trailing newline — the number a reader sees in an editor.
export function countLines(text) {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}

function isCodeFile(rel) {
  return CODE_EXT.has(path.extname(rel)) && !rel.startsWith(FIXTURE_PREFIX);
}

function fileInventory(root, top) {
  const files = trackedFiles(root);
  const rows = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue; // tracked but absent from the working tree
    }
    if (!st.isFile()) continue;
    const text = fs.readFileSync(abs, 'utf8');
    rows.push({ file: rel, lines: countLines(text), bytes: st.size });
  }
  const byDir = {};
  for (const r of rows) {
    const dir = r.file.includes('/') ? r.file.split('/')[0] + '/' : '(root)';
    byDir[dir] = byDir[dir] || { files: 0, lines: 0 };
    byDir[dir].files++;
    byDir[dir].lines += r.lines;
  }
  const byLines = (a, b) => b.lines - a.lines || a.file.localeCompare(b.file);
  const code = rows.filter(r => isCodeFile(r.file));
  return {
    total: { files: rows.length, lines: rows.reduce((s, r) => s + r.lines, 0) },
    code: { files: code.length, lines: code.reduce((s, r) => s + r.lines, 0) },
    byDir,
    largestAll: [...rows].sort(byLines).slice(0, top),
    largestCode: [...code].sort(byLines).slice(0, top),
    rows,
  };
}

// --- long functions -----------------------------------------------------------

const JS_FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function jsFunctionName(node, parent) {
  if (node.id && node.id.name) return node.id.name;
  if (!parent) return '<anonymous>';
  if (parent.type === 'VariableDeclarator' && parent.id && parent.id.name) return parent.id.name;
  if (parent.type === 'Property' && parent.key) return parent.key.name || String(parent.key.value);
  if (parent.type === 'MethodDefinition' && parent.key) return parent.key.name || String(parent.key.value);
  if (parent.type === 'AssignmentExpression' && parent.left && parent.left.type === 'Identifier')
    return parent.left.name;
  return '<anonymous>';
}

// Every function node whose span exceeds `threshold` lines. Generic walk over
// the ESTree object graph — no walker dependency, and any node kind acorn adds
// later is still visited.
function longFunctionsInJs(acorn, source, threshold, file = '<js>') {
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowHashBang: true,
  });
  const out = [];
  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (JS_FN_TYPES.has(node.type)) {
      const lines = node.loc.end.line - node.loc.start.line + 1;
      if (lines > threshold)
        out.push({ file, name: jsFunctionName(node, parent), line: node.loc.start.line, lines });
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type') continue;
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) walk(c, node);
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, node);
    }
  };
  walk(ast, null);
  return out;
}

// Bash: a function opens at column 0 as `name() {` or `function name {` and
// closes at the first following column-0 `}`. That is how every function in
// this repo is written (shellcheck-clean, 2-space bodies); a one-line
// `name() { …; }` has no separate closing line and is counted as 1 line.
const SH_FN_OPEN =
  /^(?:function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?|([A-Za-z_][A-Za-z0-9_]*)\s*\(\))\s*\{/;
export function longFunctionsInSh(source, threshold, file = '<sh>') {
  const lines = source.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SH_FN_OPEN.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];
    if (/\}\s*$/.test(lines[i])) continue; // one-liner
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}\s*$/.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (end < 0) continue; // unterminated at column 0 — not a shape we can measure
    const span = end - i + 1;
    if (span > threshold) out.push({ file, name, line: i + 1, lines: span });
    i = end;
  }
  return out;
}

async function longFunctions(root, rows, threshold) {
  const acorn = await loadAcorn();
  const js = [];
  const sh = [];
  const parseErrors = [];
  let jsFiles = 0;
  let shFiles = 0;
  for (const r of rows) {
    if (!isCodeFile(r.file)) continue;
    const abs = path.join(root, r.file);
    const src = fs.readFileSync(abs, 'utf8');
    const ext = path.extname(r.file);
    if (JS_EXT.has(ext)) {
      if (!acorn) continue;
      jsFiles++;
      try {
        js.push(...longFunctionsInJs(acorn, src, threshold, r.file));
      } catch (e) {
        parseErrors.push({ file: r.file, error: e.message });
      }
    } else if (ext === '.sh') {
      shFiles++;
      sh.push(...longFunctionsInSh(src, threshold, r.file));
    }
  }
  const byLen = (a, b) => b.lines - a.lines || a.file.localeCompare(b.file) || a.line - b.line;
  js.sort(byLen);
  sh.sort(byLen);
  return {
    threshold,
    acorn: !!acorn,
    js: { files: jsFiles, count: acorn ? js.length : null, items: js },
    sh: { files: shFiles, count: sh.length, items: sh },
    parseErrors,
  };
}

// --- cycles -------------------------------------------------------------------

// edges: Map<node, Set<node>>. Returns each back-edge's cycle as an array of
// nodes (closing node repeated at the end). Distinct back-edges, not distinct
// elementary circuits — enough to answer "how many" for a graph expected to
// hold zero, and every reported cycle is a real one.
export function findCycles(edges) {
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = [];
  const nodes = [...edges.keys()].sort();
  const visit = n => {
    color.set(n, GREY);
    stack.push(n);
    for (const m of [...(edges.get(n) || [])].sort()) {
      const c = color.get(m) || WHITE;
      if (c === GREY) {
        cycles.push([...stack.slice(stack.indexOf(m)), m]);
      } else if (c === WHITE) {
        visit(m);
      }
    }
    stack.pop();
    color.set(n, BLACK);
  };
  for (const n of nodes) if ((color.get(n) || WHITE) === WHITE) visit(n);
  return cycles;
}

function jsImportSpecifiers(acorn, source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const specs = [];
  const walk = node => {
    if (!node || typeof node.type !== 'string') return;
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ExportAllDeclaration' ||
        node.type === 'ExportNamedDeclaration') &&
      node.source
    ) {
      specs.push(node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') {
      specs.push(node.source.value);
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast);
  return specs.filter(s => typeof s === 'string' && s.startsWith('.'));
}

const SH_SOURCE_RE = /^\s*(?:source|\.)\s+"?[^"\s]*\/([A-Za-z0-9._-]+\.sh)"?/;

async function importGraph(root, rows) {
  const acorn = await loadAcorn();
  const edges = new Map();
  const add = (a, b) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a).add(b);
  };
  const jsRows = rows.filter(
    r => isCodeFile(r.file) && JS_EXT.has(path.extname(r.file)) && !r.file.startsWith('tests/')
  );
  const shRows = rows.filter(
    r => isCodeFile(r.file) && path.extname(r.file) === '.sh' && !r.file.startsWith('tests/')
  );
  const shByBase = new Map(shRows.map(r => [path.basename(r.file), r.file]));
  if (acorn) {
    for (const r of jsRows) {
      const src = fs.readFileSync(path.join(root, r.file), 'utf8');
      edges.set(r.file, edges.get(r.file) || new Set());
      let specs;
      try {
        specs = jsImportSpecifiers(acorn, src);
      } catch {
        continue;
      }
      for (const s of specs) {
        const target = path
          .relative(root, path.resolve(root, path.dirname(r.file), s))
          .split(path.sep)
          .join('/');
        add(r.file, target);
      }
    }
  }
  for (const r of shRows) {
    const src = fs.readFileSync(path.join(root, r.file), 'utf8');
    edges.set(r.file, edges.get(r.file) || new Set());
    for (const line of src.split('\n')) {
      const m = SH_SOURCE_RE.exec(line);
      if (!m) continue;
      const target = shByBase.get(m[1]);
      if (target && target !== r.file) add(r.file, target);
    }
  }
  return { acorn: !!acorn, edges, jsFiles: jsRows.length, shFiles: shRows.length };
}

async function cycles(root, rows) {
  const g = await importGraph(root, rows);
  const found = findCycles(g.edges);
  return {
    acorn: g.acorn,
    nodes: g.edges.size,
    edges: [...g.edges.values()].reduce((s, set) => s + set.size, 0),
    jsFiles: g.jsFiles,
    shFiles: g.shFiles,
    count: found.length,
    cycles: found,
  };
}

// --- duplication (jscpd) --------------------------------------------------------

function duplication(scratch) {
  const bin = localBin('jscpd');
  if (!bin) return { available: false };
  const out = path.join(scratch, 'jscpd');
  fs.mkdirSync(out, { recursive: true });
  const r = run(bin, [
    '--silent',
    // Without --absolute jscpd names files relative to the scan ARGUMENT, so
    // tests/hooks/x.test.sh and hooks/x.sh both print as "hooks/x…" — two
    // trees, one label. Absolute in, repo-relative out (summarizeJscpdReport).
    '--absolute',
    '--reporters',
    'json',
    '--output',
    out,
    '--format',
    'javascript,bash',
    '--ignore',
    '**/tests/fixtures/**,**/node_modules/**',
    '--min-lines',
    '5',
    '--min-tokens',
    '50',
    'bin',
    'scripts',
    'hooks',
    'tests',
  ]);
  const reportPath = path.join(out, 'jscpd-report.json');
  if (!fs.existsSync(reportPath)) {
    return { available: true, error: (r.stderr || r.stdout || 'no report written').trim().slice(0, 500) };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return {
    available: true,
    scope:
      'bin/ scripts/ hooks/ tests/ (javascript + bash; tests/fixtures excluded); min 5 lines / 50 tokens',
    ...summarizeJscpdReport(report, REPO_ROOT),
  };
}

// jscpd 5 JSON report → {total, formats, clones}. `statistics.total` and each
// `statistics.formats.<fmt>` carry the SAME flat shape (sources / lines /
// duplicatedLines / percentage / clones) — the first draft read `.total` under
// each format and printed "undefined" for every per-language cell.
export function summarizeJscpdReport(report, root = REPO_ROOT) {
  const stats = (report && report.statistics) || {};
  const pick = t => ({
    files: t.sources ?? null,
    lines: t.lines ?? null,
    duplicatedLines: t.duplicatedLines ?? null,
    percentage: typeof t.percentage === 'number' ? t.percentage : null,
    clones: t.clones ?? null,
  });
  const formats = {};
  for (const [fmt, v] of Object.entries(stats.formats || {})) formats[fmt] = pick(v || {});
  const rel = p => path.relative(root, p).split(path.sep).join('/');
  const clones = (report.duplicates || []).map(d => ({
    lines: d.lines,
    a: `${rel(d.firstFile.name)}:${d.firstFile.start}`,
    b: `${rel(d.secondFile.name)}:${d.secondFile.start}`,
  }));
  return { total: pick(stats.total || {}), formats, clones };
}

// --- coverage (c8) ----------------------------------------------------------------

function coverage(scratch) {
  const bin = localBin('c8');
  if (!bin) return { available: false };
  const reports = path.join(scratch, 'c8');
  const nodeTmp = fs.mkdtempSync(path.join(scratch, 'node-tmp-'));
  // Same shape as the node leg in tests/run-all.sh: env hygiene first, an
  // isolated TMPDIR, the per-test timeout. c8 exports NODE_V8_COVERAGE to the
  // child, and the scripts the suites spawn inherit it — except where a suite
  // deliberately clears the environment, which is why the number below is a
  // floor, not the truth.
  const inner =
    'source tests/lib/env-hygiene.sh && claudemd_reset_test_env && ' +
    'exec node --test --test-timeout=180000 tests/scripts/*.test.js';
  const r = run(
    bin,
    [
      '--reporter=json-summary',
      '--reporter=text-summary',
      `--reports-dir=${reports}`,
      '--all',
      '--src=bin',
      '--src=scripts',
      '--include=bin/**/*.js',
      '--include=scripts/**/*.js',
      '--',
      'bash',
      '-c',
      inner,
    ],
    { env: { ...process.env, TMPDIR: nodeTmp } }
  );
  const summaryPath = path.join(reports, 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return {
      available: true,
      error: (r.stderr || r.stdout || 'no summary written').trim().slice(-1500),
      testStatus: r.status,
    };
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const total = summary.total;
  const files = Object.entries(summary)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => ({
      file: path.relative(REPO_ROOT, k).split(path.sep).join('/'),
      lines: v.lines.pct,
      branches: v.branches.pct,
      functions: v.functions.pct,
    }))
    .sort((a, b) => a.lines - b.lines || a.file.localeCompare(b.file));
  return {
    available: true,
    scope: 'bin/ + scripts/ (.js) under the node test leg; bash hooks are not line-measured',
    testStatus: r.status,
    total: {
      lines: total.lines.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
      statements: total.statements.pct,
      linesCovered: total.lines.covered,
      linesTotal: total.lines.total,
    },
    lowest: files.slice(0, 10),
    files,
  };
}

// --- lint -----------------------------------------------------------------------

function shellcheckCounts() {
  const scope = run('bash', ['tests/lib/shell-files.sh']);
  const files = scope.stdout.split('\n').filter(Boolean);
  if (scope.status !== 0 || files.length === 0)
    return { available: false, reason: scope.stderr.trim() || 'shell-files.sh returned nothing' };
  const probe = run('shellcheck', ['--version']);
  if (probe.error || probe.status !== 0) return { available: false, reason: 'shellcheck not installed' };
  const r = run('shellcheck', ['-f', 'json', ...files]);
  let findings;
  try {
    findings = JSON.parse(r.stdout || '[]');
  } catch {
    return { available: true, files: files.length, error: (r.stderr || r.stdout).trim().slice(0, 500) };
  }
  return { available: true, files: files.length, ...summarizeShellcheckFindings(findings) };
}

// shellcheck -f json → counts per level; `blocking` is what CI and
// `npm run lint:sh` fail on (--severity=warning = error + warning).
export function summarizeShellcheckFindings(findings) {
  const byLevel = { error: 0, warning: 0, info: 0, style: 0 };
  for (const f of findings || []) byLevel[f.level] = (byLevel[f.level] || 0) + 1;
  return { blocking: byLevel.error + byLevel.warning, byLevel };
}

// The eslint/prettier scope is whatever `npm run lint:js` passes, read from
// package.json instead of repeated here. These numbers are only comparable to
// the CI gate's if both judge the same tree, and the 2026-09-02 audit (R11-20)
// found the list written out five times: three scripts in package.json plus the
// two call sites below. package.json stays the source by construction — npm can
// only read a literal — and the three copies inside it are joined by
// tests/scripts/shared-scope-consumers.test.js.
export function jsLintScope(pkgPath = path.join(REPO_ROOT, 'package.json')) {
  const script = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts?.['lint:js'] || '';
  const scope = script
    .split(/\s+/)
    .slice(1)
    .filter(a => a && !a.startsWith('-'));
  if (!scope.length) throw new Error(`package.json lint:js has no path arguments: "${script}"`);
  return scope;
}

function eslintCounts() {
  const bin = localBin('eslint');
  if (!bin) return { available: false };
  const r = run(bin, ['-f', 'json', ...jsLintScope()]);
  let results;
  try {
    results = JSON.parse(r.stdout);
  } catch {
    return { available: true, error: (r.stderr || r.stdout).trim().slice(0, 800) };
  }
  return { available: true, ...summarizeEslintResults(results) };
}

// eslint -f json → totals + the rule histogram. A parse failure is a message
// with no ruleId and counts under fatal as well as errors (that is how eslint
// reports it), so `(fatal)` is its histogram bucket.
export function summarizeEslintResults(results, topN = 10) {
  let errors = 0,
    warnings = 0,
    fatal = 0;
  const byRule = {};
  const byFile = [];
  for (const f of results || []) {
    errors += f.errorCount || 0;
    warnings += f.warningCount || 0;
    fatal += f.fatalErrorCount || 0;
    if ((f.errorCount || 0) + (f.warningCount || 0) > 0)
      byFile.push({ file: f.filePath, errors: f.errorCount || 0, warnings: f.warningCount || 0 });
    for (const m of f.messages || []) {
      const k = m.ruleId || '(fatal)';
      byRule[k] = (byRule[k] || 0) + 1;
    }
  }
  const topRules = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([rule, n]) => ({ rule, n }));
  return {
    files: (results || []).length,
    filesWithFindings: byFile.length,
    errors,
    warnings,
    fatal,
    topRules,
  };
}

function prettierCounts() {
  const bin = localBin('prettier');
  if (!bin) return { available: false };
  // --list-different prints one path per unformatted file and nothing else;
  // exit 1 when the list is non-empty, so status is not an error signal here.
  const r = run(bin, ['--list-different', ...jsLintScope()]);
  if (r.error) return { available: true, error: String(r.error) };
  const files = r.stdout.split('\n').filter(Boolean);
  return { available: true, unformatted: files.length, files };
}

// stdERR, and the count line — not stdout with a `file:line:` shape.
// lint-argv.js writes findings to stderr as `  file:line  [pattern]` (two
// spaces, no second colon) after a `argv-lint: N antipattern hit(s):` header.
// This read `stdout` with /^\S+:\d+:/, so it matched nothing and `hits` was
// permanently null exactly when the gate was red — the one number this row
// exists to report was the one it could never produce (2026-09-02 audit R11-29).
//
// Reading the header COUNT rather than counting matched lines also survives a
// change to the per-hit format, which is the thing that broke it.
//
// Exported so the parse can be asserted against real gate output instead of
// inferred from this comment.
export function parseArgvLintHits({ status, stderr }) {
  if (status === 0) return 0;
  const m = String(stderr ?? '').match(/^argv-lint: (\d+) antipattern/m);
  if (!m) return null;
  return Number(m[1]);
}

function lint() {
  const argv = run(process.execPath, ['scripts/lint-argv.js']);
  const cascade = run(process.execPath, ['scripts/version-cascade-check.js']);
  return {
    shellcheck: shellcheckCounts(),
    eslint: eslintCounts(),
    lintArgv: {
      status: argv.status,
      hits: parseArgvLintHits(argv),
    },
    versionCascade: { status: cascade.status },
    prettier: prettierCounts(),
  };
}

// --- report ------------------------------------------------------------------------

const na = 'n/a';
const pct = v => (typeof v === 'number' ? `${v.toFixed(2)}%` : na);

const table = (L, header, align, rows) => {
  L.push(`| ${header.join(' | ')} |`);
  L.push(`|${align.join('|')}|`);
  for (const r of rows) L.push(`| ${r.join(' | ')} |`);
  L.push('');
};

function mdFiles(L, m) {
  L.push('## Files and lines', '');
  table(
    L,
    ['Scope', 'Files', 'Lines'],
    ['---', '---:', '---:'],
    [
      ['all tracked', m.files.total.files, m.files.total.lines],
      ['code (.js/.mjs/.sh, fixtures excluded)', m.files.code.files, m.files.code.lines],
      ...Object.entries(m.files.byDir)
        .sort((a, b) => b[1].lines - a[1].lines)
        .map(([dir, v]) => [dir, v.files, v.lines]),
    ]
  );
  const ranked = rows => rows.map((r, i) => [i + 1, r.file, r.lines]);
  L.push(`## Largest ${m.meta.top} files (all tracked)`, '');
  table(L, ['#', 'File', 'Lines'], ['---:', '---', '---:'], ranked(m.files.largestAll));
  L.push(`## Largest ${m.meta.top} code files`, '');
  table(L, ['#', 'File', 'Lines'], ['---:', '---', '---:'], ranked(m.files.largestCode));
}

function mdFunctions(L, m) {
  const f = m.longFunctions;
  L.push(`## Functions longer than ${f.threshold} lines`, '');
  table(
    L,
    ['Language', 'Files scanned', 'Functions > threshold'],
    ['---', '---:', '---:'],
    [
      [`JS (acorn${f.acorn ? '' : ' — not installed'})`, f.js.files, f.js.count ?? na],
      ['bash (column-0 braces)', f.sh.files, f.sh.count],
    ]
  );
  const longest = [...f.js.items, ...f.sh.items].sort((a, b) => b.lines - a.lines).slice(0, 15);
  if (longest.length) {
    L.push('Longest 15:', '');
    table(
      L,
      ['Lines', 'Function', 'Location'],
      ['---:', '---', '---'],
      longest.map(x => [x.lines, `\`${x.name}\``, `${x.file}:${x.line}`])
    );
  }
  if (f.parseErrors.length) {
    L.push(`Parse errors (${f.parseErrors.length}): ` + f.parseErrors.map(p => p.file).join(', '), '');
  }
}

function mdDuplication(L, m) {
  const d = m.duplication;
  L.push('## Duplication (jscpd)', '');
  if (!d.available) return L.push(`${na} — jscpd not installed (\`npm install\`).`, '');
  if (d.error) return L.push(`error: ${d.error}`, '');
  L.push(`Scope: ${d.scope}`, '');
  const row = (name, t) => [name, t.lines, t.duplicatedLines, pct(t.percentage), t.clones];
  table(
    L,
    ['Format', 'Lines', 'Duplicated lines', 'Rate', 'Clones'],
    ['---', '---:', '---:', '---:', '---:'],
    [row('total', d.total), ...Object.entries(d.formats).map(([fmt, v]) => row(fmt, v))]
  );
  if (d.clones.length) {
    L.push('Clone pairs:', '');
    for (const c of d.clones) L.push(`- ${c.lines} lines: ${c.a} ↔ ${c.b}`);
    L.push('');
  }
}

function mdCycles(L, m) {
  const c = m.cycles;
  L.push('## Import cycles', '');
  L.push(
    `Graph: ${c.nodes} nodes / ${c.edges} edges (JS: ${c.jsFiles} files under bin/ + scripts/${c.acorn ? '' : ' — acorn not installed, JS edges missing'}; bash: ${c.shFiles} files under hooks/ + scripts/).`,
    ''
  );
  L.push(`Cycles: **${c.count}**`);
  for (const cyc of c.cycles) L.push(`- ${cyc.join(' → ')}`);
  L.push('');
}

function mdCoverage(L, m) {
  const c = m.coverage;
  L.push('## Test coverage (c8, node leg)', '');
  if (!c) return L.push('skipped (--skip-coverage).', '');
  if (!c.available) return L.push(`${na} — c8 not installed (\`npm install\`).`, '');
  if (c.error) return L.push(`error (test exit ${c.testStatus}):\n\n\`\`\`\n${c.error}\n\`\`\``, '');
  const t = c.total;
  L.push(`Scope: ${c.scope}. Test leg exit status: ${c.testStatus}.`, '');
  table(
    L,
    ['Lines', 'Branches', 'Functions', 'Statements'],
    ['---:', '---:', '---:', '---:'],
    [
      [
        `${pct(t.lines)} (${t.linesCovered}/${t.linesTotal})`,
        pct(t.branches),
        pct(t.functions),
        pct(t.statements),
      ],
    ]
  );
  L.push('Lowest 10 files by line coverage:', '');
  table(
    L,
    ['File', 'Lines', 'Branches', 'Functions'],
    ['---', '---:', '---:', '---:'],
    c.lowest.map(f => [f.file, pct(f.lines), pct(f.branches), pct(f.functions)])
  );
}

function mdLint(L, m) {
  L.push('## Lint', '');
  if (!m.lint) return L.push('skipped (--skip-lint).', '');
  const { shellcheck: s, eslint: e, prettier: p, lintArgv, versionCascade } = m.lint;
  const shellcheckCell = !s.available
    ? `${na} — ${s.reason}`
    : s.error
      ? `error: ${s.error}`
      : `**${s.blocking}** (error ${s.byLevel.error}, warning ${s.byLevel.warning}; info ${s.byLevel.info}, style ${s.byLevel.style} advisory)`;
  const eslintCell = !e.available
    ? `${na} — not installed`
    : e.error
      ? `error: ${e.error}`
      : `**${e.errors}** errors, ${e.warnings} warnings${e.fatal ? `, ${e.fatal} fatal` : ''} in ${e.filesWithFindings} files`;
  table(
    L,
    ['Check', 'Scope', 'Result'],
    ['---', '---', '---'],
    [
      ['shellcheck (error+warning)', s.available ? `${s.files} tracked .sh` : na, shellcheckCell],
      ['eslint', e.available ? `${e.files} files (bin/ scripts/ tests/)` : na, eslintCell],
      [
        'lint-argv',
        'bin/ + scripts/',
        `exit ${lintArgv.status}${lintArgv.hits ? ` (${lintArgv.hits} hits)` : ''}`,
      ],
      ['version-cascade-check', 'spec/ + package.json + plugin.json', `exit ${versionCascade.status}`],
      [
        'prettier --check',
        p.available ? 'bin/ scripts/ tests/' : na,
        p.available ? `**${p.unformatted}** files not formatted` : `${na} — not installed`,
      ],
    ]
  );
  if (e.available && e.topRules && e.topRules.length) {
    L.push('Top eslint rules:', '');
    for (const r of e.topRules) L.push(`- ${r.rule}: ${r.n}`);
    L.push('');
  }
}

export function markdown(m) {
  const L = [`# Baseline metrics — ${m.meta.version} @ ${m.meta.commit} (${m.meta.date})`, ''];
  L.push(`Command: \`${m.meta.command}\``, '');
  for (const section of [mdFiles, mdFunctions, mdDuplication, mdCycles, mdCoverage, mdLint]) section(L, m);
  return L.join('\n');
}

export async function measure(opts = {}) {
  const top = opts.top ?? 10;
  const threshold = opts.fnThreshold ?? 50;
  const root = REPO_ROOT;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-metrics-'));
  try {
    const files = fileInventory(root, top);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const head = run('git', ['rev-parse', '--short', 'HEAD']);
    const m = {
      meta: {
        version: pkg.version,
        commit: head.status === 0 ? head.stdout.trim() : 'unknown',
        date: new Date().toISOString().slice(0, 10),
        top,
        command: `node scripts/baseline-metrics.js${opts.json ? ' --json' : ''}${threshold !== 50 ? ` --fn-threshold=${threshold}` : ''}${opts.skipCoverage ? ' --skip-coverage' : ''}${opts.skipDup ? ' --skip-dup' : ''}${opts.skipLint ? ' --skip-lint' : ''}`,
      },
      files: {
        total: files.total,
        code: files.code,
        byDir: files.byDir,
        largestAll: files.largestAll,
        largestCode: files.largestCode,
      },
      longFunctions: await longFunctions(root, files.rows, threshold),
      cycles: await cycles(root, files.rows),
      duplication: opts.skipDup ? { available: false, skipped: true } : duplication(scratch),
      coverage: opts.skipCoverage ? null : coverage(scratch),
      lint: opts.skipLint ? null : lint(),
    };
    return m;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  let parsed;
  try {
    parsed = parseStrict(argv, {
      bools: ['--json', '--skip-coverage', '--skip-dup', '--skip-lint'],
      values: ['--fn-threshold', '--top'],
    });
  } catch (e) {
    if (e instanceof ArgvError) {
      console.error(`${e.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw e;
  }
  const num = (flag, dflt) => {
    if (!(flag in parsed.values)) return dflt;
    const n = parsePositiveInt(parsed.values[flag]);
    if (n === null) {
      console.error(`${flag} must be a positive integer (got '${parsed.values[flag]}').`);
      process.exit(1);
    }
    return n;
  };
  const opts = {
    json: parsed.bools.has('--json'),
    skipCoverage: parsed.bools.has('--skip-coverage'),
    skipDup: parsed.bools.has('--skip-dup'),
    skipLint: parsed.bools.has('--skip-lint'),
    fnThreshold: num('--fn-threshold', 50),
    top: num('--top', 10),
  };
  const m = await measure(opts);
  process.stdout.write(opts.json ? JSON.stringify(m, null, 2) + '\n' : markdown(m) + '\n');
}
