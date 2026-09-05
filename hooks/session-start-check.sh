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
if hook_require_jq; then
  EVENT=$(hook_read_event) || EVENT=""
  if [[ -n "$EVENT" ]]; then
    # First parse routed through hook_jq_field: a broken jq here silently
    # killed the §11-post-compaction reminder (SOURCE=="") with zero telemetry
    # (2026-08-16 audit F4). Once the first parse succeeds jq is known-good,
    # so the second stays bare per the hook_jq_field contract.
    SID_PARSED=$(hook_jq_field session-start "$EVENT" '.session_id // ""') || SID_PARSED=""
    [[ -z "$SESSION_ID" ]] && SESSION_ID="$SID_PARSED"
    SOURCE=$(printf '%s' "$EVENT" | jq -r '.source // ""' 2>/dev/null)
  fi
else
  hook_record_failopen session-start jq-missing
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

# FRESH install = neither manifest shape present. Captured HERE, before the
# block below can act on it, because that block funnels TWO different states —
# fresh install and version mismatch — into one shared bootstrap tail, and
# only the fresh one is allowed to block session start (see the sync branch at
# the tail for why the distinction is load-bearing rather than cosmetic).
FRESH_INSTALL=0
[[ -f "$MANIFEST_NEW" || -f "$MANIFEST_OLD" ]] || FRESH_INSTALL=1

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

  # "since last turn", not "last session" (audit R11-33). The window this counts
  # runs from the previous Stop-hook touch to the Stop that wrote the file, and
  # Stop fires at every turn boundary — so what a fresh session sees here is the
  # PREVIOUS SESSION'S LAST TURN, not its whole run. The old label invited the
  # reader to treat one turn's denies as a session total.
  local msg="[claudemd] since last turn: ${denies} denies, ${bypasses} bypasses, ${warns} warns"
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

