---
name: claudemd-update
description: Sync ~/.claude/CLAUDE*.md with the plugin-cache shipped spec. Shows diff summary; user chooses apply-all or cancel.
---

Usage: `/claudemd-update`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js` (dry-run summary first).

If the user says apply, re-run with `choice=apply-all` via `CLAUDEMD_UPDATE_CHOICE=apply-all node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js`. Backup is automatic (retained to 5). Do not fetch from GitHub — plugin fetching is a separate step owned by CC (canonical sequence: `/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`; note `/plugin update` is not a real CC command).

**Per-file select is not supported.** The spec trio (`CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md`) evolves lockstep — `CLAUDE.md` H1 is the canonical version, and `§EXT §X-EXT` cross-references would dangle if only some files updated. Choices are `apply-all` (full trio sync) or `cancel`.
