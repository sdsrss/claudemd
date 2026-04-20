# claudemd Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.1.0 of the `claudemd` Claude Code plugin — 5 enforcement hooks + 5 slash commands + spec v6.9.2 distribution — installable via a single `/plugin install claudemd@claudemd` command.

**Architecture:** Three-layer (L3 slash commands → L2 Node.js management scripts → L1 shell hooks). `~/.claude/settings.json` merge is append-only. All hooks fail-open on internal error. Spec install is backup-before-overwrite.

**Tech Stack:** bash 4.2+, Node.js 20 (built-in `node:test` runner), jq (hook JSON), gh CLI (ship-baseline, optional), shellcheck (CI warn-only).

**Source spec:** `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md` (committed as `deb8bc9` on `main`). All task cross-references `(design §N.N)` point to that document.

**Parallelism hint:** After M2 completes, M3 / M4 / M5 are independent and may be dispatched concurrently. M6 and M7 are sequential after M3/M4/M5 all land.

---

## File Structure

All paths relative to repo root `/mnt/data_ssd/dev/projects/claudemd/`.

```
.claude-plugin/plugin.json           — Claude Code plugin manifest (hooks + commands registration)
marketplace.json                     — self-host marketplace entry (name: claudemd)
package.json                         — npm metadata + node:test runner config
README.md                            — user-facing install / commands / kill-switches / 30-sec bootstrap
CHANGELOG.md                         — plugin-semver history (starts v0.1.0)
LICENSE                              — MIT

spec/CLAUDE.md                       — shipped core spec v6.9.2 (~5,330 tokens, with §0.1 + §2.3)
spec/CLAUDE-extended.md              — shipped extended spec (with §1.5-EXT, §5.1-EXT, §7-EXT, §11-EXT)
spec/CLAUDE-changelog.md             — shipped changelog (with v6.9.2 entry appended)

hooks/banned-vocab-check.sh          — PreToolUse:Bash, §10-V Specificity (migrated from v0 hand-install)
hooks/banned-vocab.patterns          — regex|reason data for above
hooks/ship-baseline-check.sh         — PreToolUse:Bash, §7 Ship-baseline (gh 2s timeout)
hooks/residue-audit.sh               — Stop, §7 User-global-state audit (advisory)
hooks/memory-read-check.sh           — PreToolUse:Bash, §11 MEMORY.md read-the-file (fail-open parsing)
hooks/sandbox-disposal-check.sh      — Stop, §8.V4 Sandbox disposal (advisory)
hooks/lib/hook-common.sh             — kill-switch, jq check, event parse, deny emit
hooks/lib/rule-hits.sh               — append to ~/.claude/logs/claudemd.jsonl
hooks/lib/platform.sh                — GNU/BSD stat + find abstraction

commands/claudemd-status.md          — /claudemd-status
commands/claudemd-update.md          — /claudemd-update
commands/claudemd-audit.md           — /claudemd-audit
commands/claudemd-toggle.md          — /claudemd-toggle
commands/claudemd-doctor.md          — /claudemd-doctor

scripts/install.js                   — postInstall: Q1 backup-and-overwrite + hook register
scripts/uninstall.js                 — preUninstall: 3-way (keep/delete/restore) with hard-AUTH on delete
scripts/update.js                    — /claudemd-update: diff + selective apply
scripts/status.js                    — /claudemd-status: dual-version + drift
scripts/audit.js                     — /claudemd-audit: rule-hits aggregation
scripts/toggle.js                    — /claudemd-toggle: enable/disable a hook
scripts/doctor.js                    — /claudemd-doctor: health checks + backup prune
scripts/lib/paths.js                 — resolve ~/.claude/* consistently
scripts/lib/backup.js                — create / list / restore / prune backups (N=5 retention)
scripts/lib/settings-merge.js        — idempotent append-only merge of settings.json
scripts/lib/spec-diff.js             — section-aware spec file diff
scripts/lib/rule-hits-parse.js       — read/group rule-hits jsonl

tests/run-all.sh                     — entry script invoking all suites
tests/hooks/banned-vocab.test.sh     — 12 cases ported from v0 sandbox
tests/hooks/ship-baseline.test.sh    — mock-gh via PATH prefix
tests/hooks/residue-audit.test.sh    — faked tmp baseline
tests/hooks/memory-read-check.test.sh — faked transcript JSONL
tests/hooks/sandbox-disposal.test.sh — cross-platform stat
tests/scripts/install.test.js        — install idempotency + migration + rollback (node:test)
tests/scripts/uninstall.test.js      — three-way + settings residue
tests/scripts/update.test.js         — diff + selective apply
tests/scripts/settings-merge.test.js — 20 fixture cases
tests/scripts/backup.test.js         — N=5 retention + restore
tests/scripts/spec-install.test.js   — Q1 model: fresh / backup-and-overwrite
tests/scripts/spec-structure.test.js — A13 token count, A14 sections, A15 tag syntax
tests/integration/full-lifecycle.test.sh — end-to-end install→trigger→audit→uninstall
tests/fixtures/events/               — stdin JSON samples per event type
tests/fixtures/settings-samples/     — settings.json pre-states
tests/fixtures/transcripts/          — faked session JSONL
tests/fixtures/spec-samples/         — faked user-version CLAUDE.md
tests/fixtures/mock-gh/              — scripted gh CLI mocks

docs/ARCHITECTURE.md                 — post-impl architecture reference
docs/HOOK-PROTOCOL.md                — Claude Code hook I/O contract
docs/ADDING-NEW-HOOK.md              — step-by-step for a 6th hook
docs/RULE-HITS-SCHEMA.md             — jsonl row schema

.github/workflows/ci.yml             — CI matrix (ubuntu + macos × node 20)
```

---

## Shared Naming Contracts

These identifiers are referenced across multiple tasks. Any rename mid-plan is a bug.

**Hook library functions (`hooks/lib/hook-common.sh`):**
- `hook_kill_switch NAME` — returns 0 to proceed, 1 to short-circuit (caller exits 0)
- `hook_require_jq` — returns 0 if jq present, 1 otherwise
- `hook_read_event` — reads stdin JSON to stdout; empty on error
- `hook_deny HOOK_NAME REASON` — writes deny JSON to stdout, exits 0
- `hook_record HOOK_NAME EVENT [EXTRA_JSON]` — appends rule-hits row

**Rule-hits (`hooks/lib/rule-hits.sh`):**
- `rule_hits_append HOOK EVENT EXTRA` — append one JSONL row to `~/.claude/logs/claudemd.jsonl`

**Platform (`hooks/lib/platform.sh`):**
- `platform_stat_mtime FILE` — echo file mtime as epoch seconds
- `platform_find_newer DIR REFERENCE_FILE` — list paths under DIR newer than REFERENCE_FILE

**Node.js (`scripts/lib/paths.js`):**
- `pluginCacheDir()` — `~/.claude/plugins/cache/claudemd`
- `stateDir()` — `~/.claude/.claudemd-state`
- `logsDir()` — `~/.claude/logs`
- `settingsPath()` — `~/.claude/settings.json`
- `backupRoot()` — `~/.claude` (backups live at `backup-<ISO>/` directly under)
- `specHome()` — array of three `~/.claude/CLAUDE*.md` paths

**Node.js (`scripts/lib/backup.js`):**
- `createBackup(files, {label?}) → {dir, movedFiles}` — mkdir timestamped, move provided files in
- `listBackups() → [{dir, iso, size}]` — sorted newest first
- `pruneBackups(retainCount=5) → [removedDirs]` — delete oldest beyond N
- `restoreBackup(dir, targetRoot) → [restoredFiles]`

**Node.js (`scripts/lib/settings-merge.js`):**
- `readSettings() → object` — parses `~/.claude/settings.json`, returns `{}` if missing
- `writeSettings(obj)` — atomic write with JSON.parse validate + auto-rollback on parse fail
- `mergeHook(settings, {event, matcher, command, timeout, tag}) → {added: boolean}` — idempotent
- `unmergeHook(settings, {commandPredicate}) → {removed: number}` — removes matching entries, preserves others

**Kill-switch env vars** (all consumed by `hook_kill_switch`):
- `DISABLE_CLAUDEMD_HOOKS=1` — plugin-wide (short-circuit all hooks)
- `DISABLE_BANNED_VOCAB_HOOK=1`
- `DISABLE_SHIP_BASELINE_HOOK=1`
- `DISABLE_RESIDUE_AUDIT_HOOK=1`
- `DISABLE_MEMORY_READ_HOOK=1`
- `DISABLE_SANDBOX_DISPOSAL_HOOK=1`
- `DISABLE_RULE_HITS_LOG=1` — log-only (does not disable hook logic)
- `SPEC_RESIDUE_THRESHOLD=<N>` — residue-audit threshold (default 20)

**Per-invocation escape hatches:**
- Commit message contains `[allow-banned-vocab]` — bypasses banned-vocab hook
- Commit body contains `known-red baseline: <reason>` — bypasses ship-baseline hook
- Bash command contains `[skip-memory-check]` — bypasses memory-read-check

**State file layout (`~/.claude/.claudemd-state/`):**
- `installed.json` — manifest of plugin-added settings.json entries (command string + SHA256)
- `tmp-baseline.txt` — integer, last-session end count of `~/.claude/tmp/` entries

---

## Prerequisites (one-time engineer setup)

Before Task 1:

- [ ] Verify local tools: `node --version` (≥20), `jq --version`, `bash --version` (≥4.2), `gh --version` (optional but recommended), `shellcheck --version`
- [ ] Confirm working dir: `pwd` prints `/mnt/data_ssd/dev/projects/claudemd`
- [ ] Confirm git state: `git log --oneline` shows `deb8bc9 docs: initial design for claudemd plugin`
- [ ] Confirm design doc readable: `test -f docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md && echo OK`

---

## M1 — Plugin Skeleton

**Goal:** Repo structure, plugin/marketplace manifests, package metadata, hook shared library, migrate banned-vocab hook, port 12 tests.

**Duration:** ~0.5d (6 tasks)

**Depends on:** Prerequisites

---

### Task 1: Write plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .claude-plugin
```

- [ ] **Step 2: Write `.claude-plugin/plugin.json`**

```json
{
  "$schema": "https://claude.ai/plugin-schema.json",
  "name": "claudemd",
  "version": "0.1.0",
  "description": "AI-CODING-SPEC v6.9 HARD-rule enforcement via Claude Code hooks + spec distribution",
  "author": {"name": "sds"},
  "license": "MIT",
  "commands": "./commands",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {"type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh\"", "timeout": 3},
          {"type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh\"", "timeout": 5},
          {"type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/memory-read-check.sh\"", "timeout": 3}
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {"type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/residue-audit.sh\"", "timeout": 3},
          {"type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-disposal-check.sh\"", "timeout": 3}
        ]
      }
    ]
  },
  "postInstall": "node ${CLAUDE_PLUGIN_ROOT}/scripts/install.js",
  "preUninstall": "node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js"
}
```

- [ ] **Step 3: Validate JSON**

Run: `jq . .claude-plugin/plugin.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add plugin.json manifest (5 hooks + commands + install scripts)"
```

---

### Task 2: Write marketplace.json

**Files:**
- Create: `marketplace.json`

- [ ] **Step 1: Write `marketplace.json`**

```json
{
  "$schema": "https://claude.ai/plugin-marketplace-schema.json",
  "name": "claudemd",
  "plugins": {
    "claudemd": {
      "source": "./",
      "description": "AI-CODING-SPEC v6.9 enforcement hooks + spec distribution"
    }
  }
}
```

- [ ] **Step 2: Validate JSON**

Run: `jq . marketplace.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add marketplace.json
git commit -m "feat: add marketplace.json self-host entry"
```

---

### Task 3: Write package.json and LICENSE

**Files:**
- Create: `package.json`
- Create: `LICENSE`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "claudemd",
  "version": "0.1.0",
  "description": "AI-CODING-SPEC v6.9 enforcement plugin for Claude Code",
  "type": "module",
  "scripts": {
    "test": "bash tests/run-all.sh",
    "test:scripts": "node --test tests/scripts/*.test.js",
    "test:hooks": "bash tests/hooks/*.test.sh"
  },
  "bin": {
    "claudemd": "./scripts/cli.js"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 sds

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Commit**

```bash
git add package.json LICENSE
git commit -m "feat: add package.json + MIT LICENSE"
```

---

### Task 4: Write hooks/lib/hook-common.sh shared library (TDD)

**Files:**
- Create: `hooks/lib/hook-common.sh`
- Test: `tests/hooks/hook-common.test.sh`

- [ ] **Step 1: Create directories**

```bash
mkdir -p hooks/lib tests/hooks
```

- [ ] **Step 2: Write failing test `tests/hooks/hook-common.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/hook-common.sh"
FAIL=0

run_case() {
  local name="$1" expected="$2" actual
  actual=$(eval "$3" 2>&1)
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# hook_kill_switch
run_case "kill_switch plugin-wide" "BLOCKED" \
  "DISABLE_CLAUDEMD_HOOKS=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch per-hook" "BLOCKED" \
  "DISABLE_BANNED_VOCAB_HOOK=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch not set" "OPEN" \
  "unset DISABLE_CLAUDEMD_HOOKS DISABLE_BANNED_VOCAB_HOOK; bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

# hook_require_jq
run_case "require_jq present" "YES" \
  "bash -c 'source $LIB; hook_require_jq && echo YES || echo NO'"

# hook_read_event
run_case "read_event stdin" '{"foo":1}' \
  "echo '{\"foo\":1}' | bash -c 'source $LIB; hook_read_event'"

run_case "read_event empty" "" \
  "echo '' | bash -c 'source $LIB; hook_read_event' 2>/dev/null"

# hook_deny
run_case "deny emits json" "deny" \
  "bash -c 'source $LIB; hook_deny test-hook \"reason text\"' | jq -r .hookSpecificOutput.permissionDecision"

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
```

Make executable:

```bash
chmod +x tests/hooks/hook-common.test.sh
```

- [ ] **Step 3: Run test — verify it fails (library does not exist)**

Run: `bash tests/hooks/hook-common.test.sh`
Expected: Multiple `FAIL:` lines ending with `FAILED: N case(s)` (exit 1)

- [ ] **Step 4: Write `hooks/lib/hook-common.sh`**

```bash
#!/usr/bin/env bash
# hook-common.sh — fail-open library for claudemd hooks.
# All functions return safely; callers can exit 0 silently on non-zero return.

# hook_kill_switch NAME
#   returns 0 to proceed, 1 to short-circuit.
hook_kill_switch() {
  [[ "${DISABLE_CLAUDEMD_HOOKS:-0}" == "1" ]] && return 1
  local var="DISABLE_${1}_HOOK"
  [[ "${!var:-0}" == "1" ]] && return 1
  return 0
}

# hook_require_jq — returns 0 if jq is on PATH, 1 otherwise.
hook_require_jq() {
  command -v jq >/dev/null 2>&1
}

# hook_read_event — reads stdin JSON to stdout; empty stdout on error.
hook_read_event() {
  local input
  input=$(cat 2>/dev/null) || return 1
  [[ -n "$input" ]] || return 1
  printf '%s' "$input"
}

# hook_deny HOOK_NAME REASON — emits PreToolUse deny JSON, exits 0.
hook_deny() {
  local hook="$1" reason="$2"
  jq -cn --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }' 2>/dev/null
  exit 0
}

# hook_record HOOK EVENT [EXTRA_JSON]
#   Appends to rule-hits jsonl via rule-hits.sh (sourced lazily).
hook_record() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$lib_dir/rule-hits.sh" 2>/dev/null || return 0
  rule_hits_append "$@"
}
```

- [ ] **Step 5: Run test — verify passing cases except `hook_record` (needs rule-hits.sh from Task 5)**

Run: `bash tests/hooks/hook-common.test.sh`
Expected: `All cases passed` (this test suite does not exercise `hook_record`)

- [ ] **Step 6: Run shellcheck**

Run: `shellcheck hooks/lib/hook-common.sh`
Expected: no output (shellcheck clean) or only warnings

- [ ] **Step 7: Commit**

```bash
git add hooks/lib/hook-common.sh tests/hooks/hook-common.test.sh
git commit -m "feat(hooks): add hook-common.sh library with kill-switch / jq / event-read / deny"
```

---

### Task 5: Write hooks/lib/rule-hits.sh (TDD)

**Files:**
- Create: `hooks/lib/rule-hits.sh`
- Test: `tests/hooks/rule-hits.test.sh`

- [ ] **Step 1: Write failing test `tests/hooks/rule-hits.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/rule-hits.sh"
TMP_HOME=$(mktemp -d)
trap 'rm -rf "$TMP_HOME"' EXIT

export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

run() { bash -c "source $LIB; $*"; }

# Case 1: basic append
run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG" ]] || { echo "FAIL: log file not created"; exit 1; }
LINES=$(wc -l < "$LOG")
[[ "$LINES" == "1" ]] || { echo "FAIL: expected 1 line, got $LINES"; exit 1; }
jq -e '.hook == "banned-vocab" and .event == "deny"' "$LOG" >/dev/null \
  || { echo "FAIL: row missing expected fields"; exit 1; }

# Case 2: extra JSON
run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":4521}'\'
SECOND=$(tail -n 1 "$LOG")
echo "$SECOND" | jq -e '.extra.run_id == 4521' >/dev/null \
  || { echo "FAIL: extra not preserved"; exit 1; }

