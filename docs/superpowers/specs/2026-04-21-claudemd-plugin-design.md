# claudemd Plugin — Design Document

**Date**: 2026-04-21
**Status**: Approved (brainstorming phase complete, pending implementation plan)
**Target plugin version**: v0.1.0
**Target shipped spec version**: v6.9.2 (bump from installed v6.9.0)
**Estimated effort**: ~5.5 focused days (M1–M7)

---

## 0. Context

### 0.1 Problem statement

User has iterated `~/.claude/CLAUDE.md` (24,903 chars, v6.9.0), `CLAUDE-extended.md` (37,434), `CLAUDE-changelog.md` (16,592) through multiple versions, and hand-installed `~/.claude/hooks/banned-vocab-*` (v0, 12/12 sandbox tests passing). Growing functionality needs packaging to achieve:

1. One-command multi-machine install via `/plugin install`
2. Safe spec distribution with user-override capability (backup-before-overwrite)
3. Cross-tool/cross-skill/memory orchestration rules that auto-compose with existing plugin stack
4. Architectural discipline that prevents core-CLAUDE.md bloat as rules accrete

### 0.2 Prior art

- `claude-spec-hooks-PLAN.md` (1023 lines, 2026-04-21) — foundational plugin blueprint
- `claude-mem-lite` and `gsd-lite` plugins — reference install/uninstall/settings-merge patterns (Node.js + bash hybrid)
- `superpowers` + `gstack` — default skill stack claudemd must coexist with

### 0.3 Renaming (vs PLAN.md)

- **Plugin name**: `claude-spec-hooks` → `claudemd` (plugin.json `name`)
- **Marketplace short name**: `claudemd` (unified)
- **Commands**: `/spec-*` → `/claudemd-*` (status/update/audit/toggle/doctor)

### 0.4 Primary user

Solo developer running Claude Code with `bypassPermissions` + `AUTONOMY_LEVEL: aggressive`, for whom self-discipline alone leaves known failure modes (v0.8.3 tmp-dir leak, v0.11.4 ship-baseline + MEMORY.md miss, §10 vague-vocab drift).

### 0.5 Success metric

Every rule this plugin enforces either (a) blocks an action that the spec says should block, or (b) writes an observable log row to `rule-hits.jsonl` proving it didn't need to fire. Whichever happens, next operator self-audit (spec §13.1) has data instead of vibes.

---

## 1. Architecture

### 1.1 Three layers

```
┌─ L3 Slash commands (markdown in commands/)                   ┐
│  /claudemd-status  /claudemd-update  /claudemd-audit         │
│  /claudemd-toggle  /claudemd-doctor                          │
└────────────────────┬─────────────────────────────────────────┘
                     │ invokes
┌────────────────────▼─────────────────────────────────────────┐
│ L2 Node.js scripts (scripts/*.js)                            │
│  install.js  uninstall.js  update.js  status.js  audit.js    │
│  toggle.js  doctor.js                                        │
│  lib/: settings-merge.js / rule-hits-parse.js / paths.js /   │
│        spec-diff.js / backup.js                              │
└────────────────────┬─────────────────────────────────────────┘
                     │ manages
┌────────────────────▼─────────────────────────────────────────┐
│ L1 Hooks (hooks/*.sh, deterministic shell, <50ms nominal)    │
│  1. banned-vocab-check.sh        PreToolUse:Bash             │
│  2. ship-baseline-check.sh       PreToolUse:Bash             │
│  3. residue-audit.sh             Stop                        │
│  4. memory-read-check.sh         PreToolUse:Bash (fail-open) │
│  5. sandbox-disposal-check.sh    Stop                        │
│  lib/: hook-common.sh / rule-hits.sh / platform.sh           │
└──────────────────────────────────────────────────────────────┘
            ↑ Claude Code invokes per settings.json
            ↑ reads hook libs by relative ${BASH_SOURCE[0]} path
```

### 1.2 Product tree

