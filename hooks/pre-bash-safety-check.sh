#!/usr/bin/env bash
# pre-bash-safety-check.sh — PreToolUse:Bash hook.
# Denies dangerous Bash patterns enumerated in spec §8 SAFETY (immutable):
#   1. `rm -rf $VAR` / `rm -rf "$VAR"` / `rm -rf ${VAR}` — variable expansion
#      in the target without inline validation. Whitelists $HOME, $PWD,
#      $OLDPWD, $TMPDIR (always-set, low-blast vars). Also strips leading
#      wrappers before the check: env-assignments, env/command/nohup/setsid/time,
#      and flag-bearing sudo/doas/timeout/nice/stdbuf/ionice/chrt.
#   2. Fetch-execute package runner without a version pin AND not resolvable from
#      cwd's lockfile / node_modules — spec §8 NPX rule "lockfile → local →
#      pinned whitelist; none → [AUTH REQUIRED]". Covers `npx` / `npm exec` /
#      `bunx` / `pnpm dlx` / `yarn dlx` (`npm install` / `pnpm install` etc. are
#      not fetch-execute one-offs and stay excluded).
#   3. Network fetch piped/`<()`-substituted into a shell — spec §8 "execute
#      scripts of unknown origin": `curl|wget … | [sudo] sh/bash/…` or
#      `sh <(curl …)`. Local/literal sources and non-shell sinks stay allowed.
#
# Bypass:
#   (a) Per-invocation escape token in command:
#       [allow-rm-rf-var]   — bypasses pattern 1
#       [allow-npx-unpinned]— bypasses pattern 2
#       [allow-curl-sh]     — bypasses pattern 3
#   (b) Kill-switch: DISABLE_PRE_BASH_SAFETY_HOOK=1 (whole hook off)
#   (c) Global kill: DISABLE_CLAUDEMD_HOOKS=1
#
# Feature flags:
#   BASH_SAFETY_INDIRECT_CALL — indirect-exec coverage. **v0.21.8 default-ON**
#     (was opt-in default-OFF v0.6.0–v0.21.7 to gather FP signal; closes §8
#     SAFETY silent-bypass for `bash -c "rm -rf $X"` / `eval "rm -rf $X"`).
#     Set to `0` to opt out. Unwraps `bash -c '<inner>'` / `sh -c '<inner>'` /
#     `zsh -c '<inner>'` / `eval '<inner>'` (single OR double quoted) AND the
#     unquoted form `eval rm -rf $X` (bash joins eval's argv with spaces
#     before evaluating, so the unquoted form is execution-equivalent to the
#     quoted one — `bash -c` / `sh -c` / `zsh -c` are NOT the same because
#     they only treat their first non-flag arg as the script). Heuristic —
#     escaped quotes / heredoc forms / nested substitutions can defeat it.
#     Bypass tokens (a) survive unwrap so an authorized indirect call still
#     works with `[allow-rm-rf-var]` / `[allow-npx-unpinned]` inside the
#     inner string.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch PRE_BASH_SAFETY || exit 0
# Record fail-open on missing prereqs (roadmap OBS-1): a jq-less / malformed-stdin
# environment must not turn this §8 gate into a silent no-op the §13.1 audit reads
# as "never fired". banned-vocab-check.sh models the same contract.
if ! hook_require_jq; then
  hook_record_failopen pre-bash-safety jq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen pre-bash-safety bad-event
  exit 0
fi
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
            if (has_dollar) { gsub(/#/, "", buf); final = final "\"" buf "\"" }
            else final = final "\"\""
            in_q = 0; buf = ""; has_dollar = 0
          } else if (ch == "$") {
            has_dollar = 1; buf = buf ch
          } else {
            buf = buf ch
          }
        }
      }
      if (in_q == 1) { gsub(/#/, "", buf); final = final "\"" buf }
      printf "%s", final
    }
  ')

  # Strip line comments LAST (# at line start or after whitespace, to end of
  # line). Must run AFTER the quote strips: pre-v0.23.11 the comment strip ran
  # first, so a `#` sitting inside a quoted string but preceded by whitespace
  # (`git commit -m 'msg # note' && rm -rf $X`) was mistaken for a real comment,
  # deleting the chained `&& rm -rf $X` before the detector saw it — a §8 SAFETY
  # bypass. By this point single-quoted bodies are `''`, $-less double-quoted
  # bodies are `""`, and `#` inside preserved $-double-quoted bodies has been
  # gsub'd out above, so any surviving `#` is a genuine unquoted comment.
  out=$(printf '%s' "$out" | sed -E 's/(^|[[:space:]])#.*$/\1/')

  printf '%s' "$out"
}

