#!/usr/bin/env bash
# user-journey.test.sh — real-user end-to-end simulation.
#
# full-lifecycle covers install→hook→uninstall through the SCRIPTS; this suite
# drives the same machinery the way Claude Code actually does it: a versioned
# marketplace cache dir, hooks fired from that root with real event JSON on
# stdin, and the background bootstrap the user never sees. The paths only this
# angle reaches are the ones that have historically broken silently —
# auto-upgrade, stale-root direction gate, spec-drift self-heal, and the
# "hook stdout must be exactly ONE JSON object" contract that turns two
# simultaneous banners into zero.
#
# Layout mirrors CC: $HOME/.claude/plugins/cache/<marketplace>/<plugin>/<semver>/
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# Physical-path normalize (macOS /var → /private/var): install.js' CLI trigger
# compares import.meta.url against argv[1], and a symlinked mktemp makes them
# disagree — install then no-ops at exit 0 with zero side effects.
#
# Two steps, not `SANDBOX=$(cd "$(mktemp -d)" && pwd -P)`. That one-liner fails
# OPEN: on mktemp failure the substitution is empty, `cd ""` returns 0, `pwd -P`
# prints the CURRENT directory — and the EXIT trap below then `rm -rf`s the repo.
SANDBOX=$(mktemp -d) || { echo "FAIL: mktemp -d failed"; exit 1; }
SANDBOX=$(cd "$SANDBOX" && pwd -P) || { echo "FAIL: cannot resolve $SANDBOX"; exit 1; }
export HOME="$SANDBOX/home"
export TMPDIR="$SANDBOX/tmp"
mkdir -p "$HOME/.claude" "$TMPDIR"

CACHE_PARENT="$HOME/.claude/plugins/cache/claudemd/claudemd"
CUR_VER=$(jq -r .version "$REPO/package.json")
NEXT_VER="99.0.0"
CUR_ROOT="$CACHE_PARENT/$CUR_VER"
NEXT_ROOT="$CACHE_PARENT/$NEXT_VER"

FAILS=0
PHASE=""

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

phase() { PHASE="$1"; printf '\n-- %s\n' "$1"; }
ok()   { printf '  ok %s\n' "$1"; }
bad()  { printf '  FAIL [%s] %s\n' "$PHASE" "$1"; FAILS=$((FAILS+1)); }

assert_eq() {
  if [[ "$3" == "$2" ]]; then ok "$1"
  else printf '  FAIL [%s] %s\n    expected: %s\n    actual:   %s\n' "$PHASE" "$1" "$2" "$3"; FAILS=$((FAILS+1)); fi
}
assert_file() { [[ -f "$2" ]] && ok "$1" || bad "$1 (missing: $2)"; }
assert_no_file() { [[ ! -e "$2" ]] && ok "$1" || bad "$1 (still present: $2)"; }
assert_contains() {
  case "$3" in *"$2"*) ok "$1" ;; *) printf '  FAIL [%s] %s\n    needle: %s\n    in:     %s\n' "$PHASE" "$1" "$2" "$3"; FAILS=$((FAILS+1)) ;; esac
}
assert_not_contains() {
  case "$3" in *"$2"*) printf '  FAIL [%s] %s\n    unexpected needle: %s\n    in: %s\n' "$PHASE" "$1" "$2" "$3"; FAILS=$((FAILS+1)) ;; *) ok "$1" ;; esac
}

# A hook's stdout must be EMPTY or exactly ONE JSON value. Two objects printed
# back to back is invalid JSON and CC drops BOTH banners silently.
assert_single_json() {
  local label="$1" out="$2" n
  if [[ -z "${out//[[:space:]]/}" ]]; then ok "$label (empty)"; return; fi
  n=$(printf '%s' "$out" | jq -s 'length' 2>/dev/null) || n="parse-error"
  assert_eq "$label" "1" "$n"
}

# Simulate `/plugin install`: materialize a versioned cache dir from the repo.
# Only the files CC ships are copied; VERSION overrides the semver in the three
# manifests so an "upgrade" can be staged without touching the working tree.
stage_cache_version() {
  # Separate `local` statements on purpose: bash expands ALL arguments to the
  # `local` builtin before it assigns any of them, so `local a=$1 b=$CACHE/$a`
  # reads the OUTER (unset) `a` and dies under `set -u`.
  local ver="$1"
  local dest="$CACHE_PARENT/$ver"
  local d
  mkdir -p "$dest"
  for d in spec hooks scripts commands .claude-plugin; do
    cp -R "$REPO/$d" "$dest/" 2>/dev/null || true
  done
  cp "$REPO/package.json" "$dest/package.json"
  jq --arg v "$ver" '.version = $v' "$REPO/package.json" > "$dest/package.json.tmp" && mv "$dest/package.json.tmp" "$dest/package.json"
  jq --arg v "$ver" '.version = $v' "$REPO/.claude-plugin/plugin.json" > "$dest/.claude-plugin/plugin.json.tmp" && mv "$dest/.claude-plugin/plugin.json.tmp" "$dest/.claude-plugin/plugin.json"
  printf '%s\n' "$dest"
}

# Event JSON is built with `jq -n`, never printf: a hand-written format string
# silently eats `\"`, and the malformed JSON that produces makes every hook
# fail-open with empty stdout — which reads exactly like "the gate is broken".
bash_event() {
  jq -cn --arg cmd "$1" --arg cwd "$REPO" \
    '{session_id:"uj", tool_name:"Bash", tool_input:{command:$cmd}, cwd:$cwd}'
}

