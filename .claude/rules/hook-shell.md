---
paths:
  - "hooks/**"
---

# Writing hooks in this repo

- Source `hooks/lib/platform.sh` and use its wrappers for `stat`, mtimes and `timeout`: macOS ships BSD tools, and a `command -v` guard alone fails silently.
- Print exactly one JSON object per run. `additionalContext` reaches the model, top-level `systemMessage` reaches the human, and stderr with exit 0 reaches the human only (`docs/HOOK-PROTOCOL.md`).
- Text the model reads names a kill switch as the user's ("the user can turn this off with DISABLE_X=1"); text only the human reads may say "Disable: DISABLE_X=1".
- A change to a hook's text or verdict updates its `tests/hooks/*.test.sh` in the same commit, with a case that fails before the change.