# Canonicalize the command-position leading word of every segment: strip a
# leading backslash (alias-defeat `\npx`) and a path prefix (`/usr/bin/npx`),
# leaving the basename the shell actually EXECs. Only the FIRST token after a
# true command separator (^ ; & | ( { backtick newline) is touched — NEVER a
# plain-space-preceded argument — so `echo foo/npx bar` is untouched (foo/npx is
# an arg, not a command). This gives the npx/curl gates the same command-name
# awareness the rm gate's token loop already has (2026-07-13 SEC-2; SEC-1 v0.39.0
# basenamed the rm gate only, leaving \npx / /usr/bin/npx and \curl / path-curl
# evading). The shell resolves these to npx/curl/sh at exec time, so
# canonicalizing can only EXPOSE deny tokens the shell would run, never hide one.
canon_cmd_words() {
  printf '%s' "$1" | awk '
    {
      s=$0; out=""; n=length(s); i=1; cmdpos=1
      while (i<=n) {
        ch=substr(s,i,1)
        if (cmdpos && ch!=" " && ch!="\t") {
          word=""
          while (i<=n) {
            ch=substr(s,i,1)
            if (ch==" "||ch=="\t"||ch==";"||ch=="&"||ch=="|"||ch=="("||ch=="{"||ch=="`") break
            word=word ch; i++
          }
          sub(/^\\/,"",word); sub(/.*\//,"",word)
          out=out word; cmdpos=0; continue
        }
        out=out ch
        if (ch==";"||ch=="&"||ch=="|"||ch=="("||ch=="{"||ch=="`") cmdpos=1
        i++
      }
      print out
    }'
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
  # `-c` is matched as a flag BUNDLE ending in (or containing) `c`, optionally
  # preceded by other flag tokens: `bash -c`, `bash -lc`, `bash -xc`,
  # `sh -lc`, `bash --norc -c`, `bash -x -c` all run the next arg as a shell
  # command, so all must be unwrapped. Pre-v0.23.11 only the bare `-c` form
  # was matched — `bash -lc 'rm -rf $X'` was a §8 SAFETY silent bypass. The
  # `([[:space:]]+-[a-zA-Z-]+)*` group eats leading flags; the required
  # `-[a-zA-Z]*c[a-zA-Z]*` is the bundle that consumes the command string.
  # Shell set = the Bourne family whose `-c "<cmd>"` execs the arg identically:
  # bash/sh/zsh + dash/ksh/ash. v0.23.17 added dash/ksh/ash — `dash` is the
  # Debian/Ubuntu default `/bin/sh`, so `dash -c 'rm -rf $X'` was a §8 bypass on
  # the most common CI/server platform; covering the whole family closes the
  # class rather than the one instance. Each name is separator-anchored
  # (`(^|[[:space:];&|\`(])`) so it never matches inside a longer word
  # (`dashboard`, `stash`). csh/tcsh excluded — different `-c` quoting + rare.
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])(bash|sh|zsh|dash|ksh|ash)([[:space:]]+-[a-zA-Z-]+)*[[:space:]]+-[a-zA-Z]*c[a-zA-Z]*[[:space:]]+'([^']*)'/\\1; \\4 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])(bash|sh|zsh|dash|ksh|ash)([[:space:]]+-[a-zA-Z-]+)*[[:space:]]+-[a-zA-Z]*c[a-zA-Z]*[[:space:]]+\"([^\"]*)\"/\\1; \\4 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])eval[[:space:]]+'([^']*)'/\\1; \\2 ;/g")
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])eval[[:space:]]+\"([^\"]*)\"/\\1; \\2 ;/g")
  # Unquoted eval form: `eval rm -rf $X` — bash collapses the words with
  # spaces and evaluates the result, so this is execution-equivalent to
  # `eval "rm -rf $X"`. Without this rule, the quoted-only unwrap above is
  # a §8 SAFETY silent bypass — an attacker just drops the quotes. Inner
  # capture group stops at the next command terminator (`;`, `&`, `|`) so
  # `eval rm -rf $X && ls` still treats `ls` as its own segment. Leading
  # char of the inner must not be `'`/`"` (quoted forms above already
  # handled) so a same-line `eval "..."` further down the buffer is not
  # double-unwrapped.
  s=$(printf '%s' "$s" | sed -E "s/(^|[[:space:];&|\`(])eval[[:space:]]+([^'\"[:space:];&|][^;&|]*)/\\1; \\2 ;/g")
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

