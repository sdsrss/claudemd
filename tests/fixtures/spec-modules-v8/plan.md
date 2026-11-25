---
module: plan
loads-on: for L3 work, specs and plans, or a change crossing modules
triggers: 架构|重构|规划|实施方案|设计方案|(?<![A-Za-z0-9_])refactor(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])migration(?![A-Za-z0-9_])|迁移|(?<![A-Za-z0-9_])L3(?![A-Za-z0-9_])
trigger-window: head
---

# Fixture module: plan

Frontmatter copied from spec v8.6.1's `spec/spec-modules.json`. Spec v9.0.0 deleted this module; the fixture keeps the hooks' trigger mechanism under test (installed beside the shipped modules in a sandbox HOME).
