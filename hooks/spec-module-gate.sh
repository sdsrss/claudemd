#!/usr/bin/env bash
# spec-module-gate — PreToolUse(Bash): before a release command, check that
# the `ship` spec module reached this session (tasks/specs/spec-modules.md,
# tier 3). The command is cut into simple commands at ; & | ( ) and backticks
# (quoted bodies and heredocs already emptied by hook_trigger_view), prefixes
# (VAR=x, env, sudo, timeout, nice, nohup, if/then/do, ...) are skipped, and
# each one is a release step when it is:
#   git [global opts] tag ... <name>   creating a version tag; not -l/-d/-v,
#                                      -n, --contains and the other list forms
#   git [global opts] push ...         with --tags / --follow-tags, a bare
#                                      version refspec, or a version tag named
#                                      as refs/tags/<name> or `tag <name>`; not
#                                      -n/--dry-run, -d/--delete, :<ref>
# A version tag name ends in a dotted version, alone or after @, _ or -:
# v1.2, 2.0.0-rc.1, pkg@2.0.0, cli-v2.0.0. In a replay of the 4,692 distinct
# transcript commands naming git/gh/npm and tag/push/release/publish, every
# other tag name created was a fixture, probe or archive marker (10 commands),
# and a version after `/` was a branch (release/0.13.0, fix/0.10.1-audit:
# 21 commands), so a bare refspec must be the version alone.
#   gh release create
#   npm [global opts] publish          without --dry-run in the same command
# A bare `v2` pushed is taken for a branch. `bash -c '...'` bodies are quoted,
# so they are not seen. (D#110 replaced 0.101.0's single regex, which matched
# across separators and missed tag flags, non-v names, global options and
# command prefixes.)
# Reached = injected by
# spec-module-inject.sh this session, or Read (tool or Bash reader) — the
# same read test the §11 memory gate uses (hook_memfile_was_read).
#
# Modes (SPEC_MODULE_GATE), per §EXT §13.3's stages for a new behaviour hook:
#   log (default)  record a `module-unread` row, print nothing
#   advisory       also tell the model which module to read; allow
#   deny           refuse the command until the module is read
#   off            do nothing
# Kill switch: DISABLE_SPEC_MODULE_GATE_HOOK=1.
set -uo pipefail
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$LIB_DIR/hook-common.sh" || exit 0
source "$LIB_DIR/platform.sh" 2>/dev/null || true
hook_kill_switch SPEC_MODULE_GATE || exit 0
MODE="${SPEC_MODULE_GATE:-log}"
case "$MODE" in log | advisory | deny) ;; *) exit 0 ;; esac
hook_require_jq || { hook_record_failopen spec-module-gate jq-missing; exit 0; }

MODULE="$HOME/.claude/spec-modules/ship.md"
[[ -f "$MODULE" ]] || exit 0

EVENT=$(hook_read_event) || exit 0
CMD=$(hook_jq_field spec-module-gate "$EVENT" '.tool_input.command // ""') || exit 0
[[ -n "$CMD" ]] || exit 0
VIEW=$(printf '%s' "$CMD" | hook_trigger_view)
# Cheap exit first: the hook runs on every Bash call.
[[ "$VIEW" =~ (^|[^[:alnum:]_.-])(git|gh|npm)([^[:alnum:]_-]|$) && "$VIEW" =~ (tag|push|release|publish) ]] || exit 0

_MG_VERSION_RE='(^|[@_-])v?[0-9]+(\.[0-9]+)+([-+.][0-9A-Za-z.-]+)?$'
_MG_BARE_VERSION_RE='^v?[0-9]+(\.[0-9]+)+([-+][0-9A-Za-z.-]+)?$'

# The parsers below share the caller's `w` (words), `n` (count) and `i` (cursor).

# _mg_skip_opts OPT... — advance i over the options at w[i]; an option named in
# the arguments takes the next word as its value (unless written --opt=value).
# Stops after `--` or at the first word that is not an option.
_mg_skip_opts() {
  local _o _v
  while (( i < n )); do
    _o="${w[i]}"
    case "$_o" in
      --) (( i++ )); return ;;
      -*=*) (( i++ )) ;;
      -*)
        (( i++ ))
        for _v in "$@"; do [[ "$_o" == "$_v" ]] && { (( i++ )); break; }; done
        ;;
      *) return ;;
    esac
  done
}

