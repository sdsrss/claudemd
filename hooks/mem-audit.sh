#!/usr/bin/env bash
# mem-audit.sh — Stop hook (advisory only, never blocks).
#
# Scans ~/.claude/projects/*/memory/feedback_*.md for missing **Why:** /
# **How to apply:** body-structure markers per CC memoryTypes.ts lines 58/76
# (eval-validated body_structure for feedback type). project_*.md exempted
# in v0.18.0 / spec v6.12.0 (§11-EXT) — incident-log pattern is fact-only
# by nature; see hook source comment + spec note.
#
# Output: stderr only (no JSON to stdout) — Stop event has no
# hookSpecificOutput.additionalContext schema. Mirrors residue-audit.sh.
# CC harness surfaces stderr to the user as advisory; never blocks
# (Stop cannot block by design).
#
# Independence: this hook audits CC built-in auto-memory under
# ~/.claude/projects/<encoded-cwd>/memory/ ONLY. It does NOT depend on
# claude-mem-lite, claude-mem, or any other recall-layer plugin. If a user
# only has the claudemd plugin installed and no recall-layer plugin, this
# hook still operates correctly: it scans whatever CC built-in 4-types
# memories exist locally. Zero memory files → silent exit.
#
# Sentinel-debounced: emits at most once per 24h to avoid noise on every Stop.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch MEM_AUDIT || exit 0

# v0.9.34: best-effort session_id from Stop stdin for audit attribution.
SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(cat 2>/dev/null || true)
  [[ -n "$EVENT" ]] && SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
fi

STATE_DIR="$HOME/.claude/.claudemd-state"
SENTINEL="$STATE_DIR/mem-audit.lastrun"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# 24h debounce.
if [[ -f "$SENTINEL" ]] && command -v platform_stat_mtime >/dev/null 2>&1; then
  now=$(date +%s 2>/dev/null) || exit 0
  smtime=$(platform_stat_mtime "$SENTINEL" 2>/dev/null) || exit 0
  if [[ "$smtime" =~ ^[0-9]+$ ]]; then  # numeric-guard before `set -u` arithmetic
    age=$(( now - smtime ))
    [[ "$age" -lt 86400 ]] && exit 0
  fi
fi

# Touch the sentinel BEFORE the scan (2026-07-24 audit P2-4): the per-project
# loop can exceed the 3s hooks.json timeout on installs with many projects; CC
# kills the hook before a post-loop touch, so the sentinel never advanced and
# EVERY subsequent Stop re-ran the full scan. Touching first means even a
# timeout-killed run buys 24h of quiet; the cost is one skipped report cycle
# after a killed scan (acceptable — this hook is advisory-only).
touch "$SENTINEL" 2>/dev/null || true

PROJECTS_ROOT="$HOME/.claude/projects"
[[ -d "$PROJECTS_ROOT" ]] || exit 0

MISSING=0
SAMPLE=()
SAMPLE_LIMIT=3

# v0.9.7 — MEMORY.md ↔ files drift detection. Per project, accumulate two
# kinds of mismatch:
#   (a) index_orphan: MEMORY.md links to a file that doesn't exist (stale index)
#   (b) file_orphan : memory file exists but no MEMORY.md link points to it
# Both are advisory; reported once per 24h alongside Why/How marker scan.
DRIFT=0
DRIFT_SAMPLE=()
DRIFT_SAMPLE_LIMIT=3

