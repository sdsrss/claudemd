// Single source of truth for the plugin hooks (HOOK_REGISTRY.length is the
// count — a number spelled in prose here drifted to 16 while the registry held
// 15). Consumers must import from
// here rather than maintaining parallel literal arrays:
//
//   scripts/install.js     — settings.json legacy-entry eviction predicate
//   scripts/uninstall.js   — settings.json eviction predicate
//   scripts/status.js      — kill-switch enumeration
//   scripts/toggle.js      — display-name → env-var-suffix map
//   hooks/hooks.json       — drift-tested against this registry
//   commands/claudemd-toggle.md — display-name list drift-tested
//
// Roughly event-ordered for display, but nothing depends on the order:
// execution order comes from hooks/hooks.json alone, and no test asserts
// order. Hooks are frozen (spec/OPERATOR.md §13.3). Adding a
// hook = one entry here + the hooks.json command + the
// commands/claudemd-toggle.md list; tests/scripts/hook-registry.test.js fails
// loudly if membership/event/matcher/timeout drift.
//
// `alsoOn` lists the other events a hook is registered on, with their matcher
// and timeout; `hookEvent` is the one shown.
//
// `optIn` marks a default-OFF hook: it exits at its first line unless `env`
// holds one of `values`, whatever its DISABLE_* kill switch says. toggle.js
// reads it to say so; the drift test derives the set from the hook sources.

export const HOOK_REGISTRY = [
  {
    basename: 'session-start-check.sh',
    displayName: 'session-start-check',
    envVarSuffix: 'SESSION_START',
    hookEvent: 'SessionStart',
    matcher: '*',
    timeout: 5,
  },
  {
    basename: 'version-sync.sh',
    displayName: 'version-sync',
    envVarSuffix: 'USER_PROMPT_SUBMIT',
    hookEvent: 'UserPromptSubmit',
    matcher: '*',
    timeout: 2,
  },
  {
    basename: 'spec-module-inject.sh',
    displayName: 'spec-module-inject',
    envVarSuffix: 'SPEC_MODULE_INJECT',
    hookEvent: 'UserPromptSubmit',
    matcher: '*',
    timeout: 3,
  },
  {
    basename: 'pre-bash-safety-check.sh',
    displayName: 'pre-bash-safety',
    envVarSuffix: 'PRE_BASH_SAFETY',
    hookEvent: 'PreToolUse',
    matcher: 'Bash',
    timeout: 3,
  },
  {
    basename: 'banned-vocab-check.sh',
    displayName: 'banned-vocab',
    envVarSuffix: 'BANNED_VOCAB',
    hookEvent: 'PreToolUse',
    matcher: 'Bash',
    timeout: 3,
  },
  {
    basename: 'ship-baseline-check.sh',
    displayName: 'ship-baseline',
    envVarSuffix: 'SHIP_BASELINE',
    hookEvent: 'PreToolUse',
    matcher: 'Bash',
    timeout: 5,
  },
  {
    basename: 'memory-read-check.sh',
    displayName: 'memory-read-check',
    envVarSuffix: 'MEMORY_READ',
    hookEvent: 'PreToolUse',
    matcher: 'Bash',
    timeout: 3,
  },
  {
    basename: 'sandbox-disposal-check.sh',
    displayName: 'sandbox-disposal-check',
    envVarSuffix: 'SANDBOX_DISPOSAL',
    hookEvent: 'Stop',
    matcher: '*',
    timeout: 3,
  },
  {
    basename: 'reply-language-check.sh',
    displayName: 'reply-language',
    envVarSuffix: 'REPLY_LANGUAGE',
    hookEvent: 'Stop',
    matcher: '*',
    timeout: 3,
    optIn: { env: 'REPLY_LANGUAGE_CHECK', values: ['1', 'log'] },
  },
  {
    basename: 'memory-index-lines.sh',
    displayName: 'memory-index-lines',
    envVarSuffix: 'MEMORY_INDEX_LINES',
    hookEvent: 'PostToolUse',
    matcher: 'Edit|Write|Bash',
    timeout: 3,
  },
  {
    basename: 'tmp-sweep.sh',
    displayName: 'tmp-sweep',
    envVarSuffix: 'TMP_SWEEP',
    hookEvent: 'PostToolUse',
    matcher: 'Bash',
    timeout: 3,
  },
  {
    basename: 'session-end-check.sh',
    displayName: 'session-end-check',
    envVarSuffix: 'SESSION_END_CHECK',
    hookEvent: 'SessionEnd',
    matcher: '*',
    timeout: 3,
  },
];

export const HOOK_BASENAMES = HOOK_REGISTRY.map(h => h.basename);
// Hooks a release removed. A settings.json written by a hand install or by
// 0.1.2-0.1.4 can still register any of them, and install/uninstall evict
// legacy entries by basename, so the eviction list is the union of both.
export const RETIRED_HOOK_BASENAMES = [
  // 0.123.0
  'branch-prune.sh',
  'cross-repo-write-check.sh',
  'deferred-notice.sh',
  'evidence-gate.sh',
  'ledger-staleness.sh',
  'mem-audit.sh',
  'memory-prompt-hint.sh',
  'residue-audit.sh',
  'rework-breaker.sh',
  'session-extended-read.sh',
  'session-summary.sh',
  'spec-module-gate.sh',
  'test-failure-debug.sh',
  'transcript-structure-scan.sh',
  'transcript-vocab-scan.sh',
  'verify-log.sh',
];
export const EVICTABLE_HOOK_BASENAMES = [...HOOK_BASENAMES, ...RETIRED_HOOK_BASENAMES];
// hooks/hooks.json registrations, and so install-manifest entries: one per
// event a hook is registered on (`alsoOn` adds the others).
export const HOOK_REGISTRATION_COUNT = HOOK_REGISTRY.reduce((n, h) => n + 1 + (h.alsoOn?.length ?? 0), 0);
export const HOOK_ENV_SUFFIXES = HOOK_REGISTRY.map(h => h.envVarSuffix);
export const HOOK_NAME_TO_ENV = Object.fromEntries(HOOK_REGISTRY.map(h => [h.displayName, h.envVarSuffix]));
