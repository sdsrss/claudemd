#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/memory-read-check.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

CWD="/work/proj"
ENCODED=$(echo "$CWD" | tr '/' '-')
PROJ_DIR="$HOME/.claude/projects/$ENCODED"
MEM_DIR="$PROJ_DIR/memory"
mkdir -p "$MEM_DIR"

cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
- [Untagged legacy](project_old.md) — scan always
EOF
touch "$MEM_DIR/feedback_ship.md" "$MEM_DIR/project_old.md"

FAIL=0
mkevent() {
  local cmd="$1" sess="$2"
  cat <<EOF
{"session_id":"$sess","tool_name":"Bash","tool_input":{"command":"$cmd"},"cwd":"$CWD"}
EOF
}

# Case 1: ship keyword, tag matches, file unread → deny
SESS="sess1"
echo '{"tool":"Read","path":"/other/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 1 tag match + unread → deny" || { echo "FAIL: 1 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 2: ship keyword, memory file read → pass
SESS="sess2"
cat > "$PROJ_DIR/$SESS.jsonl" <<EOF
{"tool":"Read","file_path":"$MEM_DIR/feedback_ship.md"}
{"tool":"Read","file_path":"$MEM_DIR/project_old.md"}
EOF
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 2 both read → pass" || { echo "FAIL: 2 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 3: escape hatch
SESS="sess3"
echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main [skip-memory-check]" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 3 escape hatch" || { echo "FAIL: 3 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 4: transcript missing (CC version drift) → fail-open pass
SESS="sess-nonexistent"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 4 missing transcript → fail-open" || { echo "FAIL: 4 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 5: MEMORY.md missing → fail-open pass
rm "$MEM_DIR/MEMORY.md"
SESS="sess5"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 5 missing MEMORY.md → fail-open" || { echo "FAIL: 5 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 6: non-matching keyword (git status) → pass
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
SESS="sess6"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git status" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 6 non-matching keyword → pass" || { echo "FAIL: 6 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 7: kill-switch
SESS="sess7"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(DISABLE_MEMORY_READ_HOOK=1 bash "$HOOK" <<<"$(mkevent "git push origin main" "$SESS")" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 7 kill-switch" || { echo "FAIL: 7 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 8: cwd with dots encodes via `/.` → `-` (H2) — must match Claude Code's
# project-dir encoding. Previously hook used `tr '/' '-'` and silently failed
# on any project path containing a dot (e.g. `~/.config/...`, `my.project/`),
# turning the HARD §11 rule into a silent no-op.
DOT_CWD="/work/my.project"
DOT_ENCODED=$(echo "$DOT_CWD" | tr '/.' '-')
DOT_PROJ="$HOME/.claude/projects/$DOT_ENCODED"
DOT_MEM="$DOT_PROJ/memory"
mkdir -p "$DOT_MEM"
cat > "$DOT_MEM/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
touch "$DOT_MEM/feedback_ship.md"
SESS="sess8"
echo '{"tool":"Read","path":"/unrelated"}' > "$DOT_PROJ/$SESS.jsonl"
EVENT_8="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$DOT_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_8" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 8 dot-in-cwd → correct encoding → deny" \
  || { echo "FAIL: 8 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 8b (v0.23.16): cwd with a SPECIAL char beyond `/._` (here a space) must
# also encode correctly. CC replaces every non-`[a-zA-Z0-9-]` char with `-`, so
# the hook must use `tr -c 'a-zA-Z0-9-' '-'`. The narrower `tr '/._'` left the
# space intact → looked for the memory dir at the wrong path → MEM_INDEX absent
# → fail-open → the HARD §11 gate silently no-op'd for any project path with a
# space / `+` / `@` / etc. (e.g. macOS "Application Support"). The expected dir
# below is computed with the wide transform to match CC + the fixed hook.
SP_CWD="/work/my proj"
SP_ENCODED=$(printf '%s' "$SP_CWD" | tr -c 'a-zA-Z0-9-' '-')
SP_PROJ="$HOME/.claude/projects/$SP_ENCODED"
SP_MEM="$SP_PROJ/memory"
mkdir -p "$SP_MEM"
cat > "$SP_MEM/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
touch "$SP_MEM/feedback_ship.md"
SESS="sess8b"
echo '{"tool":"Read","path":"/unrelated"}' > "$SP_PROJ/$SESS.jsonl"
EVENT_8B="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$SP_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_8B" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 8b space-in-cwd → correct encoding → deny" \
  || { echo "FAIL: 8b (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 9: tag containing regex metacharacters is matched literally (H3). Before
# the v6.10.1 `-qiF` fix, a tag like `v6.9` would regex-match `v6X9`, `v699`,
# etc. — drifting into false-positive territory as tag vocab grows. Locks the
# intent: tags are plain strings, not BREs.
SESS="sess9"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Specific release lessons](feedback_release.md) `[v6.9, deploy.prod]` — only match literally
EOF
touch "$MEM_DIR/feedback_release.md"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
# `v6X9` would match `v6.9` under regex (`.` = any char); under -F it does not.
# Command contains neither literal `v6.9` nor literal `deploy.prod`, but DOES
# contain `deploy` (fires the ship/release/deploy/push keyword filter). Tags
# are NOT substrings of CMD → no tag-based file should match → no deny.
OUT=$(mkevent "deploy --env v6X9 deployXprod" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 9 regex-metachar tag matched literally → no false deny" \
  || { echo "FAIL: 9 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 10: plain-form tag block (spec §11 syntax `[tag, tag]` without
# backticks). Pre-fix the hook only matched the backtick-wrapped form, so
# any plain-form line was treated as untagged → matched every push command.
# Asserts: a plain-form tag whose tags do NOT match the command keywords
# does NOT trigger a deny.
PLAIN_DIR="$HOME/.claude/projects/${ENCODED}-plain"
PLAIN_MEM="$PLAIN_DIR/memory"
mkdir -p "$PLAIN_MEM"
cat > "$PLAIN_MEM/MEMORY.md" <<'EOF'
- [Plain-form tags](feedback_plain.md) [unrelated, sometag] — plain spec §11 syntax
EOF
touch "$PLAIN_MEM/feedback_plain.md"
SESS="sess10"
PLAIN_CWD="${CWD}-plain"
echo '{"tool":"Read","path":"/unrelated"}' > "$PLAIN_DIR/$SESS.jsonl"
EVENT_10="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$PLAIN_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_10" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 10 plain-form tag, no keyword match → no false deny" \
  || { echo "FAIL: 10 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 11: plain-form tag block, keyword IN tag list → deny when unread.
# Confirms plain-form parser actually extracts tags (Case 10 alone could
# pass via the untagged-fallback path that was always too eager).
SESS="sess11"
cat > "$PLAIN_MEM/MEMORY.md" <<'EOF'
- [Plain-form tags](feedback_plain.md) [push, deploy] — plain spec §11 syntax
EOF
echo '{"tool":"Read","path":"/unrelated"}' > "$PLAIN_DIR/$SESS.jsonl"
EVENT_11="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$PLAIN_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_11" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 11 plain-form tag, keyword match + unread → deny" \
  || { echo "FAIL: 11 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 12 (B): untagged-only MEMORY.md entry must NOT auto-block. Pre-fix the
# hook treated every untagged line as "always required Read", forcing the
# user to Read N unrelated files on every push. Spec §11 "Index is a router,
# not a substitute" — untagged matching is the agent's responsibility, not
# the hook's. Locks: ship command + only-untagged entries → pass.
UNTAG_DIR="$HOME/.claude/projects/${ENCODED}-untag"
UNTAG_MEM="$UNTAG_DIR/memory"
mkdir -p "$UNTAG_MEM"
cat > "$UNTAG_MEM/MEMORY.md" <<'EOF'
- [Untagged one](project_a.md) — no tag block at all
- [Untagged two](project_b.md) — also no tags
EOF
touch "$UNTAG_MEM/project_a.md" "$UNTAG_MEM/project_b.md"
SESS="sess12"
UNTAG_CWD="${CWD}-untag"
echo '{"tool":"Read","path":"/unrelated"}' > "$UNTAG_DIR/$SESS.jsonl"
EVENT_12="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$UNTAG_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_12" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 12 untagged-only MEMORY → no auto-block" \
  || { echo "FAIL: 12 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 13 (B): mixed tagged + untagged. Tagged matching keyword + unread →
# deny, but the deny message must mention ONLY the tagged file, not the
# untagged ones. Locks: untagged entries are silent at hook level even when
# a sibling tagged entry triggers a block.
MIX_DIR="$HOME/.claude/projects/${ENCODED}-mix"
MIX_MEM="$MIX_DIR/memory"
mkdir -p "$MIX_MEM"
cat > "$MIX_MEM/MEMORY.md" <<'EOF'
- [Tagged ship](feedback_ship.md) `[push]` — tagged
- [Untagged sibling](project_other.md) — should not appear in deny
EOF
touch "$MIX_MEM/feedback_ship.md" "$MIX_MEM/project_other.md"
SESS="sess13"
MIX_CWD="${CWD}-mix"
echo '{"tool":"Read","path":"/unrelated"}' > "$MIX_DIR/$SESS.jsonl"
EVENT_13="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$MIX_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_13" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
REASON=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecisionReason 2>/dev/null)
if [[ "$DEC" == "deny" ]] && echo "$REASON" | grep -qF "feedback_ship.md" \
  && ! echo "$REASON" | grep -qF "project_other.md"; then
  echo "PASS: 13 mixed tagged+untagged → deny only on tagged"
else
  echo "FAIL: 13 (out: $OUT)"; FAIL=$((FAIL+1))
fi

# Case 14 (C): ship-word inside quoted commit message must NOT trigger,
# even when MEMORY has a tag that would match the quoted word. Pre-fix the
# regex `(git push|release|deploy|ship)` matched anywhere, so
# `git commit -m "release notes"` triggered the scan; the tagged `release`
# entry then demanded a Read. Locks anchor: trigger words must be at
# command-segment-start, not embedded in quoted args.
SESS="sess14"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Release lessons](feedback_release.md) `[release]` — would false-match in quotes pre-fix
EOF
touch "$MEM_DIR/feedback_release.md"
EVENT_14="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m 'fix: release notes update'\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_14" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 14 ship-word in quoted commit msg → no trigger" \
  || { echo "FAIL: 14 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 15 (C): glab mr create is a real ship verb at command-start; the
# trigger filter must fire so tagged matches are still enforced. With no
# tag matching the command keywords, the file requirement set is empty →
# pass. Confirms `glab mr` got added to the trigger list without breaking
# the no-tag-match exit path.
SESS="sess15"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[migration, schema]` — neither tag in the command
EOF
touch "$MEM_DIR/feedback_push.md"
EVENT_15="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"glab mr create --title bump\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_15" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 15 glab mr + non-matching tags → no deny" \
  || { echo "FAIL: 15 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 16 (C): standalone shipping verb (`release-please`, `deploy.sh`,
# `&& deploy`) at command-segment-start must STILL trigger the filter so
# tagged matches are enforced. Locks: tightening C didn't accidentally
# kill real ship-tool detection.
SESS="sess16"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Deploy lessons](feedback_deploy.md) `[deploy]` — fires on real deploy
EOF
touch "$MEM_DIR/feedback_deploy.md"
EVENT_16="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd dist && deploy --env prod\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_16" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 16 standalone deploy after && → still triggers" \
  || { echo "FAIL: 16 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 17: cwd with underscore encodes via `_` → `-` too. Empirically CC
# converts every non-`[a-zA-Z0-9-]` char (including `_`); pre-fix `tr '/.'`
# silently missed underscore-containing paths (e.g. /mnt/data_ssd/...) and
# fail-open'd the HARD §11 rule for any such project — the predominant
# silent-no-op shape on Linux hosts where dirs commonly carry underscores.
US_CWD="/work/my_project"
US_ENCODED=$(echo "$US_CWD" | tr '/._' '-')
US_PROJ="$HOME/.claude/projects/$US_ENCODED"
US_MEM="$US_PROJ/memory"
mkdir -p "$US_MEM"
cat > "$US_MEM/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
touch "$US_MEM/feedback_ship.md"
SESS="sess17"
echo '{"tool":"Read","path":"/unrelated"}' > "$US_PROJ/$SESS.jsonl"
EVENT_17="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$US_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_17" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 17 underscore-in-cwd → correct encoding → deny" \
  || { echo "FAIL: 17 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 18: mixed `/`, `.`, `_` in cwd all encode to `-` together. Locks the
# combined-class behavior in one fixture so future regressions on any of the
# three chars get surfaced.
MIX_CWD="/mnt/data_ssd/my.proj_v2"
MIX_ENCODED=$(echo "$MIX_CWD" | tr '/._' '-')
MIX2_PROJ="$HOME/.claude/projects/$MIX_ENCODED"
MIX2_MEM="$MIX2_PROJ/memory"
mkdir -p "$MIX2_MEM"
cat > "$MIX2_MEM/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
touch "$MIX2_MEM/feedback_ship.md"
SESS="sess18"
echo '{"tool":"Read","path":"/unrelated"}' > "$MIX2_PROJ/$SESS.jsonl"
EVENT_18="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$MIX_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_18" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 18 mixed /._ in cwd → correct encoding → deny" \
  || { echo "FAIL: 18 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 19: tag beginning with `-` (e.g. `--file`, `-h`). Pre-fix `grep -qiF
# "$t"` parsed `--file` as a grep flag, erroring `option '--file' requires
# an argument` and abort-fail-opening the whole MEMORY scan. `-- "$t"` end-
# of-options separator forces literal interpretation. Locks: dash-prefixed
# tags don't break the hook AND still match correctly.
DASH_DIR="$HOME/.claude/projects/${ENCODED}-dash"
DASH_MEM="$DASH_DIR/memory"
mkdir -p "$DASH_MEM"
cat > "$DASH_MEM/MEMORY.md" <<'EOF'
- [Flag-prefix tags](feedback_flagtags.md) `[--file, -h, ship]` — flags as tags
EOF
touch "$DASH_MEM/feedback_flagtags.md"
SESS="sess19"
DASH_CWD="${CWD}-dash"
echo '{"tool":"Read","path":"/unrelated"}' > "$DASH_DIR/$SESS.jsonl"
# CMD contains `--file`, so the `--file` tag should match → file unread → deny
EVENT_19="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npx claudemd lint --file COMMIT_EDITMSG && git push\"},\"cwd\":\"$DASH_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_19" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
# Pre-fix the grep error printed to stderr and the hook exit'd 0 with no JSON.
# Post-fix: tag matches → unread file → deny JSON.
if [[ "$DEC" == "deny" ]] && ! echo "$OUT" | grep -q "option.*requires an argument"; then
  echo "PASS: 19 dash-prefixed tag matched literally (no grep --flag crash)"
else
  echo "FAIL: 19 (out: $OUT)"; FAIL=$((FAIL+1))
fi

# Case 20 (D): v0.9.28 — short tag must NOT substring-match longer word.
# Pre-v0.9.28 grep -iF substring-matched tag `cli` inside `clippy` (and
# similar `dead-code` inside arbitrary citations), producing ~80% FP rate
# on real ship-flow self-audit.
S20_DIR="$HOME/.claude/projects/${ENCODED}-s20"
S20_MEM="$S20_DIR/memory"
mkdir -p "$S20_MEM"
cat > "$S20_MEM/MEMORY.md" <<'EOF'
- [CLI input shape](feedback_cli_shape.md) `[cli, ship]` — fires on cli verb
EOF
touch "$S20_MEM/feedback_cli_shape.md"
SESS="sess20"
S20_CWD="${CWD}-s20"
echo '{"tool":"Read","path":"/unrelated"}' > "$S20_DIR/$SESS.jsonl"
# CMD contains `clippy` (NOT `cli` as a word) and `git push`. Tag `cli` should
# NOT match `clippy`. Tag `ship` should NOT match (no ship word in body).
# But `git push` triggers the hook regex. So if cli-as-word doesn't match,
# only `ship` could match — and it doesn't → no deny.
EVENT_20="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cargo clippy && git push\"},\"cwd\":\"$S20_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_20" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 20 cli tag does NOT substring-match clippy (v0.9.28 word-boundary)" \
  || { echo "FAIL: 20 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 21 (D): v0.9.28 — short tag still matches plural form (declension
# tolerance, 0-2 trailing alpha chars allowed). `hook` should still match
# `hooks` (the plural form is the topic too).
S21_DIR="$HOME/.claude/projects/${ENCODED}-s21"
S21_MEM="$S21_DIR/memory"
mkdir -p "$S21_MEM"
cat > "$S21_MEM/MEMORY.md" <<'EOF'
- [Hook lib](feedback_hook_lib.md) `[hook, ship]` — sourcing rule
EOF
touch "$S21_MEM/feedback_hook_lib.md"
SESS="sess21"
S21_CWD="${CWD}-s21"
echo '{"tool":"Read","path":"/unrelated"}' > "$S21_DIR/$SESS.jsonl"
# CMD contains `hooks` (plural) in an unquoted branch ref, tag `hook` should
# match (declension tolerance). Pre-vNEXT used `# added 2 hooks` form; that
# regressed once vNEXT's sanitize strips line-comments before tag scan
# (correctly — comments are descriptive prose, not topic declaration). Branch
# ref `hooks-fix` is real tokenized intent and survives sanitize.
EVENT_21="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin hooks-fix\"},\"cwd\":\"$S21_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_21" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 21 hook tag still matches hooks plural (declension tolerance)" \
  || { echo "FAIL: 21 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 22 (D): v0.9.28 — heredoc body line starting with conventional-commit
# verb (e.g. `release(v0.9.27): ...`) must NOT trigger the hook just because
# `^release` matches the bare-verb fallback at line-start. Pre-v0.9.28 the
# trigger regex's `^` anchor matched line-starts in multi-line $CMD, so any
# `git commit -m "$(cat <<EOF\nrelease(v0.9.27): ...\nEOF\n)"` would fire
# the scan even though no real ship verb was invoked. Fix: collapse \n to
# space before regex check.
S22_DIR="$HOME/.claude/projects/${ENCODED}-s22"
S22_MEM="$S22_DIR/memory"
mkdir -p "$S22_MEM"
cat > "$S22_MEM/MEMORY.md" <<'EOF'
- [Release lessons](feedback_release.md) `[release]` — would fire pre-fix
EOF
touch "$S22_MEM/feedback_release.md"
SESS="sess22"
S22_CWD="${CWD}-s22"
echo '{"tool":"Read","path":"/unrelated"}' > "$S22_DIR/$SESS.jsonl"
# Multi-line command: `git commit -m "..."` where the message body is a
# heredoc starting with `release(v0.9.27):`. No real ship verb in the bash
# command itself.
EVENT_22=$(jq -cn --arg cwd "$S22_CWD" --arg sess "$SESS" \
  '{session_id:$sess, tool_name:"Bash", tool_input:{command:"git commit -m \"$(cat <<EOF\nrelease(v0.9.27): hooks added\nEOF\n)\""}, cwd:$cwd}')
OUT=$(bash "$HOOK" <<<"$EVENT_22" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 22 heredoc-body release(...) line does NOT trigger (multi-line collapse)" \
  || { echo "FAIL: 22 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 23 (D): v0.9.28 — tag containing regex meta chars (`.`, `+`, etc.)
# must be escaped before use in the new -E word-boundary pattern. Tag
# `v6.9` should NOT match `v6X9` literally (the `.` was a regex `.` in
# unescaped form, matching any char).
S23_DIR="$HOME/.claude/projects/${ENCODED}-s23"
S23_MEM="$S23_DIR/memory"
mkdir -p "$S23_MEM"
cat > "$S23_MEM/MEMORY.md" <<'EOF'
- [Versioned](feedback_versioned.md) `[v6.9, ship]` — meta chars in tag
EOF
touch "$S23_MEM/feedback_versioned.md"
SESS="sess23"
S23_CWD="${CWD}-s23"
echo '{"tool":"Read","path":"/unrelated"}' > "$S23_DIR/$SESS.jsonl"
# `v6X9` does NOT contain literal `v6.9`; tag should not match.
# `git push` triggers the hook. Tag `ship` doesn't appear. So no deny.
EVENT_23="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push v6X9\"},\"cwd\":\"$S23_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_23" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 23 regex-meta tag (v6.9) escaped — does not match v6X9" \
  || { echo "FAIL: 23 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 24 (v0.9.36): bypass with reason form — [skip-memory-check: <reason>]
# extracts reason text into extra.bypass_reason in rule-hits log.
SESS="sess24"
echo '' > "$PROJ_DIR/$SESS.jsonl"
RULE_LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"
rm -f "$RULE_LOG"
OUT=$(mkevent "git push origin main [skip-memory-check: trivial doc edit]" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] || { echo "FAIL: 24a expected bypass (silent pass), got: $OUT"; FAIL=$((FAIL+1)); }
if [[ -f "$RULE_LOG" ]]; then
  LAST=$(tail -n 1 "$RULE_LOG")
  echo "$LAST" | jq -e '.event == "bypass-escape-hatch" and .extra.bypass_reason == "trivial doc edit"' >/dev/null \
    && echo "PASS: 24 bypass reason captured in extra.bypass_reason" \
    || { echo "FAIL: 24b expected bypass_reason='trivial doc edit' (got: $LAST)"; FAIL=$((FAIL+1)); }
else
  echo "FAIL: 24c rule-hits log not written"; FAIL=$((FAIL+1))
fi

# Case 25 (v0.9.36): bare [skip-memory-check] still works — backward compat,
# no bypass_reason in extra.
SESS="sess25"
echo '' > "$PROJ_DIR/$SESS.jsonl"
rm -f "$RULE_LOG"
OUT=$(mkevent "git push origin main [skip-memory-check]" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] || { echo "FAIL: 25a expected silent bypass, got: $OUT"; FAIL=$((FAIL+1)); }
LAST=$(tail -n 1 "$RULE_LOG" 2>/dev/null)
echo "$LAST" | jq -e '.event == "bypass-escape-hatch" and (.extra | has("bypass_reason") | not)' >/dev/null \
  && echo "PASS: 25 bare bypass token has no bypass_reason (back-compat)" \
  || { echo "FAIL: 25b expected no bypass_reason key (got: $LAST)"; FAIL=$((FAIL+1)); }

# Case 26 (v0.9.36): deny row carries extra.match_count = total MATCHES.
# 8 entries in MEMORY.md, all tagged with `push` so all 8 match the
# `git push` command; agent Read 0 → missing=8, match_count=8. (Tag `ship`
# would not match `git push` — substring match needs the verb to be in
# the command literally.)
S26_DIR="$HOME/.claude/projects/-work-s26"
S26_MEM="$S26_DIR/memory"
mkdir -p "$S26_MEM"
{
  for i in 1 2 3 4 5 6 7 8; do
    echo "- [Entry $i](feedback_$i.md) \`[push]\` — desc $i"
    touch "$S26_MEM/feedback_$i.md"
  done
} > "$S26_MEM/MEMORY.md"
SESS="sess26"
S26_CWD="/work/s26"
echo '{"tool":"Read","path":"/unrelated"}' > "$S26_DIR/$SESS.jsonl"
rm -f "$RULE_LOG"
EVENT_26="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$S26_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_26" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] || { echo "FAIL: 26a expected deny (got: $OUT)"; FAIL=$((FAIL+1)); }
LAST=$(tail -n 1 "$RULE_LOG" 2>/dev/null)
echo "$LAST" | jq -e '.event == "deny" and .extra.match_count == 8 and (.extra.missing | length) == 8' >/dev/null \
  && echo "PASS: 26 deny carries match_count=8 + missing.length=8" \
  || { echo "FAIL: 26b expected match_count=8 missing.length=8 (got: $LAST)"; FAIL=$((FAIL+1)); }

# Case 27 (v0.9.36): bypass with reason variations — `:` spacing tolerance.
SESS="sess27"
echo '' > "$PROJ_DIR/$SESS.jsonl"
rm -f "$RULE_LOG"
OUT=$(mkevent "git push origin main [skip-memory-check:no-space]" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] || { echo "FAIL: 27a expected silent bypass on no-space form, got: $OUT"; FAIL=$((FAIL+1)); }
LAST=$(tail -n 1 "$RULE_LOG" 2>/dev/null)
echo "$LAST" | jq -e '.extra.bypass_reason == "no-space"' >/dev/null \
  && echo "PASS: 27 bypass tolerates no space after colon" \
  || { echo "FAIL: 27b (got: $LAST)"; FAIL=$((FAIL+1)); }

# Case 28 (E): vNEXT — tag inside `--title "..."` quoted body must NOT match.
# v0.9.28 anchored TRIGGER at command-segment-start (Case 14 locked `release`
# inside quoted commit msg). Tag-match stage was left scanning raw command, so
# `glab mr create --title "fix macos issue"` fired tag `mac` exact-match against
# `macos` inside the quoted title. Title text is description, not topic
# declaration. Fix: sanitize quoted bodies before tag scan.
S28_DIR="$HOME/.claude/projects/${ENCODED}-s28"
S28_MEM="$S28_DIR/memory"
mkdir -p "$S28_MEM"
cat > "$S28_MEM/MEMORY.md" <<'EOF'
- [macOS shell portability](feedback_macos.md) `[mac, ship]` — should not match Mac in title
EOF
touch "$S28_MEM/feedback_macos.md"
SESS="sess28"
S28_CWD="${CWD}-s28"
echo '{"tool":"Read","path":"/unrelated"}' > "$S28_DIR/$SESS.jsonl"
EVENT_28="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"glab mr create --title \\\"fix macos issue\\\"\"},\"cwd\":\"$S28_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_28" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 28 mac tag inside --title body → no FP" \
  || { echo "FAIL: 28 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 29 (E): vNEXT — tag inside single-quoted body must NOT match. Same class
# as 28, single-quote variant. `git push origin 'release/v1.0'` should not fire
# tag `release` from the quoted branch ref.
S29_DIR="$HOME/.claude/projects/${ENCODED}-s29"
S29_MEM="$S29_DIR/memory"
mkdir -p "$S29_MEM"
cat > "$S29_MEM/MEMORY.md" <<'EOF'
- [Release flow](feedback_release_flow.md) `[release, push]` — release tag should not match quoted branch
EOF
touch "$S29_MEM/feedback_release_flow.md"
SESS="sess29"
S29_CWD="${CWD}-s29"
echo '{"tool":"Read","path":"/unrelated"}' > "$S29_DIR/$SESS.jsonl"
# Tag `push` still matches `push` in the unquoted command verb → deny expected,
# but Case 29 is about `release` not falsely matching from inside the quoted
# branch ref. To isolate just the quoted-body sanitize, use a single-tag fixture
# with only `release` (no `push`); pre-fix this denies, post-fix passes.
cat > "$S29_MEM/MEMORY.md" <<'EOF'
- [Release flow](feedback_release_flow.md) `[release]` — release should not match quoted branch
EOF
EVENT_29="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin 'release/v1.0'\"},\"cwd\":\"$S29_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_29" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 29 release tag inside 'quoted' branch → no FP" \
  || { echo "FAIL: 29 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 30 (v0.17.5): backtick-form TAG_BLOCK anchors on `.md)` so a decorative
# `\`[token]\`` inside the description doesn't get parsed as the tag. Pre-fix
# the greedy `.*\`\[...\]\`.*` matched the LAST backtick block on the line, so
# a real tag `[shippy]` followed by description "see also `[other]` inline"
# made `other` the parsed tag — meaning `shippy` keyword in a command silently
# missed the rule, and `other` in an unrelated context falsely fired.
S30_DIR="$HOME/.claude/projects/${ENCODED}-s30"
S30_MEM="$S30_DIR/memory"
mkdir -p "$S30_MEM"
cat > "$S30_MEM/MEMORY.md" <<'EOF'
- [Shippy](feedback_shippy.md) `[shippy]` — see also `[othershippy]` reference
EOF
touch "$S30_MEM/feedback_shippy.md"
SESS="sess30"
S30_CWD="${CWD}-s30"
echo '{"tool":"Read","path":"/unrelated"}' > "$S30_DIR/$SESS.jsonl"

# Real tag fires — `shippy` in command should match the parsed tag block.
EVENT_30_REAL="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin shippy-branch\"},\"cwd\":\"$S30_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_30_REAL" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 30 real tag (backtick form, .md)-anchored) fires deny" \
  || { echo "FAIL: 30 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Decorative `\`[other]\`` in description does NOT fire.
EVENT_30_FP="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin othershippy-branch\"},\"cwd\":\"$S30_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_30_FP" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" != "deny" ]] && echo "PASS: 31 decorative backtick-block in desc does NOT match" \
  || { echo "FAIL: 31 (expected pass, got: $OUT)"; FAIL=$((FAIL+1)); }

# Case 32 (vNEXT): a tag word that appears only inside a filesystem PATH must
# NOT match. Live-reproduced twice during the 2026-06-03 impact audit: a
# read-only command whose path contained `~/.claude/projects/...` matched the
# `projects` tag of feedback_cc_cwd_encoding_dots.md and denied. A path segment
# is not a topic declaration (same logic as the quoted-title FP, Case 28). Fix:
# strip slash-containing (path / URL) tokens in sanitize_for_tagmatch.
S32_DIR="$HOME/.claude/projects/${ENCODED}-s32"
S32_MEM="$S32_DIR/memory"
mkdir -p "$S32_MEM"
cat > "$S32_MEM/MEMORY.md" <<'EOF'
- [CWD encoding](feedback_cwd_enc.md) `[projects, encoding]` — path word must not match
EOF
touch "$S32_MEM/feedback_cwd_enc.md"
SESS="sess32"
S32_CWD="${CWD}-s32"
echo '{"tool":"Read","path":"/unrelated"}' > "$S32_DIR/$SESS.jsonl"
EVENT_32="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main && ls /home/user/.claude/projects/foo\"},\"cwd\":\"$S32_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_32" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ -z "$OUT" || "$DEC" != "deny" ]] && echo "PASS: 32 tag word inside filesystem path → no FP" \
  || { echo "FAIL: 32 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 33 (vNEXT regression): the slash-token strip must be SURGICAL — a tag
# word appearing as a bare standalone token (not in a path) still matches.
EVENT_33="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main && echo encoding\"},\"cwd\":\"$S32_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_33" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 33 bare tag word (not in a path) still matches → deny" \
  || { echo "FAIL: 33 (expected deny, got: $OUT)"; FAIL=$((FAIL+1)); }

# Case 34 (v0.23.10 regression): a MULTI-LINE quoted --notes/--title body MUST
# be stripped before tag matching. sanitize_for_tagmatch's quote strip was a
# line-based sed (`s/"[^"]*"/""/g`), so a multi-paragraph `gh release create
# --notes "..."` leaked its prose into tag matching — the FP the strip exists
# to prevent. Live-reproduced: the v0.23.8/v0.23.9 release notes' "self-dogfood"
# matched a `dogfood` tag and forced a spurious deny + bypass. Fixed by
# flattening newlines around the quote strip.
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Audit conduct](feedback_audit_conduct.md) `[dogfood, read-only]` — read-only eval guidance
EOF
touch "$MEM_DIR/feedback_audit_conduct.md"
SESS="sess34"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
ML_CMD=$(printf 'gh release create v1 --notes "Release batch.\n\n- splits deny into self-dogfood vs external\n- lead with external as the real signal\n\nDone."')
EVENT_34=$(jq -cn --arg c "$ML_CMD" --arg s "$SESS" --arg w "$CWD" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},cwd:$w}')
OUT=$(bash "$HOOK" <<<"$EVENT_34" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 34 multi-line quoted --notes stripped → no FP deny" \
  || { echo "FAIL: 34 (expected silent, got: $OUT)"; FAIL=$((FAIL+1)); }

# Case 35: the multi-line quote strip must be SURGICAL — a tag word appearing
# BARE (unquoted) elsewhere in the command still matches. Locks: the flatten
# fix removes only quoted bodies, not real bare tokens. Reuses Case 34's
# MEMORY.md (`dogfood` tag); the bare `dogfood-cut` positional arg matches
# while the multi-line --notes body (no tag word) is stripped.
SESS="sess35"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
ML_CMD2=$(printf 'gh release create dogfood-cut --notes "prose line one\nprose line two"')
EVENT_35=$(jq -cn --arg c "$ML_CMD2" --arg s "$SESS" --arg w "$CWD" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},cwd:$w}')
OUT=$(bash "$HOOK" <<<"$EVENT_35" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 35 bare tag token outside quotes still matches (strip is surgical)" \
  || { echo "FAIL: 35 (expected deny, got: $OUT)"; FAIL=$((FAIL+1)); }

# Case 36 (v0.23.11 regression): an in-quote `#` (issue/PR number in a commit
# message) must NOT swallow the rest of the command. Pre-fix the line-comment
# strip ran BEFORE the quote strips, so `git commit -m "closes #42" && deploy
# <topic>` deleted everything after `#42` — including the trigger verb + topic
# tag — silently bypassing the §11 gate. Same ordering bug as pre-bash-safety.
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Apple topic](feedback_apple_topic.md) `[appletopicz]` — about appletopicz
EOF
touch "$MEM_DIR/feedback_apple_topic.md"
SESS="sess36"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
HASH_CMD='git commit -m "closes #42" && deploy appletopicz'
EVENT_36=$(jq -cn --arg c "$HASH_CMD" --arg s "$SESS" --arg w "$CWD" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},cwd:$w}')
OUT=$(bash "$HOOK" <<<"$EVENT_36" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 36 in-quote # does not bypass §11 gate" \
  || { echo "FAIL: 36 (expected deny, got: $OUT)"; FAIL=$((FAIL+1)); }

# Case 37: a REAL unquoted comment is still ignored (FP guard for Case 36's reorder).
SESS="sess37"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
CMT_CMD='ls # deploy appletopicz later'
EVENT_37=$(jq -cn --arg c "$CMT_CMD" --arg s "$SESS" --arg w "$CWD" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},cwd:$w}')
OUT=$(bash "$HOOK" <<<"$EVENT_37" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 37 real unquoted comment still ignored" \
  || { echo "FAIL: 37 (expected silent, got: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((37 - FAIL))/37 passed"; exit 1
fi
echo "Tests: 37/37 passed"
