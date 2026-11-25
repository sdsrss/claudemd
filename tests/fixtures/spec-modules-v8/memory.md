---
module: memory
loads-on: when saving, recalling or tagging memory
triggers: 记住|记下来|(?<![A-Za-z0-9_])remember (this|that)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])mem_save(?![A-Za-z0-9_])
trigger-window: head
---

# Fixture module: memory

Frontmatter copied from spec v8.6.1's `spec/spec-modules.json`. Spec v9.0.0 deleted this module; the fixture keeps the hooks' trigger mechanism under test (installed beside the shipped modules in a sandbox HOME).
