import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  'cwd', 'npx', 'jq', 'gh', 'ci', 'ssh', 'tls', 'dns', 'pid', 'tdd', 'bdd',
  'ast', 'css', 'html', 'json', 'sql', 'yaml', 'env', 'api', 'dom', 'url',
  'pgo', 'gpu', 'cpu',
  // Sub-class 2: hook trigger verbs (memory-read-check.sh TRIGGER_RE).
  // Tags matching these are intentional triggers, not FP candidates.
  'release', 'push', 'ship', 'deploy', 'publish', 'merge', 'commit', 'build',
  // Sub-class 3: OS / runtime narrow terms (claudemd-domain specific).
  'macos', 'linux', 'ubuntu', 'darwin', 'node', 'python', 'rust', 'go',
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
  'cli', 'hook', 'semantic', 'impact', 'refs', 'overview', 'deps',
  'design', 'brainstorm',
  // High-FP-risk claudemd-domain words (common in release notes / commits /
  // CHANGELOG entries / spec text):
  'fix', 'bug', 'push', 'log', 'file', 'audit', 'review', 'version',
  'commit', 'merge', 'build', 'deploy', 'release', 'config', 'flag',
  'option', 'command', 'script', 'output', 'input', 'message', 'error',
  'warning', 'success', 'result', 'value', 'action', 'name', 'type',
  'item', 'list', 'field', 'state', 'event', 'signal', 'args', 'path',
  'data', 'info', 'time', 'code', 'test', 'debug', 'feature', 'change',
  // Added v0.9.38 from 2026-05-11 dogfood pass — words that appeared
  // multiple times in this session's own release notes / CHANGELOG entries
  // and would FP if used as a tag. `default` is special-risk ("by default"
  // is near-universal in spec prose).
  'architecture', 'behavior', 'schema', 'default', 'pattern', 'format',
  'system', 'process',
]);

// classifyTag(tag) — returns array of reasons. Empty array = tag passes.
// Reasons: 'short-single-word' | 'generic-wordlist'.
export function classifyTag(tag) {
  const reasons = [];
  if (!tag) return reasons;

  // CJK / non-ASCII alpha first byte → pass (narrow by authoring convention).
  if (/[^\x00-\x7F]/.test(tag)) return reasons;

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
    const fileMatch = line.match(/\(([^)]+\.md)\)/);
    if (!fileMatch) continue;
    let tagBlock = line.match(/`\[([^\]]*)\]`/);
    if (!tagBlock) {
      // Plain form: anchor on `(file.md)` then `[tag, tag]` before `— ` or `- `.
      tagBlock = line.match(/\.md\)\s*\[([^\]]*)\]\s*[—-]/);
    }
    if (!tagBlock) continue;
    const tags = tagBlock[1].split(',').map(t => t.trim()).filter(Boolean);
    entries.push({ line, file: fileMatch[1], tags });
  }
  return entries;
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
  const root = rootDir || path.join(os.homedir(), '.claude', 'projects');
  const findings = [];
  let scannedFiles = 0;

  let projects = [];
  try { projects = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return { findings, scannedFiles }; }

  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const memIdx = path.join(root, ent.name, 'memory', 'MEMORY.md');
    if (!fs.existsSync(memIdx)) continue;
    let content;
    try { content = fs.readFileSync(memIdx, 'utf8'); }
    catch { continue; }
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
