# env-hygiene.sh — scrub user-tunable claudemd env vars at test entry.
#
# QA ISSUE-001: the invoking shell commonly exports claudemd knobs
# (DISABLE_RULE_HITS_LOG=1 is the documented telemetry-hygiene practice for
# manual hook probing; TRANSCRIPT_STRUCTURE_SCAN=1 is a live FP-collection
# opt-in). Suites assert on rule-hits rows / opt-in defaults, so inherited
# knobs flip 15 suites red with no hint. Same lesson as the earlier
# hook-env-test-hermeticity fix — this closes the remaining families in one
# place instead of per-suite.
#
# Scope: ONLY vars claudemd hooks/scripts read as behavior knobs. Harness
# vars the suites rely on (CLAUDE_PLUGIN_ROOT, HOME, PATH, TMPDIR) are
# untouched — CLAUDEMD_/DISABLE_ prefixes don't cover them.
#
# Usage (run-all.sh, before any suite):
#   source "$HERE/lib/env-hygiene.sh" && claudemd_reset_test_env

claudemd_reset_test_env() {
  local v
  # Prefix families: every DISABLE_* hook/sub-feature switch + every
  # CLAUDEMD_* tunable. Broad on purpose — new knobs join these families
  # (docs/ADDING-NEW-HOOK.md) and stay covered without editing this list.
  while IFS= read -r v; do
    unset "$v"
  done < <(compgen -v | grep -E '^(DISABLE_[A-Z0-9_]+|CLAUDEMD_[A-Z0-9_]+)$')
  # Non-prefixed knobs (opt-ins + thresholds) — explicit list.
  unset TRANSCRIPT_VOCAB_SCAN TRANSCRIPT_STRUCTURE_SCAN MID_SPINE_YIELD_SCAN \
        BANNED_VOCAB_PROSE_SCAN BASH_READONLY_FAST_PATH BASH_SAFETY_INDIRECT_CALL \
        SPEC_RESIDUE_THRESHOLD 2>/dev/null || true
  return 0
}