```
claudemd/
├── .claude-plugin/
│   └── plugin.json                   # Plugin manifest (Claude Code format)
├── marketplace.json                  # Self-host marketplace entry (name: claudemd)
├── package.json                      # npm metadata + version + bin entries
├── README.md                         # User-facing: 30-sec bootstrap / commands / kill-switches
├── CHANGELOG.md                      # Plugin semver history
├── LICENSE                           # MIT
│
├── spec/                             # (b) Wide distribution: spec v6.9.2 trio
│   ├── CLAUDE.md                     # v6.9.2 core (~5,250 tokens, with §0.1 + §2.3)
│   ├── CLAUDE-extended.md            # with §1.5-EXT, §5.1-EXT, §7-EXT, §11-EXT
│   └── CLAUDE-changelog.md           # with v6.9.2 entry appended
│
├── hooks/
│   ├── banned-vocab-check.sh         # Migrated from v0 hand-install
│   ├── banned-vocab.patterns         # data for above
│   ├── ship-baseline-check.sh        # PreToolUse:Bash — §7 Ship-baseline (P0 new)
│   ├── residue-audit.sh              # Stop — §7 User-global-state audit (P0 new)
│   ├── memory-read-check.sh          # PreToolUse:Bash — §11 MEMORY.md read-the-file
│   ├── sandbox-disposal-check.sh     # Stop — §8.V4 Sandbox disposal
│   └── lib/
│       ├── hook-common.sh            # kill-switch, jq check, event parse, JSON emit
│       ├── rule-hits.sh              # append-to-jsonl helper
│       └── platform.sh               # stat/find cross-platform (GNU vs BSD)
│
├── commands/
│   ├── claudemd-status.md            # /claudemd-status
│   ├── claudemd-update.md            # /claudemd-update
│   ├── claudemd-audit.md             # /claudemd-audit [--days N]
│   ├── claudemd-toggle.md            # /claudemd-toggle <name>
│   └── claudemd-doctor.md            # /claudemd-doctor [--prune-backups <N>[dwmy]]
│
├── scripts/
│   ├── install.js                    # postInstall — idempotent, Q1 backup-and-overwrite model
│   ├── uninstall.js                  # preUninstall — 3-way (keep/delete/restore), hard AUTH on delete
│   ├── update.js                     # /claudemd-update — diff + selective apply
│   ├── status.js                     # /claudemd-status — dual-version + drift
│   ├── audit.js                      # /claudemd-audit
│   ├── toggle.js                     # /claudemd-toggle
│   ├── doctor.js                     # /claudemd-doctor
│   └── lib/
│       ├── settings-merge.js         # idempotent ~/.claude/settings.json merge
│       ├── rule-hits-parse.js        # read ~/.claude/logs/claudemd.jsonl
│       ├── paths.js                  # single source of truth for paths
│       ├── spec-diff.js              # spec file diff with section awareness
│       └── backup.js                 # backup-<ISO> creation + N=5 retention
│
├── tests/
│   ├── run-all.sh                    # top-level entry
│   ├── hooks/                        # per-hook shell tests
│   ├── scripts/                      # Node.js tests (node --test)
│   ├── integration/                  # full-lifecycle
│   └── fixtures/                     # events / settings / transcripts / spec samples
│
└── docs/
    ├── ARCHITECTURE.md               # this doc → post-implementation
    ├── HOOK-PROTOCOL.md              # Claude Code hook IO contract reference
    ├── ADDING-NEW-HOOK.md            # step-by-step for adding a 6th / 7th hook
    └── RULE-HITS-SCHEMA.md           # jsonl row schema
```

### 1.3 Design invariants

1. **L1 never imports L2** — if plugin install is broken, hooks still work (or fail-open). If hooks are broken, commands still run.
2. **Fail-open everywhere** — any internal error in a hook → exit 0 silent. A broken hook must never block legitimate work.
3. **`${CLAUDE_PLUGIN_ROOT}` is a hint, not a durable path** — scripts derive base path from `__dirname` / `${BASH_SOURCE[0]}`. (Noted in PLAN.md §11 with code-graph-mcp precedent.)
4. **Spec files are artifacts, not code** — hooks do not read `~/.claude/CLAUDE.md` at runtime.
5. **Append-only on settings.json** — never delete or reorder other plugins' entries.

### 1.4 Deltas vs PLAN.md (resolved during brainstorming)

| # | Delta | Source |
|---|---|---|
| D1 | Command prefix `/spec-*` → `/claudemd-*` | Post-Q1 naming unification |
| D2 | New `/claudemd-doctor` command (5 commands vs 4) | Coexistence health needs |
| D3 | L2 gains `update.js` + `lib/spec-diff.js` + `lib/backup.js` | Q1 Backup-and-overwrite model |
| D4 | L1 ships all 5 hooks at v0.1.0 (not 3 P0 only) | Q2 choice (c) |
| D5 | New `lib/platform.sh` for GNU/BSD stat divergence | Q2 (c) brings cross-platform concern |
| D6 | `§2.3 TOOLS` in core spec at Tier C (principles + bindings) | Q3 choice (C) |
| D7 | Spec bump to v6.9.2 (not v6.9.1) | Ultrathink round: core reduction + meta-rule |

---

## 2. Install / Update / Uninstall Flows

### 2.1 Install (`/plugin install claudemd@claudemd`)

```
node scripts/install.js
  │
  ├─ 1. Pre-check
  │    - ensure ~/.claude/ exists (mkdir -p if missing)
  │    - detect jq / gh CLI presence (record for doctor; missing gh → ship-baseline fail-open)
  │    - detect hand-installed hooks at ~/.claude/hooks/banned-vocab-*.sh (see §2.6)
  │
  ├─ 2. Spec install branch (Q1 model)
  │    SPEC_FILES = [CLAUDE.md, CLAUDE-extended.md, CLAUDE-changelog.md]
  │    ANY_EXISTS = any of above exists in ~/.claude/
  │
  │    if not ANY_EXISTS:
  │        copy spec/*.md → ~/.claude/
  │        log: "spec installed (fresh)"
  │
  │    else:  # any one or more existing → always backup-and-overwrite
  │        BACKUP_DIR = ~/.claude/backup-<ISO-UTC>/
  │        mkdir -p $BACKUP_DIR
  │        move all existing CLAUDE*.md → $BACKUP_DIR
  │        copy spec/*.md → ~/.claude/
  │        log: "existing spec backed up → $BACKUP_DIR; plugin version installed"
  │        summary: per-file line-count delta (non-interactive diff)
  │
  ├─ 3. Hooks + settings.json merge
  │    - ~/.claude/settings.json → ~/.claude/settings.json.claudemd-backup-<ISO>
  │    - settings-merge.js idempotently injects 5 hook matcher entries
  │    - each command uses ${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh
  │
  ├─ 4. State write
  │    - ~/.claude/.claudemd-state/installed.json (manifest for uninstall)
  │    - ~/.claude/logs/claudemd.jsonl (create empty; will hold rule-hits)
  │
  └─ 5. Summary output
       - 5 hooks enabled / 5 commands registered
       - spec outcome (fresh / backed-up-to-X)
       - kill-switches summary (DISABLE_CLAUDEMD_HOOKS=1, per-hook flags)
       - suggested next step: /claudemd-status or /claudemd-doctor
```

