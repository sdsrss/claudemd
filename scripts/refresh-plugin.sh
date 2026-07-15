#!/usr/bin/env bash
# refresh-plugin.sh — one-shot refresh of the installed claudemd plugin to the
# latest released version, for /claudemd-refresh. Claude Code has no working
# `/plugin update`; the sanctioned refresh is marketplace-update → uninstall →
# install, driven here via the `claude plugin` CLI so it runs as one command.
#
# This refreshes the on-disk plugin CACHE (the hook code that runs). The
# ~/.claude spec + manifest sync happens automatically afterwards: the next
# SessionStart bootstrap (or the first prompt's version-sync hook) runs
# install.js when it sees manifest-version < plugin-version. So:
#   run this → RESTART Claude Code (or /reload-plugins) → sync is automatic.
set -euo pipefail

PLUGIN="claudemd@claudemd"
MARKET="claudemd"

if ! command -v claude >/dev/null 2>&1; then
  echo "refresh-plugin: 'claude' CLI not found on PATH — run the manual sequence instead (see README §Update)" >&2
  exit 1
fi

echo "==> 1/3 marketplace update ($MARKET) — git-pull the marketplace clone"
claude plugin marketplace update "$MARKET"

echo "==> 2/3 uninstall $PLUGIN (-y: non-interactive)"
claude plugin uninstall "$PLUGIN" -y

echo "==> 3/3 install $PLUGIN (pulls the just-updated marketplace version)"
claude plugin install "$PLUGIN"

echo
echo "Plugin cache refreshed. Now RESTART Claude Code (or /reload-plugins);"
echo "the first new session auto-syncs the spec + manifest via install.js."
