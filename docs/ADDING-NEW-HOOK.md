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
