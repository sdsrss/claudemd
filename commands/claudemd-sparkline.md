---
name: claudemd-sparkline
description: Emit rule-usage trend sparkline (deny+warn+advisory+bypass per spec_section across 3 windows). Markdown block suitable for CHANGELOG header.
---

Usage: `/claudemd-sparkline` (default windows 30/60/90 days)
       `/claudemd-sparkline --days=7,14,28` (custom windows)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/sparkline.js $ARGS`

Surfaces "which spec rules are active vs dying" via per-window cumulative counts of signal events (deny, warn, advisory, bypass-escape-hatch) grouped by `spec_section`. Trend arrow compares per-period rates so a rule firing at steady cadence reads as `≈`, a dying rule reads as `↘`, and a freshly-active rule reads as `↗ (newly active)`.

Powers §13.1 quarterly rule review and §13.2 budget accounting with public data instead of "operator eyeballed two audits."