# Case 3: DISABLE_RULE_HITS_LOG suppresses
LINE_BEFORE=$(wc -l < "$LOG")
DISABLE_RULE_HITS_LOG=1 run 'rule_hits_append banned-vocab deny null'
LINE_AFTER=$(wc -l < "$LOG")
[[ "$LINE_BEFORE" == "$LINE_AFTER" ]] || { echo "FAIL: log appended despite kill-switch"; exit 1; }

echo "All cases passed"
```

Make executable:

```bash
chmod +x tests/hooks/rule-hits.test.sh
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bash tests/hooks/rule-hits.test.sh`
Expected: failure on first case (library missing)

- [ ] **Step 3: Write `hooks/lib/rule-hits.sh`**

```bash
#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# rule_hits_append HOOK EVENT EXTRA_JSON
#   HOOK  — hook name (banned-vocab, ship-baseline, ...)
#   EVENT — pass | deny | bypass-env | bypass-escape-hatch | warn | error
#   EXTRA — JSON value (object | null | string). "null" if none.
rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"

  local log_dir="$HOME/.claude/logs"
  local log_file="$log_dir/claudemd.jsonl"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  jq -cn \
    --arg ts "$ts" \
    --arg hook "$hook" \
    --arg event "$event" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, extra: $extra}' \
    2>/dev/null >> "$log_file" || return 0
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bash tests/hooks/rule-hits.test.sh`
Expected: `All cases passed`

- [ ] **Step 5: Shellcheck**

Run: `shellcheck hooks/lib/rule-hits.sh`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add hooks/lib/rule-hits.sh tests/hooks/rule-hits.test.sh
git commit -m "feat(hooks): add rule-hits.sh append-only JSONL logger"
```

---

### Task 6: Migrate banned-vocab hook + patterns + port 12 tests

**Files:**
- Create: `hooks/banned-vocab-check.sh`
- Create: `hooks/banned-vocab.patterns`
- Create: `tests/hooks/banned-vocab.test.sh`
- Create: `tests/fixtures/events/bash-commit-clean.json`
- Create: `tests/fixtures/events/bash-commit-banned-en.json`
- Create: `tests/fixtures/events/bash-commit-banned-zh.json`
- Create: `tests/fixtures/events/bash-commit-with-escape.json`
- Create: `tests/fixtures/events/bash-git-log.json`
- Create: `tests/fixtures/events/edit-tool.json`

- [ ] **Step 1: Copy current v0 banned-vocab-check.sh as the base**

```bash
cp ~/.claude/hooks/banned-vocab-check.sh hooks/banned-vocab-check.sh
cp ~/.claude/hooks/banned-vocab.patterns hooks/banned-vocab.patterns
chmod +x hooks/banned-vocab-check.sh
```

- [ ] **Step 2: Refactor `hooks/banned-vocab-check.sh` to source hook-common.sh**

Replace the inline kill-switch / jq check / stdin read with sourced library calls. Final file contents:

```bash
#!/usr/bin/env bash
# banned-vocab-check.sh — PreToolUse:Bash hook.
# Denies git-commit commands whose message matches patterns in banned-vocab.patterns.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch BANNED_VOCAB || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0

TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0

CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Filter: must be a git commit invocation (not just any command containing the word)
echo "$CMD" | grep -qE '(^|[[:space:];&|])git(\s+-c\s+\S+)*\s+commit(\s|$)' || exit 0

# Per-invocation escape hatch
if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then
  hook_record banned-vocab bypass-escape-hatch null
  exit 0
fi

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
[[ -r "$PATTERNS_FILE" ]] || exit 0

# Collect hits
declare -a HITS=()
declare -a REASONS=()
while IFS= read -r line; do
  # Skip blank and comment lines
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  # Use LAST pipe as the separator (regex may contain pipes)
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  if echo "$CMD" | grep -qiE "$local_regex"; then
    match=$(echo "$CMD" | grep -oiE "$local_regex" | head -n1)
    HITS+=("$match")
    REASONS+=("$local_reason")
  fi
done < "$PATTERNS_FILE"

if (( ${#HITS[@]} == 0 )); then
  exit 0
fi

# Build reason text
REASON_TEXT="§10-V Specificity: banned terms detected:"
for i in "${!HITS[@]}"; do
  REASON_TEXT+=$'\n'"  - ${HITS[$i]}  (${REASONS[$i]})"
done
REASON_TEXT+=$'\n\n'"Bypass options:
  (a) Rewrite with absolute numbers (preferred).
  (b) Per-commit escape: include [allow-banned-vocab] in the commit message.
  (c) Disable the hook: DISABLE_BANNED_VOCAB_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §10 Honesty rules — Specificity (HARD)."

# Record to rule-hits with matched patterns
HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -s .)
hook_record banned-vocab deny "{\"matched\":$HITS_JSON}"

hook_deny banned-vocab "$REASON_TEXT"
```

- [ ] **Step 3: Confirm patterns file is populated (regex|reason format)**

Run: `head -3 hooks/banned-vocab.patterns`
Expected: three non-blank, non-comment pattern lines

- [ ] **Step 4: Create fixture `tests/fixtures/events/bash-commit-clean.json`**

```bash
mkdir -p tests/fixtures/events
```

```json
{
  "session_id": "test",
  "tool_name": "Bash",
  "tool_input": {"command": "git commit -m 'fix: parser handles NULL (tests/parser_nulls.rs +3, all green)'"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 5: Create fixture `tests/fixtures/events/bash-commit-banned-en.json`**

```json
{
  "session_id": "test",
  "tool_name": "Bash",
  "tool_input": {"command": "git commit -m 'significantly improved parser'"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 6: Create fixture `tests/fixtures/events/bash-commit-banned-zh.json`**

```json
{
  "session_id": "test",
  "tool_name": "Bash",
  "tool_input": {"command": "git commit -m '显著提升了性能'"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 7: Create fixture `tests/fixtures/events/bash-commit-with-escape.json`**

```json
{
  "session_id": "test",
  "tool_name": "Bash",
  "tool_input": {"command": "git commit -m 'significantly improved parser [allow-banned-vocab]'"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 8: Create fixture `tests/fixtures/events/bash-git-log.json`**

```json
{
  "session_id": "test",
  "tool_name": "Bash",
  "tool_input": {"command": "git log --oneline -5"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 9: Create fixture `tests/fixtures/events/edit-tool.json`**

```json
{
  "session_id": "test",
  "tool_name": "Edit",
  "tool_input": {"file_path": "/tmp/foo.txt", "old_string": "a", "new_string": "b"},
  "cwd": "/tmp/fixture"
}
```

- [ ] **Step 10: Write failing test `tests/hooks/banned-vocab.test.sh` (12 cases)**

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/banned-vocab-check.sh"
FIX="$HERE/../fixtures/events"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

FAIL=0

# assert_pass NAME FIXTURE [EXTRA_ENV]
assert_pass() {
  local name="$1" fix="$2" extra="${3:-}"
  local out
  out=$(eval "$extra bash \"$HOOK\"" < "$fix" 2>&1)
  if [[ -z "$out" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected empty stdout, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

# assert_deny NAME FIXTURE
assert_deny() {
  local name="$1" fix="$2"
  local out decision
  out=$(bash "$HOOK" < "$fix" 2>&1)
  decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
  if [[ "$decision" == "deny" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected deny, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

# Case 1: non-Bash tool → pass
assert_pass "1: non-Bash Edit → pass" "$FIX/edit-tool.json"

# Case 2: git log (not commit) → pass
assert_pass "2: git log → pass" "$FIX/bash-git-log.json"

# Case 3: clean commit → pass
assert_pass "3: clean commit → pass" "$FIX/bash-commit-clean.json"

# Case 4: EN banned ("significantly") → deny
assert_deny "4: EN significantly → deny" "$FIX/bash-commit-banned-en.json"

# Case 5: 中文 banned → deny
assert_deny "5: 中文 显著提升 → deny" "$FIX/bash-commit-banned-zh.json"

# Case 6: escape hatch → pass
assert_pass "6: [allow-banned-vocab] escape → pass" "$FIX/bash-commit-with-escape.json"

# Case 7: plugin-wide kill-switch → pass
assert_pass "7: DISABLE_CLAUDEMD_HOOKS=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_CLAUDEMD_HOOKS=1"

# Case 8: per-hook kill-switch → pass
assert_pass "8: DISABLE_BANNED_VOCAB_HOOK=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_BANNED_VOCAB_HOOK=1"

# Case 9: "should work" hedge → deny (regression test for regex split)
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'it should work now'"},"cwd":"/tmp"}
EOF
assert_deny "9: should work hedge → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 10: baseline-less ratio "70% faster" → deny
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache layer is 70% faster'"},"cwd":"/tmp"}
EOF
assert_deny "10: 70% faster baseline-less → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 11: baseline-ful ratio "380ms → 95ms (4×)" → pass
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache: 380ms to 95ms latency'"},"cwd":"/tmp"}
EOF
assert_pass "11: baselined ratio → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 12: malformed JSON stdin → fail-open pass
TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
assert_pass "12: malformed JSON stdin → fail-open pass" "$TMP_FIX"
rm -f "$TMP_FIX"

if (( FAIL > 0 )); then
  echo "Tests: $((12 - FAIL))/12 passed"
  exit 1
fi
echo "Tests: 12/12 passed"
```

Make executable:

```bash
chmod +x tests/hooks/banned-vocab.test.sh
```

- [ ] **Step 11: Run test — verify it passes (hook already works after Step 2 refactor)**

Run: `bash tests/hooks/banned-vocab.test.sh`
Expected: `Tests: 12/12 passed`

Troubleshoot if < 12 pass: check that `banned-vocab.patterns` actually contains `significantly`, `显著`, `should work`, and a percentage-without-baseline pattern. If not, inspect `~/.claude/hooks/banned-vocab.patterns` and merge missing entries.

- [ ] **Step 12: Shellcheck the hook**

Run: `shellcheck hooks/banned-vocab-check.sh`
Expected: clean (or only warnings)

- [ ] **Step 13: Commit**

```bash
git add hooks/banned-vocab-check.sh hooks/banned-vocab.patterns tests/hooks/banned-vocab.test.sh tests/fixtures/events/
git commit -m "feat(hooks): migrate banned-vocab hook + 6 fixtures + 12-case test suite"
```

---

**M1 exit criteria:**
- [ ] `.claude-plugin/plugin.json`, `marketplace.json`, `package.json`, `LICENSE` exist and are valid
- [ ] `hooks/lib/hook-common.sh` and `hooks/lib/rule-hits.sh` exist with passing unit tests
- [ ] `hooks/banned-vocab-check.sh` and `hooks/banned-vocab.patterns` exist
- [ ] `bash tests/hooks/banned-vocab.test.sh` reports `Tests: 12/12 passed`
- [ ] Six commits on `main`: plugin.json / marketplace.json / package.json+LICENSE / hook-common / rule-hits / banned-vocab

---

## M2 — Install / Update / Uninstall

**Goal:** Node.js scripts + libraries that turn a `/plugin install claudemd` into: backup-and-overwrite spec, idempotent settings.json merge, manifest-tracked uninstall with 3-way choice, interactive update diff.

**Duration:** ~1.0d (10 tasks)

**Depends on:** M1 (needs banned-vocab hook present so integration test can exercise it)

---

### Task 7: Write scripts/lib/paths.js (TDD)

**Files:**
- Create: `scripts/lib/paths.js`
- Test: `tests/scripts/paths.test.js`

- [ ] **Step 1: Create directories**

```bash
mkdir -p scripts/lib tests/scripts
```

- [ ] **Step 2: Write failing test `tests/scripts/paths.test.js`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluginCacheDir, stateDir, logsDir, settingsPath, backupRoot, specHome } from '../../scripts/lib/paths.js';
import path from 'node:path';
import os from 'node:os';

test('pluginCacheDir points to ~/.claude/plugins/cache/claudemd', () => {
  assert.equal(pluginCacheDir(), path.join(os.homedir(), '.claude/plugins/cache/claudemd'));
});

test('stateDir points to ~/.claude/.claudemd-state', () => {
  assert.equal(stateDir(), path.join(os.homedir(), '.claude/.claudemd-state'));
});

test('logsDir points to ~/.claude/logs', () => {
  assert.equal(logsDir(), path.join(os.homedir(), '.claude/logs'));
});

test('settingsPath points to ~/.claude/settings.json', () => {
  assert.equal(settingsPath(), path.join(os.homedir(), '.claude/settings.json'));
});

test('backupRoot points to ~/.claude', () => {
  assert.equal(backupRoot(), path.join(os.homedir(), '.claude'));
});

test('specHome returns three CLAUDE*.md paths in ~/.claude', () => {
  const paths = specHome();
  assert.equal(paths.length, 3);
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-extended.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-changelog.md')));
});

test('HOME override respected', () => {
  const saved = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
  try {
    assert.equal(pluginCacheDir(), '/tmp/fake-home/.claude/plugins/cache/claudemd');
  } finally {
    process.env.HOME = saved;
  }
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `node --test tests/scripts/paths.test.js`
Expected: `ERR_MODULE_NOT_FOUND` on `scripts/lib/paths.js`

- [ ] **Step 4: Write `scripts/lib/paths.js`**

```javascript
import path from 'node:path';
import os from 'node:os';

const home = () => process.env.HOME || os.homedir();

export const pluginCacheDir = () => path.join(home(), '.claude/plugins/cache/claudemd');
export const stateDir       = () => path.join(home(), '.claude/.claudemd-state');
export const logsDir        = () => path.join(home(), '.claude/logs');
export const settingsPath   = () => path.join(home(), '.claude/settings.json');
export const backupRoot     = () => path.join(home(), '.claude');
export const specHome       = () => [
  path.join(home(), '.claude/CLAUDE.md'),
  path.join(home(), '.claude/CLAUDE-extended.md'),
  path.join(home(), '.claude/CLAUDE-changelog.md'),
];
```

- [ ] **Step 5: Run test — verify passing**

Run: `node --test tests/scripts/paths.test.js`
Expected: all 7 tests pass, exit 0

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/paths.js tests/scripts/paths.test.js
git commit -m "feat(scripts): add paths.js single-source-of-truth for ~/.claude/* locations"
```

---

### Task 8: Write scripts/lib/backup.js (TDD)

**Files:**
- Create: `scripts/lib/backup.js`
- Test: `tests/scripts/backup.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/backup.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../../scripts/lib/backup.js';

let tmpHome;
let savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-bk-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('createBackup moves files into timestamped dir', () => {
  const src1 = path.join(tmpHome, '.claude/CLAUDE.md');
  fs.writeFileSync(src1, 'core');
  const { dir, movedFiles } = createBackup([src1]);
  assert.match(path.basename(dir), /^backup-\d{8}T\d{6}Z$/);
  assert.equal(movedFiles.length, 1);
  assert.equal(fs.existsSync(src1), false);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'core');
});

test('createBackup skips non-existent files silently', () => {
  const missing = path.join(tmpHome, '.claude/NOPE.md');
  const { movedFiles } = createBackup([missing]);
  assert.equal(movedFiles.length, 0);
});

test('listBackups returns newest first', async () => {
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260101T000000Z'));
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260301T000000Z'));
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260201T000000Z'));
  const backups = listBackups();
  assert.equal(backups.length, 3);
  assert.equal(backups[0].iso, '20260301T000000Z');
  assert.equal(backups[2].iso, '20260101T000000Z');
});

test('pruneBackups keeps N newest and removes rest', () => {
  for (const iso of ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z',
                     '20260401T000000Z', '20260501T000000Z', '20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const removed = pruneBackups(5);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].endsWith('backup-20260101T000000Z'));
  assert.equal(listBackups().length, 5);
});

test('restoreBackup copies files back to targetRoot', () => {
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'restored');
  const target = path.join(tmpHome, '.claude');
  const restored = restoreBackup(bkDir, target);
  assert.equal(restored.length, 1);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'restored');
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `node --test tests/scripts/backup.test.js`
Expected: module-not-found

- [ ] **Step 3: Write `scripts/lib/backup.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { backupRoot } from './paths.js';

function isoStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+Z$/, 'Z');
}

export function createBackup(files, { label = 'backup' } = {}) {
  const dir = path.join(backupRoot(), `${label}-${isoStamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const movedFiles = [];
  for (const src of files) {
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, path.basename(src));
    fs.renameSync(src, dest);
    movedFiles.push(dest);
  }
  return { dir, movedFiles };
}

export function listBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(name => /^backup-\d{8}T\d{6}Z$/.test(name))
    .map(name => ({
      dir: path.join(root, name),
      iso: name.replace(/^backup-/, ''),
      size: dirSize(path.join(root, name)),
    }))
    .sort((a, b) => b.iso.localeCompare(a.iso));
}

export function pruneBackups(retainCount = 5) {
  const backups = listBackups();
  const removed = [];
  for (const b of backups.slice(retainCount)) {
    fs.rmSync(b.dir, { recursive: true, force: true });
    removed.push(b.dir);
  }
  return removed;
}

export function restoreBackup(backupDir, targetRoot) {
  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    const src = path.join(backupDir, name);
    const dest = path.join(targetRoot, name);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      restored.push(dest);
    }
  }
  return restored;
}

function dirSize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    total += stat.isFile() ? stat.size : 0;
  }
  return total;
}
```

- [ ] **Step 4: Run test — verify passing**

Run: `node --test tests/scripts/backup.test.js`
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/backup.js tests/scripts/backup.test.js
git commit -m "feat(scripts): add backup.js with create/list/prune(N=5)/restore operations"
```

