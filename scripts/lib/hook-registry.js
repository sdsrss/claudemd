// Single source of truth for the 13 plugin hooks. Consumers must import from
// here rather than maintaining parallel literal arrays:
//
//   scripts/install.js     — re-exports HOOK_BASENAMES (legacy callers)
//   scripts/uninstall.js   — settings.json eviction predicate
//   scripts/status.js      — kill-switch enumeration
//   scripts/toggle.js      — display-name → env-var-suffix map
//   hooks/hooks.json       — drift-tested against this registry
//   commands/claudemd-toggle.md — display-name list drift-tested
//
// Order mirrors hooks/hooks.json registration order (SessionStart →
// UserPromptSubmit → PreToolUse:Bash → Stop), which is the order CC executes
// them. Adding a hook = one entry here + the hooks.json command + the
// commands/claudemd-toggle.md list; tests/scripts/hook-registry.test.js fails
// loudly if any of the three drift.

export const HOOK_REGISTRY = [
  { basename: 'session-start-check.sh',  displayName: 'session-start-check',   envVarSuffix: 'SESSION_START',     hookEvent: 'SessionStart',     matcher: '*',    timeout: 5 },
  { basename: 'version-sync.sh',          displayName: 'version-sync',          envVarSuffix: 'USER_PROMPT_SUBMIT', hookEvent: 'UserPromptSubmit', matcher: '*',    timeout: 2 },
  { basename: 'pre-bash-safety-check.sh', displayName: 'pre-bash-safety',       envVarSuffix: 'PRE_BASH_SAFETY',   hookEvent: 'PreToolUse',       matcher: 'Bash', timeout: 3 },
  { basename: 'banned-vocab-check.sh',    displayName: 'banned-vocab',          envVarSuffix: 'BANNED_VOCAB',      hookEvent: 'PreToolUse',       matcher: 'Bash', timeout: 3 },
  { basename: 'ship-baseline-check.sh',   displayName: 'ship-baseline',         envVarSuffix: 'SHIP_BASELINE',     hookEvent: 'PreToolUse',       matcher: 'Bash', timeout: 5 },
  { basename: 'memory-read-check.sh',     displayName: 'memory-read-check',     envVarSuffix: 'MEMORY_READ',       hookEvent: 'PreToolUse',       matcher: 'Bash', timeout: 3 },
  { basename: 'residue-audit.sh',         displayName: 'residue-audit',         envVarSuffix: 'RESIDUE_AUDIT',     hookEvent: 'Stop',             matcher: '*',    timeout: 3 },
  { basename: 'sandbox-disposal-check.sh',displayName: 'sandbox-disposal-check',envVarSuffix: 'SANDBOX_DISPOSAL',  hookEvent: 'Stop',             matcher: '*',    timeout: 3 },
  { basename: 'mem-audit.sh',             displayName: 'mem-audit',             envVarSuffix: 'MEM_AUDIT',         hookEvent: 'Stop',             matcher: '*',    timeout: 3 },
  { basename: 'session-summary.sh',       displayName: 'session-summary',       envVarSuffix: 'SESSION_SUMMARY',   hookEvent: 'Stop',             matcher: '*',    timeout: 3 },
  { basename: 'transcript-vocab-scan.sh', displayName: 'transcript-vocab-scan', envVarSuffix: 'TRANSCRIPT_VOCAB_SCAN', hookEvent: 'PostToolUse',  matcher: '*',    timeout: 3 },
  { basename: 'transcript-structure-scan.sh', displayName: 'transcript-structure-scan', envVarSuffix: 'TRANSCRIPT_STRUCTURE_SCAN', hookEvent: 'Stop', matcher: '*', timeout: 3 },
  { basename: 'session-end-check.sh',     displayName: 'session-end-check',     envVarSuffix: 'SESSION_END_CHECK', hookEvent: 'SessionEnd',      matcher: '*',    timeout: 3 },
];

export const HOOK_BASENAMES = HOOK_REGISTRY.map(h => h.basename);
export const HOOK_ENV_SUFFIXES = HOOK_REGISTRY.map(h => h.envVarSuffix);
export const HOOK_NAME_TO_ENV = Object.fromEntries(
  HOOK_REGISTRY.map(h => [h.displayName, h.envVarSuffix])
);