# effective_npx_cwd BASE FLAT
#   CC's event `.cwd` is the shell cwd *before* the command runs. When the
#   command prefixes a `cd <dir>` (e.g. `cd frontend && npx vue-tsc` in a
#   monorepo whose tool is a devDependency of frontend/), npx actually runs in
#   BASE/<dir>, not BASE — so npx_pkg_locally_resolved against BASE alone
#   false-denies a locally-installed tool. Observed 5× on the daagu
#   frontend/backend monorepo. Walk the `cd` commands that appear BEFORE the
#   first `npx ` token and apply each to a running cwd via subshell `cd`
#   (resolves relative / absolute / `..` against the real filesystem).
#
#   Safety: only ALLOWS when a real local install exists at the composed path,
#   so this can never weaken the gate — at worst it allows an npx whose package
#   is genuinely installed in the cd'd dir (the intended allow). Targets with
#   shell expansion (`$VAR` / backtick / glob / `~`) or a failed `cd` are
#   unresolvable, so we bail to BASE (keeping the conservative deny).
effective_npx_cwd() {
  local base="$1" flat="$2" target resolved
  local eff="$base"                       # separate stmt: `local a=.. b="$a"` is unbound under set -u
  local before="${flat%%npx *}"          # cd's after npx don't affect its cwd
  while read -r target; do
    [[ -z "$target" ]] && continue
    case "$target" in
      *'$'*|*'`'*|*'*'*|*'?'*|'~'*|-*) eff="$base"; break ;;  # unresolvable: keep base
    esac
    if [[ "$target" == /* ]]; then
      resolved=$(cd "$target" 2>/dev/null && pwd)
    else
      resolved=$(cd "$eff" 2>/dev/null && cd "$target" 2>/dev/null && pwd)
    fi
    if [[ -n "$resolved" ]]; then eff="$resolved"; else eff="$base"; break; fi
  done < <(printf '%s\n' "$before" \
    | grep -oE '(^|[[:space:];&|])cd[[:space:]]+[^[:space:];&|]+' \
    | sed -E 's/.*cd[[:space:]]+//')
  printf '%s' "$eff"
}

# Normalize shell-lexer evasions BEFORE unwrap/sanitize/tokenize (v0.39.0 §8 FN
# closure, 2026-07-12 audit F2/F3). The detectors below match SOURCE TEXT, so an
# attacker can hide a danger token from them with lexer tricks the shell itself
# transparently undoes at exec time:
#   - ${IFS}/$IFS word-split (F2): `rm${IFS}-rf${IFS}$X`, `npx${IFS}pkg` — fold to
#     a space so the token loop sees `rm -rf $X` / `npx pkg`. Bare `$IFS` is only
#     folded when NOT followed by an identifier char (so `$IFSFOO` = var IFSFOO is
#     untouched).
#   - backslash-newline continuation (F3): `rm -r\<newline>f $X` — bash joins the
#     line, so remove `\`+newline (portable bash 3.2 param-expansion, not sed `\n`
#     which is non-portable on BSD).
# Folding can only EXPOSE tokens the shell would see, never hide one, so it
# strictly closes false-negatives on these deny-on-match detectors.
_nl=$'\n'
NORMALIZED_CMD="${CMD//\\$_nl/}"
# Fold ${IFS}/$IFS word-splitting to a space. The braced ${IFS} form is a plain
# global replace, but the bare-$IFS sed `s/\$IFS([^A-Za-z0-9_]|$)/ \1/` CONSUMES
# the trailing delimiter into the backref, so an ADJACENT `$IFS$IFS` leaves the
# second unfolded after one pass (2026-07-13 SEC-2 F6). Run the bare form to a
# FIXED POINT — folding only ever removes `$IFS`, so it decreases monotonically
# and terminates.
# shellcheck disable=SC2016  # single quotes intentional: sed must see $IFS literally
NORMALIZED_CMD=$(printf '%s' "$NORMALIZED_CMD" | sed -E 's/\$\{IFS\}/ /g')
while :; do
  # shellcheck disable=SC2016  # single quotes intentional: sed must see $IFS literally
  _folded=$(printf '%s' "$NORMALIZED_CMD" | sed -E 's/\$IFS([^A-Za-z0-9_]|$)/ \1/g')
  [[ "$_folded" == "$NORMALIZED_CMD" ]] && break
  NORMALIZED_CMD="$_folded"
done

PROCESSED_CMD="$NORMALIZED_CMD"
if [[ "${BASH_SAFETY_INDIRECT_CALL:-1}" != "0" ]]; then
  PROCESSED_CMD=$(unwrap_indirect "$NORMALIZED_CMD")
fi
SANITIZED_CMD=$(sanitize_cmd "$PROCESSED_CMD")
# Canonicalize command-position words (\npx → npx, /usr/bin/npx → npx) so the
# npx/curl gates below match what the shell EXECs — sibling parity with the rm
# gate's own basename step (2026-07-13 SEC-2 F5).
SANITIZED_CMD=$(canon_cmd_words "$SANITIZED_CMD")
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
# v0.23.6 — parallel to HITS: the granular §8 section each hit belongs to, so
# the deny telemetry can be filed under §8-rm-rf-var / §8-npx instead of the
# generic §8 bucket. Pre-fix all denies were recorded under §8 while bypass
# tokens / auto-allows were recorded granular, making the doctor's per-section
# bypass ratio read a misleading 100% for §8-npx / §8-rm-rf-var (denies sat in
# a different bucket from the denominator). Enforcement is unchanged.
declare -a HIT_SECTIONS=()
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
    | sed -E 's/[;&|()`]/\n/g')
  while IFS= read -r segment; do
    # Trim leading/trailing whitespace.
    trimmed="${segment#"${segment%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    # Strip leading env-var ASSIGNMENTS and transparent EXEC-WRAPPER commands
    # before the `rm` check. `FOO=bar rm -rf $X` (assignment) runs rm with FOO
    # in its env; `env rm`, `command rm`, `nohup rm`, `setsid rm`, `time rm`
    # (and `env FOO=x rm`) all exec rm too. Pre-fix the segment-start `rm` check
    # below skipped any segment that began with an assignment OR a wrapper word —
    # a §8 SAFETY silent bypass (`DEBUG=1 rm -rf $HOME`, `command rm -rf $X`).
    # Loop because they stack (`A=1 B=2 rm`, `env FOO=x rm`, `sudo timeout 5 rm`).
    # No FP: the `rm` check still gates, so stripping a wrapper off a non-rm
    # command (`env node`, `sudo ls`) changes nothing. Covered: arg-less
    # sudo/doas + flag-bearing timeout/nice/stdbuf/ionice/chrt (2026-07-03 §8 FN
    # audit). NOT covered (best-effort; documented residual): `xargs rm` (target
    # arrives on stdin, not argv — no `$VAR` in the rm args to gate), and
    # option-arg wrapper forms where a non-numeric arg precedes the command
    # (`timeout -s KILL 5 rm`). The [allow-rm-rf-var] token is the escape.
    while [[ -n "$trimmed" ]]; do
      first="${trimmed%%[[:space:]]*}"
      if [[ "$first" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] \
         || [[ "$first" == env || "$first" == command || "$first" == nohup \
            || "$first" == setsid || "$first" == time || "$first" == busybox \
            || "$first" == /usr/bin/env || "$first" == /bin/env ]]; then
        # Arg-less transparent wrappers + leading env-var assignments.
        rest="${trimmed#"$first"}"
        trimmed="${rest#"${rest%%[![:space:]]*}"}"
      elif [[ "$first" == timeout || "$first" == nice || "$first" == stdbuf \
            || "$first" == ionice || "$first" == chrt || "$first" == sudo \
            || "$first" == doas ]]; then
        # Flag-bearing wrappers: strip the wrapper word, then its option tokens
        # (-*) and bare numeric-or-duration args (timeout's DURATION, nice's
        # priority), stopping at the first command word (rm or another cmd) so
        # rm's own flags are never eaten and a non-rm command is untouched.
        # `timeout 5 rm -rf $X` / `nice -n10 rm` / `stdbuf -oL rm` were §8 FNs
        # (2026-07-03 audit). sudo/doas belong HERE, not in the arg-less set:
        # `sudo -E rm -rf $X` (preserve-env, common in CI) / `sudo -i rm` carry a
        # boolean flag before the command — code review 2026-07-03 caught them
        # bypassing from the arg-less branch. `sudo rm -rf $EMPTY` runs rm as root
        # (danger amplified, not exempt). No false-deny: stripping only removes
        # prefixes, never CREATES a target/danger-flag. Documented residual:
        # option-WITH-argument forms where a non-numeric arg precedes the command
        # — `sudo -u svc rm`, `timeout -s KILL 5 rm`. [allow-rm-rf-var] escapes.
        rest="${trimmed#"$first"}"
        trimmed="${rest#"${rest%%[![:space:]]*}"}"
        while [[ -n "$trimmed" ]]; do
          w="${trimmed%%[[:space:]]*}"
          if [[ "$w" == -* || "$w" =~ ^[0-9]+[smhd]?$ ]]; then
            rest="${trimmed#"$w"}"
            trimmed="${rest#"${rest%%[![:space:]]*}"}"
          else
            break
          fi
        done
      else
        break
      fi
    done
    # Segment must start with an `rm` token. Canonicalize the command word to
    # its basename and strip a leading backslash so path-prefixed (`/bin/rm`,
    # `./rm`) and alias-defeating (`\rm`) forms are recognized as rm — matching
    # what the shell EXECS, not the source spelling (v0.39.0 §8 FN closure F1).
    # `busybox rm` (multiplexer) is handled earlier by the wrapper-strip loop.
    # Exact `== rm` after canonicalization keeps `charm`/`norm`/`perm` etc. off.
    # SEC-3 (2026-07-13): strip a leading group/subshell opener so `(rm`/`{ rm`
    # (command inside (...) / { ...; } / $(...)) is seen as rm.
    trimmed="${trimmed#[({]}"
    trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"
    rm_word="${trimmed%%[[:space:]]*}"
    rm_canon="${rm_word#\\}"; rm_canon="${rm_canon##*/}"
    [[ "$rm_canon" == rm ]] || continue
    # Parse args. Detect any of: -r / -R / -f / -F in a `-*[rRfF]*` short
    # flag block; OR `--recursive` / `--force` long form. Find the first
    # non-flag positional arg as the target. POSIX `--` separator handled.
    args_only="${trimmed#"$rm_word"}"
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
    residue=$(echo "$rm_target" | sed -E 's/\$\{[^}]+\}//g; s/\$[[:alpha:]_][[:alnum:]_]*//g; s/["'"'"']//g; s/[(){}]//g')
    case "$varname" in
      HOME|PWD|OLDPWD|TMPDIR)
        if [[ ! "$residue" =~ [^/] ]]; then
          HITS+=("rm -rf \$$varname with no literal subpath (bare whitelisted-var expansion)")
          HIT_SECTIONS+=('§8-rm-rf-var')
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
        # SEC-4 (2026-07-13): mktemp-provenance recognition — a var assigned in the
        # SAME command from $(mktemp …) / `mktemp …` is a validated rm target: mktemp
        # creates a fresh, uniquely-named path that cannot be / or a wildcard, so
        # cleaning it up is the §8.V4 disposal idiom, not an unvalidated-var danger.
        # mktemp survives canon_cmd_words (no path to basename); literal-prefix vars
        # do NOT (canon basenames them) and transitive vars ($S/x) can't be resolved,
        # so both stay strict — use ${VAR:?} / literal rm target / [allow-rm-rf-var].
        # shellcheck disable=SC2016  # single quotes intentional: literal regex, not expansion
        prov_mktemp='(^|[[:space:];&|`(])'"$varname"'=(\$\(|`)[[:space:]]*mktemp([[:space:]`)]|$)'
        if echo "$SANITIZED_CMD_FLAT" | grep -qE "$prov_mktemp"; then
          hook_record pre-bash-safety rm-rf-allow-provenance "{\"var\":\"$varname\"}" '§8-rm-rf-var' "$SESSION_ID" "$TOOL_USE_ID"
        else
          guard_re='(^|[^\\])\$\{'"$varname"':\?'
          if echo "$SANITIZED_CMD_FLAT" | grep -qE "$guard_re"; then
            hook_record pre-bash-safety rm-rf-allow-validated "{\"var\":\"$varname\"}" '§8-rm-rf-var' "$SESSION_ID" "$TOOL_USE_ID"
          else
            HITS+=("rm -rf \$$varname (unvalidated variable expansion)")
            HIT_SECTIONS+=('§8-rm-rf-var')
            REASONS+=$'\n  - rm -rf with unvalidated $'"$varname"
          fi
        fi
        ;;
    esac
  done <<< "$RM_SEGMENTS"
