#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# End-to-end upgrade flow: install v0.2.3 → /claudemd-update to current HEAD
# → re-install with current plugin → uninstall. Complements full-lifecycle
# (which covers fresh-install → hook → uninstall only, no upgrade path).
#
# Requires git tag v0.2.3 to be reachable. CI runners with shallow checkout
# won't see it; in that case we `git fetch --tags` and, if still missing,
# loud-skip the upgrade phase (not silent-skip — operator should notice).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/hook-names.sh
source "$HERE/../lib/hook-names.sh"
# Registry-derived alternation for the two settings.json eviction assertions.
# Both hand-written copies named 8 of the 15 hooks while asserting that ZERO
# claudemd entries remained (audit-2026-08-22 条目 8).
HOOK_ALT=$(claudemd_hook_alternation "$REPO") || { echo "FAIL: cannot derive hook names from the registry"; exit 1; }
OLD_TAG="v0.2.3"
OLD_SPEC_VER="v6.10.1"
# Read from the shipped spec header rather than pinning a literal: this is the
# CURRENT version by definition, and a hand-updated pin turns every spec bump
# into a test failure that says nothing about the upgrade path (2026-07-25).
NEW_SPEC_VER="v$(sed -n '1s/.*AI-CODING-SPEC v\([0-9.]*\).*/\1/p' "$REPO/spec/CLAUDE.md")"
NEW_RULE_NEEDLE="Memory routing"

# macOS `mktemp -d` returns `/var/folders/...` which is a symlink to
# `/private/var/folders/...`. node ESM realpaths `import.meta.url` while
# argv[1] keeps the symlink form; the two differ and scripts/install.js'
# CLI trigger (`import.meta.url === file://${argv[1]}`) silently no-ops —
# install returns exit 0 with zero side-effects. Physical-path normalize
# every mktemp result so argv[1] and import.meta.url agree.
# Two steps, not `X=$(cd "$(mktemp -d)" && pwd -P)`. That one-liner fails OPEN:
# on mktemp failure the substitution is empty, `cd ""` returns 0, and `pwd -P`
# prints the CURRENT directory — the EXIT trap below then `rm -rf`s the repo.
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || { echo "FAIL: mktemp -d failed"; exit 1; }
TMP_HOME=$(cd "$TMP_HOME" && pwd -P) || { echo "FAIL: cannot resolve $TMP_HOME"; exit 1; }
WT_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || { echo "FAIL: mktemp -d failed"; exit 1; }
WT_PARENT=$(cd "$WT_PARENT" && pwd -P) || { echo "FAIL: cannot resolve $WT_PARENT"; exit 1; }
OLD_WT="$WT_PARENT/old"
FAILS=0

cleanup() {
  git -C "$REPO" worktree remove --force "$OLD_WT" 2>/dev/null || true
  rm -rf "$TMP_HOME" "$WT_PARENT"
}
trap cleanup EXIT

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf "  ok %s\n" "$label"
  else
    printf "  FAIL %s\n    expected: %s\n    actual:   %s\n" "$label" "$expected" "$actual"
    FAILS=$((FAILS+1))
  fi
}
assert_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF "$needle" "$file" 2>/dev/null; then
    printf "  ok %s\n" "$label"
  else
    printf "  FAIL %s (needle '%s' missing from %s)\n" "$label" "$needle" "$file"
    FAILS=$((FAILS+1))
  fi
}
assert_file_exists() {
  local label="$1" path="$2"
  if [[ -f "$path" ]]; then
    printf "  ok %s\n" "$label"
  else
    printf "  FAIL %s (missing: %s)\n" "$label" "$path"
    FAILS=$((FAILS+1))
  fi
}

export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude"

# Make sure old tag is locally reachable. Shallow CI checkouts often don't
# carry tags by default.
if ! git -C "$REPO" rev-parse --verify --quiet "refs/tags/$OLD_TAG" >/dev/null; then
  git -C "$REPO" fetch --tags --quiet 2>/dev/null || true
fi
if ! git -C "$REPO" rev-parse --verify --quiet "refs/tags/$OLD_TAG" >/dev/null; then
  echo "upgrade-lifecycle: SKIP (tag $OLD_TAG not reachable; shallow checkout without --tags)"
  echo "upgrade-lifecycle: to exercise this test in CI, ensure workflow uses fetch-depth: 0 and fetch-tags: true"
  # Under CI a skip is the defect, not an accommodation. npm-publish.yml's own
  # comment records that THIS skip is what once let the publish gate run a
  # silently smaller suite, and every other SKIP branch in this repo — run-all's
  # four, memory-tags-parity:313 — already carries this guard. These two were
  # the leftovers (2026-08-29 audit R10-10).
  [[ -n "${CI:-}" ]] && { echo "FAIL: that SKIP is not acceptable under CI — the workflow must fetch tags"; exit 1; }
  exit 0
fi

