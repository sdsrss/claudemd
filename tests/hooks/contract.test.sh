#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# contract.test.sh — locks the hook ↔ rule-hits-schema contract.
#
# Three invariants:
#   A. Every hook with a documented bypass token records `bypass-escape-hatch`
#      when the token is present (driven end-to-end via fixture commands).
#   B. Every (event, emitter) pair documented in docs/RULE-HITS-SCHEMA.md
#      has a matching `hook_record <hook> <event>` in source.
#   C. Every event emitted in hooks/ source is documented in the schema.
#
# When (B) or (C) fail, the schema and the hooks have drifted — fix the
# whichever side is wrong, not the test.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$HERE/../../hooks" && pwd)"
SCHEMA="$HERE/../../docs/RULE-HITS-SCHEMA.md"

TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
ng() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- A: bypass-token end-to-end recording -----------------------------------

drive() {
  local hook_path="$1" cmd="$2" cwd="${3:-/tmp/contract}"
  local fix
  fix=$(mktemp)
  jq -cn --arg c "$cmd" --arg cwd "$cwd" \
    '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' > "$fix"
  bash "$hook_path" < "$fix" >/dev/null 2>&1 || true
  rm -f "$fix"
}

# A.1 banned-vocab + [allow-banned-vocab]
rm -f "$LOG"
drive "$HOOKS_DIR/banned-vocab-check.sh" \
  "git commit -m 'should work [allow-banned-vocab]'"
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="bypass-escape-hatch" and .extra.token=="allow-banned-vocab")' "$LOG" >/dev/null 2>&1; then
  ok "A.1 banned-vocab [allow-banned-vocab] records bypass"
else
  ng "A.1 banned-vocab bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.2 pre-bash-safety + [allow-rm-rf-var]
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'rm -rf $FOO [allow-rm-rf-var]'
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .extra.token=="allow-rm-rf-var")' "$LOG" >/dev/null 2>&1; then
  ok "A.2 pre-bash-safety [allow-rm-rf-var] records bypass"
else
  ng "A.2 pre-bash-safety rm-rf bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.3 pre-bash-safety + [allow-npx-unpinned]
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'npx some-pkg [allow-npx-unpinned]'
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .extra.token=="allow-npx-unpinned")' "$LOG" >/dev/null 2>&1; then
  ok "A.3 pre-bash-safety [allow-npx-unpinned] records bypass"
else
  ng "A.3 pre-bash-safety npx bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.4 memory-read-check + [skip-memory-check]
CWD_A4="/work/contract-mem"
ENC=$(echo "$CWD_A4" | tr '/.' '-')
PROJ_DIR="$HOME/.claude/projects/$ENC"
MEM="$PROJ_DIR/memory"
mkdir -p "$MEM"
cat > "$MEM/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[push]` — required
EOF
touch "$MEM/feedback_push.md"
echo '' > "$PROJ_DIR/contract.jsonl"
rm -f "$LOG"
jq -cn --arg c "git push origin main [skip-memory-check]" --arg cwd "$CWD_A4" \
  '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' \
  | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1 || true
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="memory-read-check" and .event=="bypass-escape-hatch")' "$LOG" >/dev/null 2>&1; then
  ok "A.4 memory-read-check [skip-memory-check] records bypass"
else
  ng "A.4 memory-read-check bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# --- B: every documented (event, emitter) pair has a hook_record call -------

# PARSED from docs/RULE-HITS-SCHEMA.md's "Events" table — not a hand-copy of it.
# Until 2026-07-25 this was a literal array plus a "keep in sync" comment, and the
# SCHEMA path on the line above was commented out with the note "was never read".
# So invariants B and C, whose failure message names RULE-HITS-SCHEMA.md, validated
# the array against source and never opened the document at all: `mem-audit` emitted
# `warn` into the live log for months while absent from the schema, and the gate
# stayed green. A gate must parse the artifact it claims to gate.
#
# Row shape: `| \`<event>\` | \`<hook>\`[, \`<hook>\`…] | <meaning> |`. The event is the
# first backticked token of column 1; every backticked token of column 2 is an
# emitter, so one row yields one pair per emitter.
DOCUMENTED=()
while IFS= read -r _pair; do
  [[ -n "$_pair" ]] && DOCUMENTED+=("$_pair")
