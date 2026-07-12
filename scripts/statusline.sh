#!/usr/bin/env bash
# claudemd statusLine — PS1-style: user@host:dir (branch) model [ctx:N% · 5h:N% · 7d:N%]
# (dir = basename of cwd, not the full path)
# Reads Claude Code's statusLine JSON on stdin; prints one line to stdout.
# Colors mirror bash PS1 (green user@host, blue path, magenta branch, cyan
# model). The meter bracket holds up to three USED-% segments (ctx = context,
# 5h / 7d = rate-limit quota windows), each threshold-colored the same way:
# <50 green, 50-79 yellow, >=80 red — rendered FAINT (SGR 2) so the meter
# doesn't pull attention from the prompt.
# Segments with no data are omitted; no data at all → no bracket. A fresh
# session (post-/clear, used_percentage:null) counts as data → ctx:0%. Set
# DISABLE_STATUSLINE_QUOTA=1 to hide the 5h/7d segments (ctx stays).
# Never exits non-zero and never blanks/corrupts on hostile input: fields are
# NUL-delimited (jq -j) so an embedded newline can't misalign them, and the
# final printf uses %s over pre-embedded ESC bytes so a backslash sequence in a
# path/model (e.g. a Windows-style `C:\...` cwd, or a literal `\c`) is never
# interpreted as a printf escape.
esc=$'\033'
input=$(cat)
cwd=""; model=""; used=""; fh_used=""; sd_used=""
if [ -n "$input" ]; then
  # One jq call, five NUL-separated outputs. NUL cannot occur in a JSON string
  # value or a real path, so the reads always align regardless of field
  # content. `// ""` (NOT `// empty`) keeps all fields present.
  {
    IFS= read -r -d '' cwd
    IFS= read -r -d '' model
    IFS= read -r -d '' used
    IFS= read -r -d '' fh_used
    IFS= read -r -d '' sd_used
  } < <(jq -j '
    (.cwd // .workspace.current_dir // ""), ([0]|implode),
    (.model.display_name // ""), ([0]|implode),
    # ctx: right after /clear (before the first API response) CC sends
    # context_window with an EXPLICIT used_percentage:null ("no usage yet"),
    # which must render as ctx:0% — only a missing key/object means "no data".
    (.context_window | if type == "object" and has("used_percentage")
       then ((.used_percentage // 0) | tostring) else "" end), ([0]|implode),
    ((.rate_limits.five_hour.used_percentage // "") | tostring), ([0]|implode),
    ((.rate_limits.seven_day.used_percentage // "") | tostring), ([0]|implode)
  ' <<<"$input" 2>/dev/null)
fi

# M2: a field carrying a literal newline (pathological cwd/model) would break the
# one-line contract even though NUL-delimiting keeps the FIELDS aligned. Collapse
# CR/LF in the two free-text fields to a space (bash-3.2 parameter expansion).
cwd=${cwd//$'\r'/}; cwd=${cwd//$'\n'/ }
model=${model//$'\r'/}; model=${model//$'\n'/ }

# user@host — bold green
user_host="${esc}[01;32m$(whoami)@$(hostname -s)${esc}[00m"

# path — bold blue; basename only (a full path crowds out the meter segments).
# ${cwd##*/} of "/" (or a trailing-slash path) is empty → fall back to full cwd.
path_part=""
if [ -n "$cwd" ]; then
  dir=${cwd##*/}
  path_part="${esc}[01;34m${dir:-$cwd}${esc}[00m"
fi

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

# meter bracket — up to three ` · `-joined segments; bracket/separators uncolored
segs=""
add_seg() { # $1 = pre-colored segment
  [ -z "$1" ] && return
  [ -n "$segs" ] && segs="${segs} · "
  segs="${segs}$1"
}

# USED-% segment from a percentage string: floored; hidden when non-numeric or
# >3 digits (nonsense input that would also overflow bash int64 in [ -ge ]).
used_seg() { # $1 = label, $2 = used-percentage string
  local int=${2%%.*} c
  case "$int" in ''|*[!0-9]*|????*) return ;; esac
  if   [ "$int" -ge 80 ]; then c=31
  elif [ "$int" -ge 50 ]; then c=33
  else c=32; fi
  add_seg "${esc}[02;${c}m$1:${int}%${esc}[00m"
}

used_seg "ctx" "$used"
if [ "${DISABLE_STATUSLINE_QUOTA:-0}" != "1" ]; then
  used_seg "5h" "$fh_used"
  used_seg "7d" "$sd_used"
fi

meter_part=""
[ -n "$segs" ] && meter_part=" [${segs}]"

printf '%s' "${user_host}:${path_part}${branch_part}${model_part}${meter_part}"
