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

# 9. release spellings the 0.101.0 regex missed (D#110 M4): tag flags, tag
# names without v, pushes of tags by ref or keyword, git and npm global
# options, and command prefixes.
R9_BAD=""
for c in 'git tag -f v2.0.0' 'git tag -am "release 2" v2.0.0' 'git tag --annotate -m x v2.0.0' \
  'git tag -s -u KEY v2.0.0' 'git tag pkg@2.0.0' 'git tag cli-v2.0.0' 'git tag 2.0.0-rc.1' 'git tag -a -- v2.0.0' \
  'git push --follow-tags' 'git push origin refs/tags/v2.0.0' 'git push origin tag v2.0.0' \
  'git push origin v2.0.0-rc.1' 'git push origin +v2.0.0' 'git push origin tag cli-v2.0.0' 'git push origin refs/tags/pkg@2.0.0:refs/tags/pkg@2.0.0' \
  'git --git-dir=.git tag v2.0.0' 'git -c user.name=x tag v2.0.0' 'git --no-pager push --tags' \
  'git --work-tree w --git-dir g push --tags' \
  'npm --prefix pkg publish' 'npm -w pkgs/a publish --access public' 'npm --registry=https://r.example publish' \
  'env -u FOO npm publish' 'env -i PATH=/bin npm publish' 'FOO="a b" npm publish' 'sudo -E npm publish' \
  'timeout 60 npm publish' 'timeout -k 5 60 git push --tags' 'nice -n 5 npm publish' 'nohup npm publish' \
  '(cd pkg && npm publish)' 'x=$(git tag v2.0.0)' 'npm publish --dry-run && git push --tags' \
  'npm publish --dry-run; npm publish' 'git tag -a v1.2.3 -Fnotes.md' 'gh release -R o/r create v1.0.0' \
  'x=`git tag v2.0.0`' 'gh -R o/r release create v1.0.0' 'git push origin v1.2.3:v1.2.3'; do
  [[ "$(decision "$(run deny "$c" g9)")" == deny ]] || R9_BAD+="[$c] "
done
[[ -z "$R9_BAD" ]] && ok "9 the spellings 0.101.0 missed are gated" || ng "9 missed: $R9_BAD"

# 10. not releases, including the 0.101.0 false positives: a branch that looks
# like a short version, a version word after a separator, tag listing,
# deletion and verification, a dry run in its own segment only, and tags
# without a version (fixture, probe and archive tags from the real-command replay).
# `git tag x v1.2.3` tags commit v1.2.3 as x — read as a release, a miss the safe way.
N10_BAD=""
for c in 'git push origin v2' 'git push origin main; echo v1.2.3' 'git push origin main && ls v1.2.3' \
  'git tag -d v1.0.0' 'git tag --delete v1.0.0' 'git tag -v v1.0.0' 'git tag -n' 'git tag --contains HEAD' \
  'git tag --sort=-v:refname' 'git tag --points-at HEAD' 'git tag' 'git tag -l "v*" | head' \
  'git push --dry-run --tags' 'git push -n origin v1.2.3' 'git push --delete origin v1.2.3' \
  'git push origin :refs/tags/v1.2.3' 'git push origin main --tags-only-typo' 'npm run publish-docs' \
  'npm view pkg version' 'npm publish --dry-run' 'npm pack' 'gh release view v1.2.3' 'gh release list' \
  'git status; npm test' 'git tag -f qa-baseline HEAD' 'git tag vprobe-ruleset HEAD~1' \
  'git tag -a archive/s8-scan f4a5736 -m ""' 'git push origin refs/tags/archive/s8-scan' 'git push --force origin vprobe-ruleset' \
  'git tag release-2026' 'git tag -am 2.0.0 notes-tag' 'git tag --message 1.2.3 notes-tag' 'git tag -ln v1.2.3' \
  'git push 192.168.1.10:repo.git main' 'git push 10.0.0.5:/srv/git/app.git HEAD' \
  'gh -R o/r release create --help' 'npm publish --help' \
  'git push -u origin release/0.13.0' 'git push origin fix/0.10.1-audit' 'git push origin cli-v2.0.0'; do
  [[ -z "$(run deny "$c" g10)" ]] || N10_BAD+="[$c] "
done
[[ -z "$N10_BAD" ]] && ok "10 non-release commands pass, including the 0.101.0 false positives" || ng "10 wrongly gated: $N10_BAD"