echo "-- Phase 1: checkout $OLD_TAG into detached worktree"
git -C "$REPO" worktree add --detach "$OLD_WT" "$OLD_TAG" >/dev/null 2>&1
assert_eq "$OLD_TAG worktree created" "0" "$?"
OLD_SPEC_HEADER=$(head -1 "$OLD_WT/spec/CLAUDE.md" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
assert_eq "$OLD_TAG ships spec $OLD_SPEC_VER" "$OLD_SPEC_VER" "$OLD_SPEC_HEADER"

echo "-- Phase 2: install old plugin into sandbox HOME"
OUT=$(CLAUDE_PLUGIN_ROOT="$OLD_WT" node "$OLD_WT/scripts/install.js" 2>&1) || {
  printf "  FAIL install.js non-zero exit\n%s\n" "$OUT"; FAILS=$((FAILS+1))
}
assert_file_exists "CLAUDE.md written" "$HOME/.claude/CLAUDE.md"
assert_file_exists "CLAUDE-extended.md written" "$HOME/.claude/CLAUDE-extended.md"
assert_file_exists "CLAUDE-changelog.md written" "$HOME/.claude/CLAUDE-changelog.md"
assert_file_exists "manifest written" "$HOME/.claude/.claudemd-manifest.json"
INSTALLED_SPEC_VER=$(head -1 "$HOME/.claude/CLAUDE.md" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
assert_eq "installed CLAUDE.md = $OLD_SPEC_VER" "$OLD_SPEC_VER" "$INSTALLED_SPEC_VER"
MANIFEST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
assert_eq "manifest.version = 0.2.3" "0.2.3" "$MANIFEST_VER"

echo "-- Phase 3: /claudemd-update pulls current-HEAD spec"
UPDATE_OUT=$(CLAUDE_PLUGIN_ROOT="$REPO" CLAUDEMD_UPDATE_CHOICE=apply-all node "$REPO/scripts/update.js" 2>&1)
APPLIED=$(echo "$UPDATE_OUT" | jq -r '.applied' 2>/dev/null)
assert_eq "update.applied == true" "true" "$APPLIED"
POST_UPDATE_VER=$(head -1 "$HOME/.claude/CLAUDE.md" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
assert_eq "post-update CLAUDE.md = $NEW_SPEC_VER" "$NEW_SPEC_VER" "$POST_UPDATE_VER"
assert_contains "new-rule needle in CLAUDE.md" "$NEW_RULE_NEEDLE" "$HOME/.claude/CLAUDE.md"
# The label is read from the lib, not spelled here: update.js and install.js
# used to share the `backup-` namespace, which is what let an update bury the
# user's personal CLAUDE.md backup (audit-2026-08-22 P1-1). A hand-copied glob
# would go on passing through a future rename.
SPEC_LABEL=$(node --input-type=module -e "import {BACKUP_LABELS} from '$REPO/scripts/lib/backup.js'; console.log(BACKUP_LABELS.spec)" 2>/dev/null)
PERSONAL_LABEL=$(node --input-type=module -e "import {BACKUP_LABELS} from '$REPO/scripts/lib/backup.js'; console.log(BACKUP_LABELS.personal)" 2>/dev/null)
BACKUP_COUNT=$(find "$HOME/.claude" -maxdepth 1 -type d -name "${SPEC_LABEL}-*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [[ -n "$SPEC_LABEL" && "$BACKUP_COUNT" -ge 1 ]]; then
  printf "  ok pre-update backup created under %s-* (count=%s)\n" "$SPEC_LABEL" "$BACKUP_COUNT"
else
  printf "  FAIL no %s-* dir under ~/.claude/\n" "${SPEC_LABEL:-<label-unreadable>}"
  FAILS=$((FAILS+1))
fi
PERSONAL_COUNT=$(find "$HOME/.claude" -maxdepth 1 -type d -name "${PERSONAL_LABEL}-*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [[ -n "$PERSONAL_LABEL" && "$PERSONAL_COUNT" == "0" ]]; then
  printf "  ok update did not write into the personal-backup namespace (%s-*)\n" "$PERSONAL_LABEL"
else
  printf "  FAIL update wrote %s dir(s) into the personal-backup namespace — restore would return the old spec\n" "$PERSONAL_COUNT"
  FAILS=$((FAILS+1))
fi

echo "-- Phase 4: re-install with current plugin (post-upgrade)"
OUT=$(CLAUDE_PLUGIN_ROOT="$REPO" node "$REPO/scripts/install.js" 2>&1) || {
  printf "  FAIL install.js non-zero exit\n%s\n" "$OUT"; FAILS=$((FAILS+1))
}
CURRENT_PLUGIN_VER=$(jq -r .version "$REPO/package.json")
MANIFEST_VER_NEW=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
assert_eq "manifest.version upgraded to $CURRENT_PLUGIN_VER" "$CURRENT_PLUGIN_VER" "$MANIFEST_VER_NEW"
POST_REINSTALL_VER=$(head -1 "$HOME/.claude/CLAUDE.md" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+')
assert_eq "re-install preserves $NEW_SPEC_VER (idempotent)" "$NEW_SPEC_VER" "$POST_REINSTALL_VER"
CLAUDEMD_IN_SETTINGS=$(jq --arg alt "$HOOK_ALT" '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("(" + $alt + ")\\.sh"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo missing)
assert_eq "settings.json: 0 claudemd hook entries (v0.1.5+ hooks live in hooks.json)" "0" "$CLAUDEMD_IN_SETTINGS"

echo "-- Phase 5: uninstall (keep spec)"
OUT=$(node "$REPO/scripts/uninstall.js" 2>&1) || {
  printf "  FAIL uninstall.js non-zero exit\n%s\n" "$OUT"; FAILS=$((FAILS+1))
}
assert_file_exists "CLAUDE.md preserved (keep)" "$HOME/.claude/CLAUDE.md"
REMAIN=$(jq --arg alt "$HOOK_ALT" '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("(" + $alt + ")\\.sh"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
assert_eq "post-uninstall: 0 claudemd hooks in settings.json" "0" "$REMAIN"
if [[ ! -f "$HOME/.claude/.claudemd-manifest.json" ]]; then
  printf "  ok manifest removed\n"
else
  printf "  FAIL manifest survives uninstall\n"
  FAILS=$((FAILS+1))
fi

if [[ "$FAILS" -eq 0 ]]; then
  echo "upgrade-lifecycle: PASS"
  exit 0
fi
echo "upgrade-lifecycle: FAIL ($FAILS assertion(s) failed)"
exit 1
