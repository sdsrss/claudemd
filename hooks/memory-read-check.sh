#!/usr/bin/env bash
# memory-read-check.sh — PreToolUse:Bash hook.
# Denies ship/release/push commands when a keyword-matched memory file
# has NOT been Read in the current session.
# Fragile transcript parsing — fail-open on any hiccup.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_READ || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Escape hatch
echo "$CMD" | grep -qF '[skip-memory-check]' && exit 0

# Filter: ship/release/push/deploy verbs at command-segment-start.
# Anchor on `^` or shell separator (`;` / `&` / `|`) so `release`/`deploy`/
# `ship` substrings inside quoted commit messages, MR descriptions, file
# paths, etc. don't trigger the whole MEMORY scan. Pre-fix `git commit -m
# "release notes"` and `glab mr create --title "fix release"` both fired
# the filter — see tests Cases 14–15.
TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)(git[[:space:]]+push|gh[[:space:]]+(release|pr)|glab[[:space:]]+mr|npm[[:space:]]+(publish|run[[:space:]]+(release|deploy|ship))|cargo[[:space:]]+publish|make[[:space:]]+(release|deploy|ship)|release|deploy|ship)([^a-zA-Z]|$)'
echo "$CMD" | grep -qE "$TRIGGER_RE" || exit 0

CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -n "$CWD" && -n "$SESSION_ID" ]] || exit 0

# Derive project-encoded dir — Claude Code converts both `/` AND `.` to `-`
# (observe: ~/.claude/projects/-home-sds--claude-tmp-... for /home/sds/.claude/tmp/...).
# Slash-only encoding silently missed any project path containing a dot.
ENCODED=$(printf '%s' "$CWD" | tr '/.' '-')
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

# Fail-open if either missing (CC version drift)
[[ -f "$MEM_INDEX" ]] || exit 0
[[ -f "$TRANSCRIPT" ]] || exit 0

# Parse index lines: `- [Title](file.md) [tag1, tag2] — desc`
MATCHES=()
while IFS= read -r line; do
  FILE=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p')
  [[ -z "$FILE" ]] && continue
  # Accept both backtick-wrapped (`[tag, tag]`) and plain (`[tag, tag]`)
  # tag-block syntax. Spec §11 documents the plain form; existing user data
  # commonly uses the backtick form. Trying backtick first preserves precise
  # matching when both forms could otherwise overlap on a single line.
  TAG_BLOCK=$(echo "$line" | sed -n 's/.*`\[\([^]]*\)\]`.*/\1/p')
  if [[ -z "$TAG_BLOCK" ]]; then
    # Plain form: anchor on the markdown link `(file.md)` then `[tag, tag]`
    # before the description separator (`—` or `-`). The leading `.md)` anchor
    # avoids matching the link's own `[Title]` bracket pair.
    TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*\[\([^]]*\)\][[:space:]]*[—-].*/\1/p')
  fi

  if [[ -z "$TAG_BLOCK" ]]; then
    # Untagged entries: hook does NOT auto-block. Spec §11 "Index is a
    # router, not a substitute" — untagged matching is the agent's
    # responsibility (full content scan when in doubt). Pre-fix this branch
    # added the file to MATCHES unconditionally, forcing N unrelated Reads
    # on every push when MEMORY.md grew without tag discipline.
    continue
  else
    IFS=',' read -ra TAGS <<<"$TAG_BLOCK"
    for t in "${TAGS[@]}"; do
      t=$(echo "$t" | tr -d ' ')
      [[ -z "$t" ]] && continue
      # -F: tag is literal, not a regex. A tag containing `.` / `$` / `*` would
      # otherwise be interpreted by grep's BRE and either match too broadly
      # (e.g. `.` matching any char) or fail to match itself.
      if echo "$CMD" | grep -qiF "$t"; then
        MATCHES+=("$FILE")
        break
      fi
    done
  fi
done < "$MEM_INDEX"

(( ${#MATCHES[@]} == 0 )) && exit 0

# Check each matched file against transcript Read events
MISSING=()
for file in "${MATCHES[@]}"; do
  MEMFILE="$MEM_DIR/$file"
  if ! grep -qF "$MEMFILE" "$TRANSCRIPT" 2>/dev/null; then
    MISSING+=("$file")
  fi
done

(( ${#MISSING[@]} == 0 )) && exit 0

REASON="§11 MEMORY.md read-the-file (HARD): matched memory file(s) not Read this session:"
for m in "${MISSING[@]}"; do
  REASON+=$'\n'"  - $m"
done
REASON+=$'\n\n'"Options:
  (a) Read the listed file(s), then retry.
  (b) Per-invocation bypass: include [skip-memory-check] in the command.

Spec: ~/.claude/CLAUDE.md §11 SESSION — MEMORY.md read-the-file."

MISS_JSON=$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)
hook_record memory-read-check deny "{\"missing\":$MISS_JSON}"
hook_deny memory-read-check "$REASON"
