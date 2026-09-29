# shellcheck shell=bash
# wtree.sh — a working-tree CONTENT fingerprint: the git tree hash of the whole
# working tree, tracked and untracked-not-ignored files alike, without touching
# the real index (tasks/specs/wtree-evidence.md, R3).
#
# Ported from gstack's bin/gstack-wtree (MIT, Copyright (c) 2026 Garry Tan,
# https://github.com/garrytan/gstack @ d2a0bbc). Kept from it, with its reasons:
#   - the temp index is seeded by COPYING the real one, so `git add -A` re-hashes
#     only files whose stat changed; `touch -r` restores the copy's mtime so
#     git's racy-entry check still re-hashes a same-second, same-size rewrite;
#     a failed touch falls back to a `read-tree HEAD` seed (slower, honest);
#   - the real index path is resolved BEFORE GIT_INDEX_FILE is exported, which
#     would otherwise make `--git-path index` return the temp file itself.
# Why content and not HEAD: committing the same content keeps the hash, a new
# untracked source file changes it, and so does a file rewritten through Bash —
# the edit channel Edit/Write-keyed instruments cannot see.
#
# Side effect, disclosed: `git add -A` into the temp index writes the blobs of
# modified and untracked, non-ignored files into .git/objects, and write-tree
# writes tree objects; they stay there unreachable until a `git gc` prunes them
# (by default once they are older than gc.pruneExpire, two weeks) — the same
# property `git stash -u` has. Opt-in callers only.

# wtree_hash DIR -> prints the tree hash; returns 1 outside a git work tree, in
# a repo with no commit, or on any git failure. Callers treat that as "no
# fingerprint". The temp index is removed before returning.
wtree_hash() {
  local dir="$1" top real tmpidx hash rc=1
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  git -C "$top" rev-parse --verify -q HEAD >/dev/null 2>&1 || return 1
  real=$(git -C "$top" rev-parse --git-path index 2>/dev/null) || real=""
  case "$real" in
    "" | /*) ;;
    *) real="$top/$real" ;;
  esac
  tmpidx=$(mktemp "${TMPDIR:-/tmp}/claudemd-wtree-XXXXXX") || return 1
  # The callers bound this at 2 s with platform_timeout, which stops the shell
  # with SIGTERM (GNU timeout and the bash watchdog alike). Without a trap the
  # temp index outlived every such stop (0.105.0 pre-tag review M3). Bash runs
  # the trap once the git child it waits on has exited. The trap is dropped
  # again before returning, so a caller's own shell keeps its handlers.
  _wtree_tmp=$tmpidx
  trap 'rm -f -- "$_wtree_tmp" "$_wtree_tmp.lock"; exit 143' TERM INT
  if [[ -n "$real" && -f "$real" ]] && cp "$real" "$tmpidx" 2>/dev/null && touch -r "$real" "$tmpidx" 2>/dev/null; then
    :
  else
    rm -f "$tmpidx"
    GIT_INDEX_FILE="$tmpidx" git -C "$top" read-tree HEAD 2>/dev/null || { rm -f "$tmpidx"; trap - TERM INT; return 1; }
  fi
  if GIT_INDEX_FILE="$tmpidx" git -C "$top" add -A 2>/dev/null \
    && hash=$(GIT_INDEX_FILE="$tmpidx" git -C "$top" write-tree 2>/dev/null) && [[ -n "$hash" ]]; then
    printf '%s\n' "$hash"
    rc=0
  fi
  rm -f "$tmpidx"
  trap - TERM INT
  return "$rc"
}

# gstack's license, for the portion ported above:
#
# MIT License
#
# Copyright (c) 2026 Garry Tan
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
