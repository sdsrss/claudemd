#!/usr/bin/env bash
# claudemd statusLine — PS1-style: user@host:path (branch) model [ctx:N%]
# Reads Claude Code's statusLine JSON on stdin; prints one line to stdout.
# Colors mirror bash PS1 (green user@host, blue path, magenta branch, cyan
# model); [ctx:N%] is threshold-colored: <50 green, 50-79 yellow, >=80 red.
# Never exits non-zero and never blanks/corrupts on hostile input: fields are
# NUL-delimited (jq -j) so an embedded newline can't misalign them, and the
# final printf uses %s over pre-embedded ESC bytes so a backslash sequence in a
# path/model (e.g. a Windows-style `C:\...` cwd, or a literal `\c`) is never
# interpreted as a printf escape.
esc=$'\033'
input=$(cat)
cwd=""; model=""; used=""
if [ -n "$input" ]; then
  # One jq call, three NUL-separated outputs. NUL cannot occur in a JSON string
  # value or a real path, so the three reads always align regardless of field
  # content. `// ""` (NOT `// empty`) keeps all three fields present.
  {
    IFS= read -r -d '' cwd
    IFS= read -r -d '' model
    IFS= read -r -d '' used
  } < <(jq -j '
    (.cwd // .workspace.current_dir // ""), ([0]|implode),
    (.model.display_name // ""), ([0]|implode),
    ((.context_window.used_percentage // "") | tostring), ([0]|implode)
  ' <<<"$input" 2>/dev/null)
fi

# user@host — bold green
user_host="${esc}[01;32m$(whoami)@$(hostname -s)${esc}[00m"

# path — bold blue
path_part=""
[ -n "$cwd" ] && path_part="${esc}[01;34m${cwd}${esc}[00m"

# branch — magenta; detached HEAD → short SHA; only inside a repo
branch_part=""
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    branch_part=" ${esc}[00;35m(${branch})${esc}[00m"
  elif [ -n "$branch" ]; then
    sha=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$sha" ] && branch_part=" ${esc}[00;35m(detached:${sha})${esc}[00m"
  fi
fi

# model — cyan
model_part=""
[ -n "$model" ] && model_part=" ${esc}[00;36m${model}${esc}[00m"

# context usage — semantic threshold color (guards non-numeric before arithmetic)
ctx_part=""
used_int=${used%.*}
case "$used_int" in
  ''|*[!0-9]*) : ;;
  *)
    if   [ "$used_int" -ge 80 ]; then c=31
    elif [ "$used_int" -ge 50 ]; then c=33
    else c=32; fi
    ctx_part=" ${esc}[00;${c}m[ctx:${used_int}%]${esc}[00m"
  ;;
esac

printf '%s' "${user_host}:${path_part}${branch_part}${model_part}${ctx_part}"
