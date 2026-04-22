#!/usr/bin/env bash
# platform.sh — cross-platform abstractions for stat/find in hooks.

# platform_stat_mtime FILE — echo mtime as epoch seconds.
platform_stat_mtime() {
  local f="$1"
  if stat --format=%Y "$f" >/dev/null 2>&1; then
    stat --format=%Y "$f"
  else
    stat -f %m "$f" 2>/dev/null
  fi
}

# platform_find_newer DIR REFERENCE_FILE — list immediate children (depth ≤ 1)
# newer than REFERENCE_FILE. Depth cap matters in two ways:
#   1. The spec this plugin ships forbids recursive traversal of ~/.claude/
#      (CLAUDE.md §8) — hook behavior must comply with its own rule.
#   2. Callers only care about fresh top-level mkdtemp dirs; descending into
#      them can be expensive when tmp/ accumulates.
platform_find_newer() {
  local dir="$1" ref="$2"
  find "$dir" -maxdepth 1 -newer "$ref" 2>/dev/null | grep -v "^${dir}$" || true
}
