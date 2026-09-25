---
status: implemented
revision: 6
---

# Cross-repo write advisory

## goal

Tell the agent, before the write runs, that a tool call is about to write into a git
repository other than the session's own project, so that a cooperative agent stops and
asks instead of carrying on. Phase 1 is advisory and opt-in. It changes no verdict and
exists to collect the false-positive data that §EXT §13.3 requires before any default-ON
or deny step.

Incident that motivated it (2026-09-25): a session whose cwd was
`/home/ai/dev/claude-mem-lite` edited two files in `/home/ai/dev/claudemd`, ran
`git switch -c`, and committed. The claudemd working tree is shared, so HEAD was on another
live session's branch by then (`memgate-gh-readonly`, checked out one second after the
switch). The commit landed on that branch. The session then ran `git branch -f` and
`git reset --keep` on the other session's branch to undo it. Nothing was lost, but only
because `--keep` preserved the other session's uncommitted edits.

Baseline (all transcripts, 747 sessions with tool calls, 2026-09-05..09-25): 2 sessions
wrote into another repo. `4555aa6b` (cwd claudemd, 2026-09-22) committed in claude-mem-lite
and daagu on a user-authorized task, and ran `git push origin --delete` in sgc, which no user
prompt in that session names; one more of its calls deleted local branches in
code-graph-mcp and loop-testing. `9bc9a9aa` is the incident. Every other cross-repo tool
call in the window was a read (`git log`, `git show`, `git merge-base`, `git merge-tree`,
`git tag | grep`, `git branch --contains`).

## non-goals

- Denying anything. Phase 1 never sets `permissionDecision`.
- Bash file writes that do not go through git: `sed -i`, `>`/`>>`, `tee`, `cp`, `mv`, `rm`
  into another repo. Detecting them requires parsing redirections and operands. The §8 rm
  gate shows what that costs, and neither baseline session used one. Revisit with phase 1
  data.
- Paths held in variables (`R=~/dev/x; cd "$R"`), `pushd`, `eval`, `bash -c`. The hook
  reads literal paths only. It is a guardrail for cooperative mistakes, not an
  anti-injection boundary (same stance as the pre-bash-safety header).
- Detecting that another session is live in the target repo. There is no cheap signal,
  and the advisory's worktree advice covers the damage path.
- Writes outside any git repository, and writes under `~/.claude/`, `${TMPDIR:-/tmp}`,
  `/tmp/claude-` (Claude Code's scratchpad root, which stays under `/tmp` when `TMPDIR` is
  set elsewhere) or `/var/tmp/`.
  These are memory, scratchpad and tool-exhaust paths that sessions write to by design.

## constraints

- **Opt-in, default OFF**: `CROSS_REPO_WRITE=1` enables it (same shape as
  `REWORK_BREAKER` / `EVIDENCE_GATE` / `LEDGER_STALENESS`). The flag is checked before
  `hook-common.sh` is sourced, so the default path costs one string compare, with no jq
  spawn and no telemetry row. Kill switch after opt-in: `DISABLE_CROSS_REPO_WRITE_HOOK=1`,
  plus the global `DISABLE_CLAUDEMD_HOOKS=1`.
- **Registration**: one script, `hooks/cross-repo-write-check.sh`, registered for
  PreToolUse on `Edit|Write|NotebookEdit` and on `Bash`. It follows every step of
  `docs/ADDING-NEW-HOOK.md`: HOOK_REGISTRY, toggle.md, RULE-HITS-SCHEMA, README
  kill-switch row, ARCHITECTURE taxonomy + state location, fail-open, hook-budget,
  jq-spawn budget, bash 3.2 parse + runtime, shellcheck.
- **Repo identity**: walk up from the path, or from its nearest existing ancestor, to the
  first `.git` entry. A `.git` directory is its own identity. A `.git` file (worktree or
  submodule) is resolved through its `gitdir:` line. A gitdir holding a `commondir` file
  (every linked worktree, including the bare-repo `proj.git/worktrees/<n>` layout)
  resolves through it; otherwise a `…/.git/worktrees/<n>` or `…/.git/modules/<n>` gitdir
  collapses to the `.git` that owns it, and identities are
  compared after `pwd -P`, so `..` and symlinks do not split one repo into two. A
  worktree or submodule of the session's own repo is therefore NOT cross-repo, and a
  worktree of another repo IS. No `git` process is spawned; the walk is
  `[[ -e ]]` / `read` only.
