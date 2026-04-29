#!/usr/bin/env bash
# session-start-check.sh — SessionStart hook.
# 1. Auto-runs install.js when the plugin is present but the manifest is missing
#    or version-mismatched (v0.1.9 / v0.2.5).
# 2. Emits an "upgrade available" banner via additionalContext when the GitHub
#    remote has a newer tag than the local cache max version (v0.4.0).
# Fail-open on any hiccup — SessionStart must never delay the user's session.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch SESSION_START || exit 0

MANIFEST_NEW="$HOME/.claude/.claudemd-manifest.json"
MANIFEST_OLD="$HOME/.claude/.claudemd-state/installed.json"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# upstream_check — emit "upgrade available" SessionStart additionalContext
# banner when remote GitHub tag exceeds local cache max version.
# Always returns 0 (fail-open). Outputs JSON to stdout on banner emit; nothing
# otherwise. Skipped on: DISABLE_UPSTREAM_CHECK=1, sentinel within 24h, jq
# missing, no semver-named cache dirs, network failure, remote ≤ local.
upstream_check() {
  [[ "${DISABLE_UPSTREAM_CHECK:-0}" == "1" ]] && return 0

  local sentinel="$HOME/.claude/.claudemd-state/upstream-check.lastrun"
  mkdir -p "$(dirname "$sentinel")" 2>/dev/null || return 0
  if [[ -f "$sentinel" ]] && command -v platform_stat_mtime >/dev/null 2>&1; then
    local now smtime age
    now=$(date +%s 2>/dev/null) || return 0
    smtime=$(platform_stat_mtime "$sentinel" 2>/dev/null) || return 0
    if [[ -n "$smtime" ]]; then
      age=$(( now - smtime ))
      [[ "$age" -lt 86400 ]] && return 0
    fi
  fi

  command -v jq >/dev/null 2>&1 || return 0

  local cache_parent local_max
  if [[ -n "${CLAUDEMD_CACHE_PARENT:-}" ]]; then
    cache_parent="$CLAUDEMD_CACHE_PARENT"
  else
    cache_parent="$(cd "$PLUGIN_ROOT/.." 2>/dev/null && pwd)" || return 0
  fi
  [[ -d "$cache_parent" ]] || return 0
  # SC2010 avoidance: glob iteration tolerates non-alphanumeric filenames in the
  # cache parent and lets us pre-filter to semver-named dirs before sort -V.
  local entry base
  local_max=$(
    for entry in "$cache_parent"/*; do
      [[ -d "$entry" ]] || continue
      base="${entry##*/}"
      [[ "$base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && printf '%s\n' "$base"
    done | sort -V | tail -1
  )
  [[ -z "$local_max" ]] && return 0

  local remote_url remote_output remote_tag
  remote_url="${CLAUDEMD_REMOTE_URL:-https://github.com/sdsrss/claudemd}"
  read -ra ls_remote_args <<< "${CLAUDEMD_LS_REMOTE_CMD:-git ls-remote}"
  remote_output=$(timeout 3 "${ls_remote_args[@]}" --tags --refs --sort=-v:refname "$remote_url" 'v*.*.*' 2>/dev/null) || return 0
  remote_tag=$(printf '%s' "$remote_output" | head -1 | awk '{print $2}' | sed 's|refs/tags/||')
  [[ -z "$remote_tag" ]] && return 0

  touch "$sentinel" 2>/dev/null || true

  [[ "v$local_max" == "$remote_tag" ]] && return 0
  local newer
  newer=$(printf '%s\n%s\n' "v$local_max" "$remote_tag" | sort -V | tail -1)
  [[ "$newer" != "$remote_tag" ]] && return 0

  jq -cn \
    --arg cur "v$local_max" \
    --arg new "$remote_tag" \
    '{
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ("[claudemd] " + $new + " available (you have " + $cur + "). Run these 4 commands to upgrade:\n/plugin marketplace update claudemd\n/plugin uninstall claudemd@claudemd\n/plugin install claudemd@claudemd\n/reload-plugins\n\nDisable this notice: DISABLE_UPSTREAM_CHECK=1")
      }
    }' 2>/dev/null

  hook_record session-start upstream-banner null 2>/dev/null || true
}

