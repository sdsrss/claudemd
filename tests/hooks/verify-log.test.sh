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

# A runner piped into tail exits with tail's status, so PostToolUse sees a
# success even when the suite failed: 1,974 of 7,080 such logged runs in the
# maintainer's transcripts printed failures (0.105.0 pre-tag review M1).
N9=$(runs | wc -l | tr -d ' ')
post 'npx vitest run 2>&1 | tail -5' ' Test Files  1 failed (1)' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'node --test 2>&1 | tail -3' $'\xe2\x84\xb9 pass 7\n\xe2\x84\xb9 fail 2' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npx eslint . 2>&1 | head' $'\xe2\x9c\x96 2 problems (2 errors, 0 warnings)' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'bash tests/run.sh | tail -2' $'FAIL [deny]: case 3\nTests: 9/10 passed' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
N9b=$(runs | wc -l | tr -d ' ')
post 'node --test 2>&1 | tail -3' $'\xe2\x84\xb9 pass 9\n\xe2\x84\xb9 fail 0' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npx vitest run | tail -3' ' Tests  12 passed (12)' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
N9c=$(runs | wc -l | tr -d ' ')
if [[ "$N9b" == "$N9" && "$N9c" == $((N9 + 2)) ]]; then
  ok "9 a run whose output reports failures is not logged, whatever its exit status; a passing one is"
else ng "9 before=$N9 after-failing=$N9b after-passing=$N9c"; fi

# 9b. Each FAIL_OUT_RE branch on its own, and stderr (a runner that prints its
# verdict there): none of these is logged (0.105.0 delta review D-L4).
post_err() { # COMMAND STDOUT STDERR
  jq -cn --arg c "$1" --arg o "$2" --arg e "$3" --arg d "$R" \
    '{hook_event_name:"PostToolUse", session_id:"v1", tool_use_id:"tu9", cwd:$d, tool_name:"Bash", tool_input:{command:$c}, tool_response:{stdout:$o, stderr:$e, interrupted:false}}'
}
N9d=$(runs | wc -l | tr -d ' ')
post_err 'npx vitest run' ' Tests  12 passed (12)' ' Test Files  1 failed (1)' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npm test | tail' 'not ok 3 - handles empty input' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'cargo test | tail -3' 'test result: FAILED. 0 passed' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npx tsc --noEmit | head' 'src/a.ts(3,5): error TS2345: Argument' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
post 'npx eslint . | tail -1' $'\xe2\x9c\x96 1 problem' | EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
N9e=$(runs | wc -l | tr -d ' ')
[[ "$N9e" == "$N9d" ]] && ok "9b every failure-pattern branch, and a failure on stderr, keeps a run out of the log" || ng "9b before=$N9d after=$N9e"

# The 2 s bound stops a slow fingerprint with SIGTERM; the temp index must not
# outlive it (0.105.0 pre-tag review M3). A git whose `add` stalls stands in
# for a huge work tree.
FAKE="$TMP_HOME/fakebin"; mkdir -p "$FAKE"
REALGIT=$(command -v git)
printf '#!/usr/bin/env bash\n[[ " $* " == *" add "* ]] && sleep 5\nexec %q "$@"\n' "$REALGIT" >"$FAKE/git"
chmod +x "$FAKE/git"
find "$TMPDIR" -name 'claudemd-wtree-*' -delete 2>/dev/null
post 'npm test' 'ok' | PATH="$FAKE:$PATH" EVIDENCE_WTREE=1 bash "$HOOK" >/dev/null 2>&1
sleep 4
LEFT10=$(find "$TMPDIR" -name 'claudemd-wtree-*' | wc -l | tr -d ' ')
[[ "$LEFT10" == 0 ]] && ok "10 a fingerprint stopped at the 2 s bound leaves no temp index" || ng "10 $LEFT10 temp index file(s) left"

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
