import fs from 'node:fs';
import path from 'node:path';
import { projectsRoot } from './paths.js';

// scripts/lib/memory-tags.js — §11-EXT Tag-specificity (SHOULD) static check.
//
// Scans ~/.claude/projects/*/memory/MEMORY.md and reports tags likely to
// false-positive at ship time in claudemd's §11 memory-read-check.sh hook.
//
// The hook matches tags with word-boundary + 0-2 char declension tolerance
// (case-insensitive):
//   (^|[^a-zA-Z0-9])<TAG>[a-zA-Z]{0,2}([^a-zA-Z0-9]|$)
//
// Two FP classes observed in production:
//   - v0.9.27 → v0.9.28: 3-char single-word tag `cli` matched `clippy` etc.
//     Hook side fixed via word-boundary tightening, but tags themselves were
//     never reviewed.
//   - 2026-05-11: 8-char single-word EN tag `semantic` matched `semantics` in
//     a release-notes body ("fail-open semantics"). Same FP family — generic
//     English single-word tags substring-match incidental prose.
//
// Spec §11-EXT (v6.11.11) says:
//   tags SHOULD be ≥4 chars AND specific to the memory's topic; generic
//   single-word English tags substring-match incidental occurrences and
//   produce high FP rates. Prefer multi-word phrases.
//
// This module executes that SHOULD as a doctor check. Advisory, not blocking.

// Narrow-allowlist: tags that pass the check despite tripping length /
// wordlist heuristics. Three sub-classes, all curated:
//
//   1. Short technical acronyms — very-low-FP-risk despite ≤5 chars.
//   2. Hook trigger verbs — tags matching memory-read-check.sh's TRIGGER_RE
//      verb set (release/push/ship/deploy/etc.). Tagging on these is the
//      hook's own design intent: "fire when the user is doing this verb."
//      Flagging them as FP candidates is a detector self-FP.
//   3. OS / runtime narrow terms — `macos` / `linux` etc. are short but
//      sufficiently topic-specific in claudemd-domain context.
//
// CJK tags pass through unfiltered (typically narrow by authoring convention
// — `升级` / `发版` aren't English-prose words).
const NARROW_ALLOWLIST = new Set([
  // Sub-class 1: short technical acronyms.
  'cwd',
  'npx',
  'jq',
  'gh',
  'ci',
  'ssh',
  'tls',
  'dns',
  'pid',
  'tdd',
  'bdd',
  'ast',
  'css',
  'html',
  'json',
  'sql',
  'yaml',
  'env',
  'api',
  'dom',
  'url',
  'pgo',
  'gpu',
  'cpu',
  // Sub-class 2: hook trigger verbs (memory-read-check.sh TRIGGER_RE).
  // Tags matching these are intentional triggers, not FP candidates.
  'release',
  'push',
  'ship',
  'deploy',
  'publish',
  'merge',
  'commit',
  'build',
  // Sub-class 3: OS / runtime narrow terms (claudemd-domain specific).
  'macos',
  'linux',
  'ubuntu',
  'darwin',
  'node',
  'python',
  'rust',
  'go',
]);

