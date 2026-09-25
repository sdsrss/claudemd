#!/usr/bin/env bash
# cross-repo-write-check.sh — PreToolUse:Edit|Write|NotebookEdit and PreToolUse:Bash.
#
# Tells the agent, BEFORE the write runs, that a tool call is about to write into
# a git repository other than the session's own project. Spec §5: files outside
# the grant need a fresh AUTH, and a session working in one project has no grant
# for another. The incident this exists for (2026-09-25): a session in
# claude-mem-lite edited two files in claudemd, ran `git switch -c` and
# committed. The claudemd working tree is shared, so HEAD was already on another
# live session's branch; the commit landed there, and the session then ran
# `git branch -f` and `git reset --keep` on that other session's branch to undo
# it. The same tree had seen `git checkout -b` from two sessions one second
# apart. Nothing was lost only because `--keep` happened to preserve the other
# session's uncommitted edits.
#
# Advisory by design, phase 1 of tasks/specs/cross-repo-write.md: it never sets
# permissionDecision. Over 747 sessions (2026-09-05..09-25) two wrote into
# another repo and one of those was user-authorized work, so a deny would have
# blocked the legitimate half. What an advisory can do is reach a cooperative
# agent before its first cross-repo write, which is where the incident could
# have stopped.
#
# What it sees:
#   - Edit / Write / NotebookEdit: the target path. Exact.
#   - Bash: a git WRITE subcommand whose repo is another one — through a literal
#     `cd <path>` earlier in the same command or `git -C <path>`. Reads
#     (log/show/status/merge-base/merge-tree, branch and tag listings, stash
#     list, worktree list, fetch) are not writes.
# What it does not see, by decision (spec non-goals): non-git file writes from
# Bash (`sed -i`, `>`, `cp`, `rm`), paths held in variables, `eval`/`bash -c`.
# It is a guardrail for cooperative mistakes, not an anti-injection boundary —
# the same stance pre-bash-safety-check.sh states for §8.
#
# Repo identity is the `.git` that owns a path, found by walking up with no git
# process spawned. A worktree's or submodule's `.git` FILE collapses to the
# owning repo's `.git` (through `commondir` when the gitdir has one, which is
# how the bare-repo `proj.git/worktrees/<n>` layout resolves), so the
# session's own worktrees and submodules are not
# "another repo", and another repo's worktree is that repo. Identities are
# compared after `pwd -P`, so `..` and symlinks cannot split one repo in two.
#
# Skipped outright: writes under ~/.claude/ (memory, plans), ${TMPDIR:-/tmp},
# /tmp/claude-* (Claude Code's scratchpad root, which stays there when TMPDIR
# points elsewhere) and /var/tmp. Sandbox repos live in those places by design:
# the first replay (22,938 historical calls) found six throwaway `git init` repos
# under /var/tmp/cgqa, and they were the only false positives it produced.
#
# One advisory per (session, target repo); every hit writes a rule-hits row
# with `first` true on the announced one, so the phase-1 evaluation can count
# hits the agent was not re-told about.
#
# Opt-in: CROSS_REPO_WRITE=1 (default OFF). §EXT §13.3: behaviour-layer hooks
# ship default-OFF for >=30d of FP signal collection before default-ON advisory,
# and only then deny. Same shape as rework-breaker / evidence-gate.
# Allowlist: CROSS_REPO_WRITE_ALLOW — colon-separated absolute repo roots (a
# leading `~/` or `$HOME/` is expanded, other relative entries are ignored); a
# hit there is recorded with allowlisted:true and gets no message.
#
# Kill-switches:
#   DISABLE_CROSS_REPO_WRITE_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1        — global

set -uo pipefail