**Idempotency contract**: re-running install.js at the same plugin version results in zero diff on settings.json. Test gate: `tests/scripts/install-uninstall.test.js` runs install 3× and diffs.

### 2.2 Update (`/claudemd-update`)

Always interactive; user explicitly requested — they deserve diff visibility:

```
1. Read plugin spec/*.md (from plugin cache, current installed version)
2. Diff vs ~/.claude/CLAUDE*.md
3. Print summary: per-file × added/removed lines × section-level breakdown
4. Prompt: [a]pply all / [s]elect per-file / [d]iff full / [c]ancel
5. On a/s: backup current ~/.claude/CLAUDE*.md → ~/.claude/backup-<ISO>/
           → overwrite with plugin version
6. Record in installed.json update history
```

**No auto-fetch from GitHub in v0.1.0**. Users wanting the latest plugin version run `/plugin update claudemd` first, then `/claudemd-update`. Two explicit steps — each is a single responsibility.

### 2.3 Uninstall (`/plugin uninstall claudemd`)

Three-way choice on spec files (Q1 decision):

```
1. preUninstall.js reads installed.json
2. Remove this plugin's matcher entries from settings.json (preserve others)
3. Prompt for spec file disposition:
   [k]eep    — ~/.claude/CLAUDE*.md untouched
   [d]elete  — delete files (triggers hard-AUTH confirmation per Q1 answer)
   [r]estore — restore from most recent backup-<ISO>/
4. Handle logs/ and state/: preserved by default; --purge flag to delete
5. Plugin files themselves cleaned by Claude Code's /plugin uninstall
```

### 2.4 Backup retention (Q1 follow-up answer)

- Keep most recent **5** `backup-<ISO>/` directories
- Auto-prune older backups on each install/update after the 5th
- `/claudemd-doctor --prune-backups <N>[dwmy]` lets user prune by age (e.g., 90d)

### 2.5 Boundary: partial existing spec state

If `~/.claude/CLAUDE.md` exists but `CLAUDE-extended.md` does not → treated as "existing" → backup whatever exists + install full trio. No "fill missing only" mode — version coherence across the three files is guaranteed only when all three install together.

### 2.6 Hand-installed hook migration

Current state: `~/.claude/hooks/banned-vocab-check.sh` + `banned-vocab.patterns` are hand-installed (v0). On install:

- **Default (non-interactive)**: move both files to `~/.claude/backup-<ISO>/hooks/`; remove the settings.json matcher pointing to them; plugin cache version takes over.
- No interactive prompt — preserves `/plugin install` single-shot semantics. Users can `/claudemd-update` or manually restore if unsatisfied.

### 2.7 settings.json merge safety (highest-risk operation)

Per PLAN.md §14, this is the highest-risk single operation. Defenses:

- Pre-write backup at `~/.claude/settings.json.claudemd-backup-<ISO>`
- After merge, `JSON.parse` the written file; on parse failure → auto-restore from backup, abort install with clear error
- 20-fixture `tests/scripts/settings-merge.test.js` gates any change to merge logic

---

## 3. Hook Coexistence

### 3.1 Live state audit (2026-04-21)

| Event | Matcher | Existing registrant | claudemd plan |
|---|---|---|---|
| UserPromptSubmit | `*` | claude-mem-lite (2 hooks) | no action |
| PostToolUse | `*` | claude-mem-lite (1) | no action |
| SessionStart | `startup\|clear\|compact` | claude-mem-lite (1) | no action |
| PreToolUse | `Edit\|Write\|NotebookEdit` | claude-mem-lite pre-tool-recall (1) | no action |
| **PreToolUse** | **`Bash`** | v0 hand-installed banned-vocab | replace with 3 plugin hooks |
| **Stop** | **`*`** | claude-mem-lite stop (1) | **append** 2 plugin hooks |

claude-mem-lite and claudemd only share `Stop:*` — both advisory, neither blocks. gstack's `gsd-*.cjs` files physically reside in `~/.claude/hooks/` but are not registered as hooks in settings.json (they're invoked via CLI / skill paths).

### 3.2 Registration strategy (append-only)

```
PreToolUse matcher=Bash:
  Before: [ banned-vocab hand-installed ]
  After:  [
    {plugin} banned-vocab-check     ← replaces hand-installed
    {plugin} ship-baseline-check
    {plugin} memory-read-check
  ]
  Order: banned-vocab first (fastest, ~20ms) → ship-baseline → memory-read-check
         Future peers from other plugins: append at end

Stop matcher=*:
  Before: [ claude-mem-lite stop ]
  After:  [
    claude-mem-lite stop            ← untouched
    {plugin} residue-audit          ← append
    {plugin} sandbox-disposal-check ← append
  ]
```

**Iron rule**: install.js never deletes or reorders other-plugin entries. Only appends. Uninstall removes only entries matching our tag.

### 3.3 Hook identity (for reliable uninstall)

Dual identification (redundant for robustness):

1. **Manifest (primary)**: `~/.claude/.claudemd-state/installed.json` records each appended `command` string + SHA256. Uninstall diffs against manifest and removes matches.
2. **Path fallback (secondary)**: command string containing `${CLAUDE_PLUGIN_ROOT}` OR `claudemd/hooks/` path prefix → ours. Used when manifest is corrupt or absent.

Doctor cross-checks both lines of evidence; mismatch → warn.

### 3.4 Three-tier kill-switch

