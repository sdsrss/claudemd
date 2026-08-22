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
  // 1. Fenced code blocks: line-based fence toggle with a TERMINATOR GUARD
  //    (2026-07-25 audit): an opening ``` only starts a fence if a closing
  //    fence line exists later — otherwise it is literal text and everything
  //    after it stays scannable. Pre-fix an unterminated fence blanked to EOF,
  //    silently under-counting relative to the live hook: the bash side
  //    (transcript-vocab-scan.sh) flattens newlines during jq extraction, so
  //    its fence-awk never fires and an unterminated-fence claim HITs there —
  //    node=miss/bash=hit was the one divergence a 12-shape differential
  //    found. Same strict-AND-narrowing shape as the §8 heredoc terminator
  //    guard: blanked text is a subset of before, so this can only EXPOSE
  //    more text to the detector, never hide a claim.
  const lines = text.split('\n');
  const isFence = (l) => /^\s*```/.test(l);
  // "Is there a closing fence after i?" — precomputed once. The direct
  // `lines.slice(i + 1).some(isFence)` spelling allocates the entire tail array
  // on every fence line even though `.some` short-circuits, which is O(lines²):
  // measured 10k lines → 6ms but 40k → 397ms (4× the input, 63× the time).
  // `lastFence > i` is the same predicate — the max index of a fence line is
  // after i iff any fence line is after i — in O(1) after one O(lines) pass.
  let lastFence = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isFence(lines[i])) { lastFence = i; break; }
  }
  const kept = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      if (inFence) { inFence = false; continue; }
      if (lastFence > i) { inFence = true; continue; }
      kept.push(line);
      continue;
    }
    if (!inFence) kept.push(line);
  }
  const stripped = kept.join('\n')
    // 2. Inline backtick spans.
    .replace(/`[^`]*`/g, ' ')
    // 3. Slashed-path runs (branch names, file paths, URLs) — Path 2's rule.
    //    A 2026-07-26 audit item claimed this blanked `12/12` / `2/3` and that
    //    splitting the alternation would preserve them. Measured: alternative 1
    //    matches `12/12` in full either way, so the split changed only
    //    whitespace-on-both-sides (`and / or`) — and no shipped ratio pattern
    //    matches an N/M shape at all (they are `N% faster` / `Nx faster` and the
    //    中文 equivalents). The premise did not hold; reverted rather than ship a
    //    2x cost on long class-character runs for a fix that was not one.
    //
    //    The leading lookbehind is a COMPLEXITY guard, not a semantic one.
    //    This clause is a `<class-run><required-delimiter>` shape and `/` is
    //    not in the leading class, so a shorter prefix of the run is always
    //    followed by another class char and can never satisfy the delimiter:
    //    backtracking inside the run never finds a match the maximal run
    //    missed. An unanchored /g regex still retries from every offset INSIDE
    //    the run and rescans it each time — O(run²). Measured pre-fix on
    //    delimiter-free input: 4k→6ms, 8k→24ms, 16k→94ms, 32k→376ms,
    //    64k→1495ms (a clean 4× per doubling), and `lint --file` on a 500KB
    //    single-token blob ran past a 30s timeout. Rejecting non-run-start
    //    offsets in O(1) makes the pass linear (200k class-run: 51474ms →
    //    2.5ms) with byte-identical output.
    //
    //    Equivalence here rests on a second property that clause 4 does NOT
    //    share: this clause's trailing class is a SUPERSET of its leading one,
    //    so a match always ends outside a leading-class run and the next
    //    candidate start is never mid-run. Measured, not assumed —
    //    sanitize-anchor-equivalence.test.js diffs both spellings over a seeded
    //    corpus (it is what caught the clause-4 case below).
    //
    //    The bash engines need no equivalent: POSIX sed does not backtrack and
    //    the hook caps its input at `tail -c 4096`; the Node path caps nothing.
    .replace(/(?<![A-Za-z0-9._@~-])[A-Za-z0-9._@~-]*\/[A-Za-z0-9._/@~-]*/g, ' ')
    // 4. Bare dotted-file tokens (foo.js, comprehensive-parser.ts) — CLI
    //    extension. The extension must start with a LOWERCASE letter, which
    //    (a) excludes decimals / versions ("3.5x", "v6.14") whose ".5x"/".14"
    //    could otherwise swallow a baseline-less ratio claim → false negative,
    //    and (b) excludes sentence-boundary typos ("comprehensive.Next", capital
    //    after the dot) so a real claim isn't stripped. Only true `name.ext`
    //    identifiers with a lowercase extension are removed.
    //
    //    Clause 4 canNOT use clause 3's lookbehind: its trailing class
    //    `[a-z0-9]` is a strict SUBSET of the leading run class, so a match can
    //    end in the MIDDLE of a run (`_a9Zaz.a|Z9Z_.a` — the ext stops at the
    //    uppercase Z) and the next legitimate match then starts at a position
    //    whose predecessor IS a run char. A lookbehind drops that match and
    //    leaves the identifier unstripped — more text exposed to the detector,
    //    i.e. the FP deny-loop returning. Clause 3 is immune because its
    //    trailing class is a SUPERSET of its leading one, so a match always
    //    ends outside a leading-class run; that equivalence is measured, not
    //    assumed, in sanitize-anchor-equivalence.test.js.
    //
    //    So clause 4 runs as an explicit single-pass scan instead — same
    //    semantics, O(n) instead of O(run²).
    ;
  return stripDottedFileTokens(stripped);
}

