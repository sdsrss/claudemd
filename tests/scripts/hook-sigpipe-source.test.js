import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every hook runs under `set -o pipefail`. In `if echo "$x" | grep -q RE` the
// reader exits at its first match; if the writer still has lines to write it
// dies of SIGPIPE, the pipeline returns 141, and the `if` reads a match as no
// match. bash line-buffers stdout, so any line after the matching one can lose
// that race, and past two 64 KiB pipe buffers after it the match is lost every
// time (E4 in docs/S8-RESIDUALS.md; the §8 gate's deny side was fixed in
// 0.107.6, the other hooks' in 0.107.7). The fix is `grep -q RE < <(echo "$x")`:
// the writer can still die, but only grep's status reaches the condition.
//
// The rule this file holds, for hooks/*.sh and hooks/lib/*.sh: a pipeline into
// a reader that can exit before EOF may decide a condition only where a lost
// match can only make the hook stricter (deny, warn or record more). Every
// such pipeline left in the tree is listed in KEPT below with that reason, or
// with the open item that defers it; anything else fails.
//
// The 0.107.6 check this replaces matched one spelling, line by line, in one
// file. Counting sites with it for D#277 missed the two pattern scans in
// banned-vocab-check.sh that decide its denies, because they read through the
// hook_vocab_grep wrapper. What this recognizer sees:
//   • every top-level `|` or `|&` (not `||`) on a line followed by `head`,
//     `read`, or any command whose name contains `grep` (wrappers included)
//     carrying -q/-m/-l/-L or their long forms anywhere in its words;
//   • through `{`, `(`, `!`, redirections, assignments, and the wrappers
//     command, builtin, exec, nohup, env, stdbuf, nice, timeout, gtimeout;
//   • pipelines split across lines (`|`, `||`, `&&` or `\` at line end), and
//     '…', $'…' (backslash escapes the quote), "…", ${…}, $(…) and here-docs.
// What it does not see, by construction: readers inside `$( )`, `<( )` or
// backticks (their status reaches a condition only through an assignment such
// as `if x=$(a | grep -m1 b)`; 0 of those in hooks/ when this was written),
// `sed …q` and `awk …exit` (their scripts sit in quotes, which are blanked), a
// reader whose name does not say so (a function wrapping head under another
// name, a name built from a variable), and a subshell written `(a|head)` at the
// start of a line (read as a case arm's pattern list). Where its quote state
// goes wrong it fails instead of reading on: a line that is exactly fi, done or
// esac inside a quote, or a here-doc with no delimiter, is reported.

