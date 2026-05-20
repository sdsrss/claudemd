#!/usr/bin/env bash
# pre-bash-safety-check.sh — PreToolUse:Bash hook.
# Denies dangerous Bash patterns enumerated in spec §8 SAFETY (immutable):
#   1. `rm -rf $VAR` / `rm -rf "$VAR"` / `rm -rf ${VAR}` — variable expansion
#      in the target without inline validation. Whitelists $HOME, $PWD,
#      $OLDPWD, $TMPDIR (always-set, low-blast vars).
#   2. `npx <pkg>` without version pin AND not resolvable from cwd's lockfile
#      / node_modules — spec §8 NPX rule "lockfile → local → pinned whitelist;
#      none → [AUTH REQUIRED]". v0.9.30: previously only the pinned link was
#      enforced, denying any `npx <pkg>` with a project-installed dep.
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
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

# R-N5 readonly fast-path. **v0.20.0 default-ON** (§13.3 promotion from
# v0.8.3 opt-in default-OFF). When CMD is a definitely-read-only shape
# (no shell-meta, first token in safe-reader whitelist), exit before the
# sanitize/unwrap pipeline. This is the highest-leverage hook for the
# fast-path: sanitize_cmd + RM/NPX detectors run on EVERY Bash invocation
# in the steady-state hook config; readonly skip drops them entirely for
# `ls`, `cat /etc/foo`, `git log`, etc.
#
# Opt-out: BASH_READONLY_FAST_PATH=0 (any other value or unset → ON).
if [[ "${BASH_READONLY_FAST_PATH:-1}" != "0" ]] && hook_is_readonly_bash "$CMD"; then
  exit 0
fi

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
  # Single-quoted strings — always strip (no shell expansion inside '...').
  out=$(printf '%s' "$out" | sed -E "s/'[^']*'/''/g")
  # Double-quoted strings — state-machine pairing of `"` characters.
  #   - body contains `$` → preserve verbatim (real var expansion / command sub)
  #   - body has no `$`   → replace body with empty `""`
  # The previous sed regex `"[^"$]*"` was a §8 SAFETY silent bypass: it
  # could pair the closing `"` of one $-containing string with the opening
  # `"` of the next, eating `&& rm -rf` (or any other danger) between them.
  # Repro: `echo "$A" && rm -rf "$B"` was sanitized to `echo "$A""$B"` and
  # the rm-detector saw no `rm` at all. The state machine below walks
  # char-by-char so adjacent quoted regions stay distinct.
  # Escape sequences (`\"` inside `"..."`) are not modeled — same gap as
  # the prior regex; not in scope.
  out=$(printf '%s' "$out" | awk '
    BEGIN { RS = "\004" }
    {
      n = length($0)
      in_q = 0; buf = ""; has_dollar = 0; final = ""
      for (i = 1; i <= n; i++) {
        ch = substr($0, i, 1)
        if (in_q == 0) {
          if (ch == "\"") { in_q = 1; buf = ""; has_dollar = 0 }
          else final = final ch
        } else {
          if (ch == "\"") {
            if (has_dollar) final = final "\"" buf "\""
            else final = final "\"\""
            in_q = 0; buf = ""; has_dollar = 0
          } else if (ch == "$") {
            has_dollar = 1; buf = buf ch
          } else {
            buf = buf ch
          }
        }
      }
      if (in_q == 1) final = final "\"" buf
      printf "%s", final
    }
  ')

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

# EVENT_CWD: per spec §8 NPX rule, the lockfile/local resolution check needs
# the directory the bash command will run in. CC's bash hook event includes
# `.cwd`. Empty/missing → npx_pkg_locally_resolved fails closed (deny).
EVENT_CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)