# _mg_git_tag — w[i..] are `git tag`'s arguments; 0 = it creates a tag.
_mg_git_tag() {
  local _a _k _hit=0
  while (( i < n )); do
    _a="${w[i]}"; (( i++ ))
    case "$_a" in
      -l | --list | -d | --delete | -v | --verify | -n* | --contains* | --no-contains* | --points-at* \
        | --merged* | --no-merged* | --sort* | --format* | --column* | -i | --ignore-case) return 1 ;;
      --message | --file | --local-user | --cleanup | --trailer) (( i++ )) ;; # short forms: below
      --*) ;;
      -*)
        # Bundled short options (-am MSG, -sm MSG, -ld, -Fnotes.md): letters
        # up to the first of m/F/u, which takes the rest of the word or, when
        # it is the last letter, the next word.
        _k=1
        while (( _k < ${#_a} )); do
          case "${_a:_k:1}" in
            l | d | v | n) return 1 ;;
            m | F | u) (( _k == ${#_a} - 1 )) && (( i++ )); break ;;
          esac
          (( _k++ ))
        done
        ;;
      *) [[ "$_a" =~ $_MG_VERSION_RE ]] && _hit=1 ;; # the name, or the commit after it
    esac
  done
  (( _hit ))
}

# _mg_git_push — w[i..] are `git push`'s arguments; 0 = it pushes a tag.
_mg_git_push() {
  local _a _tags=0 _hit=0 _tagword=0 _remote=0
  while (( i < n )); do
    _a="${w[i]}"; (( i++ ))
    case "$_a" in
      --dry-run | --delete) return 1 ;;
      --tags | --follow-tags) _tags=1 ;;
      --repo | -o | --push-option | --receive-pack | --exec) (( i++ )) ;;
      --*) ;;
      -*) [[ "$_a" =~ [nd] ]] && return 1 ;; # -n, -d, bundled or alone
      *)
        # The first word is the repository, even after --repo (git: the argument
        # wins). An scp-style `192.168.1.10:repo.git` would read as version
        # 192.168.1.10.
        (( _remote )) || { _remote=1; continue; }
        [[ "$_a" == tag ]] && { _tagword=1; continue; }
        _a="${_a#+}"
        _a="${_a%%:*}"
        if (( _tagword )) || [[ "$_a" == refs/tags/* ]]; then
          [[ "${_a#refs/tags/}" =~ $_MG_VERSION_RE ]] && _hit=1
        else
          [[ "$_a" =~ $_MG_BARE_VERSION_RE ]] && _hit=1
        fi
        _tagword=0
        ;;
    esac
  done
  (( _tags || _hit ))
}

# _mg_is_release WORD... — 0 = this simple command is a release step.
_mg_is_release() {
  local -a w=("$@")
  local n=${#w[@]} i=0 _c _v
  while (( i < n )); do
    _c="${w[i]}"
    if [[ "$_c" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then (( i++ )); continue; fi
    case "$_c" in
      env)
        (( i++ ))
        while (( i < n )); do
          case "${w[i]}" in
            -u | --unset | -C | --chdir | -S | --split-string) (( i += 2 )) ;;
            -*) (( i++ )) ;;
            *) if [[ "${w[i]}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then (( i++ )); else break; fi ;;
          esac
        done ;;
      sudo) (( i++ )); _mg_skip_opts -u -g -C -D -h -p -r -t -U -T ;;
      timeout) (( i++ )); _mg_skip_opts -k -s --kill-after --signal; (( i++ )) ;; # then the duration
      nice) (( i++ )); _mg_skip_opts -n --adjustment ;;
      nohup | command | exec | time | builtin | if | then | do | else | elif | while | until | '!' | '{') (( i++ )) ;;
      *) break ;;
    esac
  done
  (( i < n )) || return 1
  _c="${w[i]##*/}"; (( i++ ))
  case "$_c" in
    git)
      _mg_skip_opts -C -c --git-dir --work-tree --namespace --super-prefix --config-env --exec-path
      (( i < n )) || return 1
      _c="${w[i]}"; (( i++ ))
      case "$_c" in
        tag) _mg_git_tag ;;
        push) _mg_git_push ;;
        *) return 1 ;;
      esac ;;
    gh)
      _mg_skip_opts -R --repo # gh takes -R before the command too: `gh -R o/r release create`
      [[ "${w[i]:-}" == release ]] || return 1
      (( i++ )); _mg_skip_opts -R --repo # `gh release -R o/r create`
      [[ "${w[i]:-}" == create ]] || return 1
      for _v in "${w[@]}"; do [[ "$_v" == --help || "$_v" == -h ]] && return 1; done
      return 0 ;;
    npm)
      _mg_skip_opts --prefix -C --workspace -w --registry --userconfig --globalconfig --cache --loglevel --otp --tag --access
      [[ "${w[i]:-}" == publish ]] || return 1
      for _v in "${w[@]}"; do [[ "$_v" == --dry-run || "$_v" == --dry-run=true || "$_v" == --help || "$_v" == -h ]] && return 1; done
      return 0 ;;
    *) return 1 ;;
  esac
}

IS_RELEASE=0
while IFS= read -r _seg; do
  read -ra _words <<<"$_seg"
  (( ${#_words[@]} > 0 )) || continue
  _mg_is_release "${_words[@]}" && { IS_RELEASE=1; break; }
done < <(printf '%s\n' "$VIEW" | sed -e 's/[;&|()`]/\n/g' \
  | awk '/(^|[^[:alnum:]_.-])(git|gh|npm)([^[:alnum:]_-]|$)/ && /tag|push|release|publish/')
# (The awk keeps only candidate commands: a 2,000-command line went from 37 to
# 215 ms when every command went through the bash parser — review L7.)
(( IS_RELEASE )) || exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
if [[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] && grep -qx ship "$HOME/.claude/.claudemd-state/modinj-$SESSION_ID.list" 2>/dev/null; then
  exit 0
fi
if [[ -n "$TRANSCRIPT" ]] && hook_memfile_was_read "$TRANSCRIPT" "$MODULE"; then
  exit 0
fi

MSG="[claudemd] system-injected: this is a release command and the ship spec module has not been read this session. Read ~/.claude/spec-modules/ship.md (core §2.2) before tagging, releasing or publishing"
# Verdict first, telemetry second: a fatal inside hook_record must not be able
# to swallow the deny (the §8 gate's lesson, memory #106).
case "$MODE" in
  advisory)
    # The command runs anyway in this mode, so the text asks for the read, not a rerun.
    jq -cn --arg c "$MSG, and follow it for the rest of this release." \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
    ;;
  deny)
    jq -cn --arg r "$MSG, then run the command again. The user can turn this check off with DISABLE_SPEC_MODULE_GATE_HOOK=1." \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
    ;;
esac
hook_record spec-module-gate module-unread "$(jq -cn --arg m "$MODE" '{module: "ship", mode: $m}' 2>/dev/null || echo 'null')" '§2.2-modules' "$SESSION_ID" 2>/dev/null || true
exit 0
