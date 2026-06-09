// v0.14.0 — retrospective batch scanner for 4 self-enforced HARD rules.
// Mirrors the regex / heuristic core of hooks/transcript-{vocab,structure}-scan.sh
// but iterates ALL assistant turns across a sample of historical transcripts,
// not just the last turn of the current session. Produces aggregate per-rule
// violation counts feeding §13.2 staleReviews — closes the observation gap for
// §10-V / §iron-law-2 / §10-four-section-order / §10-honesty.
//
// Drift safeguard: tests/fixtures/sampling-audit/*.jsonl pins both this script
// and the bash hooks to the same expected hit-counts on identical inputs. If
// the bash detectors change without this script following, the byte-exact
// fixtures break the suite and force re-alignment.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';

const RULE_KEYS = ['§10-V', '§iron-law-2', '§10-four-section-order', '§10-honesty'];

const DEFAULT_WINDOW_DAYS = 30;

// CC encodes process.cwd() by replacing every non-`[a-zA-Z0-9-]` char with `-`
// (per memory feedback_cc_cwd_encoding_dots — `.` `_` `/` all collapse to `-`).
function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.claude/projects', encodeCwd(process.cwd()));
}

// Load §10-V banned-vocab patterns from the shipped hook config. Skip
// `@ratio`-tagged patterns — those are commit-baseline context and FP-heavy
// on chat prose (matches transcript-vocab-scan.sh).
function loadVocabPatterns(pluginRoot) {
  const file = path.join(pluginRoot, 'hooks/banned-vocab.patterns');
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = line.indexOf('|');
    if (sep < 0) continue;
    const regex = line.slice(0, sep);
    const reason = line.slice(sep + 1);
    if (reason.trim().startsWith('@ratio')) continue;
    try { out.push({ re: new RegExp(regex, 'i'), reason }); } catch { /* bad regex — skip */ }
  }
  return out;
}

function extractAssistantTurns(filePath) {
  const turns = [];
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return turns; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    const texts = content
      .filter(c => c && c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text);
    if (texts.length === 0) continue;
    turns.push(texts.join('\n'));
  }
  return turns;
}

function scanVocab(text, patterns) {
  const hits = [];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

// Mirror transcript-structure-scan.sh awk: strip leading `## `, then test for
// label followed by `:`, em-dash, trailing whitespace, or EOL. Captures both
// canonical (`^Done:`) and markdown-header (`## Done`) forms.
function locateLabels(text) {
  const lines = text.split('\n');
  let d = 0, nd = 0, f = 0, u = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^##\s+/, '');
    if (!d  && /^Done(\s+—|:|\s*$)/.test(l))      d = i + 1;
    if (!nd && /^Not done(\s+—|:|\s*$)/.test(l))  nd = i + 1;
    if (!f  && /^Failed(\s+—|:|\s*$)/.test(l))    f = i + 1;
    if (!u  && /^Uncertain(\s+—|:|\s*$)/.test(l)) u = i + 1;
  }
  return { d, nd, f, u, lines };
}

const EVIDENCE_FINGERPRINT = /\.[a-zA-Z]+:[0-9]+|\b(passed|failed|tests)\b|[0-9]+[^\s]*\s*(→|->|=>)\s*[0-9]+|Checked:|baseline|known-red|证据[:：]/;

