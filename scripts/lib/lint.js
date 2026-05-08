// lint.js — pure-Node scanning functions for §10-V banned-vocab patterns.
// Shared by bin/claudemd-lint.js (CLI) and any future Node-side enforcement
// that doesn't want to shell out to bash. Mirrors the substantive matching
// rules of hooks/banned-vocab-check.sh + hooks/transcript-vocab-scan.sh
// without the shell-specific quoting + jq plumbing.
//
// The patterns file is the authoritative source — hooks/banned-vocab.patterns.
// One regex per non-blank, non-comment line. Format:
//   <extended-regex>|<reason>
//   <extended-regex>|@ratio <reason>     ← ratio class, exempt under baseline
//
// JS regex notes:
//   * Patterns were authored for grep -iE (POSIX ERE). Most carry over to
//     JS regex unchanged. `\b` and `[0-9]` are equivalent. POSIX char classes
//     like [[:space:]] are NOT in the .patterns file.
//   * `\s` means whitespace in JS — also fine.
//   * Case-insensitive matching is the contract; we always pass /i flag.
//   * Invalid regex (a future bad pattern checked in by mistake) is skipped
//     silently rather than crashing the scan — fail-open consistent with
//     the bash hooks' design.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PATTERNS_FILE = path.resolve(HERE, '../../hooks/banned-vocab.patterns');

// Returns [{regex: string, reason: string, isRatio: boolean}, ...].
export function readPatterns(patternsFile = DEFAULT_PATTERNS_FILE) {
  if (!fs.existsSync(patternsFile)) return [];
  const lines = fs.readFileSync(patternsFile, 'utf8').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Right-most `|` is the separator: regex bodies can themselves contain `|`
    // (alternation), but reason text doesn't. Same convention banned-vocab-
    // check.sh uses (`${line%|*}` / `${line##*|}`).
    const lastBar = line.lastIndexOf('|');
    if (lastBar === -1) continue;
    const regex = line.slice(0, lastBar);
    let reason = line.slice(lastBar + 1);
    let isRatio = false;
    if (reason.startsWith('@ratio ')) {
      isRatio = true;
      reason = reason.slice('@ratio '.length);
    }
    out.push({ regex, reason, isRatio });
  }
  return out;
}

// scan(text, opts) → [{match, regex, reason, isRatio}, ...]
//   opts.excludeRatio: skip @ratio-tagged patterns. The bash transcript scan
//     does this because chat prose uses ratios with different baseline
//     conventions than commit messages. CLI `lint` defaults to NO exclude
//     (commit-message context is the most common use); CLI `audit` defaults
//     to excludeRatio=true to mirror transcript-vocab-scan.sh behavior.
//   opts.patterns: pre-loaded patterns array (lets callers cache the read).
export function scan(text, { excludeRatio = false, patterns } = {}) {
  if (!text) return [];
  const pats = patterns || readPatterns();
  const hits = [];
  for (const p of pats) {
    if (excludeRatio && p.isRatio) continue;
    let re;
    try {
      re = new RegExp(p.regex, 'i');
    } catch {
      continue; // bad regex — skip (fail-open)
    }
    const m = text.match(re);
    if (m) hits.push({ match: m[0], regex: p.regex, reason: p.reason, isRatio: p.isRatio });
  }
  return hits;
}

// parseTranscript(jsonlText) → [{turnIndex, line, text}, ...]
//   Iterates jsonl, returns one entry per assistant text-content turn. Each
//   entry concatenates all .message.content[*].text blocks for that turn.
//   Corrupt rows (unparseable JSON, missing fields) silently skipped — matches
//   transcript-vocab-scan.sh's `try fromjson catch empty` design.
export function parseTranscript(jsonlText) {
  const lines = jsonlText.split('\n');
  const turns = [];
  let turnIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch { continue; }
    if (row.type !== 'assistant') continue;
    const content = row.message?.content || [];
    const texts = [];
    for (const b of content) {
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    }
    if (texts.length === 0) continue;
    turns.push({ turnIndex, line: i + 1, text: texts.join(' ') });
    turnIndex++;
  }
  return turns;
}

// Format helpers — keep the CLI thin.
export function formatHumanReadable({ scope, hits, turns }) {
  if (scope === 'lint') {
    if (hits.length === 0) return 'OK: no §10-V hits';
    const lines = [`§10-V drift detected (${hits.length} hit${hits.length === 1 ? '' : 's'}):`];
    for (const h of hits) lines.push(`  - "${h.match}"  (${h.reason})`);
    return lines.join('\n');
  }
  if (scope === 'audit') {
    const flagged = turns.filter(t => t.hits.length > 0);
    if (flagged.length === 0) return `OK: no §10-V hits across ${turns.length} assistant turn(s)`;
    const lines = [`§10-V drift detected in ${flagged.length} of ${turns.length} assistant turn(s):`];
    for (const t of flagged) {
      lines.push(`  line ${t.line} (turn #${t.turnIndex}):`);
      for (const h of t.hits) lines.push(`    - "${h.match}"  (${h.reason})`);
    }
    return lines.join('\n');
  }
  return '';
}

export function formatJSON(payload) {
  return JSON.stringify(payload, null, 2);
}
