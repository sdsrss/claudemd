// shell-scan.mjs — the shell reader shared by the source checks over hooks/
// (tests/scripts/hook-*-source.test.js). Moved out of hook-sigpipe-source.test.js
// unchanged when a second check needed it.

// Reads shell text the way the parser splits it, enough for this check: what
// the shell sees at the top level (quoted text, ${…}, $(…), <(…), >(…) and
// backtick bodies blanked, comments dropped, newlines as spaces), whether a
// quote or substitution is still open at the end, and the here-doc delimiters
// opened outside quotes, in order.
export function scan(s) {
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
      // `\grep` runs grep; `\|` is no pipe. Keep a word character, blank the rest.
      if (!top) out += /\w/.test(s[i + 1] || '') ? s[i + 1] : '__';
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
      // Quotes inside it protect a brace too, in or out of "…": bash reads
      // `${x:-'}'}` as one expansion (0.107.7 delta review, M2).
      if (c === '}') stack.pop();
      else if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) stack.push(s[++i] === '{' ? 'br' : 'sub');
      else if (c === '$' && s[i + 1] === "'") {
        stack.push('ansi');
        i++;
      } else if (c === "'") stack.push('sq');
      else if (c === '"') stack.push('dq');
      else if (c === '`') stack.push('bt');
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
      // Delimiters: \WORD, 'any text', "any text", or a bare word. Only the bare
      // word was read before, so `<<\EOF` bodies were scanned as code.
      const m = /^<<(-?)\s*(?:\\([^\s;&|<>()'"]+)|'([^']*)'|"([^"]*)"|([A-Za-z_][^\s;&|<>()'"]*))/.exec(
        s.slice(i)
      );
      const tag = m && (m[2] ?? m[3] ?? m[4] ?? m[5]);
      if (m && tag) {
        heredocs.push({ dash: m[1] === '-', tag });
        if (!top) out += `<<${tag}`;
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
export function logicalLines(src) {
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