# Fire the SessionStart hook the way CC does: event JSON on stdin, hook path
# under the versioned cache root. Echoes stdout for banner assertions.
# DISABLE_UPSTREAM_CHECK defaults to 1 here: without it every SessionStart in
# phases 1-5 makes a real `git ls-remote` to github.com (session-start-check.sh's
# upstream_check), which makes the suite network-dependent and slow for banners
# no phase before 6 asserts on. Phase 6 — the one that tests the notice — sets
# DISABLE_UPSTREAM_CHECK=0 explicitly and stubs the remote via CLAUDEMD_LS_REMOTE_CMD.
fire_session_start() {
  local root="$1" source_field="${2:-startup}" sid="${3:-uj-session}"
  jq -cn --arg sid "$sid" --arg src "$source_field" --arg cwd "$REPO" \
    '{session_id:$sid, source:$src, cwd:$cwd}' \
    | DISABLE_UPSTREAM_CHECK="${DISABLE_UPSTREAM_CHECK:-1}" bash "$root/hooks/session-start-check.sh" 2>/dev/null
}

fire_user_prompt() {
  local root="$1" sid="${2:-uj-session}"
  jq -cn --arg sid "$sid" --arg cwd "$REPO" '{session_id:$sid, prompt:"hello", cwd:$cwd}' \
    | CLAUDE_SESSION_ID="$sid" bash "$root/hooks/version-sync.sh" 2>/dev/null
}

