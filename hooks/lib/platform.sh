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

# platform_find_newer DIR REFERENCE_FILE — list files newer than REFERENCE_FILE under DIR.
platform_find_newer() {
  local dir="$1" ref="$2"
  find "$dir" -newer "$ref" -type f 2>/dev/null
}