function scanStructure(text) {
  const out = { ironLaw2: 0, orderViolation: 0 };
  const { d, nd, f, u, lines } = locateLabels(text);
  if (!(d > 0 && nd > 0 && f > 0 && u > 0)) return out;
  const positions = [d, nd, f, u];
  const minLn = Math.min(...positions);
  const maxLn = Math.max(...positions);
  if (maxLn - minLn > 50) return out;

  if (d >= nd || nd >= f || f >= u) out.orderViolation = 1;

  const labelLines = [nd, f, u].sort((a, b) => a - b);
  for (let i = minLn - 1; i < maxLn; i++) {
    const l = lines[i].replace(/^##\s+/, '');
    if (!/^Done(\s+—|:|\s*$)/.test(l)) continue;
    if (/^Done:\s*(\(none\)|\(无\)|none|N\/A|-+)?\s*$/.test(l)) continue;
    const ln = i + 1;
    let nextLabel = Infinity;
    for (const cand of labelLines) {
      if (cand > ln && cand < nextLabel) nextLabel = cand;
    }
    let upper = ln + 14;
    if (nextLabel - 1 < upper) upper = nextLabel - 1;
    if (upper < ln) upper = ln;
    const block = lines.slice(ln - 1, upper).join('\n');
    if (!EVIDENCE_FINGERPRINT.test(block)) out.ironLaw2 += 1;
  }
  return out;
}

function scanHonesty(text) {
  let hits = 0;
  for (const raw of text.split('\n')) {
    const norm = raw.replace(/^##\s+/, '');
    if (!/^Uncertain(\s+—|:|\s*$)/.test(norm)) continue;
    if (norm.length >= 80) continue;
    if (/^##\s+Uncertain\s*$/.test(raw)) continue;
    if (/^Uncertain\s*[:—-]\s*(\(none\)|\(无\)|none|N\/A|-+)?\s*$/.test(norm)) continue;
    if (/\b(because|since)\b|reason:|因为/i.test(norm)) continue;
    if (/^Uncertain\s*$/.test(norm)) continue;
    hits += 1;
  }
  return hits;
}

function emptyResult(windowDays, projectsDir) {
  return {
    windowDays,
    projectsDir,
    scannedTranscripts: 0,
    totalTurns: 0,
    byRule: Object.fromEntries(RULE_KEYS.map(k => [k, { hits: 0, transcriptsAffected: 0 }])),
    perTranscript: [],
  };
}

export async function samplingAudit({
  projectsDir,
  days = DEFAULT_WINDOW_DAYS,
  sample = null,
  pluginRoot,
} = {}) {
  if (!pluginRoot) pluginRoot = resolvePluginRoot(import.meta.url);
  if (!projectsDir) projectsDir = defaultProjectsDir();

  const result = emptyResult(days, projectsDir);

  let files;
  try {
    files = fs.readdirSync(projectsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(projectsDir, f));
  } catch {
    return result; // missing projectsDir is not an error — empty result.
  }

  const cutoffMs = Date.now() - days * 86400000;
  files = files.filter(f => {
    try { return fs.statSync(f).mtimeMs >= cutoffMs; }
    catch { return false; }
  });

  if (sample && sample > 0 && sample < files.length) {
    // Fisher-Yates: `sort(() => Math.random() - 0.5)` is NOT a uniform shuffle —
    // the comparator violates total-order, so V8 biases toward the input order
    // (empirically the first/last elements stay put ~30% of the time vs 20%
    // uniform). For a *sampling* audit that skews drift estimates toward
    // whichever sessions readdir lists first. Partial F-Y: we only need the
    // first `sample` slots, so stop once they're filled.
    const shuffled = files.slice();
    for (let i = 0; i < sample; i++) {
      const j = i + Math.floor(Math.random() * (shuffled.length - i));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    files = shuffled.slice(0, sample);
  }

  const patterns = loadVocabPatterns(pluginRoot);
  const affected = Object.fromEntries(RULE_KEYS.map(k => [k, new Set()]));

  for (const file of files) {
    const turns = extractAssistantTurns(file);
    if (turns.length === 0) continue;
    result.scannedTranscripts += 1;
    result.totalTurns += turns.length;
    const perFile = { file: path.basename(file), hits: [] };
    for (let i = 0; i < turns.length; i++) {
      const text = turns[i];
      const vocab = scanVocab(text, patterns);
      if (vocab.length > 0) {
        result.byRule['§10-V'].hits += vocab.length;
        affected['§10-V'].add(file);
        perFile.hits.push({ rule: '§10-V', turn: i, matches: vocab.slice(0, 3) });
      }
      const s = scanStructure(text);
      if (s.ironLaw2 > 0) {
        result.byRule['§iron-law-2'].hits += s.ironLaw2;
        affected['§iron-law-2'].add(file);
        perFile.hits.push({ rule: '§iron-law-2', turn: i, count: s.ironLaw2 });
      }
      if (s.orderViolation > 0) {
        result.byRule['§10-four-section-order'].hits += s.orderViolation;
        affected['§10-four-section-order'].add(file);
        perFile.hits.push({ rule: '§10-four-section-order', turn: i });
      }
      const honesty = scanHonesty(text);
      if (honesty > 0) {
        result.byRule['§10-honesty'].hits += honesty;
        affected['§10-honesty'].add(file);
        perFile.hits.push({ rule: '§10-honesty', turn: i, count: honesty });
      }
    }
    if (perFile.hits.length > 0) result.perTranscript.push(perFile);
  }
  for (const k of RULE_KEYS) result.byRule[k].transcriptsAffected = affected[k].size;
  return result;
}

function formatMarkdown(r) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [
    `# Sampling audit — ${today}`,
    '',
    `Window: ${r.windowDays}d · Transcripts scanned: ${r.scannedTranscripts} · Total assistant turns: ${r.totalTurns}`,
    `Source: \`${r.projectsDir}\``,
    '',
    '## Aggregate by rule',
    '',
    '| Rule | Hits | Transcripts affected |',
    '|---|---:|---:|',
  ];
  for (const k of RULE_KEYS) {
    out.push(`| ${k} | ${r.byRule[k].hits} | ${r.byRule[k].transcriptsAffected} |`);
  }
  out.push('');
  if (r.perTranscript.length > 0) {
    out.push('## Per-transcript hits');
    out.push('');
    for (const t of r.perTranscript) {
      const n = t.hits.length;
      out.push(`- \`${t.file}\` (${n} hit${n === 1 ? '' : 's'})`);
      for (const h of t.hits) {
        const detail = h.matches ? ` — matches: ${h.matches.join(', ')}`
                       : (h.count ? ` ×${h.count}` : '');
        out.push(`  - turn ${h.turn}: ${h.rule}${detail}`);
      }
    }
  } else {
    out.push('No rule hits in scanned transcripts.');
  }
  out.push('');
  return out.join('\n');
}

const USAGE = `Usage: node scripts/sampling-audit.js [--days=N] [--sample=N] [--global] [--json]

Retrospective batch scan of historical transcripts for 4 self-enforced HARD rules
(§10-V banned vocab / §iron-law-2 / §10-four-section-order / §10-honesty).

Options:
  --days=N       Window in days (positive integer, default 30).
  --sample=N     Random sample N transcripts within the window.
  --global       Scan all CC project dirs (~/.claude/projects/*) — not just cwd.
  --json         Emit machine-readable JSON to stdout instead of markdown report.
  --help, -h     Print this message and exit.

Env: CLAUDEMD_SAMPLING_DAYS=N (overridden by --days=N when both set).
Wrapped by /claudemd-sampling-audit.

Output (non-JSON mode): writes \`tasks/sampling-audit-<YYYY-MM-DD>.md\` and
prints a per-rule summary to stdout.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

async function runGlobal({ days, sample, pluginRoot }) {
  const projectsDir = path.join(os.homedir(), '.claude/projects');
  const result = emptyResult(days, projectsDir);
  const affected = Object.fromEntries(RULE_KEYS.map(k => [k, new Set()]));
  let subDirs = [];
  try {
    subDirs = fs.readdirSync(projectsDir)
      .map(d => path.join(projectsDir, d))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch { /* no projects dir */ }
  for (const dir of subDirs) {
    const sub = await samplingAudit({ projectsDir: dir, days, sample, pluginRoot });
    result.scannedTranscripts += sub.scannedTranscripts;
    result.totalTurns += sub.totalTurns;
    for (const k of RULE_KEYS) result.byRule[k].hits += sub.byRule[k].hits;
    for (const t of sub.perTranscript) {
      const labelled = { file: `${path.basename(dir)}/${t.file}`, hits: t.hits };
      result.perTranscript.push(labelled);
      for (const k of RULE_KEYS) {
        if (t.hits.some(h => h.rule === k)) affected[k].add(labelled.file);
      }
    }
  }
  for (const k of RULE_KEYS) result.byRule[k].transcriptsAffected = affected[k].size;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), {
      bools: ['--global', '--json'],
      values: ['--days', '--sample'],
    });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const rawDays = parsed.values['--days'] ?? (process.env.CLAUDEMD_SAMPLING_DAYS || String(DEFAULT_WINDOW_DAYS));
  const days = parsePositiveInt(rawDays);
  if (days === null) {
    console.error(`--days requires a positive integer (got '${rawDays}').`);
    process.exit(1);
  }
  let sample = null;
  if (parsed.values['--sample'] != null) {
    const s = parsePositiveInt(parsed.values['--sample']);
    if (s === null) {
      console.error(`--sample requires a positive integer (got '${parsed.values['--sample']}').`);
      process.exit(1);
    }
    sample = s;
  }

  const pluginRoot = resolvePluginRoot(import.meta.url);

  (async () => {
    const result = parsed.bools.has('--global')
      ? await runGlobal({ days, sample, pluginRoot })
      : await samplingAudit({ days, sample, pluginRoot });

    if (parsed.bools.has('--json')) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const md = formatMarkdown(result);
    const today = new Date().toISOString().slice(0, 10);
    const outPath = path.join(process.cwd(), 'tasks', `sampling-audit-${today}.md`);
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, md);
      console.log(`Wrote ${outPath} — ${result.scannedTranscripts} transcripts, ${result.totalTurns} turns scanned.`);
      for (const k of RULE_KEYS) {
        console.log(`  ${k}: ${result.byRule[k].hits} hits (${result.byRule[k].transcriptsAffected} transcripts)`);
      }
    } catch {
      console.log(md);
    }
  })();
}