# spec_drift_check — 2026-07-27 audit (M6). The ONLY automatic install-integrity
# check was `INSTALLED_VER == PLUGIN_VER`, a version-number comparison: a spec
# file hand-edited in ~/.claude/ (or half-written by an interrupted copy) matched
# on version forever and drifted silently until someone happened to run
# /claudemd-doctor. That is precisely the drift
# feedback_claudemd_spec_single_source_of_truth exists to prevent, and
# scripts/lib/spec-hash.js#compareSpecs — the right check — was imported only by
# the two MANUAL commands (doctor, status), never by a hook.
#
# `cmp -s` rather than a hash: byte-exact, POSIX, no node spawn and no
# sha256sum-vs-shasum platform split, ~1ms for four files. Runs only on the
# versions-agree branch, where the contents are supposed to be identical by
# construction, so a difference is always a defect and never a stale-version
# artifact. Advisory only — reporting is the hook's job, rewriting a
# user-owned file is not. Skipped on: DISABLE_SPEC_DRIFT_BANNER=1, jq missing.
#
# SPEC_DRIFT_IGNORE (2026-07-28): comma-separated basenames, exact match, no
# spaces — e.g. SPEC_DRIFT_IGNORE=OPERATOR.md. The set watched here is every
# shipped spec/*.md, which includes OPERATOR.md, a HUMAN runbook that a user may
# legitimately annotate in their own ~/.claude/ copy. With only the all-or-nothing
# switch, one annotated line meant a banner every single session, and the only
# escape blinded the check for CLAUDE.md / CLAUDE-extended.md too — i.e. the
# predictable end state of a gate that cries wolf is that it stops watching the
# files it exists for. A per-file skip keeps the normative files covered. The
# banner names this switch so it is readable at the moment it is needed.
spec_drift_check() {
  [[ "${DISABLE_SPEC_DRIFT_BANNER:-0}" == "1" ]] && return 0
  command -v jq >/dev/null 2>&1 || return 0
  [[ -d "$PLUGIN_ROOT/spec" ]] || return 0

  # Explicit one-level glob, no descent (§8: no recursive traversal of ~/.claude).
  # Spaces stripped so the banner's own suggested value works verbatim when more
  # than one file drifted (the report joins with ", ").
  local f base installed drifted="" ignore=",${SPEC_DRIFT_IGNORE:-},"
  ignore="${ignore// /}"
  for f in "$PLUGIN_ROOT"/spec/*.md; do
    [[ -f "$f" ]] || continue
    base=$(basename "$f")
    case "$ignore" in *",$base,"*) continue ;; esac
    installed="$HOME/.claude/$base"
    # Absent is not drift: install.js decides WHICH files ship to ~/.claude, and
    # a spec file this version does not install must not raise a banner.
    [[ -f "$installed" ]] || continue
    cmp -s "$f" "$installed" || drifted="${drifted}${drifted:+, }${base}"
  done
  [[ -n "$drifted" ]] || return 0

  hook_record session-start spec-drift \
    "$(jq -cn --arg files "$drifted" '{drifted_files: $files}' 2>/dev/null || echo 'null')" \
    '' "$SESSION_ID" 2>/dev/null || true

  jq -cn --arg files "$drifted" '{
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ("[claudemd] installed spec differs from the shipped spec at the same version: " + $files + ". Someone edited ~/.claude/ directly, or a copy was interrupted. Fix: /claudemd-update (spec edits belong in the plugin, not in ~/.claude/). Intentional local edit? SPEC_DRIFT_IGNORE=\"" + $files + "\" skips just these; DISABLE_SPEC_DRIFT_BANNER=1 disables the whole check.")
    }
  }' 2>/dev/null || true
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

# emit_user_content_banner — v0.75.0. Tell the user, IN SESSION, that install.js
# moved their hand-written ~/.claude/CLAUDE.md aside — and where it went.
#
# install.js has warned about this on stderr since v0.5.3, but stderr from the
# bootstrap goes to claudemd-bootstrap.log on both the sync and the detached
# path, so on the default install route (no /claudemd-install) the warning has
# never been visible. The user-global instructions Claude Code reads in every
# project silently stop applying and nothing says why. The backup was always
# there; what was missing was any way to learn it exists.
#
# Consumed with rm, not the `.last-shown` rename the failure banner uses: this
# is a one-shot notice with no diagnostic afterlife — the backup dir named in
# the message IS the durable artifact — and the rename idiom is already the
# source of a state file nothing ever reaps (ARCHITECTURE.md, R10-21e).
# Skipped on: DISABLE_USER_CONTENT_BANNER=1, jq missing, sentinel absent.
emit_user_content_banner() {
  local f="$HOME/.claude/.claudemd-state/user-content-backup.json"
  [[ -f "$f" ]] || return 0
  # Opt-out CONSUMES the sentinel rather than returning past it (pre-tag review,
  # found independently by both reviewers). Returning early left a fixed-name
  # singleton that nothing reaps — clean-residue's STATE_EPHEMERAL is an
  # allowlist of per-session shapes and does not name it, so only a
  # CLAUDEMD_PURGE=1 uninstall would — which is exactly the R10-21e residue
  # class the `rm`-over-rename choice below cites as its reason for existing.
  # Worse than the leak: unsetting the knob later would then fire a banner
  # naming a backup dir pruneBackups may since have evicted. Opting out of the
  # notice opts out of its bookkeeping too.
  if [[ "${DISABLE_USER_CONTENT_BANNER:-0}" == "1" ]]; then
    rm -f "$f" 2>/dev/null || true
    return 0
  fi
  command -v jq >/dev/null 2>&1 || return 0

  local backup_dir
  backup_dir=$(jq -r '.backupDir // ""' "$f" 2>/dev/null) || backup_dir=""

  local msg="[claudemd] your existing ~/.claude/CLAUDE.md did not look like a claudemd spec (no \"# AI-CODING-SPEC\" H1), so it was treated as your own user-global instructions"
  if [[ -n "$backup_dir" ]]; then
    msg+=" and moved to $backup_dir/CLAUDE.md"
  else
    msg+=" and moved to a ~/.claude/backup-<timestamp>/ directory"
  fi
  msg+=" before the spec was installed over it. Those instructions are NO LONGER in effect. To bring them back, run \`CLAUDEMD_SPEC_ACTION=restore /claudemd-uninstall\`, or merge the two files by hand. Disable this notice: DISABLE_USER_CONTENT_BANNER=1"

  jq -cn --arg ctx "$msg" '{
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }' 2>/dev/null

  rm -f "$f" 2>/dev/null || true
  hook_record session-start user-content-banner null '' "$SESSION_ID" 2>/dev/null || true
}

# semver_cache_max <parent-dir> — print the highest semver-named subdir of
# <parent-dir> (the marketplace versioned-cache layout), empty when none.
# Shared by upstream_check + stale_cache_check. SC2010 avoidance: glob
# iteration tolerates non-alphanumeric filenames in the cache parent and
# pre-filters to semver-named dirs before sort -V.
semver_cache_max() {
  local parent="$1" entry base
  [[ -d "$parent" ]] || return 0
  for entry in "$parent"/*; do
    [[ -d "$entry" ]] || continue
    base="${entry##*/}"
    [[ "$base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && printf '%s\n' "$base"
  done | sort -V | tail -1
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
  local_max=$(semver_cache_max "$cache_parent")
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

# stale_cache_check — emit a "stale registration" banner when the versioned
# cache parent holds a NEWER build than the plugin root this hook runs from.
# Axis upstream_check is blind to: after a release + local marketplace update,
# cache max == remote tag, so the remote>local banner never fires — yet CC is
# still loading hooks from the previously registered older dir. Reproduced
# 2026-07-25: running 0.52.0, cache + remote both 0.54.0, zero banners across
# two shipped releases. Local-only (no network, no 24h sentinel — repeats
# every SessionStart until /claudemd-refresh re-registers the new root).
# Telemetry reuses the `stale-root` event (same condition family as the
# v0.36.0 direction gate; distinguished by cache_max_version in extra).
stale_cache_check() {
  [[ "${DISABLE_UPSTREAM_CHECK:-0}" == "1" ]] && return 0
  command -v jq >/dev/null 2>&1 || return 0
  [[ "${PLUGIN_VER:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 0

  local cache_parent local_max
  if [[ -n "${CLAUDEMD_CACHE_PARENT:-}" ]]; then
    cache_parent="$CLAUDEMD_CACHE_PARENT"
  else
    cache_parent="$(cd "$PLUGIN_ROOT/.." 2>/dev/null && pwd)" || return 0
  fi
  local_max=$(semver_cache_max "$cache_parent")
  [[ -z "$local_max" || "$local_max" == "$PLUGIN_VER" ]] && return 0
  local newer
  newer=$(printf '%s\n%s\n' "$PLUGIN_VER" "$local_max" | sort -V | tail -1)
  [[ "$newer" != "$local_max" ]] && return 0

  jq -cn --arg run "v$PLUGIN_VER" --arg cache "v$local_max" '{
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ("[claudemd] stale plugin registration: hooks are running from " + $run + " but the marketplace cache holds " + $cache + ". Run /claudemd-refresh, then restart Claude Code. Disable this notice: DISABLE_UPSTREAM_CHECK=1")
    }
  }' 2>/dev/null

  local stale_extra
  stale_extra=$(jq -cn --arg h "$PLUGIN_VER" --arg c "$local_max" '{hook_version:$h, cache_max_version:$c}' 2>/dev/null) || stale_extra='null'
  hook_record session-start stale-root "$stale_extra" '' "$SESSION_ID" 2>/dev/null || true
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
    stale_json=$(stale_cache_check)
    up_json=""
    # Cache already newer than the running root → the remote check is
    # redundant this session (and would double-banner); skip it.
    [[ -z "$stale_json" ]] && up_json=$(upstream_check)
    sum_json=$(emit_session_summary_banner)
    drift_json=$(spec_drift_check)
    # Reached here when a PRIOR session's install left the sentinel behind and
    # could not surface it in-session — the detached bootstrap, i.e. the
    # CLAUDEMD_FORCE_ASYNC_BOOTSTRAP path. The fresh path emits it at the tail,
    # in the same session as the overwrite.
    uc_json=$(emit_user_content_banner)
    printf '%s\n%s\n%s\n%s\n%s\n' "$stale_json" "$up_json" "$sum_json" "$drift_json" "$uc_json" | jq -s -c '
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
# Banner it before retrying.
#
# The session-summary banner is emitted here too (2026-07-26 audit). Its only
# call site used to be inside the version-MATCH branch, so the session right
# after every upgrade — and every fresh install — silently showed nothing; the
# state file is not consumed either, so the prior session's summary surfaced one
# session late rather than at all. Two possible writers now, so merge through
# `jq -s` exactly as the match branch does: the hook must emit ONE JSON object.
#
# v0.75.0 — the emit MOVED to the end of the hook (emit_tail_banners below).
# The banner set is computed here, before the bootstrap, because two of these
# helpers CONSUME state the bootstrap is about to rewrite; but on the fresh
# path the bootstrap itself produces a third banner (install.js moved the
# user's own ~/.claude/CLAUDE.md aside), and CC parses hook stdout with a
# strict single-value JSON.parse — printing a second object here and another
# after the install is invalid JSON and silently drops BOTH. So collect, then
# emit exactly once, on every exit path below.
_bf_json=$(emit_bootstrap_failed_banner)
_sum_json=$(emit_session_summary_banner)
_uc_json=""

emit_tail_banners() {
  printf '%s\n%s\n%s\n' "$_bf_json" "$_sum_json" "$_uc_json" | jq -s -c '
    map(select(type == "object" and (.hookSpecificOutput.additionalContext // "") != ""))
    | if length == 0 then empty
      elif length == 1 then .[0]
      else {
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: (map(.hookSpecificOutput.additionalContext) | join("\n\n"))
        }
      } end' 2>/dev/null || true
}

# node required to run install.js — silent no-op if absent. The banners still
# owe the user their emit: they describe state a PRIOR session left behind and
# are consume-once, so skipping the print here drops them permanently.
command -v node >/dev/null 2>&1 || { emit_tail_banners; exit 0; }

# Background self-install with a 10s ceiling. Detach so a hanging filesystem
# cannot delay session start. Stdout/stderr captured for post-hoc debug.
LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || { emit_tail_banners; exit 0; }
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

# v0.75.0 — the FRESH-INSTALL bootstrap runs SYNCHRONOUSLY; every other path
# keeps the detached spawn below.
#
# Detaching exists so a hanging filesystem cannot delay session start, and on
# the UPGRADE path that trade is right: the spec is already on disk at the old
# version, so landing new bytes a few seconds late costs a few seconds of stale
# spec. On the FRESH path there is no old version to fall back on, and the file
# install.js writes — ~/.claude/CLAUDE.md — is user-global context Claude Code
# assembles at session start. A detached job racing that assembly loses by
# construction, so the spec's first appearance in context was pushed to the
# session AFTER this one: the THIRD session counting from `/plugin install`,
# since session 1 has no SessionStart for a plugin that was not loaded when it
# began. Hook ENFORCEMENT was never affected (hooks.json is read straight from
# the plugin, and the rule data lives in the plugin root), but the half of the
# spec that only works by being read was silently two sessions late for anyone
# who did not know to run /claudemd-install.
#
# Affordable because it happens once per machine: install.js measures ~65ms
# (four spec copies + one atomic manifest write). The 4s ceiling is ~60x that
# and strictly under the 5s SessionStart budget in hooks.json — the literal is
# what tests/hooks/hook-budget.test.sh greps, so shrinking that budget without
# shrinking this fails the suite instead of silently getting the hook killed
# mid-copy.
#
# Hitting the ceiling is not a dead end. install.js writes its manifest LAST
# and atomically, so a killed run leaves no manifest and the next SessionStart
# simply re-enters this same fresh path; and we fall through to the detached
# spawn in THIS run, which makes the branch never worse than what it replaces.
# CLAUDEMD_FORCE_ASYNC_BOOTSTRAP=1 opts out entirely.
if [[ "$FRESH_INSTALL" == "1" && "${CLAUDEMD_FORCE_ASYNC_BOOTSTRAP:-0}" != "1" ]]; then
  # `2>/dev/null` BEFORE `>> "$LOG"`, not after (pre-tag review NOTE 4).
  # Redirections apply left to right, so with the log redirect first, a failing
  # `>>` (log file present but unwritable — root-owned, bad mode) reports
  # "Permission denied" on the hook's REAL stderr, which the harness surfaces to
  # the user. Pre-0.75.0 every write on this path lived inside
  # hook_spawn_install's detached `( … ) >/dev/null 2>&1 &` and was swallowed;
  # this branch runs in the foreground, so it has to swallow it itself. The
  # inner `2>&1` still binds install.js's stderr to fd1 = the log.
  if {
    echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionStart fresh-install bootstrap (sync) → $PLUGIN_ROOT/scripts/install.js"
    platform_timeout 4 node "$PLUGIN_ROOT/scripts/install.js" 2>&1
  } 2>/dev/null >> "$LOG"; then
    hook_install_sentinel_clear
    # The install just finished, so its user-content sentinel — if it wrote one
    # — is on disk NOW. Reading it here is the whole reason this branch is
    # synchronous: the session that loses the user's hand-written CLAUDE.md is
    # the session that gets told about it, rather than the next one.
    _uc_json=$(emit_user_content_banner)
    emit_tail_banners
    hook_record session-start bootstrap-sync null '' "$SESSION_ID"
    exit 0
  fi
  # Same left-to-right ordering as above, for the same reason.
  echo "[claudemd] sync bootstrap exited non-zero or timed out — retrying detached" 2>/dev/null >> "$LOG" || true
fi

# Shared spawn (hook-common.sh): background install with a 10s ceiling,
# detached; writes/clears the bootstrap-failed sentinel on failure/success.
hook_spawn_install "$PLUGIN_ROOT" "$LOG" \
  "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionStart bootstrap → $PLUGIN_ROOT/scripts/install.js" \
  "${INSTALLED_VER:-}" "${PLUGIN_VER:-}"

# Detached: the install has not run yet, so any user-content sentinel it writes
# is surfaced by the version-MATCH branch on the next session instead. The same
# deferral covers a sentinel ALREADY on disk when the sync branch above failed
# after install.js had done the backup (pre-tag review NOTE 3): re-reading it
# here would race the atomic write of the detached run just spawned, and the
# banner is consume-once, so the conservative read is next session's.
emit_tail_banners
hook_record session-start bootstrap null '' "$SESSION_ID"
exit 0
