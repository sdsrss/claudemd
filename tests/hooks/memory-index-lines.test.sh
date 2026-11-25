#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# memory-index-lines.test.sh — PostToolUse(Edit|Write|Bash) hook that tells the
# agent when an index line it just wrote to MEMORY.md is over 150 characters.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/memory-index-lines.sh"
TMP_HOME=$(mktemp -d -t claudemd-mil-XXXXXX)
trap 'rm -rf "${TMP_HOME:?}"' EXIT
export HOME="$TMP_HOME"

CWD="/work/proj"
ENCODED=$(printf '%s' "$CWD" | tr -c 'a-zA-Z0-9-' '-')
MEM_DIR="$HOME/.claude/projects/$ENCODED/memory"
OTHER_DIR="$HOME/.claude/projects/-work-other/memory"
mkdir -p "$MEM_DIR" "$OTHER_DIR" "$HOME/.claude/logs"
INDEX="$MEM_DIR/MEMORY.md"

# pad LINE N — LINE extended with "x" to exactly N characters (ASCII lines only).
pad() {
  local s="$1" n="$2"
  while (( ${#s} < n )); do s="${s}x"; done
  printf '%s' "${s:0:n}"
}
LONG_NEW=$(pad '- [New long entry](new_long.md) [alpha, beta] — ' 172)
LONG_OLD=$(pad '- [Legacy long entry](legacy_long.md) [gamma] — ' 190)
LONG_OTHER=$(pad '- [Other project entry](other_entry.md) [delta] — ' 160)
SHORT='- [Short entry](short.md) [eps] — fits'
EXACT=$(pad '- [Exactly at the limit](exact.md) [zeta] — ' 150)
# 151 code points, well over 150 bytes: the limit counts characters, as doctor does.
CJK151="- [中文条目](cjk.md) [标签] — $(printf '记%.0s' $(seq 1 127))"
CJK150="${CJK151%记}"
# The fixture's own length, checked by a counter that does not depend on the locale.
if [[ "$(jq -Rn --arg s "$CJK151" '$s | length')" != "151" || "$(printf '%s' "$CJK150" | wc -c | tr -d ' ')" -le 150 ]]; then
  echo "FAIL: fixture CJK151 is not 151 code points, or CJK150 is not over 150 bytes"
  exit 1
fi

printf '%s\n%s\n' "$SHORT" "$LONG_OLD" > "$INDEX"
printf '%s\n' "$LONG_OTHER" > "$OTHER_DIR/MEMORY.md"

# shellcheck source=/dev/null
source "$HERE/../lib/assert.sh"

ev_edit() { # FILE OLD NEW
  jq -cn --arg f "$1" --arg o "$2" --arg n "$3" --arg c "$CWD" \
    '{hook_event_name:"PostToolUse", session_id:"mil-sess", cwd:$c, tool_name:"Edit",
      tool_input:{file_path:$f, old_string:$o, new_string:$n}, tool_response:{filePath:$f}}'
}
ev_write() { # FILE CONTENT ORIGINAL(null when "-")
  jq -cn --arg f "$1" --arg ct "$2" --arg orig "$3" --arg c "$CWD" \
    '{hook_event_name:"PostToolUse", session_id:"mil-sess", cwd:$c, tool_name:"Write",
      tool_input:{file_path:$f, content:$ct},
      tool_response:{filePath:$f, originalFile:(if $orig == "-" then null else $orig end)}}'
}
ev_bash() { # COMMAND
  jq -cn --arg x "$1" --arg c "$CWD" \
    '{hook_event_name:"PostToolUse", session_id:"mil-sess", cwd:$c, tool_name:"Bash",
      tool_input:{command:$x}, tool_response:{stdout:"", stderr:""}}'
}
run() { bash "$HOOK" 2>/dev/null; }
ctx() { jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null <<<"$1"; }