- **Plugin-wide**: `DISABLE_CLAUDEMD_HOOKS=1` → all 5 hooks short-circuit at the top of `lib/hook-common.sh`.
- **Per-hook**: `DISABLE_BANNED_VOCAB_HOOK=1` / `DISABLE_SHIP_BASELINE_HOOK=1` / `DISABLE_RESIDUE_AUDIT_HOOK=1` / `DISABLE_MEMORY_READ_HOOK=1` / `DISABLE_SANDBOX_DISPOSAL_HOOK=1`.
- **Per-invocation escape hatches**:
  - `[allow-banned-vocab]` in commit message
  - `known-red baseline: <reason>` in commit body
  - `[skip-memory-check]` in Bash command string

All visible in `/claudemd-status` output.

### 3.5 Latency budget

| Matcher | Hook | Typical | Worst | Notes |
|---|---|---|---|---|
| PreToolUse:Bash | banned-vocab | ~20ms | 100ms | pure grep |
| | ship-baseline | 300–500ms | 2s | `gh run list` IO, 2s hard timeout (Q3-followup) |
| | memory-read-check | 100–300ms | 1s | parses session jsonl |
| PreToolUse:Bash total | | ~500ms | 3s | per-git-command overhead |
| Stop:* | residue-audit | 50–100ms | 300ms | `find tmp/ -maxdepth 1` |
| | sandbox-disposal | 50–100ms | 300ms | `find tmp/ -newer baseline` |
| Stop:* total (+ mem-lite) | | ~500–800ms | 2s | session-end one-shot |

### 3.6 `/claudemd-doctor` output shape

```
claudemd v0.1.0 health check

[✓] plugin cache:       ~/.claude/plugins/cache/claudemd/0.1.0  (5 hooks present)
[✓] settings.json:      5 matchers registered, manifest SHA match
[✓] spec files:         ~/.claude/CLAUDE.md = plugin shipped (md5 match)
[△] spec drift:         ~/.claude/CLAUDE-extended.md diverges (edited locally)
[✓] jq:                 present (/usr/bin/jq 1.7)
[△] gh:                 missing → ship-baseline-check will fail-open silent
[✓] kill-switches:      none active
[✓] hook dependencies:  banned-vocab.patterns present, hook-common.sh sourced OK
[✓] coexistence:        no matcher collision; 3 peers detected (claude-mem-lite, gstack, ...)
[△] backups:            7 backup directories in ~/.claude/ (oldest 2026-01-15)
[✓] logs:               rule-hits.jsonl 412 rows, last 4h
```

`--prune-backups <N>[dwmy]` trims by age. `--rollback-spec` (post-v0.1 enhancement) restores from a selected backup.

---

## 4. `§2.3 TOOLS` Content Draft (for spec v6.9.2)

Inserted in core `CLAUDE.md` immediately after `§2.2 ROUTE`. Tier C style per Q3 (C): principles + plugin bindings + anti-patterns. ~450 tokens, 21 lines. English-only (§1 Language contract).

```markdown
### §2.3 TOOLS (orchestration hot-path)

Tool-selection routing. MCP-injected per-tool instructions are authoritative; this section covers cross-tool orchestration.

**Principles** (any tool mix):
1. Escalate cheap → expensive: Grep (exact) → semantic search (concepts) → AST/call-graph (structure).
2. Query shape decides first tool: target name known → Grep first; unknown / conceptual → semantic first.
3. Before Edit on public symbol: impact-analysis tool first (result feeds §5 AUTH).
4. Unfamiliar module: module-overview tool before Read-ing ≥3 of its files.
5. Cross-session questions ("did we / why / past decisions"): memory tool before Grep/Read.

**Plugin bindings** (when installed):
| Need | Tool |
|---|---|
| exact string / symbol / regex | Grep |
| concept / "code that does X" | `code-graph semantic_code_search` |
| who-calls / what-calls | `code-graph get_call_graph` |
| blast radius of change | `code-graph impact_analysis` |
| module layout | `code-graph module_overview` |
| past work / decisions | `mem_search <2-3 keywords>` |
| file history | `mem_recall <file>` |

**Anti-patterns**:
- Parallel-dispatching mem + code-graph on same question — start cheap, escalate on miss.
- Grepping for concepts / semantic-searching for literals — both waste tokens.
- Reading unknown module files one-by-one without overview first.
```

---

## 5. Testing Strategy

### 5.1 Test tree

```
tests/
├── run-all.sh                      # top-level entry
│
├── hooks/                          # shell tests (one file per hook)
│   ├── banned-vocab.test.sh        # 12 cases (port v0 verbatim)
│   ├── ship-baseline.test.sh       # mock gh via PATH prefix
│   ├── residue-audit.test.sh       # faked tmp baseline
│   ├── memory-read-check.test.sh   # faked transcript JSONL
│   └── sandbox-disposal.test.sh    # cross-platform stat branch
│
├── scripts/                        # Node.js tests (node --test)
│   ├── install-uninstall.test.js   # idempotency + migration + rollback
│   ├── settings-merge.test.js      # 20 fixture cases
│   ├── spec-install.test.js        # Q1 model: fresh / backup-and-overwrite
│   ├── backup-retention.test.js    # N=5 retention
│   └── update.test.js              # diff + selective apply
│
├── integration/                    # end-to-end
│   └── full-lifecycle.test.sh      # install → trigger → audit → uninstall
│
└── fixtures/
    ├── events/                     # stdin JSON samples per event type
    ├── settings-samples/           # settings.json pre-states
    ├── transcripts/                # faked session JSONL
    └── spec-samples/               # faked user-version CLAUDE.md
```