---

### Task 9: Write scripts/lib/settings-merge.js (TDD, 20 fixture cases)

**Files:**
- Create: `scripts/lib/settings-merge.js`
- Test: `tests/scripts/settings-merge.test.js`
- Test fixtures: `tests/fixtures/settings-samples/*.json`

- [ ] **Step 1: Create fixtures directory**

```bash
mkdir -p tests/fixtures/settings-samples
```

- [ ] **Step 2: Write fixture `tests/fixtures/settings-samples/bare.json`**

```json
{}
```

- [ ] **Step 3: Write fixture `tests/fixtures/settings-samples/with-claude-mem-lite.json`**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "node /home/sds/.claude-mem-lite/hook.mjs user-prompt", "timeout": 5}]}
    ],
    "PreToolUse": [
      {"matcher": "Edit|Write|NotebookEdit", "hooks": [{"type": "command", "command": "node /home/sds/.claude-mem-lite/scripts/pre-tool-recall.js", "timeout": 3}]},
      {"matcher": "Bash", "hooks": [{"type": "command", "command": "bash /home/sds/.claude/hooks/banned-vocab-check.sh", "timeout": 3}]}
    ],
    "Stop": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "node /home/sds/.claude-mem-lite/hook.mjs stop", "timeout": 5}]}
    ]
  }
}
```

- [ ] **Step 4: Write failing test `tests/scripts/settings-merge.test.js` (20 cases)**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSettings, writeSettings, mergeHook, unmergeHook } from '../../scripts/lib/settings-merge.js';

let tmpHome, savedHome;
const FIX = new URL('../fixtures/settings-samples/', import.meta.url).pathname;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sm-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const settingsFile = () => path.join(tmpHome, '.claude/settings.json');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

const HOOK_SPEC = {
  event: 'PreToolUse',
  matcher: 'Bash',
  command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"',
  timeout: 5,
  tag: 'claudemd',
};

test('1: missing settings.json → readSettings returns {}', () => {
  assert.deepEqual(readSettings(), {});
});

test('2: empty object settings → mergeHook adds new event+matcher', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  const { added } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('3: pre-existing same matcher → appends to hooks array', () => {
  fs.writeFileSync(settingsFile(), JSON.stringify(loadFixture('with-claude-mem-lite.json')));
  const s = readSettings();
  const { added } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  const bashMatcher = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.equal(bashMatcher.hooks.length, 2); // original banned-vocab + new ship-baseline
});

test('4: identical command already present → idempotent (added=false)', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, HOOK_SPEC);
  const second = mergeHook(s, HOOK_SPEC);
  assert.equal(second.added, false);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('5: unmergeHook removes only matching entries', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  mergeHook(s, HOOK_SPEC); // adds ship-baseline after banned-vocab
  const { removed } = unmergeHook(s, { commandPredicate: (c) => c.includes('ship-baseline-check.sh') });
  assert.equal(removed, 1);
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.equal(bash.hooks.length, 1); // only banned-vocab remains
});

test('6: unmergeHook preserves other-plugin entries', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  unmergeHook(s, { commandPredicate: (c) => c.includes('claudemd') });
  const userPrompt = s.hooks.UserPromptSubmit;
  assert.equal(userPrompt[0].hooks[0].command.includes('claude-mem-lite'), true);
});

test('7: writeSettings + readSettings round-trip', () => {
  writeSettings({ hooks: { Stop: [{ matcher: '*', hooks: [] }] } });
  const s = readSettings();
  assert.equal(s.hooks.Stop[0].matcher, '*');
});

test('8: writeSettings validates JSON parseable post-write', () => {
  // This test ensures writeSettings performs the validation step.
  // We validate by confirming a good write succeeds and file is valid JSON.
  writeSettings({ ok: true });
  const raw = fs.readFileSync(settingsFile(), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('9: mergeHook preserves existing same-matcher order', () => {
  const s = loadFixture('with-claude-mem-lite.json');
  mergeHook(s, HOOK_SPEC);
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash');
  assert.ok(bash.hooks[0].command.includes('banned-vocab'), 'existing first');
  assert.ok(bash.hooks[1].command.includes('ship-baseline'), 'new second');
});

test('10: mergeHook on new event creates event + matcher array', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, { ...HOOK_SPEC, event: 'SessionStart', matcher: 'startup' });
  assert.equal(s.hooks.SessionStart.length, 1);
});

test('11: BOM in settings.json → readSettings strips and parses', () => {
  fs.writeFileSync(settingsFile(), '\uFEFF{"hooks":{}}');
  assert.doesNotThrow(() => readSettings());
});

test('12: malformed settings.json → readSettings throws with clear error', () => {
  fs.writeFileSync(settingsFile(), '{"broken",');
  assert.throws(() => readSettings(), /settings\.json/i);
});

test('13: mergeHook with duplicate command but different timeout → rejects (idempotent)', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  mergeHook(s, HOOK_SPEC);
  const second = mergeHook(s, { ...HOOK_SPEC, timeout: 999 });
  assert.equal(second.added, false);
});

test('14: large settings.json (>500KB) round-trips', () => {
  const big = { hooks: {}, padding: 'x'.repeat(600_000) };
  writeSettings(big);
  const s = readSettings();
  assert.equal(s.padding.length, 600_000);
});

test('15: mergeHook result is stable across multiple calls', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  for (let i = 0; i < 5; i++) mergeHook(s, HOOK_SPEC);
  assert.equal(s.hooks.PreToolUse[0].hooks.length, 1);
});

test('16: unmergeHook on empty settings no-op', () => {
  const s = {};
  const { removed } = unmergeHook(s, { commandPredicate: () => true });
  assert.equal(removed, 0);
});

test('17: unmergeHook removes entire matcher block if all hooks drop', () => {
  const s = { hooks: { PreToolUse: [{ matcher: 'X', hooks: [{ type: 'command', command: 'ours' }] }] } };
  unmergeHook(s, { commandPredicate: (c) => c === 'ours' });
  assert.equal(s.hooks.PreToolUse.length, 0);
});

test('18: mergeHook handles settings where hooks key is missing', () => {
  const s = { env: { FOO: 'bar' } };
  mergeHook(s, HOOK_SPEC);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.env.FOO, 'bar');
});

test('19: writeSettings is atomic (rename-from-temp)', () => {
  writeSettings({ marker: 1 });
  // Only valid artifact is the final file (no .tmp leftover)
  const files = fs.readdirSync(path.join(tmpHome, '.claude'));
  assert.ok(files.includes('settings.json'));
  assert.ok(!files.some(f => f.endsWith('.tmp')));
});

test('20: mergeHook tag in SHA256 manifest-friendly form', () => {
  fs.writeFileSync(settingsFile(), '{}');
  const s = readSettings();
  const { added, entry } = mergeHook(s, HOOK_SPEC);
  assert.equal(added, true);
  assert.ok(entry && entry.command.includes('ship-baseline-check.sh'));
});
```

- [ ] **Step 5: Run test — verify failure**

Run: `node --test tests/scripts/settings-merge.test.js`
Expected: module-not-found

- [ ] **Step 6: Write `scripts/lib/settings-merge.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { settingsPath } from './paths.js';

export function readSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  let raw = fs.readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in settings.json: ${e.message}`);
  }
}

export function writeSettings(obj) {
  const p = settingsPath();
  const tmp = `${p}.tmp-${process.pid}`;
  const json = JSON.stringify(obj, null, 2);
  // Validate before writing final
  JSON.parse(json);
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, p);
}

export function mergeHook(settings, spec) {
  const { event, matcher, command, timeout } = spec;
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[event]) settings.hooks[event] = [];

  let block = settings.hooks[event].find(m => m.matcher === matcher);
  if (!block) {
    block = { matcher, hooks: [] };
    settings.hooks[event].push(block);
  }
  // Idempotent: skip if same command already present
  const existing = block.hooks.find(h => h.command === command);
  if (existing) {
    return { added: false, entry: existing };
  }
  const entry = { type: 'command', command, ...(timeout != null ? { timeout } : {}) };
  block.hooks.push(entry);
  return { added: true, entry };
}

export function unmergeHook(settings, { commandPredicate }) {
  if (!settings.hooks) return { removed: 0 };
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const blocks = settings.hooks[event];
    for (const block of blocks) {
      const before = block.hooks.length;
      block.hooks = block.hooks.filter(h => !commandPredicate(h.command));
      removed += before - block.hooks.length;
    }
    // Drop matcher blocks with empty hooks array
    settings.hooks[event] = blocks.filter(b => b.hooks.length > 0);
  }
  return { removed };
}
```

- [ ] **Step 7: Run test — verify 20/20 passing**

Run: `node --test tests/scripts/settings-merge.test.js`
Expected: all 20 tests pass

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/settings-merge.js tests/scripts/settings-merge.test.js tests/fixtures/settings-samples/
git commit -m "feat(scripts): add settings-merge.js with 20 fixture tests (idempotent append-only)"
```

---

### Task 10: Write scripts/lib/spec-diff.js (TDD)

**Files:**
- Create: `scripts/lib/spec-diff.js`
- Test: `tests/scripts/spec-diff.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/spec-diff.test.js`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpec, summarizeDiff } from '../../scripts/lib/spec-diff.js';

test('diffSpec on identical text → empty', () => {
  const a = "line1\nline2\nline3\n";
  const d = diffSpec(a, a);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
});

test('diffSpec counts added and removed lines', () => {
  const a = "line1\nline2\nline3\n";
  const b = "line1\nline2-modified\nline3\nline4\n";
  const d = diffSpec(a, b);
  assert.equal(d.added, 2);   // line2-modified + line4
  assert.equal(d.removed, 1); // line2
});

test('summarizeDiff formats human-readable string', () => {
  const s = summarizeDiff([
    { file: 'CLAUDE.md', added: 21, removed: 0 },
    { file: 'CLAUDE-extended.md', added: 50, removed: 5 },
  ]);
  assert.match(s, /CLAUDE\.md/);
  assert.match(s, /\+21/);
  assert.match(s, /-5/);
});
```

- [ ] **Step 2: Write `scripts/lib/spec-diff.js`**

```javascript
export function diffSpec(a, b) {
  const aLines = new Set((a || '').split('\n'));
  const bLines = new Set((b || '').split('\n'));
  let added = 0, removed = 0;
  for (const l of bLines) if (!aLines.has(l)) added++;
  for (const l of aLines) if (!bLines.has(l)) removed++;
  return { added, removed };
}

export function summarizeDiff(perFile) {
  return perFile.map(f => `  ${f.file}: +${f.added} / -${f.removed}`).join('\n');
}
```

- [ ] **Step 3: Run test — verify passing**

Run: `node --test tests/scripts/spec-diff.test.js`
Expected: 3/3 pass

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/spec-diff.js tests/scripts/spec-diff.test.js
git commit -m "feat(scripts): add spec-diff.js line-level diff + summary"
```

---

### Task 11: Write scripts/install.js fresh/existing spec branch (TDD)

**Files:**
- Create: `scripts/install.js`
- Test: `tests/scripts/install.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/install.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../scripts/install.js';

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-inst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });

  // Plugin shipped spec
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), '# Core v6.9.2\nVersion: 6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), '# Extended v6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), '# Changelog\n');

  // Plugin hooks (minimal stubs so install can reference them)
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  for (const name of ['banned-vocab-check', 'ship-baseline-check', 'residue-audit',
                      'memory-read-check', 'sandbox-disposal-check']) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', `${name}.sh`), '#!/bin/bash\nexit 0\n');
  }
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('fresh HOME: spec copied, no backup', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'fresh');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# Core v6.9.2\nVersion: 6.9.2\n');
  const items = fs.readdirSync(path.join(tmpHome, '.claude'));
  assert.ok(!items.some(n => n.startsWith('backup-')));
});

test('existing spec: backup created, new spec in place', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'OLD\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'OLD-EXT\n');
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'backup-and-overwrite');
  assert.ok(res.backupDir && fs.existsSync(res.backupDir));
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'OLD\n');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# Core v6.9.2\nVersion: 6.9.2\n');
});

test('settings.json gets 5 hook entries on fresh install', async () => {
  await install({ pluginRoot });
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const bashHooks = s.hooks.PreToolUse.find(m => m.matcher === 'Bash').hooks;
  assert.equal(bashHooks.length, 3); // banned-vocab + ship-baseline + memory-read
  const stopHooks = s.hooks.Stop.find(m => m.matcher === '*').hooks;
  assert.equal(stopHooks.length, 2); // residue-audit + sandbox-disposal
});

test('idempotent: running install 3x leaves settings.json unchanged', async () => {
  await install({ pluginRoot });
  const after1 = fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8');
  await install({ pluginRoot });
  await install({ pluginRoot });
  const after3 = fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8');
  assert.equal(after1, after3);
});

test('installed.json manifest records entries', async () => {
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.entries.length, 5);
  assert.ok(manifest.entries.every(e => typeof e.sha256 === 'string' && e.sha256.length === 64));
});

test('logs directory and empty jsonl created', async () => {
  await install({ pluginRoot });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  assert.ok(fs.existsSync(log));
  assert.equal(fs.readFileSync(log, 'utf8'), '');
});
```

- [ ] **Step 2: Run test — verify failure (module missing)**

Run: `node --test tests/scripts/install.test.js`
Expected: module-not-found

- [ ] **Step 3: Write `scripts/install.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readSettings, writeSettings, mergeHook } from './lib/settings-merge.js';
import { createBackup, pruneBackups } from './lib/backup.js';
import { pluginCacheDir, stateDir, logsDir, settingsPath, specHome } from './lib/paths.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

const HOOK_SPECS = (pluginRoot) => [
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/banned-vocab-check.sh"`, timeout: 3 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/ship-baseline-check.sh"`, timeout: 5 },
  { event: 'PreToolUse', matcher: 'Bash',
    command: `bash "${pluginRoot}/hooks/memory-read-check.sh"`, timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: `bash "${pluginRoot}/hooks/residue-audit.sh"`, timeout: 3 },
  { event: 'Stop', matcher: '*',
    command: `bash "${pluginRoot}/hooks/sandbox-disposal-check.sh"`, timeout: 3 },
];

export async function install({ pluginRoot = process.env.CLAUDE_PLUGIN_ROOT } = {}) {
  if (!pluginRoot) throw new Error('install: pluginRoot missing');

  // 1. Ensure ~/.claude/ exists
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });

  // 2. Spec install branch
  const existing = specHome().filter(fs.existsSync);
  let specResult, backupDir = null;
  if (existing.length === 0) {
    specResult = 'fresh';
  } else {
    const bk = createBackup(existing, { label: 'backup' });
    backupDir = bk.dir;
    pruneBackups(5);
    specResult = 'backup-and-overwrite';
  }
  for (const name of SPEC_FILES) {
    const src = path.join(pluginRoot, 'spec', name);
    const dest = path.join(path.dirname(settingsPath()), name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  // 3. settings.json backup + merge
  const settingsBackup = `${settingsPath()}.claudemd-backup-${isoStamp()}`;
  if (fs.existsSync(settingsPath())) {
    fs.copyFileSync(settingsPath(), settingsBackup);
  }
  const settings = fs.existsSync(settingsPath()) ? readSettings() : {};
  const entries = [];
  for (const spec of HOOK_SPECS(pluginRoot)) {
    const { added, entry } = mergeHook(settings, spec);
    if (added || entry) {
      entries.push({
        event: spec.event,
        matcher: spec.matcher,
        command: entry.command,
        sha256: crypto.createHash('sha256').update(entry.command).digest('hex'),
      });
    }
  }
  writeSettings(settings);

  // 4. State + logs
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(path.join(stateDir(), 'installed.json'), JSON.stringify({
    version: '0.1.0',
    installedAt: new Date().toISOString(),
    pluginRoot,
    entries,
  }, null, 2));

  fs.mkdirSync(logsDir(), { recursive: true });
  const log = path.join(logsDir(), 'claudemd.jsonl');
  if (!fs.existsSync(log)) fs.writeFileSync(log, '');

  return { spec: specResult, backupDir, settingsBackup, entries };
}

function isoStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+Z$/, 'Z');
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  install().then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`install failed: ${e.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test — verify 6/6 passing**

Run: `node --test tests/scripts/install.test.js`
Expected: all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/install.js tests/scripts/install.test.js
git commit -m "feat(scripts): add install.js with Q1 backup-and-overwrite + manifest + idempotent merge"
```

---

### Task 12: Extend install.js with hand-installed hook migration (TDD)

**Files:**
- Modify: `scripts/install.js`
- Modify: `tests/scripts/install.test.js` (add 2 cases)

- [ ] **Step 1: Append failing tests to `tests/scripts/install.test.js`**

```javascript
test('migrates hand-installed banned-vocab hook into backup', async () => {
  // Place hand-installed artifacts
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'), '#!/bin/bash\n# v0 hand-install\nexit 0\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab.patterns'), 'foo|reason\n');
  // settings.json pointing to hand-installed hook
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command',
      command: `bash "${path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')}"`, timeout: 3 }] }] }
  }));

  const res = await install({ pluginRoot });

  // Old files moved into backup-<ISO>/hooks/
  assert.ok(res.backupDir);
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab-check.sh')));
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab.patterns')));
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')), false);

  // settings.json no longer references hand-installed path
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash').hooks;
  assert.equal(bash.some(h => h.command.includes(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'))), false);
});

test('leaves non-migrated hand hooks untouched', async () => {
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/some-other.sh'), '#!/bin/bash\nexit 0\n');
  await install({ pluginRoot });
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/hooks/some-other.sh')));
});
```