const KEPT = [
  // hooks/pre-bash-safety-check.sh — the eight E4 kept in 0.107.6.
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `if echo "$CMD" | grep -qF '[allow-rm-rf-var]'; then`,
    why: 'escape token: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `echo "$CMD" | grep -qF '[allow-npx-unpinned]' && _npx_bypass_cmd=1`,
    why: 'escape token: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `if echo "$CMD" | grep -qF '[allow-npx-unpinned]'; then`,
    why: 'escape token: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `if echo "$CMD" | grep -qF '[allow-curl-sh]'; then bypass_curlsh=1; fi`,
    why: 'escape token: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `-(i?name|i?path|i?regex|`,
    why: 'bounded find: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `printf '%s' "$prov_prefix" | grep -qE`,
    why: 'mktemp provenance: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `printf '%s' "$prov_rhs" | grep -qE`,
    why: 'mktemp provenance: a lost match denies',
  },
  {
    file: 'hooks/pre-bash-safety-check.sh',
    has: `echo "$SANITIZED_CMD_FLAT" | grep -qE "$guard_re"`,
    why: '${VAR:?} guard: a lost match denies',
  },
  // hooks/banned-vocab-check.sh
  {
    file: 'hooks/banned-vocab-check.sh',
    has: `if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then`,
    why: 'escape token: a lost match denies',
  },
  {
    file: 'hooks/banned-vocab-check.sh',
    has: `if echo "$MSG_TEXT" | grep -qE '[0-9][^[:space:]]*[[:space:]]*(→|->|=>)`,
    why: 'baseline exemption: a lost match keeps the ratio patterns',
  },
  {
    file: 'hooks/banned-vocab-check.sh',
    has: `elif echo "$MSG_TEXT" | grep -qiE 'baseline'; then`,
    why: 'baseline exemption: a lost match keeps the ratio patterns',
  },
  // hooks/ship-baseline-check.sh
  {
    file: 'hooks/ship-baseline-check.sh',
    has: `echo "$PUSH_SEG" | grep -qE '(^|[[:space:]])(-h|--help)([[:space:]]|$)' && exit 0`,
    why: 'help exemption: a lost match checks CI',
  },
  {
    file: 'hooks/ship-baseline-check.sh',
    has: `if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then`,
    why: 'known-red marker: a lost match checks CI',
  },
  {
    file: 'hooks/ship-baseline-check.sh',
    has: `if printf '%s' "$CMD" | grep -qi 'known-red baseline:'; then`,
    why: 'known-red marker: a lost match checks CI',
  },
  // hooks/transcript-structure-scan.sh — opt-in advisory; every lost match adds a hit.
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `if printf '%s' "$block" | grep -qE`,
    why: 'evidence fingerprint: a lost match flags the Done block',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `echo "$first_line" | grep -qE '^Done:`,
    why: 'empty-Done skip: a lost match flags it',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `echo "$line" | grep -qE '^##[[:space:]]+Uncertain[[:space:]]*$' && continue`,
    why: 'header skip: a lost match flags it',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `echo "$norm" | grep -qE '^Uncertain[[:space:]]*[:—-]`,
    why: 'explicit-none skip: a lost match flags it',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `echo "$norm" | grep -qiE '\\b(because|since|due to|owing to)\\b`,
    why: 'rationale skip: a lost match flags it',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `echo "$norm" | grep -qE '^Uncertain[[:space:]]*$' && continue`,
    why: 'bare-header skip: a lost match flags it',
  },
  {
    file: 'hooks/transcript-structure-scan.sh',
    has: `if ! printf '%s' "$SECTION_LIST" | grep -qFx -- "$section"; then`,
    why: 'section dedup: a lost match lists a section twice',
  },
  // hooks/verify-log.sh (EVIDENCE_WTREE=1, opt-in)
  {
    file: 'hooks/verify-log.sh',
    has: `printf '%s' "$OUT" | grep -Eq "$T2_OUT_RE" && TIER=T2-output`,
    why: 'a lost match records no run, so evidence-gate warns more',
  },
  // Deferred, not kept: a lost match here suppresses an evidence-gate advisory.
  // evidence-gate.sh is in the file list both PREREGs check for a zero diff
  // until their windows end (~2026-10-26); verify-log feeds the same verdict.
  {
    file: 'hooks/verify-log.sh',
    has: `printf '%s\\n%s' "$OUT" "$ERR" | grep -Eq "$FAIL_OUT_RE" && exit 0`,
    why: 'DEFERRED D#288: a lost match records a failed run as a pass',
  },
  {
    file: 'hooks/evidence-gate.sh',
    has: `if ! printf '%s' "$LAST_MSG" | grep -Eq "$DONE_RE"; then`,
    why: 'DEFERRED D#288: a lost match can skip the Done check',
  },
  {
    file: 'hooks/evidence-gate.sh',
    has: `printf '%s' "$LAST_MSG" | LC_ALL=C grep -Eq "$DONE_TAIL_RE" || exit 0`,
    why: 'DEFERRED D#288: a lost match skips the Done check',
  },
  {
    file: 'hooks/evidence-gate.sh',
    has: `printf '%s' "$LAST_MSG" | LC_ALL=C grep -Eq "$DONE_NEG_RE" && exit 0`,
    why: 'negated-claim veto: a lost match warns',
  },
];

// --- recognizer ---------------------------------------------------------------