- **Own repo** is the identity of the event's `cwd`. If cwd is in no repo, the hook exits 0.
- **Edit / Write / NotebookEdit**: the target is `tool_input.file_path` (or
  `notebook_path`), resolved against cwd when relative. It is a hit when the target
  identity exists, differs from own, and the path is not under an excluded prefix.
- **Bash**:
  - Parse a heredoc-stripped, newline-flattened view that keeps quote characters. Take
    the path of a `cd` or `-C` operand from inside its quotes, or across a `\ ` escape;
    `cd -P/-L/-e/-@/--` options come before it. A `( … )` subshell's `cd` ends at its
    unmatched `)`, also when a redirection or comment follows; a `$( … )` is balanced
    within its segment and closes nothing. `hook_trigger_view` cannot
    be reused, because it empties quoted bodies and loses `cd "/path"`.
  - Split the view into segments on `;` `&&` `||` `|`. Track the last literal absolute or
    `~` `cd` target; a later segment's git write is attributed to it, or to `git -C <p>`
    when present, else to cwd.
  - Git write subcommands: `commit push checkout switch merge reset rebase cherry-pick
    revert add rm mv restore am apply clean pull`, `stash` except `stash list|show`,
    `worktree add|remove|move`.
  - `branch` counts only with `-f -d -D -m -M -c -C` or a first positional name. `tag`
    counts only with `-a -d -f -s -u` or a first positional name.
  - Listing forms are reads: `branch -a/-r/-l/--list/--contains/--merged/--show-current`,
    `tag -l/--list/--contains/--points-at`, and bare `tag` / `branch`.
- **Output on a hit**: `hookSpecificOutput {hookEventName: "PreToolUse", additionalContext}`,
  with `suppressOutput: true`, once per (session, target repo). A sentinel under
  `~/.claude/.claudemd-state/xrepo-<session>-<hash>` suppresses repeats, and
  `clean-residue` learns the prefix. Every hit writes a telemetry row, repeat or not.
- **Message** (English, names both repos): the call writes into repo B while the
  session's project is A. If the user did not ask for work in B, stop and ask. If they
  did, do git work in B from a `git worktree add` checkout, not by switching branches in
  B's shared working tree, which another session may be using.
- **Telemetry**: `hook_record cross-repo-write cross-repo-advisory {kind, tool, own, target, first, allowlisted}`
  under section `§5-scope` (§5: files outside the grant → re-AUTH). `own` and `target`
  are repo basenames, not full paths. This is an advisory, not a blocking deny, so it
  needs no `spec/hard-rules.json` entry.
- **Allowlist**: `CROSS_REPO_WRITE_ALLOW` holds colon-separated absolute repo roots; a
  leading `~/` or `$HOME/` is expanded (settings.json `env` values arrive literal), and
  any other relative entry is ignored. A hit
  on a listed repo is recorded with `allowlisted:true` and gets no message.

## success-criteria

1. **Replay against labels.** Drive the hook over every Edit/Write/NotebookEdit/Bash call
   in `~/.claude/projects/*/*.jsonl` and `*/subagents/*.jsonl`, each with its recorded
   `cwd`.
   - It must flag every write in the incident session `9bc9a9aa` (2 Edits, `git switch -c`,
     `git add`/`commit`, `git branch -f`, `git reset --keep`).
   - It must flag every write in `4555aa6b` (sgc `git push origin --delete`,
     claude-mem-lite and daagu `git add`/`commit`).
   - It must flag none of the cross-repo reads in the window. Every other hit is listed
     and hand-labelled in the implementation report; an unlabelled hit fails this
     criterion.
2. **Default path.** With `CROSS_REPO_WRITE` unset: no stdout, no rule-hits row, 0 jq
   spawns. `preToolUse-jq-spawn-budget` ceilings unchanged.