# Iterate per-project memory dirs only one level deep — never traverse the
# whole projects tree (§8 SAFETY ban on recursive traversal of ~/.claude/).
for proj_dir in "$PROJECTS_ROOT"/*/; do
  # proj_dir from glob /*/  has trailing slash; strip it so the join below
  # produces "<dir>/memory" not "<dir>//memory" (v0.9.4 had double-slash bug
  # surfaced in error paths).
  proj_dir="${proj_dir%/}"
  mem_dir="$proj_dir/memory"
  [[ -d "$mem_dir" ]] || continue

  # find -maxdepth 1: avoid descending into any subdirs (e.g. logs/).
  while IFS= read -r f; do
    base="$(basename "$f")"
    # v0.18.0 (spec v6.12.0 §11-EXT) — narrowed to feedback_*.md only.
    # project_*.md exempted: incident-log pattern (`project_<topic>_<date>.md`)
    # is fact-only by nature; enforcing Why/How body structure produced 16
    # long-standing non-compliant files across 4 projects without a path to
    # closure. CC memoryTypes.ts still recommends Why/How for project type,
    # but the hook no longer warns when authors omit it.
    case "$base" in
      feedback_*.md) ;;
      *) continue ;;
    esac

    # Skip MEMORY.md itself + frontmatter-only stubs (<400 bytes likely empty).
    [[ "$base" == "MEMORY.md" ]] && continue
    size=$(wc -c < "$f" 2>/dev/null | tr -d '[:space:]') || continue
    [[ "${size:-0}" -lt 400 ]] && continue

    # Both markers must appear at line start. Match BOTH common punctuation
    # forms (CC memoryTypes.ts uses `**Why:**`, but `**Why**:` is also widely
    # used in the wild; accept either to avoid false-positive alarms):
    #   **Why:** ...    OR    **Why**: ...
    #   **How to apply:** ...    OR    **How to apply**: ...
    if ! grep -qE '^\*\*Why(:\*\*|\*\*:)' "$f" 2>/dev/null \
       || ! grep -qE '^\*\*How to apply(:\*\*|\*\*:)' "$f" 2>/dev/null; then
      MISSING=$((MISSING + 1))
      if [[ "${#SAMPLE[@]}" -lt "$SAMPLE_LIMIT" ]]; then
        # Path relative to projects root for compactness in the banner.
        rel="${f#"$PROJECTS_ROOT/"}"
        SAMPLE+=("$rel")
      fi
    fi
  done < <(find "$mem_dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null)

  # MEMORY.md ↔ files drift. MEMORY.md is the index — its link list should
  # match the on-disk files (excluding MEMORY.md itself).
  index_file="$mem_dir/MEMORY.md"
  [[ -f "$index_file" ]] || continue

  # Collect on-disk filenames as a newline-separated string. macOS ships
  # bash 3.2 which does not support `declare -A` (associative arrays added
  # in bash 4); use a string + grep -Fx instead. CI breakage at v0.9.8
  # macOS-latest confirmed -A fails with "invalid option".
  on_disk_list=""
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == "MEMORY.md" ]] && continue
    on_disk_list+="$base"$'\n'
  done < <(find "$mem_dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null)

  # Extract `(file.md)` references from MEMORY.md index lines. Markdown link
  # syntax `[Title](file.md) ...` — first matching .md token per line.
  in_index_list=""
  while IFS= read -r linked; do
    [[ -n "$linked" ]] || continue
    in_index_list+="$linked"$'\n'
    if ! printf '%s' "$on_disk_list" | grep -qFx -- "$linked"; then
      DRIFT=$((DRIFT + 1))
      if [[ "${#DRIFT_SAMPLE[@]}" -lt "$DRIFT_SAMPLE_LIMIT" ]]; then
        rel="${index_file#"$PROJECTS_ROOT/"}"
        DRIFT_SAMPLE+=("index_orphan: $rel → $linked (link target missing)")
      fi
    fi
  done < <(grep -oE '\([^)]+\.md\)' "$index_file" 2>/dev/null | sed -E 's/^\(|\)$//g')

  # Reverse direction: any on-disk file with no MEMORY.md link.
  while IFS= read -r base; do
    [[ -z "$base" ]] && continue
    if ! printf '%s' "$in_index_list" | grep -qFx -- "$base"; then
      DRIFT=$((DRIFT + 1))
      if [[ "${#DRIFT_SAMPLE[@]}" -lt "$DRIFT_SAMPLE_LIMIT" ]]; then
        rel="${index_file#"$PROJECTS_ROOT/"}"
        DRIFT_SAMPLE+=("file_orphan: $rel → $base (no index link)")
      fi
    fi
  done <<< "$on_disk_list"
done

if [[ "$MISSING" -eq 0 && "$DRIFT" -eq 0 ]]; then
  exit 0
fi

if [[ "$MISSING" -gt 0 ]]; then
  # Build banner. Show first SAMPLE_LIMIT paths, then "+N more" if exceeded.
  joined=$(IFS=, ; echo "${SAMPLE[*]}")
  extra=""
  [[ "$MISSING" -gt "$SAMPLE_LIMIT" ]] && extra=" (+$((MISSING - SAMPLE_LIMIT)) more)"
  echo "[claudemd] §11-EXT mem-audit: $MISSING feedback memories missing **Why:** / **How to apply:** body-structure: ${joined}${extra}. Disable: DISABLE_MEM_AUDIT_HOOK=1" >&2
fi

if [[ "$DRIFT" -gt 0 ]]; then
  # Drift banner — MEMORY.md ↔ files mismatch (v0.9.7).
  # `printf '  - %s\n'` per element, NOT `IFS=$'\n  - '`: IFS is a SET of single
  # chars, so `${arr[*]}` joined on just `\n` and dropped the `  - ` bullet on
  # every line except the first (which got its bullet from the echo prefix).
  drift_extra=""
  [[ "$DRIFT" -gt "$DRIFT_SAMPLE_LIMIT" ]] && drift_extra=" (+$((DRIFT - DRIFT_SAMPLE_LIMIT)) more)"
  echo "[claudemd] §11-EXT mem-audit: $DRIFT MEMORY.md drift entries${drift_extra}:" >&2
  printf '  - %s\n' "${DRIFT_SAMPLE[@]}" >&2
fi

hook_record mem-audit warn "{\"missing\":$MISSING,\"drift\":$DRIFT}" '§11-EXT-mem-audit' "$SESSION_ID"
exit 0