# The bootstrap is detached — poll rather than sleep a fixed amount.
wait_for_manifest_version() {
  local want="$1" i got
  for i in $(seq 1 60); do
    got=$(jq -r '.version // ""' "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null) || got=""
    [[ "$got" == "$want" ]] && { printf '%s' "$got"; return 0; }
    sleep 0.25
  done
  printf '%s' "${got:-<none>}"
  return 1
}

########################################################################
phase "Phase 1 — /plugin install claudemd@claudemd (fresh machine)"
########################################################################
stage_cache_version "$CUR_VER" >/dev/null
assert_file "cache root staged" "$CUR_ROOT/package.json"

# No manifest yet → SessionStart takes the fresh-bootstrap branch.
OUT=$(fire_session_start "$CUR_ROOT")
assert_single_json "SessionStart stdout is single-JSON-or-empty" "$OUT"
GOT=$(wait_for_manifest_version "$CUR_VER")
assert_eq "background bootstrap wrote manifest v$CUR_VER" "$CUR_VER" "$GOT"

assert_file "CLAUDE.md installed"          "$HOME/.claude/CLAUDE.md"
assert_file "CLAUDE-extended.md installed" "$HOME/.claude/CLAUDE-extended.md"
assert_file "CLAUDE-changelog.md installed" "$HOME/.claude/CLAUDE-changelog.md"
assert_file "OPERATOR.md installed"        "$HOME/.claude/OPERATOR.md"
assert_file "rule-hits log created"        "$HOME/.claude/logs/claudemd.jsonl"

SHIPPED_HOOKS=$(jq '[.hooks[][].hooks[]] | length' "$REPO/hooks/hooks.json")
MANIFEST_HOOKS=$(jq '.entries | length' "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo 0)
assert_eq "manifest carries every shipped hook" "$SHIPPED_HOOKS" "$MANIFEST_HOOKS"

SPEC_SAME=0; cmp -s "$REPO/spec/CLAUDE.md" "$HOME/.claude/CLAUDE.md" || SPEC_SAME=1
assert_eq "installed spec is byte-identical to shipped" "0" "$SPEC_SAME"

RESIDUE=$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("claudemd"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
assert_eq "settings.json carries 0 claudemd hook entries" "0" "$RESIDUE"
STATUSLINE=$(jq -r '.statusLine.command // ""' "$HOME/.claude/settings.json" 2>/dev/null)
assert_contains "statusLine auto-adopted on empty slot" "statusline.sh" "$STATUSLINE"

########################################################################
phase "Phase 2 — user checks the install (/claudemd-status, /claudemd-doctor)"
########################################################################
ST=$(node "$CUR_ROOT/scripts/status.js" 2>/dev/null); ST_RC=$?
assert_eq "status.js exit 0" "0" "$ST_RC"
assert_eq "status reports installed spec version" \
  "$(sed -n '1s/.*AI-CODING-SPEC v\([0-9.]*\).*/\1/p' "$REPO/spec/CLAUDE.md")" \
  "$(printf '%s' "$ST" | jq -r '.spec.installed // ""' | sed 's/^v//')"
assert_eq "status reports plugin installed" "true" "$(printf '%s' "$ST" | jq -r '.plugin.installed')"
assert_eq "status: every shipped spec file hash-matches" "0" \
  "$(printf '%s' "$ST" | jq '[.spec.hashes[] | select(.match != true)] | length')"

DOC=$(node "$CUR_ROOT/scripts/doctor.js" 2>&1); DOC_RC=$?
# 0 = all green, 3 = some check failed. 1/2 mean doctor itself broke.
if [[ "$DOC_RC" == "0" || "$DOC_RC" == "3" ]]; then ok "doctor.js ran (exit $DOC_RC)"
else bad "doctor.js crashed (exit $DOC_RC)"; printf '%s\n' "$DOC" | head -20; fi
assert_not_contains "doctor reports no spec drift on a fresh install" "spec drift" "$DOC"
DOC_FAILED=$(printf '%s\n' "$DOC" | grep -c '^ *FAIL' || true)
if [[ "$DOC_RC" == "3" ]]; then printf '  note: doctor FAIL lines (%s):\n' "$DOC_FAILED"; printf '%s\n' "$DOC" | grep '^ *FAIL' | sed 's/^/    /'; fi

########################################################################
phase "Phase 3 — enforcement actually fires"
########################################################################
# Both quote shapes: `-m "msg"` is the far more common form a user actually
# types, and it is the one a naive quote-stripping sanitizer loses.
for Q in '"' "'"; do
  DENY=$(bash_event "git commit -m ${Q}significantly improved${Q}" | bash "$CUR_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null)
  assert_single_json "banned-vocab stdout single-JSON (${Q}quotes${Q})" "$DENY"
  assert_eq "banned-vocab denies §10-V vocabulary (${Q}quotes${Q})" "deny" \
    "$(printf '%s' "$DENY" | jq -r '.hookSpecificOutput.permissionDecision // ""')"
done

ESCAPED=$(bash_event 'git commit -m "significantly improved [allow-banned-vocab]"' | bash "$CUR_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null)
assert_not_contains "documented per-commit escape hatch works" '"deny"' "$ESCAPED"

SAFE=$(bash_event 'rm -rf $UNVALIDATED/' | bash "$CUR_ROOT/hooks/pre-bash-safety-check.sh" 2>/dev/null)
assert_single_json "pre-bash-safety stdout single-JSON" "$SAFE"
assert_eq "§8 denies rm -rf on an unvalidated var" "deny" "$(printf '%s' "$SAFE" | jq -r '.hookSpecificOutput.permissionDecision // ""')"

ALLOWED=$(bash_event 'git status --short' | bash "$CUR_ROOT/hooks/pre-bash-safety-check.sh" 2>/dev/null)
assert_not_contains "benign command not denied" '"deny"' "$ALLOWED"

HITS=$(wc -l < "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | tr -d ' ')
if [[ "${HITS:-0}" -ge 2 ]]; then ok "rule-hits telemetry recorded ($HITS rows)"
else bad "expected ≥2 rule-hits rows, got ${HITS:-0}"; fi

########################################################################
phase "Phase 4 — auto-update: marketplace ships $NEXT_VER"
########################################################################
stage_cache_version "$NEXT_VER" >/dev/null
# Make the new spec distinguishable so we can prove the NEW bytes landed.
printf '\n<!-- user-journey upgrade marker -->\n' >> "$NEXT_ROOT/spec/CLAUDE.md"

OUT=$(fire_session_start "$NEXT_ROOT")
assert_single_json "upgrade SessionStart stdout single-JSON" "$OUT"
GOT=$(wait_for_manifest_version "$NEXT_VER")
assert_eq "manifest auto-upgraded $CUR_VER → $NEXT_VER" "$NEXT_VER" "$GOT"
if grep -qF 'user-journey upgrade marker' "$HOME/.claude/CLAUDE.md"; then ok "new spec bytes landed in ~/.claude"
else bad "spec not refreshed on auto-upgrade"; fi
assert_contains "bootstrap log records the auto-upgrade" "auto-upgrade: manifest $CUR_VER" "$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null)"

########################################################################
phase "Phase 5 — stale plugin registration must NOT downgrade"
########################################################################
# CC still has the OLD cache dir registered; hooks fire from it while the
# manifest already records the new version.
OUT=$(fire_session_start "$CUR_ROOT")
assert_single_json "stale-root SessionStart single-JSON" "$OUT"
assert_contains "stale-registration banner shown" "stale plugin registration" "$OUT"
sleep 1
assert_eq "manifest NOT downgraded by the stale root" "$NEXT_VER" \
  "$(jq -r .version "$HOME/.claude/.claudemd-manifest.json")"

# Same gate on the UserPromptSubmit piggy-back path (stdout must stay 0 bytes).
UP=$(fire_user_prompt "$CUR_ROOT" "uj-stale")
assert_eq "version-sync emits 0 bytes" "" "$UP"
sleep 1
assert_eq "version-sync did not downgrade either" "$NEXT_VER" \
  "$(jq -r .version "$HOME/.claude/.claudemd-manifest.json")"

# And install.js itself refuses, loudly, when invoked directly from the old root.
DOWN=$(node "$CUR_ROOT/scripts/install.js" 2>&1); DOWN_RC=$?
assert_eq "install.js refuses downgrade (exit 1)" "1" "$DOWN_RC"
assert_contains "refusal names the fix" "/claudemd-refresh" "$DOWN"

########################################################################
phase "Phase 6 — upstream 'upgrade available' notice"
########################################################################
STUB="$SANDBOX/ls-remote-stub.sh"
printf '#!/usr/bin/env bash\nprintf "deadbeef\\trefs/tags/v199.0.0\\n"\n' > "$STUB"
chmod +x "$STUB"
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun"
OUT=$(DISABLE_UPSTREAM_CHECK=0 CLAUDEMD_LS_REMOTE_CMD="bash $STUB" CLAUDEMD_CACHE_PARENT="$CACHE_PARENT" fire_session_start "$NEXT_ROOT")
assert_single_json "upstream-banner stdout single-JSON" "$OUT"
assert_contains "upgrade-available banner shown" "v199.0.0 available" "$OUT"

# 24h sentinel: the expensive probe must not repeat on the next session.
OUT2=$(DISABLE_UPSTREAM_CHECK=0 CLAUDEMD_LS_REMOTE_CMD="bash $STUB" CLAUDEMD_CACHE_PARENT="$CACHE_PARENT" fire_session_start "$NEXT_ROOT")
assert_not_contains "second session skips the network probe" "v199.0.0 available" "$OUT2"

# Two banners at once must merge into ONE object, not two.
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun"
printf '{"denies":3,"bypasses":1,"warns":2,"top_section":"§10-V"}' > "$HOME/.claude/.claudemd-state/last-session-summary.json"
OUT3=$(DISABLE_UPSTREAM_CHECK=0 CLAUDEMD_LS_REMOTE_CMD="bash $STUB" CLAUDEMD_CACHE_PARENT="$CACHE_PARENT" fire_session_start "$NEXT_ROOT")
assert_single_json "upstream + summary merge into ONE object" "$OUT3"
assert_contains "merged banner keeps the upgrade notice" "v199.0.0 available" "$OUT3"
assert_contains "merged banner keeps the session summary" "last session: 3 denies" "$OUT3"

########################################################################
phase "Phase 7 — self-heal"
########################################################################
# 7a: someone hand-edits ~/.claude/CLAUDE.md → drift banner names the file.
printf '\nHAND EDITED\n' >> "$HOME/.claude/CLAUDE.md"
OUT=$(DISABLE_UPSTREAM_CHECK=1 fire_session_start "$NEXT_ROOT")
assert_single_json "spec-drift stdout single-JSON" "$OUT"
assert_contains "spec-drift banner fires" "installed spec differs" "$OUT"
assert_contains "drift banner names CLAUDE.md" "CLAUDE.md" "$OUT"

# Per-file opt-out silences exactly that file.
OUT=$(DISABLE_UPSTREAM_CHECK=1 SPEC_DRIFT_IGNORE="CLAUDE.md" fire_session_start "$NEXT_ROOT")
assert_not_contains "SPEC_DRIFT_IGNORE suppresses the named file" "installed spec differs" "$OUT"

# 7b: manifest vanishes (user wiped state) → next session re-bootstraps.
rm -f "$HOME/.claude/.claudemd-manifest.json"
OUT=$(DISABLE_UPSTREAM_CHECK=1 fire_session_start "$NEXT_ROOT")
GOT=$(wait_for_manifest_version "$NEXT_VER")
assert_eq "manifest self-healed after deletion" "$NEXT_VER" "$GOT"
if grep -qF 'HAND EDITED' "$HOME/.claude/CLAUDE.md"; then bad "re-bootstrap left the drifted spec in place"
else ok "re-bootstrap restored the shipped spec"; fi

# 7c: a background bootstrap failed last session → banner, then consumed.
mkdir -p "$HOME/.claude/.claudemd-state"
printf '{"ts":"2026-08-16T00:00:00Z","from":"0.1.0","to":"%s"}' "$NEXT_VER" > "$HOME/.claude/.claudemd-state/bootstrap-failed.json"
rm -f "$HOME/.claude/.claudemd-manifest.json"
OUT=$(DISABLE_UPSTREAM_CHECK=1 fire_session_start "$NEXT_ROOT")
assert_single_json "bootstrap-failed stdout single-JSON" "$OUT"
assert_contains "bootstrap-failure banner shown" "background upgrade failed" "$OUT"
assert_no_file "bootstrap-failed sentinel consumed" "$HOME/.claude/.claudemd-state/bootstrap-failed.json"
wait_for_manifest_version "$NEXT_VER" >/dev/null

# 7d: versions agree again → a stale sentinel is cleared silently, no banner.
printf '{"ts":"2026-08-16T00:00:00Z","from":"0.1.0","to":"%s"}' "$NEXT_VER" > "$HOME/.claude/.claudemd-state/bootstrap-failed.json"
OUT=$(DISABLE_UPSTREAM_CHECK=1 fire_session_start "$NEXT_ROOT")
assert_not_contains "no failure banner once state is healthy" "background upgrade failed" "$OUT"
assert_no_file "stale sentinel cleared" "$HOME/.claude/.claudemd-state/bootstrap-failed.json"

# 7e: compaction event must not run a bootstrap, only remind.
OUT=$(fire_session_start "$NEXT_ROOT" "compact")
assert_single_json "compact stdout single-JSON" "$OUT"
assert_contains "compaction re-read reminder" "compaction detected" "$OUT"

########################################################################
phase "Phase 8 — /claudemd-uninstall then /plugin uninstall"
########################################################################
UN=$(node "$NEXT_ROOT/scripts/uninstall.js" 2>&1); UN_RC=$?
assert_eq "uninstall.js exit 0" "0" "$UN_RC"
assert_eq "spec kept by default" "keep" "$(printf '%s' "$UN" | jq -r '.specAction // ""')"
assert_no_file "manifest removed" "$HOME/.claude/.claudemd-manifest.json"
assert_file "spec preserved" "$HOME/.claude/CLAUDE.md"
REMAIN=$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("claudemd"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
assert_eq "0 claudemd hook entries survive" "0" "$REMAIN"
SL_AFTER=$(jq -r '.statusLine.command // ""' "$HOME/.claude/settings.json" 2>/dev/null)
assert_not_contains "statusLine un-wired" "statusline.sh" "$SL_AFTER"

# Idempotent: a second run is a warning, not a crash.
UN2=$(node "$NEXT_ROOT/scripts/uninstall.js" 2>&1); UN2_RC=$?
assert_eq "second uninstall exit 0" "0" "$UN2_RC"
assert_eq "second uninstall warns already-uninstalled" "already-uninstalled" \
  "$(printf '%s' "$UN2" | jq -r '.warning // ""')"

# Re-install after uninstall (the user changed their mind).
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1
assert_eq "re-install restores manifest" "$NEXT_VER" \
  "$(jq -r '.version // ""' "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)"

# Purge removes claudemd's own logs + state.
CLAUDEMD_PURGE=1 node "$NEXT_ROOT/scripts/uninstall.js" >/dev/null 2>&1; PURGE_RC=$?
assert_eq "purge uninstall exit 0" "0" "$PURGE_RC"
assert_no_file "state dir purged" "$HOME/.claude/.claudemd-state"
assert_no_file "rule-hits log purged" "$HOME/.claude/logs/claudemd.jsonl"
assert_no_file "bootstrap log purged" "$HOME/.claude/logs/claudemd-bootstrap.log"
assert_file "spec still preserved after purge" "$HOME/.claude/CLAUDE.md"

########################################################################
phase "Phase 9 — no residue outside the sandbox HOME"
########################################################################
STRAY=$(find "$TMPDIR" -maxdepth 1 -name 'claudemd-*' 2>/dev/null | wc -l | tr -d ' ')
printf '  note: %s claudemd-* sentinel(s) in TMPDIR (session-scoped, GC after 24h)\n' "$STRAY"
# Match the shapes the product ACTUALLY writes, at the depth it writes them.
# The first cut looked for bare `*.tmp` under -maxdepth 6 — nothing in the tree
# is ever named that (settings-merge.js writes `<path>.tmp-<pid>`,
# statusline-hosts.js `<path>.tmp.<pid>`, session-summary.sh / session-end-check.sh
# `<path>.tmp.$$`, session-start-check.sh `<log>.tail.$$`), and the one `*.tmp`
# name in this harness sits deeper than 6. So the assertion could not fail
# (2026-08-16 pre-tag review). Scoped to the sandbox HOME, not $SANDBOX: the
# latter holds the Phase 12 symlink farms, which are thousands of entries.
LEAK=$(find "$HOME" \( -name '*.tmp' -o -name '*.tmp-*' -o -name '*.tmp.*' -o -name '*.tail.*' \) 2>/dev/null | wc -l | tr -d ' ')
if [[ "$LEAK" == "0" ]]; then ok "no half-written temp files left behind"
else bad "half-written temp file(s) left behind ($LEAK):"; find "$HOME" \( -name '*.tmp' -o -name '*.tmp-*' -o -name '*.tmp.*' -o -name '*.tail.*' \) 2>/dev/null | sed 's/^/      /'; fi

########################################################################
# Hostile-environment scenarios. Each starts from a pristine HOME — these are
# collisions and degraded machines, not steps in the journey above.
########################################################################
# Wipe the user's ~/.claude but KEEP the plugin cache — it lives under
# ~/.claude/plugins in the real layout, and a naive `rm -rf $HOME` deletes the
# very plugin the next phase installs from.
reset_home() {
  local keep="$SANDBOX/keep-plugins"
  rm -rf "$keep"
  mv "$HOME/.claude/plugins" "$keep" 2>/dev/null || true
  rm -rf "$HOME"
  mkdir -p "$HOME/.claude"
  [[ -d "$keep" ]] && mv "$keep" "$HOME/.claude/plugins"
  return 0
}

phase "Phase 10 — collision: user already owns ~/.claude/CLAUDE.md + statusLine + hooks"
reset_home
printf '# My personal notes\n\nAlways use tabs.\n' > "$HOME/.claude/CLAUDE.md"
jq -n '{
  statusLine: {type:"command", command:"/opt/other-provider/statusline.sh"},
  hooks: {PreToolUse: [{matcher:"Bash", hooks:[{type:"command", command:"bash /opt/otherplugin/hooks/guard.sh"}]}]}
}' > "$HOME/.claude/settings.json"

INS=$(node "$NEXT_ROOT/scripts/install.js" 2>&1)
assert_contains "install warns before overwriting personal CLAUDE.md" "does not look like a claudemd spec" "$INS"
BK=$(find "$HOME/.claude" -maxdepth 1 -type d -name 'backup-*' | head -1)
if [[ -n "$BK" ]] && grep -qF 'Always use tabs' "$BK/CLAUDE.md" 2>/dev/null; then ok "personal CLAUDE.md preserved in backup"
else bad "personal CLAUDE.md not found in a backup dir"; fi
assert_eq "foreign statusLine NOT clobbered" "/opt/other-provider/statusline.sh" \
  "$(jq -r '.statusLine.command // ""' "$HOME/.claude/settings.json")"
assert_eq "another plugin's hook survives install" "1" \
  "$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("otherplugin"))] | length' "$HOME/.claude/settings.json")"

RES=$(CLAUDEMD_SPEC_ACTION=restore node "$NEXT_ROOT/scripts/uninstall.js" 2>&1)
assert_eq "uninstall --restore reports restore" "restore" "$(printf '%s' "$RES" | jq -r '.specAction // ""')"
if grep -qF 'Always use tabs' "$HOME/.claude/CLAUDE.md" 2>/dev/null; then ok "personal CLAUDE.md restored on uninstall"
else bad "restore did not bring back the personal CLAUDE.md"; fi
assert_eq "another plugin's hook survives uninstall" "1" \
  "$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("otherplugin"))] | length' "$HOME/.claude/settings.json")"
assert_eq "foreign statusLine still untouched after uninstall" "/opt/other-provider/statusline.sh" \
  "$(jq -r '.statusLine.command // ""' "$HOME/.claude/settings.json")"

phase "Phase 11 — incomplete plugin cache (interrupted download)"
reset_home
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1
BROKEN="$SANDBOX/broken-cache/98.0.0"
mkdir -p "$BROKEN"
cp -R "$NEXT_ROOT/spec" "$NEXT_ROOT/hooks" "$NEXT_ROOT/scripts" "$BROKEN/"
cp "$NEXT_ROOT/package.json" "$BROKEN/"
rm -f "$BROKEN/spec/CLAUDE-extended.md"
BEFORE_HASH=$(cksum < "$HOME/.claude/CLAUDE.md")
OUT=$(node "$BROKEN/scripts/install.js" 2>&1); RC=$?
assert_eq "install refuses a truncated spec/ (exit 1)" "1" "$RC"
assert_contains "refusal names the missing file" "CLAUDE-extended.md" "$OUT"
assert_eq "user's installed spec untouched by the refusal" "$BEFORE_HASH" "$(cksum < "$HOME/.claude/CLAUDE.md")"

cp "$NEXT_ROOT/spec/CLAUDE-extended.md" "$BROKEN/spec/"
rm -f "$BROKEN/hooks/hooks.json"
OUT=$(node "$BROKEN/scripts/install.js" 2>&1); RC=$?
assert_eq "install refuses a missing hook manifest (exit 1)" "1" "$RC"
assert_contains "refusal explains it would register 0 hooks" "0 hooks" "$OUT"

printf 'not json{' > "$BROKEN/hooks/hooks.json"
OUT=$(node "$BROKEN/scripts/install.js" 2>&1); RC=$?
assert_eq "install refuses a corrupt hook manifest (exit 1)" "1" "$RC"
assert_contains "refusal names invalid JSON" "not valid JSON" "$OUT"

phase "Phase 12 — degraded machine: jq missing / jq broken / node missing"
reset_home
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1

# True absence: a symlink farm of the real PATH with `jq` left out. A stub that
# merely fails would exercise the DIFFERENT (jq-broken) branch.
NOJQ="$SANDBOX/nojq"
mkdir -p "$NOJQ"
OLD_IFS="$IFS"; IFS=':'
for d in $PATH; do
  [[ -d "$d" ]] || continue
  for f in "$d"/*; do
    [[ -x "$f" && ! -d "$f" ]] || continue
    b="${f##*/}"
    [[ "$b" == "jq" ]] && continue
    [[ -e "$NOJQ/$b" ]] || ln -s "$f" "$NOJQ/$b" 2>/dev/null || true
  done
done
IFS="$OLD_IFS"
if [[ -e "$NOJQ/jq" ]]; then bad "nojq farm still exposes jq"; fi

# Events are built with the FULL PATH and only then piped into the degraded
# shell — otherwise the harness's own `jq -cn` is the thing that goes missing
# and every hook looks broken for the wrong reason.
SS_EVENT=$(jq -cn --arg cwd "$REPO" '{session_id:"uj-degraded", source:"startup", cwd:$cwd}')
VOCAB_EVENT=$(bash_event 'git commit -m "significantly improved"')

OUT=$(printf '%s' "$SS_EVENT" | PATH="$NOJQ" bash "$NEXT_ROOT/hooks/session-start-check.sh" 2>/dev/null); RC=$?
assert_eq "SessionStart survives a jq-less machine (exit 0)" "0" "$RC"
assert_single_json "jq-less SessionStart stdout still valid" "$OUT"
OUT=$(printf '%s' "$VOCAB_EVENT" | PATH="$NOJQ" bash "$NEXT_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null); RC=$?
assert_eq "banned-vocab fail-opens without jq (exit 0)" "0" "$RC"
assert_not_contains "jq-less hook emits no half-built JSON" "permissionDecision" "$OUT"

# jq present but broken — the distinct branch hook_jq_field exists for.
BADJQ="$SANDBOX/badjq"
mkdir -p "$BADJQ"
printf '#!/usr/bin/env bash\nexit 127\n' > "$BADJQ/jq"; chmod +x "$BADJQ/jq"
OUT=$(printf '%s' "$SS_EVENT" | PATH="$BADJQ:$PATH" bash "$NEXT_ROOT/hooks/session-start-check.sh" 2>/dev/null); RC=$?
assert_eq "SessionStart survives a broken jq (exit 0)" "0" "$RC"
assert_single_json "broken-jq SessionStart stdout still valid" "$OUT"
OUT=$(printf '%s' "$VOCAB_EVENT" | PATH="$BADJQ:$PATH" bash "$NEXT_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null); RC=$?
assert_eq "banned-vocab fail-opens on a broken jq (exit 0)" "0" "$RC"

# node missing — the bootstrap must be a silent no-op, never an error.
NONODE="$SANDBOX/nonode"
mkdir -p "$NONODE"
for f in "$NOJQ"/*; do b="${f##*/}"; [[ "$b" == "node" ]] && continue; ln -s "$f" "$NONODE/$b" 2>/dev/null || true; done
ln -s "$(command -v jq)" "$NONODE/jq" 2>/dev/null || true
rm -f "$HOME/.claude/.claudemd-manifest.json"
OUT=$(printf '%s' "$SS_EVENT" | PATH="$NONODE" bash "$NEXT_ROOT/hooks/session-start-check.sh" 2>/dev/null); RC=$?
assert_eq "SessionStart survives a node-less machine (exit 0)" "0" "$RC"
assert_single_json "node-less SessionStart stdout still valid" "$OUT"
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1

phase "Phase 13 — kill switches (/claudemd-toggle, DISABLE_CLAUDEMD_HOOKS)"
node "$NEXT_ROOT/scripts/toggle.js" banned-vocab >/dev/null 2>&1; TOG_RC=$?
assert_eq "toggle.js exit 0" "0" "$TOG_RC"
assert_eq "toggle wrote DISABLE_BANNED_VOCAB_HOOK=1" "1" \
  "$(jq -r '.env.DISABLE_BANNED_VOCAB_HOOK // ""' "$HOME/.claude/settings.json")"
OUT=$(bash_event 'git commit -m "significantly improved"' | DISABLE_BANNED_VOCAB_HOOK=1 bash "$NEXT_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null)
assert_not_contains "disabled hook stops denying" "deny" "$OUT"
node "$NEXT_ROOT/scripts/toggle.js" banned-vocab >/dev/null 2>&1
assert_eq "toggle round-trips back off" "" \
  "$(jq -r '.env.DISABLE_BANNED_VOCAB_HOOK // ""' "$HOME/.claude/settings.json")"
OUT=$(bash_event 'git commit -m "significantly improved"' | bash "$NEXT_ROOT/hooks/banned-vocab-check.sh" 2>/dev/null)
assert_eq "re-enabled hook denies again" "deny" "$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // ""')"

OUT=$(bash_event 'rm -rf $UNVALIDATED/' | DISABLE_CLAUDEMD_HOOKS=1 bash "$NEXT_ROOT/hooks/pre-bash-safety-check.sh" 2>/dev/null)
assert_eq "global kill switch silences every hook" "" "${OUT//[[:space:]]/}"

node "$NEXT_ROOT/scripts/toggle.js" no-such-hook >/dev/null 2>&1; BAD_RC=$?
assert_eq "toggle rejects an unknown hook name (exit 1)" "1" "$BAD_RC"

phase "Phase 14 — concurrent sessions racing the bootstrap"
# Two CC windows opening at once both fire SessionStart. settings.json is
# read-modify-written by each install, so the sharp question is not "is it
# still JSON" but "did a lost update drop someone else's keys".
jq '.env.UJ_FOREIGN_KEY = "keep-me"
    | .hooks.PreToolUse = [{matcher:"Bash", hooks:[{type:"command", command:"bash /opt/otherplugin/hooks/guard.sh"}]}]' \
  "$HOME/.claude/settings.json" > "$SANDBOX/settings.race" && mv "$SANDBOX/settings.race" "$HOME/.claude/settings.json"
rm -f "$HOME/.claude/.claudemd-manifest.json"
for i in 1 2 3 4; do fire_session_start "$NEXT_ROOT" startup "uj-race-$i" >/dev/null & done
wait
GOT=$(wait_for_manifest_version "$NEXT_VER")
assert_eq "manifest lands intact after 4 concurrent bootstraps" "$NEXT_VER" "$GOT"
if jq -e . "$HOME/.claude/.claudemd-manifest.json" >/dev/null 2>&1; then ok "manifest is valid JSON after the race"
else bad "manifest corrupted by concurrent writers"; fi
if jq -e . "$HOME/.claude/settings.json" >/dev/null 2>&1; then ok "settings.json is valid JSON after the race"
else bad "settings.json corrupted by concurrent writers"; fi
assert_eq "no lost update: another plugin's env key survives the race" "keep-me" \
  "$(jq -r '.env.UJ_FOREIGN_KEY // "GONE"' "$HOME/.claude/settings.json" 2>/dev/null)"
assert_eq "no lost update: another plugin's hook survives the race" "1" \
  "$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("otherplugin"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)"
BK_COUNT=$(find "$HOME/.claude" -maxdepth 1 -type d -name 'backup-*' | wc -l | tr -d ' ')
if [[ "$BK_COUNT" -le 5 ]]; then ok "backup dirs stay within the prune ceiling ($BK_COUNT ≤ 5)"
else bad "backup dirs exceeded the prune ceiling ($BK_COUNT)"; fi

phase "Phase 15 — user hand-edited ~/.claude/settings.json into invalid JSON"
# settings.json is shared real estate; a trailing comma from a manual edit is
# the single most common way it stops parsing. Neither entry point may react by
# damaging the user's files or by getting permanently stuck.
reset_home
printf '# My personal notes\n\nAlways use tabs.\n' > "$HOME/.claude/CLAUDE.md"
PERSONAL_HASH=$(cksum < "$HOME/.claude/CLAUDE.md")
printf '{\n  "model": "opus",\n}\n' > "$HOME/.claude/settings.json"

OUT=$(node "$NEXT_ROOT/scripts/install.js" 2>&1); RC=$?
assert_eq "install refuses on unparseable settings.json (exit 1)" "1" "$RC"
assert_contains "refusal names settings.json" "settings.json" "$OUT"
assert_eq "personal CLAUDE.md NOT overwritten by the refused install" "$PERSONAL_HASH" "$(cksum < "$HOME/.claude/CLAUDE.md")"
BK_N=$(find "$HOME/.claude" -maxdepth 1 -type d -name 'backup-*' | wc -l | tr -d ' ')
assert_eq "no orphan backup dir from the refused install" "0" "$BK_N"
assert_no_file "no half-written manifest" "$HOME/.claude/.claudemd-manifest.json"

# Repairing settings.json must be enough to get unstuck — no manual cleanup.
printf '{"model":"opus"}\n' > "$HOME/.claude/settings.json"
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1
assert_eq "install succeeds once settings.json parses" "$NEXT_VER" \
  "$(jq -r '.version // ""' "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)"

# Uninstall must not be held hostage by the same file.
printf '{\n  "model": "opus",\n}\n' > "$HOME/.claude/settings.json"
OUT=$(node "$NEXT_ROOT/scripts/uninstall.js" 2>&1); RC=$?
assert_eq "uninstall still completes with unparseable settings.json (exit 0)" "0" "$RC"
assert_no_file "manifest removed despite the corrupt settings.json" "$HOME/.claude/.claudemd-manifest.json"
assert_contains "uninstall reports the skipped settings eviction" "settings.json" "$OUT"
# Everything claudemd owns INSIDE that file survives — hook entries AND the
# statusLine (removeStatusline reads the same file). The report must name both,
# or the user reads "uninstalled" while claudemd still renders their prompt.
assert_contains "report names the statusLine as also left behind" "statusLine" "$OUT"
assert_contains "stderr warns the statusLine could not be un-wired" "could not un-wire the statusLine" "$OUT"

phase "Phase 16 — the window between /plugin install and the first bootstrap"
# CC registers the hooks from hooks/hooks.json the moment the plugin installs,
# but it never fires plugin.json's postInstall — so for the rest of that first
# session EVERY hook runs against a ~/.claude that has no spec, no manifest and
# no state dir. Each one must exit 0 and print either nothing or exactly one
# JSON value; a crash or a double-emit here is the user's first impression.
reset_home

event_for() {
  case "$1" in
    SessionStart)     jq -cn --arg c "$REPO" '{session_id:"uj-cold", source:"startup", cwd:$c}' ;;
    UserPromptSubmit) jq -cn --arg c "$REPO" '{session_id:"uj-cold", prompt:"read the spec and ship it", cwd:$c}' ;;
    PreToolUse)       jq -cn --arg c "$REPO" '{session_id:"uj-cold", tool_name:"Bash", tool_input:{command:"git push origin main"}, cwd:$c}' ;;
    PostToolUse)      jq -cn --arg c "$REPO" '{session_id:"uj-cold", tool_name:"Bash", tool_input:{command:"echo hi"}, tool_response:{stdout:"hi"}, cwd:$c}' ;;
    Stop|SessionEnd)  jq -cn --arg c "$REPO" '{session_id:"uj-cold", cwd:$c, reason:"end_turn"}' ;;
    *)                jq -cn --arg c "$REPO" '{session_id:"uj-cold", cwd:$c}' ;;
  esac
}