# npx_pkg_locally_resolved PKG CWD
#   Returns 0 (true) if PKG can be resolved from CWD without a registry hit,
#   per spec §8 NPX rule "lockfile → local → pinned". Two checks:
#     1. CWD/node_modules/<pkg>/ exists (covers @scope/pkg via slash literal).
#     2. CWD lockfile mentions pkg in its native key form.
#   Conservative — false negatives just preserve the existing deny, false
#   positives would allow an attacker who can plant a lockfile entry but not
#   install (acceptable: planting a lockfile already requires write access).
npx_pkg_locally_resolved() {
  local pkg="$1" cwd="$2"
  [[ -n "$cwd" && -d "$cwd" ]] || return 1
  [[ -d "$cwd/node_modules/$pkg" ]] && return 0
  local lockfile
  for lockfile in package-lock.json npm-shrinkwrap.json; do
    [[ -f "$cwd/$lockfile" ]] || continue
    grep -qF "\"node_modules/$pkg\"" "$cwd/$lockfile" 2>/dev/null && return 0
  done
  if [[ -f "$cwd/pnpm-lock.yaml" ]]; then
    grep -qE "(^|[[:space:]])/${pkg}@" "$cwd/pnpm-lock.yaml" 2>/dev/null && return 0
  fi
  if [[ -f "$cwd/yarn.lock" ]]; then
    grep -qE "^[\"']?${pkg}@" "$cwd/yarn.lock" 2>/dev/null && return 0
  fi
  return 1
}

PROCESSED_CMD="$CMD"
if [[ "${BASH_SAFETY_INDIRECT_CALL:-0}" == "1" ]]; then
  PROCESSED_CMD=$(unwrap_indirect "$CMD")
fi
SANITIZED_CMD=$(sanitize_cmd "$PROCESSED_CMD")
# Multi-line collapse for pattern-extraction sed passes. Without this, the
# downstream `s/.*${RM_FLAG_REGEX}//` / `s/.*${NPX_REGEX}//` operate per-line:
# lines without `rm`/`npx` pass through unchanged, then `head -n1` (rm path)
# or `for tok in $tail` (npx path) reads tokens from those unrelated lines.
# Two opposite-direction failures:
#   - false-ALLOW (CRITICAL): `TMP=$(mktemp -d)\nrm -rf $UNSAFE_VAR` — head -n1
#     returns the mktemp line (no rm content), rm_target empty, deny path
#     never fires. §8 SAFETY bypass.
#   - false-DENY: `TMP=$(mktemp -d)\nnpx prettier@3.0.0` — npx_tail starts with
#     `TMP=$(mktemp`, flagged as unpinned package. Innocent script denied.
# Sanitize already stripped heredoc bodies / line comments / quoted bodies, so
# the remaining newlines are between independent command lines — replacing with
# spaces is safe (heredoc-body content can't leak in).
SANITIZED_CMD_FLAT=$(printf '%s' "$SANITIZED_CMD" | tr '\n' ' ')

declare -a HITS=()
REASONS=""

# Pattern 1: rm with `-r` / `-R` / `-f` / `-F` / `--recursive` / `--force`
# in its flag block AND a variable-expansion target.
#
# Per-segment iteration (v0.21.4): split SANITIZED_CMD_FLAT on command
# terminators (`;`, `&&`, `||`, `|`, `&`) and analyze each `rm`-starting
# segment independently. Pre-fix `.*${RM_FLAG_REGEX}//` was a greedy sed
# anchored at the LAST `rm -rf ` match; the earlier-segment in a chain
# was silently skipped. Repro: `rm -rf "$A" && : "${B:?msg}" && rm -rf "$B"`
# — last rm has a matching guard, accidentally allowing the unguarded `$A` rm.
# Per-segment iteration analyzes each rm independently.
#
# Long-form (`--recursive` / `--force`) and split short-form (`rm -v -i -rf`)
# flag patterns were also FN in the prior single-shot regex; the token loop
# below recognizes both shapes.
#
# Match against SANITIZED_CMD_FLAT (strings/comments/heredoc-bodies stripped)
# but accept the [allow-rm-rf-var] bypass token from raw CMD so the marker
# can live anywhere — including inside a quoted string the user wrote
# intentionally.
bypass_rm=0
if echo "$CMD" | grep -qF '[allow-rm-rf-var]'; then
  bypass_rm=1
  hook_record pre-bash-safety bypass-escape-hatch '{"token":"allow-rm-rf-var"}' '§8-rm-rf-var' "$SESSION_ID" "$TOOL_USE_ID"
