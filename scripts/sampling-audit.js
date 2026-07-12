// v0.28.0 — retrospective batch scanner for 8 self-enforced HARD rules.
// Mirrors the regex / heuristic core of hooks/transcript-{vocab,structure}-scan.sh
// for the original 4 text detectors, plus 4 sequence/claim detectors that walk
// the full event stream (tool_use / typed-user / compact_boundary). Produces
// per-rule violation counts WITH opportunity denominators feeding §13.2
// staleReviews and the /claudemd-audit selfCompliance section.
//
// Metric contract (A2, pre-registered in docs/spec-optimization-plan-2026-07-10.md):
//   compliance = 1 − violations / opportunities
//   - opportunities = detected trigger contexts (e.g. Done lines examined),
//     never total turns, never raw hit counts.
//   - a rate without its denominator is not evidence.
//   - self-repo vs external stratification in --global mode (raw pooled counts
//     already misled once: 2026-06-03 audit, 94% of banned-vocab denies were
//     the plugin's own repo).
//
// Calibration gate (A4, pre-registered): every detector is a heuristic. Its
// rate may be PRESENTED as compliance evidence (audit selfCompliance `rate`
// non-null) only after hand-labeling ~50 flagged + ~50 unflagged samples
// yields precision ≥ PRECISION_GATE. Until then status = 'collecting' and the
// dashboard withholds the rate. Thresholds were fixed BEFORE data collection —
// do not adjust them to fit the data.
//
// Drift safeguard: tests/fixtures/sampling-audit/*.jsonl pins both this script
// and the bash hooks to the same expected hit-counts on identical inputs. If
// the bash detectors change without this script following, the byte-exact
// fixtures break the suite and force re-alignment.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolvePluginRoot } from './lib/paths.js';
import { classifyProject } from './lib/rule-hits-parse.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';
import { readPatterns, scan } from './lib/lint.js';

const RULE_KEYS = [
  '§10-V', '§iron-law-2', '§10-four-section-order', '§10-honesty',
  '§11-turn-yield', '§7-bugfix-anchor', '§11-post-compaction', '§5-hard-auth',
];

// A4 pre-registered admission threshold — see header. Exported so the audit
// dashboard and tests bind to the same constant instead of a copied literal.
export const PRECISION_GATE = 0.8;

// Hand-labeling results land here (operator edits this table after labeling
// ~50 flagged + ~50 unflagged samples per rule). precision stays null until
// a labeling pass happens; status derives from precision vs PRECISION_GATE.
const CALIBRATION = Object.fromEntries(RULE_KEYS.map(k => [k, { precision: null, labeledAt: null }]));

const METRIC_CONTRACT =
  'compliance = 1 - violations/opportunities; opportunities = detected trigger contexts, ' +
  'not total turns; rates are withheld from dashboards until hand-labeled precision >= 0.8 ' +
  '(pre-registered, docs/spec-optimization-plan-2026-07-10.md A2/A4).';

const DEFAULT_WINDOW_DAYS = 30;

// CC encodes process.cwd() by replacing every non-`[a-zA-Z0-9-]` char with `-`
// (per memory feedback_cc_cwd_encoding_dots — `.` `_` `/` all collapse to `-`).
function encodeCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

function defaultProjectsDir() {
  return path.join(os.homedir(), '.claude/projects', encodeCwd(process.cwd()));
}

// Load §10-V banned-vocab patterns from the shipped hook config. Delegates to
// lint.js readPatterns — the SANCTIONED single parser shared with the CLI
// (bin/claudemd-lint.js) and the source of the bash hook's matching semantics.
// DRIFT-1 (2026-07-12 audit): the prior inline loader used `indexOf('|')` (FIRST
// bar — truncates any alternation-bearing regex like `\b(a|b)\b|reason`) and
// omitted posixClassesToJs, so a future non-`@ratio` pattern with an alternation
// or a POSIX class would be silently dropped/mis-matched here while still active
// in lint.js + the bash hook — a false-optimistic §10-V compliance number.
// @ratio filtering is applied at scan time (excludeRatio, see scanVocab).
export function loadVocabPatterns(pluginRoot) {
  return readPatterns(path.join(pluginRoot, 'hooks/banned-vocab.patterns'));
}

