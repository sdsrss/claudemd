#!/usr/bin/env bash
# pre-bash-safety-check.sh — PreToolUse:Bash hook.
# Denies dangerous Bash patterns enumerated in spec §8 SAFETY (immutable):
#   1. `rm -rf $VAR` / `rm -rf "$VAR"` / `rm -rf ${VAR}` — variable expansion
#      in the target without inline validation. Whitelists $HOME, $PWD,
#      $OLDPWD, $TMPDIR (always-set, low-blast vars).
#   2. `npx <pkg>` without version pin — spec §8 NPX rule
#      "lockfile → local → pinned whitelist; none → [AUTH REQUIRED]".
#
# Bypass:
#   (a) Per-invocation escape token in command:
#       [allow-rm-rf-var]   — bypasses pattern 1
#       [allow-npx-unpinned]— bypasses pattern 2
#   (b) Kill-switch: DISABLE_PRE_BASH_SAFETY_HOOK=1 (whole hook off)
#   (c) Global kill: DISABLE_CLAUDEMD_HOOKS=1
#
# Feature flags:
#   BASH_SAFETY_INDIRECT_CALL=1 — opt-in indirect-exec coverage (v0.6.0).
#     Unwraps `bash -c '<inner>'` / `sh -c '<inner>'` / `zsh -c '<inner>'` /
#     `eval '<inner>'` (single OR double quoted) to the same patterns above.
#     Default OFF for v0.6.0 to gather FP signal in the wild before flipping
#     the default. Heuristic — escaped quotes / heredoc forms / nested
#     substitutions can defeat it. Bypass tokens (a) survive unwrap so an
#     authorized indirect call still works with `[allow-rm-rf-var]` /
#     `[allow-npx-unpinned]` inside the inner string.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch PRE_BASH_SAFETY || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Sanitize CMD before pattern matching: strip heredoc bodies, line comments, and
# quoted-string contents. The original regex matched on naive prefix class
# `[[:space:];&|`]` which fired on `npx`/`rm` *inside* string literals — see
# tests/hooks/pre-bash-safety.test.sh cases 29-36, 38 for the FP shapes
# observed during the 2026-04-30 cso audit (4 live reproductions in one session).
#
# Strip order matters:
#   1. Heredoc bodies (multi-line state, must run first to avoid downstream sed
#      lines stripping content of an unclosed heredoc)
#   2. Line comments
#   3. Quoted string contents
#
# What this does NOT change:
#   - Backtick command substitution (` ... `) — backticks ARE direct exec, so
#     `\`npx pkg\`` stays detectable
#   - $(...) command substitution — preserved (also direct exec)
#   - bash -c "..." / eval "..." — these were already FNs (the original prefix
#     class `[[:space:];&|`]` excluded `"` and `'`, so quoted-arg npx never matched).
#     Stripping quotes therefore does not weaken any case the original detected.
sanitize_cmd() {
  local raw="$1" out="" line
  local in_heredoc=0 heredoc_tag=""
  # ['"]? = optional surround quote on tag (handles <<EOF, <<'EOF', <<"EOF").
  # \047 = single quote (octal); double quote can sit literally inside char class.
  local heredoc_re=$'<<-?[[:space:]]*[\047"]?([[:alpha:]_][[:alnum:]_]*)[\047"]?'

  while IFS= read -r line || [[ -n "$line" ]]; do
    if (( in_heredoc )); then
      # Terminator: optional leading whitespace (for <<-TAG indented form), tag, optional trailing whitespace.
      if [[ "$line" =~ ^[[:space:]]*${heredoc_tag}[[:space:]]*$ ]]; then
        in_heredoc=0; heredoc_tag=""
      fi
      out+=$'\n'
      continue
    fi
    if [[ "$line" =~ $heredoc_re ]]; then
      heredoc_tag="${BASH_REMATCH[1]}"
      in_heredoc=1
      # Keep portion of line BEFORE the `<<` introducer.
      line="${line%%<<*}"
    fi
    out+="$line"$'\n'
  done <<< "$raw"

  # Strip line comments (# at line start or after whitespace, to end of line).
  out=$(printf '%s' "$out" | sed -E 's/(^|[[:space:]])#.*$/\1/')

  # Strip contents of paired quoted strings, keeping the empty-quote markers
  # so token boundaries (e.g. `echo ""` after stripping) are preserved.
  #
  # Double-quoted strings:
  #   - Strip iff the body contains NO `$` (no var expansion / command sub).
  #   - Char class [^"$] excludes both " and $, so "foo bar" matches and strips,
  #     but "$VAR" / "x$y" / "$(cmd)" do not match — preserved for the rm-rf
  #     and npx detectors to see the variable expansion they need to deny.
  # Single-quoted strings:
  #   - Always strip — no shell expansion ever happens inside '...'.
  out=$(printf '%s' "$out" | sed -E 's/"[^"$]*"/""/g')
  out=$(printf '%s' "$out" | sed -E "s/'[^']*'/''/g")

  printf '%s' "$out"
}

# Indirect-call unwrap (opt-in v0.6.0).
# Order: unwrap BEFORE sanitize. Sanitize strips single-quoted bodies entirely
# and double-quoted bodies w/o `$`; once we unwrap, the inner sits as a
# top-level token so sanitize then handles legit echo/heredoc/comment shapes
# normally. Anchored to the same prefix class as the detectors (^|[[:space:];&|`(])
# so `cmd && bash -c '...'` and `$(bash -c '...')` both match, but
# `echo "bash -c 'rm -rf $X'"` (where the bash sits behind `"`) does not.
unwrap_indirect() {
  local s="$1"
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])(bash|sh|zsh)[[:space:]]+-c[[:space:]]+'([^']*)'/\\1; \\3 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])(bash|sh|zsh)[[:space:]]+-c[[:space:]]+\"([^\"]*)\"/\\1; \\3 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])eval[[:space:]]+'([^']*)'/\\1; \\2 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])eval[[:space:]]+\"([^\"]*)\"/\\1; \\2 ;/g")
  printf '%s' "$s"
}