fi

# Pattern 2: fetch-execute package runner (npx / npm exec / pnpm dlx / yarn dlx
# / bunx) with first non-flag arg being a bare/scoped package name without
# @<version> pin. §8 forbids "execute scripts of unknown origin"; npx's siblings
# fetch+run an unpinned unknown package identically (npx is literally a shortcut
# for `npm exec`), so the §8 NPX gate (lockfile → local → pinned) applies to the
# whole family. `npm install` / `npm run` / `pnpm install` / `yarn add` are NOT
# fetch-execute one-offs and stay excluded (the regex requires the `exec`/`dlx`
# subcommand). 2026-07-03 §8 false-negative audit + code review found the
# siblings bypassed the npx-only detector; local/lockfile resolution below
# already reads pnpm-lock.yaml / yarn.lock, so the gate is symmetric across
# ecosystems.
# B-1 (2026-07-13): find a runner at COMMAND POSITION, not anywhere. Split into
# command segments (same boundaries as the rm gate), strip leading env-assignments
# + transparent wrappers (env/command/sudo/timeout/… — mirrors the rm gate), then
# check if the segment's command word is a runner. A runner name sitting inside a
# quoted argument (`git commit -m "add npx setup for $X"`) is NOT at a segment's
# command position, so prose no longer false-denies; `env npx` / `$(npx …)` still do.
NPX_CMD_REGEX='^(npx|bunx|npm[[:space:]]+exec|pnpm[[:space:]]+dlx|yarn[[:space:]]+dlx)([[:space:]]|$)'
runner=""
npx_seg=""
NPX_SEGMENTS=$(printf '%s\n' "$SANITIZED_CMD" \
  | sed -E 's/&&/\n/g; s/\|\|/\n/g' \
  | sed -E 's/[;&|()`]/\n/g')
