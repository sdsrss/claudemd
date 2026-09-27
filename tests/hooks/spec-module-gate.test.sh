#!/usr/bin/env bash
# spec-module-gate.test.sh — tier 3: a release command before the ship spec
# module reached the session (tasks/specs/spec-modules.md).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
HOOK="$REPO/hooks/spec-module-gate.sh"
TMP_HOME=$(mktemp -d -t claudemd-modgate-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/spec-modules" "$HOME/.claude/logs" "$HOME/.claude/.claudemd-state"
cp "$REPO/spec/spec-modules/ship.md" "$HOME/.claude/spec-modules/ship.md"
LOG="$HOME/.claude/logs/claudemd.jsonl"
EMPTY_TR="$HOME/empty.jsonl"
: >"$EMPTY_TR"
# shellcheck source=tests/lib/assert.sh
source "$HERE/../lib/assert.sh"

run() { # MODE CMD [SESSION] [TRANSCRIPT] -> hook stdout
  jq -cn --arg c "$2" --arg s "${3:-g1}" --arg t "${4:-$EMPTY_TR}" \
    '{tool_name:"Bash", tool_input:{command:$c}, session_id:$s, transcript_path:$t, cwd:"/work/p"}' \
    | SPEC_MODULE_GATE="$1" bash "$HOOK" 2>/dev/null
}
decision() { jq -r '.hookSpecificOutput.permissionDecision // (if .hookSpecificOutput.additionalContext then "advise" else "" end)' <<<"$1" 2>/dev/null; }

# 1. default mode logs and prints nothing.
OUT1=$(run "" 'git tag -a v1.0.0 -m release')
if [[ -z "$OUT1" ]] && jq -e 'select(.hook=="spec-module-gate" and .event=="module-unread" and .extra.mode=="log" and .spec_section=="§2.2-modules")' "$LOG" >/dev/null 2>&1; then
  ok "1 default (log) records a module-unread row and prints nothing"
else ng "1 log mode wrong: out=${OUT1:0:80}"; fi

# 2-3. advisory advises, deny denies, both naming the module.
OUT2=$(run advisory 'gh release create v1.0.0')
OUT3=$(run deny 'gh release create v1.0.0')
if [[ "$(decision "$OUT2")" == advise && "$(decision "$OUT3")" == deny ]] && grep -q 'spec-modules/ship.md' <<<"$OUT2$OUT3"; then
  ok "2 advisory adds context, deny refuses, both name ship.md"
else ng "2 modes wrong: advisory=$(decision "$OUT2") deny=$(decision "$OUT3")"; fi

# 4. injected this session: silent even in deny.
printf 'ship\n' >"$HOME/.claude/.claudemd-state/modinj-g4.list"
OUT4=$(run deny 'git push origin v1.0.0' g4)
[[ -z "$OUT4" ]] && ok "4 a module injected this session satisfies the gate" || ng "4 denied after injection: $(decision "$OUT4")"

# 5. read this session: silent in deny; a denied read does not count.
TR5="$HOME/t5.jsonl"
jq -cn --arg p "$HOME/.claude/spec-modules/ship.md" '{type:"assistant",message:{content:[{type:"tool_use",id:"r1",name:"Read",input:{file_path:$p}}]}}' >"$TR5"
OUT5=$(run deny 'npm publish' g5 "$TR5")
[[ -z "$OUT5" ]] && ok "5 a Read of ship.md satisfies the gate" || ng "5 denied after Read: $(decision "$OUT5")"

# 6. not release commands (or a quoted mention): silent in deny.
N_BAD=""
for c in 'git tag -l' 'git tag --list "v*"' 'git push origin main' 'npm publish --dry-run' 'echo "then gh release create v1"' 'git log --tags'; do
  [[ -z "$(run deny "$c" g6)" ]] || N_BAD+="[$c] "
done
[[ -z "$N_BAD" ]] && ok "6 non-release commands and quoted mentions pass" || ng "6 wrongly gated: $N_BAD"

# 7. release spellings are all gated.
R_BAD=""
for c in 'git tag v2.0.0' 'git -C sub tag -a v2.0.0 -m x' 'git push --tags' 'git push origin v2.0.0' 'gh release create v2.0.0 --notes-file n.md' 'npm publish' 'npm test && npm publish'; do
  [[ "$(decision "$(run deny "$c" g7)")" == deny ]] || R_BAD+="[$c] "
done
[[ -z "$R_BAD" ]] && ok "7 every release spelling is gated" || ng "7 missed: $R_BAD"

# 8. no ship module installed, or kill switch, or mode off: silent.
mv "$HOME/.claude/spec-modules/ship.md" "$HOME/ship.off"
OUT8=$(run deny 'npm publish' g8)
mv "$HOME/ship.off" "$HOME/.claude/spec-modules/ship.md"
OUT8B=$(jq -cn '{tool_name:"Bash", tool_input:{command:"npm publish"}, session_id:"g8b"}' | DISABLE_SPEC_MODULE_GATE_HOOK=1 SPEC_MODULE_GATE=deny bash "$HOOK" 2>/dev/null)
OUT8C=$(run off 'npm publish' g8c)
if [[ -z "$OUT8" && -z "$OUT8B" && -z "$OUT8C" ]]; then ok "8 no module / kill switch / mode off: silent"
else ng "8 not silent: nomod=${OUT8:0:30} kill=${OUT8B:0:30} off=${OUT8C:0:30}"; fi

claudemd_assert_summary