### 5.2 Per-hook coverage contract

Every hook must cover:

1. Happy-path pass and happy-path deny
2. `DISABLE_<NAME>_HOOK=1` kill-switch fires
3. `DISABLE_CLAUDEMD_HOOKS=1` global kill-switch fires
4. Non-target event (wrong tool_name) → silent pass
5. Malformed JSON stdin → exit 0 silent (fail-open)
6. Missing dependency (jq/gh absent) → exit 0 silent (fail-open)
7. Rule-hits.jsonl write format correct

### 5.3 Hook-specific notes

**Ship-baseline**:
- Mock `gh` via `PATH=tests/fixtures/mock-gh:$PATH` with three scenario scripts: `pass-green.sh`, `pass-inprogress.sh`, `fail-red.sh`
- Verify `known-red baseline:` bypass recognition
- Verify 2s timeout via mock-gh with `sleep 3`

**Memory-read-check** (the Q2(c) fragility point):
- Fake `~/.claude/projects/<encoded>/memory/MEMORY.md` + `<session>.jsonl`
- Test cases: MEMORY.md hit + session unread → deny; hit + session read → pass; transcript path missing (simulates CC version upgrade) → **fail-open silent, never deny**; `[skip-memory-check]` bypass

**Sandbox-disposal cross-platform**:
- Run on both `ubuntu-latest` and `macos-latest` CI runners
- `lib/platform.sh` exposes `stat_mtime()` internally branching GNU/BSD stat

### 5.4 Install/uninstall key cases

Isolated via `HOME=$(mktemp -d)`:

1. Fresh install (empty `~/.claude/`) → spec trio copied, settings.json created with 5 matchers
2. Existing CLAUDE.md → `backup-<ISO>/` holds old, new installed, summary reports path
3. Idempotent (3× install same version) → settings.json diff == 0 (modulo timestamps)
4. Install different versions (0.1.0 → 0.2.0) → new `backup-<ISO>/`; after 5 backups the 6th triggers doctor recommendation
5. Install failure rollback (injected broken settings.json) → pre-backup restored, spec rolled back, zero residue
6. Hand-installed hook migration → v0 files move to `backup-<ISO>/hooks/`, plugin cache takes over
7. Uninstall keep → settings.json cleaned, CLAUDE*.md untouched, other plugins intact
8. Uninstall delete (hard AUTH gate) → mocked confirm=yes removes files; confirm=no preserves
9. Uninstall restore → finds newest backup, restores spec files, removes settings entries

### 5.5 settings-merge 20-fixture cases

Empty settings.json / no hooks key / our matcher pre-existing / event exists but our matcher missing / mixed with claude-mem-lite entries / duplicate command append (dedup) / manifest vs path fallback agreement / corrupted JSON / comment-stripped JSON / trailing comma / large file (1MB+) / UTF-8 BOM / read-only file permission / concurrent modification detection / ordering preserved across merge / unicode in values / escaped quotes / deeply nested hook structures / identical command with different timeout (reject vs append) / empty `hooks` array present.

### 5.6 CI matrix (Q5 answer: b)

```yaml
# .github/workflows/ci.yml
matrix:
  os: [ubuntu-latest, macos-latest]
  node: [20]

steps:
  - shellcheck hooks/*.sh  (warn-only, non-blocking)
  - bash tests/run-all.sh
  - node --test tests/scripts/*.test.js
```

Fail-fast on first red. All green required for merge.

### 5.7 Intentionally out of test scope

- Claude Code harness's hook protocol itself (assumed stable; rewrite mocks if CC changes it)
- `gh` CLI JSON output schema stability (assumed short-term; rewrite mocks when it changes)
- User's `~/.claude/CLAUDE.md` semantic content correctness (spec's own concern, not plugin's)
- MCP plugin presence (users may skip mem/code-graph install; §2.3 bindings inert, by design)

---

## 6. Versioning & Release

### 6.1 Dual-track version numbers

- **Plugin semver (independent track)**: `claudemd@0.1.0`, `0.1.1`, `0.2.0`, … tracks plugin artifact changes (hooks, scripts, commands, install logic)
- **Spec semver (independent track)**: `Version:` line in `spec/CLAUDE.md`, currently `v6.9.0`; this release bumps to `v6.9.2` — tracks spec text changes

**Coupling**: independent + reference. Plugin metadata does NOT duplicate the spec version; `spec/CLAUDE.md`'s `Version:` header line is the single source of truth.

Example timeline:

```
plugin 0.1.0  ships  spec v6.9.2   (first release; §0.1 + §2.3 + 4 moves + §5 dedup + §2.1 + §11 tag syntax)
plugin 0.1.1  ships  spec v6.9.2   (plugin bugfix only, spec unchanged)
plugin 0.1.2  ships  spec v6.9.3   (spec addition of §2.3-EXT)
plugin 0.2.0  ships  spec v6.10.0  (spec major restructure; installer adapts)
```

### 6.2 `/claudemd-status` displays both

```
claudemd v0.1.0 (plugin)
  ships spec: v6.9.2
  installed spec: v6.9.2 (~/.claude/CLAUDE.md header matches)
  md5 drift:    ~/.claude/CLAUDE.md  (edited locally; /claudemd-update to see diff)
                ~/.claude/CLAUDE-extended.md  OK
                ~/.claude/CLAUDE-changelog.md OK
  ...
```

Three states:
- Version aligned + md5 aligned → all green
- Version aligned + md5 drift → local edits (yellow, hint `/claudemd-update`)
- Version behind → hint `/plugin update claudemd`

