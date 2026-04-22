---
name: claudemd-update
description: Sync ~/.claude/CLAUDE*.md with the plugin-cache shipped spec. Shows diff summary; user chooses apply-all / select / cancel.
---

Usage: `/claudemd-update`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js` (dry-run summary first).

If the user says apply, re-run with `choice=apply-all` via `CLAUDEMD_UPDATE_CHOICE=apply-all node ${CLAUDE_PLUGIN_ROOT}/scripts/update.js`. Backup is automatic (retained to 5). Do not fetch from GitHub — plugin fetching is a separate step owned by CC (canonical sequence: `/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`; note `/plugin update` is not a real CC command).
