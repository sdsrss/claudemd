# Project lessons

Per AI-CODING-SPEC §EXT §10-R: cap 30 entries, newest first, format `- <YYYY-MM-DD> [pattern]: <wrong> → <rule>`. Read at session start; cite when pattern matches.

---

- 2026-04-29 [macos-ci-tmp-flake]: v0.4.1 added sandbox-disposal.test.sh Case 8 (`/tmp/claudemd-* still flagged`) that PASSED on Linux but FAILED reproducibly on GitHub Actions macOS runners with stderr empty (FOUND list empty in hook). v0.4.2 patched with `touch NOW + sleep 1 + mkdir` (mtime edge defense) + basename-grep (symlink path-form defense) — no change in outcome. Without macOS real-machine access, root cause unconfirmed: candidates remaining are GH runner /tmp write-permission silent-fail, BSD vs GNU find divergence under brew gnubin PATH, runner /tmp churn racing the hook, or sandbox/SIP behavior unique to hosted runners. → **Rule**: macOS-specific filesystem tests MUST be reproduced on a real macOS machine before landing; CI-only failures get conditional skip + lessons entry rather than CI-iterated patch-spam (3-strike rule, §EXT §6). Test design that can be unit-mocked (no real /tmp dependency) is preferred over real-FS cross-platform assertions.

- 2026-04-29 [ship-baseline-bootstrap]: v0.4.2 push triggered self-installed `ship-baseline-check.sh` block ("base-branch CI is RED — release(v0.4.1)") — chicken-and-egg: the v0.4.2 commit IS the fix that lands GREEN baseline. → **Rule**: when fix-forward commit lands a known-red state, commit body MUST include `known-red baseline: <reason>` per spec §7 option (b); option (c) `DISABLE_SHIP_BASELINE_HOOK=1` bypass discouraged because the override is already auditable in commit body. Solo dev, atomic ship: this is the legitimate shape of option (b).
