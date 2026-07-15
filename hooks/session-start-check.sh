#!/usr/bin/env bash
# session-start-check.sh — SessionStart hook.
# 1. Auto-runs install.js when the plugin is present but the manifest is missing
#    or version-mismatched (v0.1.9 / v0.2.5). Upgrade direction only: a manifest
#    NEWER than this hook's own plugin root means the hook is firing from a
#    stale versioned cache dir — v0.36.0 skips the sync (it would downgrade)
#    and banners the refresh commands instead.
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

# v0.9.34: best-effort session_id from SessionStart stdin for audit attribution.
# Fail-open on any read error; SessionStart hooks cannot block. CLAUDE_SESSION_ID
# env var is a fallback when stdin isn't structured.
# v0.27.0: stdin is now read whenever jq is present (not only when session_id
# is missing) — the compact branch below needs the `source` field.
SESSION_ID="${CLAUDE_SESSION_ID:-}"
EVENT=""
SOURCE=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(cat 2>/dev/null || true)
  if [[ -n "$EVENT" ]]; then
    [[ -z "$SESSION_ID" ]] && SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
    SOURCE=$(printf '%s' "$EVENT" | jq -r '.source // ""' 2>/dev/null)
  fi
fi

# v0.27.0 — post-compaction re-read reminder (spec-optimization-plan P6/F4).
# SessionStart fires with source=="compact" after auto/manual compaction
# (docs: code.claude.com/docs/en/hooks). Core §11 post-compaction re-read is a
# self-enforced rule guarding exactly the state where model attention is least
# reliable; this banner makes it hook-assisted. Compact events exit here —
# bootstrap / upgrade-banner / summary-banner are session-START concerns, and
# running install.js mid-session on a compaction event is never desirable.
if [[ "$SOURCE" == "compact" ]]; then
  if [[ "${DISABLE_COMPACT_REREAD_REMINDER:-0}" != "1" ]]; then
    jq -cn '{
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "[claudemd] compaction detected — §11: before continuing L2+ work, re-read the active plan + spec state (compaction may have dropped constraints). Disable: DISABLE_COMPACT_REREAD_REMINDER=1"
      }
    }' 2>/dev/null
    hook_record session-start compact-reminder null '§11-post-compaction' "$SESSION_ID" 2>/dev/null || true
  fi
  exit 0
fi