### 6.3 Two changelogs, never merged

```
claudemd/
├── CHANGELOG.md              # Plugin changes (hooks/scripts/commands)
└── spec/
    └── CLAUDE-changelog.md   # Spec text changes (rule adds/removes, § restructure)
```

`/claudemd-update` diffs only `spec/`. Plugin updates flow through Claude Code's `/plugin update claudemd`.

### 6.4 Bump rules

**Plugin**:
- patch (0.1.x) — bugfix (regex correction, script boundary bug)
- minor (0.x.0) — new hook / new command / spec minor bump carried / meaningful refactor
- major (x.0.0) — breaking change: settings.json merge semantics / uninstall semantics / command rename

**Spec**:
- patch — text revisions, typo, example tweaks, §X-EXT internal additions
- minor — new § section / new HARD rule / existing rule semantic tweak
- major — large restructure, § removal, core tier redesign

### 6.5 Release artifacts

| Phase | Channel | Trigger | Artifact |
|---|---|---|---|
| Phase 1 (v0.1.0) | GitHub tag + self-hosted `marketplace.json` | `git tag v0.1.0 && git push --tags` | source tarball; user runs `/plugin install claudemd@claudemd` |
| Phase 2 (post) | npm | `npm publish` | `npx claudemd install` for non-plugin-system users |
| Phase 3 (post) | Official marketplace submission | submit review | discoverable to other Claude Code users |

v0.1.0 covers Phase 1 only.

### 6.6 Rollback mechanism

- **Plugin-side**: `/plugin install claudemd@0.1.0@claudemd` (pin to version if CC supports) OR `/plugin uninstall` + manual install from older source
- **Spec-side**: `~/.claude/backup-<ISO>/` contents (last 5 kept automatically); `/claudemd-uninstall`'s `[r]estore` option, or manual `cp`
- `/claudemd-doctor --rollback-spec` (post-v0.1 enhancement): interactive selection from recent backups

### 6.7 v0.1.0 release contents

**Spec v6.9.2** relative to v6.9.0:
- `[add]` §0.1 Core growth discipline (~40 tokens)
- `[add]` §2.3 TOOLS (21 lines, ~450 tokens)
- `[move]` §1.5 GLOSSARY definitions → §1.5-EXT (core keeps one-line index)
- `[dedup]` §5 Safe-paths prefix detail — core references existing §5-EXT (no new extension needed)
- `[move]` §5.1 AUTONOMY_LEVEL table → §5.1-EXT (core keeps description + never-downgrade)
- `[move]` §7 TMP_RETENTION detail → §7-EXT
- `[move]` §11 auto-memory tree → §11-EXT (core keeps three triggers)
- `[add]` §2.1 skill rows: `sp:brainstorming` (large design), `gs:ship` (ship/deploy), `gs:plan-*-review` series
- `[tweak]` §11 MEMORY.md index line syntax gains optional `[tag]` suffix
- `[changelog]` append v6.9.2 entry

**Plugin v0.1.0**:
- 5 hooks (all per Q2 c)
- 5 commands (status/update/audit/toggle/doctor)
- 7 Node.js scripts + 5 libs
- tests per §5 matrix
- docs (ARCHITECTURE / HOOK-PROTOCOL / ADDING-NEW-HOOK / RULE-HITS-SCHEMA)

---

## 7. Milestones, Acceptance, Risks

### 7.1 Milestones (revised from PLAN.md for Q2(c), Q1 model, ultrathink additions)

| M | Name | Est | Key deliverables |
|---|---|---|---|
| M1 | Plugin skeleton | 0.5d | repo init; `plugin.json` / `marketplace.json` / `package.json` / tree; migrate `banned-vocab-*` + `lib/hook-common.sh` + `lib/rule-hits.sh`; port 12 banned-vocab test cases |
| M1.5 | README bootstrap | +0.25d (folded into M1) | 30-sec install snippet in README; marketplace registration JSON template |
| M2 | Install/Update/Uninstall | **1.0d** | `install.js` (Q1 model), `update.js` (interactive diff), `uninstall.js` (3-way + hard AUTH delete), `settings-merge.js` + 20 fixtures, `backup.js` (N=5 retention), `spec-diff.js` |
| M3 | Ship-baseline hook | 0.5d | `ship-baseline-check.sh` (2s gh timeout), mock-gh fixtures, settings.json integration |
| M4 | Residue audit | 0.5d | `residue-audit.sh`, baseline persistence, Stop hook registration |
| M5 | P1 hooks (Q2 c) | **1.0d** | `memory-read-check.sh` (fail-open session parsing), `sandbox-disposal-check.sh`, `lib/platform.sh` cross-platform stat, per-hook tests |
| M6 | Commands + spec v6.9.2 | **1.5d** | 5 commands + `status.js` / `audit.js` / `toggle.js` / `doctor.js`; spec v6.9.2 content (§0.1 + §2.3 + 4 section moves + §5 dedup + §2.1 + §11 tag syntax); `CLAUDE-changelog.md` append; full-lifecycle integration test |
| M7 | Docs + release | 0.5d | `docs/ARCHITECTURE.md`, `docs/HOOK-PROTOCOL.md`, `docs/ADDING-NEW-HOOK.md`, `docs/RULE-HITS-SCHEMA.md`; CHANGELOG first entry; `git tag v0.1.0`; GitHub release |

**Total**: ~5.5 focused days. Critical path: M1 → M2 → (M3 ∥ M4 ∥ M5) → M6 → M7. M3/M4/M5 independent; subagent-parallelizable.