// Reads shell text the way the parser splits it, enough for this check: what
// the shell sees at the top level (quoted text, ${…}, $(…), <(…), >(…) and
// backtick bodies blanked, comments dropped, newlines as spaces), whether a
// quote or substitution is still open at the end, and the here-doc delimiters
// opened outside quotes, in order.
function scan(s) {
  let out = '';
  const stack = [];
  const heredocs = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const top = stack[stack.length - 1];
    if (top === 'sq') {
      if (c === "'") stack.pop();
      continue;
    }
    // $'…': unlike '…', a backslash escapes the next character, `\'` included.
    // Read as '…', `$'a\'s'` closed early and its last quote stayed open for 20
    // lines of pre-bash-safety-check.sh (0.107.7 pre-tag review, M1).
    if (top === 'ansi') {
      if (c === '\\') i++;
      else if (c === "'") stack.pop();
      continue;
    }
    if (c === '\\') {
      if (!top) out += '__';
      i++;
      continue;
    }
    if (top === 'dq') {
      if (c === '"') stack.pop();
      else if (c === '$' && (s[i + 1] === '(' || s[i + 1] === '{')) stack.push(s[++i] === '(' ? 'sub' : 'br');
      else if (c === '`') stack.push('bt');
      continue;
    }
    if (top === 'bt') {
      if (c === '`') stack.pop();
      continue;
    }
    if (top === 'br') {
      // Only `${` nests here: the `{` in `${x#[({]}` is a bracket-expression
      // character, and counting it left the expansion open for 11 KB.
      if (c === '}') stack.pop();
      else if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) stack.push(s[++i] === '{' ? 'br' : 'sub');
      continue;
    }
    // At the top level, or inside $( ) / <( ) / >( ).
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) {
      const nl = s.indexOf('\n', i);
      if (nl < 0) break;
      i = nl - 1;
      continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<' && s[i - 1] !== '<') {
      const m = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(s.slice(i));
      if (m) {
        heredocs.push({ dash: m[1] === '-', tag: m[3] });
        if (!top) out += `<<${m[3]}`;
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '$' && s[i + 1] === "'") {
      if (!top) out += "''";
      stack.push('ansi');
      i++;
    } else if (c === "'") {
      if (!top) out += "''";
      stack.push('sq');
    } else if (c === '"') {
      if (!top) out += '""';
      stack.push('dq');
    } else if (c === '`') {
      if (!top) out += '``';
      stack.push('bt');
    } else if (c === '$' && s[i + 1] === '{') {
      if (!top) out += '${}';
      stack.push('br');
      i++;
    } else if ((c === '$' || c === '<' || c === '>') && s[i + 1] === '(') {
      if (!top) out += `${c}()`;
      stack.push('sub');
      i++;
    } else if (top === 'sub' && c === '(') {
      stack.push('sub');
    } else if (top === 'sub' && c === ')') {
      stack.pop();
    } else if (!top) {
      out += c === '\n' ? ' ' : c;
    }
  }
  return {
    top: out,
    open: stack.length > 0,
    inQuote: ['sq', 'dq', 'ansi', 'bt'].includes(stack[stack.length - 1]),
    heredocs,
  };
}

// Physical lines -> logical lines {line, text, top}. A logical line runs on
// while a quote or substitution is open, after a trailing `\`, and after a
// trailing `|`, `||` or `&&`. Here-doc bodies are skipped as each delimiter is
// opened, before the next physical line is read, so prose in a body cannot
// open a quote; a delimiter that never comes is reported, not skipped to EOF.
// Comment lines between logical lines are dropped.
function logicalLines(src) {
  const raw = src.split('\n');
  const out = [];
  const unterminated = [];
  const swallowed = [];
  let inQuote = false;
  let buf = null;
  let start = 0;
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (buf === null) {
      if (/^\s*#/.test(l) || l.trim() === '') continue;
      buf = l;
      start = i + 1;
      seen = 0;
    } else {
      // A line that is exactly fi / done / esac inside a quote is shell, not
      // text: the quote state was lost somewhere above. Reported, not read past.
      if (inQuote && /^\s*(fi|done|esac)\s*$/.test(l)) swallowed.push({ line: i + 1, text: l.trim() });
      buf += `\n${l}`;
    }
    const r = scan(buf);
    inQuote = r.inQuote;
    for (const hd of r.heredocs.slice(seen)) {
      const opened = i + 1;
      while (i + 1 < raw.length && (hd.dash ? raw[i + 1].replace(/^\t+/, '') : raw[i + 1]) !== hd.tag) i++;
      if (i + 1 >= raw.length) unterminated.push({ line: opened, tag: hd.tag });
      i++;
    }
    seen = r.heredocs.length;
    const backslashes = (l.match(/\\+$/) || [''])[0].length;
    if (r.open || backslashes % 2 === 1 || /(\||&&)\s*$/.test(r.top)) continue;
    inQuote = false;
    out.push({ line: start, text: buf.replace(/\\\n/g, ' ').replace(/\n/g, ' ').trim(), top: r.top });
    buf = null;
  }
  if (buf !== null) out.push({ line: start, text: buf.trim(), top: scan(buf).top });
  return { lines: out, unterminated, swallowed };
}