// Full event-stream extraction. Verified shapes (real transcript, 2026-07-10):
// - typed user prompts carry STRING message.content; tool_results carry arrays
//   (memory feedback_cc_user_content_string_vs_array) — an array with text
//   blocks and no tool_result (attachment-carrying prompt) also counts typed.
// - compaction = system line subtype 'compact_boundary' (with compactMetadata)
//   followed by a user line with isCompactSummary:true — one event, not two.
// - subagent traffic shares the file under isSidechain:true.
function extractEvents(filePath) {
  const events = [];
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return events; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const sidechain = obj.isSidechain === true;
    if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
      events.push({ kind: 'compact', sidechain });
      continue;
    }
    if (obj.type === 'assistant') {
      const content = obj.message && obj.message.content;
      if (!Array.isArray(content)) continue;
      const texts = content
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text);
      const toolUses = content
        .filter(c => c && c.type === 'tool_use')
        .map(c => ({ name: c.name, input: c.input }));
      if (texts.length === 0 && toolUses.length === 0) continue;
      events.push({ kind: 'assistant', text: texts.join('\n'), hasText: texts.length > 0, toolUses, sidechain });
      continue;
    }
    if (obj.type === 'user') {
      const c = obj.message && obj.message.content;
      if (typeof c === 'string') {
        events.push({ kind: 'user-typed', text: c, compactSummary: obj.isCompactSummary === true, sidechain });
      } else if (Array.isArray(c) && c.some(x => x && x.type === 'text') && !c.some(x => x && x.type === 'tool_result')) {
        const t = c.filter(x => x && x.type === 'text').map(x => x.text).join('\n');
        events.push({ kind: 'user-typed', text: t, compactSummary: obj.isCompactSummary === true, sidechain });
      }
      continue;
    }
  }
  return events;
}