// Linear-time equivalent of /[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/g → ' '.
//
// Every start offset inside one run shares the same greedy run END, so the
// regex's per-offset retry recomputes an answer that cannot differ — that is
// the O(run²) in the global form. Walking runs once reproduces the /g contract
// exactly, including the mid-run restart above: after a match the scan resumes
// at the match end, which becomes the next candidate start even though its
// predecessor is a run char.
const isRunChar = (c) =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
  c === '_' || c === '-';
const isExtChar = (c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');

export function stripDottedFileTokens(text) {
  if (!text) return text;
  const n = text.length;
  let out = '';
  let copied = 0;
  let i = 0;
  while (i < n) {
    if (!isRunChar(text[i])) { i++; continue; }
    const start = i;
    let e = i;
    while (e < n && isRunChar(text[e])) e++;
    // Need `.` then a LOWERCASE letter — the extension guard that keeps
    // decimals/versions ("3.5x", "v6.14") and sentence boundaries intact.
    if (e < n && text[e] === '.' && e + 1 < n && text[e + 1] >= 'a' && text[e + 1] <= 'z') {
      let end = e + 2;
      while (end < n && isExtChar(text[end])) end++;
      out += text.slice(copied, start) + ' ';
      copied = end;
      i = end;
      continue;
    }
    i = e;
  }
  return out + text.slice(copied);
}

// Git message files whose raw on-disk contents are NOT the stored commit
// message. A `commit-msg` hook is handed the file BEFORE git's cleanup pass,
// so it still carries the `#` template/status block and — under `git commit -v`
// — the entire staged diff below the scissors line. Verified against git 2.43.0:
// a 26-line COMMIT_EDITMSG stored a 1-line message.
const GIT_MSG_FILENAMES = new Set([
  'COMMIT_EDITMSG',
  'MERGE_MSG',
  'SQUASH_MSG',
  'TAG_EDITMSG',
  'NOTES_EDITMSG',
]);

// Filename-scoped on purpose, never content-sniffed: a heuristic that stripped
// `#` lines from any file would silently mute markdown headings in
// `lint --file notes.md` — trading a false positive for a false negative.
export function looksLikeGitMessageFile(filePath) {
  if (!filePath) return false;
  return GIT_MSG_FILENAMES.has(path.basename(filePath));
}

// Reproduce git's own cleanup so the CLI's verdict matches the message git
// will actually store (builtin/commit.c): truncate at the cut line when one is
// present, then drop comment-prefixed lines (strbuf_stripspace).
//
// Three fidelity details, each of which a looser implementation gets wrong in
// the false-NEGATIVE direction — i.e. it would silently mute a real violation:
//
//   • git matches the comment prefix at column 0 with no leading-whitespace
//     tolerance, so `  # note` survives into the stored message and must stay
//     scannable.
//
//   • The cut line is an EXACT literal in git (`wt_status_locate_end` strcmps
//     against comment-char + space + 24 dashes + ` >8 ` + 24 dashes), and git
//     truncates there only under `-v` / `cleanup=scissors`. A loose
//     `-{2,}`-style pattern let a hand-typed `# -- >8 --` drop the whole rest
//     of the message from the scan. The dash count is ranged (20+) rather than
//     pinned at 24 to tolerate other git versions, but the ` >8 ` framing and
//     the leading `<c> ` are required.
//
//   • **Comment stripping is conditional on a git-authored template being
//     present.** git only strips `#` lines under cleanup=strip/scissors, which
//     is the EDITOR path; under `-m` / `-F` / `--cleanup=whitespace|verbatim`
//     the mode is `whitespace` and column-0 `#` lines are KEPT in the commit.
//     Measured on git 2.43.0 (six shapes, per lint-commit-msg.test.js): the
//     three user-supplied-message shapes all stored their `#` line, while both
//     editor shapes stored none. Stripping unconditionally therefore muted a
//     real violation in `git commit -F release-notes.md` or
//     `-m "$(cat notes.md)"` whenever the body carried a markdown heading.
export function stripGitCommitComments(text, commentChar = '#', { templateLines } = {}) {
  if (!text) return text;
  const c = (typeof commentChar === 'string' && commentChar.length === 1) ? commentChar : '#';
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cutLine = new RegExp(`^${esc} -{20,} >8 -{20,}\\s*$`);

  // 1. Truncate at git's cut line (also a definitive template signal).
  const all = text.split('\n');
  const cutAt = all.findIndex(l => cutLine.test(l));
  const lines = cutAt === -1 ? all : all.slice(0, cutAt);
  const sawCutLine = cutAt !== -1;

  // 2. Drop lines git copied verbatim out of `commit.template`. This is an
  //    exact match against the template file's own comment lines, not a shape
  //    heuristic: git knows they are template lines because it copied them, and
  //    it discards them under the editor path's cleanup=strip. Author-typed
  //    comment lines are absent from the template and stay in scope (P1-3).
  const fromTemplate = templateComments(templateLines, c);
  const body = fromTemplate.size
    ? lines.filter(l => !(l.startsWith(c) && fromTemplate.has(l)))
    : lines;

  // 3. Strip the remaining comment lines only when git wrote a status block or
  //    a cut line here.
  if (!sawCutLine && !hasGitTemplate(body, c)) return body.join('\n');
  return body.filter(l => !l.startsWith(c)).join('\n');
}

// The comment lines of a resolved `commit.template`, as an exact-match set.
// Non-comment template lines are deliberately excluded: git KEEPS those in the
// stored message, so they are the author's text and must stay scannable.
function templateComments(templateLines, c) {
  const set = new Set();
  if (!templateLines) return set;
  const arr = Array.isArray(templateLines) ? templateLines : String(templateLines).split('\n');
  for (const l of arr) if (typeof l === 'string' && l.startsWith(c)) set.add(l);
  return set;
}

// Locale-proof template detection. The signal is structural — git localizes the
// LABELS ("Changes to be committed", "Please enter the commit message…") but
// never the `<commentChar>`+TAB status prefix that introduces each file it
// lists. (The cut line is the other signal, handled by the caller.)
//
// Deliberately conservative: when it does not fire we scan MORE text, so a
// misdetection costs a false positive (visible, bypassable) rather than a
// silent miss.
//
// A second signal used to live here — "≥3 contiguous comment lines ending at
// EOF" — meant to catch git's intro paragraph. Removed (audit-2026-08-22 P1-3)
// because of what it reached in the other direction: a `git commit -F notes.md`
// body (cleanup=whitespace — git KEEPS those lines) ending in three `#` lines
// had them stripped before the scan, muting any §10-V violation inside. Same
// violation at 2 trailing `#` lines denied, at 3 it exited 0 — a silent miss
// that grew MORE likely the longer the commented block got, on the shipped
// pre-commit/CI entry point.
//
// That removal was shipped with the claim that no git shape needs the signal.
// The 0.68.3 pre-tag review refuted it: the six-shape table measured
// `commit.status=false` with no `commit.template` configured. Configure one and
// git hands the hook a buffer of pure template comment lines — no `#\t`, no cut
// line — and discards every one of them. The replacement is not a third shape
// heuristic but the template's actual content, matched line-for-line; see
// `templateComments` and the `templateLines` option on the caller above.
// The `--allow-empty`-on-a-clean-tree shape (git status prose, no `#\t`,
// no cut line) is still scanned and is NOT covered here — stating it rather
// than implying the set is closed, which is the error this comment shipped.
function hasGitTemplate(lines, c) {
  // git's status file list: `#\tmodified:   path`
  return lines.some(l => l.startsWith(c + '\t'));
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
