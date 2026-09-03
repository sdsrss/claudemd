#!/usr/bin/env bash
# hook-common.sh — fail-open library for claudemd hooks.
# All functions return safely; callers can exit 0 silently on non-zero return.

# Eager-source the rule-hits leaf lib so every hook that sources hook-common gets
# its helpers at top-level — notably hook_encode_project (ARCH-1), used by the
# hooks OUTSIDE hook_record to encode the cwd for transcript-path lookup. Only
# defines functions (no side effects); hook_record re-sources idempotently.
# `${BASH_SOURCE[0]%/*}` rather than `$(dirname …)`: this runs at source time in
# every hook, so on the PreToolUse:Bash chain it was four `dirname` execs per
# Bash tool call on top of the four each hook spent on its own LIB_DIR
# (0.74 ms/exec measured; 2026-08-29 audit R10-23). The `|| cd .` arm covers an
# invocation whose path carries no slash, where the strip leaves the filename
# itself and `cd` on it fails — the script is then in the cwd.
_HC_LIB_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null || cd .; pwd)"
# shellcheck source=rule-hits.sh
source "$_HC_LIB_DIR/rule-hits.sh" 2>/dev/null || true

# hook_kill_switch NAME
#   returns 0 to proceed, 1 to short-circuit.
hook_kill_switch() {
  [[ "${DISABLE_CLAUDEMD_HOOKS:-0}" == "1" ]] && return 1
  local var="DISABLE_${1}_HOOK"
  [[ "${!var:-0}" == "1" ]] && return 1
  return 0
}

# hook_require_jq — returns 0 if jq is on PATH, 1 otherwise.
#
# Presence, NOT usability: a jq that is present but fails (stub earlier on PATH,
# corrupt binary, missing shared lib, killed by a resource limit) passes this.
# That gap is covered at the first parse by hook_jq_field rather than here,
# because a `jq -n .` probe would add a process spawn to every PreToolUse:Bash
# invocation — the hot path the readonly fast-path exists to keep cheap.
hook_require_jq() {
  command -v jq >/dev/null 2>&1
}

# hook_jq_field HOOK EVENT FILTER
#   Extracts a field from the event JSON and echoes it. On jq failure, records
#   a correctly-attributed fail-open row and returns 1 (caller should exit 0).
#
#   Callers used `FIELD=$(… | jq -r '…' 2>/dev/null)` and then branched on the
#   VALUE, so a jq that exited non-zero produced "" and fell into the ordinary
#   "not the tool/event I handle" early exit — indistinguishable in telemetry
#   from "rule not applicable" (2026-07-28 audit H1). Use this for the FIRST
#   parse in a hook; once it succeeds, jq works and later parses may stay bare.
#
#   Reason attribution: jq failing can mean the input is not JSON (bad-event)
#   or that jq itself is broken (jq-broken). The disambiguating `jq -n .` runs
#   ONLY on the failure path, so the success path costs nothing extra.
hook_jq_field() {
  local hook="$1" event="$2" filter="$3" out
  if out=$(printf '%s' "$event" | jq -r "$filter" 2>/dev/null); then
    printf '%s' "$out"
    return 0
  fi
  if jq -n . >/dev/null 2>&1; then
    hook_record_failopen "$hook" bad-event
  else
    hook_record_failopen "$hook" jq-broken
  fi
  return 1
}

# hook_read_event — reads stdin JSON to stdout; empty stdout on error.
#
# `read -r -d ''` rather than `$(cat)`: `cat` is an exec, and this runs once per
# hook on every PreToolUse:Bash call (0.73 ms/exec measured, four hooks per call;
# 2026-08-29 audit R10-23). No hook event contains a NUL, so the read consumes
# stdin to EOF and returns non-zero AT that EOF with the payload already
# assigned — the status is deliberately not checked, the emptiness test below is
# what distinguishes "no event" from "an event".
hook_read_event() {
  local input=""
  IFS= read -r -d '' input 2>/dev/null
  [[ -n "$input" ]] || return 1
  printf '%s' "$input"
}