PROCESSED_CMD="$CMD"
if [[ "${BASH_SAFETY_INDIRECT_CALL:-0}" == "1" ]]; then
  PROCESSED_CMD=$(unwrap_indirect "$CMD")
fi
SANITIZED_CMD=$(sanitize_cmd "$PROCESSED_CMD")

declare -a HITS=()
REASONS=""

# Pattern 1: rm with -r/-R/-f flag combination AND variable-expansion target.
# Use a token-based approach to keep regex BSD-grep compatible.
# Match against SANITIZED_CMD (strings/comments/heredoc-bodies stripped) but
# accept the [allow-rm-rf-var] bypass token from raw CMD so the marker can
# live anywhere — including inside a quoted string the user wrote intentionally.
RM_FLAG_REGEX='(^|[[:space:];&|`])rm[[:space:]]+-[[:alpha:]]*[rRfF][[:alpha:]]*[[:space:]]'
if echo "$SANITIZED_CMD" | grep -qE "$RM_FLAG_REGEX"; then
  bypass_rm=0
  echo "$CMD" | grep -qF '[allow-rm-rf-var]' && bypass_rm=1

  if (( bypass_rm == 0 )); then
    # Find the rm subcommand's argv after the flag block. Strip up through
    # the rm flags, then take the next non-flag token as the target.
    rm_tail=$(echo "$SANITIZED_CMD" | sed -E "s/.*${RM_FLAG_REGEX}//" | head -n1)
    rm_target=""
    for tok in $rm_tail; do
      case "$tok" in
        -*) continue ;;
        ';'|'&'|'|'|'&&'|'||') break ;;
        *)  rm_target="$tok"; break ;;
      esac
    done
    if [[ -n "$rm_target" ]] && echo "$rm_target" | grep -qE '\$[[:alpha:]_]|\$\{[^}]+\}'; then
      varname=$(echo "$rm_target" | grep -oE '\$\{[^}]+\}|\$[[:alpha:]_][[:alnum:]_]*' | head -n1 \
        | sed -E 's/[${}"'"'"']//g')
      case "$varname" in
        HOME|PWD|OLDPWD|TMPDIR) ;;
        *)
          HITS+=("rm -rf \$$varname (unvalidated variable expansion)")
          REASONS+=$'\n  - rm -rf with unvalidated $'"$varname"
          ;;
      esac
    fi
  fi
fi

# Pattern 2: npx with first non-flag arg being a bare/scoped package name
# without @<version> pin.
NPX_REGEX='(^|[[:space:];&|`])npx[[:space:]]+'
if echo "$SANITIZED_CMD" | grep -qE "$NPX_REGEX"; then
  bypass_npx=0
  echo "$CMD" | grep -qF '[allow-npx-unpinned]' && bypass_npx=1

  if (( bypass_npx == 0 )); then
    # Take everything after the first `npx ` up to a command terminator.
    npx_tail=$(echo "$SANITIZED_CMD" | sed -E "s/.*${NPX_REGEX}//" | sed -E 's/[[:space:]]*[;&|].*$//')
    pkg_token=""
    skip_next=0
    for tok in $npx_tail; do
      if (( skip_next == 1 )); then
        pkg_token="$tok"
        break
      fi
      case "$tok" in
        -p|--package|-c|--call) skip_next=1 ;;
        --*=*|--*|-[a-zA-Z]) continue ;;
        *) pkg_token="$tok"; break ;;
      esac
    done
    if [[ -n "$pkg_token" ]]; then
      case "$pkg_token" in
        ./*|/*|../*) ;;                       # local path — allow
        *@[0-9]*|*@latest|*@next|*@beta|*@alpha) ;;  # pinned — allow
        @*/*@*) ;;                            # scoped + pin — allow
        @*/*)
          HITS+=("npx $pkg_token (scoped, unpinned)")
          REASONS+=$'\n  - npx unpinned scoped package: '"$pkg_token"
          ;;
        *)
          HITS+=("npx $pkg_token (unpinned)")
          REASONS+=$'\n  - npx unpinned package: '"$pkg_token"
          ;;
      esac
    fi
  fi
fi

if (( ${#HITS[@]} == 0 )); then
  exit 0
fi

REASON_TEXT="§8 SAFETY (immutable): denied dangerous Bash invocation:${REASONS}

Spec: ~/.claude/CLAUDE.md §8 SAFETY —
  • \"rm -rf \$VAR without validating VAR\" (forbidden)
  • NPX: \"lockfile → local → pinned whitelist; none → [AUTH REQUIRED]\"

Bypass options:
  (a) Fix the invocation:
      • Validate the var inline:  : \"\${VAR:?must be set}\" && rm -rf \"\$VAR\"
      • Pin the package:          npx pkg@1.2.3   /   npx @scope/pkg@1.2.3
      • Use a literal path:       rm -rf /tmp/work-dir
  (b) Per-command escape token: include [allow-rm-rf-var] or [allow-npx-unpinned]
      in the command (records as bypass in rule-hits log).
  (c) Disable the hook: DISABLE_PRE_BASH_SAFETY_HOOK=1 (discouraged)."

HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -s .)
hook_record pre-bash-safety deny "{\"matched\":$HITS_JSON}"
hook_deny pre-bash-safety "$REASON_TEXT"
