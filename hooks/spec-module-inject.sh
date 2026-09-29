#!/usr/bin/env bash
# spec-module-inject — UserPromptSubmit: inject the spec module a prompt matches
# (core §2.2; tasks/specs/spec-modules.md, tier 2).
#
# Each ~/.claude/spec-modules/<name>.md carries frontmatter `triggers:` (a regex,
# case-insensitive) and `trigger-window:` (`whole` prompt, or `head` = its first
# 300 characters). A match injects the module's body as additionalContext, so
# the rules arrive whether or not the model would have chosen to read them —
# measured before this hook existed: a hint to read a file was followed in
# 25/46 Opus 5.5 turns (docs/audit/20260926-180700.md §12.3). Calibrated on
# 757 human prompts since 2026-09-05 (scripts/offline-eval/trigger-calibrate.mjs's
# filter, 2026-09-28, 0.104.0 triggers; machine-sent turns excluded, as below):
# >= 2 modules on 51 (6.7%).
#
# Bounded: each module once per session (the list lives in the state dir and
# session-start clears it on compaction, when injected text is gone), at most
# two modules per prompt (ship first). Modules with no triggers are reached
# through the core index only.
#
# Size (tasks/specs/spec-modules.md r7): Claude Code caps one additionalContext
# string at 10,000 characters and replaces anything longer with a file path and
# a 2,000-character preview it does not ask the model to read. memory + plan, one
# natural pair ("记住这个架构决定"), came to 9,929. So the body goes in without
# its build comment (a maintainer note, 112 characters a module), and a second
# module that would push the total past BUDGET is not dropped but deferred: its
# name is kept as a `pending:` line and it is injected on a later prompt,
# trigger or not: the next one, unless two modules ahead of it in the order
# below take both of that prompt's slots. BUDGET sits below the cap because jq counts code points and the
# cap counts UTF-16 units, which differ on characters outside the BMP.
#
# Kill switch: DISABLE_SPEC_MODULE_INJECT_HOOK=1.
set -uo pipefail
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$LIB_DIR/hook-common.sh" || exit 0
source "$LIB_DIR/platform.sh" 2>/dev/null || true
source "$LIB_DIR/spec-module.sh" || exit 0
hook_kill_switch SPEC_MODULE_INJECT || exit 0
hook_require_jq || { hook_record_failopen spec-module-inject jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
PROMPT=$(hook_jq_field spec-module-inject "$EVENT" '.prompt // ""') || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -n "$PROMPT" && -n "$SESSION_ID" ]] || exit 0
# Machine-sent turns are not the user's request (same filter memory-prompt-hint uses).
_head="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
case "$_head" in
  '<agent-message'* | '<teammate-message'* | 'Another Claude session sent a message'* | '<task-notification'* \
    | '<local-command-caveat'* | '<command-name'* | '<local-command-stdout'* | '<system-reminder'*) exit 0 ;;
esac

MOD_DIR="$HOME/.claude/spec-modules"
[[ -d "$MOD_DIR" ]] || exit 0
STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
[[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0
SEEN="$STATE_DIR/modinj-$SESSION_ID.list"
PROMPT_HEAD="${PROMPT:0:300}"

# ship first, then the rest in name order.
mods=()
[[ -f "$MOD_DIR/ship.md" ]] && mods+=("$MOD_DIR/ship.md")
for f in "$MOD_DIR"/*.md; do
  [[ -f "$f" && "$f" != "$MOD_DIR/ship.md" ]] && mods+=("$f")
done

# bash 3.2 (macOS) aborts on "${mods[@]}" of an empty array under set -u.
(( ${#mods[@]} > 0 )) || exit 0

BUDGET=9800
picked=()
for f in "${mods[@]}"; do
  (( ${#picked[@]} >= 2 )) && break
  name=$(basename "$f" .md)
  [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]] || continue
  grep -qx "$name" "$SEEN" 2>/dev/null && continue
  # A module deferred by the budget on an earlier prompt goes in now, whatever
  # this prompt says.
  if grep -qx "pending:$name" "$SEEN" 2>/dev/null; then picked+=("$f"); continue; fi
  # Frontmatter is the file's first block between two `---` lines.
  re=$(awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^triggers: /{sub(/^triggers: /,""); print; exit}' "$f")
  [[ -n "$re" ]] || continue
  win=$(awk 'NR>1 && $0=="---"{exit} /^trigger-window: /{sub(/^trigger-window: /,""); print; exit}' "$f")
  text="$PROMPT_HEAD"
  [[ "$win" == whole ]] && text="$PROMPT"
  hit=$(jq -n --arg t "$text" --arg re "$re" 'try ($t | test($re; "i")) catch false' 2>/dev/null)
  [[ "$hit" == true ]] && picked+=("$f")
done
(( ${#picked[@]} > 0 )) || exit 0

ctx=""
names=""
deferred=""
for f in "${picked[@]}"; do
  name=$(basename "$f" .md)
  specmod_entry "$name" "$(specmod_body "$f")" "matched by the user's prompt"
  entry="$SPECMOD_ENTRY"
  # The first module always goes in (none is near the budget alone, and
  # tests/scripts/spec-modules.test.js keeps it that way); a later one only if
  # the total stays inside it.
  if [[ -n "$ctx" ]]; then
    total=$(jq -n --arg c "$ctx$entry" '$c | length' 2>/dev/null) || total=$BUDGET
    if (( total > BUDGET )); then
      grep -qx "pending:$name" "$SEEN" 2>/dev/null || printf 'pending:%s\n' "$name" >>"$SEEN" 2>/dev/null || true
      deferred+="${deferred:+,}$name"
      continue
    fi
  fi
  ctx+="$entry"
  names+="${names:+,}$name"
  printf '%s\n' "$name" >>"$SEEN" 2>/dev/null || true
done

hook_record spec-module-inject module-inject "$(jq -cn --arg m "$names" --arg d "$deferred" '{modules: $m} + (if $d == "" then {} else {deferred: $d} end)' 2>/dev/null || echo 'null')" '§2.2-modules' "$SESSION_ID" 2>/dev/null || true
jq -cn --arg c "$ctx" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
exit 0
