import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logicalLines } from '../lib/shell-scan.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Two rules for hooks/*.sh and hooks/lib/*.sh, both about bash 3.2 (macOS
// /bin/bash) when a file cannot be written (a full disk, a quota, a file-size
// limit).
//
// HERE-STRING (D#417). bash 3.2 to 5.0 write every here-string to a temp file,
// 5.1+ one longer than a pipe buffer; when it cannot, the command it feeds does
// not run. `IFS=$'\t' read -r TOOL … <<<"$F"`
// left TOOL unset and `set -u` ended verify-log.sh and test-failure-debug.sh
// with "TOOL: unbound variable"; elsewhere a gate's loop read nothing. Under
// bash 5.1+ only a long one shows it. The fix is
// `< <(printf '%s\n' "$x")`: a process substitution is a pipe on every version.
// The check is on the raw text of every line that is not a comment, so a
// here-string inside $( ) or a quoted program counts too.
//
// BUILTIN-WRITE (D#421). bash's printf/echo builtins write through the shell's
// stdio buffer. When the write to a redirected file fails, BSD libc keeps the
// bytes, and the next flush sends them to the restored stdout: the hook's own.
// pre-bash-safety-check.sh writes its rule-hits row before the deny JSON, so on
// macOS a full disk turned the §8 deny into two lines Claude Code cannot read as
// one decision (0.112.0 PR CI, macOS leg, banned-vocab case 26n). glibc drops
// the bytes, so Linux never shows it. Safe by construction: a subshell whose
// stdout is the file for its whole life, `( printf … ) > file` — whatever its
// buffer keeps can only go to that file. So a redirection of stdout to a file
// fails this check when what it applies to runs in the hook's own shell and can
// print through that buffer:
//   • a printing builtin (printf, echo, pwd, declare, pushd, kill, …) or one
//     that runs shell code in this shell (eval, source, .), also behind
//     `command`/`builtin` and assignments;
//   • a function defined anywhere under hooks/ (`name()` or `function name`);
//   • a compound command closed by `}`, `done`, `fi` or `esac`;
//   • `exec` with no command (the redirection stays for the rest of the hook).
// A redirection INSIDE a subshell, `( printf … > file )`, fails too: the
// subshell's own stdout is still the hook's. Not a file: /dev/null,
// /dev/stderr, `>&2`, `>&1`, `>&-`. Any other target counts, `>&3` included.
// Not seen, by construction: writes inside $( ), <( ) or backticks (their
// stdout is a pipe into the hook, not the hook's stdout), writes inside >( )
// (its stdout IS the hook's; there is no >( ) under hooks/), and a command whose
// name the reader cannot see (built from a variable).

const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');

function hookFiles() {
  return ['', 'lib'].flatMap(d =>
    fs
      .readdirSync(path.join(HOOKS_DIR, d))
      .filter(f => f.endsWith('.sh'))
      .map(f => path.posix.join('hooks', d, f))
  );
}

// --- here-strings -------------------------------------------------------------

function hereStrings(src) {
  return src
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !/^\s*#/.test(text) && text.includes('<<<'));
}

// --- builtin writes -----------------------------------------------------------