const QUIET_LONG = /^--(quiet|silent|max-count|files-with-matches|files-without-match)\b/;

// Words that can stand before the reader in a pipeline element without being
// it: `{`, `(`, `!`, a redirection, assignments, and wrappers that run their
// arguments as the command (timeout's duration and options are skipped too).
const PASS_THROUGH = new Set(['{', '(', '!', 'command', 'builtin', 'exec', 'nohup']);

function earlyReader(words) {
  let k = 0;
  for (;;) {
    const w = words[k];
    if (w === undefined) return false;
    if (PASS_THROUGH.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || /^\d*[<>]/.test(w)) k++;
    else if (w === 'env' || w === 'stdbuf' || w === 'nice') {
      k++;
      while (/^-/.test(words[k] || '')) k += words[k] === '-n' || words[k] === '-u' ? 2 : 1;
    } else if (w === 'timeout' || w === 'gtimeout') {
      k++;
      while (/^-/.test(words[k] || '')) k += /^(-s|-k|--signal|--kill-after)$/.test(words[k]) ? 2 : 1;
      k++;
    } else break;
  }
  const name = words[k];
  if (name === 'head' || name === 'read') return true;
  if (!/grep/.test(name)) return false;
  return words.slice(k + 1).some(w => /^-[A-Za-z0-9]*[qmlL]/.test(w) || QUIET_LONG.test(w));
}

// {sites: [{line, text}] for each top-level pipe into an early-exit reader —
//  every one on a line, so a new pipeline beside a KEPT one makes that entry
//  match twice (0.107.7 pre-tag review, M2) — unterminated: here-docs whose
//  delimiter line never comes, swallowed: shell lines read as quoted text}.
function findSites(src) {
  const sites = [];
  const { lines, unterminated, swallowed } = logicalLines(src);
  for (const { line, text, top: full } of lines) {
    // A case arm's pattern list (`cat|head|tail)`) is not a pipeline. The cost:
    // a subshell `(a|head)` at the start of a line reads as one too.
    const top = full.replace(/^(\s*case\s+\S+\s+in)?\s*\(?[^\s()|;&]+(\|[^\s()|;&]+)*\)/, ' ');
    const re = /(?<![|>])\|(?!\|)/g;
    let m;
    while ((m = re.exec(top)) !== null) {
      const rest = top.slice(m.index + 1).replace(/^&/, '');
      const seg = rest.split(/\|\||&&|\||;|(?<![<>])&|\)/)[0];
      if (earlyReader(seg.trim().split(/\s+/))) sites.push({ line, text });
    }
  }
  return { sites, unterminated, swallowed };
}

const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');

function hookFiles() {
  const dirs = ['', 'lib'];
  return dirs.flatMap(d =>
    fs
      .readdirSync(path.join(HOOKS_DIR, d))
      .filter(f => f.endsWith('.sh'))
      .map(f => path.posix.join('hooks', d, f))
  );
}

// Returns a list of problems; empty means the tree holds the rule.
function checkTree(read) {
  const problems = [];
  const used = new Map(KEPT.map(k => [k, 0]));
  let total = 0;
  for (const rel of hookFiles()) {
    const { sites, unterminated, swallowed } = findSites(read(rel));
    for (const w of swallowed) {
      problems.push(
        `${rel}:${w.line}: \`${w.text}\` sits inside what the recognizer reads as a quote, so it lost the quote state above and the lines between went unread — fix the recognizer`
      );
    }
    for (const u of unterminated) {
      problems.push(
        `${rel}:${u.line}: here-doc ${u.tag} has no delimiter line, so the rest of the file went unread — fix the recognizer`
      );
    }
    for (const s of sites) {
      total++;
      const hits = KEPT.filter(k => k.file === rel && s.text.includes(k.has));
      if (hits.length !== 1) {
        problems.push(
          hits.length === 0
            ? `${rel}:${s.line}: a pipeline into an early-exit reader decides a condition and is not in KEPT — if a lost match can loosen the hook, read from \`< <(…)\` instead: ${s.text.slice(0, 160)}`
            : `${rel}:${s.line}: matches ${hits.length} KEPT entries — make the fingerprints unique: ${s.text.slice(0, 160)}`
        );
      }
      for (const k of hits) used.set(k, used.get(k) + 1);
    }
  }
  for (const [k, n] of used) {
    if (n !== 1)
      problems.push(
        `KEPT entry for ${k.file} matched ${n} site(s), expected 1 — converted or reworded? Update KEPT: ${k.has}`
      );
  }
  return { problems, total };
}