done < <(awk -F'|' '
  /^\|[[:space:]]*Event[[:space:]]*\|[[:space:]]*Emitted by hook[[:space:]]*\|/ { intable=1; next }
  intable && /^\|[[:space:]]*-+/ { next }
  intable && !/^\|/ { intable=0 }
  intable {
    ev=$2; em=$3
    if (!match(ev, /`[^`]+`/)) next
    event=substr(ev, RSTART+1, RLENGTH-2)
    s=em
    while (match(s, /`[^`]+`/)) {
      print event ":" substr(s, RSTART+1, RLENGTH-2)
      s=substr(s, RSTART+RLENGTH)
    }
  }
' "$SCHEMA")

if (( ${#DOCUMENTED[@]} == 0 )); then
  ng "B/C could not parse any (event, emitter) pair from $SCHEMA — parser or table shape broke"
else
  ok "B/C parsed ${#DOCUMENTED[@]} documented (event, emitter) pair(s) from RULE-HITS-SCHEMA.md"
fi

for entry in "${DOCUMENTED[@]}"; do
  event="${entry%%:*}"
  hook_name="${entry#*:}"
  # `fail-open` has its own emission path: hooks call the hook_record_failopen
  # wrapper, which forwards to rule_hits_append. A plain hook_record grep never
  # sees it, so the doc row for it was unverifiable in either direction (it still
  # named only `banned-vocab` while five hooks called the wrapper).
  # The fail-open row names the WRAPPER itself in its emitter column; that
  # backticked token is prose, not a hook.
  if [[ "$hook_name" == "hook_record_failopen" ]]; then continue; fi
  # Exit-code spectrum on BOTH recursive walks (2026-08-16 audit T-1): these
  # sit 60 lines above the C-loop site the 0.65.2 fix covered and are MORE
  # exposed — a recursive grep can hit exit >=2 from an unreadable file, a
  # missing $HOOKS_DIR, or fd exhaustion, and a missing $HOOKS_DIR would have
  # presented EVERY documented pair as mass documentation drift.
  if [[ "$event" == "fail-open" ]]; then
    grep -hRE "hook_record_failopen[[:space:]]+${hook_name}([[:space:]]|$)" "$HOOKS_DIR" >/dev/null 2>&1
    _rc=$?
    if (( _rc >= 2 )); then
      ng "B lookup for '$hook_name'/'$event' FAILED TO RUN (grep exit $_rc) — infrastructure fault, not drift"
    elif (( _rc == 0 )); then
      ok "B documented '$hook_name' emits '$event'"
    else
      ng "B documented '$hook_name'/'$event' has no hook_record_failopen call in source"
    fi
    continue
  fi
  grep -hRE "hook_record[[:space:]]+${hook_name}[[:space:]]+${event}([[:space:]]|$)" "$HOOKS_DIR" >/dev/null 2>&1
  _rc=$?
  if (( _rc >= 2 )); then
    ng "B lookup for '$hook_name'/'$event' FAILED TO RUN (grep exit $_rc) — infrastructure fault, not drift"
  elif (( _rc == 0 )); then
    ok "B documented '$hook_name' emits '$event'"
  else
    ng "B documented '$hook_name'/'$event' has no hook_record call in source"
  fi
done

# --- C: every emitted event in source is documented -------------------------

# Compare PAIRS, not bare event names. Matching on the event alone meant a new
# EMITTER of an already-documented event (`mem-audit` emitting `warn`) satisfied
# the check against the wrong row — the emitter column was never verified.
# LC_ALL=C on every dedup below (v0.65.1): BSD `sort -u` removes lines that
# COLLATE equal rather than lines that are byte-equal, so under a UTF-8 locale it
# can silently drop a distinct pair. v0.65.0's ci@main leg failed this block on
# macOS for `fail-open:ship-baseline` while the SAME commit passed on the tag run
# and on all Linux legs; the mechanism was never reproduced, so this pins the two
# genuinely locale-sensitive operations rather than claiming a root cause.
# SUPERSEDED (2026-07-28): these two pins are still worth having, but they were
# NOT the cause — a re-run of that identical commit, without them, passed on the
# same runner image. Do not reason from this paragraph; the account that replaced
# it is at the `for e in $EMITTED` loop below. Note also that the `sort -u` this
# comment defends is exactly why the "47 pairs parsed" figure cannot on its own
# exclude a collation drop: the count is taken before this line runs.
DOC_PAIRS_UNIQ=$(printf '%s\n' "${DOCUMENTED[@]}" | LC_ALL=C sort -u)
# Strip comments before extracting emitted events: a prose mention of
# `hook_record` in a docstring (e.g. "hook_record re-sources idempotently")
# otherwise reads as a real emission and false-flags drift. Anchor on code
# syntax only (feedback_self_referential_marker_regex). Full-line `# …` and
# trailing ` # …` comments removed; real `hook_record <hook> <event>` calls
# are code, never comments, so extraction is unchanged for them.
EMITTED=$(find "$HOOKS_DIR" -name '*.sh' -exec sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]#.*$//' {} + \
  | grep -hE 'hook_record[[:space:]]+[a-zA-Z_-]+[[:space:]]+[a-z-]+' \
  | sed -E 's/.*hook_record[[:space:]]+([a-zA-Z_-]+)[[:space:]]+([a-z-]+).*/\2:\1/' \
  | LC_ALL=C sort -u)
# fail-open rides the wrapper, not hook_record — add its pairs so a hook that
# starts fail-opening is held to the same documentation requirement. The generic
# `hook_record_failopen HOOK` inside hook-common.sh is the wrapper's own
# parameter, not an emitter.
EMITTED_FAILOPEN=$(find "$HOOKS_DIR" -name '*.sh' -exec sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]#.*$//' {} + \
  | grep -hoE 'hook_record_failopen[[:space:]]+[a-z][a-zA-Z_-]*' \
  | sed -E 's/hook_record_failopen[[:space:]]+/fail-open:/' \
  | LC_ALL=C sort -u)
EMITTED=$(printf '%s\n%s\n' "$EMITTED" "$EMITTED_FAILOPEN" | grep -v '^$' | LC_ALL=C sort -u)

for e in $EMITTED; do
  # Exit-code spectrum, not truthiness (2026-07-28): grep returns 1 for "no match"
  # and >=2 for "I failed to run" (fork/ENOMEM/signal). Collapsing both into the
  # else branch reports a transient runner fault as a documentation drift — the
  # last mechanism standing among those we enumerated for the v0.65.0 ci@main red.
  # What settles it: attempt 1 (fail) and attempt 2 (pass) of that identical
  # commit ran the SAME runner image (macos-26-arm64 / 20260720.0258.1) and
  # disagreed, which excludes every deterministic cause. Same class as
  # [[feedback_cc_grep_is_ugrep_shim]]: exit 2 is an error, not a zero-match.
  # A real drift must not be indistinguishable from a failed spawn.
  #
  # Herestring, not a pipe: under `set -o pipefail` $? is the rightmost NON-ZERO
  # status, so once `grep -q` short-circuits on a match, a payload past the pipe
  # buffer would kill `printf` with SIGPIPE and surface 141 for a pair that IS
  # documented — the new branch would then cry "infrastructure fault" about a
  # healthy lookup. Unreachable today (~1.4 KB against a 16 KiB macOS pipe), but
  # a block whose subject is exit-code fidelity should not keep a second
  # exit-code confound alive on a headroom argument.
  LC_ALL=C grep -Fqx -- "$e" <<< "$DOC_PAIRS_UNIQ"
  _rc=$?
  if (( _rc >= 2 )); then
    ng "C lookup for '$e' FAILED TO RUN (grep exit $_rc) — infrastructure fault, not drift"
    continue
  fi
  if (( _rc == 0 )); then
    ok "C emitted '${e%%:*}' by '${e#*:}' is documented"
  else
    ng "C emitted '${e%%:*}' by '${e#*:}' is NOT documented in RULE-HITS-SCHEMA.md (drift)"
  fi
done

# --- C2 (v0.20.1 M3): every ESCAPE_TOKENS literal in scripts/status.js -----
# must appear in at least one hooks/*.sh file. Catches the "added a 6th bypass
# token to status.js's --verbose mirror table but didn't implement it in any
# hook" drift class. status.js's ESCAPE_TOKENS is hand-maintained mirror data;
# this assertion turns it into a contract check.
STATUS_JS="$(cd "$HERE/../../scripts" && pwd)/status.js"
if [[ -r "$STATUS_JS" ]]; then
  # Extract every `token: '...'` literal from the ESCAPE_TOKENS array.
  # Single-quoted JS strings; tokens themselves never contain a single quote.
  ESCAPE_TOKENS_FOUND=$(grep -oE "token: '[^']+'" "$STATUS_JS" | sed -E "s/^token: '(.*)'$/\\1/")
  if [[ -z "$ESCAPE_TOKENS_FOUND" ]]; then
    ng "C2 ESCAPE_TOKENS array empty or unparseable in status.js"
  else
    while IFS= read -r tok; do
      [[ -z "$tok" ]] && continue
      # Same exit-code spectrum split as B/C (2026-08-16 audit T-2): recursive
      # walk, so exit >=2 is reachable and must not read as drift.
      grep -F -q -r -- "$tok" "$HOOKS_DIR"
      _rc=$?
      if (( _rc >= 2 )); then
        ng "C2 lookup for '$tok' FAILED TO RUN (grep exit $_rc) — infrastructure fault, not drift"
      elif (( _rc == 0 )); then
        ok "C2 ESCAPE_TOKEN '$tok' is implemented in hooks/"
      else
        ng "C2 ESCAPE_TOKEN '$tok' declared in status.js but NOT found in any hook (drift)"
      fi
    done <<< "$ESCAPE_TOKENS_FOUND"
  fi
else
  ng "C2 status.js unreadable at $STATUS_JS"
fi

# --- D: project field is auto-populated -------------------------------------

rm -f "$LOG"
CLAUDE_PROJECT_DIR=/contract/test.x bash -c \
  "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append test deny null"
if [[ -f "$LOG" ]] && jq -e '.project == "-contract-test-x"' "$LOG" >/dev/null 2>&1; then
  ok "D rule-hits row carries encoded project"
else
  ng "D project field missing/wrong (log: $(cat "$LOG" 2>/dev/null))"
fi

# --- E: spec_section populated on every spec-enforcing hook deny/bypass -----
# v0.7.0 R1 contract. Hooks that enforce a spec rule (banned-vocab, ship-
# baseline, pre-bash-safety, memory-read-check, residue-audit, sandbox-
# disposal) MUST emit `spec_section` non-null on deny/warn/bypass-escape-hatch.
# Plugin-internal hooks (session-start bootstrap/upstream-banner, user-prompt-
# submit version-sync) keep null. Drives §0.1/§13.1/§13.2 promotion accounting.

# E.1 banned-vocab deny → spec_section "§10-V"
rm -f "$LOG"
drive "$HOOKS_DIR/banned-vocab-check.sh" \
  "git commit -m 'this is significantly better'"
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="deny" and .spec_section=="§10-V")' "$LOG" >/dev/null 2>&1; then
  ok "E.1 banned-vocab deny tagged §10-V"
else
  ng "E.1 banned-vocab deny missing/wrong section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.2 ship-baseline pass / pass-known-red / deny → "§7-ship-baseline"
# Tested via the lib directly (the hook's own gh-CLI dependency makes
# end-to-end driving brittle in unit tests). Same code path, same arg count.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append ship-baseline pass null '§7-ship-baseline'"
if jq -e 'select(.spec_section=="§7-ship-baseline")' "$LOG" >/dev/null 2>&1; then
  ok "E.2 ship-baseline pass tagged §7-ship-baseline"
else
  ng "E.2 ship-baseline pass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.3 pre-bash-safety bypass-escape-hatch (rm-rf-var) → "§8-rm-rf-var"
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'rm -rf $FOO [allow-rm-rf-var]'
if jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .spec_section=="§8-rm-rf-var")' "$LOG" >/dev/null 2>&1; then
  ok "E.3 pre-bash-safety rm-rf-var bypass tagged §8-rm-rf-var"