# 1. Edit adds a long index line → one JSON object naming its length and title.
OUT=$(ev_edit "$INDEX" "$SHORT" "$SHORT"$'\n'"$LONG_NEW" | run)
C=$(ctx "$OUT")
if [[ "$(jq -s 'length' <<<"$OUT" 2>/dev/null)" == "1" ]] \
   && [[ "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$OUT")" == "PostToolUse" ]] \
   && [[ "$C" == *'172: "New long entry"'* ]] && [[ "$C" == *"over 150 characters"* ]] \
   && [[ "$C" == *"DISABLE_MEMORY_INDEX_LINES_HOOK=1"* ]] && [[ "$C" != *"Legacy long entry"* ]]; then
  ok "1 Edit adds a long line → flagged with length and title"
else
  ng "1 (out: $OUT)"
fi

# 1b. Spec v9.0.0 removed core §11, so the note cites no spec section; the
# 150-character limit it applies is stated in the note itself.
if [[ "$C" == "[claudemd] memory index: "* ]] && [[ "$C" != *"§11"* ]]; then
  ok "1b the note cites no removed spec section"
else
  ng "1b (ctx: $C)"
fi

# 2. Edit adds a short line, or a line of exactly 150 → silent.
OUT=$(ev_edit "$INDEX" "$SHORT" "$SHORT"$'\n'"$EXACT" | run)
[[ -z "$OUT" ]] && ok "2 line of exactly 150 characters → silent" || ng "2 (out: $OUT)"

# 3. Edit that leaves an existing long line as it was → silent.
OUT=$(ev_edit "$INDEX" "$LONG_OLD" "$LONG_OLD"$'\n'"$SHORT" | run)
[[ -z "$OUT" ]] && ok "3 long line already in old_string → silent" || ng "3 (out: $OUT)"

# 4. A long `- [` line in a memory FILE, not the index → silent.
OUT=$(ev_edit "$MEM_DIR/new_long.md" "" "$LONG_NEW" | run)
[[ -z "$OUT" ]] && ok "4 memory body file → silent" || ng "4 (out: $OUT)"

# 5. A MEMORY.md outside ~/.claude/projects/<p>/memory/ → silent.
OUT=$(ev_edit "$CWD/MEMORY.md" "" "$LONG_NEW" | run)
[[ -z "$OUT" ]] && ok "5 MEMORY.md outside the memory dir → silent" || ng "5 (out: $OUT)"
OUT=$(ev_edit "$HOME/.claude/projects/a/b/memory/MEMORY.md" "" "$LONG_NEW" | run)
[[ -z "$OUT" ]] && ok "5b nested path under projects/ → silent" || ng "5b (out: $OUT)"

# 6. Write creating MEMORY.md (originalFile null) with a long line → flagged.
OUT=$(ev_write "$INDEX" "$SHORT"$'\n'"$LONG_NEW"$'\n' "-" | run)
[[ "$(ctx "$OUT")" == *'172: "New long entry"'* ]] && ok "6 Write create → flagged" || ng "6 (out: $OUT)"

# 7. Write rewriting the file: the long line it already had is not flagged, the new one is.
OUT=$(ev_write "$INDEX" "$SHORT"$'\n'"$LONG_OLD"$'\n'"$LONG_NEW"$'\n' "$SHORT"$'\n'"$LONG_OLD"$'\n' | run)
C=$(ctx "$OUT")
if [[ "$C" == *"1 line you just wrote"* && "$C" == *"New long entry"* && "$C" != *"Legacy long entry"* ]]; then
  ok "7 Write update → only the new long line"
else
  ng "7 (out: $OUT)"
fi

# 8. Bash append: the line is in the file and verbatim in the command → flagged.
printf '%s\n' "$LONG_NEW" >> "$INDEX"
OUT=$(ev_bash "cd $MEM_DIR && echo '$LONG_NEW' >> MEMORY.md && tail -1 MEMORY.md" | run)
[[ "$(ctx "$OUT")" == *'172: "New long entry"'* ]] && ok "8 Bash echo append → flagged" || ng "8 (out: $OUT)"

# 9. Bash heredoc append → flagged.
OUT=$(ev_bash "cat >> $MEM_DIR/MEMORY.md <<'EOF'"$'\n'"$LONG_NEW"$'\n'"EOF" | run)
[[ "$(ctx "$OUT")" == *"New long entry"* ]] && ok "9 Bash heredoc append → flagged" || ng "9 (out: $OUT)"

# 10. Read-only Bash naming MEMORY.md and a long entry's file → silent.
OUT=$(ev_bash "grep -n 'legacy_long.md' $MEM_DIR/MEMORY.md; wc -l MEMORY.md" | run)
[[ -z "$OUT" ]] && ok "10 read-only Bash → silent" || ng "10 (out: $OUT)"

# 11. Bash writing another project's index, named in the command → that index is read.
OUT=$(ev_bash "printf '%s\n' '$LONG_OTHER' >> ~/.claude/projects/-work-other/memory/MEMORY.md" | run)
C=$(ctx "$OUT")
if [[ "$C" == *"Other project entry"* && "$C" == *"-work-other/memory/MEMORY.md"* ]]; then
  ok "11 other project's memory dir in the command → flagged, path named"
else
  ng "11 (out: $OUT)"
fi

# 12. Fast path: a Bash command that never names MEMORY.md exits before any jq.
STUB="$TMP_HOME/stubbin"
mkdir -p "$STUB"
printf '#!/bin/sh\necho called >> "%s/jq-called"\nexit 1\n' "$TMP_HOME" > "$STUB/jq"
chmod +x "$STUB/jq"
EVT=$(ev_bash "ls -la; git status")
OUT=$(PATH="$STUB:$PATH" bash "$HOOK" <<<"$EVT" 2>/dev/null)
if [[ -z "$OUT" && ! -e "$TMP_HOME/jq-called" ]]; then
  ok "12 no MEMORY.md in the event → exits before jq"
else
  ng "12 (out: $OUT; jq called: $([[ -e "$TMP_HOME/jq-called" ]] && echo yes || echo no))"
fi

# 13. Kill switches.
EVT=$(ev_edit "$INDEX" "" "$LONG_NEW")
OUT=$(DISABLE_MEMORY_INDEX_LINES_HOOK=1 bash "$HOOK" <<<"$EVT" 2>/dev/null)
[[ -z "$OUT" ]] && ok "13 DISABLE_MEMORY_INDEX_LINES_HOOK=1 → silent" || ng "13 (out: $OUT)"
OUT=$(DISABLE_CLAUDEMD_HOOKS=1 bash "$HOOK" <<<"$EVT" 2>/dev/null)
[[ -z "$OUT" ]] && ok "13b DISABLE_CLAUDEMD_HOOKS=1 → silent" || ng "13b (out: $OUT)"

# 14. Characters, not bytes, under a C locale: 150 CJK-heavy code points pass, 151 do not.
OUT=$(ev_edit "$INDEX" "" "$CJK150" | LC_ALL=C bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "14 150 code points (>150 bytes) → silent" || ng "14 (out: $OUT)"
OUT=$(ev_edit "$INDEX" "" "$CJK151" | LC_ALL=C bash "$HOOK" 2>/dev/null)
[[ "$(ctx "$OUT")" == *'151: "中文条目"'* ]] && ok "14b 151 code points → flagged as 151" || ng "14b (out: $OUT)"

# 15. A long line that is not an index entry (no `- [`) → silent.
OUT=$(ev_edit "$INDEX" "" "$(pad '# Heading that runs on and on ' 200)" | run)
[[ -z "$OUT" ]] && ok "15 long non-entry line → silent" || ng "15 (out: $OUT)"

# 16. Several long lines: counted, plural wording, all named.
L2=$(pad '- [Second long](second.md) [b] — ' 155)
OUT=$(ev_edit "$INDEX" "" "$LONG_NEW"$'\n'"$L2" | run)
C=$(ctx "$OUT")
if [[ "$C" == *"2 lines you just wrote"* && "$C" == *"are over 150"* && "$C" == *'155: "Second long"'* ]]; then
  ok "16 two long lines → counted and both named"
else
  ng "16 (out: $OUT)"
fi

# 17. Telemetry row: hook memory-index-lines, event index-line-advisory, count and max.
LOG="$HOME/.claude/logs/claudemd.jsonl"
: > "$LOG"
ev_edit "$INDEX" "" "$LONG_NEW"$'\n'"$L2" | run >/dev/null
ROW=$(grep -F '"memory-index-lines"' "$LOG" | tail -1)
if [[ "$(jq -r '.event' <<<"$ROW" 2>/dev/null)" == "index-line-advisory" ]] \
   && [[ "$(jq -r '.extra.lines' <<<"$ROW")" == "2" ]] \
   && [[ "$(jq -r '.extra.max' <<<"$ROW")" == "172" ]] \
   && [[ "$(jq -r '.extra.tool' <<<"$ROW")" == "Edit" ]]; then
  ok "17 index-line-advisory row logged with lines/max/tool"
else
  ng "17 (row: $ROW)"
fi

# 18. Malformed event → exit 0, silent.
OUT=$(printf 'MEMORY.md not json' | bash "$HOOK" 2>/dev/null); RC=$?
[[ $RC -eq 0 && -z "$OUT" ]] && ok "18 malformed event → exit 0, silent" || ng "18 (rc $RC, out: $OUT)"

claudemd_assert_summary