### 7.2 Acceptance criteria (v0.1.0 ship gate)

| # | Criterion | Verification |
|---|---|---|
| A1 | `/plugin install claudemd@claudemd` completes <10s on fresh HOME | integration test timing |
| A2 | Same-version re-install is idempotent (settings.json diff == 0) | 3× install + diff |
| A3 | All 5 hooks fire on correct events | manual: banned commit / push to red CI / session end tmp growth / MEMORY.md hit unread / HACK residue |
| A4 | Fail-open covers: broken jq / broken patterns / malformed stdin / missing gh / missing transcript path | dedicated test cases |
| A5 | Three-tier kill-switch works (env + per-hook + per-invocation escape) | env + in-commit markers |
| A6 | Tests green on `ubuntu-latest` + `macos-latest` × node 20 | CI |
| A7 | Uninstall three options (keep/delete/restore) execute correctly; delete triggers hard AUTH | integration test |
| A8 | rule-hits jsonl writes match schema; `/claudemd-audit` output readable | fixture injection + audit run |
| A9 | `/claudemd-doctor` all-green on clean install | doctor run |
| A10 | Fresh HOME post-install: `~/.claude/CLAUDE.md` Version: v6.9.2, §2.3 TOOLS present | md5 + grep |
| A11 | Pre-existing v6.9.0 HOME: old spec moved to `backup-<ISO>/`, new spec in `~/.claude/` | diff |
| A12 | New reader can add a 6th hook using `README.md` + `docs/ADDING-NEW-HOOK.md` alone | doc self-check |
| A13 | Core CLAUDE.md ≤ 5,500 tokens (including §0.1 + §2.3) | token count |
| A14 | §1.5-EXT / §5.1-EXT / §7-EXT / §11-EXT contain moved content with aligned numbering | section-presence check |
| A15 | `MEMORY.md` index line supports optional `[tag]` suffix; ungaged lines fall back to full scan | spec text + example |

### 7.3 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `install.js` corrupts settings.json | H | pre-backup + JSON.parse validate + auto-rollback + 20-fixture test |
| Overwriting user's unsaved local `~/.claude/CLAUDE.md` edits | M | Q1 backup-and-overwrite; 5-retention; doctor shows drift |
| `memory-read-check` session-transcript parse breaks on CC version bump | H | fail-open silent; version-hedged parsing; never deny on parse failure |
| `ship-baseline` dependency on `gh` (no-network / no-auth) | M | 2s hard timeout; `command -v gh` short-circuit fail-open |
| Cross-platform `stat` fails on macOS | M | `lib/platform.sh` abstraction; macOS CI mandatory |
| Latency of 5-hook chain exceeds reasonable bound | L | measured ~500ms hot path; doctor surfaces; upper bounded by per-hook timeout |
| Future gstack / claude-mem-lite conflict on Bash matcher | L | append-only; doctor reports matcher crowding |
| Users install claudemd without mem / code-graph; §2.3 bindings inert | L | Tier C design keeps principles usable standalone |
| Claude Code plugin API semantics change | M | reference claude-mem-lite / gsd-lite patterns; proactive test on CC major bumps |
| Spec reduction moves break existing `§X` references elsewhere in spec | M | comprehensive grep for `§` references before moving; renumber carefully |

### 7.4 Out of scope (post-v0.1.0)

- `auto-decision-recorder` (§10-R auto `mem_save` nag)
- `session-exit-mid-SPINE-guard` auto-writing `tasks/<slug>-paused.md`
- `contract-change-detector` AST-diff of public API
- MCP server exposing introspection tools
- `/claudemd-doctor --rollback-spec` interactive backup selection
- Official marketplace submission (Phase 3)
- npm `npx claudemd install` (Phase 2)
- Non-English spec translations

---

## 8. Ultrathink Additions (spec v6.9.2 scope beyond §2.3)

These additions were surfaced in the final brainstorming round and adopted per user choice (a).

### 8.1 Core reduction — four sections migrate + §5 dedup

**Target**: core `CLAUDE.md` from ~6,200 tokens to ~5,250 tokens (−15%).

| Section | Current core content | Action | Savings |
|---|---|---|---|
| §1.5 GLOSSARY | 6 full definitions | Move definitions to §1.5-EXT; core keeps one-line term list + pointer | ~400 |
| §5 Safe-paths prefix detail | Whitelist elaboration | Dedup: core references existing §5-EXT, no duplicate description | ~150 |
| §5.1 AUTONOMY_LEVEL effect table | Three-row table with full descriptions | Move table to §5.1-EXT; core keeps one-line description + never-downgrade list | ~350 |
| §7 TMP_RETENTION detail | Threshold + override guidance | Move to §7-EXT; core keeps rule + trigger only | ~150 |
| §11 auto-memory decision tree | Full 3-step tree with body-structure | Move complete tree to §11-EXT; core keeps three trigger summaries + pointer | ~350 |

**Net-change math**: current core 6,200 tokens − 1,400 migrated (five rows above) + 530 additions (§0.1 = 40, §2.3 TOOLS = 450, §2.1 three new skill rows = 40) = **~5,330 tokens**, meeting A13's ≤5,500 bound.

### 8.2 §0.1 Core growth discipline (new meta-rule)

Placed immediately after §0 SPINE as a policy gate for future additions.

```markdown
### §0.1 Core growth discipline (HARD)

New rule / new table row defaults to extended §X-EXT. Promote to core only after
rule-hits data shows ≥5 sessions in 30d where the rule fires AND its elaboration
wasn't consulted (= rule was self-sufficient). Quarterly `/claudemd-audit`
recommends demotion for core entries with 0 hits in 90d.
```

