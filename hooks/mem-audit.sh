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
# jq failure loses attribution, not the scan — record + continue (2026-08-16
# audit F4: inline guard was invisible to the consumer gate).
SESSION_ID=""
if hook_require_jq; then
  EVENT=$(hook_read_event) || EVENT=""
  if [[ -n "$EVENT" ]]; then
    SESSION_ID=$(hook_jq_field mem-audit "$EVENT" '.session_id // ""') || SESSION_ID=""
  fi
else
  hook_record_failopen mem-audit jq-missing
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

  # Why/How marker scan, one awk pass over the whole memory dir.
  #
  # v0.18.0 (spec v6.12.0 §11-EXT) — narrowed to feedback_*.md only.
  # project_*.md exempted: incident-log pattern (`project_<topic>_<date>.md`)
  # is fact-only by nature; enforcing Why/How body structure produced 16
  # long-standing non-compliant files across 4 projects without a path to
  # closure. CC memoryTypes.ts still recommends Why/How for project type,
  # but the hook no longer warns when authors omit it.
  #
  # 2026-08-17: this was a shell loop spending `basename` + `wc -c` + two
  # `grep -qE` — four forks per memory file. At 150 files it took 0.93s of this
  # hook's 3s hooks.json budget on a quiet Linux box, and macOS runners are
  # ~4x slower at process creation. The header above already documents the
  # consequence being worked around (the sentinel is touched BEFORE the scan
  # precisely because the loop was outrunning the timeout); this removes the
  # cause. Same defect class as the per-tag loop that lib/memory-tags.sh
  # replaced. Selection, the 400-byte floor, both accepted marker punctuations
  # and find-order sampling are unchanged — awk flushes each file's verdict
  # when the NEXT file starts, so output order still follows find.
  #
  # Byte count is summed as `length($0) + 1` rather than shelling out to
  # `wc -c`: it differs from wc only for a file with no trailing newline, and
  # only by one byte, against a threshold whose stated purpose is "<400 bytes
  # likely empty".
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    MISSING=$((MISSING + 1))
    if [[ "${#SAMPLE[@]}" -lt "$SAMPLE_LIMIT" ]]; then
      # Path relative to projects root for compactness in the banner.
      rel="${f#"$PROJECTS_ROOT/"}"
      SAMPLE+=("$rel")
    fi
  done < <(find "$mem_dir" -maxdepth 1 -type f -name 'feedback_*.md' -exec awk '
      function flush() {
        if (cur != "" && bytes >= 400 && (why == 0 || how == 0)) print cur
      }
      FNR == 1 { flush(); cur = FILENAME; bytes = 0; why = 0; how = 0 }
      {
        bytes += length($0) + 1
        # Both markers must appear at line start. Match BOTH common punctuation
        # forms (CC memoryTypes.ts uses `**Why:**`, but `**Why**:` is also
        # widely used in the wild; accept either to avoid false-positive
        # alarms):  **Why:** … OR **Why**: … / **How to apply:** … OR
        # **How to apply**: …
        if ($0 ~ /^\*\*Why(:\*\*|\*\*:)/) why = 1
        if ($0 ~ /^\*\*How to apply(:\*\*|\*\*:)/) how = 1
      }
      END { flush() }
    ' {} + 2>/dev/null)

  # MEMORY.md ↔ files drift. MEMORY.md is the index — its link list should
  # match the on-disk files (excluding MEMORY.md itself).
  index_file="$mem_dir/MEMORY.md"
  [[ -f "$index_file" ]] || continue

  # Collect on-disk filenames as a newline-separated string. macOS ships
  # bash 3.2 which does not support `declare -A` (associative arrays added
  # in bash 4); use a string + grep -Fx instead. CI breakage at v0.9.8
  # macOS-latest confirmed -A fails with "invalid option".
  # `${f##*/}` rather than `basename` — one fork per file, for a string
  # operation bash does natively (2026-08-17, same pass as the awk scan above).
  on_disk_list=""
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    base="${f##*/}"
    [[ "$base" == "MEMORY.md" ]] && continue
    on_disk_list+="$base"$'\n'
  done < <(find "$mem_dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null)

  # Extract `(file.md)` references from MEMORY.md index lines. Markdown link
  # syntax `[Title](file.md) ...` — first matching .md token per line.
  in_index_list=$(grep -oE '\([^)]+\.md\)' "$index_file" 2>/dev/null | sed -E 's/^\(|\)$//g')
  [[ -n "$in_index_list" ]] && in_index_list="$in_index_list"$'\n'

  # Set difference in awk, both directions, instead of a `printf | grep -qFx`
  # per item (two more forks per entry — 150 entries meant ~300 processes for
  # what is a hash lookup). Input order is preserved, so the 3-item DRIFT_SAMPLE
  # still reports the same first three entries it reported before.
  #
  # The lookup table arrives through ENVIRON, NOT as a second awk input file.
  # The idiomatic `NR == FNR { table[$0]; next }` two-file form is WRONG when the
  # first stream is empty: awk never reads a record from it, so `NR == FNR` is
  # still true for the FIRST record of the second stream and that record is
  # swallowed into the table instead of being tested. A memory dir holding only
  # MEMORY.md is exactly that shape — on_disk_list is empty, and the single
  # index link was silently consumed rather than reported as an index_orphan
  # (mem-audit.test.sh case 9 caught it).
  while IFS= read -r linked; do
    [[ -n "$linked" ]] || continue
    DRIFT=$((DRIFT + 1))
    if [[ "${#DRIFT_SAMPLE[@]}" -lt "$DRIFT_SAMPLE_LIMIT" ]]; then
      rel="${index_file#"$PROJECTS_ROOT/"}"
      DRIFT_SAMPLE+=("index_orphan: $rel → $linked (link target missing)")
    fi
  done < <(MEM_AUDIT_SET="$on_disk_list" awk '
      BEGIN { n = split(ENVIRON["MEM_AUDIT_SET"], a, "\n")
              for (i = 1; i <= n; i++) if (a[i] != "") known[a[i]] = 1 }
      $0 != "" && !($0 in known)' <<<"$in_index_list")

  # Reverse direction: any on-disk file with no MEMORY.md link.
  while IFS= read -r base; do
    [[ -z "$base" ]] && continue
    DRIFT=$((DRIFT + 1))
    if [[ "${#DRIFT_SAMPLE[@]}" -lt "$DRIFT_SAMPLE_LIMIT" ]]; then
      rel="${index_file#"$PROJECTS_ROOT/"}"
      DRIFT_SAMPLE+=("file_orphan: $rel → $base (no index link)")
    fi
  done < <(MEM_AUDIT_SET="$in_index_list" awk '
      BEGIN { n = split(ENVIRON["MEM_AUDIT_SET"], a, "\n")
              for (i = 1; i <= n; i++) if (a[i] != "") known[a[i]] = 1 }
      $0 != "" && !($0 in known)' <<<"$on_disk_list")
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
