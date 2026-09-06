#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# hook_encode_project RAW → stdout
#   Encode a path to Claude Code's ~/.claude/projects/<encoded>/ convention: CC
#   replaces EVERY non-`[a-zA-Z0-9-]` char with `-`. ARCH-1 (2026-07-12 audit):
#   the single source for what were 4 inlined `tr -c 'a-zA-Z0-9-' '-'` copies
#   (here + memory-prompt-hint / memory-read-check / banned-vocab-check). The
#   earlier `tr '/._'` form mis-encoded any path with another special char →
#   telemetry mis-attribution (feedback_cc_cwd_encoding_dots). Lives in this leaf
#   lib (sourced standalone by tests AND eagerly by hook-common.sh) so all
#   consumers share ONE definition — no `declare -F`-guarded inline fallback
#   (that silent-divergence anti-pattern is feedback_hook_platform_lib_source).
#
#   CHARACTER-wise, not byte-wise (2026-07-17 audit): CC's encoder is a Node
#   String.replace, so a CJK char yields ONE `-`. The previous `tr -c` was
#   byte-wise — `/home/项目x` became `-home-------x` (3 dashes per CJK char)
#   while scripts/lib/paths.js#encodeProjectCwd (and CC itself) produce
#   `-home---x` — the two sides of the language seam disagreed and every JS
#   auditor mis-located ~/.claude/projects/<encoded> for non-ASCII cwds.
#   Cross-language parity is now pinned by rule-hits.test.sh (CJK fixture).
#   The character class is spelled out (no `[a-z]` ranges): bash pattern ranges
#   collate per-locale and can swallow accented letters JS would map to `-`.
#   ${s:i:1} slicing needs a UTF-8 LC_CTYPE (CC always runs in one); under
#   LC_ALL=C it degrades to byte-wise — exactly the old tr behavior, never worse.
#   Non-BMP chars (emoji) remain a known residual: JS counts UTF-16 units (2
#   dashes), bash counts codepoints (1 dash). No real project path hits this.
hook_encode_project() {
  local s="${1:-}" out="" c i
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-]) out+="$c" ;;
      *) out+="-" ;;
    esac
  done
  printf '%s' "$out"
}

# rule_hits_append HOOK EVENT EXTRA_JSON [SPEC_SECTION] [SESSION_ID] [TOOL_USE_ID]
#   HOOK        — hook name (banned-vocab, ship-baseline, ...)
#   EVENT       — see docs/RULE-HITS-SCHEMA.md "Events" table for the
#                 canonical list (kept in sync via tests/hooks/contract.test.sh).
#   EXTRA       — JSON value (object | null | string). "null" if none.
#   SECTION     — optional spec section identifier for §0.1/§13.1/§13.2
#                 promotion and demotion accounting. See docs/RULE-HITS-SCHEMA.md
#                 "Spec section taxonomy" table. Empty arg → null in JSONL row.
#                 Hooks that aren't enforcing a spec rule (session-start
#                 bootstrap, version-sync) leave it empty.
#   SESSION_ID  — optional Claude Code session identifier (extracted from
#                 stdin EVENT JSON `.session_id`). Empty arg → null in row.
#                 Added v0.9.33.
#   TOOL_USE_ID — optional per-invocation tool use ID (CC stdin `.tool_use_id`,
#                 format `toolu_[alnum]`). Empty arg → null in row. Only
#                 PreToolUse / PostToolUse events carry this; Stop /
#                 SessionStart / SessionEnd / UserPromptSubmit do not.
#                 Added v0.9.34 to enable audit `unique_invocations` dedup.
#                 Dedup key (extended v0.23.21) is (ts, hook, session_id,
#                 tool_use_id, event, extra): BYTE-IDENTICAL rows twice ⇒ true
#                 single-invocation double-fire (registration / lib bug);
#                 different tool_use_id at same ts ⇒ Claude fast-retry after
#                 deny, not a duplicate. NOTE multi-emit hooks (pre-bash-safety
#                 logs one row per matched pattern in a compound command)
#                 legitimately repeat (ts, hook, session_id, tool_use_id) with
#                 differing extra — the event+extra key keeps those distinct;
#                 a byte-identical residual can still come from one command
#                 repeating the same pattern, so confirm against the source
#                 command before calling a pre-bash-safety `_real` a bug.
# _rule_hits_json_escape STR — escape a string for a JSON string body.
# bash 3.2 safe (no ${var@Q}). Backslash MUST be escaped before quote, or the
# escapes this function itself inserts get double-escaped.
_rule_hits_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  # Control chars are illegal raw inside a JSON string and would also break the
  # one-row-per-line JSONL contract. Drop rather than \u-encode: every field
  # reaching here is a token, path, or UUID, never prose.
  printf '%s' "$s" | tr -d '\001-\037'
}

