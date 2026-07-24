# Adding a new hook to claudemd

This guide walks adding another hook from zero (16 ship as of v0.51.x). Example: `foo-check.sh` that denies a hypothetical condition.

> Steps 3-4 are drift-GATED: `tests/scripts/hook-registry.test.js`, `tests/hooks/contract.test.sh` and `tests/scripts/hard-rules-drift.test.js` fail CI if any registration site is skipped. Following only steps 1-2 produces a red build by design.

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

## 3. Register in the manifest + registry (drift-gated)

1. `hooks/hooks.json` — add the new entry to the appropriate `event` block (e.g. `PreToolUse` / `Stop`). Command form: `bash "${CLAUDE_PLUGIN_ROOT}/hooks/foo-check.sh"` (the CC harness expands `${CLAUDE_PLUGIN_ROOT}` only for hooks defined in the plugin's own `hooks/hooks.json` — never in `settings.json`).
2. `scripts/lib/hook-registry.js` `HOOK_REGISTRY` — add a row (basename / displayName / env suffix). `HOOK_BASENAMES` derives from it, which is what `uninstall.js` and the upgrade-cleanup path match against. Gate: `tests/scripts/hook-registry.test.js` asserts registry ↔ hooks.json ↔ toggle.md agree.
3. `commands/claudemd-toggle.md` — add the new displayName to the toggle list (same gate).

## 4. Register the telemetry + rule drift gates

Skipping any of these is a red build, not a style nit:

1. `docs/RULE-HITS-SCHEMA.md` — document every `(event, emitter)` pair the hook emits via `hook_record`. Gate: `tests/hooks/contract.test.sh` asserts documented ↔ emitted in BOTH directions.
2. `tests/hooks/contract.test.sh` — add the same pairs to its `DOCUMENTED` array.
3. `spec/hard-rules.json` — only if the hook files a **blocking deny** under a NEW `§section`: add a manifest entry with `enforcement: "hook"` + `rule_hits_section: "<§section>"`, and add the section to `KNOWN_HOOK_SECTIONS` in `tests/scripts/hard-rules-drift.test.js` + the RULE-HITS-SCHEMA taxonomy table. Gate: `hard-rules-drift.test.js` test 8 (every hook deny section needs a manifest entry).

## 5. Update docs

Add a row to `README.md` kill-switches section (`DISABLE_FOO_HOOK`) and a row to the `docs/ARCHITECTURE.md` hook-taxonomy table. Gate: `tests/scripts/readme-drift.test.js` asserts README hook counts/lists against the file tree.

## 6. Bump plugin version

Patch bump in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2 sites), and `CHANGELOG.md` with the new hook description. Gate: `runPluginSemverCheck` (in the standard suite) asserts all four semver sites agree.
