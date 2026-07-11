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
//     like [[:space:]] ARE used (they're BSD-grep-safe; `\s` is not) and are
//     translated to JS equivalents by posixClassesToJs() in scan() below.
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
// Translate the POSIX bracket classes the patterns file uses (grep -E canonical)
// into their JS-regex equivalents. The .patterns file is authored for grep -iE
// and MUST stay BSD-grep-safe: `\s`/`\d`/`\w` are GNU-grep extensions that BSD
// (macOS) grep treats as literal letters, so the file uses `[[:space:]]` etc.
// But JS regex has no POSIX classes — `[[:space:]]` there is a char class of
// `[`,`:`,`s`,`p`,`a`,`c`,`e` — so the CLI/JS scan would silently mis-match
// without this translation. `\b` is universal (BSD grep + JS both support it).
const POSIX_TO_JS = [
  [/\[\[:space:\]\]/g, '\\s'],
  [/\[\[:digit:\]\]/g, '\\d'],
  [/\[\[:alnum:\]\]/g, 'A-Za-z0-9'],   // typically already inside a [...]
  [/\[\[:alpha:\]\]/g, 'A-Za-z'],
  [/\[\[:upper:\]\]/g, 'A-Z'],
  [/\[\[:lower:\]\]/g, 'a-z'],
];
function posixClassesToJs(regex) {
  let out = regex;
  for (const [re, repl] of POSIX_TO_JS) out = out.replace(re, repl);
  return out;
}

// stripIdentifiers — remove code / identifier / path regions before §10-V
// matching so a filename, branch, or backtick span quoting a high-fire word is
// not read as a value claim. `\b` treats '-', '/', '.' as word boundaries, so
// `\bcomprehensive\b` fires INSIDE `comprehensive-parser.js` or a branch name
// `docs/comprehensive-audit`. Mirrors hooks/banned-vocab-check.sh's v0.23.19
// Path 2 sanitizer (fenced blocks → inline backtick spans → slashed-path runs)
// and adds a bare dotted-file token strip, because the CLI's primary input —
// commit messages — commonly names bare files (`refactor comprehensive-parser.js`)
// without backticks or a leading path. Token classes are ASCII-only so 中文
// prose and bare-word claims (the real violations) stay intact and still match.
export function stripIdentifiers(text) {
  if (!text) return text;
  // 1. Fenced code blocks: line-based fence toggle, mirroring the bash awk
  //    `/^[[:space:]]*```/{f=!f; next} !f` — drop the ``` marker lines AND the
  //    body between them. An unterminated fence drops to EOF (in_fence stays on).
  const kept = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (!inFence) kept.push(line);
  }
  return kept.join('\n')
    // 2. Inline backtick spans.
    .replace(/`[^`]*`/g, ' ')
    // 3. Slashed-path runs (branch names, file paths, URLs) — Path 2's rule.
    .replace(/[A-Za-z0-9._@~-]*\/[A-Za-z0-9._/@~-]*/g, ' ')
    // 4. Bare dotted-file tokens (foo.js, comprehensive-parser.ts) — CLI
    //    extension. The extension must start with a LOWERCASE letter, which
    //    (a) excludes decimals / versions ("3.5x", "v6.14") whose ".5x"/".14"
    //    could otherwise swallow a baseline-less ratio claim → false negative,
    //    and (b) excludes sentence-boundary typos ("comprehensive.Next", capital
    //    after the dot) so a real claim isn't stripped. Only true `name.ext`
    //    identifiers with a lowercase extension are removed.
    .replace(/[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/g, ' ');
}

export function scan(text, { excludeRatio = false, patterns, sanitize = false } = {}) {
  if (!text) return [];
  // Sanitize identifier/path regions when asked (CLI lint/audit opt in). Match
  // against the stripped text; the caller keeps the original for display.
  const scanText = sanitize ? stripIdentifiers(text) : text;
  const pats = patterns || readPatterns();
  const hits = [];
  for (const p of pats) {
    if (excludeRatio && p.isRatio) continue;
    let re;
    try {
      re = new RegExp(posixClassesToJs(p.regex), 'i');
    } catch {
      continue; // bad regex — skip (fail-open)
    }
    const m = scanText.match(re);
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

// countStringContentAssistantRows(jsonlText) → number
//   QA ISSUE-002: an assistant row whose .message.content is a STRING (not the
//   CC block array) is outside parseTranscript's input domain — the for..of
//   over a string yields characters, texts stays empty, and the row is
//   silently skipped, so its text is never scanned. Real CC transcripts
//   always use block arrays for assistant turns (only typed user prompts are
//   string-shape), but the CLI is documented for other-agent exports too.
//   The CLI uses this count to surface the skip on stderr (verdict unchanged)
//   — same silent-success family as the v0.9.14 / v0.9.21 guards.
export function countStringContentAssistantRows(jsonlText) {
  let count = 0;
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.type !== 'assistant') continue;
    const content = row.message?.content;
    if (typeof content === 'string' && content.trim().length > 0) count++;
  }
  return count;
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