- [ ] **Step 2: Run test — verify new cases fail**

Run: `node --test tests/scripts/install.test.js`
Expected: 6 pass + 2 fail (migration not implemented)

- [ ] **Step 3: Add migration to `scripts/install.js` — insert AFTER spec install, BEFORE settings merge**

Add this block inside `install()`, between the spec-copy `for` loop and the settings.json backup:

```javascript
  // 2a. Migrate hand-installed banned-vocab hook
  const handHooks = [
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab-check.sh'),
    path.join(path.dirname(settingsPath()), 'hooks/banned-vocab.patterns'),
  ];
  const handExisting = handHooks.filter(fs.existsSync);
  if (handExisting.length > 0) {
    const migrateDir = backupDir || createBackup([], { label: 'backup' }).dir;
    const hooksSubdir = path.join(migrateDir, 'hooks');
    fs.mkdirSync(hooksSubdir, { recursive: true });
    for (const src of handExisting) {
      fs.renameSync(src, path.join(hooksSubdir, path.basename(src)));
    }
    backupDir = migrateDir;
    // Remove any settings.json entries pointing to the old paths
    if (fs.existsSync(settingsPath())) {
      const pre = readSettings();
      const { unmergeHook } = await import('./lib/settings-merge.js');
      unmergeHook(pre, { commandPredicate: (c) =>
        handHooks.some(h => c.includes(h))
      });
      writeSettings(pre);
    }
  }
```

- [ ] **Step 4: Run test — verify 8/8 passing**

Run: `node --test tests/scripts/install.test.js`
Expected: all 8 pass

- [ ] **Step 5: Commit**

```bash
git add scripts/install.js tests/scripts/install.test.js
git commit -m "feat(scripts): install.js migrates hand-installed banned-vocab into backup"
```

---

### Task 13: Write scripts/uninstall.js (TDD) — 3-way with hard AUTH delete

**Files:**
- Create: `scripts/uninstall.js`
- Test: `tests/scripts/uninstall.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/uninstall.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../scripts/install.js';
import { uninstall } from '../../scripts/uninstall.js';

let tmpHome, savedHome, pluginRoot;

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-uninst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), 'plugin\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), 'plugin-ext\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), 'plugin-cl\n');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  for (const n of ['banned-vocab-check','ship-baseline-check','residue-audit','memory-read-check','sandbox-disposal-check']) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', `${n}.sh`), '#!/bin/bash\nexit 0\n');
  }
  // Co-existing foreign hook
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node /foreign/hook.mjs', timeout: 5 }] }] }
  }));
  await install({ pluginRoot });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('keep option: spec files remain, plugin entries removed', async () => {
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')));
  // Plugin's 3 PreToolUse:Bash entries removed; entire block now empty → removed
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.PreToolUse?.length || 0, 0);
  // Foreign PostToolUse preserved
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'node /foreign/hook.mjs');
});

test('delete option: requires confirmHardAuth=true, then removes spec', async () => {
  const refused = await uninstall({ specAction: 'delete', confirmHardAuth: false });
  assert.equal(refused.specAction, 'abort');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), 'refused delete preserves files');

  const approved = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(approved.specAction, 'delete');
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), false);
});

test('restore option: finds newest backup and copies back', async () => {
  // Simulate a prior spec existed before install by creating a backup dir manually
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');

  const res = await uninstall({ specAction: 'restore' });
  assert.equal(res.specAction, 'restore');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'prior-version\n');
});

test('manifest consumed for precise removal', async () => {
  // Before uninstall, manifest exists
  const manifest = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
  assert.ok(fs.existsSync(manifest));
  await uninstall({ specAction: 'keep', purge: true });
  // purge: state dir gone
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/.claudemd-state')), false);
});

test('idempotent: running uninstall twice is safe', async () => {
  await uninstall({ specAction: 'keep' });
  const second = await uninstall({ specAction: 'keep' });
  assert.equal(second.warning, 'already-uninstalled');
});
```

- [ ] **Step 2: Run test — verify failure (module missing)**

Run: `node --test tests/scripts/uninstall.test.js`
Expected: module-not-found