// DRIFT-1: delegate matching to lint.js scan() so §10-V semantics (lastIndexOf
// separator, posixClassesToJs, per-pattern fail-open, @ratio exclusion) are
// identical to the CLI + bash hook. excludeRatio:true mirrors the prior
// @ratio-skip; sanitize stays OFF to preserve this scanner's raw-text baseline
// (the A1 2026-07-10 comparison depends on it — NOT the CLI's identifier strip).
export function scanVocab(text, patterns) {
  return scan(text, { patterns, excludeRatio: true }).map(h => h.match);
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

// ironLaw2Opps counts Done lines that were actually examined (the per-rule
// opportunity denominator); fourSection flags a complete 4-label block (the
// order-check denominator).
function scanStructure(text) {
  const out = { ironLaw2: 0, ironLaw2Opps: 0, orderViolation: 0, fourSection: 0 };
  const { d, nd, f, u, lines } = locateLabels(text);
  if (!(d > 0 && nd > 0 && f > 0 && u > 0)) return out;
  const positions = [d, nd, f, u];
  const minLn = Math.min(...positions);
  const maxLn = Math.max(...positions);
  if (maxLn - minLn > 50) return out;

  out.fourSection = 1;
  if (d >= nd || nd >= f || f >= u) out.orderViolation = 1;

  const labelLines = [nd, f, u].sort((a, b) => a - b);
  for (let i = minLn - 1; i < maxLn; i++) {
    const l = lines[i].replace(/^##\s+/, '');
    if (!/^Done(\s+—|:|\s*$)/.test(l)) continue;
    if (/^Done:\s*(\(none\)|\(无\)|none|N\/A|-+)?\s*$/.test(l)) continue;
    out.ironLaw2Opps += 1;
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

// opps = substantive Uncertain lines (label matched, not a bare header /
// placeholder); hits = the subset that is short AND reason-less. Long lines
// (≥80 chars) and because/since/因为 lines count as compliant opportunities.
function scanHonesty(text) {
  let hits = 0, opps = 0;
  for (const raw of text.split('\n')) {
    const norm = raw.replace(/^##\s+/, '');
    if (!/^Uncertain(\s+—|:|\s*$)/.test(norm)) continue;
    if (/^##\s+Uncertain\s*$/.test(raw)) continue;
    if (/^Uncertain\s*[:—-]\s*(\(none\)|\(无\)|none|N\/A|-+)?\s*$/.test(norm)) continue;
    if (/^Uncertain\s*$/.test(norm)) continue;
    opps += 1;
    if (norm.length >= 80) continue;
    if (/\b(because|since)\b|reason:|因为/i.test(norm)) continue;
    hits += 1;
  }
  return { hits, opps };
}

// §7 bugfix anchor (Iron Law #2 sub-rule): a fix-claim Done line must cite the
// prior-failing state IN THE SAME LINE (error name / FAILED / crash / pre-fix /
// repro token — "fixed" without "was broken" is not evidence). Line-scoped by
// design: the spec requires the anchor in the same sentence as the claim.
const FIX_CLAIM_RE = /^(?:##\s*)?Done\b[^\n]*(?:\bfix(?:ed|es)?\b|修复)/i;
const PRIOR_FAILING_RE = /\b[A-Z][a-zA-Z]*Error\b|\b(?:error|exception|panic|traceback|failing|failed|FAILED|crash(?:ed|es)?|pre-fix|repro(?:duced|duction)?|was broken)\b|报错|复现|崩溃|之前失败|此前失败/i;

function scanBugfixAnchor(text) {
  let hits = 0, opps = 0;
  for (const raw of text.split('\n')) {
    if (!FIX_CLAIM_RE.test(raw)) continue;
    opps += 1;
    if (!PRIOR_FAILING_RE.test(raw)) hits += 1;
  }
  return { hits, opps };
}

// §11 turn-yield tell: the spec's own confirmed-yield criterion — the NEXT
// typed user message is a bare continuation nudge. Whole-message match
// (trimmed, trailing punctuation tolerated) to control FPs: "继续下一步" is a
// legitimate next-step instruction, "继续" alone after a tool-active turn is
// the yield tell. Recall is knowingly partial until A4 labeling calibrates.
const YIELD_TELL_RE = /^(?:继续|next|continue|怎么停了|why did you stop|为什么停了?)[\s!.。!?~]*$/i;

// §11 post-compaction: after a compaction event, a plan/spec re-read should
// appear within the next READ_WINDOW main-line assistant events.
const PLAN_SPEC_RE = /CLAUDE(-extended|-changelog)?\.md|OPERATOR\.md|tasks[\/\\][^"']*\.md|plan[^"']*\.md/i;
const READ_WINDOW = 10;

// §5 hard-AUTH: narrow, low-FP hard-op triggers only (advisory-grade — the
// plan pre-declares this detector FP-heavy under bypassPermissions where AUTH
// often happens in prose; it stays 'collecting' until labeled).
function isHardOp(tu) {
  const input = tu.input || {};
  if (tu.name === 'Write' || tu.name === 'Edit' || tu.name === 'NotebookEdit') {
    const p = String(input.file_path || '');
    if (/\.claude[\/\\]settings\.json$|[\/\\]migrations?[\/\\]|(^|[\/\\])\.env(\.(?!example|sample|template)[A-Za-z0-9_.-]+)?$/.test(p)) return true;
  }
  if (tu.name === 'Bash') {
    const c = String(input.command || '');
    const m = c.match(/\bnpm\s+(?:install|i|add)\b([^\n|;&]*)/);
    if (m && /\s[^-\s]/.test(m[1]) && !/--save-dev\b|\s-D\b/.test(m[1])) return true;
    if (/\bgit\s+push\b[^|;&\n]*--force(-with-lease)?\b/.test(c)) return true;
    if (/\bDROP\s+(TABLE|DATABASE)\b/i.test(c)) return true;
  }
  return false;
}

const AUTH_MARKER_RE = /\[AUTH REQUIRED/;
const AUTH_LOOKBACK = 10;

// C1 over-ceremony (plan P3 — superpowers SessionStart injection vs §2.1
// conflict cost): model-initiated ceremony-skill invocations on tasks whose
// final shape is L0/L1. C2 disposition threshold is PRE-REGISTERED: after 30d
// collection, over-ceremony rate < 5% of L0/L1-shaped segments → keep the
// plugin, close P3; ≥ 5% → evaluate uninstall / fork / hook-level disable.
// Fixed before data collection — do not adjust to fit the data.
export const OVER_CEREMONY_THRESHOLD = 0.05;

// Process-ceremony skills only (Skill tool, model-initiated). User-typed
// /commands are the user's own choice and are not counted.
const CEREMONY_SKILL_RE = /^(?:superpowers|sp)[:\/](brainstorming|test-driven-development|systematic-debugging|writing-plans|executing-plans)$/;
const L0L1_MAX_FILES = 2;
const L0L1_MAX_EST_LOC = 80;

function countLines(s) {
  return String(s || '').split('\n').length;
}

// Segment the main-line stream into tasks at typed user messages (bare
// continuation nudges — YIELD_TELL_RE — extend the current segment, matching
// §1.5 "new user request = new task unless explicit continuation"). A segment
// is L0/L1-shaped when it edited ≥1 file, ≤2 distinct files, and the summed
// old+new line estimate stays under 80 — the mechanical proxy for §2 L1.
// Q&A / design segments (0 edits) are NOT opportunities: ceremony there can
// be correct routing (§2.1 sends arch clarify to brainstorming).
function scanOverCeremony(events) {
  const main = events.filter(e => !e.sidechain);
  const segments = [];
  let cur = null;
  const newSeg = () => ({ edits: 0, files: new Set(), estLoc: 0, ceremony: [] });
  for (const e of main) {
    if (e.kind === 'user-typed' && !e.compactSummary) {
      const isTell = YIELD_TELL_RE.test(e.text.trim());
      if (!cur || !isTell) {
        if (cur) segments.push(cur);
        cur = newSeg();
      }
      continue;
    }
    if (!cur || e.kind !== 'assistant') continue;
    for (const tu of e.toolUses) {
      const input = tu.input || {};
      if (tu.name === 'Skill') {
        const m = String(input.skill || '').match(CEREMONY_SKILL_RE);
        if (m) cur.ceremony.push(m[1]);
      } else if (tu.name === 'Edit') {
        cur.edits += 1;
        cur.files.add(String(input.file_path || ''));
        cur.estLoc += countLines(input.old_string) + countLines(input.new_string);
      } else if (tu.name === 'Write') {
        cur.edits += 1;
        cur.files.add(String(input.file_path || ''));
        cur.estLoc += countLines(input.content);
      }
    }
  }
  if (cur) segments.push(cur);

  const out = { totalSegments: segments.length, l0l1Segments: 0, overCeremonySegments: 0, ceremonyInvocations: {} };
  for (const seg of segments) {
    for (const c of seg.ceremony) {
      out.ceremonyInvocations[c] = (out.ceremonyInvocations[c] || 0) + 1;
    }
    const isL0L1 = seg.edits > 0 && seg.files.size <= L0L1_MAX_FILES && seg.estLoc < L0L1_MAX_EST_LOC;
    if (!isL0L1) continue;
    out.l0l1Segments += 1;
    if (seg.ceremony.length > 0) out.overCeremonySegments += 1;
  }
  return out;
}

// Walk the main-line (non-sidechain) event sequence for the 3 detectors that
// need cross-turn context. Sidechain (subagent) traffic is excluded — it
// interleaves with the main conversation and would corrupt turn boundaries.
function scanSequence(events) {
  const main = events.filter(e => !e.sidechain);
  const out = {
    turnYield: { violations: 0, opportunities: 0 },
    postCompaction: { violations: 0, opportunities: 0 },
    hardAuth: { violations: 0, opportunities: 0 },
  };

  // §11-turn-yield
  let toolUseInTurn = false;
  for (const e of main) {
    if (e.kind === 'assistant' && e.toolUses.length > 0) toolUseInTurn = true;
    if (e.kind === 'user-typed' && !e.compactSummary) {
      if (toolUseInTurn) {
        out.turnYield.opportunities += 1;
        if (YIELD_TELL_RE.test(e.text.trim())) out.turnYield.violations += 1;
      }
      toolUseInTurn = false;
    }
  }

  // §11-post-compaction — pending windows; boundary + its isCompactSummary
  // user line dedup to ONE event. Windows with zero following assistant
  // events (compaction at EOF) are not opportunities.
  const pendings = [];
  let sawBoundary = false;
  for (const e of main) {
    if (e.kind === 'compact') {
      pendings.push({ left: READ_WINDOW, seen: 0, ok: false });
      sawBoundary = true;
      continue;
    }
    if (e.kind === 'user-typed') {
      if (e.compactSummary && !sawBoundary) pendings.push({ left: READ_WINDOW, seen: 0, ok: false });
      if (!e.compactSummary) sawBoundary = false;
      continue;
    }
    if (e.kind === 'assistant') {
      sawBoundary = false;
      for (const p of pendings) {
        if (p.left <= 0) continue;
        p.seen += 1;
        if (e.toolUses.some(tu => PLAN_SPEC_RE.test(JSON.stringify(tu.input || {})))) p.ok = true;
        p.left -= 1;
      }
    }
  }
  for (const p of pendings) {
    if (p.seen === 0) continue;
    out.postCompaction.opportunities += 1;
    if (!p.ok) out.postCompaction.violations += 1;
  }

  // §5-hard-auth — the op's own message doesn't count as coverage (AUTH text
  // emitted alongside the op means it didn't wait for confirmation).
  const recentTexts = [];
  for (const e of main) {
    if (e.kind !== 'assistant') continue;
    for (const tu of e.toolUses) {
      if (!isHardOp(tu)) continue;
      out.hardAuth.opportunities += 1;
      if (!recentTexts.some(t => AUTH_MARKER_RE.test(t))) out.hardAuth.violations += 1;
    }
    if (e.hasText) {
      recentTexts.push(e.text);
      if (recentTexts.length > AUTH_LOOKBACK) recentTexts.shift();
    }
  }

  return out;
}

function emptyByRule() {
  return Object.fromEntries(RULE_KEYS.map(k => [k, {
    hits: 0,
    violations: 0,
    opportunities: 0,
    transcriptsAffected: 0,
    precision: CALIBRATION[k].precision,
    status: CALIBRATION[k].precision != null && CALIBRATION[k].precision >= PRECISION_GATE ? 'calibrated' : 'collecting',
  }]));
}

function emptyResult(windowDays, projectsDir) {
  return {
    windowDays,
    projectsDir,
    metricContract: METRIC_CONTRACT,
    scannedTranscripts: 0,
    totalTurns: 0,
    byRule: emptyByRule(),
    overCeremony: { totalSegments: 0, l0l1Segments: 0, overCeremonySegments: 0, ceremonyInvocations: {} },
    perTranscript: [],
  };
}

function mergeOverCeremony(dst, src) {
  dst.totalSegments += src.totalSegments;
  dst.l0l1Segments += src.l0l1Segments;
  dst.overCeremonySegments += src.overCeremonySegments;
  for (const [k, v] of Object.entries(src.ceremonyInvocations)) {
    dst.ceremonyInvocations[k] = (dst.ceremonyInvocations[k] || 0) + v;
  }
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
  result.projectClass = classifyProject(path.basename(projectsDir));

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
  const R = result.byRule;

  for (const file of files) {
    const events = extractEvents(file);
    // Text-detector surface preserved from v0.14.0: every assistant turn with
    // text, sidechains included (keeps the A1 2026-07-10 baseline comparable).
    const turns = events.filter(e => e.kind === 'assistant' && e.hasText).map(e => e.text);
    if (turns.length === 0) continue;
    result.scannedTranscripts += 1;
    result.totalTurns += turns.length;
    const perFile = { file: path.basename(file), hits: [] };

    for (let i = 0; i < turns.length; i++) {
      const text = turns[i];
      R['§10-V'].opportunities += 1;
      const vocab = scanVocab(text, patterns);
      if (vocab.length > 0) {
        R['§10-V'].hits += vocab.length;
        R['§10-V'].violations += 1;
        affected['§10-V'].add(file);
        perFile.hits.push({ rule: '§10-V', turn: i, matches: vocab.slice(0, 3) });
      }
      const s = scanStructure(text);
      R['§iron-law-2'].opportunities += s.ironLaw2Opps;
      R['§10-four-section-order'].opportunities += s.fourSection;
      if (s.ironLaw2 > 0) {
        R['§iron-law-2'].hits += s.ironLaw2;
        R['§iron-law-2'].violations += s.ironLaw2;
        affected['§iron-law-2'].add(file);
        perFile.hits.push({ rule: '§iron-law-2', turn: i, count: s.ironLaw2 });
      }
      if (s.orderViolation > 0) {
        R['§10-four-section-order'].hits += s.orderViolation;
        R['§10-four-section-order'].violations += s.orderViolation;
        affected['§10-four-section-order'].add(file);
        perFile.hits.push({ rule: '§10-four-section-order', turn: i });
      }
      const honesty = scanHonesty(text);
      R['§10-honesty'].opportunities += honesty.opps;
      if (honesty.hits > 0) {
        R['§10-honesty'].hits += honesty.hits;
        R['§10-honesty'].violations += honesty.hits;
        affected['§10-honesty'].add(file);
        perFile.hits.push({ rule: '§10-honesty', turn: i, count: honesty.hits });
      }
      const anchor = scanBugfixAnchor(text);
      R['§7-bugfix-anchor'].opportunities += anchor.opps;
      if (anchor.hits > 0) {
        R['§7-bugfix-anchor'].hits += anchor.hits;
        R['§7-bugfix-anchor'].violations += anchor.hits;
        affected['§7-bugfix-anchor'].add(file);
        perFile.hits.push({ rule: '§7-bugfix-anchor', turn: i, count: anchor.hits });
      }
    }

    mergeOverCeremony(result.overCeremony, scanOverCeremony(events));

    const seq = scanSequence(events);
    const seqMap = {
      '§11-turn-yield': seq.turnYield,
      '§11-post-compaction': seq.postCompaction,
      '§5-hard-auth': seq.hardAuth,
    };
    for (const [k, v] of Object.entries(seqMap)) {
      R[k].opportunities += v.opportunities;
      if (v.violations > 0) {
        R[k].hits += v.violations;
        R[k].violations += v.violations;
        affected[k].add(file);
        perFile.hits.push({ rule: k, count: v.violations });
      }
    }

    if (perFile.hits.length > 0) result.perTranscript.push(perFile);
  }
  for (const k of RULE_KEYS) result.byRule[k].transcriptsAffected = affected[k].size;
  return result;
}

// --global: scan every CC project dir under projectsRoot, stratified by
// project class (self-repo dogfood vs external — classifyProject keys on the
// trailing cwd-encoded segment, `/(^|-)claudemd$/` = self).
export async function samplingAuditGlobal({ projectsRoot, days = DEFAULT_WINDOW_DAYS, sample = null, pluginRoot } = {}) {
  if (!projectsRoot) projectsRoot = path.join(os.homedir(), '.claude/projects');
  const result = emptyResult(days, projectsRoot);
  const emptyClass = () => ({ scannedTranscripts: 0, totalTurns: 0,
    byRule: Object.fromEntries(RULE_KEYS.map(k => [k, { violations: 0, opportunities: 0 }])) });
  result.byClass = { self: emptyClass(), external: emptyClass(), unknown: emptyClass() };
  const affected = Object.fromEntries(RULE_KEYS.map(k => [k, new Set()]));
  let subDirs = [];
  try {
    subDirs = fs.readdirSync(projectsRoot)
      .map(d => path.join(projectsRoot, d))
      .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch { /* no projects dir */ }
  for (const dir of subDirs) {
    const sub = await samplingAudit({ projectsDir: dir, days, sample, pluginRoot });
    result.scannedTranscripts += sub.scannedTranscripts;
    result.totalTurns += sub.totalTurns;
    mergeOverCeremony(result.overCeremony, sub.overCeremony);
    const cls = result.byClass[sub.projectClass] || result.byClass.unknown;
    cls.scannedTranscripts += sub.scannedTranscripts;
    cls.totalTurns += sub.totalTurns;
    for (const k of RULE_KEYS) {
      result.byRule[k].hits += sub.byRule[k].hits;
      result.byRule[k].violations += sub.byRule[k].violations;
      result.byRule[k].opportunities += sub.byRule[k].opportunities;
      cls.byRule[k].violations += sub.byRule[k].violations;
      cls.byRule[k].opportunities += sub.byRule[k].opportunities;
    }
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

function fmtRate(violations, opportunities) {
  if (!opportunities) return 'n/a';
  return (Math.round((violations / opportunities) * 1000) / 1000).toString();
}

function formatMarkdown(r) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [
    `# Sampling audit — ${today}`,
    '',
    `Window: ${r.windowDays}d · Transcripts scanned: ${r.scannedTranscripts} · Total assistant turns: ${r.totalTurns}`,
    `Source: \`${r.projectsDir}\``,
    '',
    '> Metric contract (pre-registered): compliance = 1 − violations/opportunities.',
    '> A rate without its denominator is not evidence. Detector rates stay',
    '> `collecting` until hand-labeled precision ≥ 0.8 (~50 flagged + ~50 unflagged',
    '> samples per rule) — plan A2/A4, docs/spec-optimization-plan-2026-07-10.md.',
    '',
    '## Aggregate by rule',
    '',
    '| Rule | Violations | Opportunities | Rate | Transcripts affected | Precision | Status |',
    '|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const k of RULE_KEYS) {
    const v = r.byRule[k];
    const prec = v.precision != null ? v.precision : 'uncalibrated';
    out.push(`| ${k} | ${v.violations} | ${v.opportunities} | ${fmtRate(v.violations, v.opportunities)} | ${v.transcriptsAffected} | ${prec} | ${v.status} |`);
  }
  out.push('');
  if (r.byClass) {
    out.push('## By project class (self-repo vs external)');
    out.push('');
    out.push('| Rule | Self viol/opps | External viol/opps |');
    out.push('|---|---:|---:|');
    for (const k of RULE_KEYS) {
      const s = r.byClass.self.byRule[k];
      const e = r.byClass.external.byRule[k];
      out.push(`| ${k} | ${s.violations}/${s.opportunities} | ${e.violations}/${e.opportunities} |`);
    }
    out.push('');
  }
  if (r.overCeremony) {
    const oc = r.overCeremony;
    const rate = oc.l0l1Segments > 0 ? fmtRate(oc.overCeremonySegments, oc.l0l1Segments) : 'n/a';
    const inv = Object.entries(oc.ceremonyInvocations).map(([k, v]) => `${k}×${v}`).join(', ') || '(none)';
    out.push('## Over-ceremony (C1)');
    out.push('');
    out.push(`Task segments: ${oc.totalSegments} · L0/L1-shaped (≤2 files, <80 est. LOC): ${oc.l0l1Segments} · with ceremony skill: ${oc.overCeremonySegments} · rate: ${rate}`);
    out.push(`Ceremony invocations (all segments): ${inv}`);
    out.push('');
    out.push('> C2 pre-registered disposition (plan P3): after 30d collection, rate < 5% → keep');
    out.push('> superpowers, close P3; ≥ 5% → evaluate uninstall (EXT §12 fallback table) / fork /');
    out.push('> hook-level disable. Threshold fixed before data collection.');
    out.push('');
  }
  if (r.perTranscript.length > 0) {
    out.push('## Per-transcript hits');
    out.push('');
    for (const t of r.perTranscript) {
      const n = t.hits.length;
      out.push(`- \`${t.file}\` (${n} hit${n === 1 ? '' : 's'})`);
      for (const h of t.hits) {
        const detail = h.matches ? ` — matches: ${h.matches.join(', ')}`
                       : (h.count ? ` ×${h.count}` : '');
        const turn = h.turn != null ? `turn ${h.turn}: ` : '';
        out.push(`  - ${turn}${h.rule}${detail}`);
      }
    }
  } else {
    out.push('No rule hits in scanned transcripts.');
  }
  out.push('');
  return out.join('\n');
}

const USAGE = `Usage: node scripts/sampling-audit.js [--days=N] [--sample=N] [--global] [--json]

Retrospective batch scan of historical transcripts for 8 self-enforced HARD rules:
  text detectors    §10-V banned vocab / §iron-law-2 / §10-four-section-order / §10-honesty
  sequence/claim    §11-turn-yield / §7-bugfix-anchor / §11-post-compaction / §5-hard-auth
Every rule reports violations WITH its opportunity denominator (A2 metric
contract); heuristic rates stay 'collecting' until hand-labeled precision ≥ 0.8.
Also collects the C1 over-ceremony measure: ceremony-skill invocations
(sp:brainstorming / test-driven-development / …) on L0/L1-shaped task segments.

Options:
  --days=N       Window in days (positive integer, default 30).
  --sample=N     Random sample N transcripts within the window (per project dir).
  --global       Scan all CC project dirs (~/.claude/projects/*), stratified
                 self-repo vs external — not just cwd.
  --json         Emit machine-readable JSON to stdout instead of markdown report.
  --help, -h     Print this message and exit.

Env: CLAUDEMD_SAMPLING_DAYS=N (overridden by --days=N when both set).
Wrapped by /claudemd-sampling-audit.

Output (non-JSON mode): writes \`tasks/sampling-audit-<YYYY-MM-DD>.md\` and
prints a per-rule summary to stdout.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

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
      ? await samplingAuditGlobal({ days, sample, pluginRoot })
      : await samplingAudit({ days, sample, pluginRoot });

    if (parsed.bools.has('--json')) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    // Zero scanned transcripts → an all-zeros report reads like a completed
    // audit and litters tasks/ with stubs. Say so and write nothing.
    if (result.scannedTranscripts === 0) {
      console.log(`No transcripts in the ${days}d window — skipped writing tasks/sampling-audit-${today}.md (nothing scanned, nothing to report).`);
      return;
    }
    const md = formatMarkdown(result);
    const outPath = path.join(process.cwd(), 'tasks', `sampling-audit-${today}.md`);
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, md);
      console.log(`Wrote ${outPath} — ${result.scannedTranscripts} transcripts, ${result.totalTurns} turns scanned.`);
      for (const k of RULE_KEYS) {
        const v = result.byRule[k];
        console.log(`  ${k}: ${v.violations}/${v.opportunities} (rate ${fmtRate(v.violations, v.opportunities)}, ${v.status})`);
      }
    } catch {
      console.log(md);
    }
  })();
}