# _rule_hits_json_or_null STR — `null` when empty, else a quoted escaped string.
_rule_hits_json_or_null() {
  if [[ -z "$1" ]]; then printf 'null'; else printf '"%s"' "$(_rule_hits_json_escape "$1")"; fi
}

# _rule_hits_fallback_row TS HOOK EVENT PROJECT SESSION TOOLUSE SECTION HV EXTRA
#   jq-free row builder. Field order and null-vs-string posture mirror the jq
#   program below exactly; tests/hooks/fail-open.test.sh T12 parses this output
#   back with a real jq and asserts all 9 schema fields survive.
_rule_hits_fallback_row() {
  local extra="$9"
  # `extra` arrives as a JSON fragment. Under a broken jq the caller's own
  # jq-built payload may be empty, partial or multi-line, and pasting that in
  # would emit an unparseable row — worse than no telemetry, because the OLD
  # code's `jq -cn` simply failed and dropped the row, leaving the log valid.
  #
  # A newline is the load-bearing check: several callers build `extra` with
  # `jq -s .` (uncompacted, hence multi-line), and one embedded newline turns a
  # single row into several partial lines, breaking the one-object-per-line
  # contract this whole fallback exists to preserve. Brace/bracket balance at
  # the ends additionally rejects a truncated payload.
  #
  # This is a guard, not a validator: real JSON validation is not available on
  # a path defined by jq being unusable. It bounds the damage to "extra
  # degraded to null" (row survives) rather than "log corrupted".
  #
  # 2026-08-16 audit H-1: the first/last-char sniff alone accepted truncated
  # payloads with intact outer braces verbatim — six call sites wrap a
  # possibly-empty jq fragment in a literal brace pair, so a jq that works
  # once then fails yields exactly `{"matched":}` / `{"matched":[}`, and the
  # old guard appended an unparseable line. Two cheap structural checks close
  # those shapes: delimiter-count balance, and no dangling ':'/',' before the
  # closer. Both can only false-positive on delimiter-bearing STRING values
  # (e.g. {"note":"a["}), where the payload degrades to null — conservative
  # by design.
  if [[ "$extra" == *$'\n'* || "$extra" == *$'\r'* ]]; then
    extra=null
  else
    case "$extra" in
      null) : ;;
      '{'*'}'|'['*']')
        # Delimiter counts via length difference after deleting the target
        # char. NOT via `${var//[^X]/}` keep-only patterns: bash parses the
        # bracket expression `[^]]` as `[^]` + literal `]` (diverging from the
        # POSIX "]-first-is-literal" rule), which silently miscounts and
        # rejected every valid payload on this function's first cut.
        local _t _n1 _n2
        _t=${extra//\{/}; _n1=$(( ${#extra} - ${#_t} ))
        _t=${extra//\}/}; _n2=$(( ${#extra} - ${#_t} ))
        [[ "$_n1" -ne "$_n2" ]] && extra=null
        if [[ "$extra" != null ]]; then
          _t=${extra//\[/}; _n1=$(( ${#extra} - ${#_t} ))
          _t=${extra//\]/}; _n2=$(( ${#extra} - ${#_t} ))
          [[ "$_n1" -ne "$_n2" ]] && extra=null
        fi
        case "${extra: -2}" in
          ':}'|',}'|':]'|',]') extra=null ;;
        esac
        # Mid-payload dangling separator (2026-08-16 pre-tag review S1): an
        # empty jq fragment BETWEEN fields yields {"missing":,"n":2} — the
        # closer check alone misses it (this guard's own scope-narrower-than-
        # subject moment, caught before tag). memory-read-check.sh:260 is a
        # live producer of exactly that shape under a jq that fails mid-hook.
        # A string VALUE containing ':,' or ',,' degrades to null — same
        # conservative posture as the delimiter counts above.
        if [[ "$extra" == *':,'* || "$extra" == *',,'* ]]; then extra=null; fi
        ;;
      *) extra=null ;;
    esac
  fi
  printf '{"ts":"%s","hook":"%s","event":"%s","project":"%s","session_id":%s,"tool_use_id":%s,"spec_section":%s,"hook_version":%s,"extra":%s}' \
    "$(_rule_hits_json_escape "$1")" \
    "$(_rule_hits_json_escape "$2")" \
    "$(_rule_hits_json_escape "$3")" \
    "$(_rule_hits_json_escape "$4")" \
    "$(_rule_hits_json_or_null "$5")" \
    "$(_rule_hits_json_or_null "$6")" \
    "$(_rule_hits_json_or_null "$7")" \
    "$(_rule_hits_json_or_null "$8")" \
    "$extra"
}

# _rule_hits_path_age_seconds PATH → age in whole seconds on stdout.
#
# `find -mmin` is NOT usable here: BSD find (macOS) rounds the age UP to the
# next full minute, so an entry two seconds old already reads as "1 minute" and
# `-mmin -1` — strictly less than one — reports nothing. The v0.76.0 stale
# branch read that as "older than a minute" and reaped a lock a live rotation
# was still holding, on the platform half of CI runs on (2026-09-05 post-ship
# review, finding 1; reproduced 4 times in 100 trials). Whole-second arithmetic
# over the two `stat` flavors has no rounding to disagree about.
#
# Anything unreadable — no stat, no date, a clock behind the file's mtime —
# yields 0, i.e. "fresh". Never reap an entry whose age cannot be established.
# (Named for a lock until the mkdir mutex was replaced by the claim rotation
# below; it now ages orphan claim FILES, and the rounding lesson is the same.)
_rule_hits_path_age_seconds() {
  local mtime now
  mtime=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0)
  now=$(date +%s 2>/dev/null || echo 0)
  if [[ ! "$mtime" =~ ^[0-9]+$ ]] || [[ ! "$now" =~ ^[0-9]+$ ]]; then
    echo 0
    return 0
  fi
  if (( mtime > 0 && now > mtime )); then
    echo $(( now - mtime ))
  else
    echo 0
  fi
}

rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"
  local section="${4:-}"
  local session_id="${5:-}"
  local tool_use_id="${6:-}"

  # Reserved test sentinel. `t` is the fixture session_id used across most of
  # the hook test suite. The suite sandboxes HOME so its writes are disposable,
  # but ad-hoc *manual* hook invocations in the real $HOME with a fixture event
  # were leaking these into production telemetry (309 rows / 11.5% of the log
  # as of the 2026-06-03 impact audit), inflating deny counts ~2x and obscuring
  # real signal. Real CC session_ids are UUIDs, never `t`; the few tests that
  # assert on log content use distinct ids (e.g. sess35, and the `test`
  # sentinel for transcript-*-scan) — so dropping `t` is invisible to every
  # real caller and every test.
  [[ "$session_id" == "t" ]] && return 0

  # Project: encode to match Claude Code's ~/.claude/projects/<encoded>/
  # convention via hook_encode_project above — CC replaces every
  # non-`[a-zA-Z0-9-]` char with `-`, CHARACTER-wise. (This said `tr -c` "is the
  # exact transform"; the 2026-07-17 audit disproved that and replaced it with
  # the per-character loop — `tr` is byte-wise and emits three dashes per CJK
  # character. Two copies of the false claim survived that fix; this is one of
  # them, 2026-08-29 audit R10-21c. The live rationale is in the function
  # header.) The earlier `tr '/._'`
  # only handled the three chars seen in this maintainer's cwds and mis-encoded
  # the project field for any path with another special char (telemetry then
  # attributed those rows to the wrong / a non-existent project). For `/._`-only
  # paths the forms are identical. See hooks/memory-read-check.sh for the
  # matching consumer + bug-history note. Empty string when neither var is set.
  local project_raw="${CLAUDE_PROJECT_DIR:-${PWD:-}}"
  local project=""
  [[ -n "$project_raw" ]] && project=$(hook_encode_project "$project_raw")

  local log_dir="$HOME/.claude/logs"
  local log_file="$log_dir/claudemd.jsonl"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  # Size-capped rotation. Over CLAUDEMD_LOG_MAX_MB (default 5) → rotate to
  # .1, pushing any existing .1 to .2 (drop .2). Two rotations retained =
  # one headroom between rotate and next overflow, bounded growth at
  # ~3× max_mb on disk. `/claudemd-audit` currently reads only the primary
  # file, so rotations beyond .1 are effectively archived (read-only).
  # NO LONGER TRUE as of v0.71.4: `rule-hits-parse.js#logGenerations` makes every
  # JS hit-reader open `.2`, `.1` and the primary, so both archives are now
  # load-bearing analysis input. See the concurrency note below, whose stated
  # justification this invalidates.
  # `stat -c` is GNU, `-f` is BSD — try both, default to 0 if neither works
  # (fail-safe: no rotation better than wrong rotation on an unknown stat).
  # Concurrency (2026-08-16 audit CONC-4, adjudicated 2026-09-05 audit P1-1):
  # two processes can both pass the size check, then interleave the two mv
  # steps — P1 rotates live→.1, and P2's `mv .1 .2` then moves that
  # JUST-ROTATED live generation onto .2, wiping the archive P1 made. Sandbox
  # replay: {live, .1, .2} degraded to {gone, gone, live-as-.2} — BOTH prior
  # generations lost, though live rows survive under the .2 name.
  #
  # This was accepted while "no consumer reads the archives" was true. v0.71.4
  # made it false: rule-hits-parse.js#logGenerations opens .2, .1 and the
  # primary, so all three are analysis input and the race costs roughly 380
  # days of hit data at the log's measured ~26 KB/day.
  #
  # THE EXCLUSION IS A CLAIM, NOT A LOCK (v0.76.3, round-13 next-batch item 2).
  # A rotator renames the live log to a private `<log>.rotating.<pid>.<n>` and
  # archives from there, so ownership of a generation is established by the
  # rename itself: rename(2) unlinks the source, and a second process finds
  # nothing to claim. Both branches stay silent; a rotation that does not happen
  # this call is not an error.
  #
  # It replaces a `mkdir` mutex, and the reason is measured rather than
  # aesthetic. `mkdir` was chosen as "atomic on every filesystem this runs on";
  # the 0.76.2 pre-tag review found that is not true of the DEVELOPMENT host —
  # 200 trials of four processes racing one path gave 206 wins where 200 were
  # expected, because /usr/bin/mkdir there is uutils coreutils 0.8.0 (the
  # Ubuntu 25.10 default). On the same host /usr/bin/mv is GNU coreutils 9.7 and
  # 200 trials of four processes racing one rename gave exactly one winner every
  # time, 0 with more than one and 0 with none. So this does not merely move the
  # race — it moves the exclusion onto a primitive measured to hold here, and
  # onto the one POSIX guarantees for the operation being performed.
  #
  # The cost is a new orphan class: a process killed between the claim and the
  # placement leaves a `.rotating.<pid>.<n>` file holding a full generation of
  # rows. That file is data, not a lock, so the reaper below completes the
  # interrupted rotation instead of deleting it, and a reaper claims the orphan
  # by the same rename before touching it — which is why two reapers cannot both
  # place the same generation. The old stale-LOCK reap was check-then-`rmdir`,
  # two steps that could remove a lock another process had just acquired
  # (2026-09-05 audit Q-01); nothing here checks a condition and then acts on a
  # path another process may have replaced in between.
  local max_mb="${CLAUDEMD_LOG_MAX_MB:-5}"
  # Numeric-guard: a non-integer env value (user typo) would make
  # `$((max_mb * ...))` an unbound-variable crash under `set -u`, and because
  # this runs before the JSONL write, the telemetry row would be silently lost.
  # The digit test alone is not enough: `17592186044416 * 1024 * 1024` wraps int64
  # to 0 and larger values go negative, so a cap asked for in the
  # digit-repetition direction became the SMALLEST possible one — rotation on
  # every single append, three rows of history retained (0.77.0 pre-tag review,
  # LOW 1). 1 TB is past any real log and leaves the product inside int64.
  [[ "$max_mb" =~ ^[0-9]+$ ]] && (( max_mb <= 1048576 )) || max_mb=5
  local max_bytes=$((max_mb * 1024 * 1024))

  # Orphan-claim reap runs BEFORE the size check, and that ordering is the whole
  # point, inherited from the lock this replaces: a holder killed mid-rotation
  # leaves the log already claimed and therefore UNDER the cap, so a reap branch
  # nested inside the size check can never run and the orphan is permanent
  # (2026-09-05 post-ship review, finding 3 — a decade-old lock survived 10
  # appends with the live log at 1,960 bytes against a 5 MB cap). An unmatched
  # glob costs no process, so the path every append but a handful takes is one
  # builtin test.
  #
  # An orphan holds ROWS, so it is completed rather than deleted — and which
  # generation it is has to be MEASURED, not assumed. The first version of this
  # branch placed by slot occupancy alone, on the reasoning that an orphan
  # predates any `.1` written after the crash. That is true only when the crash
  # is FOLLOWED by two rotations. In the ordinary sequence — two rotations, then
  # a kill — the orphan is the NEWEST generation and both slots hold older ones,
  # so the branch deleted the newest and kept two older ones, with no concurrency
  # required (0.77.0 pre-tag review, HIGH 2; v0.76.2 had no orphan class at all
  # and self-healed at the same kill point, which made it a regression).
  #
  # The rule is now "keep the two newest of the three", by mtime. The retired
  # rationale also claimed out-of-order archives would mislead
  # `rule-hits-parse.js#logGenerations`; they would not — that function returns a
  # FIXED path list and every consumer goes through `readHits`, which filters on
  # each row's own `ts`. Nothing reads file order, so ordering is worth no rows.
  #
  # The reaper CLAIMS before it places, by the same rename the rotator uses. The
  # `mv "$lock" "$lock.reap.$$" && rmdir` recipe was rejected for the LOCK
  # because rename(2) is atomic about the move and not about the IDENTITY of
  # what it moved — a late reaper would carry off a fresh lock exactly as
  # `rmdir` deleted one. That objection does not transfer: a lock's identity
  # matters because a live holder may own it, while an orphan is a file whose
  # BYTES are the whole point, and whoever wins the rename owns those bytes.
  #
  # The two placements below ARE check-then-act, and an earlier draft of this
  # comment claimed nothing here was. Two reapers holding different orphans can
  # both see a free slot and the second `mv -f` clobbers the first. The window is
  # one builtin test wide; the reviewer measured 0 losses in 600 trials at 8- and
  # 32-way concurrency. Stated rather than papered over.
  #
  # `failglob` in the caller's shell would abort the `for` on an unmatched glob,
  # and with it the JSONL write below — every row lost, silently, for a shell
  # option (same review, LOW 3). Suspend it across the loop and restore it.
  local _orphan _claimed _o_age _a1_age _a2_age _stamp _now _fg=0
  shopt -q failglob && _fg=1
  (( _fg == 1 )) && shopt -u failglob
  _now=$(date +%s 2>/dev/null || echo 0)
  for _orphan in "$log_file".rotating.*; do
    [[ -f "$_orphan" ]] || continue
    # Age from the NAME the rotator wrote, not from a timestamp — see the claim
    # site below for why. A name without a numeric stamp (a hand-made fixture, a
    # file a user dropped here) falls back to mtime, which is the older, weaker
    # answer but never reaps something whose age cannot be established: the
    # helper answers 0 — "fresh" — for anything it cannot read.
    _stamp=${_orphan##*.rotating.}
    _stamp=${_stamp%%.*}
    if [[ "$_stamp" =~ ^[0-9]+$ ]] && (( _now > 0 )); then
      (( _now - _stamp >= 60 )) || continue
    else
      (( $(_rule_hits_path_age_seconds "$_orphan") >= 60 )) || continue
    fi
    _claimed="$_orphan.reap.$$.${RANDOM:-0}"
    mv "$_orphan" "$_claimed" 2>/dev/null || continue
    if [[ ! -e "$log_file.1" ]]; then
      mv -f "$_claimed" "$log_file.1" 2>/dev/null || rm -f "$_claimed" 2>/dev/null
    elif [[ ! -e "$log_file.2" ]]; then
      mv -f "$_claimed" "$log_file.2" 2>/dev/null || rm -f "$_claimed" 2>/dev/null
    else
      # Both slots taken: keep the two newest of the three. Age, not position —
      # smaller age is newer.
      _o_age=$(_rule_hits_path_age_seconds "$_claimed")
      _a1_age=$(_rule_hits_path_age_seconds "$log_file.1")
      _a2_age=$(_rule_hits_path_age_seconds "$log_file.2")
      if (( _o_age < _a1_age )); then
        mv -f "$log_file.1" "$log_file.2" 2>/dev/null
        mv -f "$_claimed" "$log_file.1" 2>/dev/null || rm -f "$_claimed" 2>/dev/null
      elif (( _o_age < _a2_age )); then
        mv -f "$_claimed" "$log_file.2" 2>/dev/null || rm -f "$_claimed" 2>/dev/null
      else
        rm -f "$_claimed" 2>/dev/null
      fi
    fi
  done
  (( _fg == 1 )) && shopt -s failglob

  # A `<log>.rotating` DIRECTORY is the v0.76.0-v0.76.2 mutex, left behind on a
  # machine upgraded while one was held. Nothing creates one any more, so
  # without this it would sit in ~/.claude/logs forever as residue.
  [[ -d "$log_file.rotating" ]] && rmdir "$log_file.rotating" 2>/dev/null
  #
  if [[ -f "$log_file" ]]; then
    local size
    # NUMERIC-GUARD both size reads. `stat -c %s F || stat -f %z F || echo 0`
    # reads as a GNU/BSD dual and is not one: on GNU coreutils `-f` is
    # --file-system and `%z` parses as an OPERAND, so against an existing file
    # the fallback prints the filesystem block to STDOUT and exits 1 — the `||`
    # chain continues and appends `0` to that blob. Every hook sets
    # `set -uo pipefail` before sourcing this lib, so `(( size > max_bytes ))`
    # then dereferences the word `File` and the shell EXITS 127.
    #
    # hook_record calls rule_hits_append INLINE (hook-common.sh:214) and every
    # deny path records before it denies, so that abort turns an immutable §8
    # deny into an allow — a PreToolUse hook exiting non-zero is non-blocking,
    # the command proceeds — with no row and no fail-open marker to show for it
    # (0.76.2 pre-tag review, CRITICAL-1; ROT-7 pins it). Same guard the
    # `max_mb` env read above already uses, for the same reason.
    size=$(stat -c %s "$log_file" 2>/dev/null || stat -f %z "$log_file" 2>/dev/null || echo 0)
    [[ "$size" =~ ^[0-9]+$ ]] || size=0
    if (( size > max_bytes )); then
      # THE CLAIM CARRIES ITS OWN BIRTH TIME, IN ITS NAME.
      #
      # A file timestamp cannot answer "when was this claimed". `rename(2)`
      # preserves mtime and updates only ctime, so a claim aged by mtime carries
      # the age of its ROWS: whenever the previous append was over a minute ago —
      # the ordinary case for a log that crosses the cap at the end of a session
      # — the claim is born already past the reaper's threshold, a concurrent
      # append steals it, finds both archive slots full, and deletes a whole
      # generation. Measured at 31/200 on 32-way concurrency (0.77.0 pre-tag
      # review, HIGH 1). The release's own harness rebuilt the log immediately
      # before each trial, so its mtime was always fresh and the branch never
      # fired: it measured the one condition under which the defect is
      # unreachable.
      #
      # Stamping the file after the rename does not close it either — measured
      # 41/200 on the same arm. `mv` then `touch` is two steps, and a reaper
      # landing between them sees the inherited timestamp. The name is written by
      # the rename ITSELF, so there is no window and no dependency on whether a
      # filesystem or a `stat` flavour reports mtime, ctime or birth time.
      local claim claim_born
      claim_born=$(date +%s 2>/dev/null || echo 0)
      claim="$log_file.rotating.$claim_born.$$.${RANDOM:-0}"
      if mv "$log_file" "$claim" 2>/dev/null; then
        # RE-READ the size, now on the CLAIMED file. The check above only
        # decides whether to reach for the claim; this one decides whether to
        # archive, and it has to be this one — the lesson survives the mechanism
        # that produced it (2026-09-05 audit Q-01 qualification, ROT-6).
        #
        # Under the old mutex the losing shape was: P2 reads the size while the
        # log is over the cap, P1 rotates and releases, P2's `mkdir` then wins an
        # uncontested lock and re-runs the two-step move on a log that is already
        # rotated, carrying P1's fresh archive onto `.2`. The claim closes that
        # arm outright — after P1's rename there is nothing for P2 to claim.
        #
        # What it does NOT close is the same interleaving one step further out:
        # P2 reads the size, P1 claims and archives, a THIRD process appends and
        # so re-creates the log, and P2's rename now succeeds against a
        # BRAND-NEW generation of a few hundred bytes. Archiving that would push
        # P1's just-placed `.1` to `.2` and drop the generation that was in `.2`
        # — the P1-1 signature reached by a different route. Re-reading the size
        # of what we actually hold is what stops it, and 200 trials of four
        # concurrent appends over an over-cap log confirm the pair: 0 archive
        # losses, where the mutex measured 12/200 on the same harness with a
        # stale lock present.
        #
        # A claim that turns out to be under the cap is given back rather than
        # dropped: those rows are real telemetry, and `>>` puts them at the end
        # of the live log where every row carries its own `ts` anyway.
        #
        # Guarded for the reason spelled out at the outer read (0.76.2 pre-tag
        # review, CRITICAL-1). The claimed path cannot be raced away by another
        # process — that is the point of claiming it — but the guard is what
        # keeps a `stat` pair that prints a filesystem block to stdout from
        # aborting the hook and turning a §8 deny into an allow.
        local csize
        csize=$(stat -c %s "$claim" 2>/dev/null || stat -f %z "$claim" 2>/dev/null || echo 0)
        [[ "$csize" =~ ^[0-9]+$ ]] || csize=0
        if (( csize > max_bytes )); then
          # `-e`, not `-f`: a DIRECTORY at an archive path fails `-f`, and
          # `mv -f file dir/` then succeeds by moving the file INSIDE it — the
          # slot never becomes a file, so every later generation lands in there
          # too and none is visible to `logGenerations` (0.77.0 pre-tag review,
          # LOW 2). Give the claim back instead; a rotation that does not happen
          # is not an error, and the same posture the stat guards take.
          if [[ -d "$log_file.1" || -d "$log_file.2" ]]; then
            cat "$claim" >> "$log_file" 2>/dev/null && rm -f "$claim" 2>/dev/null
            csize=0
          fi
        fi
        if (( csize > max_bytes )); then
          [[ -e "$log_file.1" ]] && mv -f "$log_file.1" "$log_file.2" 2>/dev/null
          mv -f "$claim" "$log_file.1" 2>/dev/null
        else
          cat "$claim" >> "$log_file" 2>/dev/null && rm -f "$claim" 2>/dev/null
        fi
      fi
      # No else. A claim we did not win is a rotation another process is
      # running; skipping is the correct answer and the next append re-checks
      # the size.
    fi
  fi

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # hook_version (ARCH-3, 2026-07-25 audit): stamp every row with the emitting
  # build's version so rows written by a STALE registered hook dir (other live
  # CC windows keep old hooks until restart — 242 stale-root events across 12
  # version gaps in the live log) are stratifiable by consumers instead of
  # pooling into calibration windows. Cached per process; empty → null field
  # (fail-open, matches session_id posture). Version source = plugin root
  # package.json, two levels up from this lib file.
  if [[ -z "${RULE_HITS_HOOK_VERSION+x}" ]]; then
    local _pkg
    _pkg="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/package.json"
    RULE_HITS_HOOK_VERSION=$(jq -r '.version // empty' "$_pkg" 2>/dev/null) || RULE_HITS_HOOK_VERSION=""
    # sed fallback: without it a jq-less/broken environment loses the version
    # stamp on exactly the rows that diagnose that environment. The stamp is
    # what lets consumers stratify rows written by a stale hook dir.
    if [[ -z "$RULE_HITS_HOOK_VERSION" ]]; then
      RULE_HITS_HOOK_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$_pkg" 2>/dev/null | head -1)
    fi
  fi

  # Primary builder is jq; `_rule_hits_fallback_row` covers the case jq cannot.
  # Build into a variable first — the previous form redirected jq straight at
  # the log, so a jq that failed mid-write could leave a torn line in a file
  # whose whole contract is one valid JSON object per line.
  local row=""
  row=$(jq -cn \
    --arg ts "$ts" \
    --arg hook "$hook" \
    --arg event "$event" \
    --arg project "$project" \
    --arg session_id "$session_id" \
    --arg tool_use_id "$tool_use_id" \
    --arg section "$section" \
    --arg hv "${RULE_HITS_HOOK_VERSION:-}" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, project: $project,
      session_id: (if $session_id == "" then null else $session_id end),
      tool_use_id: (if $tool_use_id == "" then null else $tool_use_id end),
      spec_section: (if $section == "" then null else $section end),
      hook_version: (if $hv == "" then null else $hv end),
      extra: $extra}' 2>/dev/null) || row=""

  if [[ -z "$row" ]]; then
    row=$(_rule_hits_fallback_row "$ts" "$hook" "$event" "$project" \
      "$session_id" "$tool_use_id" "$section" "${RULE_HITS_HOOK_VERSION:-}" "$extra")
  fi

  [[ -n "$row" ]] && printf '%s\n' "$row" >> "$log_file"
  return 0
}