// Generic English single-word wordlist: tags known or strongly suspected to
// substring-match release-notes / commit-message / docs prose. Curated from
// observed FPs (v0.9.27/28 + 2026-05-11 series) plus high-frequency claudemd-
// domain prose words. Keep this list focused — false-positives in the detector
// itself (flagging fine tags) are worse than misses.
const GENERIC_WORDLIST = new Set([
  // Observed FPs in §11 ship-time enforcement chain:
  //   v0.9.27/28 family: cli (⊂clippy), hook (⊂hooks/hooked declension).
  //   2026-05-11 1B ship: semantic (⊂"fail-open semantics").
  //   2026-05-11 cutover-split ship: design (⊂"by-design housekeeping" /
  //     "by design"). brainstorm co-tagged with design in the same memory
  //     entry — equally FP-prone at ship time (any prose mentioning the
  //     design-process word would trigger).
  'cli',
  'hook',
  'semantic',
  'impact',
  'refs',
  'overview',
  'deps',
  'design',
  'brainstorm',
  // High-FP-risk claudemd-domain words (common in release notes / commits /
  // CHANGELOG entries / spec text):
  'fix',
  'bug',
  'push',
  'log',
  'file',
  'audit',
  'review',
  'version',
  'commit',
  'merge',
  'build',
  'deploy',
  'release',
  'config',
  'flag',
  'option',
  'command',
  'script',
  'output',
  'input',
  'message',
  'error',
  'warning',
  'success',
  'result',
  'value',
  'action',
  'name',
  'type',
  'item',
  'list',
  'field',
  'state',
  'event',
  'signal',
  'args',
  'path',
  'data',
  'info',
  'time',
  'code',
  'test',
  'debug',
  'feature',
  'change',
  // Added v0.9.38 from 2026-05-11 dogfood pass — words that appeared
  // multiple times in this session's own release notes / CHANGELOG entries
  // and would FP if used as a tag. `default` is special-risk ("by default"
  // is near-universal in spec prose).
  'architecture',
  'behavior',
  'schema',
  'default',
  'pattern',
  'format',
  'system',
  'process',
]);

// classifyTag(tag) — returns array of reasons. Empty array = tag passes.
// Reasons: 'short-single-word' | 'generic-wordlist'.
export function classifyTag(tag) {
  const reasons = [];
  if (!tag) return reasons;

  // CJK / non-ASCII alpha first byte → pass (narrow by authoring convention).
  if (/[^\p{ASCII}]/u.test(tag)) return reasons;

  // Multi-word (hyphen / underscore / space) → pass.
  if (/[-_ ]/.test(tag)) return reasons;

  const lower = tag.toLowerCase();
  if (NARROW_ALLOWLIST.has(lower)) return reasons;

  if (tag.length <= 5) reasons.push('short-single-word');
  if (GENERIC_WORDLIST.has(lower)) reasons.push('generic-wordlist');

  return reasons;
}

// parseMemoryIndex(content) — parses MEMORY.md text into entries with tags.
// Supports both backtick-wrapped (``[tag, tag]``) and plain (`[tag, tag]`)
// tag-block syntax, mirroring memory-read-check.sh:81-86. Returns array of
// { line, file, tags: [...] }. Lines without a tag block are skipped (those
// are untagged entries — agent-driven full content scan, not hook-managed).
export function parseMemoryIndex(content) {
  const entries = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    // Match: `- [Title](file.md) [tag1, tag2] — desc` OR with backticks.
    // Take the LAST `(...md)` group — the markdown link target sits after the
    // title, and a title may itself embed a `(foo.md)` token. memory-read-check.sh
    // resolves the file with a greedy `s/.*(\(...\.md\)).*/` (last match); using
    // `.match()` (first match) here diverged — doctor/scan would report tag
    // findings against a different file than the hook enforces against.
    const fileMatches = [...line.matchAll(/\(([^)]+\.md)\)/g)];
    if (fileMatches.length === 0) continue;
    const fileMatch = fileMatches[fileMatches.length - 1];
    // Both tag-block forms anchor on `.md)` (greedy prefix = LAST occurrence),
    // mirroring memory-read-check.sh. An unanchored backtick match diverged:
    // a prose line quoting a decorative `[label]` token plus any `(….md)`
    // token (e.g. code-graph-mcp's MEMORY.md blockquote header) parsed as a
    // tagged entry and produced a doctor finding against a non-entry line.
    let tagBlock = line.match(/.*\.md\)\s*`\[([^\]]*)\]`/);
    if (!tagBlock) {
      // Plain form: anchor on `(file.md)` then `[tag, tag]` before `— ` or `- `.
      tagBlock = line.match(/.*\.md\)\s*\[([^\]]*)\]\s*[—-]/);
    }
    if (!tagBlock) continue;
    const tags = tagBlock[1]
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    entries.push({ line, file: fileMatch[1], tags });
  }
  return entries;
}