3. **Hook tests.**
   - The ADDING-NEW-HOOK set: pass, advisory, kill switch, global kill, fail-open.
   - Worktree identity rows: an own worktree is not a hit, another repo's worktree is.
   - Exclusion rows: `~/.claude`, `$TMPDIR`, a non-repo path; a submodule of the own repo.
   - A repeat-suppression row, and an allowlist row.
   - Bash rows: every write subcommand; a read control for each of `branch` / `tag` /
     `stash` / `merge-base` / `merge-tree`; `git -C`; a quoted `cd`; and a `cd` into
     another repo followed by a write in the same repo that cd'd back.
   - Mutation check: dropping the read-form list, or the worktree collapse, must turn at
     least one row red.
4. **Latency.** Flag on, a 1000-call replay sample: p95 per call under 50 ms on this host
   (baseline recorded in the report), within the 3 s hooks.json timeout.
5. **Gates.** `npm run check` exit 0 after `git add`; `npm run smoke` last line cited.
6. **Pre-registered phase-1 evaluation.** Starts when the maintainer sets
   `CROSS_REPO_WRITE=1`; T0 is the first row. Stop at 30 days or 20 advisories, whichever
   comes later. Metrics:
   - advisories per 100 sessions;
   - the share of advisories on user-authorized work, labelled by reading the session's
     prompts (the noise an agent is asked to confirm);
   - for unauthorized hits, the share where the agent stopped, asked, or reverted within
     its next 3 tool calls;
   - hook p95 latency from the replay harness.

   Decision rule for proposing default-ON advisory: at least one unauthorized hit where
   the agent changed course, and advisories on authorized work at most 1 per 20 sessions.
   Deny is not on the table before a default-ON phase has its own data.

## open-questions

Resolved at r2 (user confirmed the proposed answers):

- One advisory per (session, target repo); telemetry on every hit.
- `git pull` into another repo counts as a write (it moves HEAD and the worktree);
  `git fetch` does not.
- Plugin version: minor bump, 0.95.0, no migration note (additive, default OFF).

Produces:

- Produces: `hooks/cross-repo-write-check.sh` — the opt-in PreToolUse advisory hook (`CROSS_REPO_WRITE=1`).
- Produces: `xrepo_identity` — repo identity from a path with worktree collapse, no git spawn.
- Produces: `tests/hooks/cross-repo-write.test.sh` — the success-criteria 3 rows.

# Change log

- r1 2026-09-25: initial draft from the 2026-09-25 incident and the 747-session replay;
  user approved "write the spec first, show it before code".
- r2 2026-09-25: approved; open questions resolved as proposed (`pull` added to the write set).
- r3 2026-09-25: two constraint tightenings found while designing the tests — the tmp
  exclusion is `${TMPDIR:-/tmp}` + `/tmp/claude-` rather than all of `/tmp` (identical when
  TMPDIR is unset, and testable), and submodule gitdirs collapse like worktree gitdirs.
- r4 2026-09-25: `/var/tmp/` added to the exclusions. The criterion-1 replay (22,938 calls)
  produced 15 hits: 9 true writes into another repo and 6 throwaway `git init` sandboxes
  under `/var/tmp/cgqa`.
- r5 2026-09-25: pre-merge review repairs. A non-absolute allowlist entry made the path
  walk spin until the harness timeout (fail-open broken); bare-repo worktrees are
  resolved through `commondir`; a subshell's `)` ends it and restores the directory;
  `-C` operands with spaces and `cd` options are parsed; a redirection target or a
  comment word after `git branch|tag` is not a ref name, and `tag --verify` is a read.
  Replay re-run over 23,075 calls: the same 9 calls flagged.
- r6 2026-09-25: second review round. A subshell `)` followed by a redirection or comment
  now closes it, and a `$( … )` no longer does (a new miss the r5 repair introduced);
  a partly quoted `cd` target resolves; a worktree of the own submodule is the own repo;
  combined `cd` options (`-eP`) are skipped. Replay over 23,315 calls: 9 calls flagged
  (10 repo hits), no verdict change from r5, 0 non-zero exits, 0 stderr.
