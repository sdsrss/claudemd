---
module: debug
loads-on: when a bug, a failing test or an error is the task
triggers: 报错|修复|修一下|\bbug\b|崩溃|不工作|\bfix (the|this|a)\b|\bfailing\b|stack ?trace|\bexception\b
trigger-window: head
---

# AI-CODING-SPEC v6.36.0 — module: debug

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §6 DEBUG

```
env/dep/config    → fix + 1 retry → pause, surface blocker in prose
syntax            → auto-fix ≤2 attempts
L1 code bug       → §7.L1-bugfix (core)
L2+ code/logic    → §12 L2 bug row (root cause first)
env/staging/deploy → gs:/investigate
UI/visual         → gs:/browse → route per cause
sideways          → STOP + stash → re-plan (note pivot reason)
```

### Iron Law #3: NO FIX WITHOUT ROOT CAUSE (L2+)
Investigate → Analyze → Hypothesize → Implement (with §7 evidence). Symptom-only fixes banned at L2+.

### Three-strike rule
Same error signature 3× → roll back the path that introduced it. Signature = `error_msg_normalized[:80]` + `exception_type`; 2+ matching = same. **Manual trigger**: user repeat-failure feedback (e.g. "又失败 / 又挂 / again") counts as a strike regardless of signature match. Reset on user "continue / 忽略" or approach explicitly pivots (new file, new hypothesis stated in prose). After 3 fails, question architecture — no 4th patch.

### Dead-end record
Append to plan: `dead-end: <approach> — <why failed> — DO NOT RETRY this task`.
Session-scoped. Promote to `tasks/lessons.md` only on user request ("记住这个") or same-session recurrence.