// v0.35.0 R2 — Tier-2 index soft size budget. MEMORY.md loads into context
// every session of its project; spec §0.1 caps core (25K) / extended (50K)
// but the Tier-2 index had no budget at all — the 2026-07-11 spec audit
// measured this repo's own index at 19788B = 80% of core (51 entries), the
// largest unmanaged per-session attention item. 12KB ≈ 3k tokens is the soft
// ceiling; doctor surfaces overruns, pruning stays the operator's call
// (closed-loop project_* entries first — index edits are §5-scoped writes).
export const MEMORY_INDEX_BUDGET_BYTES = 12 * 1024;

// v0.74.2 — a per-index budget the index itself declares:
//
//     <!-- index-budget: 28KB -->
//
// One default across every project makes this check permanently red wherever
// the operator has JUDGED the overage acceptable, and a permanently-red
// advisory whose remedy the operator has already declined is the shape that
// teaches people to ignore the health checker (the same reasoning that moved
// state-dir-orphans onto its reapable subset in this release).
//
// The declaration lives in the MEMORY.md file rather than the project's
// CLAUDE.md because a project is addressed here only by its ENCODED cwd
// (every non-alphanumeric collapses to `-`), and that encoding is lossy — the
// real project directory cannot be recovered from it to read a knob there.
//
// Three properties keep this from being a mute button:
//   - the resolved budget and whether it was declared are returned, and doctor
//     prints both, so raising it is visible in the same line that goes green;
//   - a malformed declaration is an ERROR, never a silent fall back to the
//     default (lib/argv.js's flag-shape rule: a knob that is quietly ignored
//     is worse than one that refuses);
//   - the value is capped at INDEX_BUDGET_MAX_MULTIPLE x the default, so the
//     knob cannot be set to a number that switches the check off entirely.
// Lowering below the default is allowed — that direction is stricter.
//
// The LINE match is loose and the VALUE check is strict, deliberately. The
// first draft required the whole line to match one regex, which meant every
// near-miss — `28 KB` with a space before the unit, an uppercase key, trailing
// prose after the `-->` — was treated as ABSENT rather than malformed and fell
// back to the default in silence. `28 KB` is the likeliest typo in this entire
// grammar, and it landed in the one class the design promised did not exist
// (found by the pre-tag review of this release). Anything that looks like an
// attempt now reaches the error branch.
const INDEX_BUDGET_LINE = /^ {0,3}<!--[ \t]*index-budget:[ \t]*(.*?)[ \t]*-->[ \t]*$/im;
// A near-miss that does not even close its comment still has to be reported:
// `<!-- index-budget: 28KB` alone on a line is an attempt, not prose.
const INDEX_BUDGET_ATTEMPT = /^ {0,3}<!--[ \t]*index-budget:[ \t]*(.*)$/im;
export const INDEX_BUDGET_MAX_MULTIPLE = 16;