while IFS= read -r nseg; do
  nseg="${nseg#"${nseg%%[![:space:]]*}"}"; nseg="${nseg%"${nseg##*[![:space:]]}"}"
  [[ -n "$nseg" ]] || continue
  nseg="${nseg#[({]}"; nseg="${nseg#"${nseg%%[![:space:]]*}"}"
  # Strip env-var assignments + transparent exec-wrappers (same set as the rm gate).
  while [[ -n "$nseg" ]]; do
    nfirst="${nseg%%[[:space:]]*}"
    if [[ "$nfirst" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] \
       || [[ "$nfirst" == env || "$nfirst" == command || "$nfirst" == nohup \
          || "$nfirst" == setsid || "$nfirst" == time || "$nfirst" == busybox \
          || "$nfirst" == /usr/bin/env || "$nfirst" == /bin/env ]]; then
      nrest="${nseg#"$nfirst"}"; nseg="${nrest#"${nrest%%[![:space:]]*}"}"
    elif [[ "$nfirst" == timeout || "$nfirst" == nice || "$nfirst" == stdbuf \
          || "$nfirst" == ionice || "$nfirst" == chrt || "$nfirst" == sudo \
          || "$nfirst" == doas ]]; then
      nrest="${nseg#"$nfirst"}"; nseg="${nrest#"${nrest%%[![:space:]]*}"}"
      while [[ -n "$nseg" ]]; do
        nw="${nseg%%[[:space:]]*}"
        if [[ "$nw" == -* || "$nw" =~ ^[0-9]+[smhd]?$ ]]; then
          nrest="${nseg#"$nw"}"; nseg="${nrest#"${nrest%%[![:space:]]*}"}"
        else break; fi
      done
    else break; fi
  done
  # Canonicalize the command word (basename + strip a leading backslash) so
  # `\npx` / `/usr/bin/npx` at command position match what the shell EXECs.
  ncmd="${nseg%%[[:space:]]*}"; ncmd="${ncmd#\\}"; ncmd="${ncmd##*/}"
  seg_canon="$ncmd${nseg#"${nseg%%[[:space:]]*}"}"
  if printf '%s' "$seg_canon" | grep -qE "$NPX_CMD_REGEX"; then
    runner=$(printf '%s' "$seg_canon" | grep -oE "$NPX_CMD_REGEX" | head -n1 | sed -E 's/[[:space:]]+$//')
    npx_seg="$seg_canon"
    break
  fi
done <<< "$NPX_SEGMENTS"

if [[ -n "$runner" ]]; then
  bypass_npx=0
  if echo "$CMD" | grep -qF '[allow-npx-unpinned]'; then
    bypass_npx=1
    hook_record pre-bash-safety bypass-escape-hatch '{"token":"allow-npx-unpinned"}' '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
  fi

  if (( bypass_npx == 0 )); then
    # Resolve the cwd npx will actually run in (follows leading `cd <dir>`).
    NPX_EFFECTIVE_CWD=$(effective_npx_cwd "$EVENT_CWD" "$SANITIZED_CMD_FLAT")
    # Take everything after the first `npx ` up to a command terminator.
    npx_tail="${npx_seg#"$runner"}"; npx_tail="${npx_tail#"${npx_tail%%[![:space:]]*}"}"
    pkg_token=""
    skip_next=0
    no_install=0
    for tok in $npx_tail; do
      if (( skip_next == 1 )); then
        pkg_token="$tok"
        break
      fi
      case "$tok" in
        -p|--package|-c|--call) skip_next=1 ;;
        # v0.23.19 — --no-install (npx v6) / --no (npm 7+) forbid registry
        # fetch: npx runs an already-installed binary or exits non-zero, so
        # no unknown-origin code can land — which is what the §8 NPX chain
        # guards. Only flags BEFORE the package name count (loop breaks at
        # the first non-flag token; trailing flags belong to the package).
        --no-install|--no) no_install=1 ;;
        --*=*|--*|-[a-zA-Z]) continue ;;
        *) pkg_token="$tok"; break ;;
      esac
    done
    if [[ -n "$pkg_token" && $no_install -eq 1 ]]; then
      hook_record pre-bash-safety npx-allow-no-install "{\"pkg\":\"$pkg_token\"}" '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
      pkg_token=""
    fi
    if [[ -n "$pkg_token" ]]; then
      case "$pkg_token" in
        ./*|/*|../*) ;;                       # local path — allow
        *@[0-9]*|*@latest|*@next|*@beta|*@alpha) ;;  # pinned — allow
        @*/*@*) ;;                            # scoped + pin — allow
        *)
          # Unpinned (scoped or unscoped). Per spec §8 lockfile → local → pinned:
          # check lockfile/node_modules in EVENT_CWD before denying.
          if npx_pkg_locally_resolved "$pkg_token" "$NPX_EFFECTIVE_CWD"; then
            hook_record pre-bash-safety npx-allow-local "{\"pkg\":\"$pkg_token\"}" '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
          else
            case "$pkg_token" in
              @*/*) HITS+=("$runner $pkg_token (scoped, unpinned, no lockfile/local)")
                    HIT_SECTIONS+=('§8-npx')
                    REASONS+=$'\n  - '"$runner"' unpinned scoped package (no lockfile/local in '"${NPX_EFFECTIVE_CWD:-<no-cwd>}"'): '"$pkg_token" ;;
              *)    HITS+=("$runner $pkg_token (unpinned, no lockfile/local)")
                    HIT_SECTIONS+=('§8-npx')
                    REASONS+=$'\n  - '"$runner"' unpinned package (no lockfile/local in '"${NPX_EFFECTIVE_CWD:-<no-cwd>}"'): '"$pkg_token" ;;
            esac
          fi
          ;;
      esac
    fi
  fi
fi

# Pattern 3: pipe / process-substitute a network fetch into a shell interpreter
# — spec §8 "execute scripts of unknown origin". The LEFT side must be a network
# fetch (curl/wget) in COMMAND position; `cat local.sh | sh` / `echo cmd | bash`
# are known-origin and stay allowed (no curl/wget), and non-shell sinks
# (`| jq`, `| tar`) do not match (the pipe target must be sh/bash/zsh/dash/ksh/
# ash, optionally via sudo). Per-pipeline-segment (split on newline / ; / && /
# ||) so a curl in one command and a `| sh` in the next never cross-match.
# Matches on SANITIZED_CMD (quotes/heredoc/comments stripped) so a curl|sh
# quoted in prose does not fire; unwrap_indirect already exposed the inner of
# `sh -c "curl x | sh"`. Command-substitution form `eval "$(curl x)"` is a
# documented residual (tasks/s8-false-negative-audit-2026-07-03.md). 2026-07-03
# §8 false-negative audit: this class had no detector at all.
bypass_curlsh=0
if echo "$CMD" | grep -qF '[allow-curl-sh]'; then bypass_curlsh=1; fi
# Command-position anchor `[|;&({]` includes `{` so a brace-group `{ curl … |
# sh; }` is caught like the subshell `( … )` form (code review 2026-07-03). A
# var like `${curl}` cannot false-match: the trailing `[[:space:]]` after curl
# requires a space, which `${curl}` (curl followed by `}`) never has.
CURLSH_PIPE='(^|[|;&({])[[:space:]]*(curl|wget)[[:space:]].*\|[[:space:]]*(sudo[[:space:]]+)?(sh|bash|zsh|dash|ksh|ash)([[:space:])}]|$)'
# `source` and `.` are builtins that EXECUTE their file argument in the current
# shell; `source <(curl x)` / `. <(curl x)` run fetched code just like `bash <(curl
# x)` (v0.39.0 §8 FN closure F4). `\.` = literal dot (command position), no FP —
# a bare `.` before ` <(curl…)` is only ever the source builtin.
CURLSH_PROCSUB='(^|[|;&({])[[:space:]]*(source|\.|sh|bash|zsh|dash|ksh|ash)[[:space:]]+<\([[:space:]]*(curl|wget)[[:space:]]'
curlsh_hit=0
while IFS= read -r cseg; do
  if echo "$cseg" | grep -qE "$CURLSH_PIPE" || echo "$cseg" | grep -qE "$CURLSH_PROCSUB"; then
    curlsh_hit=1; break
  fi
done < <(printf '%s\n' "$SANITIZED_CMD" | sed -E 's/&&/\n/g; s/\|\|/\n/g; s/;/\n/g')
if (( curlsh_hit == 1 )); then
  if (( bypass_curlsh == 1 )); then
    hook_record pre-bash-safety bypass-escape-hatch '{"token":"allow-curl-sh"}' '§8-curl-sh' "$SESSION_ID" "$TOOL_USE_ID"
  else
    HITS+=("curl/wget piped or <()-substituted into a shell (unknown-origin execution)")
    HIT_SECTIONS+=('§8-curl-sh')
    REASONS+=$'\n  - network fetch (curl/wget) run by a shell — executes unknown-origin code'
  fi
fi

if (( ${#HITS[@]} == 0 )); then
  exit 0
fi

REASON_TEXT="§8 SAFETY (immutable): denied dangerous Bash invocation:${REASONS}

Spec: ~/.claude/CLAUDE.md §8 SAFETY —
  • \"rm -rf \$VAR without validating VAR\" (forbidden)
  • NPX: \"lockfile → local → pinned whitelist; none → [AUTH REQUIRED]\"
    (covers npx / bunx / pnpm dlx / yarn dlx)
  • \"execute scripts of unknown origin\" (forbidden) — curl/wget … | sh

Bypass options:
  (a) Fix the invocation:
      • Validate the var inline:  : \"\${VAR:?must be set}\" && rm -rf \"\$VAR\"
      • Pin the package:          npx pkg@1.2.3   /   npx @scope/pkg@1.2.3
      • Use a literal path:       rm -rf /tmp/work-dir
      • Download then inspect:    curl -o s.sh URL && less s.sh && sh s.sh
  (b) Per-command escape token: include [allow-rm-rf-var], [allow-npx-unpinned],
      or [allow-curl-sh] in the command (records as bypass in rule-hits log).
  (c) Disable the hook: DISABLE_PRE_BASH_SAFETY_HOOK=1 (discouraged)."

# v0.23.6 — file the deny telemetry under the granular §8 section(s) that
# triggered it (§8-rm-rf-var / §8-npx), one record per section present with
# that section's own hits, so the doctor's per-section bypass ratio counts
# denies in the denominator. A command mixing both categories emits one record
# each. Falls back to generic §8 only if a hit somehow lacks a section tag.
# Enforcement is identical to pre-fix: hook_deny below blocks regardless of the
# telemetry outcome.
# v0.23.7 portability fix: indexed arrays + plain string accumulators ONLY —
# macOS ships bash 3.2, which has no associative arrays (`declare -A` errors out
# and, worse, aborts the deny path before hook_deny → §8 not enforced on macOS).
# The granular section set is fixed and small, so hardcode the three buckets.
_rmrf_hits=""; _npx_hits=""; _curlsh_hits=""; _other_hits=""
for i in "${!HITS[@]}"; do
  case "${HIT_SECTIONS[$i]:-§8}" in
    '§8-rm-rf-var') _rmrf_hits+="${HITS[$i]}"$'\n' ;;
    '§8-npx')       _npx_hits+="${HITS[$i]}"$'\n' ;;
    '§8-curl-sh')   _curlsh_hits+="${HITS[$i]}"$'\n' ;;
    *)              _other_hits+="${HITS[$i]}"$'\n' ;;
  esac
done
record_section_deny() {  # $1=section  $2=newline-delimited hits blob
  [[ -n "$2" ]] || return 0
  local hj
  hj=$(printf '%s' "$2" | sed '/^$/d' | jq -R . | jq -s .)
  hook_record pre-bash-safety deny "{\"matched\":$hj}" "$1" "$SESSION_ID" "$TOOL_USE_ID"
}
record_section_deny '§8-rm-rf-var' "$_rmrf_hits"
record_section_deny '§8-npx'       "$_npx_hits"
record_section_deny '§8-curl-sh'   "$_curlsh_hits"
record_section_deny '§8'           "$_other_hits"
hook_deny pre-bash-safety "$REASON_TEXT"