**Enforcement mechanism**: `claudemd` plugin's rule-hits.jsonl records each hook invocation; `/claudemd-audit` (see §7 of this doc) computes and surfaces promotion/demotion candidates.

### 8.3 §2.1 skill soft-trigger additions

Three rows appended to the existing §2.1 table:

| Trigger | Skill |
|---|---|
| large design / plugin design / architecture discussion | `sp:brainstorming` |
| ship / deploy / release | `gs:ship` (explicit lift from §2.2 ROUTE) |
| plan review (CEO / eng / design / devex dimensions) | `gs:plan-*-review` series |

The `sp:brainstorming` row is a direct response to a mid-session correction from the user: "big design task, how come no superpowers/gstack discussion skills were invoked?" Codifying this into §2.1 prevents the same oversight.

### 8.4 §11 MEMORY.md index line tag syntax

Current syntax:

```markdown
- [Feedback on testing](feedback_testing.md) — mocks are banned for DB tests
```

New syntax (backward compatible):

```markdown
- [Feedback on testing](feedback_testing.md) `[db, test, mock]` — mocks are banned for DB tests
```

**Semantics**: Agent in SPINE step 1 (CLASSIFY) extracts current task keywords. If any index line has `[tag]` block, match task keywords against tags; only Read files whose tags overlap. Ungaged lines (legacy format) fall back to full-scan behavior.

**Benefit**: turns MEMORY.md from "must scan all entries every session" into "router that delegates on-demand", reducing unnecessary file Reads for irrelevant memories.

---

## 9. Decisions Log

| Q | Question | Decision | Rationale |
|---|---|---|---|
| Q1 | Install handling of existing `~/.claude/CLAUDE.md` | Backup-and-overwrite (backup to `~/.claude/backup-<ISO>/`); uninstall offers keep/delete/restore (delete requires hard AUTH) | Plugin is authoritative during install but reversible; user override via `/claudemd-update` or manual edit after |
| Q2 | Hook scope at v0.1.0 | All 5 hooks (P0 + P1) | User's choice (c); accept M5 additional day for complete ship |
| Q3 | §2.3 TOOLS content style | Tier C (principles + plugin bindings + anti-patterns) | Portable across plugin mixes; MCP-injected tool docs remain authoritative; ~21 lines ~450 tokens |
| Q3-followup | `gh run list` timeout for ship-baseline | 2s | Balance: 1s too aggressive on slow networks; 5s causes noticeable push pause |
| Q4 | Backup retention | Keep most recent 5 | Simple rule; user prunes manually via doctor |
| Q4 | Update pulls from where | Plugin cache only (not remote GitHub) | `/plugin update claudemd` fetches remote; `/claudemd-update` syncs cache to home; single responsibility per command |
| Q4 | Uninstall delete confirmation | Hard AUTH re-confirm | CLAUDE.md may contain local unsynced edits |
| Q5 | CI matrix | ubuntu-latest + macos-latest × node 20 | macOS for sandbox-disposal BSD-stat; node 22 would add CI time without adding signal |
| Q6 | v0.1.0 ship spec version | ship with v6.9.2 (includes §2.3 + core reduction) | Coherent first release; rollback is cheap via backup |
| Q7 (ultrathink) | Core reduction + meta-rule + skill additions + MEMORY.md tag | All-in (option a) | Mechanical risk near-zero; meta-rule is the durable win; +0.5d timeline |

---

## 10. Appendix — Glossary and References

### 10.1 Files referenced

- `/mnt/data_ssd/dev/projects/claudemd/claude-spec-hooks-PLAN.md` — original plan (1023 lines)
- `/mnt/data_ssd/dev/projects/claudemd/方案.txt` — earlier session transcript with design rationale
- `~/.claude/CLAUDE.md` — current core spec (v6.9.0, 24,903 chars)
- `~/.claude/CLAUDE-extended.md` — current extended spec (37,434 chars)
- `~/.claude/CLAUDE-changelog.md` — spec changelog (16,592 chars)
- `~/.claude/hooks/banned-vocab-check.sh` + `banned-vocab.patterns` — v0 hand-installed, to be migrated
- `~/.claude/settings.json` — Claude Code harness config; claude-mem-lite currently registered
- Reference plugins: `claude-mem-lite`, `gsd-lite` for install/settings-merge patterns

### 10.2 External dependencies

- `jq` — required for hook JSON handling (fail-open if missing at runtime)
- `gh` (GitHub CLI) — required for ship-baseline-check (fail-open if missing)
- `bash` 4.2+ (macOS default is 3.2; README notes brew-install recommendation)
- `node` 20+ (for scripts/)
- `git` — for repo hygiene (not runtime)

### 10.3 Key terms

- **Hand-installed hook**: a hook script placed directly under `~/.claude/hooks/` with a matching entry in `~/.claude/settings.json`, without going through the plugin system. To be migrated into plugin-managed versions during install.
- **Backup-and-overwrite**: install flow that preserves the previous state of `~/.claude/CLAUDE*.md` in a timestamped directory before applying plugin-shipped versions.
- **Fail-open**: a hook exits 0 silently when encountering any internal error, ensuring a broken hook never blocks legitimate user work.
- **Manifest (installed.json)**: a plugin-managed file recording exactly which settings.json matcher entries and hook files the plugin created, enabling precise uninstall.
- **Three-tier kill-switch**: plugin-wide env var / per-hook env var / per-invocation escape hatch in commit or command — ascending granularity of disable control.

---

*End of design document.*
