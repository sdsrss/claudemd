---
module: orchestrate
loads-on: before spawning subagents or running work in parallel
triggers: 并行|子代理|(?<![A-Za-z0-9_])subagents?(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])in parallel(?![A-Za-z0-9_])|fan out
trigger-window: head
---

# Fixture module: orchestrate

Frontmatter copied from spec v8.6.1's `spec/spec-modules.json`. Spec v9.0.0 deleted this module; the fixture keeps the hooks' trigger mechanism under test (installed beside the shipped modules in a sandbox HOME).
