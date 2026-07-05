#!/usr/bin/env node
// design-detect.js — deterministic, STATELESS design-token detector for the
// /claudemd-design-adopt command (v0.24.0). Zero-LLM, zero-cache, zero state
// files: reads the filesystem, prints a verdict, exits. Command-invoked only —
// there is no SessionStart integration (an earlier auto-hint design was cut
// after review; the command's diff+consent gate is the safety net instead).
//
// Verdicts:
//   no-ui        no package.json, or no UI framework / component lib / atomic-css
//   ui-no-tokens UI signal present but no token source found
//   adoptable    token sources found, no DESIGN.md
//   unwired      DESIGN.md exists but project CLAUDE.md never references it
//   configured   DESIGN.md exists and CLAUDE.md references it (or carries the sentinel)
//   error        internal failure (fail-open; exit 0, verdict:"error")

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

// Direct frameworks first (own the display label when both present), then
// meta-frameworks whose base framework is only a transitive dep.
const FRAMEWORK_PRIORITY = [
  'vue', 'react', 'svelte', '@angular/core', 'solid-js', 'preact',
  'nuxt', 'astro', '@remix-run/react', 'gatsby', '@sveltejs/kit', 'solid-start',
];
const UI_LIBS = [
  'element-plus', 'element-ui', 'ant-design-vue', 'antd', '@mui/material',
  'vant', 'naive-ui', '@arco-design/web-react', '@arco-design/web-vue',
  '@douyinfe/semi-ui', 'primevue', 'vuetify', '@chakra-ui/react', '@mantine/core',
];
// Atomic-CSS engines are a UI signal on their own; bare preprocessors are not.
const ATOMIC_CSS = ['tailwindcss', 'unocss', '@pandacss/dev'];
const PREPROC = ['sass', 'node-sass', 'less', 'stylus', 'styled-components', '@emotion/react', '@emotion/styled'];

const CONFIG_BASENAME = /^(tailwind|uno|panda)\.config\.(js|cjs|mjs|ts)$/;
const TOKEN_BASENAME = /^_?(variables|tokens|design-tokens|theme)\.(scss|less|styl)$/;
const CSS_EXT = /\.(css|scss)$/;
// Basenames that plausibly hold a :root/@theme token block — read these first
// so the MAX_CSS_READS cap never slices off the real token file.
const CSS_TOKEN_HINT = /(token|theme|variable|vars|global|root|design|palette|color|colours?|style|main|index|app)/i;
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.output', '.next', '.nuxt', '.git',
  '.svelte-kit', 'coverage', 'target', 'vendor', 'tmp', '.cache', '.turbo',
  '__pycache__', '.venv', 'venv', 'public',
]);
// Workspace-less fullstack split: strong SPA-root subdir names only. Generic
// names (app / ui / site) are dropped — they false-positive on an incidental
// marketing/docs subsite inside a non-UI product repo.
const FULLSTACK_SUBDIRS = ['frontend', 'web', 'client'];
const MAX_DEPTH = 4;
const MAX_DIRS = 400;
const MAX_CSS_READS = 60;
const MAX_READ_BYTES = 64 * 1024;
const MAX_FULL_BYTES = 1024 * 1024; // wiring-check read cap
const MIN_CUSTOM_PROPS = 8;
const DARK_RE = /(html\.dark|prefers-color-scheme|darkMode)/;