# stdin comes from a FILE, never a pipe. Several hooks are opt-in and exit
# before reading stdin; with a pipe the upstream writer then takes SIGPIPE and
# `pipefail` reports the hook as exit 141 — a load-dependent harness artifact
# that looks exactly like a crashing hook. A file has no reader to close.
EVENT_FILE="$SANDBOX/cold-event.json"

COLD_N=0
while IFS='	' read -r EV CMDPATH; do
  HOOKFILE="$NEXT_ROOT/hooks/$CMDPATH"
  [[ -f "$HOOKFILE" ]] || { bad "hooks.json references a missing file: $CMDPATH"; continue; }
  event_for "$EV" > "$EVENT_FILE"
  OUT=$(bash "$HOOKFILE" < "$EVENT_FILE" 2>/dev/null); RC=$?
  COLD_N=$((COLD_N+1))
  [[ "$RC" == "0" ]] || bad "$CMDPATH ($EV) exited $RC on a cold ~/.claude"
  assert_single_json "$CMDPATH ($EV) cold-start stdout" "$OUT"
done < <(jq -r '.hooks | to_entries[] | .key as $e | .value[].hooks[] | [$e, (.command | capture("hooks/(?<f>[a-z0-9-]+\\.sh)").f)] | @tsv' "$NEXT_ROOT/hooks/hooks.json")
assert_eq "every shipped hook exercised cold" "$SHIPPED_HOOKS" "$COLD_N"