- [ ] **Step 3: Write `scripts/uninstall.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { readSettings, writeSettings, unmergeHook } from './lib/settings-merge.js';
import { listBackups, restoreBackup } from './lib/backup.js';
import { stateDir, logsDir, settingsPath, specHome, backupRoot } from './lib/paths.js';

export async function uninstall({ specAction = 'keep', confirmHardAuth = false, purge = false } = {}) {
  const manifestPath = path.join(stateDir(), 'installed.json');
  if (!fs.existsSync(manifestPath)) {
    return { warning: 'already-uninstalled' };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. Remove settings.json entries by commandPredicate (manifest sha256 or path fallback)
  if (fs.existsSync(settingsPath())) {
    const s = readSettings();
    const pluginCommands = new Set(manifest.entries.map(e => e.command));
    unmergeHook(s, { commandPredicate: (c) =>
      pluginCommands.has(c) || c.includes('claudemd/hooks/')
    });
    writeSettings(s);
  }

  // 2. Spec file disposition
  let outcome = specAction;
  if (specAction === 'delete') {
    if (!confirmHardAuth) {
      return { specAction: 'abort', reason: 'hard-AUTH confirmation required for delete' };
    }
    for (const p of specHome()) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } else if (specAction === 'restore') {
    const backups = listBackups();
    if (backups.length === 0) {
      return { specAction: 'abort', reason: 'no backups available to restore' };
    }
    restoreBackup(backups[0].dir, backupRoot());
  } else {
    outcome = 'keep';
  }

  // 3. Clean state + logs (per purge flag)
  if (purge) {
    fs.rmSync(stateDir(), { recursive: true, force: true });
    fs.rmSync(logsDir(), { recursive: true, force: true });
  } else {
    fs.unlinkSync(manifestPath);
  }

  return { specAction: outcome };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const specAction = process.env.CLAUDEMD_SPEC_ACTION || 'keep';
  const confirmHardAuth = process.env.CLAUDEMD_CONFIRM === '1';
  const purge = process.env.CLAUDEMD_PURGE === '1';
  uninstall({ specAction, confirmHardAuth, purge }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error(`uninstall failed: ${e.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test — verify 5/5 passing**

Run: `node --test tests/scripts/uninstall.test.js`
Expected: all 5 pass

- [ ] **Step 5: Commit**

```bash
git add scripts/uninstall.js tests/scripts/uninstall.test.js
git commit -m "feat(scripts): add uninstall.js with keep/delete(hard-AUTH)/restore options"
```

---

### Task 14: Write scripts/update.js (TDD) — interactive diff + apply

**Files:**
- Create: `scripts/update.js`
- Test: `tests/scripts/update.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/update.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { update } from '../../scripts/update.js';

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-upd-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), 'plugin-new\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), 'plugin-new-ext\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), 'plugin-new-cl\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'home-old\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'plugin-new-ext\n'); // identical
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'home-old-cl\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('dry-run: returns per-file diff summary', async () => {
  const res = await update({ pluginRoot, choice: 'cancel' });
  assert.equal(res.applied, false);
  assert.equal(res.diffs.length, 3);
  const core = res.diffs.find(d => d.file === 'CLAUDE.md');
  assert.ok(core.added > 0 || core.removed > 0);
  const ext = res.diffs.find(d => d.file === 'CLAUDE-extended.md');
  assert.equal(ext.added, 0);
  assert.equal(ext.removed, 0);
});

test('apply-all: backup created and all files updated', async () => {
  const res = await update({ pluginRoot, choice: 'apply-all' });
  assert.equal(res.applied, true);
  assert.ok(res.backupDir);
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'plugin-new\n');
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'home-old\n');
});

test('select-per-file: only chosen files updated', async () => {
  const res = await update({ pluginRoot, choice: 'select', selected: ['CLAUDE.md'] });
  assert.equal(res.applied, true);
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'plugin-new\n');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'utf8'), 'home-old-cl\n');
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `node --test tests/scripts/update.test.js`
Expected: module-not-found

- [ ] **Step 3: Write `scripts/update.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { specHome, backupRoot } from './lib/paths.js';
import { diffSpec } from './lib/spec-diff.js';
import { createBackup, pruneBackups } from './lib/backup.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

export async function update({ pluginRoot, choice = 'cancel', selected = [] } = {}) {
  if (!pluginRoot) throw new Error('update: pluginRoot missing');

  // Compute diffs
  const diffs = [];
  for (const name of SPEC_FILES) {
    const homeFile = path.join(backupRoot(), name);
    const pluginFile = path.join(pluginRoot, 'spec', name);
    const homeText = fs.existsSync(homeFile) ? fs.readFileSync(homeFile, 'utf8') : '';
    const pluginText = fs.existsSync(pluginFile) ? fs.readFileSync(pluginFile, 'utf8') : '';
    const d = diffSpec(homeText, pluginText);
    diffs.push({ file: name, ...d });
  }

  if (choice === 'cancel') return { applied: false, diffs };

  // Determine files to update
  let targets;
  if (choice === 'apply-all') {
    targets = SPEC_FILES.filter(n => diffs.find(d => d.file === n && (d.added > 0 || d.removed > 0)));
  } else if (choice === 'select') {
    targets = selected;
  } else {
    throw new Error(`unknown choice: ${choice}`);
  }

  if (targets.length === 0) {
    return { applied: false, diffs, reason: 'no changes to apply' };
  }

  // Backup existing targets
  const existing = targets.map(n => path.join(backupRoot(), n)).filter(fs.existsSync);
  const { dir: backupDir } = createBackup(existing, { label: 'backup' });
  pruneBackups(5);

  // Copy from plugin
  for (const name of targets) {
    fs.copyFileSync(path.join(pluginRoot, 'spec', name), path.join(backupRoot(), name));
  }

  return { applied: true, backupDir, diffs, targets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  update({ pluginRoot, choice: 'cancel' }).then(r => {
    console.log(JSON.stringify(r, null, 2));
  });
}
```

- [ ] **Step 4: Run test — verify 3/3 passing**

Run: `node --test tests/scripts/update.test.js`
Expected: all 3 pass

- [ ] **Step 5: Commit**

```bash
git add scripts/update.js tests/scripts/update.test.js
git commit -m "feat(scripts): add update.js with dry-run/apply-all/select diff-and-apply"
```

---

### Task 15: Write full-lifecycle integration test

**Files:**
- Create: `tests/integration/full-lifecycle.test.sh`

- [ ] **Step 1: Create directory**

```bash
mkdir -p tests/integration
```

- [ ] **Step 2: Write `tests/integration/full-lifecycle.test.sh`**

```bash
#!/usr/bin/env bash
# End-to-end: install → simulate hook invocation → inspect rule-hits → uninstall.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

TMP_HOME=$(mktemp -d)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude"

# Phase 1: install
OUT=$(CLAUDE_PLUGIN_ROOT="$REPO" node "$REPO/scripts/install.js") || { echo "FAIL: install"; exit 1; }
echo "$OUT" | jq -e '.spec == "fresh"' >/dev/null \
  || { echo "FAIL: expected fresh install"; exit 1; }

# Phase 2: spec files in place
for f in CLAUDE.md CLAUDE-extended.md CLAUDE-changelog.md; do
  [[ -f "$HOME/.claude/$f" ]] || { echo "FAIL: missing $f"; exit 1; }
done

# Phase 3: settings.json has 5 hook entries
JQ_QUERY='(.hooks.PreToolUse[] | select(.matcher=="Bash") | .hooks | length) as $pre
  | (.hooks.Stop[] | select(.matcher=="*") | .hooks | length) as $stop
  | $pre == 3 and $stop == 2'
jq -e "$JQ_QUERY" "$HOME/.claude/settings.json" >/dev/null \
  || { echo "FAIL: settings.json hook count"; exit 1; }

# Phase 4: simulate banned-vocab hook firing
EVENT='{"session_id":"integ","tool_name":"Bash","tool_input":{"command":"git commit -m '\''significantly improved'\''"},"cwd":"/tmp"}'
DENY=$(echo "$EVENT" | bash "$REPO/hooks/banned-vocab-check.sh" 2>&1 | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DENY" == "deny" ]] || { echo "FAIL: banned-vocab did not deny (got '$DENY')"; exit 1; }

# Phase 5: rule-hits has at least one row
[[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || { echo "FAIL: no jsonl"; exit 1; }
LINES=$(wc -l < "$HOME/.claude/logs/claudemd.jsonl")
(( LINES >= 1 )) || { echo "FAIL: expected rule-hits row"; exit 1; }

# Phase 6: uninstall keep
OUT=$(node "$REPO/scripts/uninstall.js") || { echo "FAIL: uninstall"; exit 1; }
echo "$OUT" | jq -e '.specAction == "keep"' >/dev/null \
  || { echo "FAIL: uninstall outcome"; exit 1; }

# Phase 7: settings.json clean of our entries
REMAIN=$(jq '[.hooks.PreToolUse // [] | .[] | .hooks[] | select(.command | contains("claudemd"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
[[ "$REMAIN" == "0" ]] || { echo "FAIL: claudemd entries remain"; exit 1; }

# Phase 8: spec files preserved (keep option)
[[ -f "$HOME/.claude/CLAUDE.md" ]] || { echo "FAIL: spec removed on keep"; exit 1; }

echo "full-lifecycle: PASS"
```

Make executable:

```bash
chmod +x tests/integration/full-lifecycle.test.sh
```

- [ ] **Step 3: Run the integration test**

Run: `bash tests/integration/full-lifecycle.test.sh`
Expected: `full-lifecycle: PASS`

- [ ] **Step 4: Commit**

```bash
git add tests/integration/full-lifecycle.test.sh
git commit -m "test: add full-lifecycle integration (install → hook → audit → uninstall)"
```

---

### Task 16: Write CI workflow + top-level test runner

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/run-all.sh`

- [ ] **Step 1: Write `tests/run-all.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo "== Shell hook tests =="
for t in "$HERE"/hooks/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  bash "$t" || FAIL=$((FAIL + 1))
done

echo "== Node.js script tests =="
if ! node --test "$HERE"/scripts/*.test.js; then
  FAIL=$((FAIL + 1))
fi

echo "== Integration tests =="
for t in "$HERE"/integration/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  bash "$t" || FAIL=$((FAIL + 1))
done

if (( FAIL > 0 )); then
  echo "OVERALL: $FAIL suite(s) failed"
  exit 1
fi
echo "OVERALL: all suites passed"
```

Make executable:

```bash
chmod +x tests/run-all.sh
```

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```bash
mkdir -p .github/workflows
```

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [20]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Install tools
        run: |
          if [[ "$RUNNER_OS" == "macOS" ]]; then brew install jq shellcheck; fi
          if [[ "$RUNNER_OS" == "Linux" ]]; then sudo apt-get update -y && sudo apt-get install -y jq shellcheck; fi
      - name: Shellcheck hooks (warn-only)
        run: shellcheck hooks/*.sh hooks/lib/*.sh || echo "shellcheck warnings (non-blocking)"
      - name: Run test suite
        run: bash tests/run-all.sh
```

- [ ] **Step 3: Run the entire suite locally**

Run: `bash tests/run-all.sh`
Expected: `OVERALL: all suites passed`

- [ ] **Step 4: Commit**

```bash
git add tests/run-all.sh .github/workflows/ci.yml
git commit -m "ci: add test runner + GitHub Actions matrix (ubuntu+macos × node 20)"
```

---

**M2 exit criteria:**
- [ ] All 4 scripts present: `install.js`, `uninstall.js`, `update.js`, and 5 libs in `scripts/lib/`
- [ ] All 6 script test files passing: `paths.test.js`, `backup.test.js`, `settings-merge.test.js` (20), `spec-diff.test.js`, `install.test.js` (8), `uninstall.test.js` (5), `update.test.js` (3)
- [ ] Integration: `bash tests/integration/full-lifecycle.test.sh` reports PASS
- [ ] `tests/run-all.sh` green locally
- [ ] CI workflow committed

---

## M3 — Ship-baseline hook (parallelizable after M2)

**Goal:** Block `git push` when base-branch CI is red unless `known-red baseline:` override present. 2s `gh run list` timeout.

**Duration:** ~0.5d (3 tasks)

**Depends on:** M1 (hook-common/rule-hits) + M2 (install.js already references the hook path in plugin.json)

---

### Task 17: Write hooks/ship-baseline-check.sh (TDD)

**Files:**
- Create: `hooks/ship-baseline-check.sh`

- [ ] **Step 1: Write `hooks/ship-baseline-check.sh`**

```bash
#!/usr/bin/env bash
# ship-baseline-check.sh — PreToolUse:Bash hook.
# Denies `git push` if base-branch CI is RED, unless bypass present.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SHIP_BASELINE || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Filter: git push, not --help
echo "$CMD" | grep -qE '(^|[[:space:];&|])git[[:space:]]+push([[:space:]]|$)' || exit 0
echo "$CMD" | grep -qE '\-\-help|\-h\b' && exit 0

# Require gh CLI
command -v gh >/dev/null 2>&1 || exit 0

# Query latest run with 2s hard timeout
RUN_JSON=$(timeout 2 gh run list --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
[[ -n "$RUN_JSON" ]] || exit 0

CONCLUSION=$(printf '%s' "$RUN_JSON" | jq -r '.[0].conclusion // ""' 2>/dev/null)
[[ "$CONCLUSION" == "failure" ]] || { hook_record ship-baseline pass null; exit 0; }

# known-red baseline bypass
HEAD_MSG=$(git log -1 --format=%B 2>/dev/null || true)
if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red null
  exit 0
fi

RUN_URL=$(printf '%s' "$RUN_JSON" | jq -r '.[0].url // ""')
RUN_TITLE=$(printf '%s' "$RUN_JSON" | jq -r '.[0].displayTitle // ""')

REASON="§7 Ship-baseline: base-branch CI is RED — $RUN_TITLE
$RUN_URL

Options:
  (a) Fix failing workflow, then retry push.
  (b) Override: prepend commit body with: known-red baseline: <reason>
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."

hook_record ship-baseline deny "{\"run_url\":\"$RUN_URL\"}"
hook_deny ship-baseline "$REASON"
```

Make executable:

```bash
chmod +x hooks/ship-baseline-check.sh
```

- [ ] **Step 2: Shellcheck**

Run: `shellcheck hooks/ship-baseline-check.sh`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add hooks/ship-baseline-check.sh
git commit -m "feat(hooks): add ship-baseline-check (deny git push on red CI with known-red bypass)"
```

---

### Task 18: Write mock-gh fixtures + ship-baseline.test.sh (TDD)

**Files:**
- Create: `tests/fixtures/mock-gh/pass-green/gh`
- Create: `tests/fixtures/mock-gh/fail-red/gh`
- Create: `tests/fixtures/mock-gh/slow/gh`
- Create: `tests/hooks/ship-baseline.test.sh`

- [ ] **Step 1: Create mock-gh fixture dirs**

```bash
mkdir -p tests/fixtures/mock-gh/pass-green tests/fixtures/mock-gh/fail-red tests/fixtures/mock-gh/slow
```

- [ ] **Step 2: Write `tests/fixtures/mock-gh/pass-green/gh`**

```bash
#!/usr/bin/env bash
echo '[{"databaseId":1,"status":"completed","conclusion":"success","displayTitle":"CI main","url":"https://example/1"}]'
```

- [ ] **Step 3: Write `tests/fixtures/mock-gh/fail-red/gh`**

```bash
#!/usr/bin/env bash
echo '[{"databaseId":2,"status":"completed","conclusion":"failure","displayTitle":"test_flake","url":"https://example/2"}]'
```

- [ ] **Step 4: Write `tests/fixtures/mock-gh/slow/gh`**

```bash
#!/usr/bin/env bash
sleep 5
echo '[{"databaseId":3,"status":"completed","conclusion":"failure"}]'
```

- [ ] **Step 5: Make all mock-gh executable**

```bash
chmod +x tests/fixtures/mock-gh/*/gh
```

- [ ] **Step 6: Write `tests/hooks/ship-baseline.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/ship-baseline-check.sh"
MOCKS="$HERE/../fixtures/mock-gh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude"

# Initialize a fake git repo for git log to return something
cd "$TMP_HOME" && git init -q && git commit --allow-empty -q -m "clean commit" 2>/dev/null

FAIL=0
run_hook() {
  local mock="$1" event="$2"
  PATH="$MOCKS/$mock:$PATH" bash "$HOOK" <<<"$event" 2>&1
}

EVENT_PUSH='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/tmp"}'
EVENT_HELP='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push --help"},"cwd":"/tmp"}'
EVENT_COMMIT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m test"},"cwd":"/tmp"}'

# Case 1: green CI → pass
OUT=$(run_hook pass-green "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 1 green → pass" || { echo "FAIL: 1 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 2: red CI + no bypass → deny
OUT=$(run_hook fail-red "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 2 red → deny" || { echo "FAIL: 2 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 3: red CI + known-red commit body → pass
cd "$TMP_HOME" && git commit --allow-empty -q -m "feat: x" -m "known-red baseline: flaky test quarantined"
OUT=$(run_hook fail-red "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 3 known-red bypass" || { echo "FAIL: 3 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 4: git push --help → pass
OUT=$(run_hook fail-red "$EVENT_HELP")
[[ -z "$OUT" ]] && echo "PASS: 4 --help → pass" || { echo "FAIL: 4 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 5: non-push command → pass
OUT=$(run_hook fail-red "$EVENT_COMMIT")
[[ -z "$OUT" ]] && echo "PASS: 5 non-push → pass" || { echo "FAIL: 5 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 6: 2s timeout on slow gh → fail-open pass
START=$(date +%s)
OUT=$(run_hook slow "$EVENT_PUSH")
END=$(date +%s)
ELAPSED=$((END - START))
[[ -z "$OUT" && $ELAPSED -le 3 ]] && echo "PASS: 6 slow gh → timeout fail-open (${ELAPSED}s)" \
  || { echo "FAIL: 6 (elapsed=${ELAPSED}s, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 7: gh not on PATH → fail-open pass
OUT=$(PATH="/usr/bin:/bin" bash "$HOOK" <<<"$EVENT_PUSH" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 7 no gh → pass" || { echo "FAIL: 7 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 8: kill-switch
OUT=$(DISABLE_SHIP_BASELINE_HOOK=1 run_hook fail-red "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 8 kill-switch" || { echo "FAIL: 8 (got: $OUT)"; FAIL=$((FAIL + 1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((8 - FAIL))/8 passed"
  exit 1
fi
echo "Tests: 8/8 passed"
```

Make executable:

```bash
chmod +x tests/hooks/ship-baseline.test.sh
```

- [ ] **Step 7: Run test — verify 8/8 passing**

Run: `bash tests/hooks/ship-baseline.test.sh`
Expected: `Tests: 8/8 passed`

- [ ] **Step 8: Commit**

```bash
git add hooks/ship-baseline-check.sh tests/hooks/ship-baseline.test.sh tests/fixtures/mock-gh/
git commit -m "test(hooks): add ship-baseline test suite (8 cases, mock-gh)"
```

---

### Task 19: Verify ship-baseline wired into install.js

**Files:**
- Test: verify existing behavior in `tests/scripts/install.test.js`

- [ ] **Step 1: Re-run install test to confirm the 3-hook Bash matcher includes ship-baseline**

Run: `node --test tests/scripts/install.test.js`
Expected: all 8 tests pass (Task 11 Step 4 already asserted `bashHooks.length === 3`)

- [ ] **Step 2: If green, no commit needed (verified only). If the plugin.json reference path differs from install.js, fix and commit.**

---

**M3 exit criteria:**
- [ ] `hooks/ship-baseline-check.sh` exists, shellcheck clean
- [ ] `bash tests/hooks/ship-baseline.test.sh` reports 8/8
- [ ] install.js test still green (ship-baseline in 3-hook Bash matcher)

---

## M4 — Residue audit (parallelizable after M2)

**Goal:** Stop hook that compares `~/.claude/tmp/` count vs baseline, warns on delta > threshold, advisory-only (never blocks).

**Duration:** ~0.5d (2 tasks)

**Depends on:** M1

---

### Task 20: Write hooks/residue-audit.sh (TDD)

**Files:**
- Create: `hooks/residue-audit.sh`

- [ ] **Step 1: Write `hooks/residue-audit.sh`**

```bash
#!/usr/bin/env bash
# residue-audit.sh — Stop hook. Advisory only: never emits deny JSON (Stop cannot block).

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch RESIDUE_AUDIT || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
BASELINE_FILE="$STATE_DIR/tmp-baseline.txt"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

TMP_DIR="$HOME/.claude/tmp"
[[ -d "$TMP_DIR" ]] || exit 0

CURRENT=$(find "$TMP_DIR" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
BASELINE=0
[[ -f "$BASELINE_FILE" ]] && BASELINE=$(cat "$BASELINE_FILE" 2>/dev/null || echo 0)

DELTA=$((CURRENT - BASELINE))
THRESHOLD="${SPEC_RESIDUE_THRESHOLD:-20}"

if (( DELTA > THRESHOLD )); then
  echo "[claudemd] §7 residue audit: ~/.claude/tmp grew by $DELTA entries (current: $CURRENT, baseline: $BASELINE, threshold: $THRESHOLD)." >&2
  echo "[claudemd] Consider: find ~/.claude/tmp -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +" >&2
  hook_record residue-audit warn "{\"delta\":$DELTA,\"current\":$CURRENT,\"baseline\":$BASELINE}"
fi

echo "$CURRENT" > "$BASELINE_FILE"
exit 0
```

Make executable:

```bash
chmod +x hooks/residue-audit.sh
```

- [ ] **Step 2: Shellcheck**

Run: `shellcheck hooks/residue-audit.sh`
Expected: clean

---

### Task 21: Write residue-audit.test.sh (TDD)

**Files:**
- Create: `tests/hooks/residue-audit.test.sh`

- [ ] **Step 1: Write `tests/hooks/residue-audit.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/residue-audit.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$HOME/.claude/logs"

FAIL=0

# Case 1: no tmp dir growth, no baseline → exit 0 silent, creates baseline
bash "$HOOK" <<<'{}' 2>/dev/null
BASE=$(cat "$HOME/.claude/.claudemd-state/tmp-baseline.txt" 2>/dev/null)
[[ -n "$BASE" ]] && echo "PASS: 1 baseline created" || { echo "FAIL: 1"; FAIL=$((FAIL+1)); }

# Case 2: growth below threshold → no warning
for i in $(seq 1 5); do mkdir -p "$HOME/.claude/tmp/d$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
[[ -z "$STDERR" ]] && echo "PASS: 2 below-threshold silent" || { echo "FAIL: 2 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: growth above threshold → stderr warning + jsonl row
for i in $(seq 1 30); do mkdir -p "$HOME/.claude/tmp/big$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "residue audit" && echo "PASS: 3 above-threshold warn" || { echo "FAIL: 3"; FAIL=$((FAIL+1)); }

# Case 4: SPEC_RESIDUE_THRESHOLD=5 override triggers earlier
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(SPEC_RESIDUE_THRESHOLD=5 bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "threshold: 5" && echo "PASS: 4 custom threshold" || { echo "FAIL: 4 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 5: kill-switch
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(DISABLE_RESIDUE_AUDIT_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 5 kill-switch" || { echo "FAIL: 5"; FAIL=$((FAIL+1)); }

# Case 6: tmp dir missing → exit 0 silent
rm -rf "$HOME/.claude/tmp"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 6 missing tmp dir silent" || { echo "FAIL: 6"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((6 - FAIL))/6 passed"; exit 1
fi
echo "Tests: 6/6 passed"
```

Make executable:

```bash
chmod +x tests/hooks/residue-audit.test.sh
```

- [ ] **Step 2: Run test — verify 6/6 passing**

Run: `bash tests/hooks/residue-audit.test.sh`
Expected: `Tests: 6/6 passed`

- [ ] **Step 3: Commit**

```bash
git add hooks/residue-audit.sh tests/hooks/residue-audit.test.sh
git commit -m "feat(hooks): add residue-audit Stop hook + 6-case test suite (advisory only)"
```

---

**M4 exit criteria:**
- [ ] `hooks/residue-audit.sh` exists, shellcheck clean
- [ ] `bash tests/hooks/residue-audit.test.sh` reports 6/6

---

## M5 — P1 hooks (parallelizable after M2)

**Goal:** Add `memory-read-check` (fail-open session transcript parsing) and `sandbox-disposal-check` with cross-platform platform.sh library.

**Duration:** ~1.0d (5 tasks)

**Depends on:** M1

---

### Task 22: Write hooks/lib/platform.sh (TDD)

**Files:**
- Create: `hooks/lib/platform.sh`
- Test: `tests/hooks/platform.test.sh`

- [ ] **Step 1: Write failing test `tests/hooks/platform.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/platform.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAIL=0

touch "$TMP/f1"
sleep 1
touch "$TMP/f2"

# Case 1: platform_stat_mtime returns epoch
MTIME=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f1'")
[[ "$MTIME" =~ ^[0-9]+$ ]] && echo "PASS: 1 mtime numeric" || { echo "FAIL: 1 (got $MTIME)"; FAIL=$((FAIL+1)); }

# Case 2: f2 newer than f1 (mtime should be greater)
M1=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f1'")
M2=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f2'")
(( M2 > M1 )) && echo "PASS: 2 ordering" || { echo "FAIL: 2 (m1=$M1 m2=$M2)"; FAIL=$((FAIL+1)); }

# Case 3: platform_find_newer lists f2 but not f1
REF="$TMP/f1"
OUT=$(bash -c "source $LIB; platform_find_newer '$TMP' '$REF'")
echo "$OUT" | grep -q "f2" && echo "PASS: 3 find_newer lists f2" || { echo "FAIL: 3 (got: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((3 - FAIL))/3 passed"; exit 1
fi
echo "Tests: 3/3 passed"
```

Make executable:

```bash
chmod +x tests/hooks/platform.test.sh
```

- [ ] **Step 2: Run test — verify failure**

Run: `bash tests/hooks/platform.test.sh`
Expected: multi-fail (library missing)

- [ ] **Step 3: Write `hooks/lib/platform.sh`**

```bash
#!/usr/bin/env bash
# platform.sh — cross-platform abstractions for stat/find in hooks.

# platform_stat_mtime FILE — echo mtime as epoch seconds.
platform_stat_mtime() {
  local f="$1"
  if stat --format=%Y "$f" >/dev/null 2>&1; then
    stat --format=%Y "$f"
  else
    stat -f %m "$f" 2>/dev/null
  fi
}

# platform_find_newer DIR REFERENCE_FILE — list files newer than REFERENCE_FILE under DIR.
platform_find_newer() {
  local dir="$1" ref="$2"
  find "$dir" -newer "$ref" -type f 2>/dev/null
}
```

- [ ] **Step 4: Run test — verify 3/3 passing**

Run: `bash tests/hooks/platform.test.sh`
Expected: `Tests: 3/3 passed`

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/platform.sh tests/hooks/platform.test.sh
git commit -m "feat(hooks): add platform.sh GNU/BSD stat abstraction + find_newer helper"
```

---

### Task 23: Write hooks/memory-read-check.sh (TDD, fail-open parsing)

**Files:**
- Create: `hooks/memory-read-check.sh`

- [ ] **Step 1: Write `hooks/memory-read-check.sh`**

```bash
#!/usr/bin/env bash
# memory-read-check.sh — PreToolUse:Bash hook.
# Denies ship/release/push commands when a keyword-matched memory file
# has NOT been Read in the current session.
# Fragile transcript parsing — fail-open on any hiccup.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_READ || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Escape hatch
echo "$CMD" | grep -qF '[skip-memory-check]' && exit 0

# Filter: ship/release/push/deploy keywords
echo "$CMD" | grep -qE '(git[[:space:]]+push|release|deploy|ship)' || exit 0

CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -n "$CWD" && -n "$SESSION_ID" ]] || exit 0

# Derive project-encoded dir (replace / with -)
ENCODED=$(printf '%s' "$CWD" | tr '/' '-')
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

# Fail-open if either missing (CC version drift)
[[ -f "$MEM_INDEX" ]] || exit 0
[[ -f "$TRANSCRIPT" ]] || exit 0

# Parse index lines: `- [Title](file.md) [tag1, tag2] — desc`
MATCHES=()
while IFS= read -r line; do
  # Extract filename and optional tags
  FILE=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p')
  [[ -z "$FILE" ]] && continue
  TAG_BLOCK=$(echo "$line" | sed -n 's/.*`\[\([^]]*\)\]`.*/\1/p')

  # Match condition: no tags (legacy: always match) OR any tag appears in CMD
  if [[ -z "$TAG_BLOCK" ]]; then
    MATCHES+=("$FILE")
  else
    IFS=',' read -ra TAGS <<<"$TAG_BLOCK"
    for t in "${TAGS[@]}"; do
      t=$(echo "$t" | tr -d ' ')
      [[ -z "$t" ]] && continue
      if echo "$CMD" | grep -qi "$t"; then
        MATCHES+=("$FILE")
        break
      fi
    done
  fi
done < "$MEM_INDEX"

(( ${#MATCHES[@]} == 0 )) && exit 0

# Check each matched file against transcript Read events
MISSING=()
for file in "${MATCHES[@]}"; do
  MEMFILE="$MEM_DIR/$file"
  if ! grep -qF "$MEMFILE" "$TRANSCRIPT" 2>/dev/null; then
    MISSING+=("$file")
  fi
done

(( ${#MISSING[@]} == 0 )) && exit 0

REASON="§11 MEMORY.md read-the-file (HARD): matched memory file(s) not Read this session:"
for m in "${MISSING[@]}"; do
  REASON+=$'\n'"  - $m"
done
REASON+=$'\n\n'"Options:
  (a) Read the listed file(s), then retry.
  (b) Per-invocation bypass: include [skip-memory-check] in the command.

Spec: ~/.claude/CLAUDE.md §11 SESSION — MEMORY.md read-the-file."

MISS_JSON=$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)
hook_record memory-read-check deny "{\"missing\":$MISS_JSON}"
hook_deny memory-read-check "$REASON"
```

Make executable:

```bash
chmod +x hooks/memory-read-check.sh
```

- [ ] **Step 2: Shellcheck**

Run: `shellcheck hooks/memory-read-check.sh`
Expected: clean (or only SC2034/SC2155 info)

---

### Task 24: Write memory-read-check.test.sh (TDD, fragility focus)

**Files:**
- Create: `tests/hooks/memory-read-check.test.sh`

- [ ] **Step 1: Write `tests/hooks/memory-read-check.test.sh`**

```bash
#!/usr/bin/env bash
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
OUT=$(DISABLE_MEMORY_READ_HOOK=1 mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 7 kill-switch" || { echo "FAIL: 7 (out: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((7 - FAIL))/7 passed"; exit 1
fi
echo "Tests: 7/7 passed"
```

Make executable:

```bash
chmod +x tests/hooks/memory-read-check.test.sh
```

- [ ] **Step 2: Run test — verify 7/7 passing**

Run: `bash tests/hooks/memory-read-check.test.sh`
Expected: `Tests: 7/7 passed`

- [ ] **Step 3: Commit**

```bash
git add hooks/memory-read-check.sh tests/hooks/memory-read-check.test.sh
git commit -m "feat(hooks): add memory-read-check hook (fail-open transcript parsing, 7 cases)"
```

---

### Task 25: Write hooks/sandbox-disposal-check.sh + tests (TDD)

**Files:**
- Create: `hooks/sandbox-disposal-check.sh`
- Create: `tests/hooks/sandbox-disposal.test.sh`

- [ ] **Step 1: Write `hooks/sandbox-disposal-check.sh`**

```bash
#!/usr/bin/env bash
# sandbox-disposal-check.sh — Stop hook. Advisory only.
# Warns if tmp.XXXXXX-style mkdtemp directories were created this session.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" || exit 0

hook_kill_switch SANDBOX_DISPOSAL || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SESSION_REF="$STATE_DIR/session-start.ref"

# Establish session reference if not present
if [[ ! -f "$SESSION_REF" ]]; then
  touch "$SESSION_REF"
  exit 0
fi

# Scan locations for fresh tmp.XXXXXX-style dirs
FOUND=""
for loc in "/tmp" "$HOME/.claude/tmp"; do
  [[ -d "$loc" ]] || continue
  while IFS= read -r path; do
    base=$(basename "$path")
    if [[ "$base" =~ ^tmp\. ]] || [[ "$base" =~ claudemd- ]]; then
      FOUND+="$path"$'\n'
    fi
  done < <(platform_find_newer "$loc" "$SESSION_REF" 2>/dev/null | head -n 50)
done

if [[ -n "$FOUND" ]]; then
  COUNT=$(echo "$FOUND" | grep -c .)
  echo "[claudemd] §8.V4 sandbox disposal: $COUNT fresh temp directories this session." >&2
  echo "$FOUND" | head -n 5 | sed 's/^/  - /' >&2
  hook_record sandbox-disposal warn "{\"count\":$COUNT}"
fi

# Refresh session reference for next run
touch "$SESSION_REF"
exit 0
```

Make executable:

```bash
chmod +x hooks/sandbox-disposal-check.sh
```

- [ ] **Step 2: Write `tests/hooks/sandbox-disposal.test.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/sandbox-disposal-check.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/.claudemd-state" "$HOME/.claude/tmp" "$HOME/.claude/logs"

FAIL=0

# Case 1: first run (no session-start.ref) → creates ref + silent
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" && -f "$HOME/.claude/.claudemd-state/session-start.ref" ]] \
  && echo "PASS: 1 first run silent + ref created" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 2: no fresh tmp dirs since ref → silent
sleep 1
touch "$HOME/.claude/.claudemd-state/session-start.ref"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 2 no residue silent" || { echo "FAIL: 2 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: fresh tmp.XXXXXX created → warn
sleep 1
mkdir -p "$HOME/.claude/tmp/tmp.abc123"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
echo "$STDERR" | grep -q "sandbox disposal" && echo "PASS: 3 warn on mkdtemp residue" \
  || { echo "FAIL: 3 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 4: kill-switch
STDERR=$(DISABLE_SANDBOX_DISPOSAL_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 4 kill-switch" || { echo "FAIL: 4"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((4 - FAIL))/4 passed"; exit 1
fi
echo "Tests: 4/4 passed"
```

Make executable:

```bash
chmod +x tests/hooks/sandbox-disposal.test.sh
```

- [ ] **Step 3: Run test — verify 4/4 passing**

Run: `bash tests/hooks/sandbox-disposal.test.sh`
Expected: `Tests: 4/4 passed`

- [ ] **Step 4: Commit**

```bash
git add hooks/sandbox-disposal-check.sh tests/hooks/sandbox-disposal.test.sh
git commit -m "feat(hooks): add sandbox-disposal-check Stop hook (4 cases, cross-platform)"
```

---

### Task 26: Verify all 5 hooks wired and regression-green

**Files:** (no new files)

- [ ] **Step 1: Run full test suite**

Run: `bash tests/run-all.sh`
Expected: `OVERALL: all suites passed`

- [ ] **Step 2: Re-run install integration end-to-end**

Run: `bash tests/integration/full-lifecycle.test.sh`
Expected: `full-lifecycle: PASS`

- [ ] **Step 3: If any red, investigate and fix before proceeding to M6**

---

**M5 exit criteria:**
- [ ] `hooks/lib/platform.sh` with 3/3 test pass
- [ ] `hooks/memory-read-check.sh` with 7/7 test pass
- [ ] `hooks/sandbox-disposal-check.sh` with 4/4 test pass
- [ ] Full test suite green
- [ ] Integration test green

---

## M6 — Commands + spec v6.9.2

**Goal:** 5 slash-command markdown stubs + 4 new Node.js scripts (status/audit/toggle/doctor) + spec v6.9.2 content (§0.1 meta-rule + §2.3 TOOLS + 4 section moves + §5 dedup + §2.1 additions + §11 tag syntax) + changelog append + structural tests.

**Duration:** ~1.5d (10 tasks)

**Depends on:** M1-M5 (all hooks, all lib scripts)

---

### Task 27: Write scripts/status.js + commands/claudemd-status.md (TDD)

**Files:**
- Create: `scripts/status.js`
- Create: `commands/claudemd-status.md`
- Test: `tests/scripts/status.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/status.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { status } from '../../scripts/status.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-st-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), JSON.stringify({
    version: '0.1.0', entries: [
      { event: 'PreToolUse', command: 'bash /pkg/hooks/banned-vocab-check.sh', sha256: 'x' }
    ],
  }));
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), '# core\nVersion: 6.9.2\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('status reports plugin version + installed spec version', async () => {
  const r = await status();
  assert.equal(r.plugin.version, '0.1.0');
  assert.equal(r.spec.installed, '6.9.2');
});

test('status reports kill-switch state', async () => {
  const saved = process.env.DISABLE_CLAUDEMD_HOOKS;
  process.env.DISABLE_CLAUDEMD_HOOKS = '1';
  try {
    const r = await status();
    assert.equal(r.killSwitches.plugin, true);
  } finally {
    if (saved === undefined) delete process.env.DISABLE_CLAUDEMD_HOOKS;
    else process.env.DISABLE_CLAUDEMD_HOOKS = saved;
  }
});

test('status reports not-installed when manifest missing', async () => {
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  const r = await status();
  assert.equal(r.plugin.installed, false);
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `node --test tests/scripts/status.test.js`
Expected: module-not-found

- [ ] **Step 3: Write `scripts/status.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, logsDir, backupRoot } from './lib/paths.js';

const HOOK_NAMES = ['BANNED_VOCAB','SHIP_BASELINE','RESIDUE_AUDIT','MEMORY_READ','SANDBOX_DISPOSAL'];

export async function status() {
  const manifestPath = path.join(stateDir(), 'installed.json');
  const installed = fs.existsSync(manifestPath);
  let plugin = { installed: false };
  if (installed) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    plugin = { installed: true, version: m.version, entries: m.entries.length };
  }

  const coreSpec = path.join(backupRoot(), 'CLAUDE.md');
  const specVersion = fs.existsSync(coreSpec)
    ? (fs.readFileSync(coreSpec, 'utf8').match(/^Version:\s*(\S+)/m) || [,''])[1]
    : '';

  const killSwitches = { plugin: process.env.DISABLE_CLAUDEMD_HOOKS === '1' };
  for (const name of HOOK_NAMES) {
    killSwitches[name.toLowerCase()] = process.env[`DISABLE_${name}_HOOK`] === '1';
  }

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;

  return { plugin, spec: { installed: specVersion }, killSwitches, log: { lines: logLines } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  status().then(r => console.log(JSON.stringify(r, null, 2)));
}
```

- [ ] **Step 4: Run test — 3/3 passing**

Run: `node --test tests/scripts/status.test.js`
Expected: all 3 pass

- [ ] **Step 5: Write `commands/claudemd-status.md`**

```bash
mkdir -p commands
```

```markdown
---
name: claudemd-status
description: Show claudemd plugin version, installed spec version, kill-switch state, and rule-hits summary.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js`

Surface the JSON output as a human-readable summary. If the `plugin.installed` field is false, suggest `/plugin install claudemd@claudemd` to the user.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/status.js commands/claudemd-status.md tests/scripts/status.test.js
git commit -m "feat(commands): add /claudemd-status command + status.js script"
```

---

### Task 28: Write scripts/audit.js + commands/claudemd-audit.md (TDD)

**Files:**
- Create: `scripts/audit.js`
- Create: `scripts/lib/rule-hits-parse.js`
- Create: `commands/claudemd-audit.md`
- Test: `tests/scripts/audit.test.js`

- [ ] **Step 1: Write `scripts/lib/rule-hits-parse.js`**

```javascript
import fs from 'node:fs';

export function readHits(path, daysBack = 30) {
  if (!fs.existsSync(path)) return [];
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const hits = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (new Date(row.ts).getTime() >= cutoff) hits.push(row);
    } catch { /* skip malformed */ }
  }
  return hits;
}

export function groupByHook(hits) {
  const byHook = {};
  for (const h of hits) {
    byHook[h.hook] ||= { total: 0, byEvent: {} };
    byHook[h.hook].total++;
    byHook[h.hook].byEvent[h.event] = (byHook[h.hook].byEvent[h.event] || 0) + 1;
  }
  return byHook;
}

export function topPatterns(hits, hook = 'banned-vocab') {
  const counts = {};
  for (const h of hits) {
    if (h.hook !== hook || !h.extra?.matched) continue;
    for (const m of h.extra.matched) counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
```

- [ ] **Step 2: Write failing test `tests/scripts/audit.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { audit } from '../../scripts/audit.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-au-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":{"matched":["70% faster"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","extra":null}\n`
  );
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('audit aggregates by hook', async () => {
  const r = await audit({ days: 30 });
  assert.equal(r.byHook['banned-vocab'].total, 2);
  assert.equal(r.byHook['ship-baseline'].total, 1);
});

test('audit top patterns for banned-vocab', async () => {
  const r = await audit({ days: 30 });
  assert.ok(r.topPatterns.length >= 2);
  const names = r.topPatterns.map(([name]) => name);
  assert.ok(names.includes('significantly'));
});
```

- [ ] **Step 3: Write `scripts/audit.js`**

```javascript
import path from 'node:path';
import { logsDir } from './lib/paths.js';
import { readHits, groupByHook, topPatterns } from './lib/rule-hits-parse.js';

export async function audit({ days = 30 } = {}) {
  const log = path.join(logsDir(), 'claudemd.jsonl');
  const hits = readHits(log, days);
  return {
    windowDays: days,
    totalHits: hits.length,
    byHook: groupByHook(hits),
    topPatterns: topPatterns(hits, 'banned-vocab'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = parseInt(process.env.CLAUDEMD_AUDIT_DAYS || '30', 10);
  audit({ days }).then(r => console.log(JSON.stringify(r, null, 2)));
}
```

- [ ] **Step 4: Run test — 2/2 passing**

Run: `node --test tests/scripts/audit.test.js`
Expected: 2/2

- [ ] **Step 5: Write `commands/claudemd-audit.md`**

```markdown
---
name: claudemd-audit
description: Aggregate claudemd rule-hits over the last N days. Shows top banned patterns, hook deny counts, and residue warnings.
---

Default window is 30 days. If the user passes a number (e.g. `/claudemd-audit 90`), set `CLAUDEMD_AUDIT_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_AUDIT_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.js`

Format the JSON into per-hook sections with the top banned-vocab patterns table.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/audit.js scripts/lib/rule-hits-parse.js commands/claudemd-audit.md tests/scripts/audit.test.js
git commit -m "feat(commands): add /claudemd-audit + rule-hits-parse.js (by-hook + top-patterns)"
```

---

### Task 29: Write scripts/toggle.js + commands/claudemd-toggle.md (TDD)

**Files:**
- Create: `scripts/toggle.js`
- Create: `commands/claudemd-toggle.md`
- Test: `tests/scripts/toggle.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/toggle.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { toggle } from '../../scripts/toggle.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-tg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({ env: {} }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('toggle enables banned-vocab kill-switch', async () => {
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.env.DISABLE_BANNED_VOCAB_HOOK, '1');
  assert.equal(r.newState, 'disabled');
});

test('toggle re-enables banned-vocab (clears kill-switch)', async () => {
  await toggle('banned-vocab');
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.ok(!s.env.DISABLE_BANNED_VOCAB_HOOK);
  assert.equal(r.newState, 'enabled');
});

test('toggle unknown name → error', async () => {
  await assert.rejects(() => toggle('not-a-hook'), /unknown hook/i);
});
```

- [ ] **Step 2: Write `scripts/toggle.js`**

```javascript
import { readSettings, writeSettings } from './lib/settings-merge.js';

const NAME_MAP = {
  'banned-vocab': 'BANNED_VOCAB',
  'ship-baseline': 'SHIP_BASELINE',
  'residue-audit': 'RESIDUE_AUDIT',
  'memory-read-check': 'MEMORY_READ',
  'sandbox-disposal-check': 'SANDBOX_DISPOSAL',
};

export async function toggle(name) {
  const upper = NAME_MAP[name];
  if (!upper) throw new Error(`unknown hook: ${name}`);
  const key = `DISABLE_${upper}_HOOK`;
  const s = readSettings();
  s.env ||= {};
  let newState;
  if (s.env[key] === '1') {
    delete s.env[key];
    newState = 'enabled';
  } else {
    s.env[key] = '1';
    newState = 'disabled';
  }
  writeSettings(s);
  return { hook: name, newState };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  toggle(name).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
```

- [ ] **Step 3: Run test — 3/3 passing**

Run: `node --test tests/scripts/toggle.test.js`
Expected: 3/3

- [ ] **Step 4: Write `commands/claudemd-toggle.md`**

```markdown
---
name: claudemd-toggle
description: Enable or disable a specific claudemd hook (stored as DISABLE_*_HOOK in settings.json env).
---

Usage: `/claudemd-toggle <hook-name>`

Valid hook names: `banned-vocab`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal-check`.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js $ARGS`

Surface the new state (`enabled` or `disabled`) to the user.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/toggle.js commands/claudemd-toggle.md tests/scripts/toggle.test.js
git commit -m "feat(commands): add /claudemd-toggle + toggle.js (env-var flip in settings.json)"
```

---

### Task 30: Write scripts/doctor.js + commands/claudemd-doctor.md (TDD)

**Files:**
- Create: `scripts/doctor.js`
- Create: `commands/claudemd-doctor.md`
- Test: `tests/scripts/doctor.test.js`

- [ ] **Step 1: Write failing test `tests/scripts/doctor.test.js`**

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctor } from '../../scripts/doctor.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), JSON.stringify({
    version: '0.1.0', entries: []
  }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('doctor returns checks array with at least 5 entries', async () => {
  const r = await doctor({});
  assert.ok(Array.isArray(r.checks));
  assert.ok(r.checks.length >= 5);
});

test('doctor --prune-backups removes old backups', async () => {
  for (const iso of ['20260101T000000Z','20260201T000000Z','20260301T000000Z',
                     '20260401T000000Z','20260501T000000Z','20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const r = await doctor({ pruneBackups: 3 });
  assert.equal(r.pruned.length, 3);
});
```

- [ ] **Step 2: Write `scripts/doctor.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, logsDir, backupRoot, settingsPath, specHome } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';

export async function doctor({ pruneBackups: prune } = {}) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1. installed manifest
  const manifestPath = path.join(stateDir(), 'installed.json');
  push('manifest', fs.existsSync(manifestPath),
    fs.existsSync(manifestPath) ? 'present' : 'missing — is plugin installed?');

  // 2. settings.json
  if (fs.existsSync(settingsPath())) {
    try { readSettings(); push('settings.json', true, 'parseable'); }
    catch (e) { push('settings.json', false, e.message); }
  } else {
    push('settings.json', false, 'missing');
  }

  // 3. spec files
  for (const p of specHome()) {
    push(`spec:${path.basename(p)}`, fs.existsSync(p),
      fs.existsSync(p) ? 'present' : 'missing');
  }

  // 4. jq + gh presence via `which`
  const which = (bin) => {
    try {
      const { execSync } = require('node:child_process');
      execSync(`command -v ${bin}`, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  };
  push('jq', which('jq'), which('jq') ? 'present' : 'missing (required at runtime)');
  push('gh', which('gh'), which('gh') ? 'present' : 'missing (ship-baseline will fail-open silent)');

  // 5. backup inventory
  const backups = listBackups();
  push('backups', true, `${backups.length} backup dir(s)`);

  // 6. logs
  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  push('logs', true, `${logLines} rule-hits row(s)`);

  // Prune if requested
  const pruned = prune != null ? pruneBackups(prune) : [];

  return { checks, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const pruneArg = args.find(a => a.startsWith('--prune-backups='));
  const prune = pruneArg ? parseInt(pruneArg.split('=')[1], 10) : undefined;
  doctor({ pruneBackups: prune }).then(r => console.log(JSON.stringify(r, null, 2)));
}
```

NOTE: replace `require('node:child_process')` with ESM-style `import { execSync } from 'node:child_process'` at top if the test framework flags CommonJS usage.

- [ ] **Step 3: Update imports at top of doctor.js**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { stateDir, logsDir, backupRoot, settingsPath, specHome } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';
```

And change the `which` helper to use the imported `execSync` directly:

```javascript
  const which = (bin) => {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
```

- [ ] **Step 4: Run test — 2/2 passing**

Run: `node --test tests/scripts/doctor.test.js`
Expected: 2/2

- [ ] **Step 5: Write `commands/claudemd-doctor.md`**

```markdown
---
name: claudemd-doctor
description: Run health checks on claudemd installation. Flags missing deps, spec drift, settings.json issues, backup inventory. Supports --prune-backups=N.
---

Usage: `/claudemd-doctor` or `/claudemd-doctor --prune-backups=5`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js $ARGS`

Surface the checks list with [✓] / [△] / [✗] prefixes based on the `ok` field. If `pruned` is non-empty, list the removed backup directories.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/doctor.js commands/claudemd-doctor.md tests/scripts/doctor.test.js
git commit -m "feat(commands): add /claudemd-doctor + doctor.js (health checks + --prune-backups)"
```

---

### Task 31: Write commands/claudemd-update.md

**Files:**
- Create: `commands/claudemd-update.md`

- [ ] **Step 1: Write `commands/claudemd-update.md`**

```markdown
---
name: claudemd-update
description: Sync ~/.claude/CLAUDE*.md with the plugin-cache shipped spec. Shows diff summary; user chooses apply-all / select / cancel.
---

Usage: `/claudemd-update`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js` (dry-run summary first).

If the user says apply, re-run with `choice=apply-all` via `CLAUDEMD_UPDATE_CHOICE=apply-all node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js`. Backup is automatic (retained to 5). Do not fetch from GitHub — `/plugin update claudemd` is a separate step.
```

- [ ] **Step 2: Extend `scripts/update.js` to honor `CLAUDEMD_UPDATE_CHOICE` env var in CLI entry**

Replace the bottom block:

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const choice = process.env.CLAUDEMD_UPDATE_CHOICE || 'cancel';
  update({ pluginRoot, choice }).then(r => console.log(JSON.stringify(r, null, 2)));
}
```

- [ ] **Step 3: Re-run update.test.js to confirm no regression**

Run: `node --test tests/scripts/update.test.js`
Expected: still 3/3

- [ ] **Step 4: Commit**

```bash
git add commands/claudemd-update.md scripts/update.js
git commit -m "feat(commands): add /claudemd-update markdown + CLI env var wiring"
```

---

### Task 32: Write spec/CLAUDE.md v6.9.2 (add §0.1 + §2.3 + 4 moves + §5 dedup + §2.1 rows + §11 tag)

**Files:**
- Create: `spec/CLAUDE.md`

This is a text-heavy transformation of the current v6.9.0 core. The engineer should start from `~/.claude/CLAUDE.md` (or the copy in `docs/CLAUDE.md`) and apply the following diff. Each diff block shows exact location + change.

- [ ] **Step 1: Seed from current v6.9.0**

```bash
mkdir -p spec
cp ~/.claude/CLAUDE.md spec/CLAUDE.md
```

- [ ] **Step 2: Update the version header line**

Replace `Version: 6.9.0` with `Version: 6.9.2` at the top of `spec/CLAUDE.md` (line ~3).

- [ ] **Step 3: Add §0.1 Core growth discipline after §0 SPINE**

Find the line beginning `## §1 IDENTITY` and insert ABOVE it:

```markdown
### §0.1 Core growth discipline (HARD)

New rule / new table row defaults to extended §X-EXT. Promote to core only after rule-hits data shows ≥5 sessions in 30d where the rule fires AND its elaboration wasn't consulted (= rule was self-sufficient). Quarterly `/claudemd-audit` recommends demotion for core entries with 0 hits in 90d.

```

- [ ] **Step 4: Replace §1.5 GLOSSARY full-definitions block with one-line index + pointer**

Find `## §1.5 GLOSSARY` section and REPLACE its entire body (the definition table) with:

```markdown
## §1.5 GLOSSARY

Defined terms: **LOC**, **Module**, **Local-Δ**, **Assumption**, **Contract**, **Evidence**, **Task**. Full definitions → `CLAUDE-extended.md §1.5-EXT`.

```

- [ ] **Step 5: Add §2.3 TOOLS immediately after §2.2 ROUTE**

Find the line `## §3 TRUST` and insert ABOVE it:

```markdown
### §2.3 TOOLS (orchestration hot-path)

Tool-selection routing. MCP-injected per-tool instructions are authoritative; this section covers cross-tool orchestration.

**Principles** (any tool mix):
1. Escalate cheap → expensive: Grep (exact) → semantic search (concepts) → AST/call-graph (structure).
2. Query shape decides first tool: target name known → Grep first; unknown / conceptual → semantic first.
3. Before Edit on public symbol: impact-analysis tool first (result feeds §5 AUTH).
4. Unfamiliar module: module-overview tool before Read-ing ≥3 of its files.
5. Cross-session questions ("did we / why / past decisions"): memory tool before Grep/Read.

**Plugin bindings** (when installed):
| Need | Tool |
|---|---|
| exact string / symbol / regex | Grep |
| concept / "code that does X" | `code-graph semantic_code_search` |
| who-calls / what-calls | `code-graph get_call_graph` |
| blast radius of change | `code-graph impact_analysis` |
| module layout | `code-graph module_overview` |
| past work / decisions | `mem_search <2-3 keywords>` |
| file history | `mem_recall <file>` |

**Anti-patterns**:
- Parallel-dispatching mem + code-graph on same question — start cheap, escalate on miss.
- Grepping for concepts / semantic-searching for literals — both waste tokens.
- Reading unknown module files one-by-one without overview first.

```

- [ ] **Step 6: Append three rows to §2.1 Skill soft-triggers table**

Find the §2.1 table (header row `| Trigger | Skill |`) and append these three data rows at the end (before the blank line that closes the table):

```
| large design / plugin design / architecture discussion | `sp:brainstorming` |
| ship / deploy / release | `gs:ship` |
| plan review (CEO / eng / design / devex dimensions) | `gs:plan-*-review` series |
```

- [ ] **Step 7: §5 Safe-paths dedup — remove the prefix description, keep pointer**

In §5 AUTH, find the paragraph that starts `### §5 Safe-paths whitelist` or similar and SHORTEN to a single reference line. Replace with:

```markdown
### §5 Safe-paths whitelist (delete → soft AUTH)

See `CLAUDE-extended.md §5-EXT` for prefix list, inclusion rules, and NEVER-covers set. Project `CLAUDE.md` MAY extend via `SAFE_DELETE_PATHS:` (additive only).

```

Delete any per-category bullet lists that currently live in core for safe-paths.

- [ ] **Step 8: §5.1 AUTONOMY_LEVEL — keep description + never-downgrade, move table**

In §5.1, REMOVE the three-row effect table (aggressive / default / careful). REPLACE with:

```markdown
### §5.1 AUTONOMY_LEVEL (opt-in project override)

Project `CLAUDE.md` MAY set `AUTONOMY_LEVEL: aggressive | default | careful`. Default = `default`. Per-level effects table → `CLAUDE-extended.md §5.1-EXT`.

**Never-downgrade** (override irrelevant): §8 SAFETY entries, Iron Law #2, Anti-hallucination, Destructive-smoke, Session-exit, User-global-state audit, `.env`/secrets, migration, auth/payment/crypto, `~/.claude/settings.json` / user-global hooks / MCP config, `L3 enter`.

Solo-dev + `bypassPermissions` workflow → consider `aggressive`. Team-shared / prod-touching repo → keep `default` or `careful`.

```

Keep the **Published client** paragraph where it is if it's directly under §5.1, OR move it to §5.1-EXT. Place here: move to extended.

- [ ] **Step 9: §7 TMP_RETENTION detail — shrink in core**

In §7, find `TMP_RETENTION_DAYS` and the surrounding retention paragraph. REPLACE with a single sentence:

```markdown
**`~/.claude/tmp/` retention**: harness may auto-purge stale entries; threshold guidance + project override → `CLAUDE-extended.md §7-EXT`.
```

- [ ] **Step 10: §11 auto-memory decision tree — keep three triggers, move full tree**

In §11, find the `**Auto-memory decision tree**` numbered block (1. Global-state hard trigger, 2. L2+ retrospective trigger, 3. Judgment test) and REPLACE with:

```markdown
- **Auto-memory triggers** (top-down; first match wins; full decision tree → `CLAUDE-extended.md §11-EXT`):
  1. **Global-state hard trigger** (MUST any level): ~/.claude/ global writes across ≥2 files in one task → save project/feedback memory unless self-describing artifact exempts.
  2. **L2+ retrospective trigger** (MUST at L2+): preventable-error pattern OR non-default decision / non-obvious sequencing.
  3. **Judgment test** (L0/L1 and L2+ fallback): durable artifact whose insight would have changed a decision this session AND has ≥1 future-reuse probability.
  Always skip: `git log`-recoverable content, code invariant, session-local state, clean-root-cause bugfix.
```

- [ ] **Step 11: §11 MEMORY.md tag syntax addition**

In §11, find the `MEMORY.md` mention near "`MEMORY.md` is always loaded into your conversation context". Insert a new paragraph after it:

```markdown
**Index line tag syntax** (optional, backward-compatible): `- [Title](file.md) `[tag1, tag2]` — description`. When present, agent matches current task keywords against tags in SPINE step 1 and Reads only files whose tags overlap. Ungaged lines fall back to full-scan behavior.
```

- [ ] **Step 12: Verify core token count ≤ 5,500**

```bash
wc -w spec/CLAUDE.md
```

Estimate tokens ≈ words × 1.3. Confirm under 5,500.

If over 5,500: identify an additional ~500-token section to trim (likely elaborate prose in §5 or §11) and move to extended, per §0.1 Core growth discipline.

- [ ] **Step 13: Commit**

```bash
git add spec/CLAUDE.md
git commit -m "feat(spec): CLAUDE.md v6.9.2 (add §0.1 + §2.3; move §1.5/§5.1/§7/§11 detail; §5 dedup; §2.1 +3 rows)"
```

---

### Task 33: Write spec/CLAUDE-extended.md with new §X-EXT sections

**Files:**
- Create: `spec/CLAUDE-extended.md`

- [ ] **Step 1: Seed from current extended**

```bash
cp ~/.claude/CLAUDE-extended.md spec/CLAUDE-extended.md
```

- [ ] **Step 2: Add §1.5-EXT after §1's extended content (or at end of section 1)**

Locate a natural insertion point in the extended file's table of contents flow. Append after existing §1-related content:

```markdown
## §1.5-EXT GLOSSARY (full definitions)

| Term | Definition |
|---|---|
| **LOC** | additions + deletions per `git diff --stat`, excluding blank/comment-only lines. |
| **Module** | single-package repo: each `src/<subdir>/` is a Module. Monorepo: each workspace/package root is a Module. Sub-folders inside a Module are NOT separate modules. |
| **Local-Δ** | ≤2 files (source + its co-located test counts as one; co-located = test path mirrors source path). No exported-symbol change, no import-surface change, no config/schema touch. |
| **Assumption** | claim not verified this turn via Read/Grep/tool. Memory recall = assumption. |
| **Contract** | interface visible to external callers: signature, return/error type, API shape, status code, CLI flag, config key, I/O schema, security semantics. |
| **Evidence** | tool-call output showing specific behavior. *Fresh* = same turn or re-run after last change. |
| **Task** | one SPINE cycle. New user request = new task unless explicit continuation. |

```

- [ ] **Step 3: Add §5.1-EXT with the three-row AUTONOMY_LEVEL effects table**

```markdown
## §5.1-EXT AUTONOMY_LEVEL effects (full table)

| Level | Effect on §5 table |
|---|---|
| `aggressive` | `cross-module refactor (≥3 Modules)` → soft; `Δ-contract public API` → soft when consumer is internal-only; `delete in safe-paths` → no surface-required; `deps dev-only` → none |
| `default` | §5 table as written, unchanged |
| `careful` | `deps dev-only` → hard; `cross-module ≥2 Modules` → hard; `L2 local single module` → soft (surface diff inline first) |

**Published client** (binds `aggressive` Δ-contract judgment): any consumer outside this repo — external SDK user, npm-install consumer, MCP client (incl. Claude Code reading a server's tool schema), CLI end-user via `npx` / `cargo install` / release binary. **Internal** = same-repo module-to-module only. Uncertainty → treat as published (hard).

```

- [ ] **Step 4: Add §7-EXT with TMP_RETENTION detail**

```markdown
## §7-EXT TMP_RETENTION policy

**`~/.claude/tmp/` retention**: harness SHOULD purge `mtime > 7d` at SessionStart (tool-exhaust, not WIP). Residue check ≥100 stale (>7d) + unconfigured harness → surface recommendation inline; no auto-clean without AUTH. Override: project `CLAUDE.md` `TMP_RETENTION_DAYS: 30`.

```

- [ ] **Step 5: Add §11-EXT with the full auto-memory decision tree**

```markdown
## §11-EXT Auto-memory decision tree (full)

Evaluate top-down; first match wins:

**Step 1: Global-state hard trigger** (MUST any level, skip judgment):
`~/.claude/` global-state writes across ≥2 files in one task (plugin install/uninstall / settings migration / marketplace edits / statusline chain swaps / hook registration / MCP config) → save `project`/`feedback` memory naming what + why.

**Exemption (self-describing artifact)**: edit produces durable in-artifact "what + why" a future session can grep without loading memory (versioned spec with `## Recent changes` / `CHANGELOG.md` / migration comment) → trigger satisfied, skip `mem_save`. Test: can rationale be recovered from the artifact alone? Opaque state (plugin install / marketplace JSON / hook registration / MCP config) fails this test → still save.

**Step 2: L2+ retrospective trigger** (MUST at L2+, overrides Step 3):
one of —
- (a) preventable-error pattern (>2 wasted tool iterations OR hypothesis falsified by DB/grep/tool in a reusable way)
- (b) non-default decision or non-obvious sequencing (spec-skill conflict resolved with non-default tradeoff, OR ship/release/env step not derivable from docs)

Body: `[context]` + `[what to do differently]` + `[trigger words]`. ≤8 lines.

**Step 3: Judgment test** (L0/L1, and L2+ when Steps 1-2 miss):
durable project artifact (overview / phase / plan / next-step / recommendation / retrospective / completion) whose insight would have changed a decision this session if known upfront AND has ≥1 future-reuse probability → save; else skip.

**Always skip regardless of step**:
`git log`-recoverable content, code invariant (→ inline comment), session-local state (→ `tasks/`), clean-root-cause bug (→ `mem_save` bugfix type, not this tree).

After any `memory/*.md` write: refresh `MEMORY.md` index line.

```

- [ ] **Step 6: Commit**

```bash
git add spec/CLAUDE-extended.md
git commit -m "feat(spec): CLAUDE-extended.md with §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT"
```

---

### Task 34: Append v6.9.2 entry to spec/CLAUDE-changelog.md

**Files:**
- Create: `spec/CLAUDE-changelog.md`

- [ ] **Step 1: Seed from current changelog**

```bash
cp ~/.claude/CLAUDE-changelog.md spec/CLAUDE-changelog.md
```

- [ ] **Step 2: Prepend v6.9.2 entry at the top (above v6.9.0 section)**

Insert at the top, under the file header:

```markdown
## v6.9.2 — 2026-04-21

**Core size**: ~6,200 → ~5,330 tokens (−14%). Policy lives in new §0.1 to prevent re-accrual.

- `[add]` §0.1 Core growth discipline (HARD) — defaults new rules to extended; rule-hits data drives promotion/demotion.
- `[add]` §2.3 TOOLS (~21 lines) — cross-tool orchestration: Grep / semantic / call-graph / impact / memory routing with plugin bindings.
- `[add]` §2.1 three skill rows: `sp:brainstorming` for large design, `gs:ship`, `gs:plan-*-review` series.
- `[move]` §1.5 GLOSSARY definitions → §1.5-EXT (core keeps index).
- `[move]` §5.1 AUTONOMY_LEVEL effect table → §5.1-EXT (core keeps description + never-downgrade list).
- `[move]` §7 TMP_RETENTION detail → §7-EXT.
- `[move]` §11 auto-memory decision tree → §11-EXT (core keeps three triggers).
- `[dedup]` §5 Safe-paths prefix list — core references existing §5-EXT; duplicate description removed.
- `[tweak]` §11 MEMORY.md index line gains optional `[tag]` suffix. Ungaged lines fall back to full-scan.

```

- [ ] **Step 3: Commit**

```bash
git add spec/CLAUDE-changelog.md
git commit -m "feat(spec): append v6.9.2 changelog entry (core reduction, §0.1, §2.3, moves)"
```

---

### Task 35: Write spec structural tests (A13/A14/A15 verification)

**Files:**
- Create: `tests/scripts/spec-structure.test.js`

- [ ] **Step 1: Write `tests/scripts/spec-structure.test.js`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'spec/CLAUDE.md';
const EXT  = 'spec/CLAUDE-extended.md';
const CL   = 'spec/CLAUDE-changelog.md';

// Rough token estimator: 1 word ≈ 1.3 tokens (English/markdown heuristic).
function estTokens(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

test('A13: core CLAUDE.md ≤ 5,500 tokens', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  const tokens = estTokens(text);
  assert.ok(tokens <= 5500, `core tokens = ${tokens}, expected ≤ 5500`);
});

test('A14: extended contains §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT anchors', () => {
  const text = fs.readFileSync(EXT, 'utf8');
  for (const anchor of ['§1.5-EXT', '§5.1-EXT', '§7-EXT', '§11-EXT']) {
    assert.ok(text.includes(anchor), `missing ${anchor} in extended`);
  }
});

test('A14: core CLAUDE.md references §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  for (const anchor of ['§1.5-EXT', '§5.1-EXT', '§7-EXT', '§11-EXT']) {
    assert.ok(text.includes(anchor), `core missing pointer to ${anchor}`);
  }
});

test('A15: MEMORY.md tag syntax described in §11', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /MEMORY\.md/);
  assert.match(text, /Index line tag syntax/i);
  assert.match(text, /\[tag1, tag2\]/);
});

test('core contains new §0.1 + §2.3', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.ok(text.includes('§0.1 Core growth discipline'));
  assert.ok(text.includes('§2.3 TOOLS'));
});

test('core version header is v6.9.2', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  const m = text.match(/Version:\s*(\S+)/);
  assert.ok(m);
  assert.equal(m[1], '6.9.2');
});

test('changelog top entry is v6.9.2', () => {
  const text = fs.readFileSync(CL, 'utf8');
  const first = text.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  assert.ok(first);
  assert.equal(first[1], '6.9.2');
});

test('§2.1 table contains sp:brainstorming row', () => {
  const text = fs.readFileSync(CORE, 'utf8');
  assert.match(text, /sp:brainstorming/);
});
```

- [ ] **Step 2: Run test — verify all pass**

Run: `node --test tests/scripts/spec-structure.test.js`
Expected: 8/8

If A13 fails (core > 5,500 tokens), return to Task 32 and trim additional content to §X-EXT.

- [ ] **Step 3: Commit**

```bash
git add tests/scripts/spec-structure.test.js
git commit -m "test(spec): A13/A14/A15 structural tests for v6.9.2 core reduction"
```

---

### Task 36: Re-run integration suite end-to-end

**Files:** (no new files)

- [ ] **Step 1: Run full suite**

Run: `bash tests/run-all.sh`
Expected: `OVERALL: all suites passed`

- [ ] **Step 2: Run integration on fresh temp HOME**

Run: `bash tests/integration/full-lifecycle.test.sh`
Expected: `full-lifecycle: PASS`

- [ ] **Step 3: If any red, investigate + fix before M7**

---

**M6 exit criteria:**
- [ ] All 5 commands in `commands/` + 4 new scripts (`status`, `audit`, `toggle`, `doctor`) + `rule-hits-parse.js`
- [ ] `spec/CLAUDE.md` v6.9.2 with §0.1 + §2.3 + §2.1 rows + §11 tag syntax; ≤ 5,500 tokens
- [ ] `spec/CLAUDE-extended.md` with §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT
- [ ] `spec/CLAUDE-changelog.md` with v6.9.2 entry
- [ ] `tests/scripts/spec-structure.test.js` 8/8
- [ ] All integration + hook + script tests green

---

## M7 — Docs + release

**Goal:** Write 4 reference docs, README with 30-sec bootstrap, plugin CHANGELOG.md first entry, then tag v0.1.0.

**Duration:** ~0.5d (4 tasks)

**Depends on:** M1–M6

---

### Task 37: Write README.md with 30-sec bootstrap

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# claudemd

Enforce AI-CODING-SPEC v6.9 HARD rules via Claude Code hooks + ship the spec as part of the plugin.

## What it is

`claudemd` is a Claude Code plugin that installs:
- 5 hooks that block spec violations (banned vocab in commits, pushing to red CI, forgetting to read MEMORY.md entries, tmp-dir residue leaks, mkdtemp disposal)
- 5 slash commands (`/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`)
- AI-CODING-SPEC v6.9.2 (core + extended + changelog) into `~/.claude/`

On install, if you already have `~/.claude/CLAUDE.md`, your existing files are moved to `~/.claude/backup-<ISO>/` before the plugin version is written. Restore anytime via `/plugin uninstall claudemd` → `[r]estore`.

## 30-second install

```bash
# 1. Register this marketplace in ~/.claude/settings.json (one-time).
#    If you don't have a settings.json yet, this creates a minimal one.
jq '.extraKnownMarketplaces = (.extraKnownMarketplaces // {}) + {
  "claudemd": {"source": {"source": "github", "repo": "<user>/claudemd"}}
}' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json

# 2. In Claude Code:
/plugin install claudemd@claudemd
```

Then verify:

```
/claudemd-status
/claudemd-doctor
```

## Kill-switches

Three tiers. All visible in `/claudemd-status`.

- `DISABLE_CLAUDEMD_HOOKS=1` — plugin-wide.
- `DISABLE_BANNED_VOCAB_HOOK=1` / `DISABLE_SHIP_BASELINE_HOOK=1` / `DISABLE_RESIDUE_AUDIT_HOOK=1` / `DISABLE_MEMORY_READ_HOOK=1` / `DISABLE_SANDBOX_DISPOSAL_HOOK=1` — per-hook.
- Per-invocation escapes: `[allow-banned-vocab]` in commit message; `known-red baseline: <reason>` in commit body; `[skip-memory-check]` in bash command.

## Uninstall

`/plugin uninstall claudemd` prompts for spec disposition (keep / delete / restore). Delete requires an extra confirmation because `~/.claude/CLAUDE.md` may contain your local unsynced edits.

## License

MIT. See LICENSE.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with 30-sec bootstrap + kill-switch + uninstall overview"
```

---

### Task 38: Write docs/ARCHITECTURE.md and docs/HOOK-PROTOCOL.md

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/HOOK-PROTOCOL.md`

- [ ] **Step 1: Write `docs/ARCHITECTURE.md`**

```markdown
# Architecture

For full design rationale, see `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md`. This file is the post-implementation reference.

## Three layers

1. **L1 Hooks** (`hooks/*.sh`) — deterministic shell, <3s nominal, fail-open on any internal error. Invoked directly by Claude Code.
2. **L2 Management scripts** (`scripts/*.js`) — Node.js 20, handle install/uninstall/update/status/audit/toggle/doctor. Share a `scripts/lib/` module set.
3. **L3 Slash commands** (`commands/*.md`) — markdown stubs that tell the agent which L2 script to invoke.

L1 never imports L2. A broken plugin install leaves hooks functional (or fail-open). Broken hooks leave commands functional.

## Invariants

- **Append-only on settings.json**: install/update never delete or reorder other-plugin entries.
- **Spec is artifact, not code**: hooks do not Read `~/.claude/CLAUDE.md` at runtime.
- **`${CLAUDE_PLUGIN_ROOT}` is a hint**: scripts derive their own base path from `__dirname` / `${BASH_SOURCE[0]}` (cross-version safe).

## Data flow

```
User action / session end
  └─> Claude Code harness
      └─> settings.json hook entries
          └─> bash hooks/<name>.sh   (exit 0 silent, or deny JSON)
                └─> hook_record → ~/.claude/logs/claudemd.jsonl (audit trail)
```

## State locations

- `~/.claude/.claudemd-state/installed.json` — manifest of injected entries (command string + SHA256)
- `~/.claude/.claudemd-state/tmp-baseline.txt` — residue-audit last end-of-session count
- `~/.claude/.claudemd-state/session-start.ref` — sandbox-disposal session reference timestamp
- `~/.claude/logs/claudemd.jsonl` — rule-hits append log
- `~/.claude/backup-<ISO>/` — spec backups (last 5 retained)
```

- [ ] **Step 2: Write `docs/HOOK-PROTOCOL.md`**

```markdown
# Claude Code hook I/O protocol reference

## PreToolUse event envelope (stdin)

```json
{
  "session_id": "<uuid>",
  "tool_name": "Bash",
  "tool_input": { "command": "git commit -m ..." },
  "cwd": "/path/to/project"
}
```

Other tools have different `tool_input` shapes:
- `Edit`: `{"file_path": "...", "old_string": "...", "new_string": "..."}`
- `Write`: `{"file_path": "...", "content": "..."}`
- `Stop`: minimal, mostly `{"session_id": "..."}`

## Deny output (stdout)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "<multi-line human-readable>"
  }
}
```

## Exit codes

- `0` with no stdout → pass silent
- `0` with stdout JSON → decision honored
- `2` with stderr → legacy deny path (avoid)
- Anything else → undefined (treated as bug); always prefer exit 0.

## Stop hooks cannot block

The Stop event does not respect `permissionDecision: "deny"`. Hooks on Stop are advisory — write to `stderr` (shown to user) + record via `hook_record`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/HOOK-PROTOCOL.md
git commit -m "docs: ARCHITECTURE.md + HOOK-PROTOCOL.md post-impl references"
```

---

### Task 39: Write docs/ADDING-NEW-HOOK.md and docs/RULE-HITS-SCHEMA.md

**Files:**
- Create: `docs/ADDING-NEW-HOOK.md`
- Create: `docs/RULE-HITS-SCHEMA.md`

- [ ] **Step 1: Write `docs/ADDING-NEW-HOOK.md`**

```markdown
# Adding a new hook to claudemd

This guide walks adding a 6th hook from zero. Example: `foo-check.sh` that denies a hypothetical condition.

## 1. Write the hook script

Create `hooks/foo-check.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch FOO || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""')
[[ "$TOOL" == "Bash" ]] || exit 0

CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""')
# ... decide if deny, then:

# hook_record foo deny null
# hook_deny foo "reason text"
exit 0
```

`chmod +x hooks/foo-check.sh`.

## 2. Write its test

Create `tests/hooks/foo.test.sh` with at least:
1. Happy pass
2. Happy deny
3. Kill-switch (`DISABLE_FOO_HOOK=1`)
4. Plugin-wide kill (`DISABLE_CLAUDEMD_HOOKS=1`)
5. Fail-open on malformed input

## 3. Register in plugin manifest

Edit `.claude-plugin/plugin.json` and `scripts/install.js` `HOOK_SPECS` array to add the new entry. Both must reference the same command path.

## 4. Update docs

Add a row to `README.md` kill-switches section (`DISABLE_FOO_HOOK`).

## 5. Bump plugin version

Patch bump in `package.json`, `.claude-plugin/plugin.json`, and `CHANGELOG.md` with the new hook description.
```

- [ ] **Step 2: Write `docs/RULE-HITS-SCHEMA.md`**

```markdown
# rule-hits JSONL schema

File: `~/.claude/logs/claudemd.jsonl`
Format: one JSON object per line. Append-only.

## Fields

| Field | Type | Description |
|---|---|---|
| `ts` | string (ISO-8601 UTC, Z-suffix) | timestamp of row creation |
| `hook` | string | hook name (`banned-vocab`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal`) |
| `event` | string | one of: `pass`, `deny`, `bypass-env`, `bypass-escape-hatch`, `warn`, `error`, `pass-known-red` |
| `extra` | any | hook-specific payload (object / null / string) |

## Example rows

```json
{"ts":"2026-04-21T03:10:45Z","hook":"banned-vocab","event":"deny","extra":{"matched":["significantly"]}}
{"ts":"2026-04-21T03:14:00Z","hook":"ship-baseline","event":"pass-known-red","extra":{"run_url":"https://..."}}
{"ts":"2026-04-21T04:22:30Z","hook":"residue-audit","event":"warn","extra":{"delta":34,"current":187,"baseline":153}}
{"ts":"2026-04-21T04:23:00Z","hook":"sandbox-disposal","event":"warn","extra":{"count":7}}
```

## Retention

`/claudemd-audit` does not auto-prune (v0.1.0). Future enhancement: prune rows older than 180 days on each audit invocation.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ADDING-NEW-HOOK.md docs/RULE-HITS-SCHEMA.md
git commit -m "docs: ADDING-NEW-HOOK + RULE-HITS-SCHEMA"
```

---

### Task 40: Write CHANGELOG.md and tag v0.1.0

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## [0.1.0] - 2026-04-21

### Added
- Five hooks:
  - `banned-vocab-check` (PreToolUse:Bash) — blocks commits with §10-V banned vocabulary
  - `ship-baseline-check` (PreToolUse:Bash) — blocks `git push` on red base-branch CI (2s gh timeout)
  - `residue-audit` (Stop) — advisory warn when `~/.claude/tmp/` grows beyond threshold (default 20)
  - `memory-read-check` (PreToolUse:Bash) — denies ship/push when matched MEMORY.md entry unread in session
  - `sandbox-disposal-check` (Stop) — warns on mkdtemp residue at session end
- Five slash commands: `/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`.
- Seven Node.js management scripts with idempotent settings.json merge, backup-and-overwrite spec install (last 5 backups retained), 3-way uninstall (keep/delete/restore with hard-AUTH on delete).
- Ships spec v6.9.2 (adds §0.1 Core growth discipline + §2.3 TOOLS; reduces core from ~6,200 to ~5,330 tokens).
- CI matrix: ubuntu-latest + macos-latest × node 20.

### Notes
- First release.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG.md v0.1.0 entry"
```

- [ ] **Step 3: Final pre-tag verification**

Run:
```bash
bash tests/run-all.sh
```

Expected: `OVERALL: all suites passed`

- [ ] **Step 4: Tag the release**

```bash
git tag -a v0.1.0 -m "claudemd v0.1.0 — first release (5 hooks, 5 commands, spec v6.9.2)"
```

- [ ] **Step 5: Verify tag**

```bash
git tag -l
```

Expected: output includes `v0.1.0`

- [ ] **Step 6 (manual, not auto-push)**: Push to remote and create GitHub release manually when the engineer confirms remote URL setup.

```bash
# When ready, operator runs:
# git push origin main
# git push origin v0.1.0
# gh release create v0.1.0 --notes-file CHANGELOG.md
```

These steps require remote setup + user authorization (hard-AUTH for any first push per spec §5) and are NOT performed by the implementation subagent.

---

**M7 exit criteria:**
- [ ] `README.md` + `CHANGELOG.md` + `LICENSE` present
- [ ] Four docs in `docs/`: `ARCHITECTURE.md` / `HOOK-PROTOCOL.md` / `ADDING-NEW-HOOK.md` / `RULE-HITS-SCHEMA.md`
- [ ] `tests/run-all.sh` green
- [ ] `git tag v0.1.0` exists locally

---

## Acceptance Verification (A1–A15)

After M7 tag, run each verification:

| # | Criterion | Verify command |
|---|---|---|
| A1 | install <10s on fresh HOME | `time (HOME=$(mktemp -d) CLAUDE_PLUGIN_ROOT=$PWD node scripts/install.js)` < 10s |
| A2 | idempotent install | `bash tests/integration/full-lifecycle.test.sh` (includes 3× install check) |
| A3 | 5 hooks fire on correct events | `bash tests/run-all.sh` — each test suite green |
| A4 | fail-open covers all failure modes | test suites cover: malformed jq, broken patterns, bad stdin, missing gh, missing transcript |
| A5 | 3-tier kill-switch works | test cases verify env + per-invocation escape hatches |
| A6 | CI green on ubuntu + macos × node 20 | GitHub Actions status after push |
| A7 | uninstall 3 options + hard AUTH on delete | `node --test tests/scripts/uninstall.test.js` 5/5 |
| A8 | rule-hits jsonl schema correct; audit output readable | `node --test tests/scripts/audit.test.js` 2/2 |
| A9 | `/claudemd-doctor` all-green on clean install | `HOME=$(mktemp -d) CLAUDE_PLUGIN_ROOT=$PWD node scripts/install.js && node scripts/doctor.js` — all `ok: true` |
| A10 | fresh HOME spec is v6.9.2 | `grep -c 'Version: 6.9.2' ~/.claude/CLAUDE.md` == 1 |
| A11 | existing HOME moves old spec into backup | `bash tests/integration/full-lifecycle.test.sh` variants or manual |
| A12 | new reader can add a 6th hook via docs | read-through review of `docs/ADDING-NEW-HOOK.md` |
| A13 | core ≤ 5,500 tokens | `node --test tests/scripts/spec-structure.test.js` 8/8 |
| A14 | §X-EXT sections present | same test file |
| A15 | `[tag]` syntax described in §11 | same test file |

Any failure → file an issue, fix, patch-bump version (0.1.1), tag.

---

## Self-Review Notes (plan author)

1. **Spec coverage check**: every design-doc section maps to a task (§1→Task1-2, §2→Task11-14, §3→Tasks11+13+integration, §4→Task32, §5→Tasks6/17-26, §6→Task40/CHANGELOG, §7→A1-A15, §8→Tasks32-35, §9→Decisions Log, §10→README/docs).
2. **Placeholder scan**: searched for "TBD/TODO/implement later" — none in final plan. Two intentional manual steps at M7 Task 40 Steps 5-6 (remote push / GitHub release) are explicitly marked as operator actions requiring external AUTH.
3. **Type consistency**: library function names locked in Shared Naming Contracts section; cross-task references use the same names (`hook_kill_switch`, `readSettings`, `mergeHook`, `platform_stat_mtime`, etc.).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-claudemd-plugin.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. M3/M4/M5 dispatchable in parallel after M2 completes.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints for review.

Which approach?