# hook_read_bash_fields HOOK EVENT
#   Sets HOOK_TOOL_NAME + HOOK_CMD from ONE jq spawn. Failure attribution is
#   hook_jq_field's, verbatim: a present-but-broken jq records `jq-broken`, a
#   non-JSON event records `bad-event`, and the caller exits 0 on return 1.
#   This is the blessed FIRST parse for the PreToolUse:Bash chain.
#
#   Why one call: each of the four hooks spawned two (`.tool_name`, then
#   `.tool_input.command`) on EVERY Bash tool call — including the read-only
#   fast-path those two fields exist to reach. Eight jq spawns per call across
#   the chain at 1.98 ms each, to answer a question one spawn answers.
#
#   NUL-separated, not newline- or tab-separated: `.tool_input.command` is
#   arbitrary user text that routinely contains both. Bash cannot hold a NUL in
#   a variable, so the fields are read off a redirect with `read -r -d ''`; a
#   command substitution would drop the separators silently and glue the two
#   fields into one.
#
#   One widened case, deliberate: an event that is valid JSON but whose
#   `.tool_input` is a scalar or array now records `bad-event` and returns 1,
#   where the two-call version read `.tool_name` successfully and exited at the
#   not-my-tool check with no row. Both ALLOW; the new direction is one more row
#   in the log, on a shape that is malformed for this hook's purposes either way
#   (pre-tag review of v0.71.0). The reason name is imprecise for it — the event
#   parsed — and is kept rather than widening the canonical reason list in
#   docs/RULE-HITS-SCHEMA.md for a rate-limited edge case.
hook_read_bash_fields() {
  local hook="$1" event="$2" got=0
  HOOK_TOOL_NAME=""
  HOOK_CMD=""
  {
    IFS= read -r -d '' HOOK_TOOL_NAME &&
      IFS= read -r -d '' HOOK_CMD && got=1
  } < <(printf '%s' "$event" | jq -j '
      ((.tool_name // "") | tostring) + "\u0000" +
      ((.tool_input.command // "") | tostring) + "\u0000"' 2>/dev/null)
  if (( got )); then
    # `$(…)` strips ALL trailing newlines; `read -d ''` strips none. Callers
    # branch on and regex-match these values, and `hook_is_readonly_bash`
    # rejects a command carrying a newline — so a trailing "\n" surviving here
    # would drop `ls\n` off the fast-path it took before this refactor. Restore
    # the command-substitution semantics exactly. Each iteration removes one
    # byte from a finite string, so both loops terminate.
    while [[ "$HOOK_TOOL_NAME" == *$'\n' ]]; do HOOK_TOOL_NAME="${HOOK_TOOL_NAME%$'\n'}"; done
    while [[ "$HOOK_CMD" == *$'\n' ]]; do HOOK_CMD="${HOOK_CMD%$'\n'}"; done
    return 0
  fi
  if jq -n . >/dev/null 2>&1; then
    hook_record_failopen "$hook" bad-event
  else
    hook_record_failopen "$hook" jq-broken
  fi
  return 1
}

# hook_read_telemetry_ids EVENT
#   Sets SESSION_ID + TOOL_USE_ID + EVENT_CWD from ONE jq spawn — the three
#   fields every PreToolUse:Bash hook passes to hook_record / hook_deny.
#
#   Four hooks each hand-copied two or three single-field extractions of these
#   (2, 2, 3 and 3 spawns), which is both the duplication this repo keeps
#   converging and, at 1.98 ms/spawn, the largest remaining cost on the
#   post-trigger path (2026-08-29 audit R10-23).
#
#   No failure attribution here, unlike hook_read_bash_fields: a hook only
#   reaches this after its first parse succeeded, so jq is known to work, and
#   all three fields are legitimately absent in valid events. Empty is a value,
#   not an error.
hook_read_telemetry_ids() {
  local event="$1" _v _s
  SESSION_ID=""
  TOOL_USE_ID=""
  EVENT_CWD=""
  # shellcheck disable=SC2034  # all three are set for the CALLER; read back below via ${!_v}
  {
    IFS= read -r -d '' SESSION_ID &&
      IFS= read -r -d '' TOOL_USE_ID &&
      IFS= read -r -d '' EVENT_CWD
  } < <(printf '%s' "$event" | jq -j '
      ((.session_id // "") | tostring) + "\u0000" +
      ((.tool_use_id // "") | tostring) + "\u0000" +
      ((.cwd // "") | tostring) + "\u0000"' 2>/dev/null)
  # Match `$(…)` trailing-newline semantics, as hook_read_bash_fields does —
  # these values are compared and interpolated into JSON rows by the callers.
  for _v in SESSION_ID TOOL_USE_ID EVENT_CWD; do
    _s="${!_v}"
    while [[ "$_s" == *$'\n' ]]; do _s="${_s%$'\n'}"; done
    printf -v "$_v" '%s' "$_s"
  done
  return 0
}

# hook_memfile_was_read TRANSCRIPT MEMFILE
#   0 = MEMFILE was opened this session, 1 = it was not (or cannot be known:
#   no transcript, unreadable, missing arg — fail toward "not read", which costs
#   a redundant hint or a deny the agent can answer by opening the file).
#
#   The test anchors on a tool-input `file_path` FIELD, never a bare path
#   substring, and this is why the predicate has one home. Both spellings are
#   accepted: Claude Code writes compact JSON (`"file_path":"…"`), the spaced
#   form guards a pretty-printer drift. -F, so `.` and `-` in the path need no
#   escaping.
#
#   memory-read-check.sh's deny gate was fixed to the field anchor in the
#   2026-08-29 audit (R10-01): the hint's additionalContext banner embeds the
#   same absolute path and is flushed to the transcript, so `grep -qF -- "$PATH"`
#   was satisfied by the HINT's own output and the HARD gate could not fire in
#   its flagship scenario — prompt matches a ship tag, hint lists the runbook,
#   agent pushes without ever opening it. memory-prompt-hint.sh kept the bare
#   substring for another round (R11-28): the same self-satisfying match, this
#   time suppressing a hint for a file nobody read. Assistant prose that merely
#   quotes a path disarms the substring form the same way.
hook_memfile_was_read() {
  local _transcript="${1:-}" _memfile="${2:-}"
  [[ -n "$_transcript" && -n "$_memfile" && -f "$_transcript" ]] || return 1
  grep -qF -e "\"file_path\":\"$_memfile\"" -e "\"file_path\": \"$_memfile\"" \
    -- "$_transcript" 2>/dev/null
}

# hook_deny HOOK_NAME REASON — emits PreToolUse deny JSON, exits 0.
hook_deny() {
  local _hook="$1" reason="$2"
  jq -cn --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }' 2>/dev/null
  exit 0
}

# hook_record HOOK EVENT [EXTRA_JSON]
#   Appends to rule-hits jsonl via rule-hits.sh (sourced lazily).
hook_record() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$lib_dir/rule-hits.sh" 2>/dev/null || return 0
  rule_hits_append "$@"
}

# hook_record_failopen HOOK REASON
#   Records a `fail-open` event in rule-hits.jsonl with rate limiting (one
#   event per HOOK+REASON per 60s). Pre-this, fail-open exits (jq-missing /
#   bad-json / patterns-missing) left zero trace — operators couldn't tell
#   "hook silently bypassed" from "hook didn't trigger." That blind spot
#   biases §13.1 self-audit data: every silently-skipped enforcement looks
#   identical to "rule wasn't relevant," so demote-candidate decisions get
#   the wrong baseline.
#
# Rate limit rationale: a misconfigured environment (jq uninstalled) would
# fire on every hook invocation otherwise. 60s/reason caps log growth at
# ≤1440 events/day per (hook,reason) — surfaces the issue without flooding.
# Reasons (canonical):
#   jq-missing       prerequisite jq binary not on PATH
#   bad-event        stdin JSON unreadable / truncated
#   patterns-missing patterns file unreadable / absent
#   prereq-missing   other prerequisite (settings, state dir) unavailable
hook_record_failopen() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0
  local hook="${1:-unknown}"
  local reason="${2:-unspecified}"

  local state_dir="$HOME/.claude/.claudemd-state"
  mkdir -p "$state_dir" 2>/dev/null || return 0
  # State file: fail-open-<hook>-<reason>. Replace `/`,`.` for filesystem safety
  # and keep filename printable (defense against future reasons with slashes).
  local stamp
  stamp=$(printf '%s-%s' "$hook" "$reason" | tr '/. ' '___')
  local marker="$state_dir/failopen-${stamp}.ts"

  local now
  now=$(date +%s 2>/dev/null) || return 0
  if [[ -r "$marker" ]]; then
    local last
    last=$(cat "$marker" 2>/dev/null) || last=0
    [[ -z "$last" ]] && last=0
    if (( now - last < 60 )); then
      return 0
    fi
  fi
  printf '%s' "$now" > "$marker" 2>/dev/null || return 0

  # Emit via rule_hits_append. extra carries the reason as structured JSON.
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$lib_dir/rule-hits.sh" 2>/dev/null || return 0
  # `jq` may be the very thing missing. Inline the JSON construction so
  # fail-open accounting itself doesn't depend on jq for the `extra` payload.
  local extra=""
  if command -v jq >/dev/null 2>&1; then
    extra=$(jq -cn --arg r "$reason" '{reason:$r}' 2>/dev/null) || extra=""
  fi
  if [[ -z "$extra" || "$extra" == "null" ]]; then
    # Manually-escaped reason. Reasons are caller-supplied literal tokens
    # (jq-missing / jq-broken / bad-event / patterns-missing / prereq-missing)
    # — no untrusted input. Still prefer minimal escape over interpolating wild.
    #
    # This branch used to be guarded on jq being ABSENT, so a jq that was
    # present but failing produced `extra=null` and threw away the reason —
    # the row said "something failed open" without saying what (2026-07-28
    # audit H1). Keying on "jq produced nothing" covers both.
    local escaped="${reason//\"/\\\"}"
    extra="{\"reason\":\"$escaped\"}"
  fi
  rule_hits_append "$hook" "fail-open" "$extra" '§hooks-fail-open'
}

# hook_is_readonly_bash CMD
#   Returns 0 if CMD is "definitely read-only and side-effect free" — caller
#   may safely exit 0 without running heavier hook logic. Returns 1 (proceed)
#   in all uncertain cases. Conservative by design: false negatives are free
#   (just do more work), false positives could skip a real safety check.
#
#   Used by R-N5 fast-path in the four PreToolUse:Bash hooks. Shipped opt-IN in
#   v0.8.3; the four callers now gate on ${BASH_READONLY_FAST_PATH:-1} != 0, so
#   the fast path is ON by default and BASH_READONLY_FAST_PATH=0 is the opt-OUT.
#   With it set to 0 the callers do not invoke this function at all and behavior
#   is byte-identical to v0.8.2.
#
#   Reject criteria — any of these → return 1:
#     * Shell metacharacters introducing a second command, redirect, or
#       substitution: ; | & > < ` $( ${ \n
#     * First token not in the safe-reader whitelist
#     * For `git`: subcommand not in the read-only subcommand whitelist
#       (excludes branch / tag / config because those have destructive
#       sub-flags like -d/-D/-m/-c)
hook_is_readonly_bash() {
  local cmd="$1"
  case "$cmd" in
    *';'*|*'|'*|*'&'*|*'>'*|*'<'*|*'`'*) return 1 ;;
    *'$('*|*'${'*) return 1 ;;
    *$'\n'*) return 1 ;;
  esac
  # Trim leading whitespace, take first token via parameter expansion (no fork).
  local trimmed="${cmd#"${cmd%%[![:space:]]*}"}"
  local first="${trimmed%%[[:space:]]*}"
  case "$first" in
    ls|cat|head|tail|wc|stat|date|pwd|echo|printf|sleep|file|which|type|basename|dirname|realpath|true|false)
      return 0 ;;
    # `env` REMOVED (v0.23.11): `env <cmd>` executes an arbitrary command, so it
    # is NOT readonly — whitelisting it let `env rm -rf $VAR` / `env npx <pkg>`
    # skip the readonly fast-path and bypass ALL four PreToolUse:Bash enforcement
    # hooks. First-token matching can't distinguish bare `env` (print env, safe)
    # from `env <cmd>` (exec), so it must not be on the safe-reader list.
    git)
      local rest="${trimmed#git}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      local sub="${rest%%[[:space:]]*}"
      case "$sub" in
        log|status|diff|show|rev-parse|rev-list|describe|blame|ls-files|ls-tree|cat-file)
          return 0 ;;
        # `remote` and `reflog` are whole subcommand FAMILIES, and both contain
        # writers: `git remote add|rename|remove|set-url|set-head|prune|update`
        # and `git reflog expire|delete`. Admitting the family name meant those
        # took the fast path, which exits before all four PreToolUse:Bash
        # enforcement hooks — the same shape as the `env` entry documented
        # above, and a contract violation even though no gate denies them today
        # (2026-08-29 audit R10-20). Only the reading verbs qualify; the check
        # is on the SECOND-level word, empty (bare `git remote`) included.
        remote|reflog)
          local rest2="${rest#"$sub"}"
          rest2="${rest2#"${rest2%%[![:space:]]*}"}"
          # `-v` / `--verbose` are git's own PRE-subcommand flags here, not the
          # subcommand — `git remote -v add evil <url>` adds the remote and exits
          # 0 (verified against git 2.43.0). Accepting them as a terminal verb
          # let every writer through behind one flag, so they are STRIPPED and
          # the real verb is read after them (0.70.0 pre-tag review, HIGH-2).
          local w2
          while :; do
            w2="${rest2%%[[:space:]]*}"
            case "$w2" in
              -v|--verbose) ;;
              *) break ;;
            esac
            # `${rest2#*[[:space:]]}` is a no-op when rest2 holds no whitespace
            # (i.e. the flag is the LAST word), which spun this loop forever —
            # caught by a probe that hung rather than by a test. Strip the word
            # by length instead, then the leading blanks.
            rest2="${rest2:${#w2}}"
            rest2="${rest2#"${rest2%%[![:space:]]*}"}"
          done
          case "$w2" in
            ''|show|get-url) return 0 ;;
          esac
          ;;
      esac
      ;;
  esac
  return 1
}