// Fenced and indented code blocks are stripped before matching. A MEMORY.md
// that DOCUMENTS this syntax — doctor's own remedy line teaches it, so this is
// the expected way for it to appear — puts the marker alone on its own line
// inside a fence, which is exactly the shape the line regex wants. Markdown's
// own rule does the separating: >=4 leading spaces is code (hence ` {0,3}`
// above), and ``` / ~~~ open a fenced region.
function stripCodeBlocks(md) {
  const out = [];
  let fence = null;
  for (const line of md.split('\n')) {
    const open = line.match(/^ {0,3}(```+|~~~+)/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (open) {
      fence = open[1];
      out.push('');
      continue;
    }
    out.push(/^(\t| {4,})/.test(line) ? '' : line);
  }
  return out.join('\n');
}

export function readIndexBudget(content) {
  const body = stripCodeBlocks(content);
  const m = body.match(INDEX_BUDGET_LINE);
  const bad = (token, why) => ({
    bytes: MEMORY_INDEX_BUDGET_BYTES,
    declared: false,
    error: `malformed index-budget declaration '${token}' (${why})`,
  });
  if (!m) {
    // A line that opens the comment and names the key but does not close it is
    // an ATTEMPT, and an attempt must never be honoured — the fallback branch
    // is error-only. An earlier draft ran the value check on it, which would
    // have accepted `<!-- index-budget: 28KB` (no `-->`) as a valid 28KB.
    const attempt = body.match(INDEX_BUDGET_ATTEMPT);
    if (attempt) return bad(attempt[1].trim(), "the comment is not closed with '-->'");
    return { bytes: MEMORY_INDEX_BUDGET_BYTES, declared: false };
  }
  // `KB` is required, not assumed: a bare `28` is ambiguous between bytes and
  // kilobytes, and guessing would silently apply a budget 1024x off.
  const v = m[1].match(/^([0-9]+)KB$/i);
  if (!v || Number(v[1]) <= 0) return bad(m[1], "expected e.g. '28KB'");
  const bytes = Number(v[1]) * 1024;
  const max = MEMORY_INDEX_BUDGET_BYTES * INDEX_BUDGET_MAX_MULTIPLE;
  if (bytes > max) {
    return bad(m[1], `above the ${(max / 1024).toFixed(0)}KB cap — a budget that large disables the check`);
  }
  return { bytes, declared: true };
}

// scanMemoryIndexSizes({rootDir}) — walks the same MEMORY.md set as
// scanMemoryTags and returns per-index byte size + entry count.
//
// Returns: { indexes: [{memDir, bytes, entries}], scannedFiles: N }
//   - entries counts `- [Title](file.md)` bullet lines (the loaded index rows).
export function scanMemoryIndexSizes({ rootDir } = {}) {
  const root = rootDir || projectsRoot();
  const indexes = [];
  let scannedFiles = 0;

  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { indexes, scannedFiles };
  }

  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const memIdx = path.join(root, ent.name, 'memory', 'MEMORY.md');
    let content;
    try {
      content = fs.readFileSync(memIdx, 'utf8');
    } catch {
      continue;
    }
    scannedFiles++;
    const entries = content.split('\n').filter(l => /^- \[/.test(l)).length;
    const budget = readIndexBudget(content);
    indexes.push({
      memDir: path.dirname(memIdx),
      bytes: Buffer.byteLength(content, 'utf8'),
      entries,
      budgetBytes: budget.bytes,
      budgetDeclared: budget.declared,
      budgetError: budget.error,
    });
  }
  indexes.sort((a, b) => b.bytes - a.bytes);
  return { indexes, scannedFiles };
}

// scanMemoryTags({rootDir}) — walks ~/.claude/projects/*/memory/MEMORY.md
// files, applies classifyTag to every parsed tag, returns findings.
//
// Returns: { findings: [{memDir, file, tag, reasons}], scannedFiles: N }
//   - findings: one per generic-tag candidate (an entry with 3 generic tags
//     produces 3 finding rows).
//   - scannedFiles: count of MEMORY.md files actually read (for "no findings,
//     scanned 0 files" vs "no findings, scanned 5 files" disambiguation).
export function scanMemoryTags({ rootDir } = {}) {
  const root = rootDir || projectsRoot();
  const findings = [];
  let scannedFiles = 0;

  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { findings, scannedFiles };
  }

  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const memIdx = path.join(root, ent.name, 'memory', 'MEMORY.md');
    if (!fs.existsSync(memIdx)) continue;
    let content;
    try {
      content = fs.readFileSync(memIdx, 'utf8');
    } catch {
      continue;
    }
    scannedFiles++;
    const memDir = path.dirname(memIdx);
    for (const entry of parseMemoryIndex(content)) {
      for (const tag of entry.tags) {
        const reasons = classifyTag(tag);
        if (reasons.length > 0) {
          findings.push({ memDir, file: entry.file, tag, reasons });
        }
      }
    }
  }
  return { findings, scannedFiles };
}