fi

if (( bypass_rm == 0 )); then
  # Split SANITIZED_CMD on terminators. Operators `&&` / `||` collapse to
  # newlines (multi-char first); then single-char `;` / `&` / `|`. Two passes
  # because sed -E alternation with backrefs is awkward for run-length groups.
  # Use SANITIZED_CMD (multi-line) not SANITIZED_CMD_FLAT — original newlines
  # ARE natural command terminators; the FLAT version collapses them, joining
  # otherwise-independent commands and breaking per-segment iteration.
  RM_SEGMENTS=$(printf '%s\n' "$SANITIZED_CMD" \
    | sed -E 's/&&/\n/g; s/\|\|/\n/g' \
    | sed -E 's/[;&|]/\n/g')
  while IFS= read -r segment; do
    # Trim leading/trailing whitespace.
    trimmed="${segment#"${segment%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    # Segment must start with `rm` token (followed by whitespace or end).
    [[ "$trimmed" == rm || "$trimmed" == rm[[:space:]]* ]] || continue
    # Parse args. Detect any of: -r / -R / -f / -F in a `-*[rRfF]*` short
    # flag block; OR `--recursive` / `--force` long form. Find the first
    # non-flag positional arg as the target. POSIX `--` separator handled.
    args_only="${trimmed#rm}"
    args_only="${args_only#"${args_only%%[![:space:]]*}"}"
    danger=0
    rm_target=""
    after_dash_dash=0
    for tok in $args_only; do
      if (( after_dash_dash == 1 )); then
        [[ -z "$rm_target" ]] && rm_target="$tok"
        continue
      fi
      case "$tok" in
        '--')              after_dash_dash=1 ;;
        --recursive|--force) danger=1 ;;
        --*)               ;;  # other long-flag, ignore
        -*[rRfF]*)         danger=1 ;;
        -*)                ;;  # short flag without r/R/f/F (e.g. -v -i)
        *)
          [[ -z "$rm_target" ]] && rm_target="$tok"
          ;;
      esac
    done
    (( danger == 1 )) || continue
    [[ -n "$rm_target" ]] || continue
    echo "$rm_target" | grep -qE '\$[[:alpha:]_]|\$\{[^}]+\}' || continue
    varname=$(echo "$rm_target" | grep -oE '\$\{[^}]+\}|\$[[:alpha:]_][[:alnum:]_]*' | head -n1 \
      | sed -E 's/[${}"'"'"']//g')
    # Strip ALL var expansions + quotes from the target — what remains is the
    # literal-path residue. A whitelisted var (HOME/PWD/OLDPWD/TMPDIR) is only
    # "validated" when there's a real subpath bound: `$HOME/cache` rms a
    # subdir, but bare `$HOME` rms the user's entire home, and `$HOME/` rms
    # `/` if HOME is somehow empty (Steam-disaster class, ValveSoftware/
    # steam-for-linux#3671 — `rm -rf "$STEAM_ROOT/"*` with empty STEAM_ROOT).
    # The whitelist only certifies the var is shell-typed, not that the
    # target is bounded. Require ≥1 non-`/` character in the residue.
    residue=$(echo "$rm_target" | sed -E 's/\$\{[^}]+\}//g; s/\$[[:alpha:]_][[:alnum:]_]*//g; s/["'"'"']//g')
    case "$varname" in
      HOME|PWD|OLDPWD|TMPDIR)
        if [[ ! "$residue" =~ [^/] ]]; then
          HITS+=("rm -rf \$$varname with no literal subpath (bare whitelisted-var expansion)")
          REASONS+=$'\n  - rm -rf $'"$varname"$' with no subpath (whitelist permits $'"$varname"$'/sub, not bare $'"$varname"$')'
        fi
        ;;
      *)
        # Canonical-guard recognition: bash's `${VARNAME:?msg}` set-or-exit
        # operator forces the var to be set AND non-empty, or aborts the
        # shell. This is the exact form the deny message below recommends
        # ("Validate the var inline: : \"${VAR:?must be set}\""). Match
        # against the same varname extracted from the rm target so a guard
        # on a different var (e.g. `: "${SAFE:?msg}" && rm -rf "$EVIL"`)
        # still denies. Position-agnostic on purpose: if a user writes the
        # guard AFTER rm-rf, bash still executes rm-rf first, but with VAR
        # unset $VAR expands to empty → `rm -rf ""` is a no-op error, so
        # no damage is done either way. Other guard forms ([[ -n ]],
        # `set -u`, control flow) remain unrecognized — use [allow-rm-rf-var].
        # `(^|[^\\])` rejects backslash-escaped literals like
        # `echo "use \${X:?msg} guard"` — the `\$` is bash-literal, not
        # an actual expansion, so it must not satisfy the guard.
        guard_re='(^|[^\\])\$\{'"$varname"':\?'
        if echo "$SANITIZED_CMD_FLAT" | grep -qE "$guard_re"; then
          hook_record pre-bash-safety rm-rf-allow-validated "{\"var\":\"$varname\"}" '§8-rm-rf-var' "$SESSION_ID" "$TOOL_USE_ID"
        else
          HITS+=("rm -rf \$$varname (unvalidated variable expansion)")
          REASONS+=$'\n  - rm -rf with unvalidated $'"$varname"
        fi
        ;;
    esac
  done <<< "$RM_SEGMENTS"