const PRINTING_BUILTINS = new Set([
  'printf',
  'echo',
  'pwd',
  'declare',
  'typeset',
  'local',
  'readonly',
  'export',
  'type',
  'set',
  'alias',
  'trap',
  'hash',
  'dirs',
  'times',
  'umask',
  'ulimit',
  'jobs',
  'shopt',
  'compgen',
  'caller',
  'pushd',
  'popd',
  'cd',
  'kill',
  'help',
  'history',
  'fc',
  'bind',
  'enable',
  'eval',
  'source',
  '.',
]);
const COMPOUND_CLOSERS = new Set(['}', 'done', 'fi', 'esac']);
// Words that stand before the command without being it.
const PREFIXES = new Set(['!', '{', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time']);

function functionNames(files) {
  const names = new Set();
  for (const src of files) {
    for (const m of src.matchAll(
      /^\s*(?:function\s+([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*\(\))/gm
    ))
      names.add(m[1] ?? m[2]);
  }
  return names;
}

// Shell top-level text (scan()'s view) -> tokens. Quoted text, ${…} and the
// substitutions are already blanked to "" '' `` ${} $() <() >(); `[[ … ]]` and
// `(( … ))` are blanked here so their `>` is no redirection.
function tokens(top) {
  const t = top
    .replace(/\[\[.*?\]\]/g, ' TEST ')
    .replace(/\(\(.*?\)\)/g, ' ARITH ')
    .replace(/[$<>]\(\)|\$\{\}|""|''|``/g, 'Q');
  return t.match(/&>>|&>|\d*(?:>>|>\||>&|<>|<&|>|<)|\|\||&&|;;|\|&|[|;&()]|[^\s|;&()<>]+/g) || [];
}

const REDIR = /^(&>>|&>|(\d*)(>>|>\||>&|>|<>|<&|<))$/;
const SEPARATORS = new Set(['||', '&&', ';;', ';', '|&', '|', '&', '(', ')']);

// [{redir, target, kind}] for each stdout-to-file redirection on one logical
// line whose command can print through the hook's buffer.
function builtinWrites(top, fns) {
  const out = [];
  let cmd = { words: [], redirs: [], closer: null };
  const finish = () => {
    for (const r of cmd.redirs) {
      const kind = classify(cmd);
      if (kind) out.push({ ...r, kind });
    }
  };
  const classify = c => {
    if (c.closer === ')' && c.words.length === 0) return null;
    let k = 0;
    while (
      k < c.words.length &&
      (PREFIXES.has(c.words[k]) || /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(c.words[k]))
    )
      k++;
    const head = c.words[k];
    if (head === undefined) return null;
    if (COMPOUND_CLOSERS.has(head)) return 'compound';
    if (head === 'exec') return c.words.length === k + 1 ? 'exec' : null;
    if (head === 'command' || head === 'builtin') {
      const next = c.words[k + 1];
      if (next === undefined || next.startsWith('-')) return 'builtin';
      return PRINTING_BUILTINS.has(next) || fns.has(next) ? 'builtin' : null;
    }
    if (PRINTING_BUILTINS.has(head)) return head === 'printf' && c.words[k + 1] === '-v' ? null : 'builtin';
    if (fns.has(head)) return 'function';
    return null;
  };
  const toks = tokens(top);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (SEPARATORS.has(tok)) {
      finish();
      cmd = { words: [], redirs: [], closer: tok === ')' ? ')' : null };
      continue;
    }
    const m = REDIR.exec(tok);
    if (m) {
      const target = toks[i + 1] ?? '';
      i++;
      const both = m[1] === '&>' || m[1] === '&>>';
      const fd = m[2] ?? '';
      const op = m[3] ?? '';
      if (!both && fd !== '' && fd !== '1') continue;
      if (!both && !['>', '>>', '>|', '>&'].includes(op) && !(op === '<>' && fd === '1')) continue;
      if (op === '>&' && ['1', '2', '-'].includes(target)) continue;
      if (target === '/dev/null' || target === '/dev/stderr') continue;
      cmd.redirs.push({ redir: tok, target });
      continue;
    }
    // A word right after `)` is a case arm's command (`pat) printf …`), not a
    // redirection of a subshell.
    if (cmd.closer === ')' && cmd.words.length === 0) cmd.closer = null;
    cmd.words.push(tok);
  }
  finish();
  return out;
}

function findSites(src, fns) {
  const sites = [];
  const { lines, unterminated, swallowed } = logicalLines(src);
  for (const { line, text, top } of lines) {
    for (const w of builtinWrites(top, fns)) sites.push({ line, text, ...w });
  }
  return { sites, unterminated, swallowed };
}

// Kept on purpose, each with the reason a failed write cannot reach a hook's
// stdout or cannot happen. `has` must match exactly one site.
const KEPT = [
  {
    file: 'hooks/lib/hook-common.sh',
    has: '} >> "$log"',
    why: "hook_spawn_install's group runs inside `( … ) </dev/null >/dev/null 2>&1 &`: that subshell's stdout is /dev/null, so a failed write's bytes can only go there",
  },
];

function checkTree(read) {
  const files = hookFiles();
  const srcs = new Map(files.map(rel => [rel, read(rel)]));
  const fns = functionNames([...srcs.values()]);
  const problems = [];
  const used = new Map(KEPT.map(k => [k, 0]));
  for (const [rel, src] of srcs) {
    for (const h of hereStrings(src)) {
      problems.push(
        `${rel}:${h.line}: here-string — bash up to 5.0 needs a temp file for it; read from \`< <(printf '%s\\n' …)\`: ${h.text.trim().slice(0, 160)}`
      );
    }
    const { sites, unterminated, swallowed } = findSites(src, fns);
    for (const w of swallowed)
      problems.push(`${rel}:${w.line}: \`${w.text}\` read as quoted text — fix the reader`);
    for (const u of unterminated)
      problems.push(`${rel}:${u.line}: here-doc ${u.tag} has no delimiter line — fix the reader`);
    for (const s of sites) {
      const hits = KEPT.filter(k => k.file === rel && s.text.includes(k.has));
      if (hits.length === 1) {
        used.set(hits[0], used.get(hits[0]) + 1);
        continue;
      }
      problems.push(
        `${rel}:${s.line}: ${s.kind} writes stdout to a file in the hook's shell (${s.redir} ${s.target}) — wrap it: ( … ) > file: ${s.text.slice(0, 160)}`
      );
    }
  }
  for (const [k, n] of used) {
    if (n !== 1) problems.push(`KEPT entry for ${k.file} matched ${n} site(s), expected 1: ${k.has}`);
  }
  return problems;
}

const readReal = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('hooks/ holds no here-string and no stdout file write outside a subshell', () => {
  const problems = checkTree(readReal);
  assert.deepEqual(problems, [], problems.join('\n'));
});

// D#455: the status line is not a hook, but it ships, runs under the user's
// bash on every render, and writes no file, so only the here-string rule applies.
test('scripts/statusline.sh holds no here-string', () => {
  const found = hereStrings(readReal('scripts/statusline.sh')).map(h => `${h.line}: ${h.text.trim()}`);
  assert.deepEqual(found, [], found.join('\n'));
});

const NO_FNS = new Set(['rule_hits_append']);
const kinds = src => findSites(src, NO_FNS).sites.map(s => s.kind);

test('recognizer: shapes it must report', () => {
  const must = {
    'printf "%s\\n" "$row" >> "$log"': 'builtin',
    'echo "v2:$N" > "$F"': 'builtin',
    'printf "%s" "$x" > "$F" 2>/dev/null': 'builtin',
    'printf "%s" "$x" 2>/dev/null >>"$F" || true': 'builtin',
    'X=1 printf "%s" "$x" >| "$F"': 'builtin',
    'command printf "%s" "$x" > "$F"': 'builtin',
    'builtin echo x 1>> "$F"': 'builtin',
    'echo x &>> "$F"': 'builtin',
    'echo x >&3': 'builtin',
    'echo x > /tmp/f': 'builtin',
    '[[ -n "$x" ]] && echo x > "$F"': 'builtin',
    'if true; then echo x > "$F"; fi': 'builtin',
    '( printf "%s" "$x" > "$F" )': 'builtin',
    'rule_hits_append a b > "$F"': 'function',
    '{ echo a; echo b; } > "$F"': 'compound',
    'while read -r l; do echo "$l"; done > "$F"': 'compound',
    'exec > "$F"': 'exec',
    'case $x in a) echo x > "$F" ;; esac': 'builtin',
    // Shapes the 0.113.2 pre-tag review found unreported (L4).
    'eval \'printf x\' > "$F"': 'builtin',
    'source x > "$F"': 'builtin',
    '. x > "$F"': 'builtin',
    'pushd "$d" > "$F"': 'builtin',
    'cd - > "$F"': 'builtin',
    'kill -l > "$F"': 'builtin',
    'printf x 1<> "$F"': 'builtin',
  };
  for (const [src, kind] of Object.entries(must)) assert.deepEqual(kinds(src), [kind], src);
});

test('recognizer: shapes it must not report', () => {
  const mustNot = [
    '( printf "%s" "$x" ) > "$F"',
    '( echo a; echo b ) >> "$F" 2>/dev/null',
    'echo x >&2',
    'echo x 1>&2',
    'printf "%s" x > /dev/null',
    'echo x >/dev/stderr',
    'printf -v v "%s" x',
    'jq -c . > "$F"',
    'cat > "$F" <<EOF\nbody > x\nEOF',
    'echo "a > b"',
    '[[ "$a" > "$b" ]] && echo x',
    '(( n > 3 )) && echo x',
    'x=$(printf "%s" a > "$F")',
    'while read -r l; do :; done < <(printf "%s\\n" "$v")',
    'echo x 2> "$F"',
    'exec jq . > "$F"',
    'printf x <> "$F"',
  ];
  for (const src of mustNot) assert.deepEqual(kinds(src), [], src);
});

test('recognizer: a function defined either way is a function', () => {
  const fns = functionNames(['function wr {\n  printf x\n}\nwr2() { :; }\nfunction wr3() { :; }\n']);
  assert.deepEqual([...fns].sort(), ['wr', 'wr2', 'wr3']);
  assert.deepEqual(
    findSites('wr > "$F"', fns).sites.map(s => s.kind),
    ['function']
  );
});

test('here-string rule: code lines only', () => {
  assert.deepEqual(hereStrings('read -r a <<< "$x"').length, 1);
  assert.deepEqual(hereStrings('x=$(awk 1 - <<<"$y")').length, 1);
  assert.deepEqual(hereStrings('  # a <<< in a comment').length, 0);
});

function mutated(rel, from, to) {
  const src = readReal(rel);
  assert.equal(src.split(from).length - 1, 1, `mutation anchor not unique in ${rel}: ${from}`);
  const out = src.split(from).join(to);
  return r => (r === rel ? out : readReal(r));
}

const MUTATIONS = [
  [
    'the rule-hits row append back to a bare printf (the §8 deny path)',
    'hooks/lib/rule-hits.sh',
    `[[ -n "$row" ]] && ( printf '%s\\n' "$row" ) >> "$log_file"`,
    `[[ -n "$row" ]] && printf '%s\\n' "$row" >> "$log_file" 2>/dev/null`,
    /^hooks\/lib\/rule-hits\.sh:\d+: builtin writes stdout to a file/,
  ],
  [
    'the ledger write back to a redirection inside the subshell',
    'hooks/rework-breaker.sh',
    `( printf '%s\\n' "$RB_KEY" ) 2>/dev/null >> "$RB_LEDGER" || {`,
    `(printf '%s\\n' "$RB_KEY" >> "$RB_LEDGER") 2>/dev/null || {`,
    /^hooks\/rework-breaker\.sh:\d+: builtin writes stdout to a file/,
  ],
  [
    'the sync bootstrap back to a { } group',
    'hooks/session-start-check.sh',
    `    platform_timeout 4 node "$PLUGIN_ROOT/scripts/install.js" 2>&1\n  ) 2>/dev/null >> "$LOG" || SYNC_RC=$?`,
    `    platform_timeout 4 node "$PLUGIN_ROOT/scripts/install.js" 2>&1\n  } 2>/dev/null >> "$LOG" || SYNC_RC=$?`,
    /^hooks\/session-start-check\.sh:\d+: compound writes stdout to a file/,
  ],
  [
    "verify-log's fields back on a here-string",
    'hooks/verify-log.sh',
    `IFS=$'\\t' read -r TOOL SESSION_ID TOOL_USE_ID CWD < <(printf '%s\\n' "$FIELDS")`,
    `IFS=$'\\t' read -r TOOL SESSION_ID TOOL_USE_ID CWD <<<"$FIELDS"`,
    /^hooks\/verify-log\.sh:\d+: here-string/,
  ],
  [
    "the release gate's word split back on a here-string",
    'hooks/spec-module-gate.sh',
    '  _words=($_seg)\n',
    '  read -ra _words <<<"$_seg"\n',
    /^hooks\/spec-module-gate\.sh:\d+: here-string/,
  ],
  [
    'the kept site reworded without updating KEPT',
    'hooks/lib/hook-common.sh',
    '    } >> "$log"\n',
    '    } >>"$log"\n',
    /^KEPT entry for hooks\/lib\/hook-common\.sh matched 0 site/,
  ],
];

// Each row names the problem it must produce, not just any red.
for (const [name, rel, from, to, expect] of MUTATIONS) {
  test(`mutation goes red: ${name}`, () => {
    const problems = checkTree(mutated(rel, from, to));
    assert.ok(
      problems.some(p => expect.test(p)),
      `${name}: no problem matched ${expect}; got:\n      ${problems.join('\n      ') || '(none)'}`
    );
  });
}