# Manifest-exists path: check for version mismatch (v0.2.5). Pre-0.2.5 this
# was a plain `manifest-exists → exit`. Users who installed 0.2.2 then used
# `/plugin install` on 0.2.3/0.2.4 got silently stuck: CC's marketplace
# lifecycle does not fire the plugin.json `postInstall` field, so install.js
# never ran, and manifest + spec froze at 0.2.2 state. We now re-run install
# when `.claudemd-manifest.json` .version disagrees with the package.json of
# the plugin root we're loading from.
if [[ -f "$MANIFEST_NEW" || -f "$MANIFEST_OLD" ]]; then
  # Authoritative current-plugin version = package.json .version, same source
  # install.js uses for readPluginVersion. Dir basename is unreliable in
  # dev-mode (git checkout basename is not semver).
  PLUGIN_VER=""
  if command -v jq >/dev/null 2>&1 && [[ -r "$PLUGIN_ROOT/package.json" ]]; then
    PLUGIN_VER="$(jq -r '.version // empty' "$PLUGIN_ROOT/package.json" 2>/dev/null || true)"
  fi
  INSTALLED_VER=""
  if [[ -f "$MANIFEST_NEW" ]] && command -v jq >/dev/null 2>&1; then
    INSTALLED_VER="$(jq -r '.version // empty' "$MANIFEST_NEW" 2>/dev/null || true)"
  fi
  # Skip auto-upgrade when either side is unknown — legacy manifests without
  # .version (pre-0.1.9), jq absent, unreadable package.json, etc. — to avoid
  # a re-bootstrap loop on broken state. No upstream check on broken state.
  if [[ -z "$PLUGIN_VER" || -z "$INSTALLED_VER" ]]; then
    exit 0
  fi
  # Match: local install is current. Run upstream check before exiting — this
  # is the canonical "everything in order locally, look outward" branch.
  if [[ "$INSTALLED_VER" == "$PLUGIN_VER" ]]; then
    upstream_check
    exit 0
  fi
  # Mismatch: log intent, then fall through to the install block below which
  # writes the real bootstrap trail. Skip upstream-check on mismatch — the
  # local upgrade is already in flight; banner would compound noise.
  echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) auto-upgrade: manifest $INSTALLED_VER → plugin $PLUGIN_VER" >> "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || true
fi

# node required to run install.js — silent no-op if absent.
command -v node >/dev/null 2>&1 || exit 0

# Background self-install with a 10s ceiling. Detach so a hanging filesystem
# cannot delay session start. Stdout/stderr captured for post-hoc debug.
LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
LOG="$LOG_DIR/claudemd-bootstrap.log"

# Rotate when log exceeds 64 KiB — keep last 32 KiB. Without this the file
# grows unbounded (every SessionStart appends ≥1 line; mismatch path appends
# more). Best-effort: any failure leaves the file as-is.
if [[ -f "$LOG" ]]; then
  LOG_BYTES=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
  if [[ -n "$LOG_BYTES" && "$LOG_BYTES" -gt 65536 ]]; then
    TAIL_TMP="$LOG.tail.$$"
    if tail -c 32768 "$LOG" > "$TAIL_TMP" 2>/dev/null; then
      mv -f "$TAIL_TMP" "$LOG" 2>/dev/null || rm -f "$TAIL_TMP" 2>/dev/null
    else
      rm -f "$TAIL_TMP" 2>/dev/null
    fi
  fi
fi

(
  {
    echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionStart bootstrap → $PLUGIN_ROOT/scripts/install.js"
    timeout 10 node "$PLUGIN_ROOT/scripts/install.js" 2>&1 || echo "[claudemd] bootstrap exited non-zero or timed out"
  } >> "$LOG"
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

hook_record session-start bootstrap null
exit 0
