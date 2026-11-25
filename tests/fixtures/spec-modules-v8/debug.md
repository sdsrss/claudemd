---
module: debug
loads-on: when a bug, a failing test or an error is the task
triggers: 报错|修复(?!(一下)?(错别字|拼写))|修一下|(?<![A-Za-z0-9_])bug(?![A-Za-z0-9_])|崩溃|不工作|(?<![A-Za-z0-9_])fix (the|this|a)(?![A-Za-z0-9_])(?! (typos?|spelling)(?![A-Za-z0-9_]))|(?<![A-Za-z0-9_])failing(?![A-Za-z0-9_])|stack ?trace|(?<![A-Za-z0-9_])exception(?![A-Za-z0-9_])
trigger-window: head
---

# Fixture module: debug

Frontmatter copied from spec v8.6.1's `spec/spec-modules.json`. Spec v9.0.0 deleted this module; the fixture keeps the hooks' trigger mechanism under test (installed beside the shipped modules in a sandbox HOME).
