#!/usr/bin/env bash
# Hook-name lists for shell suites, derived from scripts/lib/hook-registry.js.
#
# Why this exists (audit-2026-08-22 条目 8): four eviction assertions each
# hand-copied a different subset of the hook names — 15, 10, 8 and 8 of the 15 —
# and every one of them printed some form of "0 claudemd hook entries remain".
# A hook outside a given list could survive uninstall and that assertion stayed
# green. The registry is the single source; shell cannot import it, so it goes
# through node once, here, instead of being retyped per suite.
#
# tests/scripts/subject-set-drift.test.js fails on any new hand-written
# enumeration, so the next suite that needs one lands here rather than in a
# fifth copy.

# Prints `a|b|c` over every hook basename with the .sh suffix stripped —
# the shape jq's `test()` and grep -E want.
claudemd_hook_alternation() {
  local repo="$1"
  node -e '
    import("file://" + process.argv[1]).then(m => {
      const names = m.HOOK_BASENAMES.map(b => b.replace(/\.sh$/, ""));
      if (names.length < 10) { console.error("registry resolved " + names.length + " hooks"); process.exit(1); }
      console.log(names.join("|"));
    }).catch(e => { console.error(String(e)); process.exit(1); });
  ' "$repo/scripts/lib/hook-registry.js"
}

# Prints one basename per line (with .sh).
claudemd_hook_basenames() {
  local repo="$1"
  node -e '
    import("file://" + process.argv[1]).then(m => {
      if (m.HOOK_BASENAMES.length < 10) { console.error("registry resolved " + m.HOOK_BASENAMES.length + " hooks"); process.exit(1); }
      console.log(m.HOOK_BASENAMES.join("\n"));
    }).catch(e => { console.error(String(e)); process.exit(1); });
  ' "$repo/scripts/lib/hook-registry.js"
}