fi

# Pattern 2: npx with first non-flag arg being a bare/scoped package name
# without @<version> pin.
NPX_REGEX='(^|[[:space:];&|`])npx[[:space:]]+'
if echo "$SANITIZED_CMD" | grep -qE "$NPX_REGEX"; then
  bypass_npx=0
  if echo "$CMD" | grep -qF '[allow-npx-unpinned]'; then
    bypass_npx=1
    hook_record pre-bash-safety bypass-escape-hatch '{"token":"allow-npx-unpinned"}' '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
  fi

  if (( bypass_npx == 0 )); then
    # Take everything after the first `npx ` up to a command terminator.
    npx_tail=$(printf '%s' "$SANITIZED_CMD_FLAT" | sed -E "s/.*${NPX_REGEX}//" | sed -E 's/[[:space:]]*[;&|].*$//')
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
        *)
          # Unpinned (scoped or unscoped). Per spec §8 lockfile → local → pinned:
          # check lockfile/node_modules in EVENT_CWD before denying.
          if npx_pkg_locally_resolved "$pkg_token" "$EVENT_CWD"; then
            hook_record pre-bash-safety npx-allow-local "{\"pkg\":\"$pkg_token\"}" '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
          else
            case "$pkg_token" in
              @*/*) HITS+=("npx $pkg_token (scoped, unpinned, no lockfile/local)")
                    REASONS+=$'\n  - npx unpinned scoped package (no lockfile/local in '"${EVENT_CWD:-<no-cwd>}"'): '"$pkg_token" ;;
              *)    HITS+=("npx $pkg_token (unpinned, no lockfile/local)")
                    REASONS+=$'\n  - npx unpinned package (no lockfile/local in '"${EVENT_CWD:-<no-cwd>}"'): '"$pkg_token" ;;
            esac
          fi
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
hook_record pre-bash-safety deny "{\"matched\":$HITS_JSON}" '§8' "$SESSION_ID" "$TOOL_USE_ID"
hook_deny pre-bash-safety "$REASON_TEXT"