else
  ng "E.3 pre-bash-safety rm-rf-var bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.4 pre-bash-safety bypass (npx) → "§8-npx"
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'npx some-pkg [allow-npx-unpinned]'
if jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .spec_section=="§8-npx")' "$LOG" >/dev/null 2>&1; then
  ok "E.4 pre-bash-safety npx bypass tagged §8-npx"
else
  ng "E.4 pre-bash-safety npx bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.5 memory-read-check bypass → "§11-memory-read"
CWD_E5="/work/contract-mem-e"
ENC=$(echo "$CWD_E5" | tr '/.' '-')
PROJ_DIR_E="$HOME/.claude/projects/$ENC"
mkdir -p "$PROJ_DIR_E/memory"
cat > "$PROJ_DIR_E/memory/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[push]` — required
EOF
touch "$PROJ_DIR_E/memory/feedback_push.md"
echo '' > "$PROJ_DIR_E/contract.jsonl"
rm -f "$LOG"
jq -cn --arg c "git push origin main [skip-memory-check]" --arg cwd "$CWD_E5" \
  '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' \
  | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1 || true
if jq -e 'select(.hook=="memory-read-check" and .event=="bypass-escape-hatch" and .spec_section=="§11-memory-read")' "$LOG" >/dev/null 2>&1; then
  ok "E.5 memory-read-check bypass tagged §11-memory-read"
else
  ng "E.5 memory-read-check bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.6 residue-audit / sandbox-disposal sections via lib (real Stop-hook
# driving requires session-state that's painful to fake). Same code path.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append residue-audit warn '{\"delta\":42}' '§7-user-global-state'"
if jq -e 'select(.spec_section=="§7-user-global-state")' "$LOG" >/dev/null 2>&1; then
  ok "E.6 residue-audit warn tagged §7-user-global-state"
else
  ng "E.6 residue-audit warn missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append sandbox-disposal warn '{\"count\":3}' '§8.V4'"
if jq -e 'select(.spec_section=="§8.V4")' "$LOG" >/dev/null 2>&1; then
  ok "E.7 sandbox-disposal warn tagged §8.V4"
else
  ng "E.7 sandbox-disposal warn missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.8 plugin-internal events (bootstrap / version-sync) keep spec_section
# null — they don't enforce a spec rule, just plugin lifecycle.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append session-start bootstrap null"
if jq -e 'select(.spec_section==null)' "$LOG" >/dev/null 2>&1; then
  ok "E.8 session-start bootstrap leaves section null"
else
  ng "E.8 session-start bootstrap section should be null (log: $(cat "$LOG" 2>/dev/null))"
fi

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