const readReal = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// --- the rule on the real tree ----------------------------------------------

test('every pipeline into an early-exit reader left in hooks/ is listed in KEPT', () => {
  const { problems, total } = checkTree(readReal);
  assert.deepEqual(problems, []);
  assert.equal(total, KEPT.length, `found ${total} sites, KEPT lists ${KEPT.length}`);
});

// --- the recognizer, on shapes written for it --------------------------------

test('recognizer: shapes it must report', () => {
  const must = [
    'if echo "$x" | grep -qE re; then :; fi',
    'if printf \'%s\' "$x" |\n    grep -E -q re; then :; fi',
    'printf \'%s\' "$x" | grep -m1 re && y=1',
    'printf \'%s\' "$x" | grep re -m 1 || exit 0',
    'if echo "$x" | hook_vocab_grep -qiE "$r"; then :; fi',
    'if printf x | head -n1 >/dev/null; then :; fi',
    'echo "$x" | LC_ALL=C grep --quiet re && z=1',
    '! printf \'%s\' "$x" | grep -qFx -- "$s" && a=1',
    'if printf \'%s\' "$x" \\\n  | grep -qE re; then :; fi',
  ];
  for (const src of must)
    assert.equal(findSites(src).sites.length, 1, `not reported: ${JSON.stringify(src)}`);
});

test('recognizer: shapes the 0.107.7 pre-tag review found it missed', () => {
  const must = [
    // M1: in $'…' a backslash escapes the quote.
    "msg=$'it\\'s'\nif true; then\n  echo \"$x\" | grep -q y && exit 0\nfi",
    // L1: braces, a redirection, a wrapper, |& and read before the reader.
    'echo "$x" | { grep -q y; } && exit 0',
    'echo "$x" | 2>/dev/null grep -q y && exit 0',
    'echo "$x" | timeout 1 grep -q y && exit 0',
    'echo "$x" |& grep -q y && exit 0',
    'if echo "$x" | read -r first; then :; fi',
  ];
  for (const src of must)
    assert.equal(findSites(src).sites.length, 1, `not reported: ${JSON.stringify(src)}`);
  // M2: every site on a line counts, not the first.
  assert.equal(findSites('echo "$x" | grep -q a && echo "$y" | grep -q b && z=1').sites.length, 2);
});

test('recognizer: a lost quote state is reported, not read past', () => {
  // bash reads `${x:-"a}b"}` as one expansion; this scanner ends it at the
  // quoted `}` and opens a quote at the second `"`. The fi below is then
  // inside that quote, and must be reported rather than skipped.
  const src = 'y=${x:-"a}b"}\nif true; then\n  echo "$x" | grep -q y && exit 0\nfi\n';
  const { swallowed } = findSites(src);
  assert.deepEqual(
    swallowed.map(w => w.text),
    ['fi'],
    'the tripwire did not fire on a known misread'
  );
});

test('recognizer: shapes it must not report', () => {
  const mustNot = [
    'if grep -qE re < <(printf \'%s\' "$x"); then :; fi',
    'x=$(printf \'%s\' "$x" | grep -oE re | head -n1)',
    'grep -qE \'(a|b)\' "$f" && y=1',
    'a || grep -q x "$f"',
    'case $c in cat|head|tail) ;; esac',
    'done < <(find . -type f | head -n 50)',
    '[[ -z "$(ls -t a | head -n 1)" ]] || continue',
    'msg="list them (`du -sh /x | sort -rh | head`)"',
    'cat <<\'EOF\'\nif echo "$x" | grep -q y; then\nEOF',
    'echo "$x" | grep -oE re',
    'printf \'%s\' "$x" | grep -c re',
  ];
  for (const src of mustNot) assert.deepEqual(findSites(src).sites, [], `reported: ${JSON.stringify(src)}`);
});

// --- mutations of the real tree ----------------------------------------------
// Each rewrite puts back a shape this file exists to catch, or converts a kept
// site without updating KEPT; the check must go red on every one.