// isFile-guard every read: statSync does not block on a FIFO/socket, but
// openSync/readFileSync would hang forever waiting for a writer.
function isRegularFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readJson(p) {
  try {
    if (!isRegularFile(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function readCapped(p, cap) {
  try {
    if (!isRegularFile(p)) return '';
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(cap);
      const n = fs.readSync(fd, buf, 0, cap, 0);
      return buf.toString('utf8', 0, n);
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

const readHead = (p) => readCapped(p, MAX_READ_BYTES);
const readFull = (p) => readCapped(p, MAX_FULL_BYTES);

function mergedDeps(pkg) {
  return { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) };
}

function uiSignal(deps) {
  const names = Object.keys(deps);
  const framework = FRAMEWORK_PRIORITY.find(f => names.includes(f)) || null;
  const uiLibs = UI_LIBS.filter(l => names.includes(l));
  const atomic = ATOMIC_CSS.filter(l => names.includes(l));
  const preproc = PREPROC.filter(l => names.includes(l));
  return { framework, uiLibs, cssTools: [...atomic, ...preproc], signal: Boolean(framework || uiLibs.length || atomic.length) };
}

// Root package.json lacks a UI signal → find the UI app in a subproject:
//   1. declared workspaces → packages/*/package.json + apps/*/package.json
//   2. workspace-less fullstack split → a strong SPA-root subdir (frontend/…)
function subprojectFallback(cwd, rootPkg) {
  const hasWs = Boolean(rootPkg?.workspaces)
    || fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))
    || fs.existsSync(path.join(cwd, 'lerna.json'));
  if (hasWs) {
    for (const parent of ['packages', 'apps']) {
      const dir = path.join(cwd, parent);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      // Filter to directories BEFORE capping so files don't consume the budget.
      for (const e of entries.filter(x => x.isDirectory()).slice(0, 50)) {
        const pkg = readJson(path.join(dir, e.name, 'package.json'));
        if (!pkg) continue;
        const sig = uiSignal(mergedDeps(pkg));
        if (sig.signal) return { rel: path.join(parent, e.name), sig };
      }
    }
  }
  for (const name of FULLSTACK_SUBDIRS) {
    const pkg = readJson(path.join(cwd, name, 'package.json'));
    if (!pkg) continue;
    const sig = uiSignal(mergedDeps(pkg));
    if (sig.signal) return { rel: name, sig };
  }
  return null;
}

// Walk from a single startAbs (depth 0 there), paths reported relative to
// baseCwd. When the UI app lives in a subproject we anchor the walk at THAT
// subproject — never the repo root — so (a) a monorepo's non-UI sibling
// packages can't donate their token files to the UI package, and (b) tokens at
// packages/<pkg>/src/assets/styles/ (deep from the root) are still reachable.
function walkTokenSources(baseCwd, startAbs) {
  const tokenSources = [];
  const cssCandidates = [];
  const configFiles = [];
  let dirCount = 0;
  const queue = [{ abs: startAbs, depth: 0 }];
  while (queue.length) {
    const { abs, depth } = queue.shift();
    if (dirCount++ > MAX_DIRS) break;
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const rel = path.relative(baseCwd, path.join(abs, e.name));
      if (e.isDirectory()) {
        // Skip hidden dirs (config/cache; a symlink dir reports isDirectory()
        // false so symlink loops can't be followed) plus the explicit list.
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        if (depth + 1 <= MAX_DEPTH) queue.push({ abs: path.join(abs, e.name), depth: depth + 1 });
        continue;
      }
      if (CONFIG_BASENAME.test(e.name)) { configFiles.push(rel); continue; }
      if (TOKEN_BASENAME.test(e.name)) { tokenSources.push({ path: rel, kind: 'preprocessor-variables' }); continue; }
      if (CSS_EXT.test(e.name)) cssCandidates.push(rel);
    }
  }
  return { tokenSources, cssCandidates, configFiles };
}

// Count custom properties declared inside :root / @theme blocks. Robust to:
//   - /* comments */ AND an unterminated /* … EOF (would otherwise count a
//     commented-out :root as live tokens),
//   - #{…} / @{…} SCSS/Less interpolation nested to any depth (stripped to a
//     fixed point so its braces can't truncate the block scan),
//   - nested rules inside :root (brace-depth walk; only depth-1 props counted),
//   - a huge block whose closing brace falls past the 64KB head (walk to EOF).
// Custom-property names may legally start with a digit or underscore (--2xl).
function tokenBlockPropCount(css) {
  let s = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');   // comments incl. unterminated
  let prev;
  do { prev = s; s = s.replace(/[#@]\{[^{}]*\}/g, 'IX'); } while (s !== prev); // interpolation
  let count = 0;
  const re = /(?::root|@theme)\b[^{]*\{/g;
  while (re.exec(s) !== null) {   // global flag advances re.lastIndex to just past the `{`
    let depth = 1, i = re.lastIndex;
    const start = i;
    while (i < s.length && depth > 0) {
      const ch = s[i++];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    const body = s.slice(start, depth === 0 ? i - 1 : i);
    const flat = body.replace(/\{[^{}]*\}/g, '');       // drop nested-selector sub-blocks
    count += (flat.match(/--[\w-]+\s*:/g) || []).length;
    re.lastIndex = i;
  }
  return count;
}

export function detect(cwd) {
  const t0 = Date.now();
  const result = {
    verdict: 'no-ui', framework: null, uiLibs: [], cssTools: [],
    tokenSources: [], darkModeSignals: [], designMd: null, claudeMdRef: false,
    monorepoPkg: null, elapsedMs: 0,
  };

  const pkg = readJson(path.join(cwd, 'package.json'));
  if (!pkg) { result.elapsedMs = Date.now() - t0; return result; }

  let sig = uiSignal(mergedDeps(pkg));
  if (!sig.signal) {
    const sub = subprojectFallback(cwd, pkg);
    if (sub) { sig = sub.sig; result.monorepoPkg = sub.rel; }
  }
  result.framework = sig.framework;
  result.uiLibs = sig.uiLibs;
  result.cssTools = sig.cssTools;

  if (sig.signal) {
    const startAbs = result.monorepoPkg ? path.join(cwd, result.monorepoPkg) : cwd;
    const { tokenSources, cssCandidates, configFiles } = walkTokenSources(cwd, startAbs);
    const dark = new Set();

    for (const rel of configFiles) {
      const head = readHead(path.join(cwd, rel));
      if (DARK_RE.test(head)) dark.add(rel);
      tokenSources.push({ path: rel, kind: 'atomic-css-config' });
    }

    // Read likely-token-named files first, then shallow-before-deep, so the
    // MAX_CSS_READS cap never drops the real token file.
    cssCandidates.sort((a, b) => {
      const pa = CSS_TOKEN_HINT.test(path.basename(a)) ? 0 : 1;
      const pb = CSS_TOKEN_HINT.test(path.basename(b)) ? 0 : 1;
      return pa - pb
        || a.split(path.sep).length - b.split(path.sep).length
        || a.localeCompare(b);
    });
    for (const rel of cssCandidates.slice(0, MAX_CSS_READS)) {
      const head = readHead(path.join(cwd, rel));
      if (DARK_RE.test(head)) dark.add(rel);
      if (tokenBlockPropCount(head) >= MIN_CUSTOM_PROPS) tokenSources.push({ path: rel, kind: 'css-custom-props' });
    }

    // Dedupe by path, then sort so the token SET has a stable enumeration.
    const seen = new Set();
    result.tokenSources = tokenSources
      .filter(t => !seen.has(t.path) && seen.add(t.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    result.darkModeSignals = [...dark].sort();
  }

  const designCandidates = [path.join(cwd, 'DESIGN.md')];
  if (result.monorepoPkg) designCandidates.push(path.join(cwd, result.monorepoPkg, 'DESIGN.md'));
  const designAbs = designCandidates.find(p => fs.existsSync(p)) || null;
  result.designMd = designAbs ? path.relative(cwd, designAbs) : null;

  // Wiring signal: a full-file read of the root (and, for a monorepo, the
  // subproject) CLAUDE.md that references DESIGN.md or carries the adopt
  // sentinel. A bare token-basename mention is NOT accepted — common names
  // like `app.css` appear incidentally and would falsely read as configured.
  const claudeMdPaths = [path.join(cwd, 'CLAUDE.md')];
  if (result.monorepoPkg) claudeMdPaths.push(path.join(cwd, result.monorepoPkg, 'CLAUDE.md'));
  for (const p of claudeMdPaths) {
    const c = readFull(p);
    if (c && (c.includes('DESIGN.md') || c.includes('claudemd-design:begin'))) { result.claudeMdRef = true; break; }
  }

  if (!sig.signal) result.verdict = 'no-ui';
  else if (result.tokenSources.length === 0 && !result.designMd) result.verdict = 'ui-no-tokens';
  else if (!result.designMd) result.verdict = 'adoptable';
  else if (!result.claudeMdRef) result.verdict = 'unwired';
  else result.verdict = 'configured';

  result.elapsedMs = Date.now() - t0;
  return result;
}

const USAGE = `Usage: node scripts/design-detect.js [--json] [--cwd=PATH]

Deterministic, stateless design-token detector (the /claudemd-design-adopt command's step 0).

  --json      Machine-readable JSON output (default: one-line summary)
  --cwd=PATH  Analyze PATH instead of the current directory
  --help, -h  Print this message and exit

Verdicts: no-ui | ui-no-tokens | adoptable | unwired | configured | error
Exit codes: 0 (all verdicts, fail-open) | 2 (argument error)`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { bools: ['--json'], values: ['--cwd'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const cwd = path.resolve(parsed.values['--cwd'] || process.cwd());
  try {
    const out = detect(cwd);
    if (parsed.bools.has('--json')) {
      process.stdout.write(JSON.stringify(out) + '\n');
    } else {
      process.stdout.write(`${out.verdict}: framework=${out.framework || '-'} tokens=${out.tokenSources.length} designMd=${out.designMd || '-'} wired=${out.claudeMdRef} (${out.elapsedMs}ms)\n`);
    }
  } catch {
    // Fail-open: callers must never see a non-zero exit or junk.
    process.stdout.write(JSON.stringify({ verdict: 'error' }) + '\n');
  }
  process.exit(0);
}
