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

declare -a HITS=()
REASONS=""

# Pattern 1: rm with -r/-R/-f flag combination AND variable-expansion target.
# Use a token-based approach to keep regex BSD-grep compatible.
RM_FLAG_REGEX='(^|[[:space:];&|`])rm[[:space:]]+-[[:alpha:]]*[rRfF][[:alpha:]]*[[:space:]]'
if echo "$CMD" | grep -qE "$RM_FLAG_REGEX"; then
  bypass_rm=0
  echo "$CMD" | grep -qF '[allow-rm-rf-var]' && bypass_rm=1

  if (( bypass_rm == 0 )); then
    # Find the rm subcommand's argv after the flag block. Strip up through
    # the rm flags, then take the next non-flag token as the target.
    rm_tail=$(echo "$CMD" | sed -E "s/.*${RM_FLAG_REGEX}//" | head -n1)
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
if echo "$CMD" | grep -qE "$NPX_REGEX"; then
  bypass_npx=0
  echo "$CMD" | grep -qF '[allow-npx-unpinned]' && bypass_npx=1

  if (( bypass_npx == 0 )); then
    # Take everything after the first `npx ` up to a command terminator.
    npx_tail=$(echo "$CMD" | sed -E "s/.*${NPX_REGEX}//" | sed -E 's/[[:space:]]*[;&|].*$//')
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