function mutated(rel, from, to) {
  const src = readReal(rel);
  assert.equal(src.split(from).length - 1, 1, `mutation anchor not unique in ${rel}: ${from}`);
  return r => (r === rel ? src.replace(from, to) : readReal(r));
}

const MUTATIONS = [
  [
    "a pipeline after a $'…\\'…' string (pre-tag review M1)",
    'hooks/pre-bash-safety-check.sh',
    "    REASONS+=$'\\n  - a fetch/transport command\\'s output is executed by a shell or interpreter — unknown-origin code'\n  fi\n",
    '    REASONS+=$\'\\n  - a fetch/transport command\\\'s output is executed by a shell or interpreter — unknown-origin code\'\n    echo "$CMD" | grep -qE "curl" && exit 0\n  fi\n',
  ],
  [
    'a second pipeline on a line that holds a KEPT site (pre-tag review M2)',
    'hooks/ship-baseline-check.sh',
    `echo "$PUSH_SEG" | grep -qE '(^|[[:space:]])(-h|--help)([[:space:]]|$)' && exit 0\n`,
    `echo "$PUSH_SEG" | grep -qE '(^|[[:space:]])(-h|--help)([[:space:]]|$)' && exit 0; echo "$CMD_FLAT" | grep -qE 'refs/tags' || exit 0\n`,
  ],
  [
    '§8 npx check back on a pipe',
    'hooks/pre-bash-safety-check.sh',
    `if grep -qE "$NPX_CMD_REGEX" < <(printf '%s' "$seg_canon"); then`,
    `if printf '%s' "$seg_canon" | grep -qE "$NPX_CMD_REGEX"; then`,
  ],
  [
    '§8 source/./eval check back on a pipe',
    'hooks/pre-bash-safety-check.sh',
    `&& grep -qE '(^|[[:space:];&|\`(])(source|\\.|eval)[[:space:]]' < <(printf '%s' "$NORMALIZED_CMD"); then`,
    `&& printf '%s' "$NORMALIZED_CMD" | grep -qE '(^|[[:space:];&|\`(])(source|\\.|eval)[[:space:]]'; then`,
  ],
  [
    '§8 kept escape-token check converted without updating KEPT',
    'hooks/pre-bash-safety-check.sh',
    `if echo "$CMD" | grep -qF '[allow-curl-sh]'; then bypass_curlsh=1; fi`,
    `if grep -qF '[allow-curl-sh]' < <(echo "$CMD"); then bypass_curlsh=1; fi`,
  ],
  [
    '§8 npx check on a pipe split over two lines, grep -E -q',
    'hooks/pre-bash-safety-check.sh',
    `if grep -qE "$NPX_CMD_REGEX" < <(printf '%s' "$seg_canon"); then`,
    `if printf '%s' "$seg_canon" |\n    grep -E -q "$NPX_CMD_REGEX"; then`,
  ],
  [
    'banned-vocab Path 1 scan back on a pipe',
    'hooks/banned-vocab-check.sh',
    `  if hook_vocab_grep -qiE "$local_regex" < <(echo "$MSG_TEXT"); then`,
    `  if echo "$MSG_TEXT" | hook_vocab_grep -qiE "$local_regex"; then`,
  ],
  [
    'banned-vocab Path 2 scan back on a pipe',
    'hooks/banned-vocab-check.sh',
    `  if hook_vocab_grep -qiE "$local_regex" < <(echo "$LAST_TEXT"); then`,
    `  if echo "$LAST_TEXT" | hook_vocab_grep -qiE "$local_regex"; then`,
  ],
  [
    'ship-baseline trigger back on a pipe',
    'hooks/ship-baseline-check.sh',
    `grep -qE "$TRIGGER_RE" < <(echo "$CMD_FLAT") || exit 0`,
    `echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0`,
  ],
  [
    'memory-read trigger back on a pipe, grep -m1',
    'hooks/memory-read-check.sh',
    `grep -qE "$TRIGGER_RE" < <(echo "$CMD_TRIG") || exit 0`,
    `echo "$CMD_TRIG" | grep -m1 -E "$TRIGGER_RE" >/dev/null || exit 0`,
  ],
];

for (const [name, rel, from, to] of MUTATIONS) {
  test(`mutation goes red: ${name}`, () => {
    const { problems } = checkTree(mutated(rel, from, to));
    assert.ok(problems.length > 0, `${name}: the check stayed green`);
  });
}
