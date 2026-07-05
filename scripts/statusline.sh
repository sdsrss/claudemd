#!/usr/bin/env bash
# claudemd statusLine — PS1-style: user@host:path (branch) model [ctx:N%]
# Reads Claude Code's statusLine JSON on stdin; prints one line to stdout.
# Colors mirror bash PS1 (green user@host, blue path, magenta branch, cyan
# model); [ctx:N%] is threshold-colored: <50 green, 50-79 yellow, >=80 red.
# Never exits non-zero and never blanks on bad input (no `set -e`).
input=$(cat)
cwd=""; model=""; used=""
if [ -n "$input" ]; then
  # One jq call, three newline-delimited outputs. `// ""` (NOT `// empty`) keeps
  # exactly three lines so the reads stay aligned even when a field is absent.
  {
    IFS= read -r cwd
    IFS= read -r model
    IFS= read -r used
  } < <(jq -r '
    .cwd // .workspace.current_dir // "",
    .model.display_name // "",
    (.context_window.used_percentage // "")
  ' <<<"$input" 2>/dev/null)
fi

# user@host — bold green
user_host="\033[01;32m$(whoami)@$(hostname -s)\033[00m"

# path — bold blue
path_part=""
[ -n "$cwd" ] && path_part="\033[01;34m${cwd}\033[00m"

# branch — magenta; detached HEAD → short SHA; only inside a repo
branch_part=""
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    branch_part=" \033[00;35m(${branch})\033[00m"
  elif [ -n "$branch" ]; then
    sha=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$sha" ] && branch_part=" \033[00;35m(detached:${sha})\033[00m"
  fi
fi

# model — cyan
model_part=""
[ -n "$model" ] && model_part=" \033[00;36m${model}\033[00m"

# context usage — semantic threshold color (guards non-numeric before arithmetic)
ctx_part=""
used_int=${used%.*}
case "$used_int" in
  ''|*[!0-9]*) : ;;
  *)
    if   [ "$used_int" -ge 80 ]; then c=31
    elif [ "$used_int" -ge 50 ]; then c=33
    else c=32; fi
    ctx_part=" \033[00;${c}m[ctx:${used_int}%]\033[00m"
  ;;
esac

printf '%b' "${user_host}:${path_part}${branch_part}${model_part}${ctx_part}"