# 11. advisory allows the command, so it must not tell the model to run it again.
OUT11A=$(run advisory 'npm publish' g11)
OUT11D=$(run deny 'npm publish' g11)
if jq -e '.hookSpecificOutput.additionalContext | test("run the command again") | not' <<<"$OUT11A" >/dev/null 2>&1 \
  && jq -e '.hookSpecificOutput.permissionDecisionReason | test("run the command again")' <<<"$OUT11D" >/dev/null 2>&1; then
  ok "11 advisory text does not say to rerun an allowed command; deny text does"
else ng "11 advisory/deny text wrong: advisory=${OUT11A:0:200}"; fi

# 12. a Bash read of ship.md satisfies the gate (D#110 L14); a failed one does not.
TR12="$HOME/t12.jsonl"
{
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"b1",name:"Bash",input:{command:"cat ~/.claude/spec-modules/ship.md"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"b1",content:"ship rules"}]}}'
} >"$TR12"
TR12F="$HOME/t12f.jsonl"
{
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"b2",name:"Bash",input:{command:"cat ~/.claude/spec-modules/ship.md"}}]}}'
  jq -cn '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"b2",is_error:true,content:"denied"}]}}'
} >"$TR12F"
OUT12=$(run deny 'npm publish' g12 "$TR12")
OUT12F=$(run deny 'npm publish' g12f "$TR12F")
if [[ -z "$OUT12" && "$(decision "$OUT12F")" == deny ]]; then
  ok "12 a Bash cat of ship.md satisfies the gate; an errored one does not"
else ng "12 bash read: ok-run=$(decision "$OUT12") errored-run=$(decision "$OUT12F")"; fi

# 13. release spellings 0.103.0 missed (D#142 LOW-5, LOW-6): a redirection glued
# to the version (0.102.0 caught `git tag v1.2.3>/dev/null`), a version tag on the
# DESTINATION side of a refspec, --mirror (pushes every tag), and a
# path-qualified command prefix.
R13_BAD=""
for c in 'git tag v1.2.3>/dev/null' 'git push origin v1.2.3>/dev/null' 'git tag -a v1.2.3 -m x</dev/null' \
  'git push origin HEAD:refs/tags/v1.2.3' 'git push origin +main:refs/tags/v2.0.0' 'git push --mirror origin' \
  '/usr/bin/timeout 60 npm publish' '/usr/bin/env FOO=1 npm publish' '/usr/bin/sudo npm publish'; do
  [[ "$(decision "$(run deny "$c" g13)")" == deny ]] || R13_BAD+="[$c] "
done
[[ -z "$R13_BAD" ]] && ok "13 glued redirections, destination-side version tags, --mirror and path-qualified prefixes are gated" || ng "13 missed: $R13_BAD"

# 14. their neighbours are not releases: a tag deleted by an empty source, a
# version-named BRANCH as destination, a dry-run mirror, and a redirection into
# a file named like a version.
N14_BAD=""
for c in 'git push origin :refs/tags/v1.2.3' 'git push origin HEAD:refs/heads/v1.2.3' 'git push origin HEAD:release/1.2' \
  'git push --mirror --dry-run origin' 'git push -n --mirror origin' 'git log >v1.2.3' 'git push origin main 2>v1.2.3.log'; do
  [[ -z "$(run deny "$c" g14)" ]] || N14_BAD+="[$c] "
done
[[ -z "$N14_BAD" ]] && ok "14 tag deletion, version-named branches, dry-run mirrors and version-named log files pass" || ng "14 wrongly gated: $N14_BAD"

# 15. a bundled short option tens of thousands of characters long finishes well
# inside the 3 s hook budget (D#142 LOW-1: the letter loop was quadratic and a
# killed hook allows). Scan cost is capped, so 2 s is a wide margin.
LONG15="git tag -$(printf 'a%.0s' $(seq 1 20000)) v1.2.3"
S15=$(date +%s%N 2>/dev/null || echo 0)
OUT15=$(run deny "$LONG15" g15)
E15=$(( ($(date +%s%N 2>/dev/null || echo 0) - S15) / 1000000 ))
if [[ "$(decision "$OUT15")" == deny ]] && (( E15 < 2000 )); then
  ok "15 a 20,000-letter bundled option is parsed in ${E15} ms and still gated"
else ng "15 long bundled option: decision=$(decision "$OUT15") elapsed=${E15} ms"; fi

claudemd_assert_summary
