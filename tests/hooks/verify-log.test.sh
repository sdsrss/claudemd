#!/usr/bin/env bash
# verify-log.test.sh — R3 fingerprint log (tasks/specs/wtree-evidence.md):
# hooks/lib/wtree.sh, verify-log.sh (PostToolUse) and evidence-gate.sh's
# claim-wtree row. Every repo here is a scratch repo under the sandbox HOME.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$HERE/../.."
HOOK="$REPO_ROOT/hooks/verify-log.sh"
EG="$REPO_ROOT/hooks/evidence-gate.sh"
TMP_HOME=$(mktemp -d -t claudemd-vlog-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
export TMPDIR="$TMP_HOME/tmp"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/projects/p" "$TMPDIR"
LOG="$HOME/.claude/logs/claudemd.jsonl"

# shellcheck source=tests/lib/assert.sh
source "$HERE/../lib/assert.sh"
# shellcheck source=hooks/lib/wtree.sh
source "$REPO_ROOT/hooks/lib/wtree.sh"

R="$HOME/repo"
mkdir -p "$R/src"
git -C "$R" init -q -b main
git -C "$R" config user.email t@t
git -C "$R" config user.name t
printf 'a\n' >"$R/src/a.js"
printf 'ignored/\n' >"$R/.gitignore"
git -C "$R" add -A && git -C "$R" commit -qm base

# --- wtree.sh ---------------------------------------------------------------
W0=$(wtree_hash "$R")
[[ "$W0" == "$(git -C "$R" rev-parse 'HEAD^{tree}')" ]] && ok "1 clean tree: fingerprint equals HEAD^{tree}" || ng "1 $W0"

mkdir -p "$R/ignored" && printf 'x\n' >"$R/ignored/big.log"
[[ "$(wtree_hash "$R")" == "$W0" ]] && ok "2 an ignored file does not move it" || ng "2 ignored file moved it"

printf 'new\n' >"$R/src/b.js"
W2=$(wtree_hash "$R")
# A rewrite through a Bash heredoc, the channel Edit/Write-keyed hooks miss.
cat >"$R/src/a.js" <<'EOF'
b
EOF
W3=$(wtree_hash "$R")
git -C "$R" checkout -q -- src/a.js
W4=$(wtree_hash "$R")
if [[ "$W2" != "$W0" && "$W3" != "$W2" && "$W4" == "$W2" ]]; then
  ok "3 an untracked file and a heredoc rewrite move it; restoring the file restores it"
else ng "3 W0=$W0 W2=$W2 W3=$W3 W4=$W4"; fi
rm -f "$R/src/b.js"

# The test's own checkout above rewrote the index; measure wtree alone, with an
# untracked file and a modified tracked file present.
printf 'u\n' >"$R/src/u.js"; printf 'c\n' >>"$R/src/a.js"
IDX_BEFORE=$(cksum <"$R/.git/index")
wtree_hash "$R" >/dev/null
IDX_AFTER=$(cksum <"$R/.git/index")
STATUS4=$(git -C "$R" status --porcelain -- src | tr '\n' ' ')
rm -f "$R/src/u.js"; git -C "$R" checkout -q -- src/a.js
LEFT=$(find "$TMPDIR" -name 'claudemd-wtree-*' | wc -l | tr -d ' ')
[[ "$IDX_BEFORE" == "$IDX_AFTER" && "$LEFT" == 0 && "$STATUS4" == " M src/a.js ?? src/u.js " ]] \
  && ok "4 the real index is untouched and no temp index is left behind" || ng "4 index-changed=$([[ "$IDX_BEFORE" != "$IDX_AFTER" ]] && echo y) temp-left=$LEFT"

mkdir -p "$HOME/norepo" "$HOME/nocommit"
git -C "$HOME/nocommit" init -q
if ! wtree_hash "$HOME/norepo" >/dev/null && ! wtree_hash "$HOME/nocommit" >/dev/null; then
  ok "5 outside a repo, or with no commit: no fingerprint (exit 1)"
else ng "5 fingerprinted a non-repo or an empty repo"; fi

# --- verify-log.sh ----------------------------------------------------------
post() { # COMMAND STDOUT [CWD]
  jq -cn --arg c "$1" --arg o "$2" --arg d "${3:-$R}" \
    '{hook_event_name:"PostToolUse", session_id:"v1", tool_use_id:"tu9", cwd:$d, tool_name:"Bash", tool_input:{command:$c}, tool_response:{stdout:$o, stderr:"", interrupted:false}}'
}
runs() { jq -c 'select(.hook=="verify-log" and .event=="verify-run") | .extra' "$LOG" 2>/dev/null; }

post 'npm test' 'ok' | bash "$HOOK" >/dev/null 2>&1
[[ -z "$(runs)" ]] && ok "6 opt-in unset: nothing logged" || ng "6 logged without opt-in"

post 'npm test' 'ok' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npm run smoke' 'ok' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'bash scripts/check.sh' 'tests 12 passed' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'ls -la' 'total 0' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npm test' 'ok' "$HOME/norepo" | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npm test' 'ok' | DISABLE_VERIFY_LOG_HOOK=1 EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
TIERS=$(runs | jq -r '.tier' | tr '\n' ' ')
if [[ "$TIERS" == "T2 T1 T2-output " ]] && [[ "$(runs | jq -r '.wtree' | sort -u)" == "$W0" ]]; then
  ok "7 runner, smoke entry and runner output are logged with the tree they ran on; ls, a non-repo and the kill switch are not"
else ng "7 tiers=[$TIERS] wtrees=$(runs | jq -r '.wtree' | sort -u | tr '\n' ' ')"; fi

# --- evidence-gate claim-wtree ------------------------------------------------
TR="$HOME/.claude/projects/p/s.jsonl"
{
  jq -cn '{type:"user",entrypoint:"cli",message:{content:"fix it"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_e",name:"Edit",input:{file_path:"/p/src/a.js"}}]}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Done: fixed."}]}}'
} >"$TR"
claim() { jq -cn --arg t "$TR" --arg d "$R" '{hook_event_name:"Stop", session_id:"v1", cwd:$d, last_assistant_message:"Done: fixed.", transcript_path:$t}'; }
claim | EVIDENCE_GATE=1 bash "$EG" >/dev/null 2>&1
N8=$(jq -c 'select(.hook=="evidence-gate" and .event=="claim-wtree")' "$LOG" 2>/dev/null | wc -l | tr -d ' ')
claim | EVIDENCE_GATE=1 EVIDENCE_WTREE=1 bash "$EG" >/dev/null 2>&1
ROW=$(jq -c 'select(.hook=="evidence-gate" and .event=="claim-wtree") | .extra' "$LOG" 2>/dev/null | tail -1)
if [[ "$N8" == 0 && "$(jq -r .wtree <<<"$ROW")" == "$W0" && "$(jq -r .verdict <<<"$ROW")" == no-command-output ]]; then
  ok "8 with EVIDENCE_WTREE=1 a claim logs its fingerprint beside evidence-gate's verdict; without it, nothing"
else ng "8 before=$N8 row=$ROW"; fi

claudemd_assert_summary
