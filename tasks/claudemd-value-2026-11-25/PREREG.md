# PREREG — claudemd outcome A/B, 2026-11-25

Written before the main run (`out-main/`). The pilot (`out/`, 1 rep, K1–K8, older judge) is excluded from the analysis.

## Question
Does installing claudemd (spec v8.6.0 + hooks, plugin 0.121.1, as installed on this machine) change
(a) the correctness of Claude's code and (b) its cost/time, versus vanilla Claude Code?

## Arms (same model claude-opus-5-5, effort xhigh = the user's setting, Claude Code 2.1.332, `claude -p`,
`--setting-sources project`, no plugins/MCP, bypassPermissions inside a sandbox)
- **V** vanilla: no CLAUDE.md, no hooks. 8 reps/task.
- **C** claudemd: installed core as CLAUDE.md, spec files + modules in sandbox HOME, installed hooks.json with
  HOME=<sandbox>, REPLY_LANGUAGE_CHECK=1 (as on this machine). 8 reps/task.
- **S** spec text only (C without hooks), for attribution. 4 reps/task.

## Tasks (K1–K9, prompts in Chinese like the user's)
Hidden tests are outside the repo; liveness proven (`check-fixtures.mjs`: each fails before, passes after a reference fix).

## Metrics
Primary
1. **Quality**: hidden-test full pass (per run), pooled over K1–K9; per-task table.
2. **Cost**: `total_cost_usd`, and wall time; per-task median ratio C/V, pooled geometric mean of ratios.

Secondary (descriptive)
- Sibling defects (K1 reorder, K2 getUsers, K6 averageOf): fixed / disclosed only / missed.
- K4 original failing assertion kept (no test weakening).
- K5 pre-existing red test disclosed in the final reply (regex, plus hand check of every final).
- K8 README updated; lines changed in src/config.js (scope).
- Commits made, turns, tool calls; hook rows (C only).

## Decision rule (stated before the data)
- Quality difference C−V counts as real only if the 95% CI (bootstrap over runs, stratified by task) excludes 0.
  With 72 runs/arm this detects roughly a ≥12–15 pt difference; a null result means "no difference larger than that",
  not "no difference".
- Cost overhead counts as material if the pooled geometric-mean ratio C/V > 1.3.
- Verdict grid: quality up & cost material → trade-off; quality same & cost material → net negative on these tasks;
  quality down → negative.

## Known limits (stated up front)
- Single-turn, small-to-medium tasks (10 s – few min). Long sessions, compaction, handoffs, memory, multi-day
  release work and rare destructive events (rm -rf on an empty var, push onto red CI) are NOT exercised here;
  field telemetry covers those.
- Task authors = analyst; tasks were designed around rules the spec claims to help with (parallel paths,
  root cause, test weakening, honest report, scope), which favours C if anything.

## Addendum (written before any H run, 2026-11-25 ~21:05Z)
- **H** hooks only: installed hooks.json + REPLY_LANGUAGE_CHECK=1, no CLAUDE.md / spec files / modules. 4 reps/task.
  Purpose: cost of the hooks alone in-task, to test the option "keep hooks, drop most spec text".
  Same metrics; H is compared with V on cost (ratio) and quality (diff), descriptively.

## Addendum 2 — lean-spec arm L (written 2026-11-25, before any L run; user chose option (a))
- **L** = draft lean core (`lean/CLAUDE.md`, ~2.5 KB: language, ask-first list, commit + 汇报 shape, safety lines,
  ship pointer) + current ship.md/review.md modules + the installed hooks + REPLY_LANGUAGE_CHECK=1. 8 reps/task (72 runs).
- Compared with the V and C runs already in `out-main/` (same harness, same day).
- **Pass = all of:**
  1. Cost: geo-mean of per-task median ratios L/V ≤ 1.15.
  2. Quality: pooled hidden full-pass ≥ 62/72, and every task except K1 ≥ 7/8.
  3. Wanted behaviours kept: local commit in ≥ 46/72 runs (C's rate) and `## 汇报`/`## Report` heading in ≥ 46/72 (C's rate).
- Fail on any → the lean text is revised or the plan is re-discussed; nothing is implemented in the repo on a fail.

## Addendum 3 — harness artifact and re-run (written 2026-11-25, after the L result, before any Cx/Lx run)
- Found after L: in every spec arm the spec is a `CLAUDE.md` file in the repo root, and the model's habitual
  `cat CLAUDE.md` (V tries it in 30/72 runs and finds nothing) succeeds there, re-loading the whole spec into
  context (C 46/72, L 41/72 runs). In real use the spec lives in `~/.claude/CLAUDE.md` and is not in the repo.
  `.claude/CLAUDE.md` and a parent-dir CLAUDE.md are not loaded under `--setting-sources project` (probed).
- Re-run as **Cx** (installed spec) and **Lx** (lean draft, unchanged text): spec delivered with
  `--append-system-prompt-file`, wrapped in Claude Code's own CLAUDE.md framing; hooks via `--settings <file>`
  outside the repo; spec files + modules in the sandbox HOME as before. 8 reps/task each.
- Cx replaces C for the headline cost ratio; C and L stay in the record as "in-repo delivery".
- Lx is judged by the Addendum 2 criteria unchanged. If Cx's commit / 汇报 rates differ from C's by more than
  10 runs out of 72, delivery position changed behaviour and that is reported as a limit.