# hook_spawn_install PLUGIN_ROOT LOG_FILE HEADER [FROM_VER] [TO_VER]
# Shared background install.js runner — single source for the session-start
# bootstrap and the version-sync piggy-back (2026-07-15 seam audit: the two
# hand-copied spawn blocks had already drifted once). Detached, 10s ceiling,
# stdout+stderr appended to LOG_FILE. Success clears the bootstrap-failed
# sentinel; failure (non-zero exit or timeout) rewrites it so the NEXT
# SessionStart can banner the otherwise-silent background failure.
# Caller must have sourced platform.sh (platform_timeout) — both callers do;
# if it is missing the run fails and the sentinel records that, which is the
# desired visible-failure behavior, not a silent skip.
hook_spawn_install() {
  local plugin_root="$1" log="$2" header="$3" from="${4:-}" to="${5:-}"
  local state_dir="$HOME/.claude/.claudemd-state"
  local sentinel="$state_dir/bootstrap-failed.json"
  # Versions land in hand-built JSON — constrain to the semver-ish charset
  # (dev-mode roots can carry arbitrary package.json version strings).
  from=$(printf '%s' "$from" | tr -cd '0-9A-Za-z._-')
  to=$(printf '%s' "$to" | tr -cd '0-9A-Za-z._-')
  (
    {
      echo "$header"
      if platform_timeout 10 node "$plugin_root/scripts/install.js" 2>&1; then
        rm -f "$sentinel" 2>/dev/null || true
      else
        echo "[claudemd] bootstrap exited non-zero or timed out"
        mkdir -p "$state_dir" 2>/dev/null \
          && printf '{"ts":"%s","from":"%s","to":"%s"}\n' \
               "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$from" "$to" > "$sentinel" 2>/dev/null \
          || true
      fi
    } >> "$log"
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

# hook_strip_heredoc_bodies — stdin → stdout, heredoc BODIES blanked.
#
# SINGLE SOURCE for the sibling hooks' pre-match strip (2026-07-25 deep audit).
# pre-bash-safety-check.sh had gained a terminator LOOKAHEAD guard — only treat
# `<<WORD` as a heredoc opener when a matching terminator line actually follows —
# but the two hand-copied implementations in memory-read-check.sh and
# ship-baseline-check.sh never got it. Consequence: any `<<` that is really a
# left-shift or quoted text (`echo $((1<<n)) && git push`, `echo "a<<b"; git push`)
# opened a phantom heredoc that swallowed the rest of the command, so the §11
# MEMORY.md gate and the §7 ship-baseline gate both stopped seeing the trigger.
# Verified live on both hooks before the fix; pre-bash denied the same shapes.
#
# Two behaviours the copies also disagreed on, resolved here:
#   - the opener line keeps everything except the `<<TAG` token itself. The old
#     memory-read copy truncated at `<<`, which discards a real trailing trigger
#     (`cat <<EOF && git push` — bash runs that push).
#   - body lines are blanked, not dropped, so line-anchored callers keep their
#     line numbering; a caller that flattens sees the same thing either way.
# bash 3.2 (macOS /bin/bash) cannot parse a heredoc nested inside `$( … )`:
# its command-substitution scanner counts the parens and quotes in the heredoc
# BODY, and this awk program has plenty of both — the file then fails to source
# at all, taking every hook with it. `read -r -d ''` assigns the same text
# without nesting. It returns non-zero at EOF, hence the `|| true`.
IFS= read -r -d '' HOOK_HEREDOC_AWK <<'AWKPROG' || true
{ lines[NR] = $0 }
END {
  n = NR
  for (i = 1; i <= n; i++) {
    if (blank[i]) { print ""; continue }
    line = lines[i]
    if (match(line, /<<-?[ \t]*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/)) {
      tok = substr(line, RSTART, RLENGTH)
      dash = (substr(tok, 3, 1) == "-")
      tag = tok
      sub(/^<<-?[ \t]*/, "", tag)
      gsub(/['"]/, "", tag)
      term = 0
      for (j = i + 1; j <= n; j++) {
        t = lines[j]
        # `<<-` (and only `<<-`) lets the terminator be indented, and bash strips
        # TABS there, not spaces. The unconditional strip made a plain `<<EOF`
        # terminate on an indented `EOF` that bash treats as body text, so the
        # stripper stopped early and handed the REST of the real body to the
        # detectors as commands (2026-07-27 audit, L1 — the computed-but-unread
        # `dash` variable was the tell that this guard was intended).
        if (dash) sub(/^\t+/, "", t)
        sub(/[ \t]+$/, "", t)
        if (t == tag) { term = j; break }
      }
      # No terminator anywhere below → this `<<` is a left-shift or quoted text,
      # NOT a heredoc opener. Leave the line untouched.
      if (term > 0) {
        for (j = i + 1; j <= term; j++) blank[j] = 1
        line = substr(line, 1, RSTART - 1) substr(line, RSTART + RLENGTH)
      }
    }
    print line
  }
}
AWKPROG

hook_strip_heredoc_bodies() {
  # An empty program would make awk emit NOTHING, and every consuming gate would
  # then match against an empty command and allow everything — deaf, not loud,
  # the opposite of the hook_record_failopen posture used elsewhere here
  # (2026-07-27 audit, L2). Defensive today: the `read -r -d ''` assignment above
  # is unconditional. Degrade to passthrough, which costs heredoc-body FPs and
  # never costs a bypass.
  if [[ -z "${HOOK_HEREDOC_AWK:-}" ]]; then
    hook_record_failopen hook-common heredoc-awk-empty 2>/dev/null || true
    cat
    return
  fi
  awk "$HOOK_HEREDOC_AWK"
}

# hook_flatten_cmd — stdin → stdout, one line, with NEWLINES turned into real
# command separators (`;`) rather than spaces.
#
# SINGLE SOURCE for the trigger-anchor flattening in memory-read-check.sh and
# ship-baseline-check.sh (2026-07-25 deep audit). Both hooks anchor their trigger
# regex on `(^|[[:space:]]*[;&|]+[[:space:]]*)` — a real separator or start of
# command — and both flattened with `tr '\n' ' '`. A newline IS a command
# separator in shell, so collapsing it to a space erased the anchor: in
#     npm test
#     git push origin main
# the push is neither at `^` nor after `[;&|]`, and BOTH gates silently declined
# to fire. Multi-line bash blocks are the ordinary way these commands get written,
# so this was the common case, not an edge one. Verified live on both hooks with
# single-line controls denying.
#
# A trailing backslash is a LINE CONTINUATION, not a separator — those lines are
# joined instead, so `git \` + newline + `push` stays one command.
#
# 2026-07-27 audit: the join is decided on the PARITY of the trailing backslash
# run, not its presence. `\\` is an escaped literal backslash, so the newline
# after it still terminates the command and bash runs both — the old
# unconditional `sub(/\\$/, "")` joined them anyway, and `echo a\\` + newline +
# `git push origin main` left the push at neither `^` nor a separator, blinding
# the §7 and §11 gates. Odd run = real continuation (last backslash escapes the
# newline); even run = literal backslashes, newline separates.
hook_flatten_cmd() {
  awk '{
    nb = 0
    if (match($0, /\\+$/)) nb = RLENGTH
    if (nb % 2 == 1) printf "%s", substr($0, 1, length($0) - 1)
    else printf "%s;", $0
  } END { print "" }'
}

# hook_trigger_view — stdin → stdout, the canonical TRIGGER-MATCH view of a
# command: heredoc bodies blanked, newlines turned into real separators, quoted
# bodies emptied.
#
# SINGLE SOURCE for every hook whose trigger regex anchors on
# `(^|[[:space:]]*[;&|]+[[:space:]]*)` (2026-07-27 audit, H1/M1). v0.58.0
# extracted the two stages above but rewired only two of the three consumers:
# banned-vocab-check.sh kept `tr '\n' ' '` under a comment claiming parity with
# both siblings, so a `git commit` on line 2+ never reached the §10-V scan; and
# memory-read-check.sh flattened without the quote strip, so a newline inside an
# `-m` payload manufactured the very `;` the trigger anchors on and the gate
# fired on quoted prose. Naming consumers is what failed — `trigger-view-parity`
# derives the set from the source and requires each member to call this.
#
# Order is load-bearing, in all three stages:
#   strip heredocs FIRST — the flatten manufactures separators, so an unstripped
#     body would hand its own lines to the trigger as commands;
#   strip quotes LAST — a multi-line `-m` payload is a single line by then, so
#     one line-based sed catches it (see feedback_sed_line_based_misses_multiline).
# Emptying quoted bodies can only REMOVE trigger matches, never add them. It is
# NOT free: a runner payload IS a real invocation inside quotes, so
# `bash -lc "npm ci && git push"`, `sh -c 'npm test; npm publish'` and
# `ssh host 'cd r && git push'` stop tripping the §10-V and §11 triggers. Measured
# in the v0.62.0 pre-tag review (old view FIRE → new view quiet; bare `git push`
# and `git commit -m "x" && git push` unchanged). Accepted for now because
# ship-baseline-check.sh — the gate that guards releases — has had exactly this
# blind spot since v0.23.11, so the three gates are now consistent rather than
# one of them being newly blind; and because the alternative was the live
# false-DENY this recipe fixes (a newline inside an `-m` payload manufacturing
# the separator the anchor needs). Closing it means unwrapping `-c` / ssh payloads
# before the strip — see tasks/audit-2026-07-27-deferred.md.
#
# QUOTE STRIPPING IS ONE PASS (2026-09-02 audit R11-05). It used to be
#   sed -E 's/"[^"]*"/""/g' | sed -E "s/'[^']*'/''/g"
# which is the same pair pre-bash-safety-check.sh:194-204 replaced with a state
# machine in v0.47.1, for the reason spelled out there: single- and double-quote
# context are MUTUALLY EXCLUSIVE in the shell, so two passes that each ignore the
# other's context pair the closing quote of one region with the opening quote of
# the NEXT and delete the command in between. Here the double-quote pass ran
# first, so two single-quoted arguments each containing one `"` —
#   grep 'a"b' f && git push origin main && grep 'c"d' g
# — collapsed to `grep '' g;`. The push was invisible to all three consumers
# (ship-baseline §7 HARD, memory-read-check §11 HARD, banned-vocab Path 2) and
# nothing emitted a bypass row.
#
# This is the STRIP half of pre-bash's machine with the unwrap rules removed:
# every terminated body becomes its empty marker (`''` / `""`), which is what the
# seds did and what keeps token boundaries intact. No `$`-body preservation
# either — this view feeds trigger regexes, not a §8 verdict, and emptying can
# only remove matches. An unterminated quote keeps its body, matching the seds
# (no pair to match) rather than pre-bash's verdict-side handling.
HOOK_TRIGGER_QUOTE_AWK='
BEGIN { RS = "\004" }
{
  n = length($0); st = 0; final = ""; buf = ""
  for (i = 1; i <= n; i++) {
    ch = substr($0, i, 1)
    if (st == 0) {
      if (ch == "\047")      { st = 1; buf = "" }
      else if (ch == "\"")   { st = 2; buf = "" }
      else                     final = final ch
    } else if (st == 1) {
      if (ch == "\047") { final = final "\047\047"; st = 0; buf = "" }
      else buf = buf ch
    } else {
      if (ch == "\"")   { final = final "\"\"";     st = 0; buf = "" }
      else buf = buf ch
    }
  }
  # Unterminated region: re-emit the opening quote and the body verbatim, which
  # is what the seds left behind (they had no pair to match).
  if (st == 1)      final = final "\047" buf
  else if (st == 2) final = final "\"" buf
  printf "%s", final
}'

hook_trigger_view() {
  hook_strip_heredoc_bodies | hook_flatten_cmd | awk "$HOOK_TRIGGER_QUOTE_AWK"
}

# HOOK_GIT_GLOBAL_FLAGS — ERE fragment for git's global options, to be spliced
# between `git` and its subcommand in a trigger regex:
#
#     "(^|[[:space:]]*[;&|]+[[:space:]]*)git${HOOK_GIT_GLOBAL_FLAGS}[[:space:]]+push([[:space:]]|$)"
#
# SINGLE SOURCE for every trigger that keys on a git SUBCOMMAND. Without it the
# gates required `git` and the verb to be adjacent, so `git -C /repo push`,
# `git --git-dir=… push` and `git -C /repo commit -m …` — pushing a repo from
# somewhere else, an ordinary agent shape — walked past the §7 red-CI gate, the
# §11 memory-read gate and the §10-V commit scan at once, emitting no bypass row
# on the way (2026-08-29 audit R10-05). banned-vocab-check.sh had a private
# `(-c <val>)*` group covering one flag of the family, case-sensitively.
#
# Same recipe as pre-bash-safety-check.sh's NPX_GLOBAL_FLAGS, which solved this
# exact problem on the §8 side (`npm --prefix ./pkgs exec <pkg>`) and was never
# shared — that non-sharing IS the finding. Kept as a separate constant rather
# than folding the two together: NPX_GLOBAL_FLAGS lives inside a §8 deny gate
# whose sourcing failure mode is its own subject, and an indirection there would
# trade a duplicated literal for a new silent-fail-open path.
#
# A bare word is admitted ONLY as the argument of a preceding flag; one standing
# alone is a different subcommand, so `git status push` still does not match.
# tests/hooks/trigger-view-parity.test.sh derives the consumer set from source
# and requires every git-subcommand trigger to reference this.
# shellcheck disable=SC2034  # consumed by the hooks that source this file
HOOK_GIT_GLOBAL_FLAGS='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'

# HOOK_USER_TURN_JQ — a jq `def is_user_turn:` prelude, prepended to any jq
# program that needs the last REAL typed user turn (a turn boundary).
#
# SINGLE SOURCE with scripts/lib/transcript-user-turn.js#isUserTurn; the pair is
# held together by tests/scripts/user-turn-parity.test.js over the shared corpus
# tests/fixtures/user-turn-shapes.jsonl. Rationale for each clause lives in the
# JS module's header — keep the two in step, the parity test will say if not.
#
# 2026-07-27 audit (H2): three consumers (banned-vocab Path 2, session-end
# §11 net, sampling-audit denominators) each spelled this differently while all
# three cited feedback_cc_user_content_string_vs_array. Divergent case: array
# content carrying a text block — a prompt with an attachment — which
# banned-vocab did not count, leaving an interrupted turn's stale prose inside
# the §10-V scan window (the v0.23.19 deny loop through a new content shape).
#
# `read -r -d ''` rather than `$(cat <<EOF)`: bash 3.2 cannot parse a heredoc
# nested in a command substitution (feedback_bash32_nested_heredoc_cmdsubst).
# shellcheck disable=SC2034  # consumed by the hooks that source this file
# (banned-vocab-check.sh, session-end-check.sh), which shellcheck cannot see when
# it lints the library in isolation. HOOK_HEREDOC_AWK above escapes the warning
# only because it also has an in-file consumer.
IFS= read -r -d '' HOOK_USER_TURN_JQ <<'JQPROG' || true
def is_user_turn:
  (.type? == "user")
  and (.isMeta? != true)
  # `.message` must be an OBJECT before `.message.content` is asked for: on a
  # non-object (`"message": "hello"`) jq's `.message.content?` yields EMPTY
  # rather than false, so `map(is_user_turn)` returns a SHORTER array than its
  # input and every index after it shifts — the mask/slice arithmetic in
  # session-end-check.sh then reads the wrong boundary. Not a shape real CC
  # transcripts write, but it is the difference between the two engines: JS
  # returns false. Found by the v0.62.0 pre-tag review.
  and ((.message? | type) == "object")
  and (
    (((.message.content?) | type) == "string"
      and ((.message.content | startswith("<system-reminder")) | not))
    or
    (((.message.content?) | type) == "array"
      and ((.message.content | map(select(type == "object" and .type == "text")) | length) > 0)
      and ((.message.content | any(type == "object" and .type == "tool_result")) | not)
      and ((.message.content
            | map(select(type == "object" and .type == "text") | (.text // ""))
            | join("\n")
            | startswith("<system-reminder")) | not))
  );
JQPROG