# Opt-in gate (default OFF). Checked BEFORE sourcing hook-common so the default
# path costs one string compare — this hook is on every Edit, Write and Bash.
[[ "${CROSS_REPO_WRITE:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch CROSS_REPO_WRITE || exit 0
hook_require_jq || {
  hook_record_failopen cross-repo-write jq-missing
  exit 0
}

EVENT=$(hook_read_event) || exit 0

# Every field from ONE jq spawn, NUL-separated for the reason
# hook_read_bash_fields gives: `.tool_input.command` routinely holds newlines
# and tabs. Failure attribution is that function's, verbatim.
XR_TOOL=""
XR_CMD=""
XR_PATH=""
XR_CWD=""
SESSION_ID=""
TOOL_USE_ID=""
XR_GOT=0
{
  IFS= read -r -d '' XR_TOOL &&
    IFS= read -r -d '' XR_CMD &&
    IFS= read -r -d '' XR_PATH &&
    IFS= read -r -d '' XR_CWD &&
    IFS= read -r -d '' SESSION_ID &&
    IFS= read -r -d '' TOOL_USE_ID && XR_GOT=1
} < <(printf '%s' "$EVENT" | jq -j '
    ((.tool_name // "") | tostring) + "\u0000" +
    ((.tool_input.command // "") | tostring) + "\u0000" +
    ((.tool_input.file_path // .tool_input.notebook_path // "") | tostring) + "\u0000" +
    ((.cwd // "") | tostring) + "\u0000" +
    ((.session_id // "") | tostring) + "\u0000" +
    ((.tool_use_id // "") | tostring) + "\u0000"' 2>/dev/null)
if ((!XR_GOT)); then
  if jq -n . >/dev/null 2>&1; then
    hook_record_failopen cross-repo-write bad-event
  else
    hook_record_failopen cross-repo-write jq-broken
  fi
  exit 0
fi

case "$XR_TOOL" in
  Edit | Write | NotebookEdit | Bash) ;;
  *) exit 0 ;;
esac
[[ "$XR_CWD" == /* ]] || exit 0

# xrepo_canon_dir PATH — the nearest existing directory at or above PATH,
# physical (`pwd -P`). A Write usually targets a file, often in a directory
# that does not exist yet; the repo that will own it is the one owning its
# nearest existing ancestor. Absolute paths only: on a slash-free string
# `${d%/*}` returns the string itself, and the walk below would never end.
xrepo_canon_dir() {
  local d="$1"
  [[ "$d" == /* ]] || return 1
  while [[ -n "$d" && "$d" != "/" && ! -d "$d" ]]; do d="${d%/*}"; done
  [[ -n "$d" ]] || d=/
  (cd "$d" 2>/dev/null && pwd -P)
}

# xrepo_identity PATH — the physical path of the `.git` directory that owns
# PATH; returns 1 when no repo owns it. A `.git` FILE (worktree, submodule) is
# followed through its `gitdir:` line. A linked worktree's gitdir holds a
# `commondir` file naming the shared repo — the only form a bare-repo layout
# (`proj.git/worktrees/<n>`) has — and is followed through it. Without one, a
# gitdir under `<x>/.git/worktrees/` or `<x>/.git/modules/` collapses to
# `<x>/.git`, the repo that owns it.
xrepo_identity() {
  local d line g c
  d=$(xrepo_canon_dir "$1") || return 1
  while :; do
    if [[ -d "$d/.git" ]]; then
      g="$d/.git"
      break
    fi
    if [[ -f "$d/.git" ]]; then
      line=""
      { IFS= read -r line < "$d/.git"; } 2>/dev/null
      line="${line%$'\r'}"
      g="${line#gitdir: }"
      [[ -n "$g" && "$g" != "$line" ]] || return 1
      [[ "$g" == /* ]] || g="$d/$g"
      c=""
      [[ -f "$g/commondir" ]] && { IFS= read -r c < "$g/commondir"; } 2>/dev/null
      c="${c%$'\r'}"
      if [[ -n "$c" ]]; then
        [[ "$c" == /* ]] || c="$g/$c"
        c=$(cd "$c" 2>/dev/null && pwd -P) && g="$c"
      fi
      # After `commondir` too: a worktree of a submodule resolves to
      # `<x>/.git/modules/<n>`, which is still `<x>`'s repo.
      case "$g" in
        */.git/worktrees/*) g="${g%/.git/worktrees/*}/.git" ;;
        */.git/modules/*) g="${g%/.git/modules/*}/.git" ;;
      esac
      break
    fi
    [[ "$d" == "/" ]] && return 1
    d="${d%/*}"
    [[ -n "$d" ]] || d=/
  done
  (cd "$g" 2>/dev/null && pwd -P)
}

# xrepo_excluded PATH — 0 when PATH sits under a root sessions write to by design.
xrepo_excluded() {
  local t="${TMPDIR:-/tmp}"
  t="${t%/}"
  case "$1/" in
    "$HOME/.claude/"* | "$t/"* | /tmp/claude-* | /var/tmp/*) return 0 ;;
  esac
  return 1
}

OWN_ID=$(xrepo_identity "$XR_CWD") || exit 0

HIT_IDS=()
HIT_KINDS=()
HIT_DESCS=()
# xrepo_check PATH KIND DESC — record a hit when PATH belongs to another repo.
# The exclusion is tested on the path as written AND on its physical directory:
# ~/.claude is a symlink into a dotfiles repo on synced setups, and /tmp is
# /private/tmp on macOS.
xrepo_check() {
  local p="$1" d id i
  xrepo_excluded "$p" && return 0
  d=$(xrepo_canon_dir "$p") || return 0
  xrepo_excluded "$d" && return 0
  id=$(xrepo_identity "$d") || return 0
  [[ "$id" == "$OWN_ID" ]] && return 0
  for ((i = 0; i < ${#HIT_IDS[@]}; i++)); do
    [[ "${HIT_IDS[$i]}" == "$id" ]] && return 0
  done
  HIT_IDS+=("$id")
  HIT_KINDS+=("$2")
  HIT_DESCS+=("$3")
}

# xrepo_abs PATH BASE — PATH made absolute: `~` and `~/…` are HOME, a relative
# path is taken from BASE. Quote characters are dropped first — all of them,
# so a partly quoted word (`"/a/b"/src`) is the path the shell would see.
xrepo_abs() {
  local p="$1"
  p="${p//\"/}"
  p="${p//\'/}"
  case "$p" in
    \~) p="$HOME" ;;
    \~/*) p="$HOME/${p#\~/}" ;;
    /*) ;;
    *) p="$2/$p" ;;
  esac
  printf '%s' "$p"
}

# xrepo_ref_writes KIND ARGS… — does `git branch|tag ARGS` change a ref?
# A write flag wins; else a listing flag means a read; else a positional name
# creates one. `git tag -a` annotates and `git branch -a` lists, which is why
# the flags are per-kind. Tokens carrying `<`/`>` are redirections, not names.
xrepo_ref_writes() {
  local kind="$1" a listing=0 pos=0 skip=0
  shift
  for a in "$@"; do
    # A bare redirection operator (`2> /dev/null`) takes the next word as its
    # target; a `#` word starts a comment. Neither names a ref.
    if ((skip)); then
      skip=0
      continue
    fi
    case "$a" in
      '#'*) break ;;
      *'>' | *'<') skip=1 ;;
    esac
    case "$a" in
      -d | -D | -f | -m | -M | --delete | --force) return 0 ;;
    esac
    if [[ "$kind" == branch ]]; then
      case "$a" in
        -c | -C | --copy | --move | -u | --set-upstream-to=* | --unset-upstream | --edit-description) return 0 ;;
        -a | -r | --all | --remotes) listing=1 ;;
      esac
    else
      case "$a" in
        -a | -s | -u | -F | --annotate | --sign | --file=* | --message=*) return 0 ;;
      esac
    fi
    case "$a" in
      -l | --list | --contains* | --no-contains* | --merged* | --no-merged* | --points-at* | --sort* | --format* | -n* | --column* | --show-current | -v | -vv | --verbose | --verify | -i | --ignore-case) listing=1 ;;
      -*) ;;
      *'<'* | *'>'*) ;;
      *) pos=1 ;;
    esac
  done
  ((listing)) && return 1
  ((pos))
}

# xrepo_git_writes SUB ARGS… — is `git SUB ARGS` a write to the repository?
xrepo_git_writes() {
  local sub="$1"
  shift
  case "$sub" in
    commit | push | pull | checkout | switch | merge | reset | rebase | cherry-pick | revert | add | rm | mv | restore | am | apply | clean) return 0 ;;
    stash)
      case "${1:-}" in list | show) return 1 ;; esac
      return 0
      ;;
    worktree)
      case "${1:-}" in add | remove | move) return 0 ;; esac
      return 1
      ;;
    branch | tag)
      xrepo_ref_writes "$sub" "$@"
      return
      ;;
  esac
  return 1
}

# xrepo_operand — toks[JI] as one operand, in ARG. `read -a` splits a quoted
# path with spaces, so a word opening a quote is re-joined until its quotes
# pair up (the closing one need not end a word: `"/a b"/src`), and `a\ b` is
# re-joined too. JI is left on the last word used.
xrepo_operand() {
  local q="" qs
  ARG="${toks[$JI]:-}"
  case "$ARG" in
    \"*) q='"' ;;
    \'*) q="'" ;;
  esac
  if [[ -n "$q" ]]; then
    while :; do
      qs="${ARG//[^$q]/}"
      ((${#qs} % 2 == 1 && JI + 1 < ${#toks[@]})) || break
      JI=$((JI + 1))
      ARG+=" ${toks[$JI]}"
    done
  else
    while [[ "$ARG" == *'\' ]] && ((JI + 1 < ${#toks[@]})); do
      JI=$((JI + 1))
      ARG="${ARG%\\} ${toks[$JI]}"
    done
  fi
}

# xrepo_scan_bash — walk the command's segments, tracking the directory a
# literal `cd` moved to, and check every git write against its repo. A `( … )`
# subshell's `cd` ends with it: the directory is saved at a leading `(` and
# restored after the segment holding the unmatched `)` — at its end, or before a
# redirection or a comment. A `$( … )` within one segment is balanced and
# closes nothing.
xrepo_scan_bash() {
  local view seg cur t word sub arg closes
  local -a toks rest saved
  [[ "$XR_CMD" == *git* ]] || return 0
  # Heredoc bodies are data, not commands; newlines become `;`. Quote
  # characters are KEPT (hook_trigger_view would empty `cd "/path"`).
  view=$(printf '%s' "$XR_CMD" | hook_strip_heredoc_bodies | hook_flatten_cmd)
  # `|`, `;` and `&` as separators also cut `||` and `&&` (into an empty
  # segment, skipped below); `2>&1` splits into pieces no command starts with.
  view="${view//|/$'\n'}"
  view="${view//;/$'\n'}"
  view="${view//&/$'\n'}"
  cur="$XR_CWD"
  saved=()
  while IFS= read -r seg; do
    # Leading grouping / negation, then VAR=value prefixes. Each leading `(`
    # saves the directory; each unmatched `)` restores it once the segment has
    # run.
    while :; do
      seg="${seg#"${seg%%[![:space:]]*}"}"
      case "$seg" in
        '('*)
          seg="${seg:1}"
          saved+=("$cur")
          ;;
        '{'* | '!'*) seg="${seg:1}" ;;
        *) break ;;
      esac
    done
    word="${seg//[^)]/}"
    arg="${seg//[^(]/}"
    closes=$((${#word} - ${#arg}))
    if ((closes > 0)); then
      seg="${seg//)/ }"
    else
      closes=0
    fi
    while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+(.*)$ ]]; do
      seg="${BASH_REMATCH[1]}"
    done
    toks=()
    [[ -n "$seg" ]] && read -r -a toks <<< "$seg"
    case "${toks[0]:-}" in
      cd)
        # `cd -P`, `-L`, `-e`, `-@` and `--` come before the target.
        JI=1
        while :; do
          case "${toks[$JI]:-}" in
            --)
              JI=$((JI + 1))
              break
              ;;
            -*) [[ "${toks[$JI]}" =~ ^-[LPe@]+$ ]] && JI=$((JI + 1)) || break ;;
            *) break ;;
          esac
        done
        xrepo_operand
        arg="$ARG"
        if [[ -z "$arg" ]]; then
          cur="$HOME"
        elif [[ "$arg" == "-" || "$arg" == *'$'* || "$arg" == *'`'* ]]; then
          cur=""
        elif [[ -n "$cur" || "$arg" == /* || "$arg" == "~"* ]]; then
          cur=$(xrepo_abs "$arg" "$cur")
        fi
        ;;
      git)
        t="$cur"
        sub=""
        rest=()
        local i=1 n=${#toks[@]}
        while ((i < n)); do
          word="${toks[$i]}"
          if [[ -z "$sub" ]]; then
            case "$word" in
              -C)
                JI=$((i + 1))
                xrepo_operand
                i=$JI
                arg="$ARG"
                if [[ -z "$arg" || "$arg" == *'$'* || "$arg" == *'`'* ]]; then
                  t=""
                elif [[ -n "$t" || "$arg" == /* || "$arg" == "~"* ]]; then
                  t=$(xrepo_abs "$arg" "$t")
                fi
                ;;
              -c) i=$((i + 1)) ;;
              -*) ;;
              *) sub="$word" ;;
            esac
          else
            rest+=("$word")
          fi
          i=$((i + 1))
        done
        if [[ -n "$sub" && -n "$t" ]] && xrepo_git_writes "$sub" ${rest[@]+"${rest[@]}"}; then
          xrepo_check "$t" git "git $sub"
        fi
        ;;
    esac
    while ((closes > 0 && ${#saved[@]} > 0)); do
      cur="${saved[${#saved[@]} - 1]}"
      unset "saved[${#saved[@]} - 1]"
      closes=$((closes - 1))
    done
  done <<< "$view"
}

case "$XR_TOOL" in
  Bash) xrepo_scan_bash ;;
  *)
    [[ -n "$XR_PATH" ]] || exit 0
    xrepo_check "$(xrepo_abs "$XR_PATH" "$XR_CWD")" file "$XR_TOOL"
    ;;
esac

((${#HIT_IDS[@]} > 0)) || exit 0

OWN_ROOT="${OWN_ID%/.git}"
OWN_NAME="${OWN_ROOT##*/}"
XR_STATE_DIR="$HOME/.claude/.claudemd-state"
XR_SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
ALLOW_LIST=()
if [[ -n "${CROSS_REPO_WRITE_ALLOW:-}" ]]; then
  IFS=: read -r -a ALLOW_LIST <<< "$CROSS_REPO_WRITE_ALLOW"
fi

MSG=""
for ((h = 0; h < ${#HIT_IDS[@]}; h++)); do
  ID="${HIT_IDS[$h]}"
  T_ROOT="${ID%/.git}"
  T_NAME="${T_ROOT##*/}"
  ALLOWED=false
  for a in ${ALLOW_LIST[@]+"${ALLOW_LIST[@]}"}; do
    # settings.json `env` values are literal, so `~/x` and `$HOME/x` arrive
    # unexpanded; expand those two. Any other relative entry is ignored.
    case "$a" in
      \~/*) a="$HOME/${a#\~/}" ;;
      '$HOME/'*) a="$HOME/${a#\$HOME/}" ;;
      '${HOME}/'*) a="$HOME/${a#\$\{HOME\}/}" ;;
    esac
    [[ "$a" == /* ]] || continue
    if [[ "$(xrepo_identity "$a" 2>/dev/null)" == "$ID" ]]; then
      ALLOWED=true
      break
    fi
  done
  # The claim is an O_CREAT|O_EXCL create, so concurrent calls (several Edits
  # in one assistant message) announce a repo exactly once. With no session id
  # there is nothing to key on, and every hit is announced.
  FIRST=true
  if [[ "$ALLOWED" == true ]]; then
    FIRST=false
  elif [[ -n "$SESSION_ID" ]]; then
    XR_KEY=$(printf '%s' "$ID" | cksum 2>/dev/null | awk '{print $1"-"$2}')
    if [[ -n "$XR_KEY" ]] && mkdir -p "$XR_STATE_DIR" 2>/dev/null; then
      (set -o noclobber; : > "$XR_STATE_DIR/xrepo-${XR_SAFE_SID}-${XR_KEY}") 2>/dev/null || FIRST=false
    fi
  fi
  EXTRA=$(jq -cn --arg k "${HIT_KINDS[$h]}" --arg tool "$XR_TOOL" --arg o "$OWN_NAME" --arg t "$T_NAME" \
    --argjson f "$FIRST" --argjson al "$ALLOWED" \
    '{kind:$k, tool:$tool, own:$o, target:$t, first:$f, allowlisted:$al}' 2>/dev/null) || EXTRA='null'
  hook_record cross-repo-write cross-repo-advisory "$EXTRA" '§5-scope' "$SESSION_ID" "$TOOL_USE_ID"
  [[ "$FIRST" == true ]] || continue
  MSG+="[claudemd] system-injected: this ${HIT_DESCS[$h]} writes into the git repo ${T_NAME} (${T_ROOT}), but this session's project is ${OWN_NAME} (${OWN_ROOT}). Spec §5: files outside the grant need the user's AUTH. If the user did not ask for work in ${T_NAME}, stop and ask before writing there. If they did, do git work in ${T_NAME} from a separate checkout made with \`git worktree add\` rather than switching branches in its shared working tree — another session may be using it. Advisory only; told once per repo per session; disable with DISABLE_CROSS_REPO_WRITE_HOOK=1."$'\n'
done

[[ -n "$MSG" ]] || exit 0
jq -cn --arg ctx "${MSG%$'\n'}" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null
exit 0
