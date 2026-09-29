# shellcheck shell=bash
# spec-module.sh — how an installed spec module becomes injected text. One copy,
# sourced by both hooks that inject a module: spec-module-inject.sh (tier 2, on
# the user's prompt) and test-failure-debug.sh (debug.md, when a test run
# fails). Two copies of the wrapper would drift the way two copies of a banner
# did in session-start-check.sh (docs/HOOK-PROTOCOL.md, merge_banners).

# specmod_body FILE -> the module body on stdout: the frontmatter (the file's
# first block between two `---` lines) and the build comment dropped. The
# comment is a maintainer note, 112 characters a module (111 and its newline), and hook-injected text
# is not stripped of HTML comments the way CLAUDE.md is
# (tasks/specs/spec-modules.md r7).
specmod_body() {
  awk 'NR==1 && $0=="---"{fm=1; next} fm && $0=="---"{fm=0; next} fm {next} /^<!-- generated from .* -->$/ {next} {print}' "$1"
}

# specmod_entry NAME BODY WHY -> sets SPECMOD_ENTRY to the wrapped block, ending
# in a blank line so entries concatenate. A variable, not stdout: command
# substitution would strip that trailing blank line. WHY finishes the sentence
# "spec module `NAME` (path), WHY." and is the only part that differs between
# the two injecting hooks.
specmod_entry() {
  # shellcheck disable=SC2034  # read by the sourcing hook
  SPECMOD_ENTRY="[claudemd] system-injected — spec module \`$1\` (~/.claude/spec-modules/$1.md), $3. Its rules apply to this task as if read from the file."$'\n\n'"<spec-module name=\"$1\">"$'\n'"$2"$'\n'"</spec-module>"$'\n\n'
}
