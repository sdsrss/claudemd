# Adding a new hook to claudemd

This guide walks adding another hook from zero (see `HOOK_REGISTRY.length`). Example: `foo-check.sh` that denies a hypothetical condition.

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

Add a row to `README.md` kill-switches section (`DISABLE_FOO_HOOK`) and a row to the `docs/ARCHITECTURE.md` hook-taxonomy table. Gates: `tests/scripts/readme-drift.test.js` asserts README hook counts/lists against the file tree; `tests/scripts/kill-switch-doc-drift.test.js` asserts the README `DISABLE_*_HOOK` list against the `hook_kill_switch` call in each hook; `tests/scripts/architecture-drift.test.js` asserts the taxonomy table against the `hook_record` sections the hook emits, and the "State locations" bullet list against every `.claudemd-state/` or `$TMPDIR/claudemd-*` path the hook writes.

## 5b. The rest of the gates a new hook trips

The four sections above cover registration and docs. These fire on the hook's CONTENT, so they are easy to meet and easy to be surprised by — every one of them is a red build with a message that names the file. This list is itself gated: `tests/scripts/subject-set-drift.test.js` fails if a suite that constrains new hooks is missing from here, because a checklist that lags the gates sends people to a red build with no explanation (audit-2026-08-22 条目 18).

| Gate | Fires when | What it wants |
|---|---|---|
| `tests/hooks/fail-open.test.sh` | always | The hook must exit 0 and emit nothing on a malformed / empty / missing-field event. It is driven cold AND warm over every shipped hook. |
| `tests/hooks/hook-budget.test.sh` | the hook reads a data source whose size it does not control (`MEMORY.md`, the transcript, `claudemd.jsonl`, `~/.claude/tmp`, `$TMPDIR`) | Three things. (1) The hook must stay inside its `hooks.json` timeout against a production-scale fixture. (2) The probe must PROVE it reached the scaling code (stdout, a rule-hits row, or a state write — paired with exit 0). (3) **Its signature must DIFFER between the populated fixture and an empty one** — same probe, two data volumes, and the two runs must not look alike on stdout, stderr, rule-hits bytes, state entries or `$TMPDIR` entries. (2) alone passes when an unrelated branch writes a log row; (3) proves the hook actually READS the varied source. It does not prove the read is O(n) — a scan replaced by a plausible partial one still differs; see the section header for the two mutations that survive it. Add the fixture your hook needs, and if your hook genuinely cannot move that signature, add an arm to `diff_exempt_reason` with a reason that is true of your file. |
| `tests/hooks/trigger-view-parity.test.sh` | the hook renders a trigger view via `hook_trigger_view` | The rendered view must match the source of the trigger it names. |
| `tests/hooks/memory-tags-parity.test.sh` | the hook matches MEMORY.md tags | It must go through `hooks/lib/memory-tags.sh`, and the bash and JS matchers must agree. |
| `tests/scripts/jq-guard-consumers.test.js` | the hook calls `jq` | Every call must sit behind `hook_require_jq` with a `hook_record_failopen` on the missing-jq path. |
| `tests/scripts/semver-compare-parity.test.js` | the hook compares versions | It must use the shared comparator, not a hand-rolled one. |
| `tests/scripts/user-turn-parity.test.js` | the hook decides what a "user turn" is | One definition, shared — the three that once disagreed are the reason this exists. |
| `tests/scripts/subject-set-drift.test.js` | always | No hand-written list of hook names anywhere: derive from `HOOK_REGISTRY`. If the new hook is left OUT of `scripts/doctor.js`'s liveness table, it must be named in `LIVENESS_SKIPPED` with a reason. |
| `tests/hooks/preToolUse-fastpath-order.test.sh` | the hook is `PreToolUse:Bash` and calls `hook_is_readonly_bash` | Only `.tool_name` and `.tool_input.command` may be extracted ABOVE the fast-path exit — in practice via `hook_read_bash_fields`, the one call this gate allowlists there. Telemetry fields (`session_id`, `tool_use_id`, `cwd`) go below it — a read-only command exits there and never uses them, so every jq spawn in front of the exit is work the fast-path cannot skip. `memory-read-check.sh` is the reference shape. This gate reads source ORDER and names the offending line; the spawn-budget gate below measures the same property behaviourally, because a source-order gate only sees the spellings it was taught. |
| `tests/hooks/preToolUse-jq-spawn-budget.test.sh` | the hook is `PreToolUse:Bash` and calls `hook_is_readonly_bash` | A per-shape CEILING on real `jq` processes for the whole chain, counted with a shim rather than read out of the source. Your hook gets ONE spawn on a read-only command and one on a command that matches no trigger: use `hook_read_bash_fields` for the first parse and `hook_read_telemetry_ids` for `session_id`/`tool_use_id`/`cwd`, and put the latter below the last exit that can be taken without it. Adding a second spawn to a path that exits without using it raises a ceiling here, and raising one is a deliberate act — say which spawn and why it cannot wait. |
| `tests/lib/bash32-constructs.sh` | always | No bash 4+ syntax — macOS runs `/bin/bash` 3.2. A real 3.2 parses the file in CI. |
| `tests/lib/bash32-runtime.sh` | always | Your hook must RUN under bash 3.2, not merely parse. The two gates above are a pattern list and a `bash -n`; `declare -g` (4.2), `local -n` (4.3) and `${x@Q}` (4.4) clear both and fail on the line that executes them. CI drives every fixture suite with a real 3.2 on `PATH` (Linux/node20 leg). Locally: `BASH32_BIN=/path/to/bash-3.2 npm test` — unset, that section prints a SKIP with the build recipe rather than blocking you. |
| `shellcheck --severity=warning` | always | Clean at warning+. Run locally via `npm test`, which runs the same scan CI does. |

## 6. Bump plugin version

Patch bump in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2 sites), and `CHANGELOG.md` with the new hook description. Gate: `runPluginSemverCheck` (in the standard suite) asserts all four semver sites agree.
