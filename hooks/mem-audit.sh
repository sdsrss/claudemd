#!/usr/bin/env bash
# mem-audit.sh — Stop hook (advisory only, never blocks).
# Scans ~/.claude/projects/*/memory/feedback_*.md + project_*.md for missing
# **Why:** / **How to apply:** body-structure markers per CC memoryTypes.ts
# lines 58/76/132/149 (eval-validated body_structure for feedback + project
# types). Spec §11 + §EXT §11-EXT also reference this structure.
#
# Output via additionalContext on stdout JSON (only when count >0; otherwise
# silent). Fail-open on any hiccup; Stop hook cannot block, so exit 0 always.
#
# Sentinel-debounced: emits at most once per 24h to avoid noise on every Stop.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch MEM_AUDIT || exit 0
hook_require_jq || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
SENTINEL="$STATE_DIR/mem-audit.lastrun"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# Debounce: only run once per 24h.
if [[ -f "$SENTINEL" ]] && command -v platform_stat_mtime >/dev/null 2>&1; then
  now=$(date +%s 2>/dev/null) || exit 0
  smtime=$(platform_stat_mtime "$SENTINEL" 2>/dev/null) || exit 0
  if [[ -n "$smtime" ]]; then
    age=$(( now - smtime ))
    [[ "$age" -lt 86400 ]] && exit 0
  fi
fi

PROJECTS_ROOT="$HOME/.claude/projects"
[[ -d "$PROJECTS_ROOT" ]] || exit 0

MISSING=0
SAMPLE=()
SAMPLE_LIMIT=3

# Iterate per-project memory dirs only one level deep — never traverse the
# whole projects tree (§8 SAFETY ban on recursive traversal of ~/.claude/).
for proj_dir in "$PROJECTS_ROOT"/*/; do
  mem_dir="$proj_dir/memory"
  [[ -d "$mem_dir" ]] || continue

  # find -maxdepth 1: avoid descending into any subdirs (e.g. logs/).
  while IFS= read -r f; do
    base="$(basename "$f")"
    case "$base" in
      feedback_*.md|project_*.md) ;;
      *) continue ;;
    esac

    # Skip MEMORY.md itself + frontmatter-only stubs (<400 bytes likely empty).
    [[ "$base" == "MEMORY.md" ]] && continue
    size=$(wc -c < "$f" 2>/dev/null | tr -d '[:space:]') || continue
    [[ "${size:-0}" -lt 400 ]] && continue

    # Both markers must appear at line start (the canonical CC body_structure).
    if ! grep -qE '^\*\*Why:\*\*' "$f" 2>/dev/null \
       || ! grep -qE '^\*\*How to apply:\*\*' "$f" 2>/dev/null; then
      MISSING=$((MISSING + 1))
      if [[ "${#SAMPLE[@]}" -lt "$SAMPLE_LIMIT" ]]; then
        # Path relative to projects root for compactness in the banner.
        rel="${f#$PROJECTS_ROOT/}"
        SAMPLE+=("$rel")
      fi
    fi
  done < <(find "$mem_dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null)
done

# Touch sentinel even on zero-missing — prevents repeat scans within 24h.
touch "$SENTINEL" 2>/dev/null || true

if [[ "$MISSING" -eq 0 ]]; then
  exit 0
fi

# Build banner. Show first SAMPLE_LIMIT paths, then "+N more" if exceeded.
joined=$(IFS=, ; echo "${SAMPLE[*]}")
extra=""
[[ "$MISSING" -gt "$SAMPLE_LIMIT" ]] && extra=" (+$((MISSING - SAMPLE_LIMIT)) more)"
msg="[claudemd] §11-EXT mem-audit: $MISSING feedback/project memories missing **Why:** / **How to apply:** body-structure: ${joined}${extra}. Disable: DISABLE_MEM_AUDIT_HOOK=1"

jq -cn --arg ctx "$msg" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "Stop",
    additionalContext: $ctx
  }
}' 2>/dev/null

hook_record mem-audit warn "{\"missing\":$MISSING}" '§11-EXT-mem-audit'
exit 0