MANIFEST_NEW="$HOME/.claude/.claudemd-manifest.json"
MANIFEST_OLD="$HOME/.claude/.claudemd-state/installed.json"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# v0.8.0 R-N4 — emit last-session summary banner via additionalContext when
# session-summary.sh wrote one on the prior Stop. Always returns 0 (fail-open).
# Sentinel: rename file after read so banner only fires once. Skipped on:
# DISABLE_SESSION_SUMMARY_BANNER=1, jq missing, file absent, total=0.
emit_session_summary_banner() {
  [[ "${DISABLE_SESSION_SUMMARY_BANNER:-0}" == "1" ]] && return 0
  local f="$HOME/.claude/.claudemd-state/last-session-summary.json"
  [[ -f "$f" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local denies bypasses warns top_section
  denies=$(jq -r '.denies // 0' "$f" 2>/dev/null) || return 0
  bypasses=$(jq -r '.bypasses // 0' "$f" 2>/dev/null) || return 0
  warns=$(jq -r '.warns // 0' "$f" 2>/dev/null) || return 0
  top_section=$(jq -r '.top_section // ""' "$f" 2>/dev/null) || return 0

  # Numeric-guard before arithmetic. jq's `// 0` only substitutes on null /
  # missing, NOT on a wrong-typed value: a corrupt summary whose `denies` is a
  # JSON string ("oops") flows through, and `$((oops + ...))` treats it as an
  # unbound varname under `set -u` → the banner fn crashes the SessionStart
  # hook (exit 1, not fail-open). Coerce any non-integer to 0.
  [[ "$denies"   =~ ^[0-9]+$ ]] || denies=0
  [[ "$bypasses" =~ ^[0-9]+$ ]] || bypasses=0
  [[ "$warns"    =~ ^[0-9]+$ ]] || warns=0

  # Suppress empty banner — session-summary.sh skips writing on total=0,
  # but defensive against partial writes.
  local total=$((denies + bypasses + warns))
  (( total > 0 )) || return 0

  local msg="[claudemd] last session: ${denies} denies, ${bypasses} bypasses, ${warns} warns"
  [[ -n "$top_section" && "$top_section" != "null" ]] && msg+=", top: ${top_section}"
  msg+=". Disable: DISABLE_SESSION_SUMMARY_BANNER=1"

  jq -cn --arg ctx "$msg" '{
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }' 2>/dev/null

  # Rename → consumed. Next Stop will write a fresh summary; this one is done.
  mv -f "$f" "$f.last-shown" 2>/dev/null || rm -f "$f" 2>/dev/null
}

# emit_bootstrap_failed_banner — v0.50.0. Surface a background install.js
# failure from a PRIOR session (hook_spawn_install wrote the sentinel; the
# failure itself was invisible in-session — bootstrap.log only). Emits one
# SessionStart additionalContext JSON object and consumes the sentinel
# (rename → shown once; a repeat failure rewrites it). Always returns 0.
# Skipped on: DISABLE_BOOTSTRAP_FAIL_BANNER=1, jq missing, sentinel absent.
emit_bootstrap_failed_banner() {
  [[ "${DISABLE_BOOTSTRAP_FAIL_BANNER:-0}" == "1" ]] && return 0
  local f="$HOME/.claude/.claudemd-state/bootstrap-failed.json"
  [[ -f "$f" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local ts from to
  ts=$(jq -r '.ts // ""' "$f" 2>/dev/null) || ts=""
  from=$(jq -r '.from // ""' "$f" 2>/dev/null) || from=""
  to=$(jq -r '.to // ""' "$f" 2>/dev/null) || to=""

  local msg="[claudemd] background upgrade failed"
  [[ -n "$ts" ]] && msg+=" at $ts"
  [[ -n "$from" && -n "$to" ]] && msg+=" (manifest $from → plugin $to)"
  msg+=". Details: ~/.claude/logs/claudemd-bootstrap.log. Retrying this session; if this notice recurs, run /claudemd-refresh and restart Claude Code. Disable: DISABLE_BOOTSTRAP_FAIL_BANNER=1"

  jq -cn --arg ctx "$msg" '{
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }' 2>/dev/null

  mv -f "$f" "$f.last-shown" 2>/dev/null || rm -f "$f" 2>/dev/null
  hook_record session-start bootstrap-fail-banner null '' "$SESSION_ID" 2>/dev/null || true
}

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
    if [[ "$smtime" =~ ^[0-9]+$ ]]; then  # numeric-guard before `set -u` arithmetic
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

  # Consume the once-per-24h budget BEFORE the network call. The sentinel used
  # to be touched only after a SUCCESSFUL semver-tag fetch (below), so an
  # offline user / transient git failure / non-semver remote ref never wrote
  # it — and every single SessionStart then re-ran the 3s `git ls-remote`,
  # hanging session start indefinitely. Touching here rate-limits the expensive
  # attempt itself: one network probe per 24h regardless of outcome.
  touch "$sentinel" 2>/dev/null || true

  local remote_url remote_output remote_tag
  remote_url="${CLAUDEMD_REMOTE_URL:-https://github.com/sdsrss/claudemd}"
  read -ra ls_remote_args <<< "${CLAUDEMD_LS_REMOTE_CMD:-git ls-remote}"
  remote_output=$(platform_timeout 3 "${ls_remote_args[@]}" --tags --refs --sort=-v:refname "$remote_url" 'v*.*.*' 2>/dev/null) || return 0
  remote_tag=$(printf '%s' "$remote_output" | head -1 | awk '{print $2}' | sed 's|refs/tags/||')
  [[ -z "$remote_tag" ]] && return 0
  # Defensive semver gate before embedding in jq output. jq's --arg already
  # safe-quotes the value, but a malformed tag (newline-injected, exotic
  # chars from a compromised remote) would still produce a confusing banner.
  # Reject anything that doesn't match strict v<major>.<minor>.<patch>.
  [[ "$remote_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 0

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
        additionalContext: ("[claudemd] " + $new + " available (you have " + $cur + "). Run /claudemd-refresh, then restart Claude Code. Disable this notice: DISABLE_UPSTREAM_CHECK=1")
      }
    }' 2>/dev/null

  hook_record session-start upstream-banner null '' "$SESSION_ID" 2>/dev/null || true
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
    # Versions agree → any bootstrap-failed sentinel is stale (state healed
    # out-of-band, e.g. a manual /claudemd-refresh succeeded). Clear it
    # silently — a "upgrade failed" banner over healthy state is noise.
    rm -f "$HOME/.claude/.claudemd-state/bootstrap-failed.json" 2>/dev/null || true
    # Both helpers can emit a SessionStart additionalContext JSON object. CC
    # parses hook stdout with a strict single-value JSON.parse, so printing two
    # objects back-to-back is INVALID JSON and BOTH banners are silently dropped
    # — the upgrade notice vanishes exactly when the user also had session
    # activity (a summary to show). Capture each (side effects — sentinel touch,
    # file rename, hook_record — still run inside the command substitution) and
    # emit at most ONE object, merging additionalContext when both fire.
    up_json=$(upstream_check)
    sum_json=$(emit_session_summary_banner)
    printf '%s\n%s\n' "$up_json" "$sum_json" | jq -s -c '
      map(select(type == "object" and (.hookSpecificOutput.additionalContext // "") != ""))
      | if length == 0 then empty
        elif length == 1 then .[0]
        else {
          suppressOutput: true,
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: (map(.hookSpecificOutput.additionalContext) | join("\n\n"))
          }
        } end
    ' 2>/dev/null
    exit 0
  fi
  # v0.36.0 — direction gate. INSTALLED_VER newer than this hook's own
  # PLUGIN_VER means CC fired the hook from a STALE versioned cache dir
  # (registration lag after an upgrade). The old fall-through ran the stale
  # root's install.js and regressed ~/.claude spec + manifest every session
  # (reproduced 2026-07-11, bootstrap.log: "auto-upgrade: manifest 9.9.9 to
  # plugin 0.35.0"; tasks/manifest-pluginroot-stale-cache.md). install.js now
  # refuses downgrades on its own; here we also skip the futile spawn and tell
  # the user the fix, which only they can run. Non-semver values fall through
  # to the historical path (dev-mode roots have no reliable ordering).
  if [[ "$PLUGIN_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$INSTALLED_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    NEWER=$(printf '%s\n%s\n' "$PLUGIN_VER" "$INSTALLED_VER" | sort -V | tail -1)
    if [[ "$NEWER" == "$INSTALLED_VER" ]]; then
      mkdir -p "$HOME/.claude/logs" 2>/dev/null || true
      echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) stale plugin root: hook v$PLUGIN_VER < installed v$INSTALLED_VER — auto-sync skipped (would downgrade)" >> "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || true
      jq -cn --arg old "$PLUGIN_VER" --arg new "$INSTALLED_VER" '{
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: ("[claudemd] stale plugin registration: hooks are running from v" + $old + " but v" + $new + " is installed. Auto-sync skipped (a sync from the old dir would downgrade the spec). Fix: run /claudemd-refresh, then restart Claude Code.")
        }
      }' 2>/dev/null
      STALE_EXTRA=$(jq -cn --arg h "$PLUGIN_VER" --arg i "$INSTALLED_VER" '{hook_version:$h, installed_version:$i}' 2>/dev/null) || STALE_EXTRA='null'
      hook_record session-start stale-root "$STALE_EXTRA" '' "$SESSION_ID" 2>/dev/null || true
      exit 0
    fi
  fi
  # Mismatch: log intent, then fall through to the install block below which
  # writes the real bootstrap trail. Skip upstream-check on mismatch — the
  # local upgrade is already in flight; banner would compound noise.
  echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) auto-upgrade: manifest $INSTALLED_VER → plugin $PLUGIN_VER" >> "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || true
fi

# Reached on the mismatch fall-through and the no-manifest (fresh install)
# path — exactly the states a prior failed background install leaves behind.
# Banner it before retrying. Only stdout writer on these paths (stale-root,
# match, and compact branches all exited above), so the single-JSON-object
# contract holds without a merge.
emit_bootstrap_failed_banner

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

# Shared spawn (hook-common.sh): background install with a 10s ceiling,
# detached; writes/clears the bootstrap-failed sentinel on failure/success.
hook_spawn_install "$PLUGIN_ROOT" "$LOG" \
  "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionStart bootstrap → $PLUGIN_ROOT/scripts/install.js" \
  "${INSTALLED_VER:-}" "${PLUGIN_VER:-}"

hook_record session-start bootstrap null '' "$SESSION_ID"
exit 0