# ...and the same sweep once the spec IS installed. Measured: all 15 hooks emit
# empty stdout in BOTH passes, so this is not a warm-vs-cold output difference —
# it is the same exit-0 + no-double-emit contract re-checked against the other
# ~/.claude state (spec + manifest + state dir present), which is a different set
# of code paths inside the hooks even when the visible result matches.
node "$NEXT_ROOT/scripts/install.js" >/dev/null 2>&1
WARM_N=0
while IFS='	' read -r EV CMDPATH; do
  HOOKFILE="$NEXT_ROOT/hooks/$CMDPATH"
  [[ -f "$HOOKFILE" ]] || continue
  event_for "$EV" > "$EVENT_FILE"
  OUT=$(bash "$HOOKFILE" < "$EVENT_FILE" 2>/dev/null); RC=$?
  WARM_N=$((WARM_N+1))
  [[ "$RC" == "0" ]] || bad "$CMDPATH ($EV) exited $RC on an installed ~/.claude"
  assert_single_json "$CMDPATH ($EV) warm stdout" "$OUT"
done < <(jq -r '.hooks | to_entries[] | .key as $e | .value[].hooks[] | [$e, (.command | capture("hooks/(?<f>[a-z0-9-]+\\.sh)").f)] | @tsv' "$NEXT_ROOT/hooks/hooks.json")
assert_eq "every shipped hook exercised warm" "$SHIPPED_HOOKS" "$WARM_N"

printf '\n'
if [[ "$FAILS" -eq 0 ]]; then echo "user-journey: PASS"; exit 0; fi
echo "user-journey: FAIL ($FAILS assertion(s))"
exit 1
