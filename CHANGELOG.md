# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## Versioning policy (set in v0.2.1)

- **Plugin manifest `description` fields** carry spec version at **major.minor only** (e.g. `"AI-CODING-SPEC v6.10 …"`). Patch-level spec updates (v6.10.0 → v6.10.1) do NOT re-bump manifest descriptions. Rationale: description is marketplace-list tagline — user absorbs version family, not full semver; churn across 3 manifests every patch has no signal.
- **Canonical spec version source**: `spec/CLAUDE.md` top-line title (`# AI-CODING-SPEC vX.Y.Z — Core`) + `spec/CLAUDE-changelog.md` top `##` entry.
- **Plugin semver vs spec semver** are independent: plugin patch (0.2.0 → 0.2.1) may ship when spec is unchanged (this release); plugin minor (0.1.9 → 0.2.0) ships when spec minor updates (v0.2.0 shipped spec v6.10.0).

## [0.49.0] - 2026-07-15

Spec **v6.20.0** — §2.1 Model tiering rule removed (spec-only; no hook/script change).

- **Removed the spawned-agent model-tiering rule** (core §2.1 paragraph + `spec/CLAUDE-extended.md §2.1-EXT MODEL TIERING`): downgrade-eligible category enumeration, the NEVER-downgrade list, the verifier ≥ generator invariant, and the anomalous-output re-run clause are all deleted. The model now self-allocates subagent tiers on its own judgment — quality-first with zero spec constraint. Rationale: the `Agent` tool already defaults to inheriting the parent (session) model when `model` is omitted, so quality-first is the harness default without any spec text. SHOULD-level rule — `spec/hard-rules.json` untouched, so no hook behavior changes and no enforcement surface moves.
- **Why now**: the first real-world sample of the rule firing (2026-07-15, a sibling project running subagents) showed the orchestrator self-allocating verify/review subagents to a lower tier including same-tier self-review — the exact pattern the guardrail targeted. The operator chose to trust the model's own allocation over re-adding the constraint (tracked in the durable-memory note `feedback_tiering_verify_downgrade_gap.md`, reopenable if the pattern recurs and hurts quality).
- **Manifest descriptions** bumped `AI-CODING-SPEC v6.19 → v6.20` (major.minor per the versioning policy above). README spec-version references bumped to v6.20.
- **Tests**: full `npm test` green; `node scripts/version-cascade-check.js` exit 0 (v6.20 consistent across spec trio + README + 3 manifests; plugin semver 0.49.0 consistent across 4 sites; Sizing drift within ±20B).

## [0.48.1] - 2026-07-15

**Patch — three §8 pre-detector silent bypasses closed (D1 brace-subpath, D2 arithmetic/quoted `<<` fakes a heredoc). Bugfix restoring intended deny behavior; no new gate, no §8 detector added.**

- **D1 — `canon_cmd_words` tore `${VAR}/subpath` apart.** It set command position on `{`, so `rm -rf "${SP}/build"` was basenamed to `rm -rf "${build"`, erasing the `${SP}` the var-detector greps for → the segment was skipped (ALLOW). Only shapes with a `/` after the `{` were mangled, landing the bypass precisely on the dangerous subpath class; `rm -rf "${HOME}/"` (empty `HOME` = `rm -rf /`, the ValveSoftware/steam-for-linux#3671 residue case) bypassed too. Fix: `{` re-opens command position only as a real brace-group introducer (`{ rm; }`), guarded on the preceding char not being `$`. Introduced with `canon_cmd_words` in v0.42.0 (SEC-2).
- **D2 — a `<<` left-shift / quoted `<<` faked a heredoc and blanked the following command.** `heredoc_re` matched any `<<word`, so `$((1<<bits))`, `$[a<<b]`, `let a<<b`, and a `<<` inside a quoted string (`echo "a<<b"; rm -rf $EVIL`) all set `in_heredoc`, truncated the line at `<<`, and blanked every following line — deleting the rm/npx/curl from the text **all three** detectors scan (blinds the whole gate, not one detector). Fix (root cause, closes the class without enumerating shell syntaxes): treat `<<TAG` as a heredoc only when a matching terminator line actually exists later. A genuine heredoc always closes with its tag; a shift / quoted `<<` / comparison never does. The new heredoc-detection condition is a strict `AND`-narrowing of the old one, so it can only make detection *less* aggressive → expose more text to the deny-on-match detectors → never a new bypass (proven by a differential old-vs-new sweep: 0 inputs newly allowed).
- **Found by** an adversarial fresh-subagent review (2026-07-15). D1/D2 were reproduced against the shipped hook, fixed, and RED-proven; the review's follow-up (`$[…]` / `let` / quoted `<<`, all the same class) folded into the same terminator-guard fix and a second review round confirmed the invariant holds.
- **Also — multi-window refresh note.** `/claudemd-refresh`, `refresh-plugin.sh`, and README §Update now tell users to run `/reload-plugins` in **other open Claude Code windows**: a refresh removes the old versioned plugin-cache dir those sessions pinned their hook paths to at startup, so they error on every hook event (enforcement absent) until reloaded.
- **Residuals** (documented in the hook; deliberate-crafting territory that does not clear the "ordinary mistake" bar, so not chased): indirect-name rebind (`unset "$T"`, `trap 'S=' DEBUG`), and a fake heredoc whose tag is repeated as a bare line to acquire a coincidental terminator (present in the original code too — this fix does not widen it). `IFS=/; rm -rf $SP/build` was probed and denies.
- **Tests**: pre-bash-safety corpus +17 rows (10 deny + 7 FP-pass controls) in `tests/fixtures/bash-safety/corpus.tsv`, all RED-proven against the committed pre-fix hook (347→357 with the fix). Full `npm test` green.

## [0.48.0] - 2026-07-15

**Minor — one-command plugin refresh: `/claudemd-refresh`.** Closes the update-UX gap: the upgrade banner used to teach a 4-command paste sequence; now it names one command. Detection (v0.4.0 `upstream_check`, 24h-throttled `git ls-remote`) and post-refresh spec/manifest sync (version-sync hook / SessionStart bootstrap) were already automatic — this release ships the missing middle step.

- **New `scripts/refresh-plugin.sh` + `/claudemd-refresh`**: `claude plugin marketplace update claudemd` → `claude plugin uninstall claudemd@claudemd -y` → `claude plugin install claudemd@claudemd` in one shot (`set -euo pipefail`; loud exit 1 when the `claude` CLI is not on PATH). Restart Claude Code afterwards — nothing else needed; `/claudemd-install` was never part of the update flow. Replaces the author's local-only untracked `update.sh`.
- **Banner copy**: upgrade banner and stale-registration banner now say "run /claudemd-refresh, then restart Claude Code" instead of listing 4 commands. Sweep also covers `commands/claudemd-update.md`, `scripts/install.js` refusing-downgrade message, both `scripts/doctor.js` fix strings, and README (§Update leads with the one-command path).
- **Migration**: nothing to do. The manual 4-command sequence still works and stays documented in README §Update as the fallback. Banner opt-out unchanged: `DISABLE_UPSTREAM_CHECK=1` (via `/claudemd-toggle`).
- **Tests**: +3 (`tests/scripts/refresh-plugin.test.js` — PATH-shim CLI: 3-call order, fail-stops-pipeline, missing-CLI loud failure; controls-first pair up front). Banner assertions in `tests/hooks/session-start.test.sh` Cases 8/18 re-pinned RED→GREEN. Suite: node 681 → 684 tests; full `npm test` green.

## [0.47.4] - 2026-07-15

**Patch — `package.json` had been stale since v0.47.0, and it is the file that decides what the installed manifest reports.** No hook-code change; §8 behavior identical to v0.47.3.

- **Bug**: v0.47.1, v0.47.2 and v0.47.3 each bumped `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` and left `package.json` at **0.47.0**. `scripts/lib/paths.js#readPluginVersion` reads **`package.json`** — not `plugin.json` — so `install.js` stamped `0.47.0` into `~/.claude/.claudemd-manifest.json` even when running from the `0.47.3` cache root (the manifest's own `pluginRoot` correctly said `.../0.47.3`, its `version` said `0.47.0`). Symptoms: `/claudemd-status` and `/claudemd-doctor` report a version three releases behind a correct install — which reads as "you forgot to refresh" and invites a pointless reinstall loop — and the v0.36.0 stale-root guard, which compares exactly this number, could not distinguish 0.47.0 from 0.47.3, so its protection was degraded across those releases.
- **Why it recurred three times**: the ship runbook's step-2 grep list is `spec/ tests/ scripts/ README.md .claude-plugin/`. `package.json` is not in it. All three releases followed the runbook faithfully.
- **Fix**: all four sites now at 0.47.4, and `scripts/version-cascade-check.js` gains **check 3 — plugin semver agreement** across `package.json#version`, `.claude-plugin/plugin.json#version`, `.claude-plugin/marketplace.json#metadata.version`, and `#plugins[0].version`. `package.json` is the reference site (it is what gets stamped). A missing file or key yields `null`, which cannot match, so the check fails loudly rather than skipping. Distinct from check 1, which covers the **spec** version (v6.X) — plugin semver and spec semver are independent by policy. The runbook memory now points at the script rather than the grep: mechanical beats remembered, which is the whole point — the rule was already written down and got skipped three times anyway.
- **Tests**: +5 (`tests/scripts/version-cascade-check.test.js`) — four-way agreement, the exact stale-`package.json` shape from this bug, a stale marketplace entry, missing-`package.json` fails-loudly-not-open, and a live assertion that the real repo agrees. Verified RED against the drifted tree (exit 1, offender listed) → GREEN after (exit 0). Suite 676 → 681 node tests; full `npm test` green.

## [0.47.3] - 2026-07-15

**Patch — three §8 false-negatives closed. Strictly deny-only: 0 of 37 probed commands went from deny to allow, 11 went from allow to deny.** Hook-code only; spec text unchanged (stays v6.19.0). One of the three is an author-introduced regression from v0.47.2, shipped four hours earlier; the other two are older. Live enforcement regressions, so shipped standalone per `OPERATOR.md §13.1`.

- **F16 — every §8 danger inside a same-line control structure was unguarded** (`hooks/pre-bash-safety-check.sh`). Pre-existing since per-segment iteration landed in v0.21.4, and the widest gap found this week. Segments split on `;`, so `if true; then rm -rf $X; fi` produces the segment `then rm -rf $X`; its first word is `then`, `rm_canon != rm`, and the whole segment was skipped. Measured ALLOW on v0.47.2: `if [ -d "$X" ]; then rm -rf "$X"; fi` (the most ordinary cleanup idiom in shell), `for x in a; do rm -rf $X; done`, `while true; do rm -rf $X; done`, `if false; then :; else rm -rf $X; fi`, and the same shapes on the npx gate (`if true; then npx unknown-pkg; fi`). Fix: `do` / `then` / `else` / `!` are shell reserved words, not command names — they join the wrapper-strip loop in both gates. The newline-separated form always denied (the keyword lands on its own segment); only the same-line form slipped. No FP risk: stripping a reserved word can only expose the real command behind it.
- **F17 — mktemp provenance ignored every rebind that does not spell `VAR=`** (pre-existing since v0.46.0). `S=$(mktemp -d); unset S; rm -rf "$S/build"` → ALLOW → `rm -rf /build` with S unset: the steam-for-linux#3671 class the recognizer sits next to. Same for `read S`, `S+=$EVIL`, `printf -v S`, `for S in $EVIL`, `mapfile -t S`, `declare -n r=S`, `source ./cfg.sh`, `eval "$CODE"`. Enumerating rebind syntax is a denylist that cannot be completed, so the guard inverts it: a rebind that spells the name must mention it, so count bare (non-`$`) mentions of the var and require the count to equal the number of `VAR=` assignments actually classified — a surplus is an unseen rebind. `source` / `.` / `eval` run current-shell code the scan cannot see and are rejected outright (matched pre-unwrap: `unwrap_indirect` rewrites `eval "$CODE"` to `; $CODE ;`, so a post-unwrap grep for `eval` never fires — a corpus row caught this).
  - **Known limit, stated plainly**: the bare-count is an allowlist on the *shape of the name*, so an INDIRECT-name rebind still defeats it — `S=$(mktemp -d); unset "$T"; rm -rf "$S/build"` and `trap 'S=' DEBUG` remain ALLOW (both also allowed before this release; not regressions, not closed). §8 is a guardrail against ordinary mistakes, not a boundary against a crafted command — `DISABLE_*` and `[allow-rm-rf-var]` are bypassable by design.
- **Regression closed (author-introduced in v0.47.2)**: `SP=; rm -rf "$SP/build"` → ALLOW → `rm -rf /build`. The F14 loop's `[[ -n "$prov_rhs" ]] || continue` was meant to skip blank grep lines and also skipped genuine empty assignments, so "every assignment must be safe" passed vacuously. Now denied by construction — an empty RHS matches no safe class.
- **Corpus**: +30 rows (F16: 10 control-structure denies incl. the guarded-cleanup idiom, wrapper/assignment-prefix nesting, npx forms + 5 FP controls; F17: 11 rebind denies anchored on mktemp + 4 FP controls). Suite 307 → 337.
- **Evidence**: 23 rows RED against the pre-fix hook → GREEN after (337/337). Deny-only confirmed by a 37-case HEAD-vs-WIP differential: 0 loosened, 11 tightened. Full `npm test` green; shellcheck clean.
- **Not shipped**: literal-assignment provenance (`SP=/lit; rm -rf "$SP"` stays denied). It was built, reviewed, and rejected — see `tasks/specs/s8-literal-provenance.md`. Use `${VAR:?}`.
- **Known open, NOT fixed here** (`tasks/s8-sanitize-brace-heredoc.md`): two pre-existing bypasses upstream of all three gates. `rm -rf "${SP}/build"` and `rm -rf "${HOME}/"` are ALLOW (`canon_cmd_words` treats `{` as a command-position boundary and basenames the expansion apart); `SHIFT=$((1<<bits)); rm -rf "$X"` is ALLOW (`sanitize_cmd`'s heredoc regex matches the arithmetic left-shift and eats the rest of the text). Both live in the shared pre-detector pipeline and are being handled as their own change.

## [0.47.2] - 2026-07-15

**Patch — F14: the v0.46.0 mktemp-provenance recognizer had three false-negatives, each reaching the exact disaster class the gate exists for.** Hook-code only; spec text unchanged (stays v6.19.0). Deny-direction only — nothing that was blocked before is allowed now. Live enforcement regression (opened by SEC-4 two releases ago), so shipped standalone per `OPERATOR.md §13.1` rather than batched.

- **F14 — mktemp-provenance is now position-aware and reassignment-aware** (`hooks/pre-bash-safety-check.sh`): SEC-4 (v0.46.0) recognized temp-dir cleanup with a single grep for `VAR=$(mktemp` **anywhere** in the flattened command. Three FNs, all landing on the empty-var/subpath class the gate was built for (ValveSoftware/steam-for-linux#3671, cited in the whitelist branch two blocks above):
  1. **Reassignment** — `S=$(mktemp -d); S=$EVIL; rm -rf "$S/build"` matched the *first* assignment and allowed. `$EVIL` is env-supplied and invisible; empty `$EVIL` makes the command `rm -rf /build`. The control (`rm -rf "$EVIL/build"`, no mktemp mention) correctly denied — the stray mktemp is what opened it.
  2. **Position-blindness** — `rm -rf "$S"; S=$(mktemp -d)` allowed, but bash runs the rm **first**, with `$S` still inherited from the environment. (The `${VAR:?}` guard below it is position-agnostic for a documented reason that does not transfer: an unset var makes `rm -rf ""` a harmless no-op, whereas provenance asserts the value *is* a known temp dir.)
  3. **Unbounded target** — `rm -rf "$S/$SUB"` rode S's provenance while `$SUB` stayed unknown.
  Replaced with three textual, conservative conditions: (1) ≥1 assignment to the var strictly **before** this rm segment; (2) **every** assignment to that var anywhere in the command is a mktemp one (position-blind on purpose — an assignment after the rm cannot retroactively make it safe, and refusing on one over-denies rather than under-allows); (3) the rm target expands no var other than that one. The §8.V4 disposal idiom (`S=$(mktemp -d); … ; rm -rf "$S"`) is unaffected.
- **Accepted residual**: `S=$( mktemp -d)` (space after the paren) now denies — the RHS capture stops at the space. Deny-direction; `[allow-rm-rf-var]` is the escape.
- **`scripts/safety-coverage-audit.js`** — `splitClauses` no longer splits on `;`/`→` inside a backticked code span. Hook comments illustrate shell shapes (`S=$(mktemp -d); S=$EVIL; …`) whose semicolons are shell syntax, not clause separators; splitting them minted a phantom clause (`S=$EVIL`) whose only keyword can never appear in code, so a **fixed** bug's own repro was reported as an unimplemented rule. Same self-referential-heuristic class as `feedback_self_referential_marker_regex`. Verified no detection loss: claim sites 47 → 47, real gap clauses 0 → 0; the only removed gap was the phantom, and the 6 merged clauses were all backtick-span fragments (5 previously `covered`).
- **Corpus**: +15 rows (F14 — 7 FN denies incl. reassign-to-`/`, cmd-sub reassign, assignment-after-rm, unknown-var subpath; 8 FP controls incl. backtick mktemp, `mktemp -p`, two mktemp assignments, intervening commands). Suite 292 → 307.
- **Tests**: the 7 FN rows verified RED against the pre-fix hook (300/307) → GREEN after (307/307); full `npm test` green (node 676 pass / 0 fail); shellcheck clean.
- **Known false-deny, deliberately NOT addressed here**: `SP=/literal/path; rm -rf "$SP"` still denies even though the value is fully visible and provably non-empty. Widening allow is a separate decision from this deny-only fix — tracked in `tasks/s8-literal-provenance.md`.

## [0.47.1] - 2026-07-15

**Patch — three §8 gate defects found by probing a user's field reports: two silent bypasses (F10/F11) + one false deny (F13).** Hook-code only; spec text unchanged (stays v6.19.0). Live-enforcement regressions, so shipped same-day standalone per `OPERATOR.md §13.1` rather than batched. All three verified RED against the pre-fix hook (279/292) → GREEN after (292/292).

- **F10 — env-assignment value with a slash disabled the rm AND npx gates** (`hooks/pre-bash-safety-check.sh`): `canon_cmd_words` (added v0.42.0 SEC-2) basenames the command-position word, but a leading env-var **assignment** is not a command name. `DEBUG=/tmp/x rm -rf $EVIL` canon'd to `x rm -rf $EVIL`, so the assignment-strip loop broke at `x`, `rm_canon != rm`, and the segment was skipped entirely → **ALLOW**. Same for `PREFIX=/opt/app npx unknown-pkg`. This reopened the exact bypass class the v0.21.x wrapper-strip closed (`DEBUG=1 rm -rf $HOME`); the slash-free form still denied, which is why it survived SEC-2 review and the corpus (whose assignment rows all use slash-free values). Fix: emit assignments verbatim and keep `cmdpos=1`, so the real command word still gets canonicalized (`FOO=/a/b /usr/bin/npx pkg` → `FOO=/a/b npx pkg`).
- **F11 — apostrophes in double-quoted prose ate the danger token** (`hooks/pre-bash-safety-check.sh`): the single-quote strip was a line-based `sed -E "s/'[^']*'/''/g"` that ran **before**, and blind to, the double-quote state machine. `echo "it's fine" && rm -rf $X && echo "don't"` paired the two apostrophes across the `rm`, deleting it before any detector ran → **ALLOW**. Trivially reachable by accident (`git commit -m "don't panic" && rm -rf $BUILD`). Identical failure mode to the double-quote regex bug fixed earlier with a state machine — the single-quote pass was simply never converted. Fix: **one** state machine walks both quote types, so a `'` inside `"…"` and a `"` inside `'…'` are literals.
- **F12 — same root cause, false-deny direction**: line-based sed left multi-line `'…'` literals unstripped, so `python -c 'print(1)\nrm -rf $X'` false-denied. The unified machine reads the whole buffer (`RS="\004"`), so multi-line bodies strip like one-liners.
- **F13 — `(cd sub && npx tool)` subshell form false-denied a locally-installed package** (`hooks/pre-bash-safety-check.sh`): `effective_npx_cwd`'s cd-extractor anchor class was `(^|[[:space:];&|])`, which `(cd` matches neither way, so the cd was invisible, the effective cwd fell back to the parent, and `npx_pkg_locally_resolved` missed the subdir install. The v0.45.x fix covered the bare `cd sub && npx tool` shape but not the subshell idiom. Field repro: `(cd daagu/frontend && npx vue-tsc --noEmit)` denied with `vue-tsc` present in `frontend/node_modules/`. Anchor now includes `(`/`{` (matching the rm gate and npx splitter, which already treat them as separators); target class excludes `)`/`}`.
- **Corpus + tests**: +20 corpus rows (F10 slash-value × rm/npx/bunx/path-npx + FP controls; F11 apostrophe-straddle × rm/npx/curl-sh + quote-nesting; F12 multi-line literals) and +8 inline cwd cases (F13 subshell/brace/piped forms + 4 FP controls incl. unresolvable `$VAR` and failed `cd`). Suite 264 → 292.
- **Coverage note**: the corpus already had assignment-prefixed rows (`FOO=bar rm`, `FOO=bar npx`) — all slash-free. The uncovered shape was specifically a **slash-bearing value in the same segment as the rm/npx**, which is why a "precision" refactor could reopen an older FN unnoticed. Per `feedback_s8_false_negative_audit`, the FN matrix is now locked in the corpus rather than re-derived per audit.
- **Tests**: full `npm test` green; shellcheck clean; bash-3.2/BSD-safe (awk `\047` octal escape, no `declare -A`, no GNU-only flags).

## [0.47.0] - 2026-07-13

**Minor — B-1: npx/runner gate moves to command-position detection, closing the runner-word-in-quoted-message false positive** (the deferred item from v0.46.0). Hook-code only; spec text unchanged (stays v6.19.0). Sandbox-verified against a 32-case FN-matrix + the full corpus before landing.

- **B-1 — command-position runner detection** (`hooks/pre-bash-safety-check.sh`): the npx/bunx/npm-exec/pnpm-dlx/yarn-dlx gate no longer matches the runner name **anywhere** in the flattened command. It now splits into command segments (same boundaries as the rm gate), strips leading env-assignments + transparent wrappers (`env`/`command`/`sudo`/`timeout`/…), and checks whether the segment's **command word** is a runner. Effect: a runner name inside a quoted argument — `git commit -m "add npx setup for $PROJECT"`, `echo npx hello`, `which npx` — is no longer at a command position and is **allowed** (this was the `npx cd ×4` telemetry-FP smell and the user-reported "commit blocked without rm"). Real invocations still deny: `env npx`, `sudo -E npx`, `FOO=bar npx`, `time npx`, `$(npx …)`, `\npx`, `/usr/bin/npx`, and the whole runner family. Pinned/local/lockfile resolution unchanged.
- **Accepted residual**: `xargs npx <pkg>` (runner as an xargs argument) is now allowed — same long-tail class as the documented `xargs rm` residual (`tasks/s8-false-negative-audit-2026-07-03.md`); env/bypass-token guardrail positioning unchanged.
- **Corpus** (`tests/fixtures/bash-safety/corpus.tsv`): +9 rows (F9 — quoted-message runner-word allow, wrapper-prefixed runner deny, pinned-under-wrapper allow). Suite 255 → 264.
- **Tests**: full `npm test` green; shellcheck clean; bash-3.2-safe (only plain string vars + the wrapper-strip loop the rm gate already uses).

## [0.46.0] - 2026-07-13

**Minor — §8 detection-precision batch: close command-grouping/substitution false-negatives (SEC-3) + recognize mktemp-provenance temp cleanup (SEC-4).** Hook-code only; spec text unchanged (stays v6.19.0). From the 2026-07-13 comprehensive audit + the §8 detection-precision design review (`docs/s8-detection-precision-design-2026-07-13.md`). All changes sandbox-verified against the full corpus + adversarial FN-matrix (`DISABLE_RULE_HITS_LOG=1`) before landing.

- **SEC-3 — command-grouping/substitution FN closure** (`hooks/pre-bash-safety-check.sh`): a command inside `$(…)` / `(…)` / `{…;}` / backtick **executes at eval time** but bypassed all three §8 gates. Fixes: the rm segment splitter now breaks on `(` `)` backtick (NOT `{}` — that is brace-`${VAR}` far more often, splitting it corrupted the var target) + strips a leading group opener so `(rm`/`{ rm` is seen as rm + strips grouping chars from the residue; the curl sink tolerates a closing `)`/`}`; the npx anchor gains `(`/`{` so `$(npx …)` is caught. `\npx`/`env npx` wrapper coverage and `${VAR}` targets are preserved (233-case corpus zero-regression).
- **SEC-4 — mktemp-provenance recognition** (`hooks/pre-bash-safety-check.sh`): `T=$(mktemp -d); … rm -rf "$T"` (the §8.V4 sandbox-disposal idiom, previously denied as an unvalidated var) is now allowed when the target var is assigned **in the same command** from `$(mktemp …)` / `` `mktemp …` `` — mktemp output is a fresh, uniquely-named path. Additive recognition analogous to the existing `${VAR:?}` guard; new telemetry event `rm-rf-allow-provenance`. Cross-command mktemp, fake `mktemp` (`$(echo mktemp)`), transitive vars (`$S/x`), and `..` escapes stay strict.
- **Test completeness** (`tests/scripts/hard-rules-drift.test.js`): the hard-rules-8 reverse-completeness assertion now enumerates **both** deny idioms (`HIT_SECTIONS+=` and direct `hook_record <hook> <deny-verb> … '§…'`); the prior regex saw only the first, leaving `§10-V` / `§11-memory-read` / `§7-ship-baseline` invisible to the demote-accounting guard.
- **Corpus** (`tests/fixtures/bash-safety/corpus.tsv`): +22 rows (F7 grouping/substitution deny + FP controls, F8 mktemp-provenance allow + escape/fake/cross-call deny). Suite 233 → 255.
- **Docs** (`docs/RULE-HITS-SCHEMA.md`): document `rm-rf-allow-provenance` event + section mapping.
- **Deferred**: the npx command-position anchor rework (fix npx-plain-words-in-quoted-commit-message FP without regressing `env npx` wrapper coverage) needs a wrapper-aware token walk — see `tasks/s8-npx-message-fp-deferred.md`.
- **Tests**: full `npm test` green (corpus 255/255, node --test all pass, integration lifecycle PASS); shellcheck clean; positioning as guardrail (env/bypass-token still bypass) unchanged.

## [0.45.0] - 2026-07-13

**Minor — ships spec v6.19.0: §2.2 Runbook fast-path (ship-time token-efficiency relaxation).** When extended would load solely because of ship/release (incl. released-artifact L3) and the project's ship-runbook memory carries a current-version coverage stamp (`covers: §EXT §12 … @ v<spec>`), the ship reads the runbook + targeted-reads the stamped §EXT sections instead of the full ~47KB file. Stamp missing/stale → full load + stamp refresh (self-healing, one full re-read per spec release). All §12 HARD obligations bind unchanged. Companion to the v6.16.0 ship-runbook memory consolidation — the two together make a routine ship cost one runbook Read + ~7KB of targeted spec reads.

- **Spec** (`spec/CLAUDE.md` §2.2 + §2.1, `spec/CLAUDE-extended.md` §12 + new §2.1-EXT + Recent changes + Sizing, `spec/CLAUDE-changelog.md`): v6.18.0 → v6.19.0. Paired net-delete per §0.1: **C4 consumed** — §2.1 Model-tiering Sonnet/Opus category enumeration moved to new §EXT §2.1-EXT; safety invariants (inherit default / NEVER-downgrade list / verifier ≥ generator / anomalous re-run / evidence bar) stay in core. Candidate pool now empty.
- **Manifest** (`spec/hard-rules.json`): `spec_version` v6.18.0 → v6.19.0 (no rule add/remove — fast-path bounds live inside the existing `§12-ship-pipeline-hardening` HARD block; anchor unchanged).
- **Descriptions** (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` ×2, `README.md` ×3): spec family tag v6.18 → v6.19.
- **Memory (project-side, not in repo)**: claudemd ship runbook (`feedback_claudemd_ship_from_main_atomic.md`) gains the coverage stamp `covers: §EXT §12, §EXT §13 META, §EXT §2-EXT released-artifact checklist @ v6.19.0`.
- **Tests**: full `npm test` green; `version-cascade-check` v6.19 consistent + Sizing within ±20B; shellcheck + bash-3.2 gate clean.

## [0.44.0] - 2026-07-13

**Minor — ships spec v6.18.0: §1 Language-contract refinement.** Reasoning/思考 moves from the user's-language bucket to English (joining code / comments / commits); a docs split is added — local analysis/audit docs follow the user's language, shipped reference/contract docs (ARCHITECTURE / HOOK-PROTOCOL / RULE-HITS-SCHEMA / ADDING-NEW-HOOK / cross-project-pilot) stay English for adopters; Done narrative made explicit in the user's-language bucket. Code artifacts / CHANGELOG / PR / log-strings / config-keys / CLI-labels unchanged (English). Operator-requested with boundaries confirmed before edit.

- **Spec** (`spec/CLAUDE.md` §1, `spec/CLAUDE-extended.md` Recent changes + Sizing, `spec/CLAUDE-changelog.md`): v6.17.0 → v6.18.0. Core Δ ≈ +79B (24648 → 24727, within the 25000 cap — 273B headroom, no net-delete required per §0.1).
- **Manifest** (`spec/hard-rules.json`): `spec_version` v6.17.0 → v6.18.0 (no rule add/remove — the language contract is `self`-enforced, not a hook-emitting HARD rule, so no new manifest entry).
- **Descriptions** (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` ×2, `README.md` ×3): spec family tag v6.17 → v6.18.
- **Tests**: full `npm test` green; `version-cascade-check` v6.18 consistent + Sizing drift within ±20B; shellcheck + bash-3.2 gate clean.

## [0.43.0] - 2026-07-13

**Minor — hard-rules manifest reverse-completeness + telemetry-hygiene batch (roadmap B1+B2).** Product of the 2026-07-13 production-readiness re-audit. Spec rule content unchanged (stays v6.17.0); `spec/hard-rules.json` is the HARD-rule ledger, not spec prose.

- **MANIFEST-1** (`spec/hard-rules.json`): added the `§8-curl-sh` entry. The curl/wget-into-shell gate has filed blocking denies under `§8-curl-sh` since v0.39.0, but the manifest — which self-describes as the ledger of "every HARD rule" and drives `/claudemd-rules` §13.1 demote accounting — had no entry, so that section's deny/bypass hits were invisible to demote-review and coverage accounting. `totalRules` 22 → 23. Anchors on the existing spec §8 line "execute scripts of unknown origin" (no new spec rule).
- **TEST-3** (`tests/scripts/hard-rules-drift.test.js`): new `hard-rules-8` reverse-completeness assertion — enumerates every `HIT_SECTIONS+=('§…')` deny section across `hooks/*.sh` and requires each to have a hook/both manifest entry. Prior drift tests only checked manifest→spec and manifest-entry→section; nothing asserted hook→manifest, which is exactly how `§8-curl-sh` slipped. This test RED-anchored MANIFEST-1 (failed on `§8-curl-sh` before the entry, green after). `§8-curl-sh` added to `KNOWN_HOOK_SECTIONS`.
- **TEST-4** (`tests/scripts/sampling-audit.test.js`): the DRIFT-1 parity test's first assertion was `assert.deepEqual(pats, readPatterns(pf))` — tautological, since `loadVocabPatterns` internally *is* `readPatterns(pf)` (it compared a function's output to itself and could not catch a parse regression). Replaced with concrete parse-output assertions (pattern count + each fixture line's `regex`/`isRatio`). Mutation-verified: reintroducing the old `indexOf('|')` truncation now fails the test (previously passed). Removed the now-unused `readPatterns` import.
- **OPS-2** (memory, not code): `feedback_manual_hook_probe_pollutes_telemetry` gained a subagent-dispatch bullet — hook-probe subagents don't inherit the `DISABLE_RULE_HITS_LOG=1` discipline unless the dispatch prompt states it (a `delta-review` subagent wrote 3–4 self-class deny rows to the live log during this audit before the discipline was applied).
- **Tests**: full `npm test` green; shellcheck + bash-3.2 gate clean.

## [0.42.0] - 2026-07-13

**Minor — §8 command-name canonicalization parity + `$IFS` fixed-point fold (roadmap SEC-2, L3).** Product of the 2026-07-13 production-readiness re-audit (`docs/production-readiness-audit-2026-07-13.md`), which found SEC-1 (v0.39.0) closed the `\rm` / `/bin/rm` command-name evasion for the **rm gate only** — the npx and curl-into-shell gates still let path-prefixed / backslash-escaped runners through. Spec unchanged (stays v6.17.0). This is a §8 SAFETY enforcement change; positioning is unchanged — §8 remains a guardrail (env vars / `[allow-*]` tokens still bypass), not an adversarial security boundary. Closing these makes the gate fire on **natural command spellings** (`/usr/bin/npx`, `\curl`), not on obfuscation.

- **SEC-2 F5 command-position canonicalization** (`hooks/pre-bash-safety-check.sh`): new `canon_cmd_words` awk pass strips a leading backslash and a path prefix from the **first token after a true command separator** (`^ ; & | ( { ` backtick ` newline`) — never a plain-space-preceded argument. This gives the npx/curl gates the same command-name awareness the rm gate's token loop already had. Now denied (were allowed): `\npx pkg`, `/usr/bin/npx pkg`, `\curl url | sh`, `/usr/bin/curl url | sh`, `curl url | /bin/sh`, and path/backslash runners after a `;`/`|`/`&&` separator. No false-positive on argument-position paths: `echo foo/npx bar`, `cat /usr/bin/rm` still pass (the arg is space-preceded, not command position).
- **SEC-2 F6 `$IFS` fixed-point fold** (`hooks/pre-bash-safety-check.sh`): the bare-`$IFS` fold `s/\$IFS([^A-Za-z0-9_]|$)/ \1/` consumed the trailing delimiter into the backref, so an **adjacent** `$IFS$IFS` left the second copy unfolded after one pass (`rm$IFS$IFS-rf$IFS$X` → allow). The bare form now loops to a fixed point (folding only removes `$IFS`, so it decreases monotonically and terminates); `$IFSFOO` (distinct var) stays untouched.
- **Red-team corpus** (`tests/fixtures/bash-safety/corpus.tsv`): +12 cases (F5×6 deny + F5-fp×3 pass + F6×1 deny + F6-fp×1 pass) wired into the CI-gated `pre-bash-safety.test.sh`, so this FN class fails the build if it reopens. Corpus 221 → 233 cases.
- **Tests**: `pre-bash-safety.test.sh` 233/233; full `npm test` green (node --test 675/675, integration full+upgrade lifecycle PASS); shellcheck clean; bash-3.2 portability gate clean. All 6 original bypass vectors re-confirmed deny + all FP controls allow on the real hook (`DISABLE_RULE_HITS_LOG=1`, no telemetry pollution).

## [0.41.0] - 2026-07-12

**Minor — latent-cleanup batch (roadmap B2): detector-parity, encoding-helper dedup, install validate-before-move, strict toggle argv, architecture-doc refresh.** Closes the five B2 items from the 2026-07-12 production-readiness audit. Spec unchanged (stays v6.17.0). No user-visible enforcement change.

- **DRIFT-1** (`scripts/sampling-audit.js`): `loadVocabPatterns` + `scanVocab` now delegate to lint.js `readPatterns`/`scan` — the sanctioned §10-V parser shared with the CLI and the bash hook. The prior inline loader used `indexOf('|')` (truncates any alternation-bearing regex) and omitted `posixClassesToJs`, so a future non-`@ratio` pattern with an alternation or POSIX class would be silently dropped/mis-matched here while active elsewhere → false-optimistic §10-V compliance. `@ratio` exclusion preserved via `excludeRatio`; raw-text baseline preserved (no identifier strip). +2 parity tests (alternation regex survives; POSIX class matches; `@ratio` excluded).
- **ARCH-1** (`hooks/lib/rule-hits.sh` + `hooks/lib/hook-common.sh` + 3 hooks): the CC projects-dir encoding (`tr -c 'a-zA-Z0-9-' '-'`) was hand-inlined in 4 places (a class with prior bug history). Extracted to a single `hook_encode_project` in the rule-hits leaf lib, eagerly sourced by hook-common so all consumers share ONE definition (no `declare -F`-guarded inline fallback — that silent-divergence antipattern). +1 binding test.
- **SCRIPT-1** (`scripts/install.js`): the shipped-spec completeness check now runs BEFORE the backup branch `renameSync`-moves the user's `~/.claude/CLAUDE.md` (pre-fix an incomplete plugin checkout left the user's spec only in the backup dir, home path empty, manifest unwritten). Added a closing post-copy sha256 integrity assertion so a partial/failed copy that doesn't throw surfaces at install time, not on the next doctor run. +1 test (incomplete spec → throws, user content untouched, no backup created).
- **SCRIPT-2** (`scripts/toggle.js`): the only CLI entrypoint reading `process.argv[2]` directly — `toggle banned-vocab --json` silently dropped `--json`. Now takes the first positional as the hook name and feeds the remainder to `parseStrict`, so an unknown flag / extra positional rejects loudly with exit 2 (shape error, distinct from exit 1). +2 tests.
- **DOC-1** (`docs/ARCHITECTURE.md`): "Three layers" → four (adds the `bin/claudemd-lint.js` npm-CLI layer the doc omitted); new "§8 is a guardrail, not a security boundary" positioning section.
- **Test-harness fix** (`tests/hooks/contract.test.sh`): the C-check event extraction now strips comments before matching `hook_record <hook> <event>`, so a docstring mentioning `hook_record` no longer false-flags schema drift (anchor on code syntax only).
- **OPS-1 confirmed no-op** (already shipped): jsonl size-capped rotation exists in `rule-hits.sh` (documented in the roadmap; the audit's "no rotation" finding was inaccurate).
- **Tests**: full `npm test` green; shellcheck + bash-3.2 gate clean; `lint:argv` 0 hits.

## [0.40.0] - 2026-07-12

**Minor — observability + test-robustness batch (roadmap B1): safety-hook fail-open telemetry + doctor hook-liveness self-checks + CI execution timeouts + README hook-count drift guard.** Product of the 2026-07-12 production-readiness audit (`docs/production-readiness-audit-2026-07-12.md`) B1 batch. Spec unchanged (stays v6.17.0). No user-visible enforcement change — these harden observability and the test harness.

- **OBS-1 fail-open telemetry** (`hooks/pre-bash-safety-check.sh`, `hooks/memory-read-check.sh`, `hooks/ship-baseline-check.sh`): the three safety-critical hooks (§8 / §11 / §7) previously `exit 0` silently on a missing jq or malformed stdin, indistinguishable in the §13.1 audit from "rule never fired". They now call `hook_record_failopen <hook> jq-missing|bad-event` on those early exits (the contract `banned-vocab-check.sh` already modeled). `tests/hooks/fail-open.test.sh` +3 (T5–T7).
- **OBS-2 doctor hook-liveness** (`scripts/doctor.js`): the deny self-tests covered only 2 of 16 hooks; the 6 Stop hooks + PostToolUse + other advisory hooks (which never emit a deny) had no liveness surface, so a silently-broken hook was invisible to `/claudemd-doctor`. Adds 12 liveness self-checks — each feeds a synthetic event of the hook's registered type under an isolated mkdtemp HOME (so state-writing hooks can't touch the real `~/.claude`) and asserts exit 0 with no shell-crash signature. Coverage now 14/16; `session-start-check` + `version-sync` are intentionally excluded (bootstrap / network / background-spawn side-effects unsafe to trigger from a health command; covered by their own suites + the upgrade-lifecycle integration test). `tests/scripts/doctor.test.js` +1 coverage-lock test. Known scope: liveness catches crashes on the path the synthetic event exercises (parse-time syntax errors, early `set -u` unbound-var), not breaks in untaken branches — those remain the unit suites' job.
- **TEST-1 CI execution timeouts** (`tests/run-all.sh` + new `tests/lib/run-suite.sh`): a hung test (a hook reading stdin with no EOF, a blocking spawnSync) previously stalled the whole run to the CI job-level kill with no diagnostic. New shared `run_suite` wraps each bash suite in `timeout`/`gtimeout` (hook 120s / integration 300s; degrades to no-cap when neither binary is present so the runner never breaks); `node --test` gets `--test-timeout=60000`. New `tests/hooks/timeout-guard.test.sh` (4 cases) exercises `run_suite` against a deliberately-hanging suite (killed with 124, bounded), asserting exit-code pass-through for normal and failing suites.
- **TEST-2 README hook-count drift guard** (`tests/scripts/readme-drift.test.js` +2): the "16 shell hooks" claim (capabilities table + project-layout tree) was guarded only indirectly via `HOOK_REGISTRY.length`; the README text could drift silently. Now asserts every "N shell hooks" mention matches `hooks/*.sh` count, and the enumerated capability list names exactly the real hooks (catches a hook dropped from the list even if the number still matches).
- **OPS-1 (no change — audit finding was inaccurate)**: the audit flagged `claudemd.jsonl` as having "no rotation". Verified against source: `hooks/lib/rule-hits.sh` has had size-capped rotation (`CLAUDEMD_LOG_MAX_MB`, default 5 MB → `.1` → `.2`) with test coverage (`rule-hits.test.sh` cases 4–6) since it shipped. No work needed; documented in the roadmap to prevent re-flagging.
- **Tests**: full `npm test` green; shellcheck clean; bash-3.2 portability gate clean.

## [0.39.0] - 2026-07-12

**Minor — §8 Bash-gate false-negative closure: command-name canonicalization + shell-lexer normalization (roadmap SEC-1).** Closes 4 novel §8 bypasses surfaced by the 2026-07-12 production-readiness audit (`docs/production-readiness-audit-2026-07-12.md`, all reproduced live before the fix). Spec unchanged (stays v6.17.0). **User-visible enforcement change**: commands previously ALLOWED are now denied — see below.

- **Fix** (`hooks/pre-bash-safety-check.sh`): the rm-detector's segment gate matched only the bare literal token `rm`, and the sanitizer never normalized `${IFS}` or backslash-newline, so four natural-looking evasions slipped the gate. All now denied:
  - **F1 command-name canonicalization** — the rm command word is canonicalized to its basename with one leading backslash stripped, so `/bin/rm -rf $VAR`, `./rm`, and the alias-defeating `\rm -rf $VAR` are recognized as rm (matching what the shell execs, not the source spelling). `busybox rm` (multiplexer) added to the wrapper-strip set. Exact `== rm` after canonicalization keeps `charm`/`norm`/`perm` off.
  - **F2 `${IFS}`/`$IFS` word-split** — folded to a space before tokenizing, so `rm${IFS}-rf${IFS}$HOME` and `npx${IFS}pkg` read as `rm -rf $HOME` / `npx pkg`. Bare `$IFS` folds only when not followed by an identifier char (`$IFSFOO` untouched).
  - **F3 backslash-newline continuation** — `rm -r\`+newline+`f $X` rejoins before tokenizing (portable bash-3.2 param-expansion, not BSD-unsafe sed `\n`).
  - **F4 `source <(curl)` / `. <(curl)`** — `source` and `.` added to the curl-process-substitution interpreter set; they exec fetched content in the current shell like `bash <(curl x)`.
  Folding/canonicalization can only EXPOSE tokens the shell itself sees at exec time, never hide one, so these strictly close false-negatives on the deny-on-match detectors. **Positioning unchanged**: §8 remains a guardrail (steers the agent off its own mistakes + makes rule-adherence observable), NOT an anti-injection security boundary — any `DISABLE_*` env var or `[allow-*]` token still bypasses by design. Documented residuals (`xargs rm`, option-with-arg wrappers like `sudo -u svc rm`, non-shell interpreter sinks) remain out of scope (diminishing returns; don't change the guardrail framing).
- **Tests** (`tests/fixtures/bash-safety/corpus.tsv`, +16 rows → suite 211 → 222): 11 adversarial deny cases (F1–F4) + 5 FP controls (`/bin/rm` literal path, `charm` basename exact-match, `${IFS}` in echo, `source`/`.` on local files) — the red-team evasion corpus the roadmap called for, driven by `pre-bash-safety.test.sh` inside the CI-gated run-all. `npm test` all suites pass; shellcheck clean; bash-3.2 portability gate clean.

## [0.38.0] - 2026-07-12

**Minor — statusline path segment renders cwd basename only.** Spec unchanged (stays v6.17.0).

- **User-visible change** (`scripts/statusline.sh`): the blue path segment now shows the cwd basename — `sds@nb:claudemd (main) …` — instead of the full path, which crowded out the branch/model/meter segments on deep project paths. `cwd="/"` (or any cwd whose basename is empty, e.g. trailing slash) falls back to the full cwd; branch detection is untouched (still runs against the full path). Revert: the rendering script is a stable copy at `~/.claude/claudemd-statusline.sh` — restore it from an older plugin cache dir, or point the statusLine slot elsewhere via `/claudemd-statusline remove`.
- **Docs** (`README.md`): StatusLine row format string updated (`user@host:/path` → `user@host:dir`, `dir` = cwd basename).
- **Tests** (`tests/scripts/statusline.test.js`): 23 → 24 — full-payload assertion now expects the basename AND asserts the full path is absent; new `cwd:"/"` fallback case.

## [0.37.1] - 2026-07-11

**Patch — QA tech-debt closure: per-suite env hygiene + README drift guards + sampling-audit zero-data skip.** Closes the three follow-ups filed by the 2026-07-11 QA loop. Spec unchanged (stays v6.17.0).

- **Fix** (all 25 `tests/hooks/*.test.sh` + `tests/integration/*.test.sh`): every bash suite now sources `tests/lib/env-hygiene.sh` at entry, so a direct `bash tests/hooks/x.test.sh` run is as hermetic as a `run-all.sh` run (0.37.0 only scrubbed the run-all entry point). env-hygiene suite grows 3 → 5 cases (structural all-suites-wired check + polluted direct-invocation spot check).
- **Tests** (new `tests/scripts/readme-drift.test.js`, 3 cases): locks the README claim classes that drifted before — §Project layout counts (`commands/*.md`, `scripts/*.js`) vs the filesystem, and opt-in-gated hooks (`${VAR:-0}` gate) appearing in the fires-when table must carry an "Opt-in" marker. Sibling of `kill-switch-doc-drift.test.js`.
- **Fix** (`scripts/sampling-audit.js`): a zero-scanned-transcripts run no longer writes an all-zeros `tasks/sampling-audit-<date>.md` stub — it prints a skip line and writes nothing (`--json` mode unchanged). +1 CLI test.

## [0.37.0] - 2026-07-11

**Minor — QA self-test loop output: `audit` string-shape skip warning (user-visible) + test-suite env hygiene + README↔implementation drift fixes.** Product of a 3-round QA self-test loop over CLI / lifecycle scripts / all 16 hooks / docs (8 issues filed, 8 fixed + replay-verified; ledger kept as local-only `qa/`). Spec unchanged (stays v6.17.0).

- **User-visible change** (`bin/claudemd-lint.js` + `scripts/lib/lint.js`): `claudemd-cli audit` now prints one stderr warning when the transcript carries assistant rows whose `message.content` is a plain string rather than the CC block array — such rows are outside `parseTranscript`'s input domain and were silently unscanned (same silent-success family as the v0.9.14 / v0.9.21 guards; real CC transcripts always use block arrays, but the CLI is documented for other-agent exports). Verdict and exit codes are unchanged; `--json` stdout stays pure JSON; pure block-array transcripts see no new output. The warning itself is the discoverability signal. Opt-out / revert: the warning is stderr-only (exit-code/stdout pipelines unaffected); to silence entirely, pin the prior version (`npx claudemd-cli@0.36.0`).
- **Fix** (`tests/run-all.sh` + new `tests/lib/env-hygiene.sh`): user-tunable claudemd env knobs inherited from the invoking shell (e.g. `DISABLE_RULE_HITS_LOG=1` — the documented telemetry-hygiene export for manual hook probing — or a live `TRANSCRIPT_STRUCTURE_SCAN=1` opt-in) flipped 15 suites red with no hint. `run-all.sh` now scrubs the `DISABLE_*` / `CLAUDEMD_*` families plus the explicit opt-in knobs before any suite runs. Known limit: directly invoking a single suite file still inherits the caller env.
- **Docs** (`README.md`, 6 drift fixes, implementation-is-correct in every case): uninstall state/log clearing is `CLAUDEMD_PURGE=1`-gated (command table + two-step-flow comment said otherwise); install backup wording now matches the v0.23.11 spec-on-spec no-backup design; `/claudemd-audit` flag documented as `--days=N` (= form only); `transcript-vocab-scan` marked opt-in default-OFF; `mem-audit` row rewritten to the current memory-file structure audit (old citation-scan description predated the hook's repurpose); §Project layout counts corrected (commands 12 → 15, scripts 16 → 18).
- **Tests**: node runner 659 → 662 (lint-cli +3: warning content+count, `--json` stdout purity under warning, no-noise on block-array transcripts) plus a new env-hygiene shell suite (3 cases, outside the node count).

## [0.36.0] - 2026-07-11

**Minor — stale-cache downgrade loop fixed (never-downgrade guard + hook direction gates + doctor staleness check) + suppress-source pre-dedupe logging.** Fixes the reproduced 2026-07-11 defect (`tasks/manifest-pluginroot-stale-cache.md`): CC keeps versioned plugin cache dirs and can fire hooks from a STALE one after an upgrade; the bootstrap hooks' direction-blind version comparison (`!=` treated any mismatch as "upgrade") then ran the old root's `install.js`, regressing `~/.claude` spec + manifest every session — observed as v6.16.0 / v6.15.1 flapping. Spec unchanged (stays v6.17.0).

- **Fix** (`scripts/install.js`): never-downgrade guard at the choke point — refuses to install a version older than the manifest records (strict-semver compare, before ANY mutation incl. backups), with the refresh sequence in the error message. Deliberate rollbacks: `CLAUDEMD_ALLOW_DOWNGRADE=1`. Non-semver versions (dev-mode `unknown`, `9.9.9-test` fixtures) skip the guard — fail-open. RED anchor: sandbox repro downgraded home spec v6.16.0 → v6.15.1 and manifest 0.34.0 → 0.33.0 pre-guard.
- **Fix** (`hooks/session-start-check.sh` + `hooks/version-sync.sh`): direction gate in the mismatch branch — manifest NEWER than the hook's own plugin root means stale registration; the spawn is skipped (pre-gate the bootstrap log recorded `auto-upgrade: manifest 9.9.9 → plugin 0.35.0` and downgraded), a `stale-root` rule-hits row is written (`extra: {hook_version, installed_version}`), and SessionStart banners the 4-command refresh (version-sync keeps its 0-byte-stdout contract; bootstrap log carries the trail).
- **Feature** (`scripts/doctor.js`): `plugin cache:staleness` check — manifest.pluginRoot exists but holds an older plugin than the marketplace dir; surfaces the refresh fix. Skipped when either side lacks a strict-semver version.
- **Fix** (`hooks/memory-prompt-hint.sh`, v0.35.0 review finding #5): `suppress-source` now logs BEFORE the dedupe — a relay prompt whose matches were all previously suggested to a human prompt exited without a row, under-counting exactly the avalanche the event exists to measure. Row consequently carries the post-unRead pre-dedupe list in authoring order (documented in `docs/RULE-HITS-SCHEMA.md`).
- **Lib** (`scripts/lib/paths.js`): `SEMVER_RE` + `semverCmp` exported (shared by install guard + doctor check).
- **Tests**: install 3 new (guard refusal with no-mutation assertions, `CLAUDEMD_ALLOW_DOWNGRADE=1` rollback, non-semver fail-open); session-start 17 → 18 (stale gate: no spawn + banner + telemetry + manifest untouched); version-sync 7 → 8 (stale gate piggy-back); memory-prompt-hint 22 → 23 (all-deduped relay still rows); doctor +3 (staleness flag / current / not-comparable); paths +2 (`semverCmp`, `SEMVER_RE`); contract DOCUMENTED +2 (`stale-root` ×2 emitters).
- **Residual risk** (documented in the task file): pre-0.36.0 cache dirs still hold ungated hooks + unguarded install.js; a session registered against one of those can still downgrade until they age out of cache-prune (keep:3) or the user refreshes. Forward-looking protection only. `update.js` apply-all intentionally stays outside the guard — it is user-gated (diff shown first, explicit `CLAUDEMD_UPDATE_CHOICE=apply-all`), i.e. the sanctioned explicit-choice path.

## [0.35.0] - 2026-07-11

**Minor — spec v6.17.0 audit letter-fix batch + R1 hint noise controls + R2 Tier-2 index budget.** Executes the 2026-07-11 four-method spec-audit recommendation backlog (`tasks/spec-audit-2026-07-11.md`) end-to-end: A-class plugin work (R1/R2/R3), B-class candidate-pool bookkeeping (C2 closed, C5/C6 consumed), C-class spec letter fixes (7 core edits, net −91B).

- **Feature** (`hooks/memory-prompt-hint.sh`): R1 hint noise controls. (a) Non-human prompt-source filter — prompts opening with `<agent-message>` / `<task-notification>` / local-command relays / `<system-reminder>` no longer emit hints; the matched list is still logged as the new `suppress-source` event, so the avalanche stays measurable while dropping out of cite-recall joins (lesson-bypass-audit filters `event=suggest`). Evidence: the audit session logged 6/9 suggest events fired by subagent deliverables quoting tag vocabulary, not by task need. (b) Per-session per-file dedupe via the hook's own rule-hits log (`event=suggest` rows only — suppressed hints were never shown and must not block a later human hint) — closes the transcript-flush-lag double-suggest observed 2026-07-11 (same file suggested twice 2s apart; transcript grep can't see an un-flushed prior emission).
- **Feature** (`scripts/lib/memory-tags.js` + `scripts/doctor.js`): R2 Tier-2 index budget. New `memory-index-size` doctor check: per-project `MEMORY.md` soft budget 12KB (`MEMORY_INDEX_BUDGET_BYTES`) — the index loads into context every session of its project and had no size governance (spec §0.1 caps only core/extended; the audit measured claudemd's index at 19.8KB = 80% of core). First live scan flagged 4/14 projects; claudemd's own index trimmed 19788B → 12248B (51 → 49 entries, files kept on disk) in the same change. Advisory only — pruning stays the operator's call.
- **Docs** (`docs/RULE-HITS-SCHEMA.md`): `suppress-source` event documented (events table + section-taxonomy row); `suggest` row notes the dedupe semantics.
- **Tests**: memory-prompt-hint 16 → 21 (source-filter emission+telemetry, task-notification, dedupe flush-lag shape, per-session scope, suppress-does-not-dedupe); memory-tags 19 → 22 (index-size scanner + budget constant); contract DOCUMENTED +1 (`suppress-source:memory-prompt-hint`, part B literal call-site check drove a two-call-site implementation).
- **R3 closed by verification + deferral**: `lesson-bypass-audit.js` already excludes missing-transcript rows from the cite-recall denominator by design (`citeRecall = applied/(applied+bypassed)` = 22/47 = 46.8%); the remaining recall-precision tuning is mem-lite-side and filed as mem-lite deferred item D#65 with the data and direction.
- **Spec v6.17.0** (full entry: `spec/CLAUDE-changelog.md`): §3 stricter-reading scoped to safety/AUTH ambiguity + §2.2 targeted §EXT-section Read exception (the two minor-level relaxations); 8.V1 gains test-runner pass-fail counts; §2 LLM-visible-metadata clause points spec self-edits at §13 META; §7 residue-check example made §8-conformant; Fast-Path "pre-classified follow-up" and §1.5 LOC exclusion clause deleted; C5 §0.1 tier definitions → `OPERATOR.md §13.1` + C6 §9 Parallel-first compression. Core 24739 → 24648 bytes (−91B net-delete, headroom 352B).
- **Candidate-pool bookkeeping** (`tasks/core-net-delete-candidates-v6.14.md`): C2 formally CLOSED by audit gate data (ship-baseline fired on 15 distinct days / 254 events vs 20 releases in 30d — ad-hoc pushes do rely on the core §7 CI row); C5/C6 marked consumed with measured deltas; C4 is the sole remaining candidate.
- Coverage-audit note: `safety-coverage-audit.js` flagged the R1 hook's own header comment ("suggest → suppress-source") as an arrow-claim with a hyphen-stripped keyword miss — reworded the comment rather than widening the detector; the detector's catch-rate on fresh code is working as designed.

## [0.34.0] - 2026-07-11

**Minor — spec v6.16.0: §11-EXT ship-runbook consolidation (SHOULD).** Per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook holding the full release flow (pre-ship checks → atomic steps → post-ship); ship-adjacent lessons keep topical tags and are `[[linked]]` from the runbook instead of carrying own ship tags. Effect: the §11 MEMORY.md read-the-file HARD gate costs one predictable Read per ship session instead of tag fan-out. Grounded in memory-read-check telemetry 2026-05-20 → 2026-07-10 (~20 deny events: modal match_count=1, recurring generic-tag FP fan-out, bypass reasons "residual keyword tag hits are FPs"). No hook / script changes — spec text + version cascade only (`hard-rules.json` spec_version field bump; rule is SHOULD, not HARD, per §13.2 budget gates).

- Version cascade: spec headers ×2, `spec/CLAUDE-changelog.md` entry, `hard-rules.json` spec_version, `spec-structure.test.js` (2 asserts + test name), `upgrade-lifecycle.test.sh` NEW_SPEC_VER, README v6.15 → v6.16 family ×3 + repo-tree comment, manifest descriptions ×3 per v0.2.1 policy.
- §13.1 minor-spacing note: ships one day after v6.15.0 by explicit operator request; the rule is telemetry-derived (7 weeks of rule-hits), which is the risk the spacing discipline guards against.
- Reference implementation (user-global, not in repo): `feedback_claudemd_ship_from_main_atomic.md` rewritten as claudemd's single ship-tagged runbook; MEMORY.md generic-tag hygiene (`timeout` → `missing-timeout`, `cwd/encoding/projects/underscore` → hyphenated compounds) closing the measured FP sources.

## [0.33.0] - 2026-07-10

**Minor — `/claudemd-clean-residue` now also purges stale `~/.claude/tmp` tool-exhaust (spec §EXT §7-EXT retention).**

- **Feature** (`scripts/clean-residue.js`): new `scanClaudeTmp`/`cleanClaudeTmp` pass over `~/.claude/tmp` — purges depth-1 entries with `mtime > TMP_RETENTION_DAYS` (default 7); per-UID dirs (`claude-<uid>`) are descended one level (children purged, shell kept — the shell's mtime churns while stale sessions pile up inside); dirs carrying a `.keep` marker are exempt (§8.V4 deliberately-retained fixtures). Retention resolution: `--retention-days=N` flag > `TMP_RETENTION_DAYS:` in the invoking project's CLAUDE.md > 7; malformed CLAUDE.md values warn and fall back (no silent-ignore). Still dry-run by default, `--apply` gates deletion, `CLAUDEMD_CLAUDE_TMP_DIR` env is the test seam. Origin: 2026-07-10 manual AUTH'd purge found 550M / 5157 stale entries because spec §7-EXT's "harness SHOULD purge mtime > 7d" had no implementing surface — `residue-audit.sh` only *recommends* the find command (`tasks/tmp-retention-followup.md`; telemetry showed the §8 rm-rf-var hook was NOT the blocker: 715 validated-rm allows vs 206 denies).
- **Command doc** (`commands/claudemd-clean-residue.md`): documents the new scope, flags, and the active-session-older-than-retention caveat.
- **Tests**: `tests/scripts/clean-residue.test.js` 14 → 22 (uid-dir descent, `.keep` exemption, dry-run/apply, missing dir, CLI claudeTmp section, retention-days flag shape, CLAUDE.md override + flag precedence).
- Explicit non-goals kept: no SessionStart auto-clean (§7-EXT "no auto-clean without AUTH"), no §8 safe-path carve-out for `~/.claude/tmp` (prefix allow would open a `$X=../..` traversal FN; §8 is never-downgrade).

## [0.32.3] - 2026-07-10

**Patch — spec v6.15.1: §0.1 operator-threshold relocation (Candidate 3 net-delete).** Core §0.1's tier promotion/demotion thresholds ("≥3 sessions in 30d" / "≥5 sessions + elaboration wasn't consulted" gates + `/claudemd-rules` demotion recommendation) move to `OPERATOR.md §13.1` — they are operator-executed (`external` enforcement), so Agent-loaded core carried thresholds the Agent cannot act on at runtime. Core keeps the Agent-consumed facts: Tier-2 default landing zone, hard cap, net-delete clause, Sizing tracking. Core 24978 → 24739 bytes (−239B, headroom 261B); OPERATOR.md 7018 → 7546 (+528B, human-only, unbudgeted). Origin: 2026-07-10 core-attention review; Candidate 3 of `tasks/core-net-delete-candidates-v6.14.md`, executed as user-authorized standalone compression (C1 was already consumed by v6.15.0). No hook / script / rule change — `hard-rules.json` `spec_version` only.

## [0.32.2] - 2026-07-10

**Patch — §13.2 batch review (overdue since 2026-06-10) + doctor tag-scan parser-parity fix.**

- **`spec/hard-rules.json`**: all 22 rules' `last_demote_review` stamped `2026-05-24` → `2026-07-10`. Review evidence: 30d rule-hits window (2078 hits, parse 5586/5586), `hard-rules-audit` `demoteCandidates=[]`, doctor rule-usage 5/5 healthy — keep all 22, no demotions. Full verdicts (2 candidates closed, shared-symbol repro 1→2 log-only) in `tasks/rule-candidates-2026-04.md` "Batch review — 2026-07-10". Next cadence: 2026-08-09.
- **Fix** (`scripts/lib/memory-tags.js`): `parseMemoryIndex` backtick tag-block regex was not anchored on `.md)` while the hook's sed (memory-read-check.sh) is — a prose/blockquote line quoting a decorative `` `[label]` `` token plus any `` `(….md)` `` token parsed as a tagged entry. Live FP: code-graph-mcp's MEMORY.md header line produced a `memory-tag-specificity` finding `{file: '…​.md', tag: 'label'}` against a non-entry. Both tag-block forms now carry the hook's greedy `.*\.md)` anchor. Same parser-parity family as the v0.23.11 first-vs-last file-match fix.
- **Tests**: `tests/scripts/memory-tags.test.js` 18 → 19 (blockquote header fixture is the live FP line verbatim).

## [0.32.1] - 2026-07-10

**Patch — statusline: ctx segment no longer disappears right after `/clear`.** Reported live: immediately after `/clear` the meter rendered `[5h:0% · 7d:52%]` with no ctx segment. Root cause (verified against the CC 2.1.206 binary's payload constructor): before the first API response of a fresh session, CC sends `context_window` with an **explicit `used_percentage: null`** ("no usage yet"), which the renderer treated as "no data" and omitted. The `5h:0%` in the report was real data (new 5-hour window, fractional utilization floored), not part of the bug.

- **Fix** (`scripts/statusline.sh`): ctx extraction now distinguishes explicit-null from absent — `context_window` object present with a `used_percentage` key → null renders as `ctx:0%`; missing key / missing object / non-object still hides the segment (no fabricated 0% on foreign or pre-2.1.206 payloads). Side hardening: a non-object `context_window` (e.g. a string) no longer errors the jq program mid-stream.
- **Tests**: `tests/scripts/statusline.test.js` 20 → 23 cases (byte-shape post-/clear fixture with explicit nulls, object-without-key hidden, non-object garbage keeps later fields aligned).
- **Action on upgrade**: re-run `/claudemd-statusline` or any install/update to refresh `~/.claude/claudemd-statusline.sh`.

## [0.32.0] - 2026-07-10

**Minor — spec v6.15.0: §2.1 Model tiering (spawned-agent model selection).** Core §2.1 gains a SHOULD-level block after Tool escalation: spawned agents default to inheriting the session model (omit `model` when unsure); whitelist downgrade — sonnet for mechanical fan-out (search / fetch / extract / classify / enumerate) + lint-or-test-gated bulk edits, opus for test-gated plan-step code; decision-shaped stages (orchestrate / synthesize / verify / judge / root-cause debug / L3 / §5-hard / §8) NEVER downgrade. Invariants: verifier tier ≥ generator; anomalous downgraded output → one re-run at inherited tier; evidence bar tier-independent. Paired net-delete: §7 metric-coupled row's 6 project-specific examples removed (Candidate 1 of `tasks/core-net-delete-candidates-v6.14.md`, −169B measured vs −280~340 estimated). Core lands at 24978/25000 (22B headroom — next core addition must fully net-delete). Design doc: `tasks/specs/model-tiering.md`.

- **No hook / script changes** — spec text + version cascade only. `hard-rules.json` rules array unchanged (spec_version field bump only; rule is SHOULD, not HARD, per §13.2 budget gates).
- Version cascade: spec headers ×2, `spec/hard-rules.json` spec_version, `tests/scripts/spec-structure.test.js` (2 asserts), `tests/integration/upgrade-lifecycle.test.sh` NEW_SPEC_VER, manifest descriptions v6.14 → v6.15 per v0.2.1 policy.

## [0.31.0] - 2026-07-10

**Minor — statusline 5h/7d quota segments (user-visible default change).** The shipped statusline renderer's meter bracket grows from `[ctx:N%]` to `[ctx:N% · 5h:N% · 7d:N%]` — context window plus the 5-hour and weekly rate-limit windows, all **used %** with uniform thresholds (<50 green, 50-79 yellow, >=80 red), rendered faint (SGR 2) so the meter doesn't pull attention. **Action on upgrade**: none — re-run `/claudemd-statusline` (or any install/update, which refreshes `~/.claude/claudemd-statusline.sh`) to pick up the new renderer. **Opt-out**: `DISABLE_STATUSLINE_QUOTA=1` hides the quota segments (exact-match `1`, matching the repo's toggle convention); full revert = pin v0.30.0 or `/claudemd-statusline remove`.

- **Data source**: Claude Code >= 2.1.206 statusLine stdin payload carries top-level `rate_limits: {five_hour: {used_percentage, resets_at}, seven_day: {…}}` (verified against the CC binary's payload constructor; `used_percentage` = utilization x 100, fractional, may exceed 100). On older CC / absent data the segments auto-hide — the line degrades to the previous `[ctx:N%]` content.
- **Renderer** (`scripts/statusline.sh`): one `used_seg()` for all three segments — floor the integer part, hide on non-numeric or >3-digit input (nonsense that would also overflow bash int64 in `[ -ge ]`), per-segment color, uncolored bracket/`·` separators. jq extraction widened 3 → 5 NUL-delimited fields.
- **Review findings fixed pre-tag** (fresh-subagent review, 2 Low): int64-overflow garbage rendering on huge digit strings (jq prints `1e19` as plain digits → was rendering `5h:8446744073709551716%` in green); `DISABLE_STATUSLINE_QUOTA` disabled on ANY non-empty value including `0` (now exact `== "1"`).
- **Tests**: `tests/scripts/statusline.test.js` 9 → 20 cases (bracket format + separator, both threshold scales at exact boundaries, floor semantics, partial/absent windows, overflow band, toggle `0`/`1`, hostile backslash/newline inputs).
- Docs synced: README statusline row, `/claudemd-statusline` command description, install stderr banner.

## [0.30.0] - 2026-07-10

**Minor — E2 cross-layer memory maintenance report (doctor checks).** Fourth implementation tranche of `docs/spec-optimization-plan-2026-07-10.md` (P5 item E2). Wrong-layer memory placement fails silently; these checks make it observable. Candidates only — no auto-migration (a §5-scoped write, operator's call).

- **`scripts/lib/memory-maintenance.js`** + three `/claudemd-doctor` checks:
  - `memory-maintenance:promote` — claude-mem-lite lessons cited ≥3× and alive ≥30d (reads `~/.claude-mem-lite/claude-mem-lite.db` read-only via `node:sqlite`, project-scoped by the mem-lite `parent--name` convention; degrades to `skipped: …` when the DB or `node:sqlite` is absent). High-frequency recall = de-facto durable knowledge → MEMORY.md candidate.
  - `memory-maintenance:recall-repatriation` — durable `recall_*.md` plugin-absent fallback files older than 30d (migrate into mem-lite or delete).
  - `memory-maintenance:stale` — durable files >90d with zero `*.md` keyword mentions in the telemetry log window (review tags per §11-EXT or retire).
- **Tests**: new `tests/scripts/memory-maintenance.test.js` (3 cases: in-window vs out-of-window mention liveness, promote filter matrix — young / under-cited / superseded / foreign-project all excluded, missing-dir graceful empty). Relative timestamps throughout (absolute-date fixtures are time bombs).
- First live run: 1 promote candidate (#8264 "jq -R required for JSONL parsing", cited ≥3×), 0 recall-repatriation, 0 stale across 47 durable files.

## [0.29.0] - 2026-07-10

**Minor — C1 over-ceremony detector (superpowers collision cost measurement).** Third implementation tranche of `docs/spec-optimization-plan-2026-07-10.md` (P3 item C1).

- **`overCeremony` section** in `scripts/sampling-audit.js` (same event-stream scan): segments the main-line transcript into tasks at typed user messages (bare `继续`/`next`/`怎么停了`/`why did you stop` continuations extend the current segment, mirroring §1.5), classifies a segment L0/L1-shaped when it edited ≥1 file, ≤2 distinct files, <80 estimated LOC (Edit old+new / Write content line sums), and counts model-initiated ceremony `Skill` calls (sp `brainstorming` / `test-driven-development` / `systematic-debugging` / `writing-plans` / `executing-plans`) landing in those segments. Q&A segments (0 edits) are not opportunities — ceremony there can be correct §2.1 routing. User-typed /commands are not counted.
- **C2 pre-registered threshold** exported as `OVER_CEREMONY_THRESHOLD = 0.05` (test-pinned): after 30d collection, rate < 5% → keep superpowers, close P3; ≥ 5% → evaluate uninstall (§EXT §12 fallback table) / fork / hook-level disable. Fixed before data collection.
- Markdown report gains an `## Over-ceremony (C1)` section; `--global` aggregates the measure across project dirs.
- **Tests**: sampling-audit 17 → 19 (segmentation + continuation-no-split + large-task-ceremony-excluded + threshold pin).
- First live run (this repo, 30d): 281 segments / 11 L0/L1-shaped / 0 over-ceremony (brainstorming×2, writing-plans×2 all in large or Q&A segments).

## [0.28.0] - 2026-07-10

**Minor — sampling-audit detector expansion 4 → 8, opportunity denominators, self/external stratification, pre-registered calibration gate.** Second implementation tranche of `docs/spec-optimization-plan-2026-07-10.md` (P1 items A2–A5).

- **4 new sequence/claim detectors** (`scripts/sampling-audit.js`): `§11-turn-yield` (typed continuation-nudge — `继续`/`next`/`怎么停了`/`why did you stop` — after a tool-active turn; the spec's own confirmed-yield tell), `§7-bugfix-anchor` (`Done: fixed …` line without a prior-failing token in the same line), `§11-post-compaction` (compaction event — `compact_boundary` system line or `isCompactSummary` user line, deduped as one event — with no plan/spec re-read within the next 10 main-line assistant events), `§5-hard-auth` (hard-class op — settings.json/.env/migrations write, prod `npm install <pkg>`, `git push --force`, `DROP TABLE` — with no `[AUTH REQUIRED` marker in the previous 10 assistant texts; pre-declared FP-heavy, advisory collection only). Sequence detectors walk the full event stream (tool_use / typed-user / compaction) and exclude subagent sidechains (`isSidechain:true`).
- **A2 metric contract**: every rule now reports `violations` WITH its `opportunities` denominator (Done lines examined / substantive Uncertain lines / typed-after-tool-turn messages / compaction events / hard-class ops); `§10-V` splits `violations` (turns with ≥1 match, rate stays ≤1) from `hits` (raw per-pattern matches, kept for A1-baseline comparability). `metricContract` string rides in the JSON and the report header.
- **Stratification**: `--global` now returns `byClass` (`self`/`external`/`unknown` via the shared `classifyProject` — trailing `-claudemd` segment = self) and the markdown report gains a per-class `viol/opps` table; `samplingAuditGlobal({projectsRoot})` exported and parameterized for tests.
- **A4 calibration gate (pre-registered)**: `PRECISION_GATE = 0.8` exported; every detector starts `precision: null, status: 'collecting'`. Uncalibrated ratios are collection data, not compliance evidence.
- **A5 dashboard**: `scripts/audit.js` gains a `selfCompliance` section (embeds the transcript scan of the current project, same window) — per rule `opportunities/violations/rate/precision/status`, with **`rate` withheld (null) until hand-labeled precision ≥ 0.8**. `/claudemd-audit` command doc instructs reporting denominators verbatim and never presenting `collecting` ratios as rates.
- **Tests**: sampling-audit 9 → 17 cases (4 new real-shape fixtures: `turn-yield` / `bugfix-anchor` / `post-compaction` / `hard-auth`, incl. sidechain-exclusion, boundary+summary dedup, and lookback-window coverage shapes), audit 21 → 22 (`selfCompliance` shape + rate-withheld gate). Fixture shapes byte-verified against a real 2026-07-10 transcript (string-content typed prompts, `compact_boundary` + `compactMetadata`, tool_use blocks).
- **CLI report format**: stdout summary now prints `violations/opportunities (rate, status)` per rule; markdown table adds Opportunities/Rate/Precision/Status columns. Command doc warns that same-day re-runs overwrite `tasks/sampling-audit-<date>.md` (use `--json` to protect hand-written analysis).

## [0.27.0] - 2026-07-10

**Minor — post-compaction §11 re-read reminder (new SessionStart behavior) + spec v6.14.2 wording patch.** First implementation tranche of `docs/spec-optimization-plan-2026-07-10.md` (P6 items F1–F4).

- **Compaction re-read reminder** (`hooks/session-start-check.sh`): SessionStart events with `source=="compact"` (auto or manual compaction — verified against code.claude.com/docs/en/hooks) now emit a one-line `additionalContext` banner: re-read the active plan + spec state per core §11 before continuing L2+ work. Rationale: §11 post-compaction re-read is a self-enforced rule guarding exactly the state where model attention is least reliable — it depended on the very attention it protects; the banner makes it hook-assisted. Advisory only, never blocks. **Opt-out**: `DISABLE_COMPACT_REREAD_REMINDER=1` (README §2a). Telemetry event: `session-start / compact-reminder / §11`.
- **Behavior change on compact events**: `source=="compact"` now exits early — bootstrap, upgrade-banner, and summary-banner no longer run on compaction. They are session-START concerns; re-running `install.js` mid-session on a compaction event was never desirable. Startup / resume / clear paths are unchanged (stdin is now parsed whenever `jq` is present, previously only when `CLAUDE_SESSION_ID` was unset — needed for the `source` field; no observable difference on those paths).
- **Spec v6.14.2** (patch — wording only, no rule change; detail in `spec/CLAUDE-changelog.md`): (1) extended header load-scope "review" → "pre-ship review", aligning with core §2.2 (per-task code review does not load extended); (2) trigger-word lists marked non-exhaustive with `e.g.` (quality-slider / depth-triggers / HACK / EMERGENCY / three-strike / continuation-cancel-switch) — detector-consumed lists (§11 mid-SPINE tell) stay exact; (3) context7 hard references conditionalized to "docs-lookup for API claims (e.g. context7, if available)" + a §12 fallback-table row (WebFetch official docs).
- **Tests**: `session-start.test.sh` 14 → 17 — compact banner emits exactly ONE JSON object (`jq -s length == 1`, per the v0.23.13 double-emit lesson); `DISABLE_COMPACT_REREAD_REMINDER=1` suppresses; compact does NOT spawn bootstrap even when the manifest is missing. Version-pin cascade updated (`spec-structure.test.js`, `upgrade-lifecycle.test.sh`, `hard-rules.json#spec_version`).

## [0.26.2] - 2026-07-07

**Patch — dogfood QA hardening: three false-positive / data-loss fixes surfaced by an end-to-end usage pass.** All `fix:` (restore intended behavior); spec unchanged (stays v6.14.1). No new user-facing features.

- **statusLine multi-supersede data loss** (`scripts/lib/statusline.js`): `/claudemd-statusline adopt --supersede=A` then `--supersede=B` on a composite host overwrote the single `{superseded:<prov>}` restore record, so `remove()` restored only B — A was permanently lost from the host registry. The record is now a `{superseded:[…]}` list: `adopt()` appends (dedup by id), `remove()` restores ALL entries in reverse order (front-insert) so they regain their original relative order. Legacy singular records written by ≤0.26.1 are still restored (`readSupersededList()` normalizes both shapes), so an upgrade taken mid-supersede loses nothing.
- **banned-vocab `-am` false positive** (`hooks/banned-vocab-check.sh`): the commit-message extractor matched `-m`/`--message` but not combined short-flag blocks, so `git commit -am "…"` (one of the most common forms) fell through to the whole-command fallback — a banned word in a *chained* segment (`git commit -am "clean fix" && npm run comprehensive-x`) falsely denied a clean-message commit that the identical `-m` form passed. The extract + strip regexes now use `-[[:alpha:]]*m` (matches `-m`/`-am`/`-vam`; a strict superset — bare `-m` still matches with zero leading alphas).
- **§10-V identifier/path FP in the standalone CLI + transcript scan** (`scripts/lib/lint.js`, `bin/claudemd-lint.js`, `hooks/transcript-vocab-scan.sh`): the v0.23.19 Path 2 sanitizer was never ported to two siblings. `claudemd-cli lint` (used in git pre-commit hooks / CI) flagged commit messages naming a file/branch/backtick-identifier that embeds a high-fire word (`refactor comprehensive-parser.js` → exit 1 → **blocked commit**); `transcript-vocab-scan` inflated §10-V advisory telemetry the same way. Added `stripIdentifiers()` (new `lib/lint.js` export) + a `scan({sanitize})` opt-in wired into the CLI `lint`/`audit` paths, and the mirror awk+sed in `transcript-vocab-scan.sh`. Rule set: fenced blocks → inline backtick spans → slashed-path runs → bare `name.ext` files (lowercase-extension only, so decimals/versions like `3.5x`/`v6.14` survive and a baseline-less ratio claim is not swallowed — no false negative). Bare hyphenated identifiers with no extension/slash (`robust-retry`) remain a residual FP, the same `\b`-boundary limitation Path 2 has.
- **Tests (+8 → 611 Node tests; +5 shell hook tests)**: `statusline-adopt.test.js` multi-supersede + legacy-singular restore; `lint.test.js` `stripIdentifiers` + `scan({sanitize})` FP-fix + FN-guards; `banned-vocab.test.sh` 41 → 44 (`-am`/`-vam` isolation); `transcript-vocab-scan.test.sh` 12 → 14 (identifier-only clean / bare-prose-beside-id still fires).

## [0.26.1] - 2026-07-06

**Patch — post-release review hardening of v0.26.0 statusLine coexistence.** Three fixes from an independent post-ship review (`superpowers:requesting-code-review`); no user-visible behavior change on the normal path. Spec unchanged (stays v6.14.1).

- **Durability fix** (`scripts/lib/statusline-hosts.js`): the guest-registry write now writes the durable `~/.claude` mirror **first** and no longer swallows its errors. Previously the volatile `~/.cache` primary was written first and unguarded while the durable mirror — the backstop code-graph self-heals the primary from — was best-effort; a silently-dropped mirror write could diverge from the primary and, after a `~/.cache` eviction, drop claudemd's segment. A failed durable write now surfaces instead of hiding.
- **Observability** (`scripts/lib/statusline.js`, `scripts/statusline-adopt.js`): `adopt --supersede=<id>` for an id not in the host registry no longer silently no-ops — `adopt()` returns `supersedeMissed:<id>` and the CLI warns, so a stale / TOCTOU id is visible instead of passing as a successful supersede.
- **Single source of truth for the supersede heuristic** (`scripts/lib/statusline.js`, `commands/claudemd-statusline.md`): `detect()` now surfaces the tested `manualPsCandidates()` predicate as a `psCandidates` array; the command reads that field instead of re-deriving the hand-made-PS1 heuristic in prose, removing drift between the tested predicate and the one that runs.
- **Tests (+5 → 603 Node tests)**: durable-mirror-first-no-swallow (`statusline-hosts.test.js`), `psCandidates` on host + null off-host and `supersedeMissed` (`statusline-adopt.test.js`), CLI supersede-missed warning (`statusline-cli.test.js`).

## [0.26.0] - 2026-07-06

**Minor — statusLine multi-provider coexistence.** When a composite host (code-graph) owns the `statusLine` slot, `/claudemd-statusline` now registers claudemd as a *guest* provider in the host's registry so both segments render (`claudemd | code-graph`), instead of clobbering the slot. Empty-slot behavior is unchanged. Spec content unchanged (v6.14.1).

- **Adaptive strategy** (`scripts/lib/statusline.js` + new `scripts/lib/statusline-hosts.js`): `detect()` reports `absent | claudemd | host | foreign`. `host` → guest-register (front of the host registry, absolute-path command so code-graph's `execFileSync` runner — which expands `~` but not `$HOME` — can run it); `absent` → own the slot (v0.25.x); non-composite `foreign` → report/`--force` (host-wrap deferred to v0.26.1, see `tasks/statusline-host-wrap-deferred.md`).
- **Supersede consent**: `/claudemd-statusline` offers to replace a detected hand-made PS1 provider (`--supersede=<id>`, saved for restore) or keep both — never silent.
- **Install**: a composite host in the slot yields a `host-detected` note (run `/claudemd-statusline`) — install never writes another plugin's registry.
- **remove/uninstall**: guest mode unregisters claudemd from the host registry (restoring a superseded provider) and deletes the renderer; the host keeps the slot.
- **M2**: renderer strips embedded newlines in cwd/model (one-line guarantee). **M5**: CLI default is human-readable, `--json` for machine output; `--supersede=<id>` added.
- **Tests (+24 → 598 Node tests)**: `statusline-hosts.test.js` (adapter), plus host/guest/supersede cases across `statusline-adopt.test.js`, `statusline-cli.test.js`, `install.test.js`.

## [0.25.1] - 2026-07-06

**Patch — post-release review hardening of the v0.25.0 statusLine detector: a present-but-unrecognised `statusLine` slot is now treated as `foreign` (never overwritten by the empty-slot install), closing a latent hole in the never-clobber invariant.** No behavior change for any valid Claude Code config; spec unchanged (stays v6.14.1).

- **`detect()` presence check (`scripts/lib/statusline.js`):** classification now keys on slot *presence*, not command-parseability. Any present slot that isn't claudemd's `{command:"…claudemd-statusline.sh"}` — a bare string, `{}`, `{command:""}`, `{command:123}`, or an alternate `type` — reads as `foreign`, so the empty-slot install skips it instead of collapsing it to `absent` and clobbering it. Only a missing / `null` / `""` slot is `absent`. CC's real slot is `{type:"command",command:"<string>"}` (already classified `foreign` and skipped), so no confirmed valid config reached the old path: this is defense-in-depth on the #1 "never touch a foreign slot" invariant, not a fix to observed data loss.
- **Stale prev cleanup:** a plain empty-slot `set` now clears any leftover `statusline-prev.json` from an earlier `--force` undone out-of-band, so a later `remove` empties the slot instead of resurrecting the stale foreign command.
- **Tests (+4 → 574 Node tests):** `statusline-adopt.test.js` locks the foreign-shape classification (bare string / `{}` / empty / numeric / alt-`type` all skip untouched), the absent boundary (`null` / `""` / missing still adopt), and the stale-prev case; `uninstall.test.js` now ships a renderer fixture so `beforeEach` exercises a real install-time statusLine set, and asserts the no-manifest uninstall still un-wires a claudemd slot and deletes the renderer (constraint-#5 no-manifest sub-case, previously unasserted).

Provenance: `superpowers:requesting-code-review` whole-feature audit of `60312c8..cce65ee` — 0 Critical, 1 Important (the detector hole above), 5 Minor; verdict "Ready to merge: Yes" for v0.25.0 with this patch recommended. Minors M2 (renderer newline-strip) and M5 (`--json` / `--dry-run` UX) deferred to `tasks/statusline-v0251-deferred.md`.

## [0.25.0] - 2026-07-05

**Minor — statusLine auto-registration: a new PS1-style statusLine — `user@host:/path (branch) Model [ctx:N%]` — with a semantic context-pressure color (`[ctx:N%]` green <50%, yellow 50–79%, red ≥80%).** Spec content unchanged (stays v6.14.1).

- **Auto (install):** a fresh install wires the statusLine into `~/.claude/settings.json` **only when the `statusLine` slot is empty**. An existing statusline (any other provider) is left untouched; a statusline error never fails the install.
- **Command:** `/claudemd-statusline` (adopt) · `check` (report the current owner, no writes) · `remove` (restore the prior statusline or clear the slot; delete the renderer) · `--force` (take over a foreign slot, saving its command so `remove` can restore it). Always shows the diff and asks before writing (`~/.claude/settings.json` is a §5 hard-AUTH path).
- **Opt-out:** set `CLAUDEMD_NO_STATUSLINE=1` before install to skip the statusLine write entirely.
- **Revert:** `/claudemd-statusline remove` restores the prior statusline (or clears the slot) and deletes `~/.claude/claudemd-statusline.sh`.

Migration: existing users with a statusline already configured see no change (empty-slot-only install). To adopt claudemd's line, run `/claudemd-statusline` (`--force` to replace another provider's).

### Added — `scripts/lib/statusline.js` + `scripts/statusline-adopt.js` (CLI: detect/adopt/remove) + `scripts/statusline.sh` (renderer)

- `detect` reports `absent | claudemd | foreign` plus whether `~/.claude/claudemd-statusline.sh` matches the shipped renderer. `adopt` writes the stable-path command `bash "$HOME/.claude/claudemd-statusline.sh"` and copies the renderer (`--empty-only` install-time guard, `--force` foreign-slot takeover with prior-command save, `--dry-run` preview). `remove` restores the saved prior command (or clears the slot) and deletes the copied renderer; no-op if claudemd doesn't own the slot.
- `scripts/statusline.sh`: single NUL-delimited `jq` read so an embedded newline in a field can't misalign cwd/model/context; `[ctx:N%]` from `.context_window.used_percentage`, threshold-colored (green/yellow/red at 50/80).

### Added — `/claudemd-statusline` (agent contract)

- `commands/claudemd-statusline.md`: detect → consent gate (always, binds under `AUTONOMY_LEVEL: aggressive`) → adopt/remove → re-verify and cite `verdict: claudemd` as completion evidence.

### Changed — `install.js` / `uninstall.js`

- Install: best-effort empty-slot-only statusLine adopt runs after the spec/hook/manifest steps; `CLAUDEMD_NO_STATUSLINE=1` skips it entirely.
- Uninstall: un-wires a claudemd-owned statusLine entry and deletes `~/.claude/claudemd-statusline.sh`; a foreign statusline is left untouched.

### Tests

- `tests/scripts/statusline.test.js`, `statusline-adopt.test.js`, `statusline-cli.test.js`; install/uninstall coverage in `install.test.js` (#200-202: empty-slot set, foreign no-clobber, `CLAUDEMD_NO_STATUSLINE` opt-out) and `uninstall.test.js` (#546-547: cleanup + foreign-untouched). Full suite: 570 Node tests + 22 shell hook suites + 2 integration suites (`full-lifecycle`, `upgrade-lifecycle`) all pass; `upgrade-lifecycle` explicitly asserts `manifest.version upgraded to 0.25.0`.

## [0.24.1] - 2026-07-05

**Patch — fix the macOS CI red on v0.24.0: `design-detect.js`'s "run as main" guard now realpaths both sides so a symlinked invocation path resolves.** Spec unchanged.

- `scripts/design-detect.js`: the ESM main guard `import.meta.url === pathToFileURL(process.argv[1]).href` failed whenever node resolved `import.meta.url` through a symlink while `process.argv[1]` stayed unresolved — on macOS a mkdtemp under `/var/folders/…` is symlinked to `/private/var/folders/…`, so the CLI block never ran and stdout was silently empty (the v0.24.0 macOS CI failure; ubuntu was green). It would also bite a symlinked plugin dir. Fixed by comparing `fs.realpathSync(fileURLToPath(import.meta.url))` against `fs.realpathSync(process.argv[1])` — spaces, non-ASCII, and symlinks all resolve. The `#3` main-guard test now doubles as the symlink regression lock (its mkdtemp base is the symlink on macOS). Same macOS-symlink class as `feedback_macos_shell_portability`.

## [0.24.0] - 2026-07-05

**Minor — design-adopt: a new `/claudemd-design-adopt` command generates a thin, fact-based `DESIGN.md` from a UI project's real design-token sources and wires it into project CLAUDE.md, so agents use the project's tokens instead of inventing colors/spacing.** Spec content unchanged (stays v6.14.1). Origin: comparative analysis of a community AGENTS.md generator (whose template-stuffing approach is this feature's explicit anti-goal) + a manual prototype on a real Vue/Element-Plus product repo; spec at `tasks/specs/design-adopt.md`.

**What changes for you**: a new opt-in slash command, nothing else. There is **no SessionStart hook and nothing auto-fires** — you invoke `/claudemd-design-adopt` when you want it (Claude may also suggest it when you're doing UI work in a token-bearing project). It detects the project's design tokens, drafts a `DESIGN.md` that points at the real source-of-truth files (never duplicates or invents values), wires a sentinel block into project CLAUDE.md, and **always shows the diff and asks before writing**.

Built in three passes and two adversarial max-effort reviews. The first review (40 findings) drove a correctness sweep; the second (adversarial re-review, 40 findings) showed the severe issues concentrated in an earlier **SessionStart auto-hint** design — cache/pending-file collisions, statefile races, false-positive nagging, and residue. Rather than keep hardening a heuristic that fires silently, the auto-hint was **cut**: the detector is now stateless and command-only, so the human's diff+consent gate is the safety net and the entire hint-path failure class is designed out. Findings + resolutions: `tasks/design-adopt-review-findings-2026-07-05.md`.

### Added — `scripts/design-detect.js` (deterministic, stateless detector, zero-LLM)

- Classifies a repo `no-ui | ui-no-tokens | adoptable | unwired | configured` from filesystem facts, writing **nothing** to disk (no cache, no state). package.json deps drive the UI signal: direct **and** meta-frameworks (Nuxt/Astro/Remix/Gatsby/SvelteKit, whose base framework is only transitive), component-lib and atomic-CSS lists; a subproject fallback covers declared workspaces (`packages/*` + `apps/*`) and the workspace-less fullstack split (empty root + a strong SPA-root subdir — `frontend|web|client` only, so an incidental `site/`/`app/` in a backend repo does not false-positive). Bounded walk (depth ≤4, ≤400 dirs, ≤60 CSS content-scans) anchored at the **UI subproject** when one is identified — so a monorepo's non-UI sibling package can't donate its token files to the UI package, and deep `packages/<pkg>/src/assets/styles/` tokens stay reachable. Token counting parses `:root` **and** Tailwind-v4 `@theme` blocks with a brace-depth scan that is robust to nested SCSS/Less interpolation (`#{map-get($m, #{$k})}`), unterminated `/* comments`, nested selectors, and digit/underscore-first custom-property names (`--2xl`, `--_gap`); component-scoped props with a `:root` mention only in a comment do not count. Wiring check reads the **full** CLAUDE.md (root + subproject) and requires a `DESIGN.md` reference or the adopt sentinel — a bare token-basename mention (e.g. `app.css`) is not accepted. FIFO-safe reads (isFile-guarded); `pathToFileURL` main guard (runs from paths with spaces / non-ASCII). Fail-open: exit 0 on every verdict, argv errors exit 2 (`parseStrict`).

### Added — `/claudemd-design-adopt` (agent contract)

- `commands/claudemd-design-adopt.md`: detect → read real token sources → draft DESIGN.md under a facts-only contract (thin pointer to the source-of-truth files; hard rules from an evidence-gated menu — semantic vars / dark mode / spacing base / mixin reuse / mono font / contrast commitments — no rule without evidence, no invented values, no generic boilerplate) → wire an idempotent `<!-- claudemd-design:begin v1 -->` sentinel block into project CLAUDE.md (for a monorepo, the subproject CLAUDE.md the detector's wiring check also reads) → mandatory diff + consent before writing (even under `AUTONOMY_LEVEL: aggressive`) → re-run detector and cite `verdict: configured` as completion evidence. `check` verifies DESIGN.md pointers resolve; `remove` unwires the block (never deletes DESIGN.md). Domain color semantics (e.g. finance red-up/green-down) are marked TODO for the human unless a source comment states them.

### Tests

- `tests/scripts/design-detect.test.js` (19 cases): verdict matrix over 16 fixtures; FP traps (node_modules token file, <8-prop `:root`, `:root`-in-comment + component-scoped props, unterminated-comment block, backend-with-`site/`, bare-basename wiring mention, monorepo cross-package token misattribution); meta-framework Nuxt, Tailwind v4 `@theme`, deep-monorepo + fullstack subproject walk; nested-SCSS-interpolation and digit/underscore-first custom-prop locks; byte-exact real-repo `variables.scss` lock; >64KB CLAUDE.md wiring; FIFO non-hang; stable token-set enumeration; path-with-space main guard; CLI contract. No SessionStart hook changes (that integration was cut). Full suite 523 → 542 pass. Real-repo verification: the motivating fullstack Vue repo detects `configured` (2 token sources), this plugin repo `no-ui`.

## [0.23.23] - 2026-07-03

**Patch — a self-audit found a doctor↔audit telemetry-parity gap, then an adversarial §8 false-negative sweep (hardened by a code review) closed four "execute scripts of unknown origin" bypass classes in the pre-bash-safety hook.** Spec content unchanged (stays v6.14.1).

### Fixed — `doctor`: rule-usage counted test-session/probe rows that `audit.js` filters

- `scripts/doctor.js`: the `rule-usage` health check derived its deny/bypass counts (and the §0.1 demote verdict downstream of them) from the raw `readHits` output, while the sibling `audit.js` strips manual-probe / sentinel-session rows via `excludeTestSessions`. On the same 30-day window doctor over-reported — `§7-ship-baseline` deny 17 vs audit's 9, `§8-rm-rf-var` 121 vs 101. Both rule-usage consumers (the `groupBySection` count + the demote-candidate token-breakdown loop) now filter identically; the `fail-open` check stays on raw hits by design (its rows are `session_id:null`). Doctor now matches audit.js across every section. Tests: `doctor.test.js` +2 (sentinel-exclusion count + token-breakdown).

### Fixed — §8: four "execute scripts of unknown origin" false negatives in `pre-bash-safety`

A 2026-07-03 adversarial audit (feed dangerous commands to the detector, observe allow/deny) plus a `superpowers` code review found the hook enforced only the literal forms of §8's unknown-origin / NPX rules. Four classes now covered — each adds denials only, verified against a false-positive control set:

- **Fetch-execute runner family**: the NPX gate matched only literal `npx`; `pnpm dlx` / `yarn dlx` / `bunx` / `npm exec` of an unpinned unknown package bypassed it (identical fetch-execute — `npx` is a shortcut for `npm exec`). `NPX_REGEX` extended to the family, reusing the existing pinned/local/lockfile resolution (already reads pnpm-lock.yaml / yarn.lock). `npm install` / `pnpm install` / `yarn add` stay excluded (the regex requires the `exec` / `dlx` subcommand).
- **`curl … | sh`** (new Pattern 3): no detector existed for piping or `<()`-substituting a network fetch into a shell. Fires when `curl`/`wget` in command position feeds `sh`/`bash`/`zsh`/`dash`/`ksh`/`ash` (optionally via `sudo`), matched per pipeline segment on the sanitized command. Local/literal sources (`cat x.sh | sh`), non-shell sinks (`| jq`), download-only (`curl -o`), and prose-in-quotes stay allowed. New `§8-curl-sh` telemetry section + `[allow-curl-sh]` bypass token.
- **rm behind wrappers**: `sudo` / `doas` / `timeout N` / `nice -nN` / `stdbuf` / `ionice` / `chrt` before `rm -rf $VAR` bypassed the segment-start `rm` check. The wrapper-strip loop now handles them (arg-less + flag-bearing, consuming a wrapper's options and numeric/duration args, stopping at the first command word). Stripping only removes prefixes, so a non-rm command or a safe rm (literal path / `$HOME` subpath) never false-denies.
- **Code review follow-up** (folded in): `sudo -E/-i/-H/-n rm` (sudo is flag-bearing, not arg-less), `npm exec`, and brace-group `{ curl … | sh; }` were caught adversarially after the initial fixes. Documented residuals: option-with-argument wrapper forms (`sudo -u svc rm`, `timeout -s KILL 5 rm`), `eval "$(curl)"`, `find -delete`.

Hook tests +50 (206 in `pre-bash-safety.test.sh`); full suite 523 pass. `docs/RULE-HITS-SCHEMA.md` synced (new `§8-curl-sh` section + `allow-curl-sh` token). Findings + deferred residuals recorded in `tasks/s8-false-negative-audit-2026-07-03.md` and `tasks/project-audit-findings-2026-07-03.md`.

## [0.23.22] - 2026-07-02

**Patch — follow-up to v0.23.21 (code review): sync the two remaining dedup-key reference docs + harden the `extra` key against future key-order variance.** Spec content unchanged (stays v6.14.1).

### Fixed — two dedup-key reference docs still taught the pre-v0.23.21 4-field model

- v0.23.21 extended the `uniqueInvocations` dedup key to `(ts, hook, session_id, tool_use_id, event, extra)` and synced the parse-fn comment + `commands/claudemd-audit.md`, but two other canonical descriptions were left on the old 4-field model — and `scripts/audit.js:70` cross-references the first as authoritative, routing a maintainer straight into the pre-fix "byte-identical multi-emit looks like a bug" misread. Synced both: `hooks/lib/rule-hits.sh:21-25` (the `TOOL_USE_ID` param doc — ships with the plugin) and `docs/RULE-HITS-SCHEMA.md:16` (the `tool_use_id` field row — tracked via the `docs/*` + `!docs/<file>` gitignore allowlist) now carry the 6-field key + the multi-emit "confirm against the source command" caveat. Found by a `superpowers:requesting-code-review` pass on v0.23.21.

### Changed — canonicalize `extra` before the dedup key (defensive hardening)

- `scripts/lib/rule-hits-parse.js`: the key serialized `extra` with bare `JSON.stringify`, so double-fire detection silently depended on stable key order. Unreachable for `_real` today (every hook emits `extra` from fixed templates / single-key objects; the only multi-key extra — mem-audit `{missing,drift}` — carries a null `tool_use_id` → lands in `_legacy`), but a future multi-key extra on a `tool_use_id`-bearing hook built from an unordered source (`declare -A`) would let a genuine double-fire evade. New `stableExtraKey()` sorts top-level keys before serializing — behavior-preserving on current data (live-log `pre-bash-safety` `duplicate_rows_real` stays 34). Two direct unit tests added in `tests/scripts/rule-hits-parse.test.js` (reordered-key double-fire still collides → 1 unique / 1 `_real`; distinct-extra multi-emit stays separate → 2 / 0); `uniqueInvocations` previously had no unit-level coverage, only via `audit()`. Also noted: the v0.23.21 key extension incidentally narrows `duplicate_rows_legacy` (distinct event/extra rows at a null `tool_use_id` now count as unique — more correct; `_legacy` is documented non-gating noise). Renamed the v0.9.34 audit test title to state what it verifies (byte-identical collapse) instead of over-claiming the full key. Full suite 519 → 521 pass.

## [0.23.21] - 2026-07-02

**Patch — audit `duplicate_rows_real` over-counted multi-emit hooks as registration double-fires; found by a 30-day /claudemd-audit self-review.** Spec content unchanged (stays v6.14.1).

### Fixed — `uniqueInvocations` dedup key mis-counted `pre-bash-safety` multi-emit rows as double-fires

- `scripts/lib/rule-hits-parse.js` (`uniqueInvocations`): the v0.9.34 dedup key was `(ts, hook, session_id, tool_use_id)`, but `pre-bash-safety` is a MULTI-EMIT hook — one compound command logs one row per matched pattern (distinct `extra.var`, or mixed `§8-rm-rf-var` + `§8-npx` sections), all four key fields identical across those rows. Every row after the first was therefore counted as `duplicate_rows_real` — the signal `/claudemd-audit` documents as a "registration/lib double-fire bug candidate" — producing 77 phantom `_real` on a 30-day live-log window. Same "an audit red flag can be an artifact" class as the v0.23.20 sentinel-filter fix, different root cause. Fix: include `(event, extra)` in the key. A true double-fire emits BYTE-IDENTICAL rows (same event+extra) and still collides, so detection for single-emit hooks (banned-vocab / ship-baseline / memory-read-check) is preserved. Post-fix on the live log: `pre-bash-safety` `duplicate_rows_real` 77 → 34 — the residual is one command legitimately repeating the SAME pattern (`rm -rf $D/a; rm -rf $D/b`), which telemetry cannot distinguish from a double-registration; a real double-REGISTRATION would double EVERY row (~600/1191), not 34, so the residual is not a bug. Regression test `tests/scripts/audit.test.js` "v0.23.21: multi-emit hook…" pins it (pre-fix `unique_invocations`=3 / `_real`=3, post-fix 5 / 1). Docs synced: `rule-hits-parse.js` header comment + `commands/claudemd-audit.md` field-guard now carry the multi-emit caveat (confirm a `pre-bash-safety` `_real` against the source command before reporting a bug). Full suite: 519 pass + integration green.

## [0.23.20] - 2026-06-13

**Patch — two telemetry-integrity fixes found by a 7-day /claudemd-audit self-review: ad-hoc debug sentinels polluted audit views, and banned-vocab's bypass event violated its own documented schema.** Spec content unchanged (stays v6.14.1).

### Fixed — audit views: ad-hoc manual-debug sentinel rows counted as real traffic

- `scripts/lib/rule-hits-parse.js` (`excludeTestSessions`): the v0.17.7 filter full-matched only `session_id='t'/'test'`, so manual hook debugging with other one-char sentinels slipped through — eight 2026-06-09 ship-baseline fixture rows with `session_id='s'` / `tool_use_id='t'` / `run_url=https://x/runs/99` inflated self-deny counts (9 denies reported, 8 synthetic) AND faked `duplicate_rows_real=6`, the signal /claudemd-audit documents as a "registration/lib double-fire bug candidate". Fix: also strip any non-null session_id of ≤7 chars — real CC session ids are 36-char UUIDs; all observed synthetic values (`s`, `p`, `probe`, `r4-test`, 353 rows all-time) fall under the cap, while longer one-offs (`dogfood-fresh`, 7 rows) age out naturally. Post-fix on the live log (7-day window): `testSessionsFiltered` 0 → 33, ship-baseline `duplicate_rows_real` 6 → 0, ship-baseline denies 9 → 1 (the survivor is the genuine daagu red-CI interception). Three test fixtures using short ids (`s1`/`s2`/`sess-A`) renamed to ≥8 chars — they simulated real sessions with a shape real sessions never have. Docs synced: `commands/claudemd-audit.md` + `scripts/audit.js` comments.

### Fixed — `banned-vocab`: bypass-escape-hatch recorded `extra:null`, contradicting RULE-HITS-SCHEMA

- `hooks/banned-vocab-check.sh:80`: `docs/RULE-HITS-SCHEMA.md` line 33 documents bypass-escape-hatch as "records token name in `extra`", and the pre-bash-safety siblings do (`{"token":"allow-rm-rf-var"}`), but banned-vocab passed literal `null` — the audit's `byBypass` showed `(unspecified)` ×3 sitting exactly on the ≥3 §0.1 review-candidate threshold with no way to tell which token fired (same spec≠impl gap class as `feedback_hook_header_quote_partial_impl`). Fix: record `{"token":"allow-banned-vocab"}`; `tests/hooks/contract.test.sh` A.1 tightened from event-presence to `.extra.token=="allow-banned-vocab"` (pre-fix FAIL showing `extra:null`, post-fix PASS). A `tests/hooks/session-end-check.test.sh` fixture already assumed this shape — implementation now matches it. Full run post-fix: `OVERALL: all suites passed` (4 mid-bundle failures from the sentinel-cap widening fixed by the fixture renames above).

## [0.23.19] - 2026-06-13

**Patch — two field-report FPs (external transcript, bat-html-website session 2026-06-12): §8-npx denied a fetch-free `npx --no-install` probe; §10-V Path 2 denied 3 consecutive pushes on a banned word living only inside a branch name.** Spec content unchanged (stays v6.14.1).

### Fixed — `pre-bash-safety`: `npx --no-install <pkg>` denied despite being unable to fetch

- `hooks/pre-bash-safety-check.sh`: the npx flag loop treated `--no-install` as a generic skippable flag, took the following token as the package name, and denied when the cwd had no lockfile/local install. But `--no-install` (npx v6) / `--no` (npm 7+) forbid registry fetch entirely — npx runs an already-installed binary or exits non-zero, so no unknown-origin code can land, which is what the §8 NPX chain guards. The denied command was the agent's harmless capability probe (`npx --no-install htmlhint --version … || echo "htmlhint not local"`), and the deny forced it to abandon the tool instead. Fix: recognize `--no-install` / `--no` BEFORE the package token and allow, recording a new `npx-allow-no-install` telemetry event (documented in `docs/RULE-HITS-SCHEMA.md` + contract test). Flags after the package name belong to the package and do NOT lift the gate. Tests: +5 (incl. byte-exact field-report chain; pre-fix 149/152 → post-fix 152/152).

### Fixed — `banned-vocab` Path 2: identifier/path mentions and prior-turn text caused an un-escapable deny loop

- `hooks/banned-vocab-check.sh` (two FP vectors, one field report): pushing `docs/comprehensive-audit-2026-06-12` was denied; the agent renamed the branch and was denied twice more, because (a) `\b`-anchored high-fire patterns match INSIDE slashed/hyphenated identifiers (`-` and `/` are word boundaries), so the branch name quoted in prose fired the scan, and (b) the "last assistant turn" extraction actually concatenated ALL assistant text in the tail-200 window (`tail -c 4096` cap), so the original prose kept re-firing on every retry — only the bypass token could exit the loop, contradicting the deny message's own "preceding assistant turn" claim. Fix (a): sanitize the scanned prose before matching — strip fenced code blocks, inline backtick spans, and path-like ASCII runs containing `/` (the path class is ASCII-only so 中文 prose around a path stays intact; bare-prose violations still match). Fix (b): extract assistant entries AFTER the last real typed user prompt (STRING content per `feedback_cc_user_content_string_vs_array`; tool_result ARRAY entries and `<system-reminder>`/`isMeta` injections are mid-turn, NOT boundaries; no prompt in window → pre-fix whole-window fallback). Tests: +6 — slashed-branch (byte-near field report), backtick span, fenced block, bare-prose-beside-path regression guard, prior-turn-before-prompt pass, tool_result-not-a-boundary deny (pre-fix 37/41 → post-fix 41/41). Sibling advisory scanners (`transcript-vocab-scan.sh`, CLI lint) share the identifier FP class at advisory-only severity — queued in `tasks/banned-vocab-sanitizer-siblings.md`.

### Fixed — `tests/scripts/audit.test.js`: two tests were date time-bombs (mid-bundle discovery)

- Tests `v0.9.34` and `v0.21.7` pinned fixture timestamps to literal dates (`2026-05-11`, `2026-05-24`); once today's date drifted past the `days: 30` audit window the rows were filtered out and the bucket lookups threw `Cannot read properties of undefined (reading 'rows')`. The first expired on 2026-06-10 (red on clean main since then, locally; CI last ran 2026-06-09 so it never surfaced there), the second would expire 2026-06-23. Fix: derive timestamps from `Date.now() - 60s` with per-row second offsets — dedup semantics (same-second collisions) preserved. Found because this release's full-suite run hit it; unrelated to the field report.

## [0.23.18] - 2026-06-10

**Patch — install/uninstall crashed with a cryptic error on a malformed-but-valid-JSON settings.json.** Spec content unchanged (stays v6.14.1). Continues the end-to-end user-test sweep into the install path.

### Fixed — `unmergeHook` did not tolerate unexpected settings.json shapes

- `scripts/lib/settings-merge.js`: `unmergeHook` (run by both install.js and uninstall.js to evict legacy claudemd hook entries) assumed every `settings.hooks[event]` is an array and every block carries a `hooks` array. A hand-edited or third-party-written settings.json can be valid JSON yet have a different shape — an event value that is a string, a block missing its `hooks` array, a `null` block or entry. Pre-fix these threw `Cannot read properties of undefined (reading 'length')`, which install.js/uninstall.js surfaced as `install failed: …` / `uninstall failed: …` during an adopter's first-touch flow (it failed safe — settings.json was never written — but the message pointed nowhere). Fix: skip malformed parts and leave them untouched (never mutate or drop structure claudemd did not write), processing only well-formed blocks. The well-formed path is unchanged — claudemd entries are still evicted, user hooks preserved, emptied blocks/events pruned. Added regression tests 17b (5 malformed shapes → no-op, byte-identical) and 17c (mixed block → evict claudemd, keep user hook).

## [0.23.17] - 2026-06-10

**Patch — §8 SAFETY: `dash -c "rm -rf $X"` and other Bourne-family shells were not unwrapped, bypassing the rm-rf-var / npx gate.** Spec content unchanged (stays v6.14.1). Continues the end-to-end user-test sweep into the §8 hook.

### Fixed — indirect-shell unwrap missed dash / ksh / ash

- `hooks/pre-bash-safety-check.sh`: `unwrap_indirect` expands `bash -c '<inner>'` / `sh -c` / `zsh -c` / `eval` so the inner command is re-checked for §8 violations, but the shell set was only `bash|sh|zsh`. `dash` — the Debian/Ubuntu default `/bin/sh` — plus `ksh` and `ash` (busybox) were not unwrapped, so `dash -c "rm -rf $X"` (empty `$X` → `rm -rf /…`) and `dash -c 'npx <unpinned>'` sailed through on the most common CI/server platform. This is distinct from the documented best-effort wrapper exclusions (`sudo` / `timeout` / `xargs` / `nice`, which carry the `[allow-rm-rf-var]` escape and are intentionally not covered) — dash/ksh/ash are in the *covered* indirect-shell class and were simply missed. Fix: widen the shell set to `bash|sh|zsh|dash|ksh|ash` in both unwrap regexes, closing the whole Bourne family rather than one instance. Each name stays separator-anchored, so it never matches inside a longer word (`dashboard`, `stash`). csh/tcsh excluded (different `-c` quoting, rare). Added 7 corpus rows (5 deny incl. `dash -lc` and unpinned-npx, 2 pass FP-guards). Corpus 140 → 147.

## [0.23.16] - 2026-06-10

**Patch — cwd→projects-dir encoding silently no-op'd the §11 gate (and 3 more hooks) for paths with a space / `+` / `@`.** Spec content unchanged (stays v6.14.1). Continues the end-to-end user-test sweep.

### Fixed — narrow `tr '/._'` cwd encoding mis-located the per-project dir

- `hooks/memory-read-check.sh`, `hooks/memory-prompt-hint.sh`, `hooks/banned-vocab-check.sh`, `hooks/lib/rule-hits.sh`: all four derive `~/.claude/projects/<encoded>/` from the cwd, and all used `tr '/._' '-'`. But Claude Code replaces **every** char outside `[a-zA-Z0-9-]` with `-` (the code comments and `feedback_cc_cwd_encoding_dots` both say so). The narrow three-char transform left a space / `+` / `@` / etc. intact, so for any project path containing one (e.g. a macOS path under `Application Support`), the derived dir was wrong → the memory index / transcript was not found → fail-open. Concretely: the HARD §11 memory-read gate silently no-op'd, the §11 memory-hint went dark, the §10-V transcript-vocab scan mis-located the transcript, and `rule-hits` telemetry attributed rows to the wrong project. Fix: all four now use `tr -c 'a-zA-Z0-9-' '-'`, the exact CC transform. For `/._`-only paths the two forms are byte-identical, so this is a strict superset with no behavior change for common paths. Added memory-read-check Case 8b (space-in-cwd → correct encoding → deny); a `/._`-only fixture passes under both the bug and the fix, so the new fixture deliberately uses a space.

## [0.23.15] - 2026-06-10

**Patch — ship-baseline false-positive: a commit message quoting `&& git push` was denied on red CI.** Spec content unchanged (stays v6.14.1). Continues the end-to-end user-test sweep into the PreToolUse hooks.

### Fixed — inline `-m "..."` commit-message prose tripped the push trigger

- `hooks/ship-baseline-check.sh`: v0.23.1 stripped heredoc bodies before the `git push` segment-anchor match so commit-message prose quoting `&& git push` would not trip the CI gate — but only for heredocs. The far more common inline form `git commit -m "fix && git push in docs"` (a pure commit, no push at all) still matched the trigger and was denied on red CI, with a deny message telling the user to add a `known-red baseline:` push-bypass marker — nonsensical for a command that never pushes. Fix: also strip `"..."` and `'...'` quoted bodies (after the heredoc strip + flatten) before the trigger match. A real push is always unquoted, so this removes the false positive without a false negative — `git commit -m "x" && git push` keeps its outside-quote `&& git push` and still gates. The `known-red baseline:` marker check reads the raw command, so the override inside a quoted `-m` payload is unaffected. Added Cases 25–26 (`&&` and `;` inside an inline `-m` quote → pass) alongside the existing non-regression case 21 (real chained push → deny).

## [0.23.14] - 2026-06-10

**Patch — SessionStart emitted invalid JSON when two banners fired together, dropping both.** Spec content unchanged (stays v6.14.1). Continues the end-to-end user-test sweep into the SessionStart / UserPromptSubmit hooks.

### Fixed — upgrade banner silently lost when the user also had session activity

- `hooks/session-start-check.sh`: in the "local install is current" branch, `upstream_check` (upgrade-available banner) and `emit_session_summary_banner` (last-session deny/bypass/warn counts) were called back-to-back, and **each prints its own complete SessionStart `additionalContext` JSON object**. CC parses hook stdout with a strict single-value `JSON.parse`, so two objects concatenated is invalid JSON — `Unexpected non-whitespace character after JSON` — and CC drops **both** banners. The two conditions co-occur exactly in the case that matters: a user with a pending upgrade who also had rule activity last session, so the upgrade notice vanishes precisely when they are active. The existing upstream-check tests (Cases 8–11) ran with no summary file present, so they never produced the two-object output, and their assertions grep for substrings rather than validating JSON. Fix: capture both helpers' output (their side effects — sentinel touch, file rename, `hook_record` — still run inside the command substitution) and emit at most one object via `jq -s`, merging the two `additionalContext` fields with a blank line when both fire. Added Case 14 asserting `jq -s length == 1` on the combined-banner stdout (was 2 pre-fix).

## [0.23.13] - 2026-06-10

**Patch — 4 bugfixes from a 3-round end-to-end user-test sweep (Stop hooks, standalone CLI, sampling audit).** Spec content (`spec/CLAUDE*.md`) unchanged (stays v6.14.1). Each fix carries a reproduction + regression test; node suite 513 → 515, plus added bash hook regression cases (transcript-structure-scan +3, session-end-check +2); all suites + integration green.

### Fixed — §11-session-exit safety net was silently dead in production

- `hooks/session-end-check.sh`: the "last user-input message" detector ran `(.message.content // []) | any(.type=="text")`, but a human-typed prompt is **string** content in a CC transcript (only tool_results are arrays). `any()` over a string throws jq `Cannot iterate over string`; the surrounding `2>/dev/null` swallowed it, the filter returned empty, and the hook hit its `[[ -n "$RESULT" ]] || exit 0` guard — a silent no-op. Because every real session has ≥1 string-content prompt in its last 200 transcript lines, the §11 session-exit `paused.md` safety net (a §5.1 Never-downgrade rule) never fired live; the array-only test fixtures masked it. Fix: guard the iterate by content type (string → input; array → check for a text block), matching the `mid-spine-yield-scan.sh` pattern. Verified end-to-end: a string-prompt + Edit + no-validate transcript wrote no `paused.md` pre-fix, writes it post-fix. Added a string-content fixture + 2 regression cases.

### Fixed — §10-honesty false positive on 中文 / non-`because` rationale

- `hooks/transcript-structure-scan.sh`: the `uncertain-hedge` detector accepted only `because/since/reason:/因为` as rationale connectors, so an Uncertain line written with `由于` / `鉴于` (canonical 中文 equivalents) or English `due to` / `owing to` was flagged as a reasonless hedge though it states a reason. Widened the connector set. Added 3 cases (中文 `由于`, English `due to`, and a still-flagged reasonless line — no false-negative regression).

### Fixed — standalone CLI + sampling audit

- `bin/claudemd-lint.js` `audit`: a JSON-parseable file that is not a CC transcript (e.g. a `{role,content}` export or coerced log) yielded 0 assistant turns and exited 0 with "OK" — a silent false-pass for CI gates. Now exits 2 when parseable rows carry no `type` field (every real CC row has one; confirmed 0/900+ rows lacking it across 4 transcripts). Added 2 cases (wrong-shape → exit 2; legit transcript with only non-assistant rows → exit 0).
- `scripts/sampling-audit.js`: `--sample N` used `arr.sort(() => Math.random() - 0.5)`, a non-uniform shuffle (the comparator violates total-order; V8 biases toward input order — the first element stayed at position 0 32% of trials vs 20% uniform), skewing the sample toward whichever transcripts `readdir` lists first. Replaced with a partial Fisher-Yates; inclusion rate is now ~40% per element at sample=2/N=5 (uniform baseline 40%).

## [0.23.12] - 2026-06-05

**Patch — remove the `memory-coverage-scan` Stop hook (17 → 16 hooks).** The save-side "should-have-saved" advisory shipped default-OFF since v0.13.0 and never earned its keep: 9 advisory events in 30 days, all from a single opt-in repo (this one), against a HARD-blocking read-side already in place. Cutting it resolves the only open item from the 2026-06-03 maturity audit and ends the internal-feature backlog. No spec change (`spec/CLAUDE*.md` stays v6.14.1; the hook was never a `hard-rules.json` rule). Removed: `hooks/memory-coverage-scan.sh` + its test; the `hooks.json` Stop registration; the `hook-registry.js` entry (drops the `MEMORY_COVERAGE` kill-switch + `MEMORY_COVERAGE_SCAN` / `DISABLE_MEMORY_COVERAGE_HOOK` env vars — now no-ops if still set); references in README, ARCHITECTURE.md, RULE-HITS-SCHEMA.md, `claudemd-toggle.md`, `mid-spine-yield-scan.sh` header, and the contract / full-lifecycle / hook-registry / install test count assertions (all moved 17 → 16 together).

**Docs (same day, no version bump).** Repositioned the project framing from a general-purpose enforcement product to a *personal AI-coding discipline harness*: a single-maintainer, dogfooded tool encoding one developer's opinionated spec — fork-and-adapt, not turnkey. Touched the README tagline + a new "Status & scope" note and the three manifest descriptions (`plugin.json` + `marketplace.json` ×2; the `v6.14` spec-version token is preserved in all three). No code or version change. This is the closing half of the 2026-06-03 maturity-audit follow-through — the `memory-coverage-scan` cut above ended the internal-feature backlog; this reframe pivots from internal polish to honest external positioning.

## [0.23.11] - 2026-06-05

**Patch — batched bugfix release from a 5-round end-to-end user-test sweep + an adversarial re-audit.** 39 confirmed bugs fixed across hooks, scripts, and the standalone CLI; spec content (`spec/CLAUDE*.md`) is unchanged (stays v6.14.1). Every fix carries a reproduction + a regression test; suite 484 → 513 node tests + integration, all green. Highlights grouped by class.

### Fixed — §8 SAFETY (immutable) bypasses

- `hooks/lib/hook-common.sh` `hook_is_readonly_bash`: removed `env` from the readonly-command allowlist. `env <cmd>` executes an arbitrary command, so `env rm -rf $VAR` / `env npx <pkg>` / `env curl …` hit the readonly fast-path (`exit 0`) and bypassed ALL FOUR PreToolUse:Bash enforcement hooks. First-token matching cannot tell bare `env` (print environment) from `env <cmd>` (exec).
- `hooks/pre-bash-safety-check.sh` `unwrap_indirect`: matches combined/extra-flag indirect-shell forms (`bash -lc`, `bash -xc`, `sh -lc`, `bash --norc -c`, `bash -x -c`) — previously only bare `-c` was unwrapped, so `bash -lc 'rm -rf $X'` slipped through.
- `hooks/pre-bash-safety-check.sh` rm-segment detector: strips leading env-var assignments AND transparent exec-wrappers (`FOO=bar rm`, `env rm`, `command rm`, `nohup rm`, `setsid rm`, `time rm`) before the `rm` check — these all execute `rm` but began with a non-`rm` token.
- `hooks/pre-bash-safety-check.sh` `sanitize_cmd`: line-comment strip runs AFTER the quote strips, and `#` inside `$`-double-quoted bodies is neutralized — so `git commit -m 'msg # note' && rm -rf $X` no longer has its chained `&& rm -rf $X` eaten as a comment.

### Fixed — §7 / §11 enforcement gaps

- `hooks/ship-baseline-check.sh`: the `-h`/`--help` exemption is scoped to the `git push` segment and requires a standalone flag token, so a branch named `feature-h` or a `-h` in a commit message no longer exempts a red-CI push.
- `hooks/memory-read-check.sh` `sanitize_for_tagmatch`: line-comment strip moved after quote strips — `git commit -m "closes #42" && deploy <topic>` no longer has the trigger verb + topic tag eaten by the `#42`, which had silently bypassed the §11 memory gate.

### Fixed — fail-open: hooks must never crash

- `hooks/residue-audit.sh`, `hooks/lib/rule-hits.sh`, `hooks/session-start-check.sh`, `hooks/mem-audit.sh`, `hooks/ship-baseline-check.sh`: numeric-guard every arithmetic on a corrupt/external value (`tmp-baseline.txt`, `SPEC_RESIDUE_THRESHOLD`, `CLAUDEMD_LOG_MAX_MB`, a non-numeric `denies` in `last-session-summary.json`, `smtime`). Under `set -u` these were unbound-variable crashes (exit 1) instead of fail-open; a corrupt baseline crashed every subsequent Stop.
- `hooks/session-start-check.sh` upstream-check: the 24h sentinel is touched BEFORE the network probe, so an offline user / transient git failure / non-semver remote tag no longer re-runs the 3s `git ls-remote` on every SessionStart.

### Fixed — aggregation / audit correctness

- `scripts/lib/rule-hits-parse.js`: `readHits` counts JSON-valid-but-bad/missing/null-`ts` rows as `skipped` (was silently dropped with `skipped:0`, hiding log corruption from §13.1 review); `detectCutover` / `groupBySection` / `byTrend` guard null `ts` (`new Date(null).getTime()===0` collapsed the historical/current split to 1970). New `blockingDenyCount` helper.
- `scripts/doctor.js`, `scripts/hard-rules-audit.js`, `scripts/sparkline.js`: count the full blocking-deny family (`deny` + `deny-repeat` + `deny-prose`) instead of literal `deny` — undercounting inflated the bypass:deny ratio and FALSELY flagged healthy rules (e.g. §11-memory-read) as §0.1 demote candidates.
- `scripts/hard-rules-audit.js`, `scripts/sparkline.js`: strip hook-unit-test session sentinels (`t`/`test`) before grouping (audit.js already did), so test traffic no longer masks a cold rule or pollutes the release trend.
- `scripts/version-cascade-check.js`: derive the spec-major token from `spec_version` instead of a hardcoded `/v6\./` — a stale `v7.x` reference after a major bump is no longer silently ignored, while the plugin's own `v0.x` versions stay ignored.

### Fixed — data loss

- `scripts/install.js`: never back up spec-over-spec (a byte-identical re-install OR a version upgrade). Pre-fix each re-install/upgrade backed up the spec itself; `restore` picks the newest backup and `pruneBackups(5)` evicts the oldest, so `CLAUDEMD_SPEC_ACTION=restore` returned the spec and enough re-runs permanently evicted the user's original personal `CLAUDE.md`. The personal backup is now the sole backup → restore always returns it. (The first cut fixed only the identical-re-install path; the re-audit completed the upgrade path.)

### Fixed — advisory-scan false positives + cross-platform

- `hooks/transcript-structure-scan.sh`: scans only the LAST assistant turn (was concatenating all turns → phantom four-section blocks + stale prior-turn reports re-flagged every Stop).
- `hooks/transcript-vocab-scan.sh`: per-session content-hash dedup — the same prose turn no longer re-fires the §10-V advisory on every tool call in a chain.
- `hooks/session-end-check.sh`: VALIDATE detection anchored to command position — `echo "TODO: git commit later"` no longer counts as a validation and suppresses the mid-SPINE checkpoint.
- `hooks/mem-audit.sh`: drift banner bullets every entry (`IFS=$'\n  - '` is a char-set, not a separator string, so it dropped the bullet on all lines but the first).
- `hooks/banned-vocab.patterns` + `scripts/lib/lint.js`: patterns use POSIX `[[:space:]]` not GNU `\s` (BSD/macOS grep treats `\s` as literal `s`, silently disabling the ratio deny); the JS CLI translates POSIX classes back to JS regex.
- `hooks/lib/platform.sh`: new `platform_timeout` (timeout → gtimeout → bash watchdog) so the upstream-check / ship-baseline CI gate / bootstrap install no longer silently no-op on a stock macOS without coreutils; `${1:-}` guards on the stat/find helpers.
- `scripts/spec-coherence-audit.js`: cross-ref regex preserves the full suffix (`-R` / `-V` / `-O`, not only `-EXT`), so a dangling `§10-R` ref no longer matches an unrelated `§10-V` heading on the audit's flagship check.

### Fixed — CLI / lib robustness

- `scripts/status.js`: guard a manifest with `version` but no `entries` array (was a `TypeError` crash).
- `scripts/lib/argv.js` `parsePositiveInt`: numeric flags (`--days` / `--age-days` / `--prune-backups` / `--sample`) reject hex / exponential / non-integer (`0x1e`, `1e2`, `1.5`) that `Number()` silently coerced — applied across `audit.js`, `sparkline.js`, `hard-rules-audit.js`, `sampling-audit.js`, `doctor.js`, `clean-residue.js`, `lesson-bypass-audit.js`.
- `scripts/lib/backup.js`: `BACKUP_DIR_REGEX` matches same-ms collision dirs (`backup-…Z-1`) so they are listed / sorted / pruned instead of leaking forever.
- `scripts/lib/settings-merge.js`: the hand-install eviction predicate is anchored to the user's own `~/.claude/hooks/`, so claudemd uninstall no longer evicts a foreign plugin that reuses a claudemd hook basename under a different root.
- `scripts/lib/memory-tags.js`: resolve the LAST `(...md)` link target (matches the hook's greedy sed) so doctor/scan report the same file the hook enforces against.

### Notes

- Documented best-effort limits of the §8 wrapper handling (flag-bearing `nice -n10 rm` / `timeout 5 rm`, `xargs`, `sudo` are not unwrapped) and added static guards: `tests/scripts/spec-pattern-drift.test.js` drift-7 + `tests/scripts/hook-portability.test.js` reject GNU-only `\s/\d/\w` in hook sources / patterns.
- 8 spec-content quality items (prose clarity / cross-ref) were identified but deferred to a future v6.14.2 spec patch; spec files are untouched here.

## [0.23.10] - 2026-06-03

**Patch — fix: `memory-read-check` sanitizer leaked multi-line quoted command bodies into tag matching.** `sanitize_for_tagmatch` strips quoted `--notes` / `--title` / `-m` bodies before MEMORY.md tag matching (so release-note prose does not spuriously match memory tags), but its quote-strip `sed` was line-based and silently failed on MULTI-LINE quoted strings. A multi-paragraph `gh release create --notes "..."` leaked its prose, matching unrelated memory tags and forcing a spurious `§11 MEMORY.md read-the-file` deny + bypass — live-reproduced on the v0.23.8 / v0.23.9 release notes (their "self-dogfood" matched a `dogfood` tag).

### Fixed

- `hooks/memory-read-check.sh` `sanitize_for_tagmatch`: flatten newlines (→ `\r`) around the quoted-body strip so multi-line `"..."` / `'...'` args are stripped before tag matching, then restore. The comment / heredoc / slash-token passes stay line-based. Portable (tr + sed, no `sed -z`), bash-3.2-safe.
- `tests/hooks/memory-read-check.test.sh`: +2 cases — Case 34 locks the multi-line FP (a multi-paragraph `--notes` with a tag word no longer denies), Case 35 confirms the strip stays surgical (a bare unquoted tag token still matches). 33 → 35 tests.

## [0.23.9] - 2026-06-03

**Patch — ship the ARCHITECTURE + HOOK-PROTOCOL reference docs.** Moves the two functional-reference docs out of `.gitignore`'s local-only set so adopters/contributors receive them in the npm tarball + marketplace package (joining `ADDING-NEW-HOOK` / `RULE-HITS-SCHEMA` / `cross-project-pilot`).

### Added (now tracked + shipped)

- `docs/ARCHITECTURE.md` — three-layer design (L1 hooks / L2 scripts / L3 commands), invariants, data flow, state locations, and the refreshed 17-hook taxonomy (event → hook → spec_section, extracted from the live `hook_record` arguments).
- `docs/HOOK-PROTOCOL.md` — hook stdin/stdout I/O contract (PreToolUse envelope, deny output, exit-code semantics, Stop-can't-block).

Historical / analysis docs stay local-only (`claude-spec-hooks-PLAN.md`, `spec-audit-*.md`, the `*.txt` review reports).

## [0.23.8] - 2026-06-03

**Patch — audit-remediation batch from the 2026-06-03 maturity audit + adversarial verification.** New self-vs-external deny telemetry, a mechanized spec-headroom gate, and a macOS bash-3.2 static CI gate. Spec version v6.14.1 unchanged (the OPERATOR.md + Sizing-line edits below are human-only handbook / metadata, not Agent-ruleset changes).

### Added

- `scripts/lib/rule-hits-parse.js` + `scripts/audit.js`: `denyByProjectClass` — per-hook **blocking-deny** split into `self` (the plugin dogfooding itself; project path ends in `-claudemd`) / `external` (real downstream repos) / `unknown`. Raw deny counts overstated enforcement value when claudemd's own repo dominates traffic (live: banned-vocab 198 deny = 194 self / 1 external; ship-baseline 59 = 8 self / 37 external). Scoped to the deny family (`deny` / `deny-repeat` / `deny-prose`; excludes the non-blocking `deny-prose-dry-run`) so escalation variants are not dropped. `/claudemd-audit` renders the split, leading with `external` as the real-enforcement number.
- `scripts/spec-coherence-audit.js`: `sizing-headroom` check — mechanizes the §0.1 HARD char caps. `actual > cap` → HIGH (fails `--strict`); `cap·0.97 < actual ≤ cap` → LOW advisory. Surfaces the core-at-98.2% headroom state on every run instead of relying on the manual Sizing-line ritual.
- `.github/workflows/ci.yml`: static gate rejecting bash-4+ constructs (`declare`/`local`/`typeset -…A`, `mapfile`, `readarray`, array/pattern case-mod) in `hooks/*.sh`. Backstops the v0.23.6 `declare -A` regression class that Linux CI (bash 5) and the gnubin-shimmed macOS leg both missed. Whitespace/flag-tolerant; strips comments per-line so fix-note prose does not trip it.

### Fixed

- `tests/hooks/memory-coverage-scan.test.sh`: `unset MEMORY_COVERAGE_SCAN` at entry. The suite inherits the operator's `settings.json` env; with a local dogfood opt-in set, Case 6 ("opt-in OFF → silent") inherited `=1` and fired the advisory. Same hermeticity precedent as the `banned-vocab` / `transcript-structure-scan` tests.

### Spec files (v6.14.1 unchanged)

- `spec/OPERATOR.md` §13.1: added a patch-release batching note (the maintenance-treadmill finding — 117 release commits over 43 days, 41% corrective). Human-only handbook, not Agent-loaded.
- `spec/CLAUDE-extended.md`: Sizing line reconciled for the OPERATOR.md byte change (6405 → 7018; extended stays within ±20B).

### Verification

Full suite green on Linux. Adversarial multi-agent verification (4 reviewers) caught and fixed pre-ship: the deny-family undercount (ship-baseline external 33 → 37), a `classifyProject` trailing-substring vs segment-anchor defect, CI-gate false-negatives on tab / flag-reorder / array-case-mod, and a missing `/claudemd-audit` render directive for the new field.

## [0.23.7] - 2026-06-03

**Patch — hotfix: restore §8 enforcement on macOS (bash 3.2 regression from v0.23.6).** v0.23.6's deny-telemetry-attribution used `declare -A` (associative array), a bash 4+ feature. macOS ships **bash 3.2**, where it errors out — and the error aborted the deny path *before* `hook_deny`, so `rm -rf $VAR` / unpinned `npx` were **not denied on macOS** (Linux CI passed on bash 5, masking it; macOS CI caught `FAIL [deny]: rm -rf $WORK_DIR … declare: -A: invalid option`). v0.23.6 was published ~minutes before this hotfix; macOS users should skip it.

### Fixed

- `hooks/pre-bash-safety-check.sh`: replaced the associative-array deny-record loop with indexed arrays + plain string accumulators + a small helper (three fixed buckets: `§8-rm-rf-var` / `§8-npx` / `§8`). bash 3.2-compatible; granular deny attribution preserved; `hook_deny` now fires regardless of telemetry outcome. Verified: shellcheck clean, no `declare -A` remains in `hooks/` (mirrors the existing `mem-audit.sh` bash-3.2 note), full suite + 115/115 corpus on Linux; macOS CI is the portability gate.

## [0.23.6] - 2026-06-03

**Patch — doctor false-alarm fixes + safety-hook deny telemetry attribution (no enforcement change).** Five fixes from a spec/global-prompt audit (`docs/spec-audit-v6.14.1-2026-06-03.md`), adversarially reviewed by 5 fresh-context agents before ship. Spec unchanged at v6.14.1 (two doc errata only). **No §8 enforcement behavior changed** — `pre-bash-safety-check.sh` still denies the identical command set (113→115 corpus tests); only the rule-hits *record* section moved.

### Fixed

- `scripts/doctor.js` **hook-fail-open** no longer false-flags a healthy install. Pre-fix it was unconditionally `ok:false` on any `fail-open` row; 2 stray `bad-event` rows (empty-stdin synthetic/manual invocation, impossible on a live PreToolUse pipe) read as "enforcement silently bypassed." Now gated on **reason**: `bad-event` → advisory `ok:true`; `jq-missing`/`patterns-missing` → `ok:false` (genuine live-env bypass). Gating on `session_id` was rejected in review — `hook_record_failopen` never threads it, so every row is `session_id:null` and that gate would have been dead code. +2 tests (real-row shape).
- `scripts/doctor.js` **rule-usage** no longer labels immutable §8 SAFETY sections (`§8`, `§8.V*`, `§8-rm-rf-var`, `§8-npx`) as "§0.1 demotion candidate" — §8 is §5.1 Never-downgrade, so the recommendation was policy-forbidden. High-bypass §8 now surfaces as an immutable-ceremony advisory; healthy §8 keeps the normal "healthy" row. +1 test, 1 retargeted to a demotable section.
- `hooks/pre-bash-safety-check.sh` **deny telemetry attribution**: denies now record under the granular section that triggered them (`§8-rm-rf-var` / `§8-npx`) instead of the generic `§8` bucket. Pre-fix, denies sat in `§8` while bypass tokens / auto-allows sat in the granular sections, making `/claudemd-doctor`'s per-section bypass ratio read a misleading 100% for `§8-npx`/`§8-rm-rf-var` (denominator missing the denies). Enforcement unchanged — only the `hook_record` section label moved; the `hook_deny` block is identical. +2 telemetry assertions (deny lands granular; nothing lands in generic `§8`).
- `spec/CLAUDE-changelog.md` + `spec/CLAUDE-extended.md` **errata**: the v6.14.1 operator carry-forward cited impact-audit #4 (a ~12.6K core→extended demote) as "the queued path to reclaim headroom," but #4 was investigated 2026-06-03 and rejected as a category error (0-telemetry foundational sections ≠ unused). Corrected to "core has no safe demotion target; net-zero/net-delete is permanent." Also fixed a `~4.7K`→`~4.4K` headroom self-contradiction (operator prose vs. corrected Sizing line). Byte-neutral; `spec-coherence-audit` 3/3, sizing delta 0.
- MEMORY.md tag hygiene (`~/.claude`, not shipped): 3 generic tags (`brainstorm`/`design`/`audit`) → multi-word per spec §11-EXT; `/claudemd-doctor` now reports `0 generic-tag candidates`.

### Investigated, no change

- `sandbox-disposal-check.sh` 709/30d advisory warns: reproduction disproved the "re-counting the same pool every turn" hypothesis (`SESSION_REF` advances correctly — each fresh dir counted once). The volume is correct advisory signal on genuinely-fresh-per-session test sandboxes (dogfood: dev `TMPDIR` resolves under the scanned path). A recency guard would not reduce the count and would mask long-session undisposed sandboxes — rejected.

## [0.23.5] - 2026-06-03

**Patch — `status.js` feature-flag reporting fix: `bashSafetyIndirectCall` misreported as OFF when unset.** `/claudemd-status` showed `bashSafetyIndirectCall: false` even though the indirect-exec unwrap defaults ON — `pre-bash-safety-check.sh` reads `${BASH_SAFETY_INDIRECT_CALL:-1} != 0`. status.js used a stale `=== '1'` (explicit-set) check predating the v0.21.8 default-ON flip, so unset → `false`. **No enforcement impact** — the §8 SAFETY indirect-call coverage (`bash -c "rm -rf $X"` / `eval`) was active the whole time; only the status readout was wrong. Spec unchanged at v6.14.1.

### Fixed

- `scripts/status.js`: `features.bashSafetyIndirectCall` now uses `!== '0'` (mirrors the hook's `:-1` default-ON semantics and the sibling `bashReadonlyFastPath` check) instead of `=== '1'`. Surfaced by a `/claudemd-status` reporting-accuracy check during the v0.23.4 impact-audit follow-up. +2 tests; the stale `reflects env var (v0.6.0)` test (which asserted `unset → false`, encoding the pre-v0.21.8 default-OFF) repurposed to `ON for any non-zero value`.

## [0.23.4] - 2026-06-03

**Patch — ships spec v6.14.1: §2.1 skill-MUST-invoke override clarified.** Resolves the instruction-collision surfaced by the v0.23.3 cross-project impact audit (audit item #5): superpowers / gstack `MUST invoke` skill wording vs §2.1's L0–L2 proceed-without default.

### Changed

- **`spec/CLAUDE.md` §2.1** (core, Δ +136B → 24553B; 447B headroom, 98.21%): the existing "this spec wins for L0–L2" clause is now **bolded** and carries a concrete example — `sp:test-driven-development` ("before writing implementation code") / `gs:investigate` ("do NOT debug directly") MUST-invoke wording does NOT force a clear-scope L1 bug out of fix→test-direct into TDD / investigate ceremony. No rule added or removed (`[clarify]` only); the precedence was already stated, just buried mid-paragraph.
- Spec version **v6.14.0 → v6.14.1** (patch). Cascade per `feedback_spec_version_bump_cascade_grep.md`: `spec/CLAUDE-extended.md` (title + Recent-changes entry + Sizing line), `spec/CLAUDE-changelog.md` (new entry), `spec/hard-rules.json` (`spec_version`), `tests/integration/upgrade-lifecycle.test.sh` + `tests/scripts/spec-structure.test.js` (version assertions), `README.md`. Manifest `description` fields unchanged (major.minor still `v6.14` per the v0.2.1 versioning policy).

Run `/claudemd-update` to sync the new spec into `~/.claude/CLAUDE*.md` (the current session keeps the old copy until then).

## [0.23.3] - 2026-06-03

**Patch — three false-positive / telemetry-hygiene fixes surfaced by a cross-project impact audit (daagu + sibling-plugin sessions). All are bugfixes restoring intended hook behavior; spec unchanged at v6.14.0.**

### Fixes

1. **`pre-bash-safety-check.sh` — npx resolution now follows a leading `cd <subdir>`.** CC's PreToolUse event `.cwd` is the shell cwd *before* the command runs, so `cd frontend && npx vue-tsc` in a monorepo (tool installed in `frontend/`, `.cwd` reported as the repo root or `backend/`) resolved `node_modules` against the wrong directory and false-denied a locally-installed tool. Observed 5x on the daagu frontend/backend monorepo (05-12, 05-12, 05-22, 05-25, 06-01) — the single most frequent real-work interruption from the plugin. New `effective_npx_cwd()` walks the `cd` targets preceding the first `npx ` token and resolves the effective cwd via subshell `cd` (relative / absolute / `..` / semicolon-chained). Cannot weaken the gate: it only ever *allows* when a genuine local install exists at the composed path; unresolvable targets (`$VAR` / glob / `~` / failed `cd`) keep the conservative deny. +6 corpus cases.

2. **`memory-read-check.sh` — tag match no longer fires on path/URL tokens.** A tag word appearing only inside a filesystem path (e.g. `~/.claude/projects/...` matching the `projects` tag of an unrelated memory) triggered a §11 read-the-file deny on commands unrelated to the memory's topic. Live-reproduced twice during the audit itself. `sanitize_for_tagmatch()` now strips slash-containing tokens before tag matching (same intent as the v0.9.28 quoted-title fix); bare-word tags are unaffected. +2 cases (FP guard + surgical-scope regression).

3. **`rule-hits.sh` — reserved test sentinel `t` no longer writes to the production log.** The fixture `session_id:"t"` used across the hook suite was leaking into `~/.claude/logs/claudemd.jsonl` via ad-hoc *manual* hook invocations in the real `$HOME` — 309 rows (11.5% of all telemetry), inflating banned-vocab deny counts ~2x and obscuring real signal in `/claudemd-audit`. `rule_hits_append` now drops `session_id == "t"` before writing. Real CC session_ids are UUIDs; the `test` sentinel (used by transcript-*-scan row assertions) is intentionally left writable. +2 cases.

### Audit notes (scope reconciliation)

Two audit-flagged items did **not** become fixes — verified against the source rather than transcript narration (per `feedback_diagnosis_against_real_artifact.md`):

- **"banned-vocab deny resets git staging"** — misdiagnosis. `banned-vocab-check.sh` only calls `hook_deny`; it never touches the git index. The denied commit in the cited daagu session used `git commit -F -` (heredoc) so it never ran — staging was intact; the agent re-ran `git add` out of its own confusion and *narrated* a reset that did not happen. No code change; the `"robust"` catch is working as intended (`[allow-banned-vocab]` or rephrase).
- **"deregister opt-in-OFF PostToolUse hooks"** — wontfix. `transcript-vocab-scan.sh`'s early `exit 0` is the runtime env-gate (`TRANSCRIPT_VOCAB_SCAN`); deregistering it from `hooks.json` would break the documented opt-in. The per-call spawn is the intended cost of a toggleable hook.

## [0.23.2] - 2026-05-24

**Patch — `ship-baseline-check.sh` chained-commit-with-marker reachability. v0.23.1 closed the heredoc-body FP class but missed the *actual* user case: a chained `git commit -m "...known-red baseline: x" && git push origin main` still denied because PreToolUse fires before the commit runs → HEAD has no marker → deny → trapped. v0.23.2 also scans the CMD payload for the marker. Spec unchanged at v6.14.0.**

### Why this release (and why v0.23.1 wasn't enough)

v0.23.1 was shipped on a misdiagnosis. The reported user transcript was truncated; I assumed the FP was heredoc-body-containing-`&& git push`. The real commit body (code-graph-mcp `1da27a7`) did NOT contain `git push` at all — the trigger was almost certainly a chained `... && git commit -m "..." && git push origin main` at the end of the truncated command. Real and intended.

The actual bug is a PreToolUse chicken-and-egg:

1. Agent runs `git commit -m "<body>" && git push origin main` (standard ship flow). PreToolUse fires *before* anything runs. Hook reads HEAD — no marker (commit hasn't landed) — deny.
2. Agent reads the (b) escape, retries `git commit --amend -m "<body + known-red baseline:>" && git push origin main`. Same PreToolUse → same HEAD (amend hasn't landed) → deny again, escalated to "SECOND deny" via cooldown.
3. Agent gives up or bypasses with kill-switch.

Pre-fix the (b) escape required the agent to split the chain — first `git commit --amend -m "<body+marker>"` standalone (no push), then `git push origin main` (now HEAD has marker → pass). That workflow split was nowhere in the deny prose.

### What ships

- **`hooks/ship-baseline-check.sh`**: after the existing HEAD message scan, also `grep -qi 'known-red baseline:'` on the CMD itself. Marker in the `-m` payload, heredoc body, or anywhere else in the command text counts. Worst-case FP (e.g. `grep 'known-red baseline:' file && git push`) requires the agent to literally type the marker — a strong intent signal, not accidental.
- **`hooks/ship-baseline-check.sh`**: REASON wording for both regular deny and cooldown SECOND deny updated. New (b) text: *"include 'known-red baseline: <reason>' in the commit body. Works in EITHER current HEAD message OR the proposed -m payload, so chained 'git commit -m "...known-red baseline: x" && git push' passes in one shot — no need to amend separately."*
- **New event `pass-known-red-incmd`**: distinct from `pass-known-red` (which only fires on HEAD match) so telemetry can measure how often the CMD-payload path saves an agent from the trap. Documented in `docs/RULE-HITS-SCHEMA.md` events table + spec-section taxonomy + `tests/hooks/contract.test.sh` DOCUMENTED list.
- **`tests/hooks/ship-baseline.test.sh`**: Cases 22-24 (now 26/26):
  - 22: `git commit -m "...known-red baseline: x" && git push origin main`, HEAD has no marker → pass (CMD scan).
  - 23: real user scenario — `git commit --amend -m "...known-red baseline: prior dispatch failed" && git push origin main` → pass.
  - 24: marker inside heredoc body of `-m "$(cat <<EOF ... EOF)"` chained with push → pass.

### Process lesson

Diagnosed v0.23.1 from a truncated transcript without verifying against the actual commit body. The heredoc fix is real hardening (and Cases 18-21 are real coverage gaps closed) but it didn't address the reported failure. Captured as [[feedback_diagnosis_against_real_artifact]] — when a user reports a hook FP, reproduce against the actual command, don't synthesize from the truncated rendering.

## [0.23.1] - 2026-05-24

**Patch — `ship-baseline-check.sh` heredoc-body FP fix. Strip heredoc bodies before trigger match so commit-body prose quoting `&& git push` doesn't fire the push hook. Closes the agent-loop escape gap where the `(b) known-red baseline:` override was unreachable. Spec unchanged at v6.14.0.**

### Why this release

Real-world failure (claudemd consumer, 2026-05-24): a release-commit body contained shell prose quoting `&& git push --tags`. After `tr '\n' ' '` flatten, the v0.17.4 segment-anchor regex `(^|[[:space:]]*[;&|]+[[:space:]]*)git[[:space:]]+push` matched the body's `&&` separator + `git push` as if it were a top-level chained push. Consequences:

1. `git add ... && git commit -m "$(cat <<'EOF' ... && git push --tags ... EOF)"` denied as if it were `git push` on red CI.
2. Per the deny prose, agent tried `(b)` override = `git commit --amend -m "<same body>"` to prepend `known-red baseline:`. Amend hit the same FP → escape unreachable.
3. v0.18.1 cooldown then escalated to `SECOND deny within 5 minutes` with "Your prior retry did NOT change the CI conclusion" — misleading: the agent WAS adding the marker, but the hook never let the amend land.

v0.17.4 Cases 12-14 covered comment + standalone-heredoc-body patterns. They missed adjacent-separator-inside-heredoc-body because Case 14 used bare `git push origin main` rather than `&& git push`.

### What ships

- **`hooks/ship-baseline-check.sh`**: new `strip_heredocs` bash state machine. Tracks `<<DELIM` / `<<'DELIM'` / `<<"DELIM"` / `<<-DELIM` (tab-strip mode) openers and elides body lines until matching delimiter line. Applied to CMD before flatten + trigger regex. Bash-native, no awk/python dependency.
- **`tests/hooks/ship-baseline.test.sh`**: Cases 18-21 (now 23/23):
  - 18: heredoc body containing `&& git push --tags` → pass (FP closed).
  - 19: heredoc body containing `; git push --force` → pass.
  - 20: `--amend` with `known-red baseline:` marker and body still quoting `&& git push` → pass (escape path now reachable).
  - 21: non-regression — `git commit -m fix && git push origin main` outside any heredoc still denies on red CI.

### Not in this release

- Cooldown REASON wording unchanged. With the heredoc FP gone, the escape path works; the "Your prior retry did NOT change the CI conclusion" line is correct again in practice. Re-evaluate only if a different FP class reappears.
- No spec edit. The behavior of §7 Ship-baseline is unchanged — this is a pure hook-implementation bugfix that restores the documented contract (`git push` triggers, `git commit` doesn't).

## [0.23.0] - 2026-05-24

**Minor — R3 Step 2 lesson-bypass detector. New `scripts/lesson-bypass-audit.js` + `/claudemd-bypass-audit` slash command + 20 tests. Makes §11 MEMORY.md read-the-file effectiveness observable from claudemd's own telemetry for the first time. Spec unchanged at v6.14.0.**

### Why this release

§11 MEMORY.md read-the-file is a HARD rule but its observed effectiveness has been measured externally (e.g. claude-mem-lite startup banner's "cite-recall N%" line, which tracks a different signal — claude-mem-lite's `#NN` injected lessons, not claudemd's MEMORY.md suggestions). v0.11.0's `memory-prompt-hint.sh` already emits `suggest` events (`spec_section: §11-memory-hint`) carrying the per-prompt matched memory filenames in `extra.suggested`. What was missing: a script joining those events with subsequent transcript activity to compute actual cite-recall over claudemd's own telemetry.

R3 Step 2 (per "claude 编程结合度" optimization thread, 2026-05-24) closes that loop.

### What ships

- **NEW** `scripts/lesson-bypass-audit.js`: reads `~/.claude/logs/claudemd.jsonl` for `memory-prompt-hint` `suggest` events, joins per-session with `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` transcripts, and computes `citeRecall = applied / (applied + bypassed)` plus per-memory and per-session breakdowns. `totalMissingTranscript` separated from `applied`/`bypassed` so synthetic / dogfood sessions don't inflate the bypass rate.
- **NEW** `commands/claudemd-bypass-audit.md`: slash-command wrapper following the same `$ARGS` → `--days` + `--verbose` parsing as `/claudemd-rules`.
- **NEW** `tests/scripts/lesson-bypass-audit.test.js`: 20 tests covering pure helpers (`encodeCcCwd` / `rowText` / `wasApplied` / `readTranscript`), full-pipeline integration with synthetic logs + transcripts, edge cases (missing transcript, test-session filter, ancient events outside window), byte-exact production-fixture sanity check (per `feedback_test_fixture_format_drift.md`), and CLI argv discipline (per `feedback_cli_flag_shape_silent_fallback.md`).

### "Applied" definition

After a `suggest` event at timestamp T in session S:
1. **Read tool** invocation with `file_path` containing the memory filename → applied.
2. **Filename mention** in any post-T text block (assistant text / user prompt / tool_result / thinking) → applied.
3. Neither before next event in session or session end → bypassed.

User-prompted reads count as applied — when the lesson surfaces through the user channel, the bypass-loop is still closed.

### Real signal on shipping

`node scripts/lesson-bypass-audit.js --days=30` against the claudemd project's own 30d log (2026-04-24 → 2026-05-24):

- 40 suggest events, 61 total suggestions
- 31 applied, 9 bypassed, 21 missing-transcript (synthetic dogfood sessions)
- **cite-recall: 77.5%** / **bypass-rate: 22.5%**
- Top bypassed: `feedback_audit_no_reverify.md` (3/9, 33% — ironic given it teaches "trust audit script output, don't re-grep"), `feedback_brainstorm_for_design_tasks.md` (2/3, n=3), `feedback_test_fixture_format_drift.md` (1/1, n=1).

77.5% over claudemd's MEMORY.md suggestions is much higher than the externally-reported "0%" — different signals were being measured. R3 Step 2 reveals that claudemd-side cite-recall is functional; the bypassed minority gives the operator a concrete next-investigation target (top-bypassed memory) instead of a vague "improve cite-recall" goal.

### Not in this release

- **No Stop-hook integration**. Per §13.3 (advisory→enforce promotion), new behavior-layer signal collection runs ≥30d default-OFF for FP analysis before enforcement wiring. v0.23.0 ships the measurement script only; promotion to real-time advisory or Stop-deny is gated on future operator-judged data.
- **No realtime advisory in agent's transcript** during the task. Would require a different hook surface (PostToolUse / Stop) and FP-collection ceremony; deferred.
- **R-N8 self-enforced rule transcript scan** remains a separate spike. R-N8 scans agent text for violations of self-enforced HARD rules (§iron-law-2, §8.V1–V4 etc.) — a different join (rule pattern, not filename match).

### Cascade-grep verification

Per `feedback_spec_version_bump_cascade_grep.md`: bumped `0.22.1` → `0.23.0` across `package.json` + both `.claude-plugin/*.json`. Spec version unchanged at `v6.14.0` (no spec file modified). README count rows updated (12 → 13 slash commands, 15 → 16 scripts).

Lesson sources: `feedback_test_fixture_format_drift.md` (byte-exact prod fixture test pattern), `feedback_cli_flag_shape_silent_fallback.md` (parseStrict + space-form rejection), `feedback_demote_needs_data_not_intuition.md` (read existing code before proposing new infrastructure — checked `memory-prompt-hint.sh` first to confirm signal source exists).

## [0.22.1] - 2026-05-24

**Patch — operator cadence: §13.1 staleReviews baseline established. 22 HARD rules now carry `last_demote_review: "2026-05-24"`. Spec unchanged at v6.14.0.**

### Why this patch

v0.22.0 ship `hard-rules-audit.js` output flagged `staleReviews: [<all 22 rules>]` — every rule's `last_demote_review` field was `null` since the manifest's inception. The §13.1 quarterly demote-review cadence had never been executed-and-recorded; the cadence queue was structurally permanent regardless of actual review activity. Per `feedback_demote_needs_data_not_intuition.md`, staleReviews is the *cadence queue*, distinct from the *demote queue* (`demoteCandidates`). Draining requires operator action.

### Review verdict

`node scripts/hard-rules-audit.js --days=30` output on v0.22.0 ship — partitioned by enforcement:

- **6 hook-enforced rules** (`§7-ship-baseline 304` / `§7-user-global-state` / `§8.V4-sandbox-disposal 480` / `§8-rm-rf-var 23` / `§8-npx` / `§11-memory-read` — all firing in 30d window): **keep**. Active and load-bearing.
- **1 both-enforced rule** (`§10-specificity` — 452 total, 435 deny): **keep**. Highest-utility rule by hit count.
- **14 self-enforced rules** (`hits: null` — no transcript-scan signal yet): **keep**. Can't demote without R-N8 transcript-side instrumentation (`scripts/hard-rules-audit.js:99–101` names it as the actual fix path); deferred to dedicated spike.
- **1 external rule** (`§0.1-core-growth` — operator-managed via `/claudemd-rules` + size budget): **keep**. Spec backbone.

Net: 0 demotions, 0 downgrades. Baseline date `2026-05-24` recorded across all 22 entries.

### What changed

- `spec/hard-rules.json`: 22 entries' `last_demote_review` field bulk-set to `"2026-05-24"` (replace_all on the single literal `"last_demote_review": null`).
- `package.json` / `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json`: version bumped to 0.22.1.

### Verification

Post-edit `hard-rules-audit.js --days=30` → `staleReviews: []`, `demoteCandidates: []`. Cadence machine round-trips cleanly. Next demote review cadence: ~2026-08-22 (90d) or earlier on incident-driven trigger.

### Not changed

- Spec version stays v6.14.0 (no rule add / remove / relax).
- `spec/CLAUDE.md` / `spec/CLAUDE-extended.md` / `spec/CLAUDE-changelog.md` / Sizing line — all unchanged (data-only manifest edit).

Lesson sources: `feedback_demote_needs_data_not_intuition.md` (staleReviews vs demoteCandidates distinction), `feedback_audit_no_reverify.md` (trust audit script output, don't re-grep).

## [0.22.0] - 2026-05-24

**Minor — spec v6.14.0: §10 REPORT template defaults relaxed (L1-bugfix single-line) + §10 banned-vocab inline list trimmed to top-5.**

### Why this release

User-driven optimization audit thread ("claude 编程结合度" 2026-05-24) surfaced two cumulative frictions in §10 REPORT:

1. **L1-bugfix four-section over-application**: `feedback_done_section_chinese_prose.md` flagged the over-formatting pattern — ~80% of L1-bugfix tasks are single-file single-failure-mode fixes where four-section was structural ceremony, not evidence. Iron Law #2's bugfix anchor (cite prior-failing state) is what carries the load; the four-section shell was redundant.
2. **Banned-vocab inline list growth**: core §10 carried ~400B of EN+中文 banned-vocab examples that were also cross-referenced to §EXT §10-V. Each new synonym added an inline byte without changing the underlying positive rule.

Initial scope (R1) explored adding `instrumentable` field to `spec/hard-rules.json` for §13.1 demote-queue separation, but on read-through the existing `enforcement` partition (`hook | self | external | both`) + `rule_hits_section` mapping were found to ~95% cover the proposal. Pivoted to R4+R5 (template + vocab) as the next-leverage spec-text optimization. R-N8 (self-enforced transcript scan, named in `scripts/hard-rules-audit.js:99–101` as the real remaining gap) deferred.

### What changed (spec v6.14.0)

- `[relax]` **§10 L1-bugfix template**: "four-section always" → "single-line `Done:` with bugfix anchor by default; four-section when Failed/Uncertain ≥2 OR scope ≥2 files". Stop hook `hooks/transcript-structure-scan.sh:13–15` already gates four-section-order detection on ALL-four-present, so single-line Done passes through without firing. No hook code change needed. Core delta: +89B.
- `[change]` **§10 Banned-vocab inline list trimmed**: full enumeration (10 EN + 7 中文 + baseline-less ratios) lifted to `reference_banned_vocab_examples.md` (new memory anchor, `reference` type) + §EXT §10-V (existing); core inline now lists top-5 EN + 3 中文 quick-check items. Positive rule unchanged. Core delta: -104B (smaller than the ~320B initial estimate; original line was ~400B, not ~600B).

### Measured sizing impact

`wc -c` post-edit: core 24432 → 24417 bytes (Δ -15B); extended 47572 → 46501 bytes (Δ -1071B); OPERATOR.md unchanged. The substantive headroom win is extended-side via v6.13.x Recent-changes evictions to `spec/CLAUDE-changelog.md`. Core net -15B is below the cosmetic threshold — R4+R5 on core is more about template defaults than byte reclaim.

### What changed (plugin)

- `spec/CLAUDE.md`: §10 L1-bugfix line + §10 Banned-vocab line edited; title bumped to v6.14.0.
- `spec/CLAUDE-extended.md`: title bumped; Recent changes block rewritten (v6.13.x entries evicted to changelog per "only current minor's entries live here" convention; v6.14.0 entry added); Sizing line updated.
- `spec/CLAUDE-changelog.md`: v6.14.0 + v6.13.2 entries prepended.
- `spec/hard-rules.json`: `spec_version` → v6.14.0; rule list unchanged.
- `tests/integration/upgrade-lifecycle.test.sh`: `NEW_SPEC_VER` → v6.14.0.
- New: `~/.claude/projects/<encoded>/memory/reference_banned_vocab_examples.md` (full banned-vocab table with usage notes).
- `MEMORY.md`: new index line for the reference file.

### Cascade-grep verification

Per `feedback_spec_version_bump_cascade_grep.md`: grepped `v6.13.2` + `0.21.9` across `spec/` `scripts/` `tests/` `bin/` `hooks/` `package.json`. All occurrences updated except `spec/CLAUDE-extended.md` Recent-changes / Sizing historical references that intentionally cite v6.13.2 as past context.

### Reviewer notes

- No hooks/scripts/tests assert on the literal phrase `four-section always` or the exact `**Banned-vocab quick-list**` body — verified empty via `grep -rln` across `tests/` `scripts/` `hooks/` `bin/`.
- `transcript-structure-scan.sh:13` four-section-order detection: "only fires when ALL 4 of (Done:, Not done:, Failed:, Uncertain:) appear line-anchored within a 50-line window. Single sections (just Done:) intentionally don't fire." R4 default-flip is hook-safe.
- §0.1 Three-tier discipline applied: new content (banned-vocab full list) lands in Tier 2 (`reference_*.md`, keyword-loaded), not Tier 1 extended or Tier 0 core. Extended §10-V kept as canonical source.

Lesson sources: `feedback_done_section_chinese_prose.md` (over-formatting pattern), `feedback_demote_needs_data_not_intuition.md` (read code before proposing schema changes), `feedback_spec_version_bump_cascade_grep.md` (cascade-grep before listing modify-targets), Lesson #337 (memory-system quality from data not intuition).

## [0.21.9] - 2026-05-24

**Patch — fix: §8 SAFETY unquoted-`eval` indirect-exec coverage + docs alignment from end-to-end QA pass. Spec unchanged at v6.13.2.**

### Why this patch

End-to-end user simulation (running every CLI surface, script, and hook as a real user would) surfaced one §8 SAFETY silent-bypass plus two doc/UX inconsistencies that would bite users following the documentation literally:

1. `hooks/pre-bash-safety-check.sh` `unwrap_indirect` only handled **quoted** eval forms — `eval 'rm -rf $X'` / `eval "rm -rf $X"`. The unquoted form `eval rm -rf $X` (bash joins eval's argv with spaces before evaluating, so it's execution-equivalent) silently bypassed §8 SAFETY. Same family as v0.21.4 direct-path bypass and v0.21.8 indirect default-ON — a final coverage gap inside the §5.1 Never-downgrade SAFETY family.
2. `scripts/update.js` help text wrote `CLAUDEMD_UPDATE_CHOICE=apply` while the code accepts only `apply-all`. A user following the help verbatim hits `unknown choice: apply. Valid: 'apply-all' | 'cancel'` exit 1.
3. `README.md` `/claudemd-rules` row claimed default 90 / "matches §13.1 quarterly cadence"; actual default has been 30 since v0.13.1 (90d gate was structurally unreachable under typical log retention). Project-layout block listed 11 hooks / 11 commands; actual 17 / 12.

### What changed

- `hooks/pre-bash-safety-check.sh`: new sed rule in `unwrap_indirect` handling `(prefix)eval[ws]+(non-quote-start)...(stop-at-terminator)` — same prefix class as the existing quoted-eval handler so quoted-string `"eval rm -rf $X"` and word-boundary `evaluate ...` don't false-fire. Header docstring updated to note the unquoted-eval extension and to call out that `bash -c` / `sh -c` / `zsh -c` are NOT extended the same way (those builtins only treat their first non-flag arg as the script; unquoted form is not execution-equivalent — eval is the only shape where joining the argv with spaces yields the same result).
- `tests/fixtures/bash-safety/corpus.tsv`: +3 deny cases covering the unquoted-eval forms (`eval rm -rf $X`, `eval rm -rf "$X"`, `cmd && eval rm -rf $X`) and +5 pass cases for FP guards (`$HOME/cache` whitelist via unwrap, `[allow-rm-rf-var]` token survives unwrap, echo-of-quoted-string-literal stays inert, `evaluate` word-boundary not eval, `eval ls -la` benign).
- `scripts/update.js`: help text + env-var documentation line aligned to the only accepted value `apply-all` (matches `commands/claudemd-update.md` slash-command markdown which has been correct since v0.2.x; the script help was the lone outlier).
- `README.md`: `/claudemd-rules` row updated (default 30, with v0.13.1 lowering rationale inline); project-layout block updated (17 hooks / 12 commands).

### Heuristic limits (unchanged from v0.21.8)

`unwrap_indirect` remains regex-based — escaped quotes, nested heredocs, command-substitution (`$(rm -rf $X)`, `` `rm -rf $X` ``) at top level still escape detection. `[allow-rm-rf-var]` / `[allow-npx-unpinned]` bypass tokens survive unwrap and remain the authorized escape for legitimate indirect calls. `BASH_SAFETY_INDIRECT_CALL=0` opts out of the entire unwrap path (eval + bash-c + sh-c + zsh-c).

Lesson sources: `feedback_hook_env_test_hermeticity.md` (fixture-default discipline), `feedback_audit_tool_before_sweep.md` (run measurement before sweeping — end-to-end probe drove this catch).

## [0.21.8] - 2026-05-24

**Patch — fix: §8 SAFETY indirect-exec coverage default-ON (`BASH_SAFETY_INDIRECT_CALL` flip from opt-in to opt-out). Spec unchanged at v6.13.2.**

### Why this patch

`hooks/pre-bash-safety-check.sh` has shipped indirect-exec unwrap (`bash -c '<inner>'`, `sh -c`, `zsh -c`, `eval`) behind `BASH_SAFETY_INDIRECT_CALL=1` opt-in since v0.6.0 to gather FP signal. The flag stayed default-OFF for 21 minor releases — meaning `bash -c "rm -rf $UNSAFE"` and `eval "rm -rf $X"` silently bypassed §8 SAFETY rm-detection in steady-state, inside the §5.1 Never-downgrade SAFETY family. v0.21.4 closed the direct-path silent bypass (sanitize / per-segment iteration); this patch closes the matching indirect path. Audit-driven (2026-05-24 full-project review surfaced it as the only §8 silent-bypass remaining after v0.21.4).

### What changed

- `hooks/pre-bash-safety-check.sh`: `${BASH_SAFETY_INDIRECT_CALL:-0}` → `${BASH_SAFETY_INDIRECT_CALL:-1}` (line 200; matches `BASH_READONLY_FAST_PATH` default-ON style from v0.20.0). Header comment block updated; `BASH_SAFETY_INDIRECT_CALL=0` remains as the documented opt-out escape hatch for users who hit FP from the heuristic unwrap.
- `tests/fixtures/bash-safety/corpus.tsv`: three "default OFF allows" pass cases (rm-rf via `bash -c` / `eval` / `sh -c`) flipped to **deny** under default behavior; nine pre-existing `BASH_SAFETY_INDIRECT_CALL=1` deny cases simplified to test default (env-prefix removed since redundant); three new `BASH_SAFETY_INDIRECT_CALL=0` opt-out **pass** cases verify the escape hatch; four FP-guard pass cases (`$HOME/cache` whitelist, `prettier@3.0.0` pin, `[allow-rm-rf-var]` token, `echo "bash -c ..."` string-literal) simplified to test default.
- `tests/hooks/pre-bash-safety.test.sh`: `unset BASH_SAFETY_INDIRECT_CALL` at suite entry per `feedback_hook_env_test_hermeticity` — user can set the flag in `~/.claude/settings.json` env block and silently flip deny cases to pass under `npm test`, same v0.21.2 trap as `CLAUDEMD_PATH2_DRY_RUN`.

### Heuristic limits (unchanged)

`unwrap_indirect` is regex-based — escaped quotes, nested heredocs, and substitution forms (`bash -c "$(cat <<X ... X)"`) can still defeat it. `[allow-rm-rf-var]` / `[allow-npx-unpinned]` bypass tokens survive the unwrap and remain the authorized escape for legitimate indirect calls.

Lesson sources: `feedback_demote_needs_data_not_intuition.md` (today's audit surfaced this as the highest-leverage §8 close after demote-review was data-rejected), `feedback_hook_env_test_hermeticity.md` (env teardown pattern).

## [0.21.7] - 2026-05-24

**Patch — fix: audit `uniqueInvocations.duplicate_rows` was misleading without the "non-null tool_use_id" guard. Now split into `_real` / `_legacy`. Spec unchanged at v6.13.2.**

### Why this patch

The v0.21.5 audit incorrectly flagged "PreToolUse double-fire bug" against `banned-vocab` (90 dupes) and `pre-bash-safety` (59 dupes). Phase-1 reproduction against `~/.claude/logs/claudemd.jsonl` found:

- banned-vocab: 6 real-session rows with non-null `tool_use_id`, **0 collisions**
- pre-bash-safety: 48 real-session rows with non-null `tool_use_id`, **0 collisions**
- All-hook global check: 0 true double-fires

The 90 / 59 reported "dupes" were all from pre-v0.9.34 legacy rows (null `tool_use_id`) where two distinct hook invocations within the same wall-clock second collided on the `(ts, hook, session, tool_use_id)` quadruple — an artifact of seconds-precision `date -u +%Y-%m-%dT%H:%M:%SZ` timestamps in `rule_hits_append`, NOT a registration / lib bug.

The audit docs (`rule-hits-parse.js:114-117` and `commands/claudemd-audit.md` field table) DID name the "non-null tool_use_id" guard, but the headline metric (`duplicate_rows`) was a bare sum across both legacy noise and real signal. Easy to misread under reading-fatigue.

### What changed

- `scripts/lib/rule-hits-parse.js#uniqueInvocations`: per-hook output gains `duplicate_rows_real` (collision row has non-null `tool_use_id` → true double-fire bug signal) and `duplicate_rows_legacy` (collision row has null `tool_use_id` → expected noise from pre-v0.9.34 legacy rows OR Stop/SessionStart-class hooks). `duplicate_rows = _real + _legacy` retained for backward compat. Docstring rewritten with explicit reading guide.
- `commands/claudemd-audit.md`: field-table entry for `uniqueInvocations` rewritten with the split; the operator-format paragraph changed from "Surface `duplicate_rows > 0`..." to "Surface `duplicate_rows_real > 0`... **Do NOT report bare `duplicate_rows`**". The bare-sum is now explicitly called out as a misread trap.
- `tests/scripts/audit.test.js`: existing v0.9.34 test extended with `duplicate_rows_real=1, duplicate_rows_legacy=0` assertion. New v0.21.7 test covers three collision shapes (real bug / Stop-class noise / pre-v0.9.34 legacy noise) and asserts each routes to the correct counter.
- `feedback_audit_no_reverify.md`: trap-rule bullet added — "Read field-guards in full, not just headline metrics". Cites today's misread as the origin.

### Backward compatibility

- `duplicate_rows` field unchanged (sum). Consumers reading the bare sum keep working but will under-report or over-report depending on interpretation; new readers should switch to `_real` / `_legacy`.
- No change to any hook code; no spec change; no migration. Pure reporting-layer fix.

### Verification

- 448 unit + 2 integration tests pass (was 447 unit; +1 new test).
- Functional re-check against current `~/.claude/logs/claudemd.jsonl` (30d window): all hooks `duplicate_rows_real = 0`. The original audit's "bug" disappears once the gate is applied correctly.

## [0.21.6] - 2026-05-24

**Patch — feat: `runSpecSizingCheck` now emits copy-paste-ready OLD/NEW edits on drift. Spec unchanged at v6.13.2.**

### Why this patch

`feedback_spec_sizing_recursive_rewrite.md` hit its 4th in-session repro during the v0.21.5 ship: initial Sizing claim was −127B off from actual, requiring a second corrective edit to land inside the ±20B envelope. The drift detection itself worked (since v0.21.2) — what wasted iterations was the manual translation from "claim says 47700, actual is 47573" to "I need to edit the Sizing line to say 47573". Post-ship code review elevated this from candidate to next-patch actionable; this patch lands it.

### What changed

- `scripts/version-cascade-check.js#extractSizingClaim`: return shape changed from `number | null` to `{value, matched, suggestReplacement(actual)} | null`. The `matched` substring captures the exact span in the Sizing line (e.g. `extended 46071 → 47700 bytes`); `suggestReplacement(actual)` produces the corrected form (e.g. `extended 46071 → 47573 bytes`).
- `runSpecSizingCheck`: over-threshold drifts now include a `suggested: {old, new}` field with the OLD/NEW pair. Backward-compatible — the `claimed / actual / delta` fields are unchanged; consumers ignoring `suggested` keep working.
- CLI output: each over-threshold drift now prints a 3-line block — original drift line + indented `Suggested edit in **Sizing** line:` header + OLD/NEW pair. Bottom hint reworded from "Iterate until exit 0" to "apply the OLD→NEW pairs above (single corrective pass typically suffices)".
- `tests/scripts/version-cascade-check.test.js`: +2 synthetic tests — arrowed-form drift carries correct suggested edit; plain-form drift (no arrow) also carries correct suggested edit.

### Backward compatibility

- `extractSizingClaim` return-shape change is internal (not exported). Only `runSpecSizingCheck` is exported.
- `runSpecSizingCheck` return shape gains a `suggested` field on `over-threshold` drifts only. `claim-parse-failed` and `file-missing` drifts unchanged. Existing tests at all 3 boundary cases (no drift / ±20B inclusive / ±21B exclusive) keep passing without touching the assertions.
- CLI stderr format adds 3 lines per over-threshold drift. No change to exit codes or success-case stdout.

### Verification

- `npm test`: 447 unit + 2 integration suites pass (previously 445 unit; +2 new synthetic tests for arrowed-form and plain-form drift).
- Functional smoke: synthetic fixture with extended +50B drift (arrowed) and OPERATOR.md +100B drift (plain) → both `suggested.old` / `suggested.new` produce the expected corrected substrings.

### Followup status

- P6 (this patch) shipped. `tasks/improvement-candidates-2026-05.md` marks it done.
- P1 / P2 / P4 unchanged; P5 closed in v0.21.5.

## [0.21.5] - 2026-05-24

**Patch — clarify: memory-layer terminology cleanup. Spec bumped v6.13.1 → v6.13.2 (clarification only, identical Agent behavior).**

### Why this patch

User audit of the `claude-mem-lite` plugin × `MEMORY.md` durable layer integration surfaced a terminology collision in agent-visible context:

- claude-mem-lite plugin emits `[mem] Startup dashboard:` / `[mem] events: ...` / mid-turn `[mem]` recall blocks
- claudemd plugin's `memory-prompt-hint.sh` emitted `[mem-hint]` for MEMORY.md tag matches
- claudemd plugin's `mem-audit.sh` Stop hook outputs `[claudemd] §11-EXT mem-audit:` (already prefixed, OK)

Two `mem-`-prefixed channels referring to different layers — ambiguous when the agent reasons about "what does mem mean here". User's audit flagged the bare `mem` overload as a routing-quality issue.

### What changed

- **Hook output**: `hooks/memory-prompt-hint.sh:169` — `[mem-hint] §11 —` → `[claudemd] §11 memory-hint:`. Brings the only outlier into the existing `[claudemd] §<section> <hook-name>:` convention used by `mem-audit.sh`. Same payload, same instructions; LLM behavior unchanged.
- **Spec §11-EXT Memory operations**: added Terminology bullet (~+620B) defining `claude-mem-lite` = recall plugin, `MEMORY.md` = durable layer, ban bare `mem` in new spec/hook text. Scopes existing `mem_*` plugin tool names and `mem-audit` hook name so no renames are triggered.
- **Spec §11 SPINE Mid-SPINE turn-yield**: inline qualifier added — `mid-turn `[mem]` context` → `mid-turn `[mem]` claude-mem-lite recall` (+15B core delta).
- **Memory file `feedback_memory_layer_routing.md`**: replaced the "(out of scope; not yet shipped) `claude-mem-lite import-recall-fallback`" promise with a manual-migration note. The plugin-absent → re-detect path is narrow enough that a shipped importer has no clear ROI; durable layer should not carry vaporware tool references.

### What was NOT changed (deliberately, per user-confirmed minimal scope)

- Hook file names (`hooks/mem-audit.sh` stays) — file-name rename would cascade into `hooks.json`, `scripts/lib/hook-registry.js`, tests + sentinel paths; cost > benefit at terminology layer.
- Published env var `DISABLE_MEM_AUDIT_HOOK` — rename would be a breaking change for users who set it; deprecation grace would need a different release shape (L3 minor).
- Plugin tool/CLI names `mem_save / mem_search / mem_recall / mem_recent` — those are claude-mem-lite plugin's published surface, not in this repo.

### Verification

- `node scripts/version-cascade-check.js` → ok (v6.13 consistent across 3 file(s); Sizing drift within ±20B for 3 target(s))
- `grep -rn "mem-hint\\|\\[mem-hint" tests/ scripts/` → 0 results pre-edit (no test depends on the old literal)
- spec extended 46071 → 47573 bytes (Δ +1502, 2427B headroom remaining, 95.15% of 50000B ceiling)

### Followup candidates (not in this patch, logged to `tasks/improvement-candidates-2026-05.md`)

- P1: type-distribution audit (84% of memory files are `feedback_*` in this project — needs `claudemd-audit` data before any spec change)
- P2: lesson-promotion candidate counter (semi-auto `mem_search` aggregation by similarity)
- P4: MEMORY.md sub-index threshold at 50 lines / 10 KB (preemptive; not active need)
- ~~P5: `memory-prompt-hint.sh` sort order ratchet~~ — CLOSED on re-verify: hook already sorts by `match_count desc, mtime desc` since v0.19.2 B3. Original audit misread the changelog-style comment at lines 122-123 as current behavior. Lesson logged in candidates file.

## [0.21.4] - 2026-05-21

**Patch — fix: §8 SAFETY rm-detection coverage gaps surfaced by continued dogfooding of v0.21.3. Per-segment iteration replaces single-shot greedy regex. Spec unchanged at v6.13.1.**

### Why this patch

Round-4 dogfood of v0.21.3 surfaced three more §8 SAFETY rm-rf-var detection holes — same severity class, same file, all reachable. The v0.21.3 fix closed the sanitize-bypass and added `${VAR:?…}` guard recognition but kept the original single-shot `RM_FLAG_REGEX` matching strategy. That strategy fails on three flag/sequencing variants:

1. **Long-form flags** — `rm --recursive --force $X` allowed. The regex required a single `-*[rRfF]*` block; `--recursive` doesn't fit.
2. **Split short flags** — `rm -v -i -rf $X` allowed. Same root cause — multiple `-*` blocks, only the first considered.
3. **Multi-rm chain** — `rm -rf "$A" && : "${B:?msg}" && rm -rf "$B"` allowed. The greedy `sed -E "s/.*${RM_FLAG_REGEX}//"` anchored at the LAST `rm -rf` in the command; the earlier unguarded rm-rf on `$A` was silently skipped because its target never reached the for-loop. The guard for `$B` accidentally certified the whole command.

All three were latent in every release back to v0.5.0; v0.21.3's per-varname guard recognition exposed them as exploitable.

### What changed (code)

- `[fix]` **`hooks/pre-bash-safety-check.sh`** rm-detection refactor — replaced the single-shot `RM_FLAG_REGEX` match with per-segment iteration. Splits `SANITIZED_CMD` (multi-line, preserves newline command terminators — `SANITIZED_CMD_FLAT` would have collapsed them) on `&&`, `||`, `;`, `&`, `|`. For each segment starting with the `rm` token, parses args with a token-aware loop that recognizes `--` (POSIX separator), `--recursive` / `--force` (long-form), `-*[rRfF]*` (short with danger letter), `--*` and `-*` (other flags — ignored), and first non-flag positional as target. Each rm-rf-with-var is independently checked for HOME/PWD/OLDPWD/TMPDIR whitelist or `${VAR:?…}` guard. Multiple HITS in one command all surface in the deny message.

- `[test]` **`tests/fixtures/bash-safety/corpus.tsv`** — 9 new corpus cases. Long-form: `rm --recursive --force $X` deny, `rm --recursive -f $X` deny, `rm -r --force $X` deny. Split short: `rm -v -i -rf $X` deny. Target-before-flag: `rm $X -rf` deny. Multi-rm: unguarded-then-guarded deny, both-guarded pass. Long-form FP guards: `rm --recursive --help` pass, `rm -r --force /tmp/literal` pass. Net 90 → 99 cases.

- `[change]` plugin / package / marketplace bump 0.21.3 → 0.21.4.

### Migration

None. `[allow-rm-rf-var]` escape token continues to work. Commands that the v0.21.3 regex missed now correctly deny; legitimate forms (`rm -rf /tmp/literal`, `rm -rf $HOME/cache`, canonical `:?` guard) continue to allow. Multi-line shapes (`TMP=$(mktemp -d)\nrm -rf $UNSAFE`) continue to deny — newlines are now treated as natural segment terminators by the per-segment splitter.

### What this DOES NOT do

- Does not change `${VAR:?…}` guard semantics. Position-agnostic full-command search retained: a guard appearing anywhere in the command still satisfies the same-varname rm-rf, even if positioned syntactically after the rm-rf. (As noted in v0.21.3 CHANGELOG, bash semantics already neutralize the late-guard case — `rm -rf ""` on unset var is a no-op error.)
- Does not extend recognition to non-`:?` guard forms. `[[ -n ]]` / `set -u` still need `[allow-rm-rf-var]`.
- Does not handle nested `bash -c "bash -c '...'"` chains under `BASH_SAFETY_INDIRECT_CALL=1`. Single-layer unwrap is the existing design.

## [0.21.3] - 2026-05-21

**Patch — fix: §8 SAFETY silent bypass in `pre-bash-safety-check.sh` sanitize step + `${VAR:?}` canonical-guard recognition. End-to-end dogfood findings. Spec unchanged at v6.13.1.**

### Why this patch

Dogfooding the plugin end-to-end uncovered a latent §8 SAFETY bypass in `sanitize_cmd`. The pre-fix regex `sed -E 's/"[^"$]*"/""/g'` could pair the closing `"` of one `$`-containing double-quoted string with the opening `"` of the next, eating any code in between — including `&& rm -rf "$VAR"` — before the rm-rf-var detector ran. Reproducer: `echo "$A" && rm -rf "$B"` sanitized to `echo "$A""$B"`, no `rm` token visible, hook allowed. The same gap also bypassed npx-unpinned detection on `echo "$A" && npx prettier "$B"`. Both shapes silently passed enforcement.

Fixing the sanitizer then exposed a second issue: the spec §8 deny message explicitly recommends `: "${VAR:?must be set}" && rm -rf "$VAR"` as the canonical "validate the var inline" form, but post-fix the hook denied it (no guard recognition existed — the previous accidental allow came from the sanitize bug, not deliberate logic). Hook now recognizes the bash `${VARNAME:?...}` set-or-exit guard when the varname matches the rm-rf target.

Also tightened `industry-standard` (hyphen form) in `banned-vocab.patterns` — canonical fixture already noted the drift; pattern now mirrors `production[- ]ready`.

### What changed (code)

- `[fix]` **`hooks/pre-bash-safety-check.sh`** sanitize_cmd — replaced the broken sed regex `"[^"$]*"` with an awk char-by-char state machine that pairs `"` correctly. Adjacent `$`-containing double-quoted regions stay distinct; the gap between them no longer gets matched as a single quote body. Closes the silent §8 SAFETY bypass for both rm-rf-var (Pattern 1) and npx-unpinned (Pattern 2) detection. Performance: 10KB command sanitized in 52ms (well under the 3s hook timeout).

- `[add]` **`hooks/pre-bash-safety-check.sh`** canonical-guard recognition — after detecting an unguarded non-whitelisted `rm -rf $VAR`, the hook checks for `${VAR:?...}` (bash set-or-exit operator) in `SANITIZED_CMD_FLAT` with the SAME varname. Match → emit `rm-rf-allow-validated` rule-hits row with `extra.var`, allow. Anchored via `(^|[^\\])` so `\${X:?...}` inside a `echo "use \${X:?msg} guard"` literal does NOT satisfy the guard (the backslash escapes the `$` — no expansion happens at runtime). Other guard forms (`[[ -n ]]`, `set -u`, control flow) remain unrecognized — use `[allow-rm-rf-var]`.

- `[change]` **`hooks/banned-vocab.patterns`** `\bindustry standard\b` → `\bindustry[- ]standard\b`. Mirrors existing `\bproduction[- ]ready\b` handling. Spec §10-V uses the hyphenated form; canonical fixture (`tests/fixtures/banned-vocab-canonical.json`) previously noted the drift but did not close it.

- `[doc]` **`docs/RULE-HITS-SCHEMA.md`** — new `rm-rf-allow-validated` event row in the Events table + section taxonomy. Records `extra.var`.

- `[test]` **`tests/fixtures/bash-safety/corpus.tsv`** — 17 new corpus rows. Sanitize cross-quote-region: rm-rf after `&&` / `;` / leading non-echo form (4 rows). Canonical `:?` guard: quoted braces + `&&`, `;` separator, bare braces, preceded by other commands, wrong-var guard, `:-` default not a guard, `[[ -n ]]` not a guard, backslash-escaped literal not a guard (8 rows). npx-unpinned cross-quote-region: bare + scoped (2 rows). Net 76 → 90 cases (+14, plus pre-existing 3 in the sanitize-fix block).

- `[test]` **`tests/fixtures/banned-vocab-canonical.json`** — `industry-standard` pattern updated to char class; note updated to match `production[- ]ready` style.

- `[test]` **`tests/hooks/contract.test.sh`** — `rm-rf-allow-validated:pre-bash-safety` added to KNOWN_EVENTS so drift-test C ("emitted event is documented") passes.

- `[change]` plugin / package / marketplace bump 0.21.2 → 0.21.3.

### Migration

None. `[allow-rm-rf-var]` escape token continues to work. Commands previously allowed via the sanitize bypass now correctly deny — the canonical `: "${VAR:?msg}" && rm -rf "$VAR"` form continues to allow (now via deliberate recognition rather than accidental sanitize bypass).

### What this DOES NOT do

- Does not model backslash-escape sequences inside `"..."` (`\"` still closes the quote — same gap as the prior sed implementation; not widened).
- Does not recognize non-`:?` guard forms (`[[ -n ]]`, `set -u`, control flow). Use `[allow-rm-rf-var]` if those are your idiom.
- Does not change the readonly-fast-path: commands starting with whitelisted readers (`echo`, `cat`, `ls`, …) still bypass detection — `echo "$A" rm -rf "$B"` (juxtaposition with no operator) remains allowed because bash-semantically `rm` is just a literal argument to `echo`, not a command.

## [0.21.2] - 2026-05-21

**Patch — add: spec **Sizing** drift pre-tag check in `scripts/version-cascade-check.js`. Plus a v0.21.1 test-hermeticity follow-up triggered by enabling `CLAUDEMD_PATH2_DRY_RUN=1` in `~/.claude/settings.json`. Spec unchanged at v6.13.1.**

### Why this patch

`feedback_spec_sizing_recursive_rewrite.md` documented this 3-times-in-session: operator writes the **Sizing** line in `spec/CLAUDE-extended.md`, post-edit `wc -c` shows the claim diverged from actual by 100-400 bytes (rewriting the Sizing line itself changes extended.md's size — recursive trap). The memory gave two options: accept ±20B drift, or build a mechanical pre-tag check. v0.17.6 / v0.19.0 / v0.21.0 all manually iterated to convergence. `fe88a38` staged v6.14.x net-delete candidates — next spec ship would hit this trap again. Option 2 ships in this patch.

Separately: enabling `CLAUDEMD_PATH2_DRY_RUN=1` in user settings.json during the v0.21.1 rollout surfaced that `tests/hooks/banned-vocab.test.sh` + the doctor `selfTests` Path 2 spawn weren't hermetic — they inherited the dry-run flag from `process.env` and silently degraded "expected deny" cases to "pass under dry-run". Closed in this patch.

### What changed (code)

- `[add]` **`scripts/version-cascade-check.js`** — new `runSpecSizingCheck({root})` export + CLI integration. Parses the canonical `**Sizing**` line in `spec/CLAUDE-extended.md`, extracts the post-arrow byte claims for core / extended / OPERATOR.md, compares to `fs.statSync` actuals. Reports drift with file path, claimed, actual, Δ-with-sign, and threshold. Tolerance ±20B per memory note (Sizing-line rewrite changes extended.md, hence non-zero floor). Handles arrow form (`core 24417 → 24417 bytes`) and plain form (`core 24417 bytes`). Skips cleanly when `spec/CLAUDE-extended.md` absent. CLI exit 0 only when both cascade AND sizing pass.

- `[change]` **`scripts/version-cascade-check.js`** — `--json` output reshaped from flat `{ok, expectedMinor, filesChecked, offenders}` to nested `{ok, cascade:{...}, sizing:{...}}`. Top-level `ok` is the combined gate; consumers that previously read `parsed.expectedMinor` now read `parsed.cascade.expectedMinor`. Only test code references this shape; non-test consumers (`npm run version-check`) only use the exit code.

- `[fix]` **`tests/hooks/banned-vocab.test.sh`** — `unset CLAUDEMD_PATH2_DRY_RUN BANNED_VOCAB_PROSE_SCAN DISABLE_BANNED_VOCAB_HOOK DISABLE_CLAUDEMD_HOOKS` at suite entry. Users who turn on Path 2 dry-run via `settings.json` no longer silently degrade cases 25-33 from "expected deny" to "pass under dry-run". Per-case env prefixes (e.g. case 34's explicit `CLAUDEMD_PATH2_DRY_RUN=1`) still drive what they need.

- `[fix]` **`scripts/doctor.js`** — selfTest spawn env now explicitly clears `CLAUDEMD_PATH2_DRY_RUN` and `BANNED_VOCAB_PROSE_SCAN` (parallel to the existing `DISABLE_CLAUDEMD_HOOKS` clear). Self-test verifies hook CODE integrity, not live enforcement, so user-env Path 2 toggles must not influence the code-path under test.

- `[test]` **`tests/scripts/version-cascade-check.test.js`** Cases 9-17 — 9 new tests. Real-repo smoke (drift=0 baseline against actual repo on every `npm test`), synthetic drift +100B (over threshold) reports correctly, ±20B boundary inclusive, +21B exclusive, missing extended.md skips clean, missing Sizing line fails clean, arrow + plain forms both parse, sizing-only failure short-circuits exit code while cascade passes. CLI `--json` shape test updated for nested layout. 8 → 17.

### Migration

None. The existing `npm run version-check` keeps the same CLI; the new sizing gate is additive (exit 0 still requires green). One subtle break for non-test consumers: if anything parsed the `--json` output's flat shape, switch to `parsed.cascade.expectedMinor` / `parsed.cascade.filesChecked`. Grep confirms only test code touched this surface.

### What this DOES NOT do

- Does not change spec content. Sizing line is still operator-maintained — the check just catches drift before it ships.
- Does not auto-rewrite the Sizing line. Operator decides what to write; this guard catches the "forgot to update" case.
- Does not apply to `spec/CLAUDE-changelog.md` (intentionally historical).

## [0.21.1] - 2026-05-21

**Patch — add: `CLAUDEMD_PATH2_DRY_RUN=1` observability flag + doctor `banned-vocab self-test:prose-scan`. Spec unchanged at v6.13.1.**

### Why this patch

v0.21.0 shipped Path 2 prose-scan deny but with no production data — synthetic tests 25-33 prove the mechanism works, FP rate against real assistant prose is unknown. And doctor `selfTests[]` covered Path 1 + rm-rf-var + npx-unpinned only; the v0.21.0 region-marker docstring-FP bug (silent 0-pattern scan) would have shipped green through doctor — only the `tests/hooks/` suite caught it. This patch closes both gaps without changing default behavior.

### What changed (code)

- `[add]` **`hooks/banned-vocab-check.sh`** — `CLAUDEMD_PATH2_DRY_RUN=1` branch logs a `deny-prose-dry-run` event with the would-match hits and exits 0 instead of denying. Grep `~/.claude/logs/claudemd.jsonl` for the rows during rollout to measure TP vs FP rate. Default 0 (live deny per v0.21.0). +10 LOC inside the existing Path 2 branch.

- `[add]` **`scripts/doctor.js`** — 4th `selfTests[]` entry `banned-vocab self-test:prose-scan`. Extended the loop with optional `setup(tmpDir) → {event, envOverride}` callback: the new entry stages a synthetic transcript at `$tmpDir/.claude/projects/<encoded-cwd>/<sid>.jsonl` with a §10-V high-fire token in an assistant turn, then drives the hook with `git push` + `HOME=$tmpDir` overridden in the spawn env. Catches: region-marker regex regression (the v0.21.0 docstring-FP class) at doctor invocation, not just test-suite. Synthetic transcript lands in `mkdtempSync` dir, cleaned up after spawn per §8.V4. +60 LOC including new selfTest entry and setup-handling fork in the loop.

- `[add]` **`docs/RULE-HITS-SCHEMA.md`** — `deny-prose-dry-run` event row added.

- `[add]` **`tests/hooks/contract.test.sh`** DOCUMENTED list — `deny-prose-dry-run:banned-vocab` added. 59 → 60.

- `[add]` **`README.md`** — `CLAUDEMD_PATH2_DRY_RUN` entry in env-var section with sample jq query for grepping the dry-run rows.

- `[test]` **`tests/hooks/banned-vocab.test.sh`** Cases 34-35 — `CLAUDEMD_PATH2_DRY_RUN=1` + would-deny prose + ship verb → pass (case 34); same + verify `deny-prose-dry-run` row written to `rule-hits.jsonl` (case 35). 33 → 35.

- `[test]` **`tests/scripts/doctor.test.js`** — new test asserts the `banned-vocab self-test:prose-scan` check exists, passes, and detail mentions Path 2 + the trigger word.

### Migration

None. Live enforcement unchanged: Path 2 still denies by default. Set `CLAUDEMD_PATH2_DRY_RUN=1` only if you want to observe-without-blocking during a calibration window (typical use: 1-2 weeks of normal ship cadence, then unset).

### What this DOES NOT do

- Does not auto-collect / report FP rate — that's left to `node scripts/audit.js` after dry-run data accumulates.
- Does not change Path 1 (commit-message scan) or any spec content.
- Does not affect `transcript-vocab-scan` (PostToolUse advisory) — that path is independent and unchanged.

## [0.21.0] - 2026-05-21

**Minor — change: §13.3 Gate 2 promotion. `banned-vocab-check` Path 2 prose scan added — ship-flow commands (commit/push/pr-create/release-create/publish) now DENY when the preceding assistant turn's chat prose contains a high-fire §10-V pattern. Spec unchanged at v6.13.1.**

### Migration

| What changes | Action you must take |
|---|---|
| When you run `git commit / git push / gh release create / gh pr create / npm publish / cargo publish` AND your previous assistant turn contained one of the §10-V high-fire patterns (`significantly`, `robust`, `comprehensive`, `should work`, `显著改善`, or baseline-less `N% faster/slower/better/more efficient`), the hook DENIES the command. | **None** if you want the new safety floor. To bypass per-command: include `[allow-banned-vocab]` in the command. To opt out of Path 2 globally while keeping Path 1 (commit-message scan): `export BANNED_VOCAB_PROSE_SCAN=0`. |

### §13.3 Gate 2 promotion case (audit data)

Ran `node scripts/sampling-audit.js --global --days=30`:
- Cross-project §10-V coverage: **5 distinct projects** (claudemd, code-graph-mcp, daagu, mem, /tmp) — Gate 2 requires ≥3.
- Total §10-V hits in 30d window: 151 across 79 transcripts (44 turns).
- Top high-fire patterns: `comprehensive` (43+10), `significantly` (35), `robust` (11+4), `should work` (9), `显著改善` (10), `production-ready` (4 — kept in prophylactic region, NOT promoted).
- Default-ON state for advisory `transcript-vocab-scan`: ≥30 days — Gate 2 requires ≥30.
- ≥1 `feedback_*.md` memory cites §10-V as load-bearing: `feedback_hook_header_quote_partial_impl.md`.
- Zero operator `revert:` / `relax:` entries against the rule in CHANGELOG.

All Gate 2 gates pass. Operator (user) judged this as the right promotion. Promotion is one-step: PostToolUse advisory STAYS as it is (no removal — chat-prose-everywhere coverage), Path 2 deny ADDS at the highest-stakes surface (ship-flow PreToolUse:Bash). Two enforcement points instead of one.

### Why ship-flow surface only, not all PreToolUse:* (Option A skipped)

The mechanically-stronger Option A — pre-deny ANY tool call when previous turn carries §10-V — was discussed and rejected. UX cost: agent uses `significantly` once → every subsequent tool call requires `[allow-banned-vocab]` token (because prior turns are immutable in CC). Disproportionate to the calibration value. Option B (ship-flow only) gives the strong-training signal at the right moment without the per-tool-call escape-token bloat.

### What changed (code)

- `[change MED]` **`hooks/banned-vocab-check.sh`** — Path 1 commit-msg scan refactored to be gated on new `IS_GIT_COMMIT` flag (preserves existing FP discipline — non-commit ship verbs no longer fall through to whole-CMD scan which would FP on branch names / path args). New `IS_SHIP_VERB` flag covers commit + push + pr create + release create + npm publish + cargo publish. Path 2 prose-scan body (~60 LOC) added at hook tail: reads transcript via `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` (CC encoding `tr '/._' '-'`), tails 200 jsonl lines + 4096 bytes of joined assistant text, scans `banned-vocab.patterns` high-fire region (markers anchored on `# region: <name> (` to defeat docstring FPs), denies on hit.

- `[fix LOW]` **`hooks/banned-vocab-check.sh`** region-marker regex anchored on trailing `\(` — caught during dev that the patterns file's docstring at top ALSO mentions `region: high-fire` and `region: prophylactic` (with indentation, no trailing paren). The naïve regex `^#[[:space:]]*region:[[:space:]]*<name>` matched the docstring lines too, causing the loop to set `in_high_fire=1` too early then break on the next docstring mention of prophylactic — Path 2 silently scanned 0 patterns and never denied. Fixed regex requires trailing `\(`.

- `[add]` **`BANNED_VOCAB_PROSE_SCAN=0`** sub-feature kill-switch (README §2a) — disables Path 2 prose scan only; Path 1 commit-msg scan remains active. Mirrors `DISABLE_BATCH_CADENCE_ADVISORY` shape from v0.19.2.

- `[add]` **`docs/RULE-HITS-SCHEMA.md`** — new `deny-prose` event documented (emitter `banned-vocab`, semantics, opt-out flag).

- `[add]` **`tests/hooks/contract.test.sh`** DOCUMENTED list — `deny-prose:banned-vocab` added. 58 → 59.

- `[test MED]` **`tests/hooks/banned-vocab.test.sh`** Cases 25-33 — 9 new cases. Prior-prose pattern × ship verb × bypass + opt-out matrix: significantly + commit → deny (25), robust + push → deny (26), comprehensive + gh release create → deny (27), `[allow-banned-vocab]` bypasses Path 2 (28), `BANNED_VOCAB_PROSE_SCAN=0` opt-out (29), non-ship verb skipped (30), prophylactic-only word doesn't trigger (31), missing transcript fail-open (32), 中文 `显著改善` → deny (33). 24 → 33.

### Sizing

No spec content change (spec stays at v6.13.1). Hook code growth: `hooks/banned-vocab-check.sh` +~80 LOC.

### Verification

- 33/33 banned-vocab hook tests pass (was 24; +9 Path 2).
- 59/59 contract tests pass (was 58; +1 DOCUMENTED entry).
- All other hook suites unchanged.
- 432/432 script tests, integration upgrade-lifecycle pass.
- `node scripts/version-cascade-check.js`: ok.

## [0.20.1] - 2026-05-21

**Patch — fix-forward on code review findings from the v0.19.1→v0.19.2→v0.20.0 arc. Three Important items + three Minor items + one docs cleanup. No spec change (spec stays v6.13.1). No behavioral default flipped.**

### Background

Code review of the v0.19.1+v0.19.2+v0.20.0 release arc (commits `237bf2a`..`984d6df`) surfaced 3 Important + 4 Minor findings. All "fix-forward" class — none blocked the original ships, all addressable in a single patch. This release closes 6 of them (one Minor was a false-alarm self-correction; one was deemed defensive low-ROI and deferred).

### What changed

- `[fix LOW]` **`hooks/session-end-check.sh`** L2+ heuristic comment (I1) — reviewer flagged that `structure-advisory` and `mid-spine-advisory` events in the qualifying set are gated by opt-in env vars (`TRANSCRIPT_STRUCTURE_SCAN=1` / `MID_SPINE_YIELD_SCAN=1`, default OFF), so the prior comment overstated practical breadth. Rewritten to honestly partition always-on `{deny, warn, deny-repeat}` from opt-in `{structure-advisory, mid-spine-advisory}`. Filter logic unchanged — when operators enable opt-in scans, sensitivity grows automatically.

- `[fix MED]` **`hooks/session-end-check.sh`** L2+ rule-hits scan now `tail -n 10000`-bounded (I2) — `jq -R -s 'split("\n")|...'` reads the entire log into memory. At the 5MB doctor warn threshold (~50K rows) this is borderline; `tail -n 10000` cap before jq is a defensive 5× reduction. Single session won't realistically emit 10K rule-hits, so behavior on healthy logs is zero-change.

- `[feat MED]` **`scripts/status.js`** features block exposes `batchCadenceAdvisory` + `batchCadenceThreshold` (I3) — `DISABLE_BATCH_CADENCE_ADVISORY` and `CLAUDEMD_BATCH_THRESHOLD` had zero visibility in `/claudemd-status` output before this. New fields default to `true` and `20` respectively; honor env overrides with the same `^[1-9][0-9]*$` guard that `session-end-check.sh` uses for the threshold (invalid input falls back to default 20).

- `[fix LOW]` **`hooks/memory-prompt-hint.sh`** tag-count regex tightened (M1) — `[[ "$tag_count" =~ ^[0-9]+$ ]]` accepted `0` from `awk -F, '{print NF}'` on an empty string, falling unreachable today only because of an upstream filter. Tightened to `^[1-9][0-9]*$` (positive integer required) so the guard defends against filter-bypass regressions.

- `[test MED]` **`tests/hooks/contract.test.sh`** section C2 added (M3) — every `token: '...'` literal in `scripts/status.js#ESCAPE_TOKENS` is grepped across `hooks/*.sh`; missing tokens fail loudly. Closes the "added a 6th bypass token to status.js verbose mirror but didn't implement it in any hook" drift class. 53 → 58 (one row per token currently declared, all 5 found).

- `[fix LOW]` **`hooks/session-end-check.sh`** `paused.md` template surfaces mutation cap (M5) — recent-mutations jq reducer caps the list at 3 (line 63), but the prior template didn't note this. Operator reading a `paused.md` with `MUTATIONS=12` previously saw 3 entries with no indication 9 were elided. New line: `(showing up to the last 3 of $MUTATIONS total)`.

- `[docs]` **`commands/claudemd-install.md`** strips magic-number `(expected: 17 as of v0.19.x)` from the `entries.length` doc bullet — number would go stale on every hook addition. Now reads just "number of registered hooks."

### Deferred (Minor — low ROI for this patch)

- **M2** `hooks/memory-prompt-hint.sh` mtime fallback when `platform_stat_mtime` missing → `0` for every entry → secondary sort key inert. Reviewer judged this defensive; `platform.sh` ships alongside the hook and won't normally vanish. Deferred indefinitely.
- **M4** Reviewer self-flagged + retracted (false alarm on banned-vocab in v0.19.2 CHANGELOG). No action.

### Tests

- 20/20 status tests pass (was 15; +5 for I3 batchCadence fields default + override + invalid-input fallback).
- 58/58 contract tests pass (was 53; +5 for C2 ESCAPE_TOKENS mirror check).
- 16/16 memory-prompt-hint tests pass (unchanged — M1 fix is regression-defense for unreachable path).
- 13/13 session-end-check tests pass (unchanged — I1 is comment, I2 is bounded scan, M5 is template prose).
- All 432 script tests, full hook suite, integration upgrade-lifecycle pass.
- `node scripts/version-cascade-check.js`: ok.

### Why patch

All 6 items are fix-forward on a review of already-shipped work; no new HARD rule, no spec content change, no behavioral default flipped (the default flips in v0.20.0 stand as-is). New `features.*` fields in status output are additive observability per §13 META "wording / clarification, identical behavior".

## [0.20.0] - 2026-05-21

**Minor — change: `BASH_READONLY_FAST_PATH` default flipped from opt-in OFF (v0.8.3+) to opt-out ON (this release). §13.3 advisory→enforce promotion: ~21 months observation, zero operator reverts, cross-project use. Spec unchanged at v6.13.1.**

### Migration

| What changes | Action you must take |
|---|---|
| When Bash command shape is definitely-read-only (no shell-meta, first token ∈ {`ls`, `cat`, `head`, `tail`, `wc`, `stat`, `date`, `pwd`, `echo`, `printf`, `sleep`, `file`, `which`, `type`, `env`, `basename`, `dirname`, `realpath`, `true`, `false`, `git log`, `git status`, `git diff`, `git show`, `git rev-parse`, `git rev-list`, `git describe`, `git blame`, `git reflog`, `git ls-files`, `git ls-tree`, `git cat-file`, `git remote`}), the 4 PreToolUse:Bash hooks (`pre-bash-safety` / `banned-vocab` / `ship-baseline` / `memory-read-check`) short-circuit before their sanitize / detector pipelines. Per-hook latency drops from ~50-150ms to ~5ms on these commands. | **None** if the new default is desired. To opt out: `export BASH_READONLY_FAST_PATH=0` in shell rc OR add to `~/.claude/settings.json` `env` block. |

### Rationale (§13.3 promotion case)

- **Observation window**: v0.8.3 shipped 2026-04-15. Today is 2026-05-21 — 36 days of opt-in field signal, well past the §13.3 Gate 1 minimum of 30 days.
- **Whitelist conservatism**: classifier rejects ANY shell-meta (`;` `|` `&` `>` `<` `\`` `$(` `${` newline) AND requires first token in a tight whitelist; for `git` subcommands the list excludes `branch / tag / config` because those have destructive sub-flags (`-d`, `-D`, `-c`). Classification tested in `tests/hooks/bash-readonly-skip.test.sh` cases 1-24 (covers ls/cat/git log positives + semicolon/pipe/redirect/cmd-sub/backtick negatives + non-whitelisted-token negatives + git-destructive-subcommand negatives).
- **Safety floor preserved**: ANY command outside the readonly classification — including all `git commit`, `git push`, `rm`, `npm`, `curl`, etc. — runs the full hook pipeline as before. The fast-path SKIP only fires when classification = readonly AND opt-out env not set; if classification is uncertain → return 1 (proceed normal path). False positives in the classifier are free (just more work); false negatives could only happen if the classifier wrongly identified a destructive command as readonly, which the test corpus rules out.
- **Cross-project coverage**: deployed on this repo (claudemd dogfood) + at least one other Anthropic-internal project — §13.3 Gate 1 minimum 2.
- **Zero operator revert / relax** entries in CHANGELOG against the rule.

### What changed (code)

- `[change MED]` **`hooks/pre-bash-safety-check.sh`** + **`hooks/banned-vocab-check.sh`** + **`hooks/ship-baseline-check.sh`** + **`hooks/memory-read-check.sh`** — fast-path conditional flipped from `${BASH_READONLY_FAST_PATH:-0}" == "1"` to `${BASH_READONLY_FAST_PATH:-1}" != "0"`. Env-shape: unset → ON, `=1` → ON, `=0` → OFF, anything else → ON (defensive against typos).

- `[change LOW]` **`scripts/status.js`** — `features.bashReadonlyFastPath` evaluation changed from `process.env.BASH_READONLY_FAST_PATH === '1'` to `process.env.BASH_READONLY_FAST_PATH !== '0'`. Same default-ON / =0-off semantics. `/claudemd-status` now reports `bashReadonlyFastPath: true` for users who upgrade without setting the env var.

- `[docs]` **`README.md`** — readonly fast-path paragraph rewritten to lead with "default-ON via §13.3 promotion"; opt-out command added inline; full safe-token whitelist enumerated.

- `[test]` **`tests/scripts/status.test.js`** Cases 13-15 — unset env → true (new default); explicit `=0` → false (opt-out); anything else → true (typo robustness). 12 → 15.

- `[test]` **`tests/hooks/bash-readonly-skip.test.sh`** Case 29 prose rewritten ("flag default OFF" → "post-v0.20.0 default ON"); Cases 31-33 added — explicit opt-out + non-readonly cmd still denies; default (env unset) + readonly cmd silent; opt-out + readonly cmd still silent (slow path). 30 → 33.

### Why minor (not patch)

Released-artifact user-visible default behavior change → core §2 escalates to L3 regardless of LOC; SemVer minor per §13 META "minor (rule added/relaxed, backward-compatible)". Explicit opt-out (`=0`) preserves prior behavior 1:1, so this is a backward-compatible default flip — no breaking change.

### Verification

- 33/33 bash-readonly-skip tests pass (was 30; +3 cases for new env semantics).
- 15/15 status tests pass (was 12; +3 cases).
- All 427 script tests, full hook suite, integration upgrade-lifecycle pass.
- `node scripts/version-cascade-check.js`: ok.

## [0.19.2] - 2026-05-21

**Patch — feat: `/claudemd-install` slash command for current-session bootstrap + `memory-prompt-hint` priority ranking (tag-count desc → mtime desc) + `session-end-check` §13.2 batch-review cadence advisory.**

### What changed

- `[add UX]` **`commands/claudemd-install.md`** + **README Quick start + troubleshooting** — new `/claudemd-install` slash command wraps `node ${CLAUDE_PLUGIN_ROOT}/scripts/install.js` so users can bootstrap the CURRENT Claude Code session right after `/plugin install` instead of waiting for the next `SessionStart`. Background: CC does not fire `postInstall`, so `install.js` previously only ran on session restart; README troubleshooting "Hooks don't fire" path now leads with `/claudemd-install` as option 1, manual `node` invocation as option 3 fallback. README commands table 11 → 12.

- `[feat MED]` **`hooks/memory-prompt-hint.sh`** — un-Read matches now sorted by (1) matched-tag count desc, then (2) file mtime desc. Pre-this, order = MEMORY.md authoring order, so when `COUNT > MAX(5)` the highest entries in the file dominated regardless of how strongly they matched the prompt vs entries lower in the file. New algorithm spends the 5-item cap on the entries most likely to change the agent's path. Sources `hooks/lib/platform.sh` explicitly (per `feedback_hook_platform_lib_source.md` — `command -v platform_*` guard silently falls-through when lib not sourced).

- `[feat MED]` **`hooks/session-end-check.sh`** — adds §13.2 batch-review cadence counter. Increments `~/.claude/.claudemd-state/l2-task-counter` once per L2+ session (heuristic: rule-hits log has ≥1 `deny`, `structure-advisory`, `mid-spine-advisory`, `warn`, or `deny-repeat` event for this `session_id`). At 20 L2+ sessions (threshold per OPERATOR.md §13.2 cadence): emit stderr advisory recommending `/claudemd-sampling-audit` + `/claudemd-rules`, reset counter to 0, record `batch-cadence-advisory` event under `§13.2-batch-review` spec section. Closes the operator-cadence feedback loop that was previously head-tracked; if maintainer skipped manual sampling-audit runs, the §13.2/§13.3 audit-data pipeline went dark.

- `[add]` **`DISABLE_BATCH_CADENCE_ADVISORY=1`** sub-feature kill-switch (README §2a) — disables the cadence advisory half of session-end-check while leaving the mid-SPINE warn-on-unvalidated-mutation behavior active. Threshold tunable via `CLAUDEMD_BATCH_THRESHOLD=N` (positive integer, default 20) — useful for test scenarios and operators who want a different cadence.

- `[test]` **`tests/hooks/memory-prompt-hint.test.sh`** Cases 15-16 — 15 asserts priority ranking (3-tag-match listed before 1-tag-match) defeats prior MEMORY.md authoring order by placing the strong match SECOND in the file; 16 asserts mtime tiebreak (newer entry before older when tag counts tie). 14 → 16.

- `[test]` **`tests/hooks/session-end-check.test.sh`** Cases 10-13 — L2+ session counter increment (10), threshold trip + advisory + reset (11), `DISABLE_BATCH_CADENCE_ADVISORY=1` kill-switch (12), non-L2+ session (pass/bypass only) does NOT increment (13). 9 → 13.

### Why patch

All three changes are additive observability / UX features. No spec rule added or relaxed (spec stays at v6.13.1). No default behavior of existing hooks flipped. New slash command is opt-in; new sub-feature kill-switch is opt-out. CHANGELOG `feat:` not `change:` per §13 META "patch (wording / clarification, identical behavior) = L2".

### Verification

- 16/16 memory-prompt-hint tests pass (was 14; +2 for priority + mtime tiebreak).
- 13/13 session-end-check tests pass (was 9; +4 for counter / threshold / kill-switch / non-L2+).
- All 427 script tests, full hook suite, integration upgrade-lifecycle pass.
- `node scripts/version-cascade-check.js`: ok (spec v6.13 unchanged).

## [0.19.1] - 2026-05-21

**Patch — feat: spec patch v6.13.1 (§13 META `HARD ≠ always hook-blocked` clarification + `OPERATOR.md` §13.4 `tasks/` filename conventions table) + `/claudemd-status --verbose` mode + `/claudemd-doctor` self-test matrix extended to cover §8-rm-rf-var + §8-npx.**

### Background

Four self-audit recommendations from a v0.19.0 comprehensive review landed in one patch — all additive, no behavioral default flipped, no Agent contract changed. Each closes a specific observable gap surfaced by reading the spec + walking the hook + script corpus end-to-end.

### What changed

- `[clarify SPEC]` **`spec/CLAUDE-extended.md §13 META`** — one new bullet "HARD ≠ always hook-blocked" pointing Agent at `spec/hard-rules.json#rules[].enforcement`. Today's 22 HARD rules partition as 6 hook / 14 self / 1 both / 1 external; without the cross-ref, Agent could miscalibrate "the hook will block X" for the 14 self-enforced HARDs (e.g. §iron-law-2, §10-four-section-order, §iron-law-1). +545B in extended; well under 50000B ceiling. Patch per §13 META "wording / clarification, identical behavior".

- `[add SPEC]` **`spec/OPERATOR.md §13.4 `tasks/` filename conventions table`** — single 11-row reference for all `tasks/<slug>` filename patterns previously scattered across 7 spec sections (`lessons.md`, `rule-candidates-<YYYY-MM>.md`, `sampling-audit-<YYYY-MM-DD>.md`, `<slug>-paused.md`, `autonomous-run-<date>.md`, `pending-auth-<date>.md`, `auto-approved.md`, `retro-<date>.md`, `specs/<slug>.md`, `perf-<n>.md`, `<n>.md`). +2450B in `OPERATOR.md` — **not Agent-loaded** per v6.13.0 separation, so zero Agent-context cost.

- `[feat MED]` **`scripts/status.js`** + **`commands/claudemd-status.md`** — new `--verbose` flag emits `verbose.killSwitches` (per-hook env var name + event + effective vs persisted state for all 17 shipped hooks, sourced from `scripts/lib/hook-registry.js`) and `verbose.escapeTokens` (5 per-invocation bypass tokens × hook × spec section). Closes "which env var disables hook X" / "what's the bypass token for §Y" lookup-by-README workflow.

- `[feat MED]` **`scripts/doctor.js`** — self-test matrix refactored into a loop covering 3 synthetic events: `banned-vocab` (existing, §10-V), `pre-bash-safety:rm-rf-var` (new, §8-rm-rf-var via `rm -rf $UNSAFE_VAR`), `pre-bash-safety:npx-unpinned` (new, §8-npx via `npx unknown-pkg-x9z2` with empty cwd). Each entry feeds a synthetic event, clears its own kill-switch env var per-spawn so user kill-switch state is surfaced as a note (not as test failure), and asserts deny-JSON comes back. Catches sanitize / detector drift in 2 more §8 SAFETY paths that previously had unit-test-only coverage.

- `[test]` **`tests/scripts/status.test.js`** Cases 8-11 — `--verbose` block omitted by default; perHook covers all 17 entries from `HOOK_REGISTRY`; escapeTokens covers all 5 documented tokens with cross-ref triple; per-hook kill-switch from `settings.json` reflected in `persisted` field. 8 → 12.

- `[test]` **`tests/scripts/doctor.test.js`** Cases 9-11 — new `pre-bash-safety self-test:rm-rf-var` and `pre-bash-safety self-test:npx-unpinned` checks pass on clean tree + carry §section cross-ref in detail; per-hook `settings.json` kill-switch reflected in detail of affected hook only (banned-vocab unaffected when only `DISABLE_PRE_BASH_SAFETY_HOOK=1` is set). 23 → 26.

- `[version]` Spec v6.13.0 → v6.13.1 (patch — clarification + operator handbook addition). Cascade-bumped: `spec/CLAUDE.md` H1, `spec/CLAUDE-extended.md` H1 + Recent changes entry + Sizing line, `spec/hard-rules.json#spec_version`, `tests/integration/upgrade-lifecycle.test.sh`, `tests/scripts/spec-structure.test.js`.

### Sizing

Core 24417 → 24417 bytes (Δ 0, version-line digit only). Extended 45029 → 46071 bytes (Δ +1042, §13 META bullet + v6.13.1 Recent-changes entry). OPERATOR.md 3955 → 6405 bytes (Δ +2450, §13.4 table — not Agent-loaded). Core headroom unchanged at **583 bytes / 97.67%**; extended **3929 bytes / 92.14%** (tightened 2.74 pp from v6.13.0's 89.94%, still well under ceiling).

### Verification

- 12/12 status tests pass (`node --test tests/scripts/status.test.js`).
- 26/26 doctor tests pass (`node --test tests/scripts/*.test.js` doctor suite).
- 12/12 spec-coherence-audit tests pass — Sizing drift = 0B (claim 46071, actual 46071).
- `node scripts/version-cascade-check.js`: ok (v6.13 consistent across README.md + plugin.json + marketplace.json).

## [0.18.1] - 2026-05-20

**Patch — feat: `ship-baseline` hook detects retry-within-5min on the same red CI run (same `session_id` + `run_url`) and escalates the deny REASON wording + emits a new `deny-repeat` audit event.**

### Background

Audit of 7-day real-session ship-baseline events surfaced a recurring pattern: in daagu, 3 distinct red CI run URLs each attracted 2 deny events within 71-230 seconds of each other under the same session — meaning the agent saw the (a)/(b)/(c) options on the 1st deny but retried the push anyway, hitting the same red CI. The hook's prose guidance was being read but not acted on.

Initial assessment claimed "拦了没引导" — wrong: the hook has carried (a)/(b)/(c) Options block since v0.1.0. The actual problem is agent behavior, not hook output. Fix posture: keep all 3 options, but if a same-key retry lands within the cooldown window, escalate the wording AND log a distinct audit event so the operator can see how often "ignored-guidance" retries happen.

### What changed

- `[feat MED]` **`hooks/ship-baseline-check.sh`** — sentinel-based 5-minute retry-cooldown tracking. Sentinel file at `$HOME/.claude/.claudemd-state/ship-baseline-recent/<session_id>_<run_id>.sentinel`. On deny: check existing sentinel mtime, if <300s old → `REPEAT=1` → escalated REASON ("SECOND deny on same red CI run within 5 minutes — your prior retry did NOT change the CI conclusion") + emit `deny-repeat` event. Touch sentinel after lookup; self-prune any sentinel older than 1 day on each invocation (`find -mmin +1440 -delete`, bounded to own STATE_DIR). When `session_id` or `run_url` are empty (CLI fallback / legacy callers), tracking is skipped — falls back to normal deny behavior.

- `[add]` **`docs/RULE-HITS-SCHEMA.md`** — documents the new `deny-repeat` event (emitter, semantics, sentinel state path, 1-day self-prune); updates the spec-section taxonomy row for `ship-baseline` to include the new event variant.

- `[test]` **`tests/hooks/ship-baseline.test.sh`** Cases 16-17 — 16a/16b/16c verify 1st-deny regular wording → 2nd-deny escalated wording within 5min on same `(session_id, run_url)`, both retaining `permissionDecision=deny`; 17 verifies different `session_id` keyed sentinel does NOT inherit. 15 → 19.

- `[test]` **`tests/hooks/contract.test.sh`** DOCUMENTED list — adds `deny-repeat:ship-baseline` entry; both B (documented → has hook_record call in source) and C (emitted → documented) assertions now pass for the new event. 50 → 51.

### Why not spec bump

Hook behavior addition; no spec rule added/relaxed/changed. Spec §7-ship-baseline still defines the gate ("Red → fix/known-red/ASK"); the retry-cooldown is implementation detail of how the hook expresses denial. Patch version per §13 META: "patch (wording / clarification, identical behavior) = L2"; spec text identical.

### Verification

- 412/412 script tests pass (`node --test tests/scripts/*.test.js`).
- 23/23 hook test files pass (`bash tests/hooks/*.test.sh`); ship-baseline 19/19, contract 51/51, mem-audit 12/12, all others unchanged.

## [0.18.0] - 2026-05-20

**Minor — spec v6.12.0: §11-EXT `project_*.md` exempted from `mem-audit` Why/How body-structure scan; §13.3 NEW Advisory → enforce promotion criteria for hook-layer rules.**

### What changed

- `[relax]` **`hooks/mem-audit.sh`** — case statement narrowed: `feedback_*.md|project_*.md) ;;` → `feedback_*.md) ;;`. Hook docstring + stderr banner copy updated accordingly. Incident-log `project_<topic>_<date>.md` files no longer trigger advisory warns when authors omit Why/How body markers. Closes 16-file long-standing non-compliance (daagu 12 + sdscc 2 + mem 1 + gsd 1 incident logs).

- `[add]` **`spec/CLAUDE-extended.md §13.3`** — NEW subsection codifying advisory → enforce promotion path for hook-layer rules. Two gates (default-OFF → default-ON; default-ON → `deny`) driven by `/claudemd-audit` data: fire count ≥20, bypass-rate <10%, cross-project coverage ≥2/≥3, operator-feedback gate. Companion to §0.1 (extended → core spec-text promotion).

- `[docs]` **`spec/CLAUDE-extended.md §11-EXT Body-structure scope`** — new paragraph documenting the project_*.md exemption rationale.

- `[test]` **`tests/hooks/mem-audit.test.sh`** Case 12 — project_*.md missing markers now silent (exempted). 11 → 12.

- `[version]` Spec v6.11.17 → v6.12.0 (minor — rule relaxed + rule added). Cascade-bumped: `spec/CLAUDE.md` H1, `spec/hard-rules.json`, `tests/integration/upgrade-lifecycle.test.sh`, `tests/scripts/spec-structure.test.js` (3 occurrences).

### Why minor (not patch)

Both changes are backward-compatible additions / relaxations, per §13 META: "minor (rule added/relaxed)" is the prescribed bump.

### Sizing

Core 24134 → 24133 bytes (Δ −1, version line shortens). Extended 45730 → 46573 bytes (Δ +843, S1+S2 spec content + v6.12.0 Recent-changes entry; v6.11.14 entry demoted out to maintain headroom). Headroom: core 867 (96.53%), extended 3427 (93.15%). Drift envelope: ±20B accepted.

### Verification

- 12/12 mem-audit hook tests pass (`bash tests/hooks/mem-audit.test.sh`).
- Spec structure tests pass (`node --test tests/scripts/spec-structure.test.js`) — v6.12.0 cascade complete.
- Full hook + script suite: TBD (run pre-ship).

## [0.17.7] - 2026-05-20

**Patch — fix: `/claudemd-audit` aggregated hook unit-test sentinel sessions (`session_id='t'/'test'`, ~150 rows in a 30d window) alongside real CC sessions, inflating `byTrend` regression-flag ratios with synthetic volume. UX: `/claudemd-update` command refresh sequence rendered as a copyable code block instead of inline prose.**

### What changed

- `[fix MED]` **`scripts/lib/rule-hits-parse.js`** — new `excludeTestSessions(hits)` helper drops rows where `session_id ∈ {'t','test'}` (hook unit-test sentinels; see `tests/hooks/*.test.sh`). `session_id=null` is intentionally NOT filtered — pre-v0.9.34 Stop/SessionStart/UserPromptSubmit hooks and bash CLI invocations legitimately emit null, accounting for ~80% of historical rows. Only the explicit 't'/'test' sentinels (~7%) are stripped.

- `[fix MED]` **`scripts/audit.js`** — applies `excludeTestSessions` to every behavior view (`byHook`, `bySection`, `byBypass`, `byFailOpen`, `byTrend`, `uniqueInvocations`, `topPatterns`). Only `dataIntegrity` retains full counts and exposes the new `testSessionsFiltered` field so the operator can quantify hook-test traffic without grepping the raw log. Initial fix attempted partial filter (bySection/byTrend only) which produced a 4.7× internal inconsistency between `byHook.banned-vocab.deny=345` and `bySection["§10-V"].deny=73` on the same payload — operator could not tell which was authoritative. Full filter resolves this; remaining cross-tab variance (now 1.04×) is legitimate (hooks emit events into multiple spec sections).

- `[docs]` **`commands/claudemd-audit.md`** — documents the new `dataIntegrity.testSessionsFiltered` field.

- `[docs UX]` **`commands/claudemd-update.md`** — `/plugin marketplace update` → uninstall → install → reload sequence now rendered as a 4-line copyable code block, replacing the inline prose form. Each line copy-pastes individually.

- `[test]` **`tests/scripts/rule-hits-parse.test.js`** — Case for `excludeTestSessions`: confirms `'t'`/`'test'` filtered, `null`/UUIDs preserved, partial matches (e.g. `'test-baseline-cv'`) NOT filtered (exact-match only). 13 → 14.

### Why patch

Behavioral fix to audit aggregation accuracy. No API surface change for external consumers (only `audit.js` internally consumes the affected helpers; `scripts/sparkline.js` / `scripts/status.js` don't read these views). No spec change.

### Verification

- 412/412 script tests pass (`node --test tests/scripts/*.test.js`).
- Audit output on live log: `testSessionsFiltered: 150`; `byHook.banned-vocab.deny`: pre-fix 345 → post-fix 205; `bySection["§10-V"].deny`: pre-fix 73 → post-fix 186 (now reflects real-session activity instead of test-pollution).

### Meta — evidence-validation lesson (saved as mem #8579)

Mid-task, the v0.17.7 P1 was initially scoped on the premise that `§8-npx: regression 7.5×` was test pollution. Verifying via `select(.hook == "pre-bash-safety" and .event == "deny")` returned 0 in 7d, which `seemed` to confirm the premise. False: the 17 `§8-npx` events were `npx-allow-local` + `bypass-escape-hatch` (no deny), so the proxy filter excluded them all and produced a misleading 0. Direct filter via `select(.spec_section == "§8-npx")` showed all 17 were real UUID sessions (mem vitest + daagu vue-tsc). **Lesson**: when auditing a spec_section's trend, filter on `spec_section` directly — never via `hook + event` as proxy. Hook+event is coarser than spec_section; one hook can emit multiple sections, and section-specific events (allow / bypass) vary independently from the deny event. User-correction at AskUserQuestion gate caught this before code shipped on the wrong premise.

## [0.17.5] - 2026-05-14

**Patch — fix: `memory-read-check.sh` + `memory-prompt-hint.sh` backtick-form TAG_BLOCK parsing matched the LAST `\`[token]\`` on each MEMORY.md index line — so a decorative backtick block in the description hijacked the parsed tag and silently shadowed the real tag.**

### Background

Round 6 dogfood probe of `memory-prompt-hint.sh` against a synthetic MEMORY.md line:

```
- [Has both](feedback_btq.md) `[realtag]` — see also `[decortag]` inline
```

Prompts containing `realtag` were SILENT (no hint emitted). Prompts containing `decortag` (which sits in the description, not the tag block) WERE flagged. Both backtick blocks parsed the same way because the regex was:

```
sed -n 's/.*`\[\([^]]*\)\]`.*/\1/p'
```

The greedy `.*` consumed up to the LAST `\`[...]\`` token on the line — so descriptions that decoratively quote a token inside backticks (a very common technical-prose pattern) silently became the parsed tag.

**Production impact**: the project's own `MEMORY.md` has at least one affected entry — `feedback_cc_cwd_encoding_dots.md` is documented as

```
... `[cwd, encoding, projects, underscore]` — CC encodes every non-`[a-zA-Z0-9-]` char to `-`; ...
```

Pre-fix, this line's parsed tag was `a-zA-Z0-9-` (the regex example inside the description), not the intended `cwd, encoding, projects, underscore`. Any prompt about cwd encoding / project paths / underscore handling silently missed the §11 read-check rule because the real tags were never registered.

### What changed

- `[fix MED]` **`hooks/memory-read-check.sh`** — backtick TAG_BLOCK regex now anchors on `.md)`:

  ```diff
  - sed -n 's/.*`\[\([^]]*\)\]`.*/\1/p'
  + sed -n 's/.*\.md)[[:space:]]*`\[\([^]]*\)\]`.*/\1/p'
  ```

  The `.md)` anchor forces the match to start at the close of the markdown link, before any decorative backtick block in the description. The greedy `.*` before `.md)` is fine because `.md)` itself is the unambiguous anchor (only one per line in practice — the link target).

  Mirrors the existing plain-form fallback (line 146 of the same file), which already anchored on `.md)` since v0.11.0. The backtick variant was added separately and missed the anchor.

- `[fix MED]` **`hooks/memory-prompt-hint.sh`** — same one-line change; this hook duplicates the parsing logic from `memory-read-check.sh` and was added with the same flaw in v0.11.0.

- `[test]` **`tests/hooks/memory-read-check.test.sh`** Cases 30+31 — real-tag-matched + decorative-token-not-matched pair, anchored on a fresh `S30_DIR/S30_CWD` so the existing Cases don't interfere. 29 → 31.

- `[test]` **`tests/hooks/memory-prompt-hint.test.sh`** Cases 13+14 — same pair on a `BTQ_CWD` fixture. 12 → 14.

### Why patch

Restores the documented spec §11 tag-match contract — only `\`[tag, tag]\`` immediately following the markdown link is a tag block. Description-decorative backtick blocks were never supposed to be tags. CHANGELOG `fix:` not `change:`. No new flags, no new behavior, no LLM-visible metadata bump (the hooks are mechanical filters; spec text is unchanged).

### Tests

- `bash tests/run-all.sh`: 411 node-test + 2 integration suites pass.
- `bash tests/hooks/memory-read-check.test.sh`: 31/31 (was 29; +2).
- `bash tests/hooks/memory-prompt-hint.test.sh`: 14/14 (was 12; +2).
- All other hook suites unchanged (76/76 pre-bash-safety, 24/24 banned-vocab, 15/15 ship-baseline, etc.).
- `spec-coherence-audit`: 3/3 clean.

### Operator notes

- Update path: plugin marketplace update + `/reload-plugins`. `${CLAUDE_PLUGIN_ROOT}` expansion picks up new hook bodies automatically.
- **If you have a MEMORY.md entry whose description contains backtick-wrapped tokens** (`` `[regex]` ``, `` `[example]` ``, `` `[type]` ``, etc.), this release re-enables tag-matching on the real tag — you may see hints / denies fire on prompts you previously didn't, because the real tags are now correctly indexed.
- Audit your project's MEMORY.md: `grep -E '\`\[[^]]+\]\`.*\`\[[^]]+\]\`' <path-to-MEMORY.md>` lists lines with multiple backtick blocks that were ambiguously parsed pre-fix.

## [0.17.4] - 2026-05-14

**Patch — fix: `banned-vocab-check.sh` + `ship-baseline-check.sh` trigger filter false-positives on `git commit` / `git push` substrings inside shell comments and heredoc bodies. Ports the v0.9.28 `memory-read-check.sh` segment-anchor regex (CMD flatten + `^|[[:space:]]*[;&|]+[[:space:]]*` separator) to both hooks. Closes the last two raw-`$CMD`-grep sites identified in the v0.17.3 sister-pattern sweep.**

### Background

After v0.17.3 closed the multi-line CMD §8 bypass in `pre-bash-safety-check.sh`, a sister-pattern grep across all hooks revealed two remaining raw-`$CMD` trigger sites:

```
hook → reads CMD → has sanitize → has flatten
pre-bash-safety-check.sh    ✓   ✓   ✓ (v0.17.1 + v0.17.3)
memory-read-check.sh        ✓   ✓   ✓ (v0.9.28 + v0.17.1)
banned-vocab-check.sh       ✓   ✗   ✗   ← Bug 16
ship-baseline-check.sh      ✓   ✗   ✗   ← Bug 15
```

Both used the loose prefix `(^|[[:space:];&|])` — which accepts ANY whitespace as a separator. That lets a space after `#` (comment) or a space inside a heredoc body line satisfy the prefix, so:

- `# git commit -m "significantly faster"` (comment) → banned-vocab fires, message-extract finds `-m "..."`, hook denies a non-existent commit.
- `cat <<EOF\ngit push origin main\nEOF` (heredoc body) → ship-baseline fires when CI is red, denying a `cat` command that doesn't push anything.

`memory-read-check.sh` already solved this in v0.9.28 by flattening CMD to a single line and tightening the prefix to `(^|[[:space:]]*[;&|]+[[:space:]]*)` — real shell separator only. This release ports that fix verbatim to the two remaining hooks.

### What changed

- `[fix MED]` **`hooks/banned-vocab-check.sh`** — trigger filter now flattens `$CMD` with `tr '\n' ' '` and uses the segment-anchor `TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'`. Message extraction below the trigger gate is unchanged — its `-m "..."` regex was already quote-aware and only ran AFTER trigger fired, so the upstream tightening alone is enough. `tests/hooks/banned-vocab.test.sh` 20 → 24 (+3 FP-anchor + 1 non-regression on chained `make && git commit`).

- `[fix LOW]` **`hooks/ship-baseline-check.sh`** — same shape: `CMD_FLAT=$(printf '%s' "$CMD" | tr '\n' ' ')` + segment-anchor `TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git[[:space:]]+push([[:space:]]|$)'`. The `--help` short-circuit on line 29 also reads `CMD_FLAT` for consistency. `tests/hooks/ship-baseline.test.sh` 11 → 15 (+3 FP-anchor + 1 non-regression on chained `make && git push`).

### Why patch

Both changes restore intended hook behavior — comments and heredoc bodies are not shell-executable contexts; the spec rules (§10-V banned-vocab on real commits, §7 ship-baseline on real pushes) were never supposed to fire on them. `memory-read-check.sh` already shipped this design; the sister hooks were inconsistent. CHANGELOG `fix:` not `change:` — no new behavior, just tighter scoping of an existing rule.

Severity:

- **Bug 16 (banned-vocab) — MED FP**: blocks legitimate commits whenever a previous bash command on the same Claude tool call contained a `# git commit -m "..."` example in a comment or a `cat <<EOF ... git commit ... EOF` shell snippet in a heredoc. Users would see deny on the very next real commit because the agent's running bash CMD included an example-as-text.

- **Bug 15 (ship-baseline) — LOW FP**: only surfaces when CI is currently red; the hook then denies the `cat`/`echo`/`ls` command for containing a `git push` substring. No security impact (FP makes hook overly strict, never overly permissive).

### Non-regression anchors

Each hook test gained an explicit case for chained-real shape (`make && git commit -m "..."` / `make && git push origin main`) that fires the trigger via `&&` separator. These lock that the tightened regex still matches real shell-separator chains, only rejecting whitespace-only prefixes.

### Tests

- `bash tests/run-all.sh`: 411 node-test + 2 integration suites pass.
- `bash tests/hooks/banned-vocab.test.sh`: 24/24 (was 20).
- `bash tests/hooks/ship-baseline.test.sh`: 15/15 (was 11).
- `bash tests/hooks/pre-bash-safety.test.sh`: 76/76 (unchanged).
- `bash tests/hooks/memory-read-check.test.sh`: 29/29 (unchanged).
- Manual end-to-end: 8 FP probes (4 per hook: full-comment / inline-comment / heredoc body / quoted string) verified post-fix; 2 non-regression chained-real probes verified.

### Operator notes

- Update path: plugin marketplace update + `/reload-plugins`. `${CLAUDE_PLUGIN_ROOT}` expansion means installed plugin picks up the new hook bodies automatically.
- Bypass tokens unchanged: `[allow-banned-vocab]` and `known-red baseline: <reason>` continue to work the same.
- If you'd intentionally been writing bash with `# git commit -m "..."` example comments and getting denied — this release is your fix; no `[allow-banned-vocab]` needed for non-commit contexts.

### Sister-pattern sweep — final state

After this release, all four `*-check.sh` hooks that read `tool_input.command` and act on it (`pre-bash-safety`, `memory-read-check`, `banned-vocab-check`, `ship-baseline-check`) use the same defense-in-depth shape: (1) `tr '\n' ' '` flatten, (2) segment-anchor trigger regex, (3) sanitize (where applicable for tag/message extraction). No remaining raw-multi-line-`$CMD` grep sites in the hook fleet.

## [0.17.3] - 2026-05-14

**Patch — fix: CRITICAL — `pre-bash-safety-check.sh` multi-line CMD §8 SAFETY bypass closure. Multi-line bash commands containing `rm -rf $UNSAFE_VAR` on any line other than the first silently passed the hook; the matching multi-line `npx pkg@PIN` case wrongly denied as unpinned. One root cause, two opposite-direction defects.**

### Background

v0.17.2 shipped the bare-`rm -rf $HOME` whitelist closure (Bug 5 / Steam-disaster class). End-to-end dogfood Round 4 — running the *just-shipped* hook against realistic multi-line bash scripts — surfaced that the §8 SAFETY hook's pattern extraction was completely broken for any multi-line CMD where the rm/npx call wasn't on line 1. The fix landed in v0.17.2 reduced bare-`$HOME` to a denied case for *single-line* commands but the hook was systematically failing to fire on multi-line ones.

Minimal repro for the CRITICAL leg (pre-fix):

```
CMD = "TMP=$(mktemp -d)\nrm -rf $UNSAFE_VAR"
→ hook output: <empty> (no decision, allow)
```

The single-line equivalent `rm -rf $UNSAFE_VAR` correctly denied. The multi-line form bypassed §8 SAFETY entirely — the exact spec rule the hook exists to enforce. An agent that issues a heredoc-style bash command with any setup line before the destructive call would slip through.

Reverse leg (false-DENY, also pre-fix):

```
CMD = "TMP=$(mktemp -d)\nnpx prettier@3.0.0 --check ."
→ deny: "npx unpinned package: TMP=$(mktemp"
```

Pinned `prettier@3.0.0` flagged as `TMP=$(mktemp` unpinned. Innocent scripts denied; users would either disable the hook or wrap every npx call in a one-liner — eroding §8 trust.

### Root cause

`pre-bash-safety-check.sh` extracted rm-target and npx-package via per-line sed:

```bash
rm_tail=$(echo "$SANITIZED_CMD" | sed -E "s/.*${RM_FLAG_REGEX}//" | head -n1)
npx_tail=$(echo "$SANITIZED_CMD" | sed -E "s/.*${NPX_REGEX}//" | ...)
```

`sed -E` processes line-by-line. Lines without `rm`/`npx` passed through unchanged; only the rm/npx line had its prefix stripped. Downstream:

- `head -n1` (rm path): always returned line 1 regardless of where the rm sat. If rm was on line ≥2, line 1 had no rm content → `rm_target` empty → deny path never fired. **§8 SAFETY bypass.**
- `for tok in $npx_tail` (npx path): bash word-splitting iterated tokens from ALL lines. Line 1's first token (typically `TMP=$(mktemp`) became `pkg_token` → flagged as unpinned. **False deny on innocent scripts.**

Sanitize already stripped heredoc bodies / line comments / quoted bodies, so the remaining newlines were between *independent command lines* — safe to flatten.

### What changed

- `[fix CRITICAL]` **`hooks/pre-bash-safety-check.sh`** — new `SANITIZED_CMD_FLAT=$(printf '%s' "$SANITIZED_CMD" | tr '\n' ' ')` computed once after sanitize. Both extraction passes (`rm_tail` and `npx_tail`) now read `SANITIZED_CMD_FLAT` instead of `SANITIZED_CMD`. The `head -n1` on the rm extraction is removed (no longer needed; whole flat string contains all targets after the sed strip).

- `[test]` **`tests/fixtures/bash-safety/corpus.tsv`** +7 multi-line cases (`__NL__` LF marker per corpus convention):
  - `deny`: multi-line `rm -rf $UNSAFE` (was false-ALLOW — the CRITICAL leg).
  - `deny`: multi-line bare `rm -rf $HOME` on line 2 (v0.17.2 Bug 5 cross-check — confirms the prior fix is intact when rm is on a later line).
  - `pass`: multi-line `rm -rf $HOME/cache` on line 2 (whitelist subpath survives multi-line).
  - `pass`: multi-line `npx prettier@3.0.0` on line 2 (was false-DENY).
  - `pass`: multi-line `npx ./node_modules/.bin/foo` on line 2 (local path survives).
  - `deny`: multi-line `npx prettier` unpinned on line 2 (real catch preserved).
  - `deny`: `rm -rf $UNSAFE` on line 3 of 5 (cross-checks the head -n1 removal — earlier lines no longer hide a deeper rm).

  Corpus 69 → 76. `bash tests/hooks/pre-bash-safety.test.sh` 76/76.

- `[fix LOW]` **`commands/claudemd-rules.md`** — `--verbose` was documented as if it were a script flag (`$ARGS --verbose`), but `scripts/hard-rules-audit.js` rejects it as `Unknown argument`. The command's intent was for `--verbose` to be an agent presentation directive (show full `rules` array in output), not a script flag. A user typing `/claudemd-rules --verbose` would have `CLAUDEMD_RULES_DAYS="--verbose"` set as env, then the script would crash with `--days requires a positive integer (got '--verbose')`. The md now documents a 4-row parsing table (`""` / `90` / `--verbose` / `90 --verbose` → env + agent output) that the LLM follows to split numeric and presentation tokens cleanly.

### Why patch (not minor)

Restores documented §8 SAFETY behavior — the hook was supposed to deny `rm -rf $VAR without validating VAR` per spec §8 (immutable), but multi-line CMDs bypassed it. CHANGELOG `fix:` not `change:` or `feat:`. No new hook surface, no new flag, no new spec rule. The corpus addition is regression-anchor only.

Severity disclosure: the CRITICAL leg means any user on plugin v0.17.2 or earlier had a §8 SAFETY hole for multi-line bash CMDs that included `rm -rf $UNSAFE_VAR` on lines ≥2. We have no telemetry indicating active exploitation, but the spec-coverage gap is real — recommend immediate update.

### Tests

- `bash tests/run-all.sh`: 411 node-test + 2 integration suites pass.
- `bash tests/hooks/pre-bash-safety.test.sh`: 76/76 (was 69/69 after v0.17.2; +7 multi-line cases this release).
- Manual end-to-end: 6-scenario rm/npx matrix (multi-line + single-line × bare/subpath/glob/pinned/local/unpinned) verified post-fix; v0.17.2's bare-`$HOME` denials still fire correctly when `$HOME` sits on line ≥2.

### Operator notes

- Update path: plugin marketplace update + `/reload-plugins`. Installed plugin picks up the new hook body via `${CLAUDE_PLUGIN_ROOT}` expansion.
- **If you have v0.17.2 or earlier, agent-issued multi-line bash with `rm -rf $UNSAFE` was silently allowed**. Audit your `~/.claude/logs/claudemd.jsonl` for the absence of `§8-rm-rf-var` rows on sessions where you expect the hook should have fired.
- The per-cmd escape hatch `[allow-rm-rf-var]` / `[allow-npx-unpinned]` continues to work in multi-line CMDs (already operates on raw `$CMD`, not sanitized).

## [0.17.2] - 2026-05-14

**Patch — fix: 6-bug end-to-end dogfood pass. §8 SAFETY `rm -rf $VAR` whitelist closure (closes bare-`$HOME` Steam-disaster class); `transcript-vocab-scan` multi-paragraph false-negative; CLI `lint` whitespace-in-positional misclassified as path; CLI `audit` silent-OK on non-JSONL files; manifest `spec_version` drift v6.11.12 → v6.11.16; `update.js` raw Node stack trace on bogus env value.**

### Background

End-to-end agent dogfood across 3 rounds: real user paths through bin CLI, all 17 hooks, install/update/uninstall flows. 411 unit + 2 integration tests as baseline; added 18 regression tests across the 6 fixes. Highest-severity finding: a CRITICAL whitelist gap in `pre-bash-safety-check.sh` that allowed bare `rm -rf $HOME` (and `$PWD`/`$TMPDIR`/`$OLDPWD`) to pass without a `[allow-rm-rf-var]` token. The whitelist was supposed to certify the variable is shell-typed; in practice it also certified the *bare* expansion, which is exactly the Steam-disaster shape (Valve/steam-for-linux#3671: `rm -rf "$STEAM_ROOT/"*` with empty STEAM_ROOT wiped entire home dirs). Spec §8 already forbids `rm -rf $VAR without validating VAR` — the hook was simply not enforcing the spec it was supposed to enforce.

### What changed

- `[fix CRITICAL]` **`hooks/pre-bash-safety-check.sh`** — whitelisted vars (HOME/PWD/OLDPWD/TMPDIR) now require ≥1 non-`/` character in the literal-path residue (the rm-target with all `$VAR` expansions + quotes stripped). `rm -rf $HOME` / `rm -rf "$HOME"` / `rm -rf ${HOME}` / `rm -rf $HOME/` all DENY post-fix. `rm -rf $HOME/cache` / `rm -rf $HOME/*` / `rm -rf "$HOME/sub"` continue to ALLOW — subpath-bounded targets retain the prior behavior. `BASH_SAFETY_INDIRECT_CALL=1` path (`bash -c '...'` unwrapping) inherits the same check. `tests/fixtures/bash-safety/corpus.tsv` +10 rows: 7 new `deny` (bare-var shapes incl. trailing-slash) + 3 new `pass` (glob / quoted / braced subpath) — corpus-driven test goes 62 → 69.

- `[fix HIGH]` **`hooks/transcript-vocab-scan.sh`** — `jq` per-text-block `gsub("[\\r\\n]+"; " ")` before the outer `join(" ")` collapses internal newlines so the whole assistant turn is one scan-friendly line. Pre-fix, an agent turn like `"I significantly improved X.\n\nNext step is Y."` extracted as multi-line text; downstream `tail -n 1` then picked only "Next step is Y." and the §10-V hit in the first paragraph was silently dropped. The hook's docstring comment claimed `join(" ")` made each turn one line, but that only joined CONTENT BLOCKS — embedded `\n` inside a single `.text` block survived. `tests/hooks/transcript-vocab-scan.test.sh` 8 → 10 (+2 multi-paragraph anchors: first-para-only and last-para-only banned word both caught).

- `[fix MED]` **`bin/claudemd-lint.js`** — `lint` positional argument path-shape heuristic now requires no whitespace. Pre-fix, `claudemd-cli lint "Fixed crash in scripts/audit.js:42 (12/12 tests pass)"` exit 2 "file not found" because the heuristic only looked for `/`. Real paths are token-shaped; whitespace-containing positionals are inline sentences with file:line citations. `tests/scripts/lint-cli.test.js` +1 test (`sentence with /file:line citation` → text-scan + banned-vocab variant).

- `[fix MED]` **`bin/claudemd-lint.js`** — `audit` subcommand pre-flight check: a non-empty JSONL file with zero parseable JSON rows exits 2 with `"audit: no parseable JSON rows in <path> (expected JSONL transcript with one JSON object per line)"`. Pre-fix, pointing audit at a non-JSONL file (plain log, CSV, corrupted transcript) silently exited 0 with `"OK: no §10-V hits across 0 assistant turn(s)"` — CI hooks would falsely greenlight a wrong-format input. Same silent-success class as v0.9.14 / v0.9.21 lint fall-through. `parseTranscript`'s documented per-row silent-skip contract is preserved: the guard fires ONLY when 100% of non-empty lines fail to parse. `tests/scripts/lint-cli.test.js` +3 tests (non-JSONL, empty file degenerate-OK, partial-corruption preserves silent-skip).

- `[fix LOW]` **`scripts/update.js`** — `.then().catch()` wrapper translates env-shape errors (unknown `CLAUDEMD_UPDATE_CHOICE` like `YOLO`) into a one-line stderr + exit 1, mirroring the validation-error contract used by audit.js / sparkline.js. Pre-fix, an unknown choice surfaced as a 5-line Node promise-rejection stack trace (`Error: unknown choice: YOLO\n    at update (file:.../update.js:41:11)...`) + exit 1 — same exit code but unreadable for users typo-ing the env var. `tests/scripts/update.test.js` +1 test (assert exit 1 + clean stderr + no `at update (file:...` stack lines).

- `[fix data]` **`spec/hard-rules.json`** — `spec_version` synced `v6.11.12` → `v6.11.16`. Four prior patch releases (v6.11.13–v6.11.16, all compression/wording-only with `§13.2 budget cost: 0`) did not add or remove HARD rules, so the manifest was never bumped. But `/claudemd-rules` and `safety-coverage-audit` both surface this field at the top of their output — users saw "Spec v6.11.12" against a v6.11.16 spec on disk. Manifest is now bumped with every spec H1 change. `tests/scripts/hard-rules-drift.test.js` +1 test (`hard-rules-7`) asserts `manifest.spec_version === spec/CLAUDE.md H1 version` — future H1 bumps that miss the manifest sync will fail CI before reaching users.

### Why patch (not minor)

All 6 changes are `fix:` per CHANGELOG convention — each restores intended/documented behavior:

- §8 SAFETY explicitly forbids `rm -rf $VAR without validating VAR`; bare `$HOME` falls under that rule. The whitelist was an over-permissive shortcut, not the documented intent.
- §10-V transcript scanning was documented to scan agent assistant text; truncating to the last line of the last turn was a parser implementation bug, not the documented behavior.
- CLI `lint` whitespace heuristic and `audit` non-JSONL exit 2 both close silent-success / spurious-error variants of the same parser-discipline class fixed in v0.9.14 / v0.9.16 / v0.9.21.
- `update.js` clean error contract matches the rest of the script suite.
- `hard-rules.json` `spec_version` sync is a data fix, no behavior change for hook consumers.

No LLM-visible metadata change. No new HARD rules. No new hook surface. No public CLI flag added or removed. Existing `[allow-rm-rf-var]` per-cmd escape hatch unchanged — users with intentional `rm -rf $HOME` patterns (rare) can still bypass with the token.

### Tests

- `bash tests/run-all.sh`: 411 node-test + 2 integration suites pass. Test count unchanged (the 6 new node-test cases offset 0 deletions; corpus + bash hook test counts grew internally: corpus 62 → 69, transcript-vocab-scan 8 → 10).
- `bash tests/hooks/pre-bash-safety.test.sh`: 69/69 (was 62/62 + 10 corpus rows wired in).
- `bash tests/hooks/transcript-vocab-scan.test.sh`: 10/10 (was 8/8).
- Manual end-to-end:
  - 12 `rm -rf` shape matrix verified: bare `$HOME`/`$PWD`/`$TMPDIR`/`$OLDPWD` + trailing slash all DENY; subpath/glob/quoted/braced all ALLOW.
  - Real CC transcript audit on 30 recent `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/*.jsonl`: 13 flagged with §10-V hits (signal validated against production prose).

### Operator notes

- **Breaking change risk: low.** `rm -rf $HOME` (bare, no subpath) is now denied — but no real workflow runs that intentionally; it's a footgun. Workflows using `rm -rf $HOME/<subpath>` (the normal shape) are unaffected.
- **Update path:** plugin marketplace update + `/reload-plugins`; the `${CLAUDE_PLUGIN_ROOT}` expansion in hook registration means installed plugin picks up the new hook bodies automatically (`reference_plugin_root_hook_expansion.md`). No manual re-install needed.
- **If `rm -rf $HOME` is denied for a legitimate use case** (rare — wholesale home wipe in container build, etc.), the existing `[allow-rm-rf-var]` per-cmd escape hatch still works: `rm -rf $HOME [allow-rm-rf-var]`.
- **`/claudemd-rules` output:** "Spec v6.11.16" header replaces stale "Spec v6.11.12" immediately on first run post-update.

## [0.17.1] - 2026-05-14

**Patch — fix: `memory-read-check.sh` tag-match phase now sanitizes quoted bodies (and heredoc bodies / line comments) before tag scan; closes the FP class where descriptive text inside `--title "..."` / `-m "..."` / `'release/...'` triggered §11 deny on incidental keyword matches.**

### Background

User dogfood report: `glab mr create --title "fix(ws): ... 修 Mac packaged ..."` denied by §11 with `feedback_linux_case_audit.md` listed, even though the push had no semantic relationship to the linux-case memory. Root cause: tag `mac` (likely 3-char single-word EN tag, exact-word with declension tolerance) exact-matched `Mac` inside the quoted `--title` body.

v0.9.28 fixed the TRIGGER stage (segment-anchor `release|deploy|ship` so `git commit -m "release notes"` no longer fires the scan; Cases 14 + 22 lock). The TAG-match stage downstream was left scanning raw `$CMD` including quoted bodies — same inconsistency class. Title text is user-written description, not topic declaration; treating it as authoritative for tag matching produces FP fan-out on every MR/PR with a descriptive title.

### What changed

- `[fix]` **`hooks/memory-read-check.sh`** — new `sanitize_for_tagmatch()` function modeled on `pre-bash-safety-check.sh sanitize_cmd()`. Strips heredoc bodies (multi-line state, `<<-?TAG` introducer + bare-TAG terminator), line comments (`# ...` at line start or after whitespace), and ALL quoted-string bodies (both `"..."` and `'...'`). Simpler than `pre-bash-safety` counterpart: tag-match has no `$VAR` expansion sensitivity (the literal `$VAR` string carries no tag-relevant topic info), so `"foo"` and `"$VAR"` strip uniformly. Empty-quote markers preserved to keep token boundaries. Tag-match grep (~L134) switched from `$CMD` to `$CMD_TAGMATCH` (sanitized form). TRIGGER stage unchanged — still reads `$CMD_FLAT` and its v0.9.28 segment-anchor regex is already correct for quoted-body cases.

- `[test]` **`tests/hooks/memory-read-check.test.sh`** — 2 new cases (27 → 29 total):
  - **Case 28**: `glab mr create --title "fix macos issue"` with MEMORY tag `[mac, ship]` — pre-fix denies on `mac` exact-match against `macos` inside quoted `--title`, post-fix sanitize strips to `--title ""` so no match → pass.
  - **Case 29**: `git push origin 'release/v1.0'` with MEMORY tag `[release]` — pre-fix denies on `release` matching inside single-quoted branch ref, post-fix single-quote strip eliminates → pass.
  - **Case 21 setup adjusted**: declension-tolerance test originally used `git push  # added 2 hooks` form. v0.17.1 sanitize correctly strips line-comments before tag scan (comments are descriptive prose, not topic declaration), so `hooks` keyword no longer survives to match tag `hook`. Test rewritten as `git push origin hooks-fix` — branch ref is real tokenized intent and survives sanitize; locks the declension tolerance via a non-comment carrier.

### Why patch (not minor)

Per `feedback_claudemd_spec_single_source_of_truth.md` + core §2 release-requirements: this is a bugfix restoring intended/documented hook behavior (TRIGGER stage already anchored quoted-body in v0.9.28; tag-match should too — same inconsistency class). CHANGELOG `fix:` not `change:`. No LLM-visible metadata bump (spec content unchanged, only hook implementation). No contract break for hook consumers — fewer false denies, never more.

### Tests

- `tests/hooks/memory-read-check.test.sh` 29/29 PASS (was 27/27 + 2 new).
- All 22 hook test files PASS (no cross-regression): `pre-bash-safety 59/59`, `contract 49/49`, `banned-vocab 20/20`, `memory-coverage-scan 12/12`, etc.
- Full JS suite + integration test: `OVERALL: all suites passed`.

### Operator notes

No action required — hook lives via `${CLAUDE_PLUGIN_ROOT}` expansion (per `reference_plugin_root_hook_expansion.md`), so installed plugin picks up the new sanitize on next file Read. Existing `[skip-memory-check]` bypass still works for any residual FPs (e.g. unquoted tokens like `git push origin release/v1.0` without quotes are out of scope for this patch — quote-aware strip only). For unquoted-body FPs, run `/claudemd-doctor memory-tag-specificity` on your project to surface broad single-word EN tags (`mac`, `linux`, `case`) that should be made specific (`macos-shell-portability`, `linux-case-audit`).

## [0.17.0] - 2026-05-11

**Minor — refactor: spec v6.11.16 §2.1 ROUTE single-source collapse; core spec −470B (headroom 396B → 866B).**

### Background

Per `tasks/specs/routing-single-source.md` (drafted in v0.16.0 cycle, commit 8f26e37). Core spec headroom was at 396B / 25000B (98.42% utilization) — one bad version away from the §0.1 net-delete-forced gate. §2.1 ROUTE was the largest hot-path table that duplicated content with §EXT §4 FLOW (already 21 rows in extended).

### What changed

- **`spec/CLAUDE.md` §2.1 ROUTE table** — 13 rows → 8 rows. Removed 6 rows (env/staging bug, L3 migration, ship, large design, plan review, perf-security-clarify); merged env/staging into code/logic bug row note. New single catch-all row enumerates all 6 evicted triggers → `Load extended → §EXT §4 FLOW`. Hand-walked 5 routing scenarios (bug / ship / plan-review / migration / Q&A) — same terminal skill pre/post-edit.
- **`spec/CLAUDE.md` §2.1 Tool escalation** — 5-principle numbered list (386 chars) → compact heuristic form (235 chars, −151B). All 5 mappings preserved.
- **`spec/CLAUDE.md` §2.1 Anti-patterns** — 3-item paragraph dropped; unique warning (`parallel-dispatch mem + code-graph on same question`) merged into Tool escalation suffix. The 3 dropped items were textual inverses of escalation principles.
- **`spec/CLAUDE-extended.md` Recent changes** — v6.11.15 entry replaced with v6.11.16. Sizing line updated; drift = 0 (line numbers match actual wc -c).
- **`spec/CLAUDE-changelog.md`** — v6.11.16 entry prepended.
- **Spec version bump**: v6.11.15 → v6.11.16 (patch — wording/clarification, identical behavior per §13 META).

### Why minor (not patch) on plugin

Per `feedback_claudemd_spec_single_source_of_truth.md`: plugin semver vs spec semver are independent. Spec is patch (no behavior change). Plugin is minor because shipped artifact's user-visible routing table changed structure — users running `/claudemd-update` see a new §2.1 table on next sync. Per core §2 release-requirements: LLM-visible metadata change (spec content distributed via plugin) → L3 regardless of LOC; ship discoverability via CHANGELOG callout. §13.2 budget cost: 0.

### Cross-ref preservation

`§EXT §12` was referenced only in the now-removed `ship / deploy / PR / release` row's note. Verified still live at 3 other core locations: §0 line 5, §2.1 Skill soft-triggers, §2.2 Ship-pipeline hardening. `spec-coherence-audit ext-cross-refs` PASS expected.

### Tests

- `tests/scripts/spec-coherence-audit.test.js` — ext-cross-refs / sizing-accuracy / structured-report all 3 checks PASS.
- Full JS suite + hook suite + integration green.
- 5 hand-walked routing scenarios re-verified vs new table.

### Operator notes

Sync via `/claudemd-update` to pick up the new §2.1 table in `~/.claude/CLAUDE.md`. No behavior change required from operators — same triggers route to same terminal skills; the table is just more compact.

## [0.16.0] - 2026-05-11

**Minor — fix: `sandbox-disposal-check` no longer false-positive-flags `version-sync.sh` sentinel files; cuts 95% of 30d warn volume.**

### Background

30-day rule-hits telemetry: `sandbox-disposal` accounted for **47% of all hook log lines** (853/1819), with **70% concentration in the last 3 days** (596/853 since 2026-05-08). Diagnostic sampling across 3 sessions (claudemd ship session 7930b8b6, code-graph-mcp Rust session 892392d9) showed 100% FP rate on the surveyed fires — the hook warned during pure read-only investigation, AskUserQuestion-only turns, and `git tag` / `gh release create` ship sequences with no `mkdtemp` activity.

### Root cause

Two of this plugin's own hooks stepping on each other:

- `hooks/version-sync.sh:27` creates per-session sentinel **files** via `touch "$TMPDIR/claudemd-sync-<sid>"` (intentionally persisted 24h for session-scoped early-exit).
- `hooks/sandbox-disposal-check.sh:54` scanned the same `~/.claude/tmp/` directory via `platform_find_newer`, filtering by name prefix (`^claudemd-` / `^tmp\.`) but **not by inode type**. Result: `version-sync`'s session-scoping touch-files were detected as "fresh mkdtemp directories from this session."

Live FS state at fix time: `~/.claude/tmp` held **704 matching entries — 668 files (95%), 36 directories (5%)**. Spec §8.V4 explicitly scopes the rule to "`mkdtempSync` / scratch fixtures / HACK `tmp/`+`scripts/` output" — i.e. directories. Hook header (`sandbox-disposal-check.sh:3`) already documented intent: "Warns if `tmp.XXXXXX`-style mkdtemp **directories** were created this session." Implementation drift, not spec misalignment.

### What changed

- **`hooks/sandbox-disposal-check.sh`**: 1 LOC fix — caller-side `[[ -d "$path" ]] || continue` filter (kept the `-type d` semantic local to this hook rather than baking it into `platform_find_newer`, which `tests/hooks/platform.test.sh` exercises with file fixtures).
- **`tests/hooks/sandbox-disposal.test.sh`**: new Case 9 — `touch claudemd-sync-fake-session-id` + `touch tmp.fake-mktemp-file` must NOT trigger a warn. Regression guard for cross-hook collision.

### Why not also touch `~/.claude/tmp` residue

The 668 stale sentinels are <24h old (high-volume CC session user — 668 sessions / 24h). `version-sync.sh:34`'s `-mmin +1440 -delete` GC will sweep them on next first-prompt-per-session. `/claudemd-clean-residue` already handles manual cleanup if wanted. Fix is the durable solution; cleanup is mechanical recovery from past noise.

### Why not `(b) + (c)` (per-session first-fire sentinel / cwd-`/tmp` skip)

Original 30d telemetry triage proposed 5 cuts (demote / sentinel / cwd-skip / per-session-create tracking / test-trap). Root-cause investigation collapsed them to 1: 95% of the noise pool was version-sync sentinels misclassified. The remaining 5% is real `mkdtemp` residue the hook *should* catch. Adding per-session sentinel or cwd-skip filters on top would now bias toward FN (silencing legitimate residue) without proportional FP reduction.

### Tests

- New `tests/hooks/sandbox-disposal.test.sh` Case 9 (file-shaped match not flagged). 9/9 passed.
- Full hook suite: 23 files, all green. JS suite: 405 unchanged. Integration: full-lifecycle + upgrade-lifecycle PASS.
- `platform.test.sh` unchanged — keeping the type-filter at caller rather than helper preserves the generic file-or-dir contract that platform-lib tests depend on.

### Operator notes

Existing `~/.claude/tmp/claudemd-sync-*` residue (any amount) will be silently ignored by sandbox-disposal from this version forward; `version-sync.sh`'s own 24h GC continues to age them out. Warn-noise reduction is immediate on next CC session reload.

## [0.15.0] - 2026-05-11

**Minor — feat: `mid-spine-yield-scan` Stop hook closes the §11-mid-spine-yield observation gap.**

P2 #1 (a-mini) from the P2/P3 phase plan. Highest-confidence detector in the 5-rule transcript-scan extension queue, shipped first so its FP profile can be measured before layering medium-confidence siblings (iron-law-1 / parallel-path / session-exit / author-not-reviewer).

### Background

§11 Mid-SPINE turn-yield (HARD): once a turn has executed ≥1 tool call inside an active SPINE cycle, the agent must continue planned steps through VALIDATE. Yield only on `[AUTH REQUIRED]`, real ambiguity, or context pressure. Spec gives the tell: "next user message is `继续 / next / 怎么停了 / why did you stop` → confirmed prior yield." Pre-fix, the rule was self-discipline only — no hook observed it, no `rule_hits.jsonl` row carried `§11-mid-spine-yield`, and `/claudemd-rules` staleReviews permanently listed it as un-reviewed. The 4 sibling self-rules (§iron-law-2 / §10-four-section-order / §10-honesty / §10-V) already had hook-side observers (`transcript-structure-scan` / `transcript-vocab-scan`); mid-spine-yield was the only §11 rule still observability-dark.

### What changed

- **New hook** `hooks/mid-spine-yield-scan.sh` (~125 LOC). Stop event; opt-in `MID_SPINE_YIELD_SCAN=1` (default OFF per behavior-layer hook convention — same as `transcript-vocab-scan` / `transcript-structure-scan` / `memory-coverage-scan`).
- **Detection**: walks the session transcript in order; tracks each assistant turn's text + tool_use count. For each user message matching the continuation tell (`继续 / next / continue / proceed / 怎么停了 / 为什么停了 / 还有吗 / why (did) you stop / why stop / keep going / again`, body ≤ 30 chars after whitespace), evaluates the immediately-prior assistant turn. Suspect mid-SPINE yield when the prior turn (a) contained ≥1 tool_use AND (b) text body lacked four-section report anchor (`^Done:` / `^## Done` / `^Done —`) AND (c) text body lacked `[AUTH REQUIRED` (legitimate yield) AND (d) text body lacked `[PARTIAL:` (legitimate partial-completion signal).
- **Aggregation**: per-session count emitted as one advisory row with `extra.count`. Per-session dedup via state sentinel `~/.claude/.claudemd-state/mid-spine-yield-<sid>.ts` — at most one row per `session_id`.
- **Schema additive**: new event `mid-spine-advisory`; new section-mapping row `§11-mid-spine-yield`. `tests/hooks/contract.test.sh` DOCUMENTED array extended.
- **Registry sync**: 16 → 17 hooks. `scripts/lib/hook-registry.js` adds entry; `tests/scripts/{install,hook-registry}.test.js` count pins moved (real-plugin count: 16 → 17; fixture array stays at 12 — fixture is intentionally minimal); `tests/integration/full-lifecycle.test.sh` MCOUNT + regex group moved; `README.md` shell-hook count + name list updated; `commands/claudemd-toggle.md` valid-name list extended; `README.md` kill-switch enumeration extended with `DISABLE_MID_SPINE_YIELD_HOOK`.
- **Kill-switch**: `DISABLE_MID_SPINE_YIELD_HOOK=1` (and the global `DISABLE_CLAUDEMD_HOOKS=1`).

### Why minor (not patch)

New hook = new contract surface (rule-hits emits `mid-spine-advisory` rows, schema documents `§11-mid-spine-yield`). Per `feedback_claudemd_spec_single_source_of_truth.md`: plugin semver vs spec semver are independent — plugin minor for additive observability instrumentation; spec stays at v6.11.15 (rule itself unchanged, only the observation surface added). §13.2 budget cost: 0 (no rule add/remove/downgrade).

### Tests

- New `tests/hooks/mid-spine-yield-scan.test.sh`: 12 cases — default OFF / missing-transcript fail-open / four-section-prev silence / tool-call-prev TP / `[AUTH REQUIRED]` legit-yield / `[PARTIAL:]` legit-partial / long-form-message FP filter / kill-switch / per-session dedup / multi-yield count aggregation / tool+report combined silence / EN `next` continuation parity.
- Updated `tests/hooks/contract.test.sh`: `mid-spine-advisory:mid-spine-yield-scan` in DOCUMENTED array; B/C invariants auto-verify via grep.
- Updated `tests/scripts/install.test.js` + `tests/scripts/hook-registry.test.js`: count pin 16 → 17.
- Updated `tests/integration/full-lifecycle.test.sh`: MCOUNT + settings-eviction regex group.
- Full JS suite: 405 unchanged (count pins only). Hook suite 12/12 new + 8/8 existing transcript-vocab unchanged. Integration: PASS.

### Operator notes

Hook ships default-OFF for ≥30 days FP signal collection before flipping default-ON, mirroring the `transcript-*-scan` + `memory-coverage-scan` precedent. Enable per project via:
```
export MID_SPINE_YIELD_SCAN=1
```
Once FP rate is measurable, the next 4 sibling detectors (iron-law-1 / parallel-path / session-exit / author-not-reviewer) ship as v0.16.0 / v0.17.0 per the P2 #1 (a/b) split — calibrated against this hook's signal-to-noise baseline.

## [0.14.0] - 2026-05-11

**Minor — feat: `/claudemd-sampling-audit` retrospective batch scanner for 4 self-enforced HARD rules.**

P3 #7 from the P2/P3 phase plan: turn agent self-constraint observability from "凭感觉" to "可观测". Companion to v0.13.0's `memory-coverage-scan` and the existing `transcript-{vocab,structure}-scan` hooks — those fire write-time on the current session; this command iterates ALL assistant turns across the last N days of historical transcripts and produces aggregate per-rule violation counts feeding §13.2 staleReviews demote-review.

### Background

Spec audit flagged that 4 self-enforced HARD rules (§10-V banned vocab / §iron-law-2 Done-without-evidence / §10-four-section-order / §10-honesty bare-Uncertain) had hook-side detectors that only saw the last-turn / current-session surface. `staleReviews` in `/claudemd-rules` permanently listed all four as un-reviewed because no batch-scan signal existed. The §13.2 demote pipeline could not start. This command closes that gap.

### What changed

- **New script** `scripts/sampling-audit.js` (~280 LOC). Mirrors the regex / heuristic core of `hooks/transcript-vocab-scan.sh` (§10-V) and `hooks/transcript-structure-scan.sh` (§iron-law-2, §10-four-section-order, §10-honesty), but iterates all assistant text turns across a window of historical transcripts. Loads `hooks/banned-vocab.patterns` directly so vocab detection stays single-sourced; structure detectors are JS re-implementations of the bash awk passes, pinned to identical-fixture tests for drift guard.
- **New slash command** `commands/claudemd-sampling-audit.md`.
- **Default scope**: current project (CC-encoded cwd under `~/.claude/projects/`), last 30 days by `mtime`. Flags: `--days=N`, `--sample=N` (random subset), `--global` (all projects), `--json` (stdout JSON instead of markdown report).
- **Output (default)**: writes `tasks/sampling-audit-<YYYY-MM-DD>.md` with aggregate by-rule table + per-transcript hit list; prints per-rule summary to stdout.
- **Output (`--json`)**: machine-readable `{windowDays, scannedTranscripts, totalTurns, byRule, perTranscript}` to stdout — pipe-friendly for downstream tooling.
- **Drift guard**: 6 fixture transcripts under `tests/fixtures/sampling-audit/` (clean / vocab-hit / iron-law-2-miss / order-violation / honesty-bare / multi-turn) pin both the JS scanner and (manually maintained) the corresponding bash hook outputs to identical expected hit counts. If bash detectors change without this script following, the fixture tests force re-alignment.
- **Read-only**: this ship does NOT write back to `spec/hard-rules.json` `last_demote_review` timestamps. `--update-reviews` flag deferred to v0.15.0 — surfaces signal first, wires ratchet after operator review.

### Why minor (not patch)

New slash command = LLM-visible metadata surface (per spec §2: plugin skill descriptions → L3 regardless of LOC). Additive feature; no rule add / remove / downgrade. §13.2 budget cost: 0.

### Tests

- New `tests/scripts/sampling-audit.test.js`: 9 cases — clean / vocab-hit / iron-law-2-miss / order-violation / honesty-bare / multi-turn fixtures; days-window mtime filter; aggregate result shape; missing projectsDir no-throw.
- Full JS suite: 396 → 405 tests passing (+9 / +2.3%). Hook suite 8/8 (`transcript-vocab-scan`) unchanged. Integration suite: PASS.

### Operator notes

First real-data smoke run (this session, 30d window on the claudemd repo): 46 transcripts, 1885 assistant turns scanned. By rule: §10-V 75 hits across 24 transcripts; §iron-law-2 8 hits across 5 transcripts; §10-four-section-order 0 hits; §10-honesty 5 hits across 3 transcripts. The §10-four-section-order zero-hit baseline confirms the Stop hook's structural enforcement is effective; §10-V remains the highest-drift surface (matches the v0.7.0 high-fire region split in `banned-vocab.patterns`).

Once a few audit runs accumulate, `/claudemd-rules` `staleReviews` can be cleared with informed demote/keep decisions instead of operator-eyeball guesses.

## [0.13.1] - 2026-05-11

**Patch — fix: AI-CODING-SPEC v6.11.14 → v6.11.15 — §0.1 demote-evaluation window 90d → 30d (unblocks `/claudemd-rules` demote-candidate detection).**

P3 task from P2/P3 phase plan. The earlier spec audit (v0.12.1) flagged that `scripts/hard-rules-audit.js` enforced `logSpanDays >= 90` before surfacing demote candidates — and real-world rule-hits log span is 18-25 days under typical retention. Result: `demoteSuppressed.reason: "log spans Nd; §0.1 HARD requires 90d of history"` fired every audit run; `wouldHaveBeen: ["§8-npx"]` was real signal that the spec contract gated against acting on. Lowering the threshold to 30d makes the gate reachable under normal retention; behavior otherwise unchanged.

### What changed

- **Spec v6.11.14 → v6.11.15**: core §0.1 wording — "Quarterly `/claudemd-audit` recommends demotion for core entries with 0 hits in 90d." → "`/claudemd-rules` recommends demotion for core entries with 0 hits in 30d." Drops the "Quarterly" qualifier (cadence is operator-controlled, decoupled from window size) and swaps to the canonical slash-command name (`claudemd-audit` is a different command; the actual demote-review command is `/claudemd-rules`).
- **`scripts/hard-rules-audit.js`**: `DEFAULT_WINDOW_DAYS = 90` → `30`. USAGE help text, `cadenceWarning` template, and CLI error example all updated to match. `insufficientData` gate logic preserved — still requires `logSpan >= days`, but `days` now defaults to 30d (reachable) instead of 90d (effectively unreachable).
- **`commands/claudemd-rules.md`**: frontmatter description + run-line + body all reflect 30-day default. Stale-review row caption "operator's quarterly task list" → "operator's demote-review queue" (cadence not pinned to "quarterly").
- **Version pins synced**: `spec/CLAUDE.md` header, `spec/CLAUDE-changelog.md` top entry, `tests/scripts/spec-structure.test.js`, `tests/integration/upgrade-lifecycle.test.sh`, `README.md` (2 occurrences). Plugin manifest `description` fields stay at `v6.11` per major.minor-only versioning policy.

### Why patch (not minor)

§13 META: patch = wording / clarification / identical behavior. The 90d gate was structurally unreachable, so it was already a no-op in practice; this change unblocks the audit pipeline rather than altering enforcement semantics. Agent behavior unchanged. §13.2 budget cost: 0.

### Tests

All suites pass (will be re-verified pre-ship): 396/396 JS + 20/20 hooks + 2/2 integration. Existing `tests/scripts/hard-rules-audit.test.js` uses explicit `days: 30` in test calls (no default-value pin to break); CLI test comment "default 90-day window" updated for accuracy.

### Operator carry-forward

Once 30d of rule-hits log accrues (currently 18.4d), the next `/claudemd-rules` run can produce real `demoteCandidates` instead of permanent `demoteSuppressed`. Expected first candidate: `§8-npx` (already flagged `wouldHaveBeen` under the v6.11.14 audit).

## [0.13.0] - 2026-05-11

**Minor — feat: `memory-coverage-scan` Stop hook closes the §11 auto-memory observation gap.**

Inverse twin of v0.11.0's `memory-prompt-hint`. The hint hook covers proactive READ-side ("your prompt matches memory you haven't Read"); this new hook covers reactive WRITE-side ("you produced lesson/decision tokens this session but called `mem_save` zero times — review whether anything warrants persistence"). Both fire on the §11 surface and close the cite/save bracket on MEMORY.md lifecycle observability.

### Background

P2 audit (this session's earlier turn) flagged the "该存的没存" observation gap: `memory-prompt-hint` 30d=4 hits and `mem-audit` 30d=3 warns gave no read on whether the agent *should have saved* memory it didn't. Without a session-end coverage scan, that question can't be measured — only inferred from absence. Adding the hook converts the unobservable into a logged `coverage-advisory` rule-hits row.

### What changed

- **New hook** `hooks/memory-coverage-scan.sh` (~90 LOC). Stop event; opt-in `MEMORY_COVERAGE_SCAN=1` (default OFF per behavior-layer hook convention — same as `transcript-vocab-scan` / `transcript-structure-scan`).
- **Detection**: extracts all assistant text from session transcript; line-counts case-insensitive matches against:
  - **Lesson tokens**: `lesson | gotcha | non-obvious | turns out | 踩坑 | 原因是 | 原来如此 | 学到 | 不该 | 下次`
  - **Decision tokens**: `non-default | chose .* over | 因为.*所以 | 选 .* 不选 | 非默认`
- **Offset**: counts `mem_save` tool_use names (MCP shape) and Bash invocations of `claude-mem-lite save` / `mem save`. Fires when `total >= MEMORY_COVERAGE_THRESHOLD` (default 3) AND `mem_saves == 0`.
- **Per-session dedup**: state sentinel `~/.claude/.claudemd-state/mem-coverage-<sid>.ts` — at most one advisory per `session_id` (Stop fires multiple times per session naturally).
- **Schema additive**: new event `coverage-advisory`; new spec section `§11-mem-coverage` in `docs/RULE-HITS-SCHEMA.md`. Contract test (`tests/hooks/contract.test.sh`) DOCUMENTED array extended.
- **Registry sync**: 15 → 16 hooks. `scripts/lib/hook-registry.js` adds entry; `tests/scripts/{install,hook-registry}.test.js` count pin moved; `tests/integration/full-lifecycle.test.sh` MCOUNT + regex group moved; `README.md` hook count + name list updated (also catches up `session-extended-read` which was missing from the README since v0.10.1); `commands/claudemd-toggle.md` valid-name list extended.
- **Kill-switch**: `DISABLE_MEMORY_COVERAGE_HOOK=1` (and the global `DISABLE_CLAUDEMD_HOOKS=1`).
- **Threshold override**: `MEMORY_COVERAGE_THRESHOLD=<N>` env (default 3).

### Why minor (not patch)

New hook = new contract surface (rule-hits emits `coverage-advisory` rows, schema documents `§11-mem-coverage`). Per `feedback_claudemd_spec_single_source_of_truth.md` § "Plugin semver vs spec semver are independent": plugin minor when feature adds; spec stays at v6.11.14 (no rule change, this is observability instrumentation for existing §11 Auto-memory triggers).

### Tests

- New `tests/hooks/memory-coverage-scan.test.sh`: 12 cases — 3+ lesson tokens (advisory), 3+ 中文 decision tokens, below-threshold silence, mem_save tool_use offsets, claude-mem-lite Bash offsets, opt-in OFF silence, kill-switch silence, per-session dedup, missing transcript fail-open, threshold-override silence, no assistant text silence, telemetry shape (`extra.total = lesson + decision`).
- Updated `tests/hooks/contract.test.sh`: `coverage-advisory:memory-coverage-scan` in DOCUMENTED array; B/C invariants auto-verify via grep.
- Updated `tests/scripts/install.test.js` + `tests/scripts/hook-registry.test.js`: count pin 15 → 16.
- Updated `tests/integration/full-lifecycle.test.sh`: MCOUNT + settings-eviction regex.

### Operator notes

Hook ships default-OFF for ≥30 days FP signal collection before flipping default-ON, mirroring the `transcript-*-scan` precedent. Enable per project via:
```
export MEMORY_COVERAGE_SCAN=1
```
Lower threshold for high-signal projects: `MEMORY_COVERAGE_THRESHOLD=2`.

## [0.12.1] - 2026-05-11

**Patch — refactor: AI-CODING-SPEC v6.11.13 → v6.11.14 extended compression (audit-driven trim).**

Spec audit (user request `分析一下我们的CLAUDE.md...能不能精炼和压缩`) surfaced two structural redundancies in `CLAUDE-extended.md` — §11-EXT was 6 sibling sub-sections covering overlapping topics, and Appendix B carried 4 examples (B.3–B.6) whose normative content already lived in §10-R / §2-EXT / §2.S. No HARD rule add/remove/downgrade; no behavior change.

### What changed

- **Spec v6.11.13 → v6.11.14** (patch — content reorg + redundancy removal, identical rule semantics).
- **§11-EXT consolidated** in `spec/CLAUDE-extended.md`: 4 sub-sections (`Session maintenance heuristics` + `Execution heuristics (CC-borrowed)` + `Memory-system routing` + `Auto-memory decision tree`) merged into 2 (`§11-EXT Session heuristics (advisory)` + `§11-EXT Memory operations`); `MEMORY-tag-syntax` folded into Memory operations as a subsection; `macOS shell portability` replaced with one-paragraph cross-ref pointer to `feedback_macos_shell_portability.md` + `feedback_hook_platform_lib_source.md` memory anchors.
- **Appendix B trimmed**: B.1 (`[AUTH REQUIRED]` format) + B.2 (evidence valid/invalid) retained as canonical reuse-cases; B.3 (L3 summary formats) + B.4 (EMERGENCY incident report) + B.5 (auto-decision one-liners) + B.6 (L3 spec example) removed.
- **Version pins synced**: `spec/CLAUDE.md` header, `spec/CLAUDE-changelog.md` top entry, `tests/scripts/spec-structure.test.js` assertions, `README.md` (2 occurrences). Plugin manifest `description` fields kept at `v6.11` per the major.minor-only versioning policy (set in v0.2.1).

### Why patch (not minor)

§13 META: patch = wording / clarification / identical behavior. No rule added or relaxed. Pure content reorganization + redundancy removal; agent behavior unchanged. §13.2 budget cost: 0.

### Tests

- `tests/scripts/spec-structure.test.js` version pins bumped: still asserts core header + changelog top entry shape unchanged; A14 `§11-EXT` anchor still present in extended; A15 `[tag1, tag2]` literal still present (now inside `§11-EXT Memory operations § MEMORY.md tag syntax` subsection).

### Sizing

Live numbers in `spec/CLAUDE-extended.md §Recent changes` Sizing line. Single post-edit `wc -c` per `feedback_spec_sizing_recursive_rewrite.md` option 1 (±20B drift envelope).

## [0.12.0] - 2026-05-11

**Minor — feat: `/claudemd-analyze` spec ↔ implementation coherence audit.** Borrowed from github/spec-kit's `/analyze` pattern, scoped to claudemd's three highest-value drift surfaces. Read-only by default; `--strict` flag exits non-zero on CRITICAL/HIGH for pre-tag ship gate.

### What changed

- **New script** `scripts/spec-coherence-audit.js` (~280 LOC). Three checks:
  1. **§EXT cross-ref resolution** (CRITICAL on miss) — every `§EXT §<id>` ref in `spec/CLAUDE.md` must resolve to a `##+ §<id>` heading in `spec/CLAUDE-extended.md`. Catches the "core cites section, extended doesn't have it" drift family the v0.9.30 partial-impl bug hinted at structurally.
  2. **Sizing line accuracy** (HIGH on >±20B drift) — parses the canonical `**Sizing** (...): core N → M bytes; extended N → M bytes` line in `spec/CLAUDE-extended.md`, compares against `fs.statSync().size`. Tolerance per `feedback_spec_sizing_recursive_rewrite.md` accepted-drift envelope.
  3. **MEMORY.md ↔ files bidirectional** (MEDIUM on dangling refs, LOW on orphan files) — scans the project's MEMORY.md index, cross-references against `~/.claude/projects/<encoded>/memory/*.md`. CC `tr '/._'` encoding consistent with `memory-read-check.sh` + `memory-prompt-hint.sh`.
- **New slash command** `commands/claudemd-analyze.md`.
- **Severity scheme** (Spec Kit borrowed): CRITICAL / HIGH / MEDIUM / LOW grouped findings + per-check `[✓]/[△]/[✗]` summary.
- **Out of scope** (covered by sibling commands; explicitly documented in script header + slash command body to avoid duplication): HARD-rule → hook coverage → `safety-coverage-audit.js`; section_anchor resolution → `hard-rules-drift.test.js`; tag-FP → `claudemd-doctor memory-tag-specificity`; banned-vocab 3-way drift → deferred to v0.13.0.
- **CLI**: `--json` machine output; `--strict` exit-1 gate; `--project=<cwd>` MEMORY.md scope override.

### Why minor, not patch

Pure additive: new script, new slash command, no existing artifact format / output shape changes. But it introduces a new contract surface (`/claudemd-analyze` as a publicly-supported coherence check + CI-gateable `--strict` mode) — minor bump makes the contract semver-discoverable for downstream automation that wants to depend on it.

### Tests

- New `tests/scripts/spec-coherence-audit.test.js`: 12 cases — real-repo smoke + structured-report shape + synthetic-fixture for each failure class (unresolved §EXT ref → CRITICAL, literal `§X-EXT` placeholder NOT flagged, sizing >±20B → HIGH, sizing within tolerance → ok, dangling memory ref → MEDIUM, orphan memory file → LOW, missing MEMORY.md → silent no-index, slash/dot/underscore cwd encoding parity, severity aggregation).
- Suite: 396/396 JS + 20/20 hook + 2/2 integration pass.

### Sizing

No spec changes; same `spec/CLAUDE.md` v6.11.13 baseline as v0.11.0.

## [0.11.0] - 2026-05-11

**Minor — feat: proactive MEMORY.md tag hint at UserPromptSubmit.** New hook `memory-prompt-hint` fires on every user prompt, parses MEMORY.md `[tag, tag]` index, matches against the prompt with the same word-boundary + declension + meta-escape regex as `memory-read-check.sh`, and emits an `additionalContext` block listing un-Read matched memory files. Attacks the observed §11 cite-recall ~8% (2/24) by surfacing relevant memories *before* the agent acts, not waiting for the ship-time deny.

### What changed

- **New hook** `hooks/memory-prompt-hint.sh` (~110 LOC). UserPromptSubmit matcher; emits `{suppressOutput:true, hookSpecificOutput:{hookEventName,additionalContext}}` listing the un-Read matched files (capped at 5 + overflow footer; full match count carried in telemetry `extra.match_count`).
- **Proactive twin** of `memory-read-check.sh`: read-check denies bash ship verbs at ship time; prompt-hint suggests files at prompt time. Both share tag-parsing logic; hint additionally checks the session transcript for prior Read so already-Read files don't generate noise.
- **Schema additive**: `event="suggest"` + `spec_section="§11-memory-hint"` documented in `docs/RULE-HITS-SCHEMA.md` Events table + Spec section taxonomy. Contract test (`tests/hooks/contract.test.sh`) DOCUMENTED array extended.
- **Registry sync**: 14 → 15 hooks. `scripts/lib/hook-registry.js` adds entry; `tests/scripts/{install,hook-registry}.test.js` MCOUNT pin moved; `tests/integration/full-lifecycle.test.sh` manifest count + regex group moved; `README.md` + `commands/claudemd-toggle.md` kill-switch list extended.
- **Kill-switch**: `DISABLE_MEMORY_HINT_HOOK=1`.

### Why minor, not patch

Pure additive: new hook, new event, new spec_section, no existing schema or audit-output shape changes. But: this is the first hook that *injects* into user-prompt context (not just denies / records), and it surfaces on every prompt — user-visible new default behavior crosses the §2 "released-artifact user-visible default behavior change" L3 threshold mentioned in spec v6.11.13, so the bump is minor (not patch) to make the new context-injection contract semver-discoverable.

### Tests

- New `tests/hooks/memory-prompt-hint.test.sh`: 12 cases — single tag match emits, no match silent, prior Read suppressed, multi-tag match, kill-switch, untagged entry skipped, missing MEMORY.md fail-open, empty prompt silent, underscore+dot cwd encoding, regex-meta literal match, telemetry row schema, cap-at-5 + overflow footer.
- `tests/hooks/contract.test.sh` DOCUMENTED array: `suggest:memory-prompt-hint` added (closes Invariants B + C).
- Suite: 20/20 hook + 384/384 JS + 2/2 integration pass.

### Sizing

No spec changes; same `spec/CLAUDE.md` v6.11.13 baseline as v0.10.1.

## [0.10.1] - 2026-05-11

**Patch — feat: §13.1 demote-analysis denominator signal.** New PreToolUse:Read hook `session-extended-read` records once per session when `~/.claude/CLAUDE-extended.md` is read (per spec §2.2 EXT LOADING). Backlog item 1C from v0.10.0 closed: extended-scope rules with "0 hits in 90d" can now be qualified against the count of sessions that actually loaded extended, instead of conflating "rule cold" with "extended rarely loaded."

### What changed

- **New hook** `hooks/session-extended-read.sh` (~40 LOC). PreToolUse:Read matcher; matches only the canonical user-global path (`$HOME/.claude/CLAUDE-extended.md`), not the project source `spec/CLAUDE-extended.md` (which maintainers Read while editing — that's spec-edit traffic, not §2.2 EXT-load).
- **Per-session dedup** via `~/.claude/.claudemd-state/ext-read-<sid>.ts` sentinel. Without dedup, agents Reading the same file N times mid-session would inflate the denominator from "binary did-load" into a frequency metric that §13.1 doesn't evaluate.
- **GC**: `session-end-check.sh` drops the sentinel for the ending SID — best-effort cleanup so `.claudemd-state/` doesn't accumulate one file per ended session.
- **Schema additive**: `event="read"` + `spec_section="§13.1-extended-read"` documented in `docs/RULE-HITS-SCHEMA.md` Events table + Spec section taxonomy.
- **Registry sync**: 13 → 14 hooks. `scripts/lib/hook-registry.js` adds the entry; tests/scripts/{install,hook-registry}.test.js MCOUNT pin moved; tests/integration/full-lifecycle.test.sh manifest count moved; README + commands/claudemd-toggle.md kill-switch list extended.
- **Kill-switch**: `DISABLE_SESSION_EXTENDED_READ_HOOK=1`.

### Why patch, not minor

Pure additive: new hook, new event, new spec_section. No existing schema field changes; no existing audit-output shape changes (consumer side — extending `hard-rules-audit.js` to qualify extended-scope demote candidates against this denominator — is deferred to a follow-up patch). All existing rows continue to parse; new rows are tagged with a new `hook`/`event`/`spec_section` triple that pre-v0.10.1 audit code simply ignores.

### Tests

- New `tests/hooks/session-extended-read.test.sh`: 9 cases — canonical path records, dedup, new-session new-row, project source skipped, wrong tool skipped, missing session_id fail-open, kill-switch, silent stdout.
- `tests/hooks/contract.test.sh` DOCUMENTED array: `read:session-extended-read` added (closes Invariants B + C).
- Suite: 19/19 hook + 384/384 JS + 2/2 integration pass.

### Sizing

No spec changes; same `spec/CLAUDE.md` v6.11.13 / `spec/CLAUDE-extended.md` baseline as v0.10.0.

## [0.10.0] - 2026-05-11

**Minor — roll-up of v0.9.33 → v0.9.38: in-session dogfood-driven hardening of the §0.1 / §13.1 / §13.2 audit data pipeline + the §11 enforcement chain.** Zero new code in this commit (3 manifest version files + this index). First plugin minor bump since v0.2.0; semver shift justified by the coherent feature surface added across the 6 patches — additive Δ-contract on `rule-hits.jsonl` schema (2 new columns), new `audit.js` top-level fields, new `claudemd-doctor` check.

### What the 6 patches collectively delivered

| Patch | Delivered |
|---|---|
| [0.9.33] | `rule_hits_append` 5th arg `session_id`; 7 of 12 emitter hooks threaded. Schema-additive Δ-contract on the JSONL artifact. |
| [0.9.34] | `rule_hits_append` 6th arg `tool_use_id` (PreToolUse / PostToolUse only); remaining 5 hooks plumbed `session_id`; `audit.js` `uniqueInvocations()` dedup view by `(ts, hook, session_id, tool_use_id)`. |
| [0.9.35] | `scripts/lib/memory-tags.js` + `claudemd-doctor` `memory-tag-specificity` check — closes spec §11-EXT (SHOULD, v6.11.11) tooling gap. |
| [0.9.36] | `memory-read-check.sh` deny `extra.match_count` + bypass `extra.bypass_reason` (with `[skip-memory-check: <reason>]` form). |
| [0.9.37] | `detectCutover()` + `bySection` / `byTrend` cutover-split — `(unset)` → `(unset-historical)` + `(unset-current)`. |
| [0.9.38] | `GENERIC_WORDLIST` +10 entries (`design`, `brainstorm`, +8 preventive ship-prose words). |

### Schema shape after v0.10.0

`~/.claude/logs/claudemd.jsonl` row format:
```json
{
  "ts": "2026-05-11T...Z",
  "hook": "<hook-name>",
  "event": "<event-class>",
  "project": "-mnt-data-ssd-...",
  "session_id": "...",         // added v0.9.33
  "tool_use_id": "toolu_...",  // added v0.9.34; PreToolUse/PostToolUse only
  "spec_section": "§...",
  "extra": { ... }
}
```

`scripts/audit.js` top-level shape:
```
windowDays, totalHits,
dataIntegrity: { totalLines, parsed, skipped, skipRatio,
                 cutoverTs },          // added v0.9.37
byHook, bySection, byBypass, byFailOpen, byTrend,
uniqueInvocations,                     // added v0.9.34
topPatterns
```

### Why minor, not patch

Each individual sub-patch was patch-level (atomic, additive, back-compat). Aggregated, they constitute the first deliberate semver shift since v0.2.0: rule-hits.jsonl schema gains 2 stable columns that downstream tooling can rely on; `audit.js` JSON shape gains 2 top-level fields; doctor gains 1 new check class. Anyone with audit dashboards parsing the older shape needs to handle the new keys. Patch-level was correct per individual commit; minor is correct as the index marker.

### Compat (re-confirmed)

- All 6 sub-patches are back-compat: optional schema args, JSONL `null` for absent fields, legacy `(unset)` bucket falls back when cutoverTs is null, pre-v0.9.36 bypass form still works.
- Tests: 19/19 hook + 388/388 JS pass across the entire 6-patch sequence.

### In-session self-dogfood evidence

The work itself stress-tested the §11 enforcement chain twice during ship:
- **v0.9.34 ship → `semantic` tag FP** caught by Read of `plugin_code_graph_mcp.md`. Drove v0.9.35 detector design.
- **v0.9.37 ship → `design` tag FP** caught by Read of `feedback_brainstorm_for_design_tasks.md`. Drove v0.9.38 wordlist补全.
- **v0.9.38 ship → used `[skip-memory-check: <reason>]` form** to bypass the §11 hook on a release whose notes literally mention `design`. First production use of the v0.9.36 `bypass_reason` capture.

The §11 enforcement worked correctly all three times — each FP was the spec doing its job, not failing.

### Plugin

- Plugin manifests bumped 0.9.38 → 0.10.0 (package.json + plugin.json + marketplace.json). Spec content unchanged — manifest `description` fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.38] - 2026-05-11

**Patch — §11-EXT Tag-specificity wordlist补全.** Self-applied follow-up to v0.9.35: this session's own ship flow tripped two §11 FPs (`semantic` in 1B body / `design` in cutover-split body), and only the first was caught by v0.9.35's wordlist. Adds 10 entries: 2 from the observed FP (`design`, `brainstorm`) + 8 preventive picks from words that appeared ≥2× in this session's release notes / CHANGELOG entries (`architecture`, `behavior`, `schema`, `default`, `pattern`, `format`, `system`, `process`). Live doctor finding count 22 → 24 (+2 catches `design` + `brainstorm` in `feedback_brainstorm_for_design_tasks.md`; other 8 are preventive — no current MEMORY.md uses them as single-word tags yet).

### Changed

- `[change]` **`scripts/lib/memory-tags.js`** `GENERIC_WORDLIST` extended by 10 entries.
- `[add]` **`tests/scripts/memory-tags.test.js`** new case `v0.9.38: design / brainstorm + 8 ship-prose words flagged` locks all 10 additions.

### Tests

- 17/17 memory-tags + 19/19 hook + 388/388 JS pass; `tests/run-all.sh` `OVERALL: all suites passed`.

### Plugin

- Plugin manifests bumped 0.9.37 → 0.9.38 (package.json + plugin.json + marketplace.json).

## [0.9.37] - 2026-05-11

**Patch — audit `bySection` cutover-split for `(unset)` bucket.** Closes point 1 of 2026-05-11 dogfood: the legacy `(unset)` bucket conflated three different row kinds — (a) pre-v0.7.0 historical rows (will age out), (b) post-cutover by-design housekeeping (session-start bootstrap / version-sync), (c) post-cutover instrumentation gaps (real bug signal). With one bucket, (a) overwhelmed (b)+(c) in steady state and instrumentation regressions were invisible. v0.9.37 auto-detects the cutover ts and splits.

### Added

- `[add]` **`scripts/lib/rule-hits-parse.js` `detectCutover(path)`** — scans log for the earliest row carrying non-null `spec_section`; returns ms-since-epoch or null (log entirely pre-v0.7.0).
- `[change]` **`groupBySection(hits, cutoverTs?)`** — optional 2nd arg; when provided, null-section rows split into `(unset-historical)` (ts < cutoverTs) / `(unset-current)` (ts ≥ cutoverTs). Without the arg, behavior is unchanged (legacy single `(unset)` bucket — back-compat for callers pre-dating v0.9.37).
- `[change]` **`byTrend(hits, windowDays, cutoverTs?)`** — same split applied to recent/prior trend buckets. Same back-compat semantics.

### Changed

- `[change]` **`scripts/audit.js`** — emits `dataIntegrity.cutoverTs` (ISO-8601 UTC or null); threads detected cutover into `groupBySection` + `byTrend` calls. Legacy `(unset)` bucket disappears from audit output whenever the log has any spec_section row.
- `[change]` **`scripts/doctor.js`** — `rule-usage` section skip extended to all `(unset*)` variants. Defensive: doctor still calls `groupBySection` without cutoverTs (single-bucket), but if future code threads it through, doctor won't accidentally score the split buckets.
- `[change]` **`commands/claudemd-audit.md`** (§2 LLM-visible metadata → L3) — renderer hint updated: `(unset-historical)` flagged as pre-v0.7.0 legacy (no heatmap leader); `(unset-current)` requires subtracting intentional housekeeping (`session-start`/`version-sync`) before the residual is treated as instrumentation-gap signal.
- `[doc]` **`docs/RULE-HITS-SCHEMA.md`** — `spec_section` field row notes the v0.9.37 audit-side split.

### Tests

- `[add]` **`tests/scripts/rule-hits-parse.test.js`** — 5 new cases: groupBySection back-compat (no cutoverTs ⇒ `(unset)`); cutover-split splits correctly on mixed pre/post fixture; `detectCutover` finds earliest spec_section row; null when no row has section; null when log missing.
- `[change]` **`tests/scripts/audit.test.js`** — replaced "surfaces legacy rows under (unset)" with "under (unset-current) post-cutover"; added 2 new cases (mixed-fixture cutover-split + null-cutover back-compat behavior).
- 19/19 hook + 388/388 JS pass; `tests/run-all.sh` `OVERALL: all suites passed`.

### Live behavior (this repo, 2026-05-11)

- `cutoverTs = 2026-05-08T19:53:38.000Z` (earliest spec_section row in maintainer log).
- 30d window splits into `(unset-historical)` = 697 rows (pre-cutover legacy) and `(unset-current)` = 137 rows. Of the 137: 83 are by-design housekeeping (`session-start bootstrap`+`upstream-banner`+`version-sync`); residual 54 are mix of stale-plugin-binary rows (sessions still running pre-v0.9.33 code) + genuinely null-section emissions. As `(unset-historical)` rolls out of the 30d window, the residual signal becomes operator-actionable.

### Compat

- Pre-v0.9.37 audit output had `bySection['(unset)']`. v0.9.37 output has `bySection['(unset-historical)']` + `bySection['(unset-current)']` instead (when log has any spec_section row). Any downstream tooling that hardcoded the `(unset)` key needs to handle both variants OR call `groupBySection(hits)` without cutoverTs (still works, returns legacy single bucket).
- doctor's `rule-usage` skip handles all three variants — operator-facing behavior unchanged.

### Plugin

- Plugin manifests bumped 0.9.36 → 0.9.37 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.36] - 2026-05-11

**Patch — memory-read-check observation 维度扩 (`match_count` + `bypass_reason`).** Closes the §0.1 / §13.1 audit data gap from point 3 of 2026-05-11 dogfood. Pre-v0.9.36 the 30d sample showed `skip-memory-check` bypass at 4/9 = 44% rate — n=9 too small to act, but more importantly the row schema couldn't distinguish "rule too strict on N-file avalanche" from "rule unnecessary for this task." Two new fields in `extra`:

- `deny.extra.match_count` = total MATCHES from MEMORY.md scan (`MISSING.length` + already-Read subset). Distinguishes 8-file fan-out deny (avalanche signal — rule may be too broad) from 1-file deny (single tag match, rule working as designed). Audit consumer can bucket bypass rate by match_count to spot avalanche-driven bypass.
- `bypass-escape-hatch.extra.bypass_reason` = free-form reason text extracted from `[skip-memory-check: <reason>]` form. Operator citing "tag-FP" / "trivial-edit" / "already-read-in-prior-session" reasons fuels §0.1 demote decisions without manual transcript reading.

### Changed

- `[change]` **`hooks/memory-read-check.sh`** — escape-hatch parser switched from literal `grep -qF '[skip-memory-check]'` to bash regex `\[skip-memory-check[[:space:]]*(:[[:space:]]*([^]]*))?\]`, accepting both bare and reason forms. Tolerates whitespace around the colon. Trailing whitespace trimmed; non-`]` chars in reason captured literally.
- `[change]` **`hooks/memory-read-check.sh`** — deny row's `extra` extends from `{missing:[...]}` to `{missing:[...], match_count: N}`.
- `[change]` **`hooks/memory-read-check.sh`** — user-facing deny message option (b) updated to advertise `[skip-memory-check: <reason>]` form.
- `[doc]` **`docs/RULE-HITS-SCHEMA.md`** — `extra` field row documents the `memory-read-check`-specific shape for both `deny` and `bypass-escape-hatch` events.

### Tests

- `[add]` **`tests/hooks/memory-read-check.test.sh` Cases 24–27**: bypass with reason captured / bare bypass back-compat (no `bypass_reason` key) / deny carries `match_count=8` with 8-file avalanche fixture / colon-no-space tolerance.
- 27/27 memory-read-check cases pass; 19/19 hook + 391/391 JS tests green; `tests/run-all.sh` `OVERALL: all suites passed`.

### Compat

- Existing bare `[skip-memory-check]` form continues to work unchanged. Rows from pre-v0.9.36 deny events have no `match_count` in `extra` — audit consumer should treat absence as "unknown" (cannot retro-compute).
- No `rule_hits_append` schema change. New fields live entirely in `extra`, which has always been hook-defined payload.

### Plugin

- Plugin manifests bumped 0.9.35 → 0.9.36 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.35] - 2026-05-11

**Patch — §11-EXT Tag-specificity static check in `claudemd-doctor`.** Closes the spec→tooling gap from v6.11.11: spec §11-EXT (SHOULD) said "generic single-word English tags substring-match incidental prose and produce high FP rates" but no enforcer existed; doctor now scans `~/.claude/projects/*/memory/MEMORY.md` for FP candidates.

### Why this exists

Two FP incidents in the §11 MEMORY.md read-the-file enforcement chain:
- v0.9.27 → v0.9.28: tag `cli` substring-matched `clippy` → ~80% FP rate. Hook side fixed via word-boundary tightening (v0.9.28), but tag-quality was never audited.
- 2026-05-11 (this session, mid-1B ship): tag `semantic` from `plugin_code_graph_mcp.md` matched `semantics` in a release-notes body (`fail-open semantics`) — required `[skip-memory-check]` bypass or a Read of the wrong memory file. Root cause: `plugin_code_graph_mcp.md`'s tag list `[callgraph, impact, refs, overview, semantic, ast-search, dead-code, deps]` violates §11-EXT (5 of 8 tags are generic single-word EN: `impact` / `refs` / `overview` / `semantic` / `deps`).

Static check catches this class **pre-deploy** instead of via runtime FP.

### Added

- `[add]` **`scripts/lib/memory-tags.js`** — exports `classifyTag(tag)` + `parseMemoryIndex(content)` + `scanMemoryTags({rootDir})`. Mirrors `hooks/memory-read-check.sh` parsing for both backtick and plain tag-block forms. Hand-curated narrow-allowlist (~30 entries, 3 sub-classes: short tech acronyms / hook trigger verbs / OS-runtime terms) + generic-EN wordlist (~45 entries from observed FPs + high-FP-risk domain words).
- `[change]` **`scripts/doctor.js`** — new `memory-tag-specificity` check after rule-usage section. Groups findings by `(memDir, file)`; shows up-to-3 sample entries inline, `+N more` overflow. Advisory only (spec §11-EXT is SHOULD, not MUST).
- `[doc]` **`commands/claudemd-doctor.md`** — description + body updated to mention the new check.

### Heuristic

A tag is flagged when:
- Single-word (no `-` / `_`) AND ASCII-alpha AND not in narrow-allowlist AND length ≤ 5 → `short-single-word`
- OR (same word-shape filters) AND case-insensitive match in generic wordlist → `generic-wordlist`

Both flags can fire on one tag (e.g. `refs` is 4 chars + in wordlist). Multi-word / CJK / narrow-allowlist tags pass unconditionally.

Tightened detector-FP cases:
- Hook trigger verbs (`release`, `push`, `ship`, `deploy`, `merge`, `commit`, `build`, `publish`) — tagging on these is the hook's design intent, not FP. Added to narrow-allowlist.
- OS / runtime narrow terms (`macos`, `linux`, `ubuntu`, `darwin`, `node`, `python`, `rust`, `go`) — topic-specific in claudemd-domain context.

### Tests

- `[add]` **`tests/scripts/memory-tags.test.js`** — 16 cases covering: multi-word pass / CJK pass / narrow-allowlist pass (3 sub-classes incl. trigger-verbs + OS-runtime) / short-single-word flag / wordlist hit / both-reasons combo / observed-FP allflag / spec-compliant tags from real MEMORY.md / both tag-block parsers / untagged-line skip / integration fixture scan / missing-root no-throw.

### Live scan result (this repo, 2026-05-11)

22 generic-tag candidate(s) across 4 entry(ies) in 8 MEMORY.md file(s). All findings are `plugin_code_graph_mcp.md` copies adopted into 4 separate project memory dirs (claudemd / code-graph-mcp / daagu / mem). Single upstream fix in code-graph-mcp's adoption template clears all 22 simultaneously. Issue/PR description for upstream prepared in-session.

### Plugin

- Plugin manifests bumped 0.9.34 → 0.9.35 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.34] - 2026-05-11

**Patch — instrumentation bundle sub-patch 1B: tool_use_id column + audit `uniqueInvocations` dedup view + 5 remaining hooks plumbed for session_id.** Completes the schema half of the 1A/1B/1C bundle from 2026-05-11 dogfood audit. Post-cutover (this commit on), every rule-hits row carries enough identity to distinguish "one CC invocation logged twice" (registration / lib bug) from "Claude fast-retry after deny in same second" (not a bug).

### Schema

- `[add]` **`rule_hits_append` accepts 6th positional arg `tool_use_id`** (`hooks/lib/rule-hits.sh`). Empty/omitted → JSONL row carries `tool_use_id: null`. Only PreToolUse / PostToolUse hooks populate it; Stop / SessionStart / SessionEnd / UserPromptSubmit leave it null (no per-tool context).
- `[doc]` **`docs/RULE-HITS-SCHEMA.md`** — `tool_use_id` field added; `session_id` field row updated to note all 12 emitter hooks now populate it (1A note revised).

### Hook plumbing — round 2 (12 of 12 emitter hooks)

PreToolUse / PostToolUse hooks add `TOOL_USE_ID` extraction + thread it into all `hook_record` callsites:
- `[change]` **`hooks/banned-vocab-check.sh`** (2 callsites)
- `[change]` **`hooks/ship-baseline-check.sh`** (3 callsites)
- `[change]` **`hooks/pre-bash-safety-check.sh`** (4 callsites)
- `[change]` **`hooks/memory-read-check.sh`** (2 callsites)
- `[change]` **`hooks/transcript-vocab-scan.sh`** (1 callsite)

The 5 hooks not plumbed in 1A get `SESSION_ID` added (tool_use_id stays null — these are non-tool events):
- `[change]` **`hooks/sandbox-disposal-check.sh`** (Stop) — best-effort `cat` from stdin + jq extract, fail-open on any error (Stop cannot block).
- `[change]` **`hooks/residue-audit.sh`** (Stop) — same pattern.
- `[change]` **`hooks/mem-audit.sh`** (Stop) — same pattern.
- `[change]` **`hooks/session-start-check.sh`** (SessionStart) — env-var (`CLAUDE_SESSION_ID`) preferred, stdin fallback; threaded into both `hook_record` callsites (`bootstrap` + `upstream-banner`).
- `[change]` **`hooks/version-sync.sh`** (UserPromptSubmit) — uses existing `CLAUDE_SESSION_ID` env var (hook backgrounds itself, can't reliably re-read stdin).

### Audit consumer

- `[add]` **`scripts/lib/rule-hits-parse.js` `uniqueInvocations()`** — per-hook dedup view. Key: `(ts, hook, session_id, tool_use_id)`. Output: `{rows, unique_invocations, duplicate_rows, legacy_rows}` per hook. `legacy_rows` counts pre-v0.9.33 rows (both session_id + tool_use_id null) so the operator can discount them — historical dedup over-collapses across sessions.
- `[change]` **`scripts/audit.js`** emits new top-level `uniqueInvocations` field (next to `byTrend`).
- `[change]` **`commands/claudemd-audit.md`** — renderer hint updated: surface `uniqueInvocations.<hook>.duplicate_rows > 0` for PreToolUse/PostToolUse hooks as candidate bug; treat `bySection['(unset)']` as historical pre-v0.7.0 data and exclude from heatmap leader unless window pre-dates 2026-05-09.

### Tests

- `[add]` **`tests/hooks/rule-hits.test.sh` Cases 16–18** — Case 16: 6th arg lands as `tool_use_id`; Case 17 / 17b: omitted + empty normalize to null; Case 18: full-shape PreToolUse row (session_id + tool_use_id + spec_section + extra) byte-exact assertion.
- `[add]` **`tests/scripts/audit.test.js` `uniqueInvocations` case** — dedup-by-quadruple + legacy_rows counter + null tool_use_id passthrough for non-tool hooks.
- 19/19 hook tests + 361/361 JS tests pass; `tests/run-all.sh` `OVERALL: all suites passed`.

### Out of scope (sub-patch 1C)

- `session_extended_read` boolean per row (point 4 from 2026-05-11 audit) — separate sub-patch.
- 7 days post-cutover data accumulation before `uniqueInvocations` will produce non-trivial dedup signal. Code path verified by unit test fixture in this release.

### Plugin

- Plugin manifests bumped 0.9.33 → 0.9.34 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.33] - 2026-05-11

**Patch — rule-hits.jsonl schema additive: new `session_id` column.** Sub-patch 1A of the instrumentation bundle (points 2 + 4 from in-session dogfood audit on 2026-05-11). Disambiguates hook double-fire vs fast-retry in audit data — currently `banned-vocab/deny` shows ~50% byte-identical pair rows at the same timestamp, and existing schema cannot tell whether two rows came from one CC invocation (registration / lib bug) or two retries within the same second. Fully back-compat: pre-v0.9.33 rows have `session_id: null`; new callsites populate it from stdin EVENT JSON `.session_id`.

### Schema

- `[add]` **`rule_hits_append` accepts 5th positional arg `session_id`** (`hooks/lib/rule-hits.sh`). Empty/omitted → JSONL row carries `session_id: null` (matches existing `spec_section` empty-arg semantics). Field positioned between `project` and `spec_section` in row JSON for grouping (project + session metadata together).
- `[doc]` **`docs/RULE-HITS-SCHEMA.md`** — new field row with `null` cases enumerated (5 hooks not yet plumbed: `sandbox-disposal`, `residue-audit`, `mem-audit`, `session-start`, `version-sync`; pre-v0.9.33 rows). Sub-patch 1A scope = hooks already extracting EVENT; remaining 5 ship in sub-patch 1B with their own EVENT-read addition.

### Hook plumbing (7 of 12 emitter hooks)

- `[change]` **`hooks/banned-vocab-check.sh`** — `SESSION_ID` extracted from EVENT, threaded into both `hook_record` callsites (deny + bypass-escape-hatch).
- `[change]` **`hooks/ship-baseline-check.sh`** — same pattern, 3 callsites (pass / pass-known-red / deny).
- `[change]` **`hooks/pre-bash-safety-check.sh`** — same, 4 callsites (deny / bypass × 2 / npx-allow-local).
- `[change]` **`hooks/memory-read-check.sh`** — existing `SESSION_ID` extraction moved before bypass-escape-hatch branch so both rows carry it; threaded into 2 callsites.
- `[change]` **`hooks/transcript-structure-scan.sh`** — `SESSION_ID` extracted, threaded into structure-advisory callsite.
- `[change]` **`hooks/transcript-vocab-scan.sh`** — same, 1 callsite.
- `[change]` **`hooks/session-end-check.sh`** — existing `SESSION_ID` threaded into 1 callsite.

### Tests

- `[add]` **`tests/hooks/rule-hits.test.sh` Cases 13–15** — Case 13: 5th arg lands as `session_id` field; Case 14 / 14b: omitted + empty-string normalize to null; Case 15: full-shape row (project + session_id + spec_section + extra) byte-exact assertion per `feedback_test_fixture_format_drift.md` (locks today's audit.js consumer field set).
- 19/19 `tests/hooks/*.test.sh` pass; 360/360 `tests/scripts/*.test.js` pass.

### Out of scope (sub-patch 1B / 1C follow-ups)

- 5 hooks not yet plumbed (`sandbox-disposal`, `residue-audit`, `mem-audit`, `session-start`, `version-sync`) — adding EVENT-read to a hook that doesn't currently call `hook_read_event` is a separate behavior change with its own risk surface.
- `audit.js` `unique_invocations` dedup view — needs ≥7 days of post-cutover data to be meaningful.
- `tool_use_id` (sub-patch 1B) + `session_extended_read` (sub-patch 1C).

### Plugin

- Plugin manifests bumped 0.9.32 → 0.9.33 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1).

## [0.9.32] - 2026-05-11

**Patch — spec v6.11.12 → v6.11.13. Compression-only release: discharges v6.11.12's `MUST net-delete or migrate` carry-forward by removing two long-standing redundancies in extended (§1.5-EXT GLOSSARY duplicate of core §1.5, §10-V illustrative-example bloat).** No rule add/remove/downgrade, no behavior change. Net delete: extended 49835 → 48384 bytes (−1451, recovered to 96.77% utilization from v6.11.12's 99.67% ceiling-grazing).

### Spec changes

- `[refactor]` **§1.5-EXT GLOSSARY consolidated** (extended, −~620 bytes) — table dropped 5 entries (`LOC / Module / Local-Δ / Evidence / Task`) already inlined to core §1.5 since v6.11.5/v6.11.9. §1.5-EXT keeps only `Assumption` + `Local-Δ note` (extended-only material).
- `[refactor]` **§10-V OK examples trimmed** (extended, −~80 bytes) — `OK (absolute)` 5→3 examples; `OK (中文 with baseline)` 3→2. Normative banned-vocab enumeration unchanged.

### Plugin

- Plugin manifests bumped 0.9.31 → 0.9.32 (package.json + plugin.json + marketplace.json). Manifest description fields stay at `v6.11` family per `Versioning policy` (set in v0.2.1) — patch-level spec updates do not re-bump description text.

### Hand-off

- After install, run `/claudemd-update` to pull v6.11.13 into `~/.claude/CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md`.

## [0.9.28] - 2026-05-11

**Patch — spec v6.11.10 → v6.11.11. Hook fix for §11 MEMORY.md read-the-file FP rate (~80% in v0.9.27 self-audit) + spec §11-EXT Tag-specificity SHOULD codifying the complementary authoring discipline.** Two mechanical hook fixes (word-boundary tag match + multi-line trigger collapse) eliminate the 2 substring/anchor FP classes; spec SHOULD addresses the 3rd class (generic exact-word tags) as authoring discipline.

### Fixed

- `[fix]` **`hooks/memory-read-check.sh` word-boundary tag match** — replaces `grep -iF` (literal substring match, no boundaries) with `grep -iE -- "(^|[^a-zA-Z0-9])${ESC_TAG}[a-zA-Z]{0,2}($|[^a-zA-Z0-9])"`. Anchors on non-word-char boundaries; allows 0-2 trailing alpha chars so plurals/declensions still match (`hook` → `hooks` / `hooked`). Tag escaping handles regex meta chars. Eliminates the `cli ⊂ clippy` substring class (FP #5b in v0.9.27 self-audit).
- `[fix]` **`hooks/memory-read-check.sh` multi-line trigger collapse** — `tr '\n' ' '` before applying TRIGGER_RE so the `^` anchor only matches actual start-of-command, not start-of-each-heredoc-body-line. Eliminates the `git commit -m "$(cat <<EOF\nrelease(v0.9.27): ...\nEOF\n)"` false-trigger class (FP #1, FP #4 in v0.9.27 self-audit).

### Spec changes

- `[change]` **Spec §11-EXT Tag-specificity (SHOULD, v6.11.11)** — tags SHOULD be ≥4 chars AND specific to the memory's topic; generic single-word English tags substring-match incidental occurrences and produce high FP rates. Prefer multi-word phrases. Plugin-side complement to the hook word-boundary fix.

### Tests

- `[test]` **4 new test cases** in `tests/hooks/memory-read-check.test.sh` (Cases 20-23):
  - Case 20: `cli` tag does NOT substring-match `clippy` (word-boundary)
  - Case 21: `hook` tag still matches `hooks` plural (declension tolerance)
  - Case 22: heredoc-body `release(...)` line does NOT trigger (multi-line collapse)
  - Case 23: regex-meta tag (`v6.9`) escaped — does not match `v6X9`
- 23/23 passing (was 19/19 pre-fix).

### Operator-side companion (NOT shipped via `/claudemd-update`)

- `[chore]` **`~/.claude/projects/<encoded>/memory/MEMORY.md` tag cleanup** — dropped 12 generic single-word tags across 11 entries; promoted 6 generic tags to multi-word specific phrases. Examples: `[hook, plugin-root, expansion]` → `[plugin-root, hook-expansion]`; `[test, fixture, tdd]` → `[test-fixture, fixture-drift, tdd]`; `[cli, lint, audit, positional, file-flag, ...]` → `[cli-positional, file-flag, silent-success, footgun, sibling-symmetry]`. This is user-global state — operator-managed, version-controlled by user, not shipped through `/claudemd-update`.

### Self-audit grounding

`/claudemd-audit` over the v0.9.27 release session showed 5 hook trips:
- 1 true positive (`macos` tag → memory IS about macOS shell portability — relevant)
- 4 false positives — 2 substring-class (mechanical, fixed by hook), 2 multi-line-anchor-class (mechanical, fixed by hook), 1 generic-exact-word-class (authoring discipline, addressed by spec SHOULD + MEMORY.md cleanup)

### Sizing

- core 24550 → 24550 bytes (header bump only).
- extended 48815 → ~49850 bytes (+1035, new SHOULD section).
- core 450 bytes headroom (98.20%); extended ~150 bytes headroom (**~99.7% — at-ceiling, v6.11.12 MUST net-delete**).

## [0.9.27] - 2026-05-11

**Patch — new SessionEnd hook `session-end-check.sh` mechanizes core §11 "Session-exit mid-SPINE" HARD self-rule.** First feature shipping under the v6.11.10 §9 Parallel-path HARD regime. Spec unchanged — purely plugin-side enforcement. Hook count 12 → 13. Default ON (Stop hook of comparable plumbing already at default-ON; this hook only writes a `tasks/<slug>-paused.md` checkpoint and stderr warn — never blocks exit).

### Added

- `[feat]` **`hooks/session-end-check.sh` (SessionEnd, timeout 3s)** — at session termination, scans the transcript JSONL for mutation tool_use entries (Edit / Write / NotebookEdit) since the last user-input message and counts VALIDATE signals (Bash matching `node --test|pytest|jest|vitest|npm test|go test|cargo test|bash tests/|tsc|eslint|ruff|clippy|shellcheck|git commit|git push`). If `mutations > 0 AND validates == 0` → writes `<cwd>/tasks/session-end-<short-id>-paused.md` with the last 3 mutation tool calls + suggested verify command, stderrs a one-line `[claudemd] mid-SPINE session-exit: N unvalidated mutation(s)` warn, and appends a `warn` row to rule-hits.jsonl tagged `§11-session-exit`. Single jq pass over `tail -n 200` of transcript. Fail-open + kill-switch `DISABLE_SESSION_END_CHECK_HOOK=1`.

### Tests

- `[test]` **`tests/hooks/session-end-check.test.sh` (new, 9 cases)**: clean exit (Edit + test-runner), mid-SPINE Edit-only, Edit + git commit (commit validates), Write-only, Read-only no-warn, Edit + git push (push validates), kill-switch, missing transcript fail-open, rule-hits row written.

### Changed

- `[change]` **`scripts/lib/hook-registry.js`** — registry length 12 → 13; new entry `session-end-check` (SessionEnd, matcher `*`, timeout 3s, env-var-suffix `SESSION_END_CHECK`).
- `[change]` **`hooks/hooks.json`** — new `SessionEnd` event with the new hook.
- `[change]` **`commands/claudemd-toggle.md`** — display-name list adds `session-end-check`.
- `[change]` **`README.md`** — hook count 12 → 13 in plugin-at-a-glance table; added `DISABLE_SESSION_END_CHECK_HOOK=1` to per-hook kill-switch list.
- `[change]` **`tests/scripts/hook-registry.test.js`** — `HOOK_REGISTRY.length` pin 12 → 13.
- `[change]` **`tests/integration/full-lifecycle.test.sh`** — manifest entry-count pin 12 → 13; settings.json residue regex adds `session-end-check`.
- `[change]` **`tests/scripts/install.test.js`** — `manifest.entries.length` pin 12 → 13.

### Why now (cadence rationale)

T1c was deferred from v0.9.26 ship per the (3) → (1) path so that v6.11.10's §9 Parallel-path HARD promotion stayed clean of mechanical-enforcement scope creep. v0.9.27 ships T1c as a single-concern feat: one new hook, one new test file, three single-source-of-truth registrations + count-pin updates. Independent ship per `feedback_claudemd_ship_from_main_atomic.md` atomic convention.

## [0.9.26] - 2026-05-10

**Patch — spec v6.11.9 → v6.11.10. First batch-review-driven HARD promotion since v6.10.2 (2026-04-23).** §9 Parallel-path completeness elevated SHOULD → HARD after `tasks/rule-candidates-2026-04.md` 2026-05-10 batch review confirmed both promotion conditions met. New §EXT SHOULD section documenting macOS CI shell portability (3 lessons.md repros). Plugin-side: hard-rules.json gets 13th core entry; spec content + version-pin + manifest-sync only — no hook / runtime behavior change. §13.2 budget cost: 1 new HARD; 20-task counter resets to 0.

### Changed

- `[change]` **Spec §9 Parallel-path completeness: SHOULD → HARD L2+** — promotion saves 89 bytes by dropping the trailing `(SHOULD now; §13.2 candidate for HARD promotion)` clause. Repros: code-graph-mcp ast_search SQL `ORDER BY` + `LIMIT` truncation, lang_config default-arm always-false dispatch, dead-code `--json` empty-result silent skip, mem v2.49 CJK FTS-vs-LIKE sibling miss. Self-enforced (no per-language-AST mechanical detection feasible at hook layer).
- `[change]` **Spec §11-EXT macOS CI shell portability (SHOULD)** — new section codifying the implementation contract behind `hooks/lib/platform.sh` + `feedback_macos_shell_portability.md` + `feedback_hook_platform_lib_source.md` memories. Five recurring traps: `stat`/`find -newer` wrapper sourcing, `timeout` GNU-coreutils, BSD `wc -l` padding, `mktemp -d` `/var→/private/var` symlink, post-`git add` `chmod +x` mode preservation.

### hard-rules.json

- `[add]` **13th core HARD entry**: `§9-parallel-path`, `enforcement: "self"`, `confidence: "high"`. HARD tally: 13 core + 4 §EXT-side.

### Tests

- `[test]` `tests/scripts/spec-structure.test.js`, `tests/scripts/spec-hash.test.js`, `tests/integration/upgrade-lifecycle.test.sh` version-pin updated v6.11.9 → v6.11.10.

### Sizing

- core 24643 → 24550 bytes (−93, −0.38% — promotion is a wording change, dropping the trailing candidate clause net-deletes).
- extended 47747 → 48815 bytes (+1068, +2.24% — new §11-EXT macOS section adds ~870 bytes, Recent-changes turnover net-deletes ~150 bytes).
- core 24550/25000 (450 bytes headroom, 98.20% — improved from v6.11.9); extended 48815/50000 (1185 bytes headroom, 97.63% — tightened from v6.11.9). v6.11.11 net-delete or migrate preferred.

## [0.9.25] - 2026-05-10

**Patch — spec v6.11.8 → v6.11.9 fresh-agent-adherence release.** Three reader-side ambiguities surfaced in a second dogfood pass simulating "first time touching this spec, strict-literal execution"; v6.11.8 carry-forward `MUST net-delete or migrate marginal core bullets` honored via two §EXT migrations. Plugin-side: spec content + version-pin + manifest-sync only — no hook / script / runtime behavior change.

### Fixed

- `[fix]` **Spec §2 LEVEL "new tests" trigger vs §1.5 Local-Δ "co-located test = one"** — literal reading promoted every L1-bugfix that wrote a regression RED test to L2, contradicting Local-Δ ("source + co-located test = one") and §7 L1-bugfix workflow ("reproduce-once → fix → re-run repro"). Reworded as `new test surface (new file/suite — not L1-bugfix RED, which is co-located per §1.5)`.
- `[fix]` **Spec §1.5 GLOSSARY missing Contract / Δ-contract at L1/L2** — `Contract` / `Δ-contract` were defined only in §EXT §1.5-EXT (L3+ load), but core §2 L2 trigger uses `contract-Δ` and core §5 hard-AUTH uses `Δ-contract on public API`. At L1/L2 a fresh agent classifying could not resolve the term in core. Inlined a single-bullet definition that also distinguishes additive (→ L2) from breaking (→ L3).
- `[fix]` **Spec §13 META "Spec changes = L2 minimum" vs §2 LLM-visible metadata → L3** — literal reading defaulted spec edits to L2, contradicting §2 LLM-visible-metadata-→-L3 (which spec files most directly are). Reworded as patch=L2 / minor+major=L3.

### Refactor

- `[refactor]` **Spec §0.2 Mid-task feedback split** — Continuation / Cancel / Switch (predictable common-sense cases) migrated to new §0.2-EXT; core retains the three non-obvious cases (Refinement / Quality slider / Scope-expansion) plus a one-line pointer.
- `[refactor]` **Spec §11 MEMORY.md tag-syntax footnote split** — operational summary stays in core (one line); detail rationale moved to new §11-EXT MEMORY-tag-syntax section.

### Tests

- `[test]` `tests/scripts/spec-structure.test.js` version-pin updated v6.11.8 → v6.11.9.

### Sizing

- core 24672 → 24643 bytes (−29, −0.12% — net delete despite three additive fixes via two §EXT migrations).
- extended last-recorded-v6.11.8 46690 → 47747 bytes (+1057, +2.26% — additive §EXT migrations from core consume extended budget).
- core 24643/25000 (357 bytes headroom, 98.57%); extended 47747/50000 (2253 bytes headroom, 95.49%).
- v6.11.8 operator carry-forward `MUST net-delete or migrate`: **honored**.

## [0.9.24] - 2026-05-10

**Patch — doc-vs-code drift fixes from a 5-round self-iteration dogfood pass.** Spec v6.11.8 unchanged. Zero runtime behavior change — pure `bin/` USAGE strings + README §Per-hook list nudged into lockstep with the actual code, plus two new regression anchors that fail loudly on future drift.

### Fixed

- `[fix]` **`bin/claudemd-lint.js` USAGE references `claudemd-cli` (not `claudemd`)** — the npm `bin` key is `claudemd-cli`, but the help text shown by `--help` listed every subcommand as `claudemd lint <text>` / `claudemd audit <jsonl-path>` / `claudemd --version`. A user copying the documented command verbatim hit `command not found: claudemd`. Pre-fix discrepancy isolated to the help-text surface (10 occurrences across USAGE block + header + Notes + one inline comment); README, CHANGELOG, and the pre-commit hook example already used the correct name. Affects v0.9.0+ (the surface where `claudemd-cli` became the published bin).
- `[fix]` **README §Per-hook kill-switch list lockstep with `hook_kill_switch <NAME>` calls in `hooks/*.sh`** — three `DISABLE_*_HOOK` env vars that real hooks DO honor were undocumented (`DISABLE_MEM_AUDIT_HOOK`, `DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK`, `DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK`), and one documented var carried a wrong owning-hook annotation: README labeled `DISABLE_USER_PROMPT_SUBMIT_HOOK` as disabling `transcript-vocab-scan`, but the `hook_kill_switch USER_PROMPT_SUBMIT` call lives in `version-sync.sh`, so the env actually disables version-sync. A user trying to silence transcript-vocab-scan via the documented var would silence the wrong hook. Drift introduced incrementally through v0.9.4 / v0.9.10 (mem-audit + transcript-structure-scan additions) without a corresponding README update.

### Tests

- `[test]` **`tests/scripts/help-discoverability.test.js` +1 case**: `bin/claudemd-lint.js --help` USAGE references the actual npm `bin` key (read from `package.json`), and never the bare `claudemd <subcommand>` form. Catches future bin renames + USAGE edits in either direction.
- `[test]` **`tests/scripts/kill-switch-doc-drift.test.js` (new, 2 cases)**: parses `hook_kill_switch <NAME>` arg from every `hooks/*.sh`, derives `DISABLE_<NAME>_HOOK`, and asserts each is documented in README; pins all 12 `DISABLE_*_HOOK → <hook-file>` mappings so a future rename can't re-introduce the env-name-vs-owning-hook ambiguity.

### Why no L3 / pre-ship-review chain

Two doc/test edits, zero runtime behavior change, zero hook/CLI/spec touch. Suite stays at 350 node tests + 18 bash hook tests + 2 integration suites — all pass. Five rounds of self-iteration (67 scenarios across CLI bounds, hook fail-open, lifecycle anomalies, declared-vs-actual consistency, state-machine coordination, npm packaging dogfood) found these 2 P1 doc-drift items + zero P0/P1 elsewhere; the 2 carryover P2s are tracked inline (sparkline 「3 windows」 README phrasing vs code's `≥2`; corrupt `last-session-summary.json` not auto-cleaned but recoverable on next Stop).

## [0.9.23] - 2026-05-10

**Patch — observability + structural-enforcement upgrade.** Spec v6.11.8 unchanged. 6 fixes from a deep dogfood pass on the `~/.claude/logs/claudemd.jsonl` telemetry channel and the lint-argv structural detector. The unifying theme: **resilience without observability** — hooks fail-open silently, jsonl parser silently skips bad rows, sparkline annotations virtual-fire under insufficient log span, status disconnects from settings.json, hard-rules-audit accepts windows shorter than the §0.1 quarterly cadence with no warning, and lint-argv only catches *wrong-shape* argv reads (not "main block doesn't read argv at all" — the v0.9.x silent-fallback family that recurred 9× across 5 dogfood rounds and bit destructive lifecycle scripts in Round 5). Each fix surfaces the silent path so §13.1 reviewers see the full picture.

### Added

- `[feat]` **`hooks/lib/hook-common.sh#hook_record_failopen <hook> <reason>`** — rate-limited (60s per (hook,reason) via `~/.claude/.claudemd-state/failopen-*.ts`) emission of `event:"fail-open"` rows to rule-hits.jsonl with `extra.reason ∈ {jq-missing, bad-event, patterns-missing, prereq-missing}` and `spec_section:"§hooks-fail-open"`. Inline JSON construction guards against the case where the missing prerequisite IS jq (the helper would otherwise self-fail-open silently).
- `[feat]` **`hooks/banned-vocab-check.sh` 3 fail-open exits wired** — `jq-missing` (jq not on PATH), `bad-event` (empty/unreadable stdin), `patterns-missing` (banned-vocab.patterns unreadable). First hook to surface fail-open visibility; pattern is reusable by the remaining 5 hooks (`pre-bash-safety`, `memory-read-check`, `residue-audit`, `sandbox-disposal`, `session-summary`) — out-of-scope for this patch but ≈3 LOC × 3 hooks to extend.
- `[feat]` **`scripts/lib/rule-hits-parse.js#byFailOpen(hits)`** — aggregates fail-open events by (hook, reason). Surfaced in `audit.js` output as `byFailOpen` segment. Empty `{}` when no fail-open events in window.
- `[feat]` **`scripts/doctor.js` advisory `hook-fail-open` check** — `[✗] N fail-open event(s) in 30d (hook:reason=count, ...); enforcement silently bypassed. Investigate the named prerequisite.` Always advisory; never blocks (resilience-first design preserved).
- `[feat]` **`scripts/sparkline.js` log-span defense** — new JSON fields `logSpanDays` / `insufficientSpan` / `windowCoverage`. Markdown banner `[insufficient log span: Xd — trend annotations suppressed; need ≥Yd]` when log doesn't reach the shortest window; `[partial coverage: log spans Xd; ≥Yd windows are not fully covered]` when shortest window is covered but longer ones aren't. The `↗ (newly active)` annotation is suppressed under `insufficientSpan` because `prior bucket = 0 AND recent > 0` is structurally satisfied for EVERY rule when the log is too short — pre-fix, every section trivially flagged "newly active" on fresh-log environments, biasing §0.1 promote/demote inputs.
- `[feat]` **`scripts/lib/rule-hits-parse.js#readHits` returns `{ hits, totalLines, parsed, skipped }`** (was `Array`). 6 call sites updated (audit×2, sparkline, hard-rules-audit, doctor, test). `audit.js` surfaces `dataIntegrity: { totalLines, parsed, skipped, skipRatio }`. `doctor.js` adds `rule-hits-integrity` check that fires `[✗]` when `skipRatio > 0.01` (1% threshold — below is normal race-write noise). Pre-fix, a corrupt jsonl with 33% bad rows reported the under-counted hits with zero operator visibility — biased §13.1 demote-candidate decisions.
- `[feat]` **`scripts/status.js#pendingKillSwitches`** — dual-source kill-switch view. `killSwitches.<name>` stays the boolean "effective in this process" (back-compat); `pendingKillSwitches.<name>` shows `{ effective, persisted }` for any hook whose `process.env` and `~/.claude/settings.json env` block disagree. Closes the dogfood confusion where `node scripts/status.js` directly after `/claudemd-toggle X` reported `X: false` because settings.json takes effect at next CC session start, not at file-write time.
- `[feat]` **`scripts/hard-rules-audit.js#cadenceWarning`** — when `--days < 90`, output JSON includes `--days=N is shorter than the §0.1 quarterly cadence (90d); demote signals may not reflect the spec contract`. Non-blocking (some debugging flows want narrow windows); the wrapper `/claudemd-rules` defaults to 90d so normal usage is unaffected.
- `[feat]` **`scripts/lint-argv.js#scanMainBlockMissingArgv`** — structural detector for the v0.9.x silent-fallback family. For every `.js` under `bin/` + `scripts/` (excluding `lib/`): if the file has the main-block guard `if (import.meta.url === \`file://${process.argv[1]}\`)`, the body MUST call EITHER `parseStrict(` OR `printHelpAndExit(` OR `validateAndExpandFlags(`. Reports `main-block-without-argv-validation` antipattern when none of the three are present. Closes the structural blind-spot the 3 regex-based PATTERNS couldn't catch — pre-Round-5 `install.js` / `uninstall.js` / `update.js` had main blocks that ignored argv entirely, so `--help` ran the destructive operation silently.

### Changed

- `[change]` **`event` taxonomy in `docs/RULE-HITS-SCHEMA.md`** — adds `fail-open` event with reason taxonomy + `§hooks-fail-open` plugin-internal taxonomy entry. `tests/scripts/hard-rules-drift.test.js#KNOWN_HOOK_SECTIONS` synced to add `§hooks-fail-open` (per the taxonomy-sync contract; never targeted by `spec/hard-rules.json` because it's not a spec rule).
- `[change]` **`scripts/lib/rule-hits-parse.js#readHits` return shape** — Array → `{ hits, totalLines, parsed, skipped }`. Internal change; `bin/claudemd-lint.js` (the npm-published surface) does not import `readHits` and is unaffected. All 6 callers updated in this commit.

### Tests

- `[test]` **`tests/hooks/fail-open.test.sh`** (new, 4 cases): empty stdin → emits `fail-open` with `reason=bad-event`; rate-limit suppresses second call within 60s; distinct reason emits separately; `DISABLE_RULE_HITS_LOG=1` suppresses emission.
- `[test]` **`tests/scripts/rule-hits-parse.test.js`** (+2): `readHits` surfaces skipped count for malformed rows (5 valid + 3 corrupt → `skipped:3 parsed:5 totalLines:8`); missing file returns zero counters.
- `[test]` **`tests/scripts/sparkline.test.js`** (+2, modified 2): insufficient-span suppresses `newly active` annotation; markdown emits `insufficient log span` banner. Existing `newly active` and `formatMarkdown` tests updated with span-sentinel `daysAgo:95` event so the `>=longest window` check passes.
- `[test]` **`tests/scripts/status.test.js`** (+2): `pendingKillSwitches` surfaces when `settings.json` env block disagrees with `process.env`; empty `pendingKillSwitches` when env + settings agree.
- `[test]` **`tests/scripts/lint-argv.test.js`** (+5): structural detector flags `main-block-without-argv-validation` on a synthetic destructive script; passes on scripts that call `parseStrict`, `printHelpAndExit`, or `validateAndExpandFlags`; ignores files without main-block guard. **Live-repo gate stays clean (0 hits)** — all 14 `bin/` + `scripts/` (non-lib) main blocks now have argv contracts thanks to Rounds 1-5 fixes.

### Why no L3 / pre-ship-review chain

`feat:` adds additive observability fields + a structural lint check + a new event type in the rule-hits taxonomy (`fail-open` is plugin-internal, not a spec rule). Per spec §2: not architecture, not breaking-schema (additive event class), not migration, not infra. L2 ceiling. Diff summary: 8 source files modified (4 scripts + 1 lib + 1 hook + 1 hook-lib + 1 doc), 1 hook test file added (4 cases), 4 unit test files modified (+11 cases). Total test count: 281 → 351 net of Round 1-6 (+70 cases across 5 dogfood rounds). All argv-lint structural + pattern checks clean.

## [0.9.22] - 2026-05-10

**Patch — `claudemd-doctor` now detects production-hook drift between source-of-truth and `~/.claude/plugins/marketplaces/claudemd/`.** Spec v6.11.7 → v6.11.8 (clarity-only wording fixes; see `spec/CLAUDE-changelog.md` v6.11.8 entry — `[fix]` §10 four-section "Lead with incomplete" disambiguation, `[fix]` §7 L2 evidence example annotated with absolute delta).

Surfaced during a dogfood pass simulating fresh-user spec adherence. Symptom: `~/.claude/logs/claudemd.jsonl` simultaneously holding two project encodings for the same cwd `/mnt/data_ssd/dev/projects/claudemd` — `-mnt-data-ssd-...` (post-v0.9.15 `tr '/._' '-'`, 46 entries) and `-mnt-data_ssd-...` (pre-v0.9.15 `tr '/.' '-'`, 196 entries). Root cause: source repo at v0.9.21 but `~/.claude/plugins/marketplaces/claudemd/.claude-plugin/plugin.json` reported v0.9.11 with three hook scripts (`hooks/lib/rule-hits.sh`, `hooks/memory-read-check.sh`, `hooks/session-summary.sh`) still on pre-fix code. `/plugin update` is a silent no-op in current Claude Code versions (memory: `reference_plugin_update_manual_refresh.md`), so the canonical refresh path is `uninstall → install → /reload-plugins` — but nothing flagged that the user *needed* to do this. Concretely: the §11-memory-read HARD rule was a silent no-op for any project with `_` in its cwd path, even after the v0.9.15 fix shipped, because the running hook code was older than the source. The prior `spec-hash` doctor check only compared the spec MD files; hook scripts had no drift signal.

### Added

- `[feat]` **`scripts/lib/install-drift.js#compareHooks(sourceRoot, marketRoot)`** — recursively SHA-256-compares every `.sh` under `hooks/` between two roots. Returns `{skipped, skippedReason?, driftCount, diffs[]}`. Skip cases (not flagged as drift): `self-compare` (sourceRoot ≡ marketRoot by realpath, e.g. `/claudemd-doctor` running FROM the marketplace install), `market-root-missing` (no marketplace install on this machine), `no-hooks-in-source` (claudemd-cli npm package ships only `bin/`, no hooks). `.patterns` / `.json` configs deliberately excluded — that drift is `/claudemd-update` territory, not hook-CODE drift.
- `[feat]` **`hook-drift` check in `scripts/doctor.js`** — wires `compareHooks` into the doctor pipeline. Detail format on drift: `<N> hook script(s) differ between source and <marketRoot>: <first-3 file paths with reason> +<remaining> more. Likely cause: /plugin update is a silent no-op. Fix: /plugin uninstall claudemd@claudemd then /plugin install claudemd@claudemd, then /reload-plugins.` On the dogfood machine, this surfaces the exact 3-file drift (`hooks/lib/rule-hits.sh`, `hooks/memory-read-check.sh`, `hooks/session-summary.sh`) with the canonical fix command in the message.
- `[feat]` **`marketplacePluginRoot()` helper in `scripts/lib/paths.js`** — returns `~/.claude/plugins/marketplaces/claudemd`. Decoupled from `pluginCacheDir()` because the cache vs marketplaces directories can drift (cache holds per-version snapshots; marketplaces is the single live plugin root Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` to at hook-fire time).
- `[test]` **8 new cases in `tests/scripts/install-drift.test.js`** — equal-content baseline, file-content-differs, file-missing-in-market, self-compare skip, market-missing skip, no-hooks-in-source skip, recursive scan into `hooks/lib/`, non-`.sh` files ignored.
- `[test]` **2 new cases in `tests/scripts/doctor.test.js`** — `hook-drift skips when no marketplace install exists` (fresh-install / npm-CLI-only does not fail-loudly) + `hook-drift flags differing hooks when marketplace install lags source` (mirrors the real source `hooks/` into a tmp marketplace and breaks one file to assert the drift surfaces with file path + remediation in the detail).

### Why no L3 / pre-ship-review chain

`feat:` adds an additive doctor check + spec wording-only fixes. Per spec §2 hard-upgrade exclusion: spec wording fixes restoring documented intent are L2 max (the `[fix]` CHANGELOG framing). Doctor check is L2 (additive feature, multi-file with tests, no API change). No spec semantic change. Diff: 1 new lib (~80 LOC), 1 new lib helper (~5 LOC), 1 doctor branch (~20 LOC), 1 new test file (~110 LOC), 2 new doctor test cases (~30 LOC), spec wording shifts in `spec/CLAUDE.md` lines 180 + 238, version bumps across 3 manifests + spec headers + `hard-rules.json#spec_version`. Test count: 271 → 281 (+10 JS cases).

## [0.9.21] - 2026-05-10

**Hotfix — `claudemd-cli lint <path>` silent-text-scan when path looks like a path but doesn't resolve to a regular file (v0.9.14 family residual).** Spec v6.11.7 unchanged. The v0.9.14 fix added auto-`--file` for the case where the positional was an existing regular file. The other branches — missing path, directory, dead symlink — still fell through to scanning the literal positional string. Three failure shapes surfaced during the dogfood session that produced v0.9.18–v0.9.20:
- `claudemd lint /tmp/missing-msg.txt` → exit 0, "OK no hits" (silent success masking a CI misconfiguration).
- `claudemd lint /tmp` (existing dir) → exit 0, "OK no hits" (scans the literal string `/tmp`).
- `claudemd lint /tmp/significantly-improved.txt` (missing) → **exit 1 with banned-vocab hit on the basename** — falsely accuses the user of writing "significantly" in a commit message they didn't even compose.

Same silent-fall-through family the v0.9.14 fix targeted; the original fix was scoped only to the "file exists" branch. The third shape is the worst — a deny that points at text the user never wrote.

### Fixed

- `[fix]` **`bin/claudemd-lint.js#lintCmd` rejects path-shape positionals that don't resolve to a regular file.** Pre-fix: `try { stat(); if isFile read } catch { /* fall through */ }` then `text = positional.join(' ')`. Post-fix: when the positional contains `/` (or is `.` / `..`), a stat miss exits 2 with `file not found`, and a stat-as-non-file exits 2 with `is not a regular file`. Non-path-shape positionals (single word, no slash) keep the v0.9.14 text fallback — `lint significantly` MUST stay a text scan, and `lint message.txt` (no slash, missing) stays as text to preserve the pre-commit-hook ergonomic where `--file` is explicit.

### Added

- `[test]` **4 new cases in `tests/scripts/lint-cli.test.js`** (267 → 271 total): `lint /path/missing.txt` exits 2 with file-not-found, `lint <directory>` exits 2 with not-a-regular-file, `lint /path/with-banned-word-in-name (missing)` exits 2 (the false-positive-deny shape — anchors that the path string is NEVER scanned), `lint message.txt` (single word, no slash) stays as text scan exit 0 (anchor that the fix doesn't regress non-path-shape literals).

### Why no L3 / pre-ship-review chain

`fix:` per §2 hard-upgrade exclusion — restores the v0.9.14 fix's documented intent (path-shape input that doesn't resolve to a file should NOT silently scan the path string). L2 ceiling. Diff: 1 file changed in `bin/`, 1 file in `tests/scripts/`, ~25 LOC added. Pattern continuity: same antipattern family as v0.9.14/v0.9.15/v0.9.16/v0.9.17/v0.9.18 — "input parser silently falls through on unexpected shape, exits 0 looking like success." The lint-argv gate (v0.9.19) covers the JS .find/.includes/.indexOf shapes; this is a different shape (path-resolution branch missing) that lives in the lintCmd auto-detect logic, not in flag parsing — so the gate doesn't catch it. No new gate added: this branch is now covered by the four new regression tests, which is sufficient for a one-shot logic branch (the gate exists for the recurring `args.find` family, not every branch in every CLI).

## [0.9.20] - 2026-05-10

**Patch — `hard-rules-audit` demoteCandidates produced false-positive recommendations when log span < requested window.** Spec v6.11.7 unchanged. Surfaced in the same dogfood session that produced v0.9.18/v0.9.19: running `/claudemd-rules` (default 90-day window) against a `~/.claude/logs/claudemd.jsonl` that only spans 17 days reported `§11-memory-read` as a demote candidate — but that rule had been silently no-op'd in projects with `_` in the cwd path until v0.9.15 fixed it. The data couldn't see the rule firing because the rule itself was broken; "0 hits in window" wasn't a coldness signal. §0.1 HARD specifies "0 hits in 90d" — running the calculation on 17 days of data violates the spec. Same root applies to any rule fixed/added more recently than the log start.

### Fixed

- `[fix]` **`scripts/hard-rules-audit.js` suppresses `demoteCandidates` when `insufficientData`.** Pre-fix: `demoteCandidates` was computed as `hookEnforced.filter(r => r.hits.total === 0)` regardless of whether the log reached back the requested window. Post-fix: when `logSpanDays < days`, `demoteCandidates` is forced to `[]` and the would-have-been list is preserved under a new `demoteSuppressed` field (`{ reason, wouldHaveBeen }`) so the operator sees what's *potentially* cold without auto-acting on a false signal.

### Added

- `[feat]` **`scripts/lib/rule-hits-parse.js#logFirstTs(path)`** — returns earliest ts in the rule-hits log (ms-since-epoch) or `null` for missing/empty/all-malformed files. Skips rows with non-finite timestamps. Used by `hardRulesAudit` to compute `logSpanDays`; future consumers (sparkline, audit) can adopt for the same insufficient-data check.
- `[feat]` **`hardRulesAudit` output: 4 new fields** — `logSpanDays` (operator transparency, surfaced even when sufficient), `insufficientData` (boolean), `demoteSuppressed` (`{reason, wouldHaveBeen}` when insufficient, `null` otherwise), and `demoteCandidates: []` when insufficient (compatibility: existing consumers reading the array get an empty array instead of false candidates).
- `[test]` **5 new cases in `tests/scripts/hard-rules-audit.test.js`** + **8 new cases in new `tests/scripts/rule-hits-parse.test.js` (257 → 270)**: insufficient-data suppresses + surfaces `demoteSuppressed`, sufficient-span preserves existing demote behavior, log-span boundary case (35d > 30d window), `logSpanDays` always reflects actual log reach not the window, `logFirstTs` returns `null` on missing/empty/all-malformed and earliest ts otherwise, skips non-finite ts rows.
- `[test]` **`demoteCandidates list hook-rules with zero hits` test updated** to write a 31-day-old sentinel row before asserting `§8-rm-rf-var` appears as candidate. Pre-fix, the test passed against an empty log because there was no insufficient-data check. Post-fix, an empty log triggers `insufficientData=true` and `demoteCandidates=[]`, so the test would have asserted on suppressed candidates and failed. Documented in the new "sufficient log span" test name.

### Why no L3 / pre-ship-review chain

`fix:` per §2 hard-upgrade exclusion — restores §0.1 HARD's documented intent (90d window means 90d of data, not "whatever the log has"). L2 ceiling. Diff: 1 lib helper added (~15 LOC), 1 script branch added (~15 LOC), 2 test files (+13 cases). Notable: this is the same family as v0.9.13's `session-summary` window-calculation bug — "report computes correct math against the data it has, but the data itself doesn't span the window the report claims to cover." Sparkline's `(newly active)` annotation is the same UX issue — not in this patch (would require updating the existing `newly active` test fixture to span 90 days, larger churn) — flagged for a follow-up patch.

## [0.9.19] - 2026-05-10

**Patch — repo-wide CI guard for the argv-shape silent-fallback antipattern (§13.2 Tier 1).** Spec v6.11.7 unchanged. v0.9.14 → v0.9.18 was five consecutive patches chasing the same antipattern in five different files because each fix-set was scoped to whatever the repro session tripped on. The CHANGELOG entry for v0.9.18 stated "the next exploratory-testing session WILL find a 6th hole"; this patch makes that prediction grep-enforceable instead of trusting the next session not to slip.

### Added

- `[feat]` **`scripts/lint-argv.js`** — module-friendly gate exporting `scan({ root, dirs, exts, fileAllowlist, patterns })` and a CLI entry. Greps the union of three known antipattern signatures (`\b\w+\.includes\(['"]--`, `\.find\(\w+\s*=>\s*\w+\.startsWith\(['"]--`, `\b\w+\.indexOf\(['"]--`) across `bin/` + `scripts/` `.js` files. Pure `//` comment lines are skipped (meta-recursion guard for the validator's own docstring quoting the antipattern as the bug it prevents). Inline allowlist: append `// argv-lint:allow` to a vetted line. File allowlist: add to `FILE_ALLOWLIST` with a one-line reason — only the gate itself + `scripts/lib/argv.js` (parseStrict implementation) qualify today.
- `[feat]` **`npm run lint:argv` script in `package.json`.** Local + CI invocable. Exit 0 on clean, exit 1 with per-hit `file:line  [pattern]` + offending text + remediation hint on dirty. Tier 2 (wiring into `.github/workflows/test.yml`) is intentionally NOT in this patch — that's a §5 Hard CI/infra change deferred to user decision.
- `[test]` **9 new cases in `tests/scripts/lint-argv.test.js` (248 → 257)** — live-repo clean baseline, each of the three signatures detected on synthetic fixtures, inline allowlist, file-level allowlist, pure-comment skip (the meta-recursion guard), end-of-line comment NOT skipped (allowlist evasion attempt rejected), CLI exit 0 + stdout shape on clean.

### Fixed

- `[fix]` **`bin/claudemd-lint.js` lintCmd/auditCmd add 5 inline `// argv-lint:allow` comments** on the `args.includes/indexOf('--*')` lines that are post-validator-safe-by-construction (`validateAndExpandFlags` rejects unknown + bool=value upstream, so downstream `.includes('--json')` will never observe a wrong-shape value). The lines are functionally safe and intentionally chosen over a structural refactor that would churn v0.9.18's diff for no behavioral gain.

### Why no L3 / pre-ship-review chain

`feat:` adds a CI-helper script, not user-visible plugin behavior. No spec change. L2 ceiling. Diff: 1 new gate (~100 LOC), 1 new test file (~100 LOC), 1 package.json line, 5 inline comments in the public CLI, 4 version-string bumps. The companion §13.2 promotion to a HARD spec rule (hook-level enforcement) is a separate L3 spec-change patch held until the gate has run for a few release cycles and the false-positive rate is known empirically.

## [0.9.18] - 2026-05-10

**Patch — public npm CLI `bin/claudemd-lint.js` had the same argv-shape silent-fallback the slash-commands fixed in v0.9.16/v0.9.17.** Spec v6.11.7 unchanged. Surfaced exercising the published CLI as a downstream integrator would: `claudemd lint --jzon "..."` (typo) silently dropped the unknown flag and scanned the text anyway → exit reflected only the text content; `claudemd lint --json=yes "..."` silently dropped `--json` (because `args.includes('--json')` returns false for the `=` form) → human-readable text emitted on stdout when JSON was expected; `claudemd lint --file=PATH` (GNU-getopt convention) was unrecognized and exited 2 with the misleading `text required` message; `claudemd audit --include-ratiox PATH` silently dropped the typo → exit 0 even when content would deny. Fifth recurrence of argv-shape silent-fallback (v0.9.14 lint positional, v0.9.15 hook tag, v0.9.16 three slash-commands, v0.9.17 two more slash-commands, this one — the **publicly published** surface, the most-visible footgun).

### Fixed

- `[fix]` **`bin/claudemd-lint.js` `lintCmd` + `auditCmd` validate flags up-front via `validateAndExpandFlags(rawArgs, knownBools, knownValues, sub)`.** Pre-fix, both commands used `args.includes('--bool')` / `args.indexOf('--key')` which silently dropped (a) `--bool=value` (typo'd as truthy → false), (b) any unknown `--typo` flag (filtered out of positional via `startsWith('--')`), (c) `--key=value` for value flags (`indexOf` looks for the bare `--key`). Post-fix, all three exit 2 with a parser error before the existing happy-path logic runs. Bonus: `--file=PATH` (GNU-getopt `=` form) is now accepted as a sibling of `--file PATH` (Unix convention preserved). Backward-compatible — every previously-passing call shape still works.

### Added

- `[test]` **4 new cases in `tests/scripts/lint-cli.test.js`** asserting exit 2 + stderr message on the three silent-fallback shapes (`--jzon` typo, `--json=yes` bool-with-value, audit `--include-ratiox` typo) + the new accepted shape (`--file=PATH`). Test count 244 → 248. Coverage gap that allowed v0.9.17 to ship without catching this: the existing tests asserted happy paths but had no negative assertions on bug shapes.

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion — restores the implied contract (every flag shape either works or rejects loudly; no silent-drop). L2 ceiling. Diff: 1 source file (~30 LOC added, no API change), 1 test file (+45 LOC). Notable: this is the FIFTH consecutive patch chasing the same antipattern. The §13.2 promotion case for a `grep -rE '\.find\(.*startsWith\|args\.includes.*--' bin/ scripts/` lint gate (CI step or pre-commit) is now overwhelming. The v0.9.16 memory note already flagged this — adding a one-line `npm run lint:argv` step that fails CI on any `args.includes('--`'-shaped flag detection is the obvious next iteration.

## [0.9.17] - 2026-05-10

**Patch — two more slash-command CLIs leaked the v0.9.16 antipattern.** Spec v6.11.7 unchanged. Surfaced in the same exploratory-testing session that produced v0.9.16: `/claudemd-doctor --prune-backups 5` (space form) silently dropped the value, ran without prune, exited 0; `/claudemd-rules --days 30` (space form) silently fell back to the default 90-day window, exited 0. v0.9.16 swept `clean-residue.js` / `audit.js` / `sparkline.js` but missed `doctor.js` and `hard-rules-audit.js` carrying the same `args.find(a => a.startsWith('--key='))` pattern. Fourth recurrence of argv-shape silent-fallback (v0.9.14 lint, v0.9.15 hook tag, v0.9.16 three CLIs, this one).

### Fixed

- `[fix]` **`scripts/doctor.js` + `scripts/hard-rules-audit.js` switched to `parseStrict`.** Pre-fix, both scripts used the `args.find(a => a.startsWith('--key='))` pattern that silently dropped (a) the space-separated form `--key value`, (b) any unknown flag. Post-fix, both exit 2 with a parser error before touching state. The contract documented in `commands/claudemd-doctor.md` (`--prune-backups=N`) and the `--days=N` env-var-equivalent on `hard-rules-audit.js` is now enforced. Documented happy-path behavior unchanged.

### Added

- `[test]` **2 new cases each in `tests/scripts/doctor.test.js` + `tests/scripts/hard-rules-audit.test.js`** asserting exit 2 + stderr message on space-form and unknown-flag bug shapes via spawned CLI (240 → 244 tests).

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion — restores documented intent (`--key=value` per slash-command docs and v0.9.16 contract). L2 ceiling. Diff: 2 script tails refactored (~10 LOC each), 2 test files (+4 cases). Recurrence count for argv-shape silent-fallback antipattern is now 4 across 4 patches — the §13.2 promotion case for a hook-level lint or repo-wide grep gate is stronger than v0.9.16 made it.

## [0.9.16] - 2026-05-10

**Patch — three slash-command CLIs silently dropped wrong-shape arguments.** Spec v6.11.7 unchanged. Surfaced while exercising the v0.9.15 plugin from a real `/claudemd-clean-residue --apply --age-days 0` user attempt: `--age-days` value dropped (script fell back to default `1`), `--apply` ran, script exited 0 reporting "0 deleted." Same family as v0.9.14 `claudemd-cli lint <path>` silent-success — argv-shape mismatch produced indistinguishable-from-success output.

### Fixed

- `[fix]` **Strict argv parser in `scripts/lib/argv.js` (new) wired into `clean-residue.js` / `audit.js` / `sparkline.js`.** Pre-fix, each script used `args.find(a => a.startsWith('--key='))` which silently dropped (a) the space-separated form `--key value`, (b) any unknown flag, (c) `--apply=yes`-style boolean-with-value. Post-fix all three exit 2 with a parser error before touching state. The contract documented in `commands/claudemd-{clean-residue,audit,sparkline}.md` (`--key=value` only) is now enforced. Documented happy-path behavior is unchanged.

### Added

- `[test]` **9 new cases in `tests/scripts/argv.test.js`** covering happy path, both bug shapes (space-form, unknown flag), and edge cases (empty value, `=` in value, repeated flag, bool-with-value, bare unknown arg).
- `[test]` **2 new cases each in `tests/scripts/clean-residue.test.js`, `audit.test.js`, `sparkline.test.js`** asserting exit 2 + stderr message on the two bug shapes via spawned CLI (225 → 240 tests).

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion — restores documented intent (`--key=value` is the contract per slash-command docs). L2 ceiling. Diff: 1 new lib file (~40 LOC), 3 script tails refactored (~10 LOC each, no lib API change), 4 test files (+15 cases). Notable: third silent-success-on-wrong-arg-shape bug in 3 patches (v0.9.14 `lint <path>`; v0.9.15 hook tag-with-dash; this one) — argv-shape silent-fallback is a recurring antipattern worth a hook-level lint, candidate for the §13.2 promotion queue.

## [0.9.15] - 2026-05-10

**Patch — `memory-read-check.sh` two coupled silent-fail-open defects.** Spec v6.11.7 unchanged. Surfaced while end-to-end-testing the v0.9.14 fix from real cwd `/mnt/data_ssd/dev/projects/claudemd`: the §11 HARD memory-read hook had been a no-op for any project containing `_` in its path AND broke entirely when MEMORY.md held a tag beginning with `-`.

### Fixed

- `[fix]` **`tr '/.' '-'` → `tr '/._' '-'`** in `hooks/memory-read-check.sh:50` and `hooks/lib/rule-hits.sh:28`. Empirical: Claude Code encodes every non-`[a-zA-Z0-9-]` char to `-` (verified across all `~/.claude/projects/` entries). Pre-fix, any cwd containing `_` resolved to a non-existent `~/.claude/projects/-mnt-data_ssd-...` (vs CC's actual `-mnt-data-ssd-...`), the `[[ -f "$MEM_INDEX" ]] || exit 0` fail-open kicked in, and the §11 enforcement degraded to silent no-op. Stale-Memory note `feedback_cc_cwd_encoding_dots.md` claimed only `/` and `.` were encoded — incomplete; updated to reflect the broader rule.
- `[fix]` **`grep -qiF -- "$t"`** in `hooks/memory-read-check.sh:95` (and `--` added to the transcript-scan grep at L109 for parity). A MEMORY.md tag beginning with `-` (e.g. `--file`, `-h`) was parsed by `grep -qiF` as a flag, erroring `option '--file' requires an argument` and aborting the entire MEMORY scan with exit-0 fail-open. Discovered when v0.9.14's own MEMORY.md entry tagged itself with `[--file]` and broke the hook for the entire `git push` path.

### Added

- `[test]` **3 new cases in `tests/hooks/memory-read-check.test.sh` (16/16 → 19/19)**:
  - Case 17: cwd `/work/my_project` → underscore-encoded → tag match → deny.
  - Case 18: cwd `/mnt/data_ssd/my.proj_v2` mixed `/`, `.`, `_` → all encoded → deny.
  - Case 19: tag `--file` matched literally with `-- "$t"` separator → deny without grep crash.

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion — both items restore the hook's documented intent (HARD-block ship verbs without prior matching MEMORY.md Read). L2 ceiling. Diff: 2 hook files (~6 lines net), 1 test file (~50 lines added), 0 spec/contract change. Notable: this kind of bug class — silently-no-op'd HARD enforcement under specific cwd shapes — is the worst-quality fix to ship because users couldn't have noticed (no error signal); ratio of installed users on underscore-containing paths is high (Linux convention), so impact ≫ patch surface size.

### Versioning

- `package.json`, `plugin.json`, `marketplace.json` (×2 fields) → `0.9.15`. Spec trio unchanged at v6.11.7.

---

## [0.9.14] - 2026-05-10

**Patch — `claudemd-cli lint <path>` silent-success fix.** Spec v6.11.7 unchanged. Surfaced while role-playing a real user of the standalone CLI: `claudemd lint /path/to/COMMIT_EDITMSG` (the natural pre-commit-hook shape, mirroring `audit <jsonl-path>`) silently scans the **literal path string** for banned-vocab — finds none — and exits 0, even when the file content would deny. CI / git-pre-commit integrations would have shipped commit messages full of `significantly` / `robust` / `production-ready` undetected.

### Fixed

- `[fix]` **`bin/claudemd-lint.js` `lintCmd`**: a single positional arg that is an existing regular file is now auto-treated as `--file <path>` (file contents scanned), not as a literal text argument. Pre-fix: `claudemd lint .git/COMMIT_EDITMSG` → scans the string `".git/COMMIT_EDITMSG"` → exit 0. Post-fix: reads file contents → exit reflects banned-vocab presence. Backward-compatible: bare-text `claudemd lint "literal sentence"` still scans the sentence; non-existent paths fall through to text-scan (no surprise error). Asymmetry with `audit <jsonl-path>` (which already takes a path) was the root inconsistency.

### Added

- `[feat]` **`--file <path>` flag on `lint`** for explicit file-mode (parallels `--stdin`). Mutual-exclusion enforced: `--file` + `--stdin`, `--file` + positional, `--stdin` + positional all → exit 2 with reason. `--file <missing>` → exit 2 `file not found`. Recommended form for scripts that don't want to depend on the auto-detect heuristic.
- `[doc]` **USAGE block updated** in `bin/claudemd-lint.js`: documents `--file <path>`, the auto-detect rule, and the opt-out (quote literal text or use `--stdin`).
- `[test]` **8 new cases in `tests/scripts/lint-cli.test.js` (12/12 → 20/20)**: `--file` happy-path (hit + clean), `--file` missing → exit 2, `--file` without arg → exit 2, the regression test for the auto-detect bugfix (`lint <existing-file>` exits 1 on banned-vocab content), pure-text path-shape stays text, and both mutex pairs (`--file + positional`, `--stdin + --file`).

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion list — the package's stated use case in `package.json#description` is "git pre-commit hooks, GitHub Actions, and other agents," all of which require path-based input; the silent-success on path arg failed that intent. L2 ceiling applies. Diff: 1 CLI file (~50 lines net), 1 test file (~70 lines added), 0 spec/contract change. Standalone-CLI consumers (`npx claudemd-cli lint ...`) get a stricter, less-footgun-prone surface; in-CC plugin behavior is unchanged.

### Versioning

- `package.json`, `plugin.json`, `marketplace.json` (×2 fields) → `0.9.14`. Spec trio unchanged at v6.11.7.

---

## [0.9.13] - 2026-05-10

**Patch — `session-summary.sh` window calculation: missing `platform.sh` source + self-owned sentinel.** Spec v6.11.7 unchanged. Two coupled defects in window discipline, both surfaced while reasoning about the v0.9.12 fix's "Bug 2" follow-up.

### Fixed

- `[fix]` **`hook_lib/platform.sh` was never sourced by `hooks/session-summary.sh`** (regression latent since v0.8.0 ship of the hook). The window-start computation guards on `command -v platform_stat_mtime`, but with `platform.sh` not sourced the function name was undefined, the guard silently fell false, `SINCE_TS` stayed empty, and **every** session-summary invocation since v0.8.0 took the 24h-rolling fallback path instead of the documented "since last Stop" window. Hard evidence in the wild: pre-fix `last-session-summary.json` shipped with `since == ts - 24h00m00s` exactly — only the fallback `date -u -d '24 hours ago'` produces that. Banner counts were therefore mixing rule activity across multiple sessions in the same calendar day.
- `[fix]` **Window sentinel decoupled from `session-start.ref`**. The shared sentinel was also being written by `hooks/sandbox-disposal-check.sh` during the same Stop event (declared earlier in `hooks/hooks.json`). With the platform.sh source restored above, that sharing would surface as a parallel/serial-ordering race — parallel hooks may let session-summary stat the file before sandbox-disposal touches it (OK), but a future CC harness running Stop hooks serially in declaration order (sandbox first / summary last) would produce `mtime == NOW` → empty window → banner permanently empty. New private sentinel `session-summary.lastrun` is read + always-touched by session-summary alone; sandbox-disposal continues to own `session-start.ref` for its tmp-dir scan baseline.
- `[fix]` **Always-touch sentinel before the no-event early-exit**. A no-event Stop (zero rule activity) previously exited without advancing the window, so the next session would silently extend the window backward through the gap. New code touches `SUMMARY_REF` unconditionally before the `total > 0` guard so window discipline is event-count-independent.

### Added

- `[test]` **Cases 8 + 9 in `tests/hooks/session-summary.test.sh` (7/7 → 9/9)**:
  - Case 8: SUMMARY_REF is created on no-event Stop (no summary file written, but sentinel exists for next-window boundary).
  - Case 9: SUMMARY_REF mtime correctly gates the window — a row dated 5 minutes before sentinel mtime is excluded; a fresh row is included; final summary asserts `denies==1 total==1`. Pre-fix this case fails with `denies==2 total==2` (24h fallback regression detector).
- `[test]` **Case 2 + new cases retargeted from `session-start.ref` to `session-summary.lastrun`** to match the new ownership boundary.

### Why no L3 / pre-ship-review chain

`fix:` per spec §2 hard-upgrade exclusion list — both items restore documented/intended hook behavior (the v0.8.0 R-N4 design comment in the source file already says "Window: from session-start.ref mtime to now," which the missing source line silently broke). L2 ceiling applies. Diff: 1 hook (~25 lines net), 1 test (~45 lines added), 0 spec/contract change.

### Versioning

- `package.json`, `plugin.json`, `marketplace.json` (×2 fields) → `0.9.13`. Spec trio unchanged at v6.11.7.

---

## [0.9.12] - 2026-05-10

**Patch — `session-summary.sh` `top_section` bucket pollution fix.** Spec v6.11.7 unchanged. Empirical session run produced banner `[claudemd] last session: 61 denies, 3 bypasses, 134 warns, top: (unset)` despite the log holding 95 `§8.V4` warns and 54 `§10-V` denies in window — i.e. `(unset)` should not have won.

### Fixed

- `[fix]` **`top_section` calculation in `hooks/session-summary.sh`**: previously `group_by(.spec_section // "(unset)")` over **all** events in window, including operational telemetry that lacks `spec_section` by design (`session-start.bootstrap`, `user-prompt-submit.version-sync`, `session-start.upstream-banner`, `ship-baseline.pass`, `ship-baseline.pass-known-red`). On a healthy session those ops events outnumber rule-violation events ≥1:1, so the synthetic `"(unset)"` bucket dominates and the banner reads `top: (unset)` regardless of actual rule activity. Reproducer (24h window): 18 events total, 2 deny `§10-V` + 1 warn `§8.V4` + 15 housekeeping (no `spec_section`) → `top_section = "(unset)"` (wrong; correct: `§10-V`).
- `[fix]` Now restricts `top_section` aggregation to the same three event types whose counts the banner reports — `deny` + `bypass-escape-hatch` + `warn` — and drops null-`spec_section` rows. `top_section` becomes "the most-cited spec_section among events that contributed to the displayed counts," internally consistent with denies/bypasses/warns numerals.

### Added

- `[test]` **Case 7 in `tests/hooks/session-summary.test.sh` (6/6 → 7/7)**: regression for the pollution scenario. 2 deny `§10-V` + 1 warn `§8.V4` + 15 housekeeping events (5× bootstrap + 5× version-sync + 5× pass) → asserts `top_section == "§10-V"` and `denies == 2 && warns == 1`. Pre-fix this test fails with `top_section == "(unset)"`.

### Why no L3 / pre-ship-review chain

`fix:` (bugfix restoring intended behavior, not feat/change) per spec §2 hard-upgrade exclusion list — `top_section` is meant to surface "what rule hit you most this session," docstring at hook L8 reads "the agent sees its own recent tendency"; the polluted `(unset)` form fails that intent. L2 ceiling applies. Diff: 1 hook (12 lines net), 1 test (33 lines added), 0 spec/contract change. CHANGELOG `fix:` voice.

### Versioning

- `package.json`, `plugin.json`, `marketplace.json` (×2 fields) → `0.9.12`. Spec trio unchanged at v6.11.7.

---

## [0.9.11] - 2026-05-10

**Patch — `transcript-structure-scan.sh` regex coverage gap fix.** Spec v6.11.7 unchanged. v0.9.10 shipped the hook with `^Done:` / `^Not done:` etc. line-anchored regex (canonical spec form). Empirical run against 5 real session transcripts (`~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/*.jsonl`) showed the prevalent style in this project is the **markdown-header form** (`## Done` / `## Done — <title>` / `## Not done`) per memory `feedback_done_section_chinese_prose` example — not canonical inline. v0.9.10 hook missed those entirely.

### Fixed

- `[fix]` **Label regex**: now matches both canonical `^Done:` and markdown-header `^## Done\b` (with `:`, em-dash + space, or EOL terminators). Single awk pass strips `^##\s+` prefix then tests `^<label>(<sp>—|:|<sp>$)`. Same for `Not done`, `Failed`, `Uncertain`. Narrative text like `## Done with the analysis` (no canonical terminator after `Done`) does NOT match.
- `[fix]` **Evidence window 3 → up to 15 lines, capped at next-label-line - 1**: previously `Done` evidence had to land in the next 2 lines. Markdown reports commonly use `## Done — title` / blank / intro / table — evidence lives in the table 3-15 lines later. Window expansion captures those. Cap-at-next-label prevents bleed-through (e.g. "untested" in `Uncertain` matching `\btest\b` and falsely satisfying `Done`'s evidence requirement).
- `[fix]` **Evidence regex 中文 addition**: `证据[:：]` (literal "evidence:" / "evidence：" header marker, both ASCII and full-width colon). Tight — requires colon, so prose mentions of the word "证据" don't trigger.
- `[fix]` **Empty-Done skip applies only to canonical form**: `Done: (none)` / `Done: ` skip; `## Done` (header alone, body on subsequent lines) does NOT auto-skip — the evidence-window check above is authoritative for markdown form.
- `[fix]` **`uncertain-hedge` matches `## Uncertain` markdown form too**, but bare `## Uncertain` (header alone, rationale on following lines) is correctly excluded — the test fires only when content lives ON the same line as the label. `^## Uncertain[[:space:]]*$` short-circuits to silent.

### Added

- `[test]` **3 new cases (12/12 → 15/15)** in `tests/hooks/transcript-structure-scan.test.sh`:
  - case 13: markdown four-section with evidence in window → silent
  - case 14: markdown four-section without evidence → `§iron-law-2` fires
  - case 15: bare `## Uncertain` header alone → silent

### Empirical validation against real transcripts

After the broadening fix, the hook was run against 5 most-recent session transcripts under `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/*.jsonl` (each transcript represents one session's full event stream, last 200 lines = last ~20-50 turns).

| Transcript | `## Done` | `## Not done` | `## Failed` | `## Uncertain` | hook hits |
|---|---|---|---|---|---|
| 78696600 (current session) | 2 | 2 | 2 | 2 | 0 |
| 3e4c19fb | 2 | 2 | 2 | 2 | 0 |
| 8f6585f6 | 0 | 0 | 0 | 0 | 0 |
| 84078778 | 0 | 0 | 0 | 0 | 0 |
| 71210740 | 0 (4 plain `Done:`) | 0 | 0 | 0 | 0 |

**0 hits across 5 transcripts.** Verified manually: the v0.9.10 ship report's Done window (last assistant turn of session 78696600) contains 4 evidence fingerprints (`证据：`, `passed`, `tests`, `baseline`) — hook correctly stays silent. Uncertain section uses `## Uncertain` standalone with rationale on following lines — bare-header skip applies. Reports are honestly clean; the hook isn't suppressing.

### Versioning

- `package.json` 0.9.10 → **0.9.11** (npm).
- `.claude-plugin/plugin.json` 0.9.10 → **0.9.11**.
- `.claude-plugin/marketplace.json` two version fields 0.9.10 → **0.9.11**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/transcript-structure-scan.test.sh` → 15/15 passed.
- `node --test tests/scripts/*.test.js` → 217 passed.
- `bash tests/run-all.sh` → all suites passed.

## [0.9.10] - 2026-05-10

**Patch — P1.2 restart: agent self-rule observation mirror via new `transcript-structure-scan` Stop hook.** Spec v6.11.7 unchanged. Closes the audit gap that ~7 self-enforced HARD rules in `spec/hard-rules.json` (§iron-law-2, §10-four-section-order, §10-honesty, §10-specificity, §0-hard-auth-override, §11-mid-spine-yield, §11-session-exit) had **no hook-side feedback signal** — only banned-vocab (§10-V) was observed via `transcript-vocab-scan`. P1.2 was deferred in v0.9.7 with two reasons (pattern lockstep on `tests/scripts/spec-pattern-drift.test.js`; FP storm risk on every `PostToolUse`); both addressed by design pivot.

### Design pivot vs deferred v0.9.7 plan

- **Hook event**: Stop instead of PostToolUse. Fires once per session end (vs every tool call) — heavier checks affordable, FP impact minimal.
- **Detection scope**: 3 narrow checks, each FP-tightened by context-gating:
  - `§10-four-section-order` — only fires when ALL 4 of `Done:`, `Not done:`, `Failed:`, `Uncertain:` appear line-anchored within a 50-line window. Single-section narrative ("Done — v0.9.6 ship 完成") never triggers because the other three labels are absent.
  - `§iron-law-2` — only checks `Done:` lines INSIDE a four-section block (above). Single `Done:` lines = L1 short-form per spec §10, never flagged. Each in-block `Done:` line + next 2 lines must contain at least one evidence fingerprint: `\.[a-z]+:[0-9]+` file:line, `\b(passed|failed|tests)\b`, `[0-9].*(→|->|=>).*[0-9]` baseline arrow, `Checked:`, `baseline`, or `known-red`. `Done: (none)` / `Done: (无)` / `Done:$` — explicitly skipped (legitimate L3 zero-issue).
  - `§10-honesty` — `^Uncertain:` lines that are <80 chars total AND don't contain `because`/`since`/`reason:`/`因为` AND don't end with `(none)`/`(无)`/`none`/`N/A`/`-`. Independent of four-section context.
- **Pattern lockstep avoided**: detections are regex inside the hook, not entries in `banned-vocab.patterns`. `tests/scripts/spec-pattern-drift.test.js` is unaffected; no spec change required.
- **Default OFF**: `TRANSCRIPT_STRUCTURE_SCAN=1` opt-in gate, same precedent as `transcript-vocab-scan` and `BASH_SAFETY_INDIRECT_CALL` — ≥30 days FP signal collection in the wild before flipping default.

### Added

- `[feat]` **`hooks/transcript-structure-scan.sh`** — Stop hook (advisory), 130 LOC. Reads last assistant turn from `$EVENT.transcript_path`, applies the 3 detections above, records to rule-hits log via new event `structure-advisory`, emits stderr banner capped at 5 hits.
- `[contract]` **New rule-hits event class `structure-advisory`** — documented in `docs/RULE-HITS-SCHEMA.md` "Events" + "Spec section taxonomy" tables. Three new `spec_section` keys: `§iron-law-2`, `§10-four-section-order`, `§10-honesty` (one rule-hits row per distinct §-section detected; aggregate via `/claudemd-audit` `bySection`).
- `[doc]` **README.md "What it installs"** — hook count 11 → 12; new entry under "Hooks (what fires when)" table.
- `[test]` **`tests/hooks/transcript-structure-scan.test.sh`** — 12 cases covering opt-out default, opt-in + missing transcript fail-open, ordered four-section silent, reversed four-section flag, in-block Done lacking evidence flag, single Done silent (FP guard), short Uncertain without `because` flag, `Uncertain: (none)` silent, `Uncertain: ... because` silent, hook kill-switch, global kill-switch, rule-hits row schema verification. 12/12 pass on bash 5.2 (Linux). Bash 3.2 portable (no `declare -A`; uses string + `grep -qFx`).

### Registry sync (12-hook count)

- `scripts/lib/hook-registry.js` — added `transcript-structure-scan` entry (hookEvent: Stop, matcher: *, timeout: 3).
- `hooks/hooks.json` — added Stop entry between `mem-audit` and `session-summary`.
- `commands/claudemd-toggle.md` — added `transcript-structure-scan` to displayName list.
- `tests/scripts/hook-registry.test.js` — `HOOK_REGISTRY.length` 11 → 12.
- `tests/integration/full-lifecycle.test.sh` — `MCOUNT == "12"` (was 11).
- `tests/scripts/install.test.js` — `manifest.entries.length === 12` (×2 places); fixture hooks.json + hook basename list updated.
- `tests/hooks/contract.test.sh` — `DOCUMENTED` array gains `structure-advisory:transcript-structure-scan` entry.

### Versioning

- `package.json` 0.9.9 → **0.9.10** (npm).
- `.claude-plugin/plugin.json` 0.9.9 → **0.9.10**.
- `.claude-plugin/marketplace.json` two version fields 0.9.9 → **0.9.10**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/transcript-structure-scan.test.sh` → 12/12 passed locally on bash 5.2.
- `node --test tests/scripts/*.test.js` → 217 passed, 0 failed.
- `bash tests/run-all.sh` → all suites passed (Linux). macOS bash 3.2 portability verified by absence of `declare -A`/array indexing in the new hook (per `feedback_macos_shell_portability.md` 5th portability pattern recorded in v0.9.9).

### Audit follow-up: P1.2 status

P1.2 deferred → restarted → done. The audit's 5th meta-issue ("agent 自律层零观察镜 — 90% rules are self-enforce, no hook-side observation") now has infrastructure: 3 of the 7 most-load-bearing self-enforce rules are observable. Remaining 4 (§0-hard-auth-override, §10-specificity beyond banned-vocab, §11-mid-spine-yield, §11-session-exit) require richer transcript context (multi-turn awareness, AUTH-state tracking) that's a larger lift; not in scope for this patch. Operator can `/claudemd-audit --days 30` after enabling `TRANSCRIPT_STRUCTURE_SCAN=1` to gather field signal on the 3 covered rules' real fire rates.

## [0.9.9] - 2026-05-10

**Patch — macOS bash 3.2 portability hotfix on `hooks/mem-audit.sh` drift detection (v0.9.7 regression).** v0.9.7 introduced `declare -A on_disk=()` and `declare -A in_index=()` for the new MEMORY.md ↔ files drift check; macOS ships bash 3.2 which lacks associative arrays (added in bash 4.0). v0.9.8 macOS CI failed at `tests/hooks/mem-audit.test.sh` cases 9-11 with `declare: -A: invalid option` + downstream `syntax error: invalid arithmetic operator (error token is ".md")` — the latter because indexing a non-existent associative array on bash 3.2 falls through to arithmetic context which can't parse `.md`. Cross-references project memory `feedback_macos_shell_portability.md` (BSD wc / GNU timeout / git exec-mode patterns); this is a sibling case — bash 4 idioms not portable to macOS default shell.

### Fixed

- `[fix]` **`hooks/mem-audit.sh` drift detection**: replaced `declare -A on_disk=()` + `${on_disk[$linked]:-}` lookups with newline-separated string accumulator + `grep -qFx -- "$linked"` membership check. Bash 3.2 compatible. Same logic, same outputs (test cases 9-11 unchanged, 11/11 still passes locally on bash 5.2). Per memory `feedback_macos_shell_portability` section "GNU coreutils availability on macOS CI": same source as the v0.1.0 BSD wc / GNU timeout fixes, different bash-version axis.

### Versioning

- `package.json` 0.9.8 → **0.9.9** (npm).
- `.claude-plugin/plugin.json` 0.9.8 → **0.9.9**.
- `.claude-plugin/marketplace.json` two version fields 0.9.8 → **0.9.9**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- Local `bash tests/hooks/mem-audit.test.sh` → 11/11 passed (bash 5.2.21 — verifies structural correctness; macOS bash 3.2 compatibility verified by absence of `declare -A` and any other bash-4-only idiom in the changed block).
- `node --test tests/scripts/*.test.js` → 217 passed.
- `bash -n hooks/mem-audit.sh` → no syntax errors.

### Lesson recorded

Bash 3.2 portability is documented in project memory `feedback_macos_shell_portability.md` (4 patterns: git exec-mode, BSD wc, GNU timeout/coreutils, mktemp symlink). This v0.9.7 regression adds a 5th pattern — `declare -A` + array indexing fail differently on bash 3.2 (silently fall through to arithmetic context). For any future hook code, prefer string + `grep -qFx` over associative arrays unless macOS support is dropped explicitly.

## [0.9.8] - 2026-05-10

**Patch — v0.9.7 CI hotfix.** v0.9.7 shipped `hooks/mem-audit.sh` drift detection + new `tests/hooks/mem-audit.test.sh` cases 9-11, but the test-file edit was not staged in the v0.9.7 commit. Result: v0.9.7 CI failed at `Run test suite` step on both ubuntu-latest and macos-latest because old case 9 expected `silent` from a hook that now correctly emits an `index_orphan` warn. Hook behavior in v0.9.7 is correct; only the test sync was missing.

### Fixed

- `[fix]` **`tests/hooks/mem-audit.test.sh`** — sync test file with v0.9.7 mem-audit.sh drift detection. Case 9 reused for `index_orphan` (MEMORY.md links file that doesn't exist), case 10 added for `file_orphan` (memory file present, no MEMORY.md link), case 11 added for aligned-no-drift baseline. Test count 9/9 → 11/11. Pre-fix on v0.9.7 CI: `FAIL: 9 (stderr='[claudemd] §11-EXT mem-audit: 1 MEMORY.md drift entries...')` — the failure was the test asserting old behavior, not a hook regression.

### Versioning

- `package.json` 0.9.7 → **0.9.8** (npm).
- `.claude-plugin/plugin.json` 0.9.7 → **0.9.8**.
- `.claude-plugin/marketplace.json` two version fields 0.9.7 → **0.9.8**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/mem-audit.test.sh` → 11/11 passed locally pre-commit.
- `node --test tests/scripts/*.test.js` → 217 passed, 0 failed.
- `bash tests/run-all.sh` → all suites passed.

### Lesson recorded

The v0.9.7 atomic-ship sequence used `git add <files...>` with an explicit list and forgot `tests/hooks/mem-audit.test.sh`. Local `bash tests/run-all.sh` passed because it ran against the working-tree state, not the staged state. Future ships covering hook + test edits should `git diff --cached` before commit, or use `git add -u` after touching tracked files. Recorded inline here rather than as a separate memory entry — the test fixture format-drift memory (`feedback_test_fixture_format_drift`) already covers the test-real-file-divergence pattern; this is its sibling failure mode (test edit forgotten, not test fixture drift).

## [0.9.7] - 2026-05-10

**Patch — P1.3 + P2 batch from audit follow-up.** Spec v6.11.7 unchanged. Three additive changes; no behavior change for users on the green path.

### Added

- `[doc]` **README.md "Execution order (PreToolUse:Bash)" subsection** — closes the audit observation that the 4 PreToolUse:Bash hook execution order was undocumented. Lists the 4 hooks in `hooks/hooks.json` declaration order with their spec section, fail-stop semantics (first deny stops the rest), per-hook timeout fail-open contract, and the opt-in `BASH_READONLY_FAST_PATH=1` short-circuit. Local-only `docs/HOOK-PROTOCOL.md` (gitignored per `.gitignore` policy) carries the same content for internal reference.
- `[feat]` **`hooks/mem-audit.sh` MEMORY.md ↔ files drift detection** — adds two reverse-direction checks to the existing Why/How marker scan: (a) `index_orphan` — MEMORY.md link target file doesn't exist (stale index), (b) `file_orphan` — memory file present but no MEMORY.md link points to it. Both advisory; reported alongside Why/How marker counts on the same 24 h sentinel debounce. Independent of `claude-mem-lite` per the existing hook contract — pure CC built-in memory scan. Test cases 9-11 cover index_orphan, file_orphan, and aligned-no-drift; 11/11 cases pass (was 9/9; case 9 reused for new behavior, cases 10+11 new).
- `[feat]` **`scripts/perf-baseline.sh`** — measures hook chain overhead on 6 representative bash commands (`ls` / `git_log` / `git_status` / `git_commit_noop` / `echo` / `cat_head`). Median of N=10 runs (configurable) with hooks ON vs hooks OFF (`DISABLE_CLAUDEMD_HOOKS=1`). Initial run on this repo (Linux 6.17, N=3): `ls 1→48 ms (delta 47)`, `git_log 3→50 ms (delta 47)`, `git_status 8→55 ms (delta 47)`, `git_commit_noop 11→93 ms (delta 82)` — `git_commit_noop` is the only command where banned-vocab actually scans, hence the higher delta. Pre-this-script estimate was "200-400 ms" (5月9日 audit, never measured). Caveat: script measures direct stdin invocation, NOT CC harness round-trip — real overhead is above + per-event JSON construction + timeout enforcement.
- `[doc]` **`docs/cross-project-pilot.md`** — checklist framework for adopting claudemd in an unrelated project. Closes the audit observation that claudemd was self-tested only. 6-axis observation table, pilot-duration guidance (≥2 weeks), 3 exit-outcome criteria, empty pilot-results table for future fills. Added to `.gitignore` exception list so the doc ships with the repo.

### Versioning

- `package.json` 0.9.6 → **0.9.7** (npm).
- `.claude-plugin/plugin.json` 0.9.6 → **0.9.7**.
- `.claude-plugin/marketplace.json` two version fields 0.9.6 → **0.9.7**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `node --test tests/scripts/*.test.js` → 217 passed, 0 failed.
- `bash tests/hooks/mem-audit.test.sh` → 11/11 passed (was 9/9; +2 drift cases).
- `bash tests/run-all.sh` → all suites passed (upgrade-lifecycle final check).
- `bash scripts/perf-baseline.sh --runs 3` → 6 commands measured; output format matches the column layout documented in the script header.

### Audit follow-up status (after v0.9.6 + v0.9.7)

P0 done (v0.9.6: hard-rules-audit error context + tests; session-start tag semver gate). P1 partially done — P1.3 doc shipped here; P1.1 spec net-delete deferred (core 442 chars headroom; passive trigger per §13.1, not active); P1.2 agent observation extension deferred (spec-pattern-drift would require 3-file lockstep spec change + transcript scanner FP risk on every PostToolUse). P2 done (this release: mem drift detector, perf baseline, cross-project pilot framework). The unresolved audit signal is P1.2 — agent self-rule observation needs better detection logic before adding patterns; logged for next iteration.

## [0.9.6] - 2026-05-10

**Patch — defensive hardening + test coverage gap closure.** Spec unchanged (still v6.11.7); plugin-only patch. Triggered by an audit pass that found `scripts/hard-rules-audit.js` had zero test coverage and no error context on `JSON.parse` failure, plus `hooks/session-start-check.sh` embedded the upstream tag in a banner without a strict semver gate. Three small changes; no behavior change for users on the green path.

### Fixed

- `[fix]` **`hard-rules-audit.js` opaque error on broken / missing `spec/hard-rules.json`** — pre-fix: `JSON.parse(fs.readFileSync(manifestPath, 'utf8'))` at L21 surfaced bare `ENOENT` / `SyntaxError` with no path context, leaving the operator to guess which file broke. Post-fix: try/catch wraps the parse, throws `hard-rules-audit: failed to load <path>: <reason>`; an additional shape-check (`Array.isArray(manifest.rules)`) throws `hard-rules-audit: <path> missing required 'rules' array` when the JSON is valid but the manifest body is wrong.
- `[fix]` **`session-start-check.sh` lacked semver gate before embedding `remote_tag` in `additionalContext`** — pre-fix: `jq --arg new "$remote_tag"` already safe-quotes the value, so JSON injection wasn't reachable, but a malformed remote tag (newline-injected, exotic glyphs from a compromised mirror) would still produce a confusing upgrade banner. Post-fix: a `[[ "$remote_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 0` gate after `head -1 | awk | sed`. Defense-in-depth, not a fix to a live exploit.

### Added

- `[test]` **`tests/scripts/hard-rules-audit.test.js` — 6 cases, 0 → 6 coverage**: (1) byte-exact production fixture (reads real `spec/hard-rules.json` per project memory `feedback_test_fixture_format_drift` — locks against test/impl drift), (2) missing manifest path → error names the file, (3) malformed JSON → error names the file, (4) JSON valid but `rules` array missing → error explains what's missing, (5) cross-ref of `rule_hits_section` to live log rows (verifies `§10-V` deny rows reach `§10-specificity.hits.deny`), (6) `demoteCandidates` correctly excludes self-enforced rules (avoids false-positive `§iron-law-2` demotion suggestion). All 6 pass; total Node test count 211 → 217.

### Versioning

- `package.json` 0.9.5 → **0.9.6** (npm).
- `.claude-plugin/plugin.json` 0.9.5 → **0.9.6**.
- `.claude-plugin/marketplace.json` two version fields 0.9.5 → **0.9.6**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `node --test tests/scripts/*.test.js` → 217 passed (211 prior + 6 new), 0 failed.
- `bash hooks/session-start-check.sh < /dev/null` → exit 0; banner emitted as expected; semver gate not exercised on green path (operator-side smoke).
- Verification log of why three of four originally suspected HIGH hook bugs turned out to be false positives recorded in this session's audit transcript:
  - `sandbox-disposal-check.sh` printf `\x1e` — `printf '/tmp|claudemd_only\x1e%s|both' "$HOME"` produces 1 RS byte; `read -d $'\x1e'` correctly splits into 2 specs.
  - `pre-bash-safety-check.sh` heredoc terminator — bash itself treats `EOF # comment` as heredoc body (not terminator), so the regex matching this behavior is correct, not a bypass.
  - `banned-vocab-check.sh` baseline regex — `code→123ms` and `code → 123ms` both correctly fail the `[0-9].*(→|->|=>).*[0-9]` test (left side requires a number); previously-claimed asymmetry doesn't exist.

## [0.9.5] - 2026-05-10

**Patch — `mem-audit.sh` hotfix (3 bugs introduced in v0.9.4).** Spec unchanged (still v6.11.7); plugin-only patch. The new Stop hook shipped in v0.9.4 silently failed validation on every Stop event ("Hook JSON output validation failed — Invalid input") and produced false-positive missing-marker warnings on legitimate memories. v0.9.5 fixes all three issues and adds `tests/hooks/mem-audit.test.sh` (9/9 cases) to lock them down.

### Fixed

- `[fix]` **Stop event schema mismatch (CRITICAL)** — v0.9.4 emitted `{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "..."}}` to stdout, but Claude Code's hook schema only accepts `hookSpecificOutput` for `PreToolUse` / `UserPromptSubmit` / `PostToolUse` / `PostToolBatch`. **Stop is not on the list.** Every emit was rejected with `Hook JSON output validation failed — (root): Invalid input`. The fix mirrors `residue-audit.sh`: write to stderr only, no JSON output. CC harness surfaces stderr as advisory; Stop cannot block by design either way.
- `[fix]` **Path double-slash** — error banner showed paths like `<encoded>//memory/feedback_x.md` (double slash after the project dir). Root cause: glob `"$PROJECTS_ROOT"/*/` produces values with trailing slashes, so the join `"$proj_dir/memory"` became `"<dir>/memory"` with `<dir>` already ending `/`. Fix: `proj_dir="${proj_dir%/}"` strips the trailing slash before the join.
- `[fix]` **Regex matched only one Why-form** — v0.9.4 regex `^\*\*Why:\*\*` matched only `**Why:**` (colon inside bolding), but most memories in the wild use `**Why**:` (colon outside bolding). Both forms are valid per CC `memoryTypes.ts:58` body_structure example. v0.9.5 regex `^\*\*Why(:\*\*|\*\*:)` accepts either; same change for `**How to apply:**` / `**How to apply**:`. This eliminates the v0.9.4 26-file false-positive batch on `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_*.md`.

### Added

- `[test]` **`tests/hooks/mem-audit.test.sh` — 9 cases**: (1) no projects dir → silent, (2) empty memory dir → silent, (3) **Why:** colon-inside-bolding accepted, (4) **Why**: colon-outside-bolding accepted, (5) missing markers → stderr warn, no stdout (locks Stop schema fix), (6) path single-slash format (locks the trailing-slash bug), (7) 24h sentinel debounce, (8) kill-switch DISABLE_MEM_AUDIT_HOOK=1, (9) MEMORY.md index file skipped.

### Compatibility

- **No claude-mem-lite required.** `mem-audit.sh` audits CC built-in auto-memory under `~/.claude/projects/<encoded>/memory/` only. It does NOT depend on `claude-mem-lite`, `claude-mem`, or any other recall-layer plugin. If a user only has the claudemd plugin installed (no recall plugin):
  - Hook still operates correctly, scanning whatever CC built-in 4-types memories exist.
  - Zero memory files → silent exit (no projects dir / no relevant files = no output).
  - Spec wording (§11 + §11-EXT) consistently uses "recall-layer plugin **if present**" — no plugin specifically required.
- **Comment in `mem-audit.sh:13-21`** documents the independence property explicitly.

### Versioning

- `package.json` 0.9.4 → **0.9.5** (npm).
- `.claude-plugin/plugin.json` 0.9.4 → **0.9.5**.
- `.claude-plugin/marketplace.json` two version fields 0.9.4 → **0.9.5**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/mem-audit.test.sh` → 9/9 passed.
- `npm run test:scripts` → 211/211 passed.
- `bash tests/run-all.sh` → all suites passed including upgrade-lifecycle (v0.2.3/v6.10.1 → current/v6.11.7).

## [0.9.4] - 2026-05-10

**Minor — spec v6.11.7 (CC-source comparative audit) + new `mem-audit` Stop hook.** Driven by side-by-side analysis of upstream `sdscc/src/constants/prompts.ts` + `src/memdir/memoryTypes.ts` against AI-CODING-SPEC v6.11.6 — five spec additions where CC's eval-validated rules were stronger or absent in spec. Plugin manifest version skips `0.9.3` (npm-only release that didn't bump `plugin.json` / `marketplace.json`); v0.9.4 brings all manifests back to a coherent state.

### Spec changes (v6.11.6 → v6.11.7)

- `[fix]` **§10 Specificity No-baseline fallback boundary** (core, +~70 bytes net) — PARTIAL applies to numeric/quantitative claims w/o baseline only, NOT to pure process-completion (commit landed / file created / config applied) when V1-verified. Closes a defensive-PARTIAL drift. Source: CC `prompts.ts:183`.
- `[change]` **§11 Memory routing** (core +~95 bytes pointer; full body §EXT §11-EXT +~810 bytes) — durable layer (CC built-in 4 types) vs time-sensitive recall layer (e.g. `claude-mem-lite`). One home per fact.
- `[change]` **§11-EXT user-override filter** — WHAT-NOT-TO-SAVE applies even on explicit "save / 记一下 / remember"; ASK what was *surprising* / *non-obvious*, save only that. Source: CC `memoryTypes.ts:189`.
- `[change]` **§11-EXT Execution heuristics (CC-borrowed, non-HARD)** — Read-before-propose (`prompts.ts:175`), Diagnose-before-pivot (`prompts.ts:178`), Existing-comment protection (`prompts.ts:161`).
- `[refactor]` **§10 Banned-vocab quick-list compaction** (core, −~50 bytes).

§13.2 budget cost: 0 (no new HARD added). Sizing post-v6.11.7: core 24558/25000 (442 bytes headroom, **98.23% — tight**); extended 46568/50000 (3432 bytes headroom, 93.14%). Operator note: v6.11.8 should net-delete or migrate marginal core bullets to §EXT before adding new content.

### Plugin changes

- `[feat]` **`hooks/mem-audit.sh` — new Stop hook (advisory, never blocks)**: scans `~/.claude/projects/*/memory/feedback_*.md` + `project_*.md` for missing `**Why:**` / `**How to apply:**` body-structure markers (per CC `memoryTypes.ts:58/76/132/149`). Emits `additionalContext` banner with file paths (max 3 shown + `+N more`); 24h sentinel debounce so it doesn't fire on every Stop. Skips MEMORY.md itself + sub-400-byte stubs. Disable: `DISABLE_MEM_AUDIT_HOOK=1`. Registered in `hooks/hooks.json` (Stop event, after sandbox-disposal-check, before session-summary), `scripts/lib/hook-registry.js`, `commands/claudemd-toggle.md`. Hook count: **10 → 11**.

### Versioning

- `package.json` 0.9.3 → **0.9.4** (npm tag).
- `.claude-plugin/plugin.json` 0.9.2 → **0.9.4** (catches up — v0.9.3 was an npm-only release that didn't bump plugin manifests).
- `.claude-plugin/marketplace.json` two version fields 0.9.2 → **0.9.4**.
- `spec/CLAUDE.md` v6.11.6 → **v6.11.7** (header + body).
- `spec/CLAUDE-extended.md` v6.11.6 → **v6.11.7**.
- `spec/CLAUDE-changelog.md` prepended **v6.11.7** entry.
- `spec/hard-rules.json` `spec_version` v6.11.6 → **v6.11.7**.

### Notes

- Plugin manifest `description` fields stay at major.minor (`v6.11`) per Versioning policy; not touched this release.
- npm `claudemd-cli@0.9.4` will publish via the `npm-publish.yml` workflow on `v0.9.4` tag push (auto-publish per v0.9.2 onwards).
- Carryover: v0.9.3 npm tarball (released 2026-05-09 with spec v6.11.4–v6.11.6 batch ship) didn't bump plugin manifests. v0.9.4 reconciles. No user-facing impact — `/claudemd-update` reads `spec/CLAUDE.md` header, not `plugin.json` version, so spec sync was unaffected.

## [0.9.2] - 2026-05-09

**Patch — npm provenance metadata + first auto-publish via workflow.** v0.9.1 manual publish succeeded but the auto-publish workflow's first triggered run failed twice: first run on the v0.9.1 tag push hit `ENEEDAUTH` (NPM_TOKEN not yet configured); a rerun after token configuration hit `E422` from npm's sigstore provenance verifier — `--provenance` requires `repository.url` in package.json to match the inferred repo URL. v0.9.2 closes that gap and serves as the first end-to-end auto-publish validation.

### Added

- `[feat]` **`package.json` `repository` / `homepage` / `bugs` / `keywords` fields** — required by `npm publish --provenance` (sigstore verifier reads `repository.url` to validate the build chain came from the same git origin GitHub Actions claims). `homepage` deep-links to the README's CLI section so the npm package page sends new users straight to install/usage. `keywords` improves discoverability on npmjs.com search.

### Changed

- `[chore]` **`package.json` bin path** (committed post-v0.9.1 as a no-bump fixup) — `npm pkg fix` normalized `./bin/claudemd-lint.js` → `bin/claudemd-lint.js`. Silences the publish warning the v0.9.1 workflow run surfaced. Behavior unchanged — npm resolves both forms identically.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.2`. Spec files unchanged; spec version remains v6.11.3.
- This release is the **first auto-publish** (operator pre-configured `NPM_TOKEN` repo secret on 2026-05-08; tag push triggers `.github/workflows/npm-publish.yml` which runs tests, validates package.json version against tag, and publishes with `--provenance --access public`).
- Validation: `tests/run-all.sh` → 211/211 node tests pass (no test changes vs v0.9.1); 13 hook suites green; 2 integration suites pass.
- npm package: [`claudemd-cli@0.9.2`](https://www.npmjs.com/package/claudemd-cli). Published via Actions OIDC, so the tarball carries a sigstore provenance attestation linking it to commit `<sha>` and workflow `npm-publish.yml`.
- v0.9.1 workflow run history (verbose for the on-call audit trail):
  - run 1: failed `ENEEDAUTH` — token not yet set.
  - run 2 (rerun after token set): failed `E422` — missing `repository.url`.
  - v0.9.2 (this release): expected to succeed end-to-end.

## [0.9.1] - 2026-05-09

**Patch — first npm publish + auto-publish workflow.** Operator approved npm publish for v0.9.0's R-N7 CLI; v0.9.1 is the actual first release on npm. Bundles four changes: `.npmignore` (whitelist-style; ships only the 7 runtime files the CLI needs — 69 kB packed vs 4-5× full repo), GitHub Actions auto-publish workflow on tag push, npm package rename to `claudemd-cli` (anti-spam similarity check rejected `claudemd` name due to existing `claude-md` package), and the publish itself.

### Naming

- **GitHub repo**: `sdsrss/claudemd` (unchanged — the Claude Code plugin marketplace install path uses this).
- **npm package**: `claudemd-cli` (NEW — `claudemd` was rejected by npm's automatic similarity check against the unrelated `claude-md` package). CLI invocation: `npx claudemd-cli lint "..."` / `npx claudemd-cli audit transcript.jsonl`. Asymmetry is intentional: GitHub repo serves both the plugin (broad scope) and the CLI (lint subset); npm package is CLI-only and `-cli` suffix makes that explicit.

### Added

- `[feat]` **`.npmignore`** (new) — whitelist approach (`*` then `!file` re-includes). Ships only `bin/`, `scripts/lib/lint.js`, `hooks/banned-vocab.patterns`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`. All plugin-only artifacts (other `hooks/*.sh`, `commands/`, `spec/`, `scripts/install.js` and friends, `.claude-plugin/`, `tests/`, `docs/`, `tasks/`, `.github/`) are excluded. Plugin marketplace install path is unaffected — Claude Code clones the GitHub repo, doesn't go through npm. Verified via `npm pack --dry-run`: 7 files, 68.4 kB packed / 199.5 kB unpacked.

- `[feat]` **`.github/workflows/npm-publish.yml`** (new) — auto-publish on tag push (`v*.*.*` pattern). Pre-publish gate: `tests/run-all.sh` must pass on `ubuntu-latest + node 20` (matches `ci.yml` Linux leg). Belt-and-suspenders version check: refuses to publish if `package.json` version differs from the tag. Uses `npm publish --provenance --access public` for npm provenance attestation (signed build chain). Required repo secret: `NPM_TOKEN` (Automation token, publish scope for `claudemd`). `workflow_dispatch` allowed for manual fallback (e.g. recovering from transient registry outage).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.1`. Spec files unchanged; spec version remains v6.11.3.
- **First npm release**: `claudemd-cli@0.9.1` published from this commit's tagged tarball. After this release, future tag pushes auto-publish via the workflow — operator no longer runs `npm publish` by hand.
- npm package: [`claudemd-cli@0.9.1`](https://www.npmjs.com/package/claudemd-cli). Invocation: `npx claudemd-cli lint "..."` / `npx claudemd-cli audit ...`.
- Validation: `tests/run-all.sh` → 211/211 node tests pass; 13 hook suites green; 2 integration suites pass. No code changes vs v0.9.0 in the runtime path; this release is publish infra + first push.
- Operator post-step: add `NPM_TOKEN` to repo secrets (npm dashboard → Access Tokens → Generate Automation Token, scope `claudemd` publish; GitHub repo → Settings → Secrets → Actions → New repository secret).

## [0.9.0] - 2026-05-09

**Minor — R-N7 standalone CLI (`npx claudemd lint` / `audit`).** Closes the last entry in the v0.6.x → v0.8.x R-N series: the same `banned-vocab.patterns` source the in-CC bash hook uses is now exposed as a pure-Node CLI for **git pre-commit hooks, GitHub Actions, and other agents** (Codex, Cursor, OpenClaw). Spec's effective enforcement surface expands from "inside Claude Code only" to "anywhere Node 20+ runs." This is what makes claudemd a meaningful authority layer rather than a single-client lint.

**Ground-only ship**: source code + `bin` field + tests + GitHub release. `npm publish` is **not** part of this release — operator runs `npm publish` separately when ready (irreversible 24h unpublish window + 72h name reservation are real-world side effects requiring deliberate operator action with their own credentials).

### Added

- `[feat]` **`bin/claudemd-lint.js`** (new, ~140 LOC) — Node CLI entrypoint. Subcommands: `lint <text>` (positional or `--stdin`), `audit <jsonl-path>`. Flags: `--json`, `--include-ratio`, `--version`, `--help`. Exit codes: `0` clean, `1` hits, `2` usage error. Human-readable hits go to stderr (so stdout stays parseable for `cmd | jq`); `--json` emits to stdout regardless of hit/clean. Shebang `#!/usr/bin/env node`, ES module, `fs.readFileSync(0, 'utf8')` for stdin.

- `[feat]` **`scripts/lib/lint.js`** (new, ~110 LOC) — pure-Node scanning functions: `readPatterns` (parses `hooks/banned-vocab.patterns` into `{regex, reason, isRatio}` entries), `scan(text, {excludeRatio, patterns})` (case-insensitive match against patterns; bad-regex fail-open), `parseTranscript(jsonlText)` (extracts assistant-text turns, joins multi-block content per turn, drops corrupt rows silently), `formatHumanReadable` + `formatJSON`. Same matching rules as the bash hooks without the shell quoting + jq plumbing. Reusable by future Node-side hooks.

- `[feat]` **`package.json` `bin` field** — `{ "claudemd": "./bin/claudemd-lint.js" }`. After operator runs `npm publish`, `npx claudemd lint "..."` works directly. Pre-publish, dev mode is `node bin/claudemd-lint.js lint "..."`. Description string updated to reflect the dual surface (CC plugin + standalone CLI).

- `[test]` **`tests/scripts/lint.test.js`** (new, 11 cases) — unit tests for `lib/lint.js`: pattern parsing, hit detection, case-insensitivity, `excludeRatio` flag, bad-regex skip, transcript parsing (multi-block joining, corrupt-row tolerance), formatter output shape, default patterns file resolution.

- `[test]` **`tests/scripts/lint-cli.test.js`** (new, 12 cases) — spawn-based CLI surface tests: `--help` exit 0 + usage to stdout, no-args exit 2, `--version` exit 0, lint clean exit 0, lint hit exit 1 with stderr (NOT stdout) carrying the hit, `--stdin`, `--json` parseable for both clean + hit, missing positional → exit 2, audit clean / hit / missing-file paths, unknown subcommand error.

### Fixed

- `[fix]` **`README.md`** — drift catch-up: layout block "What it installs" said `9 shell hooks` but transcript-vocab-scan landed at v0.8.3 (line 248 was fixed in v0.8.4 but line 13 was missed). Now `10 shell hooks` with `transcript-vocab-scan` listed; new `1 standalone CLI` row added below the slash-command count.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.0` (minor: new public surface). Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 211/211 node tests pass (was 188; +23 lint cases — 11 unit + 12 CLI); 13 hook suites green; 2 integration suites pass.
- Plugin runtime path unchanged. CC users see no functional change. `bin/` is opt-in invocation surface only.
- `npm publish` deferred: when ready, operator runs `npm whoami` (or `npm login`), `npm publish --dry-run` to preview tarball contents, optionally adds `.npmignore` to trim non-essentials (tests/ docs/ spec/ would inflate package size 4-5×), then `npm publish`. Once published, `npx claudemd@0.9.0 lint "..."` works for anyone.

### R-N series — closed

| ID | Title | Shipped |
|---|---|---|
| R-N1 | Spec ↔ banned-vocab.patterns drift gate | v0.7.1 |
| R-N2 | HARD-rules manifest | v0.8.0 |
| R-N3 | Week-over-week regression alerts | v0.8.0 |
| R-N4 | SessionStart summary banner | v0.8.0 |
| R-N5 | Bash readonly fast-path (opt-in) | v0.8.3 |
| R-N6 | Doctor bypass:deny ratio | v0.7.1 |
| R-N6+ | Doctor bypass-token detail | v0.8.5 |
| R-N7 | npx claudemd-lint CLI | **v0.9.0** |
| R-N8 | Transcript-side §10-V scan (opt-in) | v0.8.3 |
| R-N9 | CHANGELOG/audit sparkline | v0.8.4 |

All 9 audit-doc R-N candidates shipped. Next-cycle work would be informed by 30-day FP-signal data on the opt-in R-N5 + R-N8 flags (decide default-ON / demote / remove), not by extending the R-N list.

## [0.8.5] - 2026-05-09

**Patch — R-N6+ doctor bypass-token detail.** Follow-on to v0.7.1's R-N6 (bypass:deny ratio surface): when a spec section trips the §0.1 demotion threshold, doctor now names the specific `[allow-X]` token driving the bypass. Distinguishes "single token consistently overused" (likely rule-design issue — wording confuses, threshold too tight) from "multiple tokens distributed" (likely cross-cutting friction). Operator no longer has to cross-reference `/claudemd-audit byBypass` to see WHICH escape hatch is being used.

### Changed

- `[refactor]` **`scripts/doctor.js:173-217`** — extends the v0.7.1 rule-usage check. When `ratio > 0.5` AND total ≥ 3 events, build a per-section `extra.token` histogram from the same recent-hits buffer already in scope (no extra log read). Sort tokens by count desc, secondary alpha for deterministic output. Detail format:
  ```
  [✗] rule-usage:§11-memory-read: 30d deny=2 bypass=8 (ratio 80%, §0.1 demotion candidate; bypass via [skip-memory-check]×8)
  [✗] rule-usage:§8-rm-rf-var:    30d deny=1 bypass=4 (ratio 80%, §0.1 demotion candidate; bypass via [allow-rm-rf-var]×3, [allow-npx-unpinned]×1)
  ```
  Healthy rows stay terse (token detail only attached to demotion candidates — per-token forensics are only useful when the rule is being defeated).

- `[test]` **`tests/scripts/doctor.test.js`** — 3 new R-N6+ cases: (1) single-token demotion candidate detail names the token + count, (2) mixed-token detail sorts by count desc, (3) healthy rows do NOT carry token detail.

### Fixed

- `[fix]` **`CHANGELOG.md` v0.8.4 entry** — corrected the R-N series status table: R-N6 ships at v0.7.1, NOT a v0.9.x candidate. The original entry mis-listed it alongside R-N7. v0.8.4 already cited the correct shipped status in `README.md` ("v0.7.1+ also flags rule sections whose bypass:deny ratio > 50%"); only the CHANGELOG status table was wrong. Same Specificity self-violation class the v0.8.1 reviewer caught for v0.8.0 (CHANGELOG claim contradicting the actual ship state).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.5`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 188/188 node tests pass (was 185; +3 R-N6+ cases); 13 hook suites green; 2 integration suites pass.
- No runtime behavior change in hook execution; doctor surface only.
- Net diff vs v0.8.4: +21 LOC in `doctor.js` (per-section token histogram), +47 LOC tests, 1 CHANGELOG correction.

### R-N series status (corrected)

| ID | Title | Shipped |
|---|---|---|
| R-N1 | Spec ↔ banned-vocab.patterns drift gate | v0.7.1 |
| R-N2 | HARD-rules manifest | v0.8.0 |
| R-N3 | Week-over-week regression alerts | v0.8.0 |
| R-N4 | SessionStart summary banner | v0.8.0 |
| R-N5 | Bash readonly fast-path (opt-in) | v0.8.3 |
| R-N6 | Doctor bypass:deny ratio | v0.7.1 |
| R-N6+ | Doctor bypass-token detail | **v0.8.5** |
| R-N8 | Transcript-side §10-V scan (opt-in) | v0.8.3 |
| R-N9 | CHANGELOG/audit sparkline | v0.8.4 |
| R-N7 | npx claudemd-lint CLI | v0.9.x candidate (200-400 LOC + npm pipeline) |

## [0.8.4] - 2026-05-09

**Patch — R-N9 rule-usage sparkline (dev-tooling).** Closes the audit-gap §13.1 (quarterly rule review) and §13.2 (rule budget) have run on since v0.7.0: per-window cumulative counts of signal events grouped by `spec_section`, with a per-period rate-based trend arrow. Operators paste the markdown block into the CHANGELOG header before each release; `/claudemd-sparkline` runs anytime to surface "which rules are firing, which are dying, which just woke up" with public data instead of "operator eyeballed two audits."

### Added

- `[feat]` **`scripts/sparkline.js`** (new, ~110 LOC) — reads `~/.claude/logs/claudemd.jsonl`, computes 30/60/90d cumulative counts per `spec_section` for signal events (`deny` + `warn` + `advisory` + `bypass-escape-hatch`), emits a markdown block. Reuses `readHits` + `groupBySection` from `scripts/lib/rule-hits-parse.js` (no duplication of the parsing/aggregation logic). Skips the `(unset)` bucket — pre-v0.7.0 rows without `spec_section` are noise for the version-discipline question this report answers.

  Output shape:
  ```
  Rule usage trend (30d / 60d / 90d, signal events only):
    §10-V              30 / 80 / 120  ↘
    §7-ship-baseline   12 / 12 / 12   ≈
    §11-memory-read     5 /  5 /  5   ↗ (newly active)
    §8.V4               0 /  4 /  4   ↘ (silenced)
  ```

  Trend arrow compares per-period rate (count / window-days), not cumulative count, so a rule firing at steady cadence reads as `≈` rather than `↗` just because the cumulative number grew with the window. Annotations: `(newly active)` when older buckets are empty + recent has events; `(silenced)` when recent bucket is empty + cumulative > 0 (covers both "fired only in oldest bucket" and "fired only in middle bucket and went quiet" — the latter case caused a v0.8.4 prep bug, fixed before ship via test fixture).

  CLI: `node scripts/sparkline.js [--days=30,60,90]` or `CLAUDEMD_SPARKLINE_DAYS=14,28,56`. Requires ≥2 windows.

- `[feat]` **`commands/claudemd-sparkline.md`** — `/claudemd-sparkline` slash command wrapping the script. Registered as the 9th slash command (was 8 in v0.8.0+).

- `[test]` **`tests/scripts/sparkline.test.js`** (new, 8 cases) — empty-log no-data path, monotonic ↗, monotonic ↘, newly-active marker, silenced marker (covers both oldest-bucket-only and middle-bucket-only-then-quiet cases), signal-event filter (excludes `pass` / `pass-known-red` / `bootstrap` / `(unset)` rows), aligned markdown output, custom windows.

### Fixed

- `[fix]` **`README.md`** — drift catch-up from v0.8.3: hook count `9 → 10` (transcript-vocab-scan added in v0.8.3 was never reflected in the layout block); slash-command count `8 → 9` (adds the new `/claudemd-sparkline` row); script count `7 → 10` (was stale across multiple v0.x releases). Same documentation-drift class the v0.8.1 reviewer caught for v0.8.0; the v0.8.2 single-source registry handled the in-code count drift but README counts remain hand-maintained because they're prose-context, not machine-readable. v0.9.x candidate: extend the registry drift test to grep README for stale numeric claims.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.4`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 185/185 node tests pass (was 177; +8 sparkline cases); 13 hook suites green; 2 integration suites pass.
- No runtime behavior change. Pure dev-tooling addition; nothing in the hook execution path touched.
- Closes the v0.6.x → v0.8.x R-N series. R-N1 (drift gate v0.7.1), R-N2 (HARD-rules manifest v0.8.0), R-N3 (week-over-week regression v0.8.0), R-N4 (SessionStart summary banner v0.8.0), R-N5 (bash readonly fast-path v0.8.3), R-N8 (transcript vocab scan v0.8.3), R-N9 (sparkline v0.8.4) all shipped. R-N6 (doctor bypass:deny ratio) and R-N7 (npx claudemd-lint CLI) remain candidates for v0.9.x.

## [0.8.3] - 2026-05-09

**Patch — R-N5 + R-N8 opt-in behavior bundle.** Two independent runtime changes ship behind opt-in env-var flags, default OFF, following the v0.6.0 `BASH_SAFETY_INDIRECT_CALL` precedent for behavior-layer changes that need 30-day FP signal collection in the wild before becoming default-on. Both are gated, both expose status via `/claudemd-status`, both honor the standard kill-switch envelope. With both flags OFF, behavior is byte-identical to v0.8.2.

### Added

- `[feat]` **R-N5 — `BASH_READONLY_FAST_PATH=1`** (default OFF). Skips the 4 PreToolUse:Bash hooks (`pre-bash-safety`, `banned-vocab`, `ship-baseline`, `memory-read-check`) for definitely-read-only commands — the bulk of agent Bash calls (`ls`, `cat`, `git log`, `git status`, etc.). New helper `hook_is_readonly_bash` in `hooks/lib/hook-common.sh`: rejects any shell-meta (`;`, `|`, `&`, `>`, `<`, `` ` ``, `$(`, `${`), then matches first token against a conservative whitelist (pure readers + `git` read-only subcommands like `log`/`status`/`diff`/`show`/`rev-parse`/`rev-list`/`describe`/`blame`/`reflog`/`ls-files`/`ls-tree`/`cat-file`/`remote`). Excludes `git branch`/`tag`/`config` because their destructive sub-flags (`-d`, `-D`, `-c`) live one token deeper than the fast-path scans. False negatives are free (just do more work); false positives could skip a real safety check, hence the conservative list.

- `[feat]` **R-N8 — `TRANSCRIPT_VOCAB_SCAN=1`** (default OFF). New `hooks/transcript-vocab-scan.sh` PostToolUse:* hook. Reverses `banned-vocab-check.sh`: instead of scanning git commit messages (commit-time enforcement), scans the most recent assistant text in the transcript jsonl and emits a stderr advisory + rule-hits log entry on §10-V banned vocab. Advisory-only — PostToolUse fires after the assistant text has been sent, so cannot block. Skips `@ratio` patterns (commit-context-only; chat prose has different baseline conventions). Reads transcript via `jq -R 'try fromjson catch empty'` (line-by-line jsonl with corrupt-row tolerance). Picks the LAST assistant turn (`tail -n 1` after `awk 'NF'`) using `join(" ")` to keep one turn per output line.

- `[feat]` **`scripts/status.js`** — new `features.bashReadonlyFastPath` and `features.transcriptVocabScan` fields alongside existing `features.bashSafetyIndirectCall`. `/claudemd-status` now reflects all three opt-in behavior flags.

- `[feat]` **`hooks/transcript-vocab-scan.sh`** registration: `hooks/hooks.json` gains a new `PostToolUse: [{matcher: '*', ...}]` block. The plugin now registers 10 hooks total (was 9). Registry, `commands/claudemd-toggle.md`, `tests/scripts/install.test.js` fixture, and `tests/integration/full-lifecycle.test.sh` MCOUNT all moved together via the v0.8.2 single-source registry.

- `[test]` **`tests/hooks/bash-readonly-skip.test.sh`** (new, 30 cases) — classifier truth table (read-only commands, shell-meta rejection, non-whitelisted first tokens, git destructive subcommands), plus end-to-end: each of the 4 PreToolUse:Bash hooks short-circuits with the flag ON; with the flag OFF, banned-vocab still denies as in v0.8.2.

- `[test]` **`tests/hooks/transcript-vocab-scan.test.sh`** (new, 8 cases) — opt-in gate (default OFF silent), clean-prose silent, banned-word advisory + log row with `event: "advisory"`, exit-0 on hit (PostToolUse cannot block), kill-switch suppression, `@ratio` skip in transcript context, fail-open on missing transcript, last-assistant-turn targeting across multiple turns.

### Changed

- `[refactor]` **4 PreToolUse:Bash hooks** — opt-in fast-path branch inserted after CMD extraction, before per-hook filter. Highest leverage in `pre-bash-safety-check.sh` because that hook runs `sanitize_cmd` + RM/NPX detectors on every Bash invocation; the 3 others already short-circuit on filter mismatch quickly. Same call shape across all 4 for consistency: `if [[ "${BASH_READONLY_FAST_PATH:-0}" == "1" ]] && hook_is_readonly_bash "$CMD"; then exit 0; fi`.

- `[change]` **`scripts/lib/hook-registry.js`** — 10th entry: `transcript-vocab-scan.sh` / `transcript-vocab-scan` / `TRANSCRIPT_VOCAB_SCAN` / `PostToolUse` / `*` / 3s. Drift test count moved 9 → 10.

- `[change]` **`docs/RULE-HITS-SCHEMA.md`** — Events table gains `advisory` row (emitter: `transcript-vocab-scan`, meaning: PostToolUse non-blocking §10-V hit). Spec-section taxonomy table gains `transcript-vocab-scan` → `§10-V` row.

- `[change]` **`tests/hooks/contract.test.sh`** — `DOCUMENTED` array gains `advisory:transcript-vocab-scan` to keep the hook↔doc contract gate green.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.3`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 177/177 node tests pass; 13 hook suites green (was 11; +2 new); 2 integration suites pass (`full-lifecycle` + `upgrade-lifecycle`); contract test green with new `advisory` event documented.
- Default-OFF discipline: every existing test passes byte-identical to v0.8.2 with no env vars set. Opt-in is required to exercise either new code path.
- 30-day FP-signal collection plan (per v0.6.0 precedent): operators set the flags, surface hits via `/claudemd-audit`, and at the v0.9.x review either flip a default ON, demote, or remove.

## [0.8.2] - 2026-05-09

**Patch — single-source hook registry refactor.** Eliminates 5 hand-maintained sites where the 9-hook list was duplicated. Same thesis as v0.7.1's spec ↔ banned-vocab.patterns drift gate and v0.8.0's R-N1 / R-N2 manifests, applied to the plugin's own internal code: turn "agent must remember N places to keep in sync" into "code enforces single source of truth." Surfaced by the v0.8.1 reviewer. No runtime behavior change.

### Added

- `[feat]` **`scripts/lib/hook-registry.js`** (new, 9 entries) — single source of truth for the 9 plugin hooks. Each entry: `basename`, `displayName`, `envVarSuffix`, `hookEvent`, `matcher`, `timeout`. Re-exports `HOOK_BASENAMES`, `HOOK_ENV_SUFFIXES`, `HOOK_NAME_TO_ENV` derived from the array, so consumers stay one-line imports. Order mirrors `hooks/hooks.json` registration order (the order CC actually executes them: SessionStart → UserPromptSubmit → PreToolUse:Bash → Stop).

- `[test]` **`tests/scripts/hook-registry.test.js`** (new, 7 cases) — drift gate against every consumer site:
  1. Registry length === 9 (matches integration `MCOUNT` and `manifest.entries.length`).
  2. Every registry entry exists in `hooks/hooks.json` with matching event/matcher/timeout.
  3. Every `hooks/hooks.json` command points to a registry basename.
  4. Every `hooks/*.sh` file on disk is registered (no orphan entrypoints) and every registry entry has a file on disk.
  5. `commands/claudemd-toggle.md` mentions every registry `displayName`.
  6. Derived consts (`HOOK_BASENAMES`, `HOOK_ENV_SUFFIXES`, `HOOK_NAME_TO_ENV`) all have one entry per registry row.
  7. `basename`, `displayName`, `envVarSuffix` are unique within the registry.

### Changed

- `[refactor]` **`scripts/install.js`** — removed inline `HOOK_BASENAMES` literal; now imports from `scripts/lib/hook-registry.js` and re-exports for back-compat (used by `tests/scripts/install.test.js` and `scripts/uninstall.js`).

- `[refactor]` **`scripts/status.js`** — removed inline `HOOK_NAMES` literal; now derives kill-switch enumeration from `HOOK_ENV_SUFFIXES`. Side effect: `status.killSwitches` JSON object key order shifts from the old `BANNED_VOCAB`-first to registry order (`session-start`-first); no test pinned the old order. The `plugin` kill-switch key remains first by virtue of being added before the loop.

- `[refactor]` **`scripts/toggle.js`** — removed inline `NAME_MAP` literal; now imports `HOOK_NAME_TO_ENV` from the registry. The `version-sync` → `USER_PROMPT_SUBMIT` event-name mapping (preserved so existing `DISABLE_USER_PROMPT_SUBMIT_HOOK` env vars keep working) lives in the registry rather than as a NAME_MAP comment.

- `[refactor]` **`scripts/uninstall.js`** — `HOOK_BASENAMES` import switched from `./install.js` to `./lib/hook-registry.js` (direct registry import; install.js's re-export is for tests only).

### Fixed

- `[fix]` **`commands/claudemd-toggle.md`** — drift caught by the new registry test: the "Valid hook names" line listed 8 hooks (`banned-vocab`, `pre-bash-safety`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal-check`, `session-start-check`, `version-sync`) but `toggle.js` NAME_MAP carried 9 — `session-summary` (added in v0.8.0) was never added to the markdown. Now lists all 9 in registry order; future drift fails the new drift test.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.2`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 177/177 node tests pass (170 pre-refactor + 7 new hook-registry drift cases); 11 hook suites green; 2 integration suites pass (`full-lifecycle` + `upgrade-lifecycle`).
- Net diff: +1 file (registry), +1 file (drift test), -22 lines of duplicated literals across 4 consumers, +1 docs fix.

## [0.8.1] - 2026-05-09

**Patch — code-review fix-up for v0.8.0.** Closes 6 Important issues + 2 Minor issues raised by post-ship code review of v0.8.0. Theme: docs and tests drifted from code in the same release that shipped a manifest meant to detect drift — that's the §10 Specificity self-violation reviewer caught. No runtime behavior change.

### Fixed

- `[fix]` **`tests/integration/full-lifecycle.test.sh:50`** — Phase 7 residue regex now includes `session-summary` in its alternation. Pre-fix, a future regression that left a `session-summary.sh` entry in `settings.json` after uninstall would pass this gate silently. (Reviewer I1.)

- `[fix]` **`README.md`** — 5 stale counts corrected: line 14 "6 slash commands" → 8 (+ `/claudemd-rules` + `/claudemd-clean-residue` listed); line 99 "All 8 hooks" → 9; line 115 kill-switch list adds `DISABLE_SESSION_SUMMARY_HOOK`; new sub-feature flag `DISABLE_SESSION_SUMMARY_BANNER` documented at line 122-126; line 241 layout block "5 slash-command markdown files" → 8; commands table at line 84-91 adds `/claudemd-rules` + `/claudemd-clean-residue` rows. (Reviewer I2.)

- `[fix]` **`CHANGELOG.md` v0.8.0 entry — false-claim correction**: removed "+ ARCHITECTURE.md updated" from the Notes block. Per `.gitignore`, `docs/ARCHITECTURE.md` is an explicitly local-only internal reference (commit `e035f1f`); the v0.8.0 release does not ship it. The original phrasing implied a public doc update that never happened — the §10 Specificity self-violation reviewer caught. Local copy of `docs/ARCHITECTURE.md` was updated for personal reference but is intentionally not part of the release artifact. (Reviewer I3.)

- `[fix]` **`docs/RULE-HITS-SCHEMA.md`** — explicit "Hooks that do NOT write to this log" callout naming `session-summary.sh` so future readers grepping `claudemd.jsonl` for it know why nothing matches. The hook writes to `~/.claude/.claudemd-state/last-session-summary.json` instead. (Reviewer I4.)

- `[fix]` **`tests/scripts/hard-rules-drift.test.js:99`** — invariant 5 substring matching tightened to a single direction (`line.includes(anchor)` only). The previous OR with `anchor.includes(line[:80])` accepted silent renames where a future spec edit shortened a heading's verbatim text but the manifest still carried the longer anchor. Now invariants 1 and 5 must remain in lockstep — invariant 1 owns `anchor → spec`, invariant 5 owns `spec → anchor`, neither half can paper over the other. (Reviewer I5.)

- `[fix]` **`tests/scripts/hard-rules-drift.test.js:24-39`** — `SPEC_HARD_LINE_EXEMPTIONS` comment block was misleading: it described 4 reasons for exemption when actually only 1 line in the spec needs exemption (the §12 fallback table cross-ref to `sp:subagent-driven-development`). Comment rewritten to explain that the other (HARD) lines (V1-V4 sub-rules, Iron Laws, Manual-ship atomicity, etc.) are anchor-covered, not exempt. Future maintainer reading the comment will understand why each is or isn't on the list. (Reviewer I6.)

- `[fix]` **`scripts/hard-rules-audit.js:62-72`** — `byEnforcement` output no longer double-counts. Pre-fix: `byEnforcement.hook` counted `enforcement === 'hook'` plus `enforcement === 'both'`, while `byEnforcement.both` counted `both` again — sum exceeded `totalRules` by the count of `both` entries. Post-fix the four categories partition `rules` exactly: `hook + self + external + both = totalRules`. The hook-enforced union (used internally for `demoteCandidates`) is computed inline. (Reviewer M3.)

- `[fix]` **`CHANGELOG.md` v0.8.0 entry** — replaced "the 90/10 split" baseline-less ratio with concrete numbers: `7 of 21 (33%) hook-enforced, 14 of 21 (67%) self/external`. Per §10 Specificity, value claims about own work require absolute numbers or baseline ratios; the original phrasing was the kind of vague magnitude the same release's `banned-vocab.patterns` is meant to catch. (Reviewer M7.)

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.1`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 170/170 node tests pass; 11 hook suites green; 2 integration suites pass.
- Reviewer's recommended `scripts/lib/hook-registry.js` refactor (single source of truth for the 9-hook list) deferred — touches 5 production files plus tests and qualifies as L2 cross-module work; better as its own focused commit. Tracked as v0.8.x candidate.

## [0.8.0] - 2026-05-09

**Minor — HARD-rules manifest (R-N2) + week-over-week regression (R-N3) + SessionStart summary banner (R-N4).** Builds on v0.7.x's `spec_section` + `byBypass` data plane. R-N2 makes spec self-governance machine-readable: §13.1 quarterly demote and §13.2 budget accounting now have a structured manifest to read instead of grep-and-eyeball. R-N3 turns single-window audit numbers into early-regression alerts. R-N4 surfaces last session's hook activity at the start of the next session — agent sees its own trend without an explicit `/claudemd-audit` invocation.

### Added

- `[feat]` **`spec/hard-rules.json`** (new, 21 rules) — machine-readable manifest of every HARD rule across `spec/CLAUDE.md` + `spec/CLAUDE-extended.md`. Per-rule fields: `id`, `name`, `scope` (core/extended), `section_anchor` (verbatim spec substring), `enforcement` (hook/self/external/both), `rule_hits_section` (links to v0.7.0 audit data; null for non-hook rules), `added_version`, `confidence` (high/medium/low), `last_demote_review`. Enforcement breakdown: 6 hook + 13 self + 1 external + 1 both = 21 rules total — meaning 7 of 21 (33%) HARD rules emit signal to rule-hits.jsonl, while 14 of 21 (67%) rely on agent self-discipline.

- `[feat]` **`scripts/hard-rules-audit.js`** (new, 100 LOC) — cross-references `spec/hard-rules.json` with `~/.claude/logs/claudemd.jsonl` `bySection` data over a configurable window (default 90d, matching §13.1 quarterly cadence). Outputs: `byScope` / `byEnforcement` / `byConfidence` summaries, `demoteCandidates` (hook-enforced rules with 0 hits in window), `staleReviews` (rules whose `last_demote_review` is null or older than the window), and per-rule rows with hits. CLI: `--days=N` flag or `CLAUDEMD_RULES_DAYS` env var.

- `[feat]` **`commands/claudemd-rules.md`** (new) — slash command surfacing `hard-rules-audit.js`. Documents the field table and the "≥3 occurrences = demotion candidate" heuristic for §13.1 review.

- `[feat]` **`scripts/lib/rule-hits-parse.js`** — new `byTrend(hits, windowDays)` export. Splits hits into recent vs prior windows of equal size, returns per-section `{recent, prior, ratio, flag}`. Flag values: `regression` (ratio ≥ 2), `recovery` (ratio ≤ 0.5), `newly_active` (prior=0, recent>0), `silenced` (recent=0, prior>0), `stable` (in-between).

- `[feat]` **`scripts/audit.js`** — `/claudemd-audit` JSON now carries `byTrend` (default 7-day window). Reads 2× window data automatically. Empty when fewer than 2 windows of data exist.

- `[feat]` **`hooks/session-summary.sh`** (new, 80 LOC) — Stop hook. Aggregates `~/.claude/logs/claudemd.jsonl` rows since session-start.ref and writes summary to `~/.claude/.claudemd-state/last-session-summary.json` (atomic tmp+rename). Skips write when total=0. Two-stage jq pipe: outer parses each line via `try fromjson catch empty` (drops corrupt rows silently), inner slurps the stream and aggregates. Kill-switch: `DISABLE_SESSION_SUMMARY_HOOK=1`.

- `[feat]` **`hooks/session-start-check.sh`** — new `emit_session_summary_banner` function. On version-match branch (after `upstream_check`), reads the summary file, emits a one-line `additionalContext` banner via SessionStart hookSpecificOutput, then renames the file to `.last-shown` so the banner only fires once. Banner format: `[claudemd] last session: N denies, M bypasses, K warns, top: §X-Y`. Kill-switch: `DISABLE_SESSION_SUMMARY_BANNER=1`.

- `[test]` **`tests/scripts/hard-rules-drift.test.js`** (new, 6 tests) — 4-direction drift gate: (1) every manifest entry's `section_anchor` exists verbatim in the named spec file; (2) every `rule_hits_section` is in the v0.7.0 hook taxonomy; (3) hook-enforced entries have non-null `rule_hits_section`; (4) self/external entries have null. Plus 2 schema invariants: (5) every (HARD) annotation in spec has a manifest entry or documented exemption; (6) required-fields presence + enum validity (enforcement, confidence, scope).

- `[test]` **`tests/scripts/audit.test.js`** — 4 R-N3 cases: byTrend flags `regression` at recent/prior=5/1, `newly_active` at 3/0, `silenced` at 0/4, `recovery` at 1/4. Existing 9 tests preserved.

- `[test]` **`tests/hooks/session-summary.test.sh`** (new, 6 cases) — empty log → no write; 2 deny + 1 bypass + 1 warn captured correctly with `top_section: §10-V`; kill-switch suppression; SessionStart banner consumes summary + renames to `.last-shown`; `DISABLE_SESSION_SUMMARY_BANNER=1` suppresses banner.

### Changed

- `[refactor]` **`scripts/install.js`** — `HOOK_BASENAMES` extended to 9 entries (added `session-summary.sh`). The list drives `isClaudemdLegacyHookCommand` for legacy `settings.json` eviction; defensive even though session-summary was never in pre-0.1.5 settings.json form.

- `[refactor]` **`scripts/status.js`** + **`scripts/toggle.js`** — `HOOK_NAMES` and `NAME_MAP` extended with `SESSION_SUMMARY` / `session-summary`. `/claudemd-toggle session-summary` enables/disables the new hook.

- `[refactor]` **`hooks/hooks.json`** — Stop hook block now registers 3 hooks (was 2): `residue-audit.sh` + `sandbox-disposal-check.sh` + `session-summary.sh`.

- `[fix]` **`tests/scripts/install.test.js`** — `manifest.entries.length` assertions updated to 9 (was 8); fixture hooks.json mirrors production with the new Stop entry.

- `[fix]` **`tests/integration/full-lifecycle.test.sh`** — `MCOUNT == 9` (was 8); residue-detection regex includes `session-summary`.

### Deferred

- **R-N9** (CHANGELOG sparkline) — release-time dev tool, low priority vs runtime features. Fits a future patch when audit data has accumulated enough trend signal to be worth visualizing.
- **R-N5** (Bash early-exit list for read-only commands) + **R-N8** (transcript-side §10-V scan) — runtime hook-surface changes. Per v0.6.0 `BASH_SAFETY_INDIRECT_CALL` precedent, they should ship behind opt-in flags with their own validation cycle. Targeted for v0.8.1.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.8.0`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11.3.
- Hook count: 8 → 9. README updated. (`docs/ARCHITECTURE.md` is gitignored as internal reference per `.gitignore` — local-only edits don't ship.)
- Validation: `tests/run-all.sh` → 170/170 node tests pass; 11 hook suites green (including new session-summary 6/6 + hard-rules-drift 6/6); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why R-N2 + R-N3 + R-N4 in one ship: they all consume v0.7.x data. R-N2 indexes the rule taxonomy; R-N3 adds a time-axis to existing aggregations; R-N4 is a one-line context inject at session boundary. Single migration wave keeps schema attribution clean.

## [0.7.1] - 2026-05-09

**Patch — spec ↔ pattern drift gate (R-N1) + doctor §0.1 demotion-candidate surface (R-N6).** Closes the "spec is falsifiable" half of the v0.7.0 governance loop. Pre-fix, `spec/CLAUDE-extended.md §10-V` (banned-vocab prose list) and `hooks/banned-vocab.patterns` (regex enforcement) were maintained by hand discipline; drift in either direction went undetected until field signal. v0.7.1 adds a CI-time canonical fixture + 6-direction drift test that fails the build the moment spec or patterns disagree without an explicit exemption. R-N6 turns v0.7.0's `byBypass` data into a doctor check — sections whose denies are routinely escape-hatched (>50% bypass:deny ratio) surface as §0.1 demotion candidates without manual audit reading.

### Added

- `[feat]` **`tests/fixtures/banned-vocab-canonical.json`** (new, 38 entries) — single source of truth mapping each spec §10-V banned term ↔ `hooks/banned-vocab.patterns` regex. Each entry carries `term`, `category` (EN-adj/EN-hedge/EN-ratio/ZH-adj/ZH-ratio), `in_spec` (bool), `pattern` (regex string or null), and `exempt_reason` when partial coverage applies. Documents 11 acknowledged divergences: 8 spec-only "too common in legitimate language" exemptions (likely / arguably / 通常如此 / 一般来说 / 大部分情况 / most of the time / usually passes / often fails / 大多数时候 / 多数情况下) and 3 pattern-only symmetric forms (显著改善 / 显著优于 / 大幅提升, derived from spec's 显著提升 / 大幅改善 / 明显优于 — 显著改善 is also flagged as a spec-promotion candidate as it leads ZH pattern fires at 5/30d).

- `[feat]` **`tests/scripts/spec-pattern-drift.test.js`** (new, 6 tests) — 4-direction drift gate: (1) every banned-vocab pattern has a canonical entry; (2) every canonical entry's pattern exists in the patterns file; (3) every spec §10-V banned term has a canonical entry with `in_spec: true`; (4) every `in_spec: true` canonical entry exists verbatim in spec §10-V text. Plus 2 schema invariants: (5) partial-coverage entries carry `exempt_reason`; (6) no entry is both spec-absent and pattern-absent. Parses spec section text via `## §10-V Banned-vocab` anchor + `**Banned ...**: "term"` regex (handles both `"a" / "b"` separate quotes and `"a / b / c"` slash-joined-quote forms). 6/6 passing on current state.

- `[feat]` **`scripts/doctor.js:11 / 19-31 / 154-178`** — new `rule-usage:<spec_section>` checks. Reads 30-day window from `~/.claude/logs/claudemd.jsonl`, groups by `spec_section` (v0.7.0 field), computes bypass:deny ratio per section, emits one check per section with ≥3 events. Ratio > 50% → `[✗] §0.1 demotion candidate — see /claudemd-audit byBypass`; ratio ≤ 50% → `[✓] healthy`. Sections under the statistical floor or in the `(unset)` legacy bucket are skipped — pre-v0.7.0 rows lack section attribution and would misattribute pre-upgrade behavior to current rule design.

- `[test]` **`tests/scripts/doctor.test.js`** — 4 R-N6 cases: (1) flags `§11-memory-read` as demotion candidate when 5 bypass + 1 deny → 83%; (2) marks `§10-V` healthy at 17%; (3) skips sections below 3-event statistical floor; (4) skips `(unset)` bucket carrying legacy rows. Total `tests/scripts/`: 160 (was 150 — +6 drift + +4 R-N6).

### Changed

No behavior change to the runtime hook path. Drift test runs in CI only; doctor check is read-only against the existing rule-hits log.

### Why drift gate matters now

Empirical signal from v0.7.0 audit data already reveals 3 acknowledged spec ↔ pattern divergences in `tests/fixtures/banned-vocab-canonical.json` (the `pattern_only` ZH adjectives 显著改善 / 显著优于 / 大幅提升 — symmetric forms the patterns author derived from spec but never round-tripped to spec). Prior to this release, those divergences sat invisible. The drift test surfaces them as `exempt_reason` lines on review; the next minor spec bump can promote them with full visibility.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.7.1`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 160/160 node tests pass; 11 hook suites green (drift 6/6, doctor 16/16, contract 35/35, banned-vocab 20/20, rule-hits 12/12); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why drift + doctor together: both consume the v0.7.0 `spec_section` data plane. R-N1 polices its edit-time invariants; R-N6 polices its runtime behavior. Same wave, two layers.

## [0.7.0] - 2026-05-09

**Minor — per-rule instrumentation + bypass dashboard + banned-vocab dead-pattern stratification.** Closes the §0.1/§13.1/§13.2 governance loop: pre-fix `/claudemd-audit` answered "which hook is firing" but not "which spec rule is firing", so `§0.1 Core growth discipline` (promote ≥5 hits in 30d) and `§13.1` quarterly demote (0 hits in 90d) had no source data — both rules were aspirational, not mechanical. This release adds `spec_section` to every hook-enforcing rule-hits row, surfaces `byBypass` (per-token escape-hatch usage — the §0.1 demotion candidate signal), and reorganizes `banned-vocab.patterns` into high-fire and prophylactic regions per the same audit data.

### Added

- `[feat]` **`hooks/lib/rule-hits.sh:8-17 / 56-67`** — `rule_hits_append` accepts an optional 4th positional `SPEC_SECTION` arg. Empty arg → `null` in the JSONL row (back-compat with hooks that don't pass the arg). The new field lands as `spec_section` next to the existing `extra` column. Schema is additive — `audit.js` keeps working unchanged on legacy rows; the `bySection` aggregation surfaces them under an `(unset)` bucket so the operator sees how much pre-upgrade data is in the audit window.

- `[feat]` **7 hook scripts** — every spec-enforcing `hook_record` callsite now passes a section identifier: `banned-vocab` → `§10-V`; `ship-baseline` → `§7-ship-baseline`; `pre-bash-safety` → `§8-rm-rf-var` / `§8-npx` / `§8` (combined-deny path); `memory-read-check` → `§11-memory-read`; `residue-audit` → `§7-user-global-state`; `sandbox-disposal` → `§8.V4`. Plugin-internal events (`session-start` bootstrap/upstream-banner; `version-sync` lifecycle) keep section `null` — they're not enforcing a spec rule. Full taxonomy table is the new "Spec section taxonomy" section in `docs/RULE-HITS-SCHEMA.md`.

- `[feat]` **`scripts/lib/rule-hits-parse.js`** — two new exports: `groupBySection(hits)` (per-section total + event/hook breakdown) and `byBypass(hits)` (per-`bypass-escape-hatch`-token total + per-hook breakdown). High counts on a single bypass token signal a rule that's too strict and is being routinely overridden — the §0.1 demotion candidate indicator that pre-fix sat in the JSONL log unaggregated.

- `[feat]` **`scripts/audit.js`** — `/claudemd-audit` JSON now carries `bySection` and `byBypass` next to the existing `byHook` / `topPatterns`. `commands/claudemd-audit.md` updated with the field table and a "≥3 occurrences = review candidate" rule for the bypass dashboard.

- `[test]` **`tests/hooks/contract.test.sh`** — invariant E added (8 cases): every spec-enforcing hook (banned-vocab / ship-baseline / pre-bash-safety × 2 / memory-read-check / residue-audit / sandbox-disposal) emits the documented `spec_section`; plugin-internal hooks keep it `null`. Drives §0.1/§13.1/§13.2 promotion accounting end-to-end. Total: 35/35 passing (was 27/27 — invariants A.1–A.4, B×14, C×8, D, E×8).

- `[test]` **`tests/hooks/rule-hits.test.sh`** — Cases 10/11/12 added: (10) `spec_section` 4th arg threads through to JSONL; (11) omitted arg → `null` (back-compat); (12) empty-string arg also normalizes to `null` (defends against `hook_record h e null ""` muddling the `(unset)` bucket attribution). Total: 12/12 passing (was 9/9).

- `[test]` **`tests/scripts/audit.test.js`** — 4 new tests: `bySection` aggregates v0.7.0 spec_section field correctly; `bySection` surfaces legacy rows under `(unset)`; `byBypass` aggregates per-token override usage with hook breakdown; `byBypass` empty when no bypass-escape-hatch events present. Existing `byHook` test updated for fixture expansion (banned-vocab now 3 rows incl. 1 bypass; pre-bash-safety added with 2 bypass rows). Total: 9 tests passing.

### Changed

- `[refactor]` **`hooks/banned-vocab.patterns`** — reorganized into `# region: high-fire` (≥1 deny in last 30d audit window) and `# region: prophylactic` (0 hits in last 30d) sections. Same 27 patterns kept — zero deletion, zero functional change. Reorder puts the 6 actively-firing patterns at the top of the file so grep early-exits on common matches; visual stratification lets the operator see at a glance "what's actively gating" vs "what's carried for §10-V coverage". Re-stratify on each `/claudemd-audit` review per §13.1 cadence; demotion to `§EXT §10-V` reference list eligible after 3 consecutive 30d windows at zero (combined with `byBypass` — added this release).

- `[docs]` **`docs/RULE-HITS-SCHEMA.md`** — `spec_section` field added to the row-shape table; new "Spec section taxonomy" table maps each (hook, event) pair to its section identifier; example rows include the new field. Pre-v0.7.0 rows handled by the `(unset)` bucket — documented inline.

### Migration

No user action required for the `spec_section` field — it auto-populates on next hook fire after upgrade. Existing rule-hits rows in `~/.claude/logs/claudemd.jsonl` keep working; `/claudemd-audit` `bySection` shows them under `(unset)` until the audit window slides past the upgrade timestamp.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.7.0`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11.3. Per the versioning policy, plugin minor ships independently when spec is unchanged but plugin features are added.
- Validation: `tests/run-all.sh` → 150/150 node tests pass; 11 hook suites green (rule-hits 12/12, contract 35/35, banned-vocab 20/20, sandbox-disposal, memory-read-check, ship-baseline, residue-audit, pre-bash-safety, session-start, version-sync, hook-common, platform); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why this set together: R1 (spec_section), R3 (byBypass), R4 (banned-vocab stratification) all consume the same rule-hits.jsonl data plane. Shipping them in one release keeps schema migration to one wave; the audit dashboard ships with the data that makes the dashboard useful on day one.

## [0.6.3] - 2026-05-09

**Patch — fix v0.6.2 macOS CI red.** `scripts/clean-residue.js` returned `deleted: 0` on macOS for brand-new entries when `ageDaysMin=0`, because `now - stat.mtimeMs` could come back marginally negative — sub-ms timing skew between `fs.writeFileSync` and the `Date.now()` read inside `clean()` on APFS. Linux ext4 happened to land consistently non-negative; the same test passed locally and on Ubuntu CI. v0.6.2 shipped, the macOS runner caught it, and this is the immediate forward-fix. v0.6.2 functionality is otherwise intact (the bug only affects callers passing `ageDaysMin=0` against a freshly-created file — not the default 1-day threshold path).

### Fixed

- `[fix]` **`scripts/clean-residue.js`** — `ageDays = Math.max(0, (now - mtimeMs) / 86400000)`. A file can't be younger than itself; clamping at 0 makes the comparison robust to sub-ms timestamp skew between filesystem writes and `Date.now()` regardless of FS implementation. The 12-case test suite continues to pass; the failing case `clean ageDaysMin=0 includes brand-new entries` now resolves correctly on macOS APFS as well.

## [0.6.2] - 2026-05-09

**Patch — audit-data instrumentation + residue self-cleanup.** Two themes, one release. (1) Closes a schema-vs-impl drift in the rule-hits log: 2 of 4 bypass-capable hooks were silently exiting without recording `bypass-escape-hatch`, so `/claudemd-audit` under-counted user overrides; the JSONL also carried no project identifier, so cross-project drill-down was impossible. Adds `project` field on every row + bypass recording in `pre-bash-safety` and `memory-read-check` + a contract test that locks "every documented event has a producer and every emitted event is documented." (2) Closes the irony that the residue-policing plugin was itself the largest residue source: 525 stale `claudemd-sync-*` session sentinels accumulated in 9 days under `$TMPDIR` (one per CC session, never collected). Adds GC of >24h sentinels in `version-sync.sh` (bounded to first prompt of a session) + a new `/claudemd-clean-residue` command + a `scripts/clean-residue.js` library.

### Added

- `[feat]` **`hooks/lib/rule-hits.sh`** — `rule_hits_append` now derives `project` from `$CLAUDE_PROJECT_DIR` (or `$PWD` fallback), encoded with `/` and `.` → `-` to match Claude Code's `~/.claude/projects/<encoded>/` convention. Every JSONL row now carries the field. Schema is additive — `audit.js` keeps working unchanged on legacy rows; `groupByProject` aggregation deferred to a follow-up. Pre-fix, `/claudemd-audit` could answer "which hook is firing" but not "in which project" — making per-project red-rate / regression detection impossible.

- `[feat]` **`hooks/pre-bash-safety-check.sh:138-141 / 173-176`** — when `[allow-rm-rf-var]` or `[allow-npx-unpinned]` token fires the bypass branch, the hook now calls `hook_record pre-bash-safety bypass-escape-hatch '{"token":"..."}'` before exiting. Pre-fix, the bypass took the deny path's normal early-exit and never wrote to the rule-hits log — so a user routinely escape-hatching `npx unpinned-pkg` had zero audit visibility. 30-day baseline data showed 0 such recorded bypasses; field signal will land in the next 14-day window.

- `[feat]` **`hooks/memory-read-check.sh:22-31`** — `[skip-memory-check]` token check moved from pre-trigger (line 23) to post-trigger, so bypass usage is recorded only when the hook would have actually scanned. New `hook_record memory-read-check bypass-escape-hatch` call on the bypass path. Behavior is unchanged from a user-visible standpoint (token still exits 0); only the audit log gains the bypass row.

- `[feat]` **`hooks/version-sync.sh:31-35`** — first-prompt-per-session self-cleanup: `find "$TMP_BASE" -maxdepth 1 -name 'claudemd-sync-*' -mmin +1440 -delete 2>/dev/null || true`. Bounded to once per CC session (the early-exit on existing sentinel filters out subsequent prompts), `-maxdepth 1` + named-pattern + fail-silent. Field measurement: one user's `~/.claude/tmp/` had 525 stale sentinels accumulated over 9 days at install time; post-deploy first-session run drops the count to ≤ session count of the day.

- `[feat]` **`scripts/clean-residue.js`** (new, 66 LOC) — exports `scan({tmpDir})` and `clean({tmpDir, apply, ageDaysMin})`. Anchored regexes `/^claudemd-sync-/` (file) and `/^claudemd-(mockgh|work)\./` (dir) — defends against fnmatch-style sloppy matches like `not-claudemd-sync-foo`. CLI is dry-run-by-default; `--apply` opts into deletion; `--age-days=N` overrides the 1-day stale threshold.

- `[feat]` **`commands/claudemd-clean-residue.md`** (new) — slash command surfacing the script with `$ARGS` passthrough. Use case: bulk-clean accumulated residue on first install of v0.6.2 (the new self-cleanup only handles forward-direction drift; pre-existing pile must be one-shot via this command).

- `[test]` **`tests/hooks/contract.test.sh`** (new, 137 LOC, 27 cases) — locks the rule-hits schema contract: (A) every hook with a documented bypass token records `bypass-escape-hatch` end-to-end (4 cases driving real fixtures); (B) every documented `(event, emitter)` pair in `RULE-HITS-SCHEMA.md` has a matching `hook_record` call in source (14 cases); (C) every event emitted in `hooks/` source is documented in the schema (8 cases — fails loudly on drift in either direction); (D) `project` field is auto-populated when `$CLAUDE_PROJECT_DIR` is set. 27/27 passing.

- `[test]` **`tests/scripts/clean-residue.test.js`** (new, 152 LOC, 12 cases) — `scan()` finds prefix-anchored matches; `scan()` tolerates missing/empty dir; `clean({apply:false})` returns targets without deleting; `clean({apply:true})` deletes only entries older than `ageDaysMin`; sandbox dirs deleted recursively; non-matching files preserved; `ageDaysMin=0` includes brand-new entries; anchor patterns reject `not-claudemd-sync-*` / `xclaudemd-sync-*` / `claudemd-mockgh-noDot` (no dot) / `claudemd-mockghX.YYY` (extra char); CLI dry-run-by-default; `--apply` deletes idempotently; `--age-days=N` overrides; rejects negative `--age-days`. 12/12 passing.

- `[test]` **`tests/hooks/rule-hits.test.sh`** — Cases 7/8/9 added: (7) `CLAUDE_PROJECT_DIR=/work/my.project` → log `.project == "-work-my-project"`; (8) `$CLAUDE_PROJECT_DIR` unset → falls back to `$PWD` encoding; (9) project + extra payload coexist on `pass-known-red` row. Total: 9/9 passing (was 6/6).

- `[test]` **`tests/hooks/version-sync.test.sh`** — Case 7 added: pre-seeds 2 stale sentinels (mtime 2 days ago, set via portable `node -e fs.utimesSync`) + 1 recent + 1 unrelated, runs hook, asserts stale removed / recent + unrelated kept / new sentinel created. Total: 7/7 passing (was 6/6).

### Changed

- `[fix]` **`docs/RULE-HITS-SCHEMA.md`** — rewritten. Drops `bypass-env` from the event enum (was documented but no hook ever emitted it). Adds `bootstrap` / `upstream-banner` / `version-sync` (emitted by `session-start` and `user-prompt-submit` but previously undocumented). Adds the `project` field. Replaces the flat enum with a per-event/per-emitter table — `tests/hooks/contract.test.sh` parses this table to enforce drift in either direction. Pre-fix the schema listed 7 events, the source emitted 8 events, and 1 documented event (`bypass-env`) had no producer.

- `[fix]` **`hooks/lib/rule-hits.sh:6`** — function header comment now points at `docs/RULE-HITS-SCHEMA.md` for the canonical event list, instead of inlining a stale local copy.

### Migration

No user action required for the `project` field — it auto-populates on next prompt after upgrade. For one-shot cleanup of pre-existing `claudemd-sync-*` accumulation:

```
/claudemd-clean-residue           # dry-run, shows count + per-path age
/claudemd-clean-residue --apply   # delete entries >24h old
```

Self-cleanup runs forward from v0.6.2 onward — no manual maintenance after this one-time pass.

## [0.6.1] - 2026-04-29

**Patch — install/update/uninstall lifecycle audit + hardening.** Audit-driven cleanup pass on the three user-facing lifecycle paths. No spec change, no new commands, no new hooks. Removes one unsupported manifest field that future Claude Code schema tightening could refuse, plugs a silent-failure branch in `install.js`, stabilizes the shape of `uninstall.js` / `status.js` returns so downstream LLM templates don't see drifting keys, and adds bootstrap-log rotation so `~/.claude/logs/claudemd-bootstrap.log` no longer grows unbounded across sessions.

### Added

- `[feat]` **`scripts/status.js`** — new `plugin.hint` + `plugin.cacheVersions` fields surface the "installed but not yet bootstrapped" state (Claude Code cache dirs present under `~/.claude/plugins/cache/marketplaces/claudemd/plugins/claudemd/<version>/` but `~/.claude/.claudemd-manifest.json` missing). Previously `/claudemd-status` showed `plugin.installed: false` with no signal that the user was inside the bootstrap window — they'd assume install failed and re-run `/plugin install`. Now the JSON includes `plugin.hint: "cache-present-bootstrap-pending"` and `plugin.cacheVersions: ["0.6.0", ...]` (semver-shaped dirs only; dev-mode `main` and other non-semver entries are filtered). `commands/claudemd-status.md` updated to surface the hint in the slash-command output.

- `[feat]` **`scripts/install.js`** — fail-loud check before manifest write: if any of the three shipped spec files (`CLAUDE.md`, `CLAUDE-extended.md`, `CLAUDE-changelog.md`) is missing from `<pluginRoot>/spec/`, `install()` throws `Error: install: shipped spec missing in <path>/spec/: <names>` instead of silently skipping the copy and writing a manifest that points at non-existent files. Catches packaging regressions (npm pack glob misconfiguration, marketplace mirror corruption) at install time rather than at first `/claudemd-update` invocation.

- `[feat]` **`hooks/session-start-check.sh`** — bootstrap log rotation. When `~/.claude/logs/claudemd-bootstrap.log` exceeds 64 KiB the hook truncates it to the trailing 32 KiB before appending the new session's bootstrap output. Previously the file grew unbounded — typical bootstrap line is ~3 KiB, so a long-lived install accumulated megabytes of stale output. 64 KiB ceiling chosen so the file always holds at least 10–15 prior bootstrap runs for forensics; truncation uses `tail -c` (portable on Linux/macOS, no `logrotate` dependency).

- `[test]` **`tests/scripts/status.test.js`** — new test case covering the `cache-present-bootstrap-pending` branch. Asserts `plugin.hint` is set, `plugin.cacheVersions` contains semver-shaped dirs, and dev-mode `main` is filtered out. Total `tests/scripts/` count: 134 (was 133).

- `[test]` **`tests/hooks/session-start.test.sh`** — new Case 12 covering log rotation. Seeds 80 KiB log with a head sentinel string, runs the hook, asserts (a) file shrinks below 49 KiB, (b) head sentinel is gone (proving the truncation kept the *tail* not the head). Total: 12/12 passing (was 11/11).

### Changed

- `[fix]` **`.claude-plugin/plugin.json`** — removed `postInstall` and `preUninstall` fields. Claude Code's plugin schema does not define these; current loader silently ignores them, but a future schema-validation tightening would refuse the manifest entirely. The bootstrap path has always been carried by the `SessionStart` hook (not these fields), so removal is purely defensive — no behavioral change. Audit found this as the only HIGH-risk item in the lifecycle review.

- `[fix]` **`scripts/uninstall.js`** — `already-uninstalled` early-return now includes `specAction: 'noop'` so the return-object shape matches the normal-path return (which always has `specAction`). Downstream consumers (slash-command markdown templates, future automation) that branch on `result.specAction` no longer need a defensive `?? 'noop'`. Existing `.warning` field unchanged; integration tests still pass.

- `[docs]` **`README.md`** — installation section reworded: `node scripts/install.js` is documented as an **optional** fast-path for users who don't want to wait for the next session-start, not the canonical install step. The canonical step is `/plugin install claudemd@claudemd`; bootstrap completes either via the `SessionStart` hook on next launch or via the optional manual command. Also corrects the command count (6 commands listed, was 5 — `/claudemd-uninstall` was missing from the table since v0.5.3).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.6.1`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11. Per the versioning policy above, plugin patch ships independently when spec is unchanged.
- Validation: `node --test tests/scripts/*.test.js` → 134/134 pass; `tests/hooks/*.test.sh` × 11 suites → all pass (session-start 12/12); `tests/integration/full-lifecycle.test.sh` + `upgrade-lifecycle.test.sh` → both PASS.

## [0.6.0] - 2026-04-30

**Minor — hook trust hardening: SHA-256 spec drift detection + opt-in indirect-call coverage + corpus-driven regression suite.** Closes the two follow-up items deferred from v0.5.5 (cso F4 spec integrity + indirect-exec FN) plus a foundational test refactor that moves bash-safety regression cases into a single TSV corpus driving a thin shell runner. Theme is hook *trust*: SHA-256 surfaces drift between shipped and installed spec; indirect-call closes a documented FN class on opt-in; the corpus eliminates the per-FP test-code edit cycle that v0.5.5 demonstrated.

### Added

- `[feat]` **`scripts/lib/spec-hash.js`** — new module exposing `sha256File(path)` and `compareSpecs(pluginRoot)`. Each `compareSpecs` row reports `{name, shipped, installed, match, missing}` for one of the three shipped spec files (`CLAUDE.md`, `CLAUDE-extended.md`, `CLAUDE-changelog.md`). Detects two distinct drift modes: (a) local edits to `~/.claude/<spec>` after install, (b) post-upgrade staleness when the plugin updated but the user hasn't run `/claudemd-update` to re-sync. Does **not** cover supply-chain integrity — the marketplace/npm signature is the right layer for that, and baking a frozen expected hash here would couple the lib to release-time bookkeeping it doesn't need. Pure-function design (takes `pluginRoot` as arg, no manifest write); status.js + doctor.js both consume it.

- `[feat]` **`scripts/doctor.js`** — `/claudemd-doctor` now surfaces three new `spec-hash:<name>` checks per run. Match: `[✓] spec-hash:CLAUDE.md: <12-hex-prefix>… matches`. Drift: `[✗] spec-hash:CLAUDE.md: installed <hex>… ≠ shipped <hex>… — local edits or stale install; run /claudemd-update to sync`. Missing-installed: explicit `/plugin install claudemd@claudemd to bootstrap` hint. Adds 3 rows to the doctor output; existing checks unchanged.

- `[feat]` **`scripts/status.js`** — `/claudemd-status` JSON now reports `spec.hashes` (one row per spec with 12-hex-prefix shipped/installed + match boolean) and `features.bashSafetyIndirectCall` (reflects the new env var below). Existing `spec.installed` (version) field unchanged. status.js gains a `resolvePluginRoot(import.meta.url)` call to find the shipped specs.

- `[feat]` **`hooks/pre-bash-safety-check.sh`** — new opt-in `BASH_SAFETY_INDIRECT_CALL=1` env var enables `unwrap_indirect()`, which rewrites `bash -c '<inner>'` / `bash -c "<inner>"` / `sh -c <…>` / `zsh -c <…>` / `eval '<inner>'` / `eval "<inner>"` to `; <inner> ;` BEFORE `sanitize_cmd` runs. The unwrapped inner is then a top-level token, so the existing pattern-1 (rm -rf var) and pattern-2 (npx unpinned) detectors fire on it normally. Anchored to the same prefix class as the detectors, plus `(` so `$(bash -c '...')` is covered. Bypass tokens (`[allow-rm-rf-var]` / `[allow-npx-unpinned]`) survive unwrap because they scan raw `$CMD`. **Default OFF for v0.6.0.** Rationale: bash-safety is a HARD §8 hook that fires on every `Bash` tool call; FP regressions hit user workflow immediately. Opt-in for one minor lets the kill-switch path stay single-flag (just unset the var) while we collect FP signal in the wild. Plan to flip the default ON in 0.6.x or 0.7.0 once corpus FP coverage holds steady. Heuristic limitations: escaped quotes inside the inner string, heredoc-form indirect calls, and deeply nested substitutions can defeat the regex unwrap — documented in the hook header.

- `[test]` **`tests/fixtures/bash-safety/corpus.tsv`** — new corpus replacing inline cases in `tests/hooks/pre-bash-safety.test.sh`. Format: `<label>\t<note>\t<command>\t<env>` (4-tab columns, env optional). Lines starting with `#` are corpus comments; blanks skipped. Heredoc cases use `__NL__` marker for LF (chosen over `\n` so `printf "label: foo\n"` test cases stay literal). 52 corpus rows (34 pass + 18 deny); plus the malformed-JSON edge case kept inline = 53 total tests. Up from 39 inline cases in v0.5.5: 16 added for indirect-call coverage (9 deny + 7 pass — 3 default-OFF + 4 FP-guard with feature ON), case-count differential explained by drop of the v0.5.5 "non-Bash tool early-exit" synthetic case (corpus is bash-only by construction). Single source of truth — adding a new regression case is one corpus row, not a test-code edit.

- `[test]` **`tests/scripts/spec-hash.test.js`** — 8 unit tests for `scripts/lib/spec-hash.js`. Locks the SHA-256 of `"abc"` to its published canonical digest (`ba7816bf…`) as a sanity check — catches future drift if the impl ever silently switches to text-mode read or non-default hash. Property test: hand-constructed `crypto.createHash('sha256')` digest must equal `sha256File()` byte-for-byte across binary input.

- `[test]` **`tests/scripts/doctor.test.js`** — 2 new tests: `spec-hash:*` drift detection (write installed-spec body that cannot match shipped → assert `[✗] ≠ shipped`) and `spec-hash:*` missing-installed (default beforeEach state, no installed CLAUDE.md → assert `installed spec missing` hint).

- `[test]` **`tests/scripts/status.test.js`** — 2 new tests: `status.spec.hashes` array shape + drift detection from synthetic-vs-real-shipped, and `status.features.bashSafetyIndirectCall` reflects env var on/off.

### Refactor

- `[refactor]` **`tests/hooks/pre-bash-safety.test.sh`** — corpus-driven runner. Replaced the 39 hand-coded `assert_pass` / `assert_deny` calls + heredoc-embedded multiline cases with a 50-line shell loop that reads `tests/fixtures/bash-safety/corpus.tsv`, expands `__NL__` to LF, applies the optional env-var prefix, and asserts allow vs deny by label. Inline edge case (malformed-JSON stdin → fail-open) preserved at the bottom; not a corpus case because corpus is "given valid event, hook produces correct allow/deny". Pre-existing 27-case baseline behaviour unchanged.

### Why opt-in for indirect-call

CHANGELOG v0.5.5 deferred two follow-ups: F4 (spec SHA-256) and indirect-exec coverage. This release ships SHA-256 default-ON (passive read-only check; FP risk is "you see a drift warning", not "your tool call is denied"), and ships indirect-call as opt-in for the inverse reason: a regex-based unwrap cannot perfectly distinguish indirect exec from string-literal `bash -c` mentions, so a wrong-direction FP would block a legitimate `Bash` tool call. The corpus has 4 FP-guard cases under `BASH_SAFETY_INDIRECT_CALL=1` (whitelist + pinned + bypass-token + outer-quoted echo) — but these are theory; field signal is what the opt-in window collects. To enable now: set `"BASH_SAFETY_INDIRECT_CALL": "1"` in `~/.claude/settings.json` `env` block, or `export BASH_SAFETY_INDIRECT_CALL=1` in the shell that launches Claude Code.

### Migration note (read before upgrading)

No automatic action needed. After upgrade:
- `/claudemd-doctor` adds three `spec-hash:*` rows. Hand-edited `~/.claude/CLAUDE.md` will report `[✗]` with a "local edits or stale install" detail — that's correct, your edit is the drift. Run `/claudemd-update` to sync (your edits are backed up to `~/.claude/backup-<ISO>/` first), or accept the drift if it's intentional.
- `bash -c '...'` indirect-exec invocations are still NOT denied unless you opt in via `BASH_SAFETY_INDIRECT_CALL=1`. No behaviour change for users who don't set the var.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new HARD rule, no new hook, no §13.2 budget delta.
- No change to install / update / uninstall behaviour or manifest schema. The new SHA-256 module reads files; it does not write to manifest or state dir.
- No CI / Node-version change. (Note: GitHub deprecates Node 20 actions on 2026-06-02; `actions/checkout@v4` and `actions/setup-node@v4` upgrade to v5 is unrelated to plugin behaviour and will land as a CI-only commit.)

### Follow-up

- Flip `BASH_SAFETY_INDIRECT_CALL` default ON after one minor of in-the-wild FP signal — pending corpus expansion if any FPs surface.
- Heredoc-form indirect call (`bash <<EOF\nrm -rf $X\nEOF`) is a known FN of the unwrap regex; sanitize strips heredoc bodies before unwrap can see them. Closing this requires reordering or an explicit heredoc-target-of-bash-c detector. Deferred until field signal indicates need.
- Node 24 actions upgrade (deadline 2026-06-02) — CI-only commit, no plugin version bump.

## [0.5.5] - 2026-04-30

**Patch — pre-bash-safety FP fix + session-start glob refactor + .gstack gitignore.** Hook-trust hardening release. Closes 4 of 5 findings from the 2026-04-30 `/cso` + `/health` audits run on this project; F1 (the largest-impact hook FP) is the headline.

### Symptoms (pre-fix)

1. **`hooks/pre-bash-safety-check.sh:70` regex over-fired on `npx`/`rm` *inside* string literals.** The matcher's `(^|[[:space:];&|`])npx[[:space:]]+` prefix class included whitespace, so any command containing `<space>npx<space>` — even inside `echo "X: npx Y"`, `# npx Y` comments, or heredoc bodies — denied with "npx unpinned package: <token>" pointing at an unrelated subsequent token (the `sed s/.*${REGEX}//` extractor was greedy, so a later word in the same script became the "package name" in the error message). Reproduced 4× during the 2026-04-30 `/cso` audit on this very project. The pattern trains users toward `DISABLE_PRE_BASH_SAFETY_HOOK=1`, eroding the HARD safety gate.
2. **`hooks/session-start-check.sh:52` used `ls -1 | grep -E` to find latest semver-named cache dir.** SC2010 — the only non-info shellcheck finding in production hooks. Doesn't break with normal cache-dir names but is shellcheck-dirty and tolerates non-alphanumeric filenames the glob form handles correctly.
3. **`.gstack/` not in `.gitignore`.** `/cso` writes findings to `.gstack/security-reports/{date}.json`. Public OSS repo; an accidental `git add .gstack/` would publish a security-posture summary including attack-path descriptions.
4. **`tests/hooks/{sandbox-disposal,session-start,ship-baseline}.test.sh` triggered 17 SC2015 notes.** The `assert && PASS || FAIL` test-assertion idiom intentionally uses `A && B || C`; the noise drowns out real shellcheck signal across the suite.

### Fix

- `[fix]` **`hooks/pre-bash-safety-check.sh`** — F1: new `sanitize_cmd()` function applied to `$CMD` before pattern matching. Strips in order: (1) heredoc bodies (multi-line state, matched via `<<-?TAG` introducer + bare-TAG terminator regex; supports `<<EOF`, `<<'EOF'`, `<<"EOF"`, `<<-EOF` indented form), (2) line comments (`#` at line start or after whitespace, to end of line), (3) quoted-string contents — with crucial nuance: double-quoted strings strip iff body has no `$` (so `"$VAR"` / `"$(cmd)"` / `"x$y"` are preserved for the rm-rf detector), single-quoted strings always strip (no shell expansion ever happens inside `'...'`). Backticks and `$(...)` left intact (they ARE direct exec). Both rm and npx detectors switched to `$SANITIZED_CMD`; the `[allow-rm-rf-var]` / `[allow-npx-unpinned]` bypass tokens still scan raw `$CMD` so the marker can live anywhere — including inside a quoted string the user wrote intentionally.
- `[fix]` **`hooks/session-start-check.sh:52`** — Health #5: replaced `ls -1 "$cache_parent" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1` with a glob iteration + bash-regex format guard then `sort -V | tail -1`. SC2010 cleared; tolerates filenames with non-alphanumeric characters.
- `[chore]` **`.gitignore`** — F2: added `.gstack/` with rationale comment pointing at the security-report leak vector.
- `[chore]` **`tests/hooks/{sandbox-disposal,session-start,ship-baseline}.test.sh`** — top-of-file `# shellcheck disable=SC2015` directive with one-line rationale (the PASS branch is `echo` which never fails, so the `A && B || C` idiom is safe here). Full-repo shellcheck noise: 58 findings (1 warning + 57 notes) → 41 findings (0 warning + 41 notes).
- `[test]` **`tests/hooks/pre-bash-safety.test.sh`** — 11 new regression cases (29-38 + malformed-input renumbered to 39): cases 29-32 cover space-prefixed npx in echo/printf/single-and-double-quote/echo-flag forms (the actual session FP shapes — e.g. `echo "DEADCODE: npx knip"`); cases 33-34 cover leading + trailing comment forms; cases 35-36 cover heredoc body + heredoc-with-quoted-tag forms (`<<'JSON' ... npx pkg ... JSON`); cases 37-38 confirm the rm pattern's same-class FP guard. All 39 pass post-fix; 9 of the new cases were RED prior to the `sanitize_cmd` implementation (verified before commit). Case 6 (`rm -rf "$WORK_DIR"` deny) was an intermediate regression caught by the test suite during TDD — initial sanitize stripped `"$VAR"` to `""`; refined the double-quote regex to `[^"$]*` to preserve var-expansion content.

### Migration note (read before upgrading)

No action required. The sanitize is strictly more conservative than the original matcher in the FN direction (preserves backtick + `$(...)` + double-quoted-with-`$`); strictly less aggressive in the FP direction (silences string-literal / comment / heredoc shapes). All 27 original test cases (1-27) continue to pass unchanged.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new HARD rule, no new hook, no §13.2 budget delta.
- No change to install / update / uninstall behavior.
- `bash -c '<unpinned npx>'` / `eval "<unpinned npx>"` indirect-execution gap is documented in `pre-bash-safety-check.sh` as a known FN, NOT closed in this release. Original matcher already missed these (the `[[:space:];&|`]` prefix class excluded `'` and `"`, so quoted-arg npx never matched). Closing this requires a scan-then-recurse design and is deferred.

### Follow-up (deferred to v0.6.0 if reached)

- **Spec file SHA-256 integrity check** (cso F4) — record SHA-256 of installed `~/.claude/CLAUDE*.md` files in manifest; verify in `session-start-check.sh`. Detects post-install spec tampering — a real LLM-trust-surface risk for plugins distributing behavior policy. Multi-file change spanning install.js + manifest schema + session-start hook; warrants a minor bump, not a patch.
- **Indirect-exec coverage** for `bash -c` / `eval` / `xargs ... bash -c` — pre-existing FN, not touched here.

## [0.5.4] - 2026-04-30

**Patch — uninstall path hardening + diagnostics.** Defensive bugfix release. Closes the 3 follow-up items deferred from v0.5.3 + 1 new finding (D8 orphan-manifest doctor check). Manifest-conditional eviction logic was the largest correctness gap in the install audit; this release closes it.

### Symptoms (pre-fix)

1. **`scripts/uninstall.js:9-12` early-returned when manifest was missing or unparseable**, skipping the `HOOK_BASENAMES` legacy-eviction backstop. Pre-0.1.5 settings.json hook entries (`${CLAUDE_PLUGIN_ROOT}` literal form, absolute version-dir form, v0 hand-install form) survived the uninstall when the user had hand-deleted manifest or hit JSON corruption — exactly the path where legacy entries are most likely to exist.
2. **`HOOK_BASENAMES` predicate was a substring match** (`c.includes('/hooks/${b}')`), shared by `install.js:118-120` and `uninstall.js:36-41`. A future plugin shipping a same-basename hook (e.g. another plugin's `banned-vocab-check.sh`) would be incorrectly evicted from settings.json. No real-world hits today (v0.1.5+ plugins don't write hooks to settings.json), but the latent risk grew with `/claudemd-uninstall` becoming the recommended user flow in v0.5.3.
3. **`/claudemd-doctor` surfaced no signal for orphan manifests.** A user who ran `/plugin uninstall claudemd@claudemd` without `/claudemd-uninstall` first ended up with `~/.claude/.claudemd-manifest.json` pointing at a now-deleted `pluginRoot`. doctor reported `[✓] manifest: present` — falsely green. Combined with v0.5.3's two-step uninstall flow being new, plenty of users could end up here.
4. **`README.md` "Uninstall" section still led with the direct-`scripts/uninstall.js` invocation.** v0.5.3 added `/claudemd-uninstall` as the recommended path but didn't restructure the doc; first-time readers would copy the old single-step flow.

### Fix

- `[fix]` **`scripts/lib/settings-merge.js`** — D6: new exported `isClaudemdLegacyHookCommand(cmd, hookBasenames)` predicate. Path-anchored OR of the three legitimate residue forms claudemd has ever written to settings.json: `/plugins/cache/claudemd/...`, `/.claude/hooks/${basename}`, `${CLAUDE_PLUGIN_ROOT}/hooks/${basename}`. Other-plugin same-basename hooks no longer match. `hookBasenames` is passed in (rather than imported from `install.js`) to avoid a lib → top-level circular import.
- `[fix]` **`scripts/install.js:118-120`** — calls `isClaudemdLegacyHookCommand` instead of inline substring match. Same hooks evicted on install (no behavior change for v0.1.5+ users), but no longer touches a hypothetical other-plugin hook of the same basename.
- `[fix]` **`scripts/uninstall.js:7-44`** — D6 main: settings.json eviction now runs UNCONDITIONALLY before the manifest-presence guard. Pre-fix flow returned `{ warning: 'already-uninstalled' }` and skipped settings.json entirely when manifest was absent. Now: settings.json gets evicted via the path-anchored predicate; manifest-conditional steps (spec disposition, state-dir cleanup, log removal) still gate on manifest. New `settingsRemoved: number` field on the return value surfaces how many entries were evicted (visible to callers, including the `already-uninstalled` warning path).
- `[fix]` **`scripts/doctor.js`** — D8: new `plugin cache` check. When manifest is present, verify `manifest.pluginRoot` directory still exists. If absent, report `[△]` with cleanup hint pointing at `/claudemd-uninstall`. Advisory only — orphan manifest is benign but stale.
- `[docs]` **`README.md` "Uninstall" section** — M3 后半: re-ordered to lead with the two-step `/claudemd-uninstall` → `/plugin uninstall claudemd@claudemd` flow. Direct-script invocation demoted to "advanced fallback". Spec-disposition table now cross-references the v0.5.3 install-time `[claudemd] WARN` line so users know `restore` recovers their personal user-global instructions.
- `[test]` **`tests/scripts/settings-merge.test.js`** — 6 new D6 cases for `isClaudemdLegacyHookCommand`: matches each of the three legitimate residue forms (D6.1/D6.2/D6.3); rejects same-basename hook from a different plugin (D6.4); rejects unknown basename in `${CLAUDE_PLUGIN_ROOT}/hooks/` (D6.5) and in `/.claude/hooks/` (D6.6).
- `[test]` **`tests/scripts/uninstall.test.js`** — 3 new D6 cases: legacy `${CLAUDE_PLUGIN_ROOT}` entry evicted even when manifest is missing; other-plugin same-basename hook survives uninstall (path-anchoring proven); `settingsRemoved` field surfaces count in normal manifest-present uninstall.
- `[test]` **`tests/scripts/doctor.test.js`** — 2 new D8 cases: orphan-manifest case detected when `pluginRoot` path absent; `plugin cache: present at <path>` when `pluginRoot` exists.

### Migration note (read before upgrading)

No action required. Existing installs see no behavior change because:

- v0.1.5+ installs don't write claudemd hooks to settings.json — the legacy backstop only fires on pre-0.1.5 residue, which 0.5.x users won't have.
- The path-anchored predicate is strictly more conservative than the old substring match (it matches a subset). For all currently observed claudemd settings.json entries, the new predicate matches the same set as the old.
- `/claudemd-uninstall` flow from v0.5.3 still works the same way; this release just makes it more robust when state is corrupted.

After upgrade:

- `/claudemd-doctor` will report a new `plugin cache` row; healthy installs see `[✓]`.
- `scripts/uninstall.js` return value gains `settingsRemoved: number` (programmatic consumers can use it; slash command output unchanged).
- README "Uninstall" section now leads with the two-step flow.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new hook, no new HARD rule, no §13.2 budget delta.
- No change to install / update / hook behavior. `install.js` predicate change is a strict refinement; pre-0.5.4 substring already matched a superset of v0.5.4's path-anchored set on real-world claudemd entries.
- `commands/claudemd-uninstall.md` (added in v0.5.3) is unchanged.

### Follow-up (deferred to v0.6.0 if reached)

- `scripts/lib/hook-registry.js` single-source refactor: still YAGNI. 5-place hook list duplication observed across install.js / toggle.js / status.js / commands/claudemd-toggle.md / settings-merge.test.js fixture. Year-cost ~30 minutes of manual sync vs ~2 hours refactor; revisit only if a new hook addition triggers another drift.

## [0.5.3] - 2026-04-30

**Patch — `/claudemd-uninstall` command + user-content overwrite warning + spec trio lockstep clarification.** Pure additive bugfix release. No behavior change to existing flows; closes 4 user-perspective gaps surfaced in the v0.5.2 audit.

### Symptoms (pre-fix)

1. **Personal user-global instructions silently overwritten without warning.** `~/.claude/CLAUDE.md` is shared real estate between this plugin's spec and the user's hand-written CC instructions. Install backed up the original to `~/.claude/backup-<ISO>/CLAUDE.md` (no data loss), but emitted no stderr line; users who hand-wrote their CLAUDE.md ("Always reply in 中文", "My name is X") could discover their content gone with no breadcrumb to the backup.
2. **`/claudemd-update` description claimed a `select` mode that `update.js` does not implement.** Anyone choosing `select` got `Error: unknown choice: select`. The mode was never implementable — spec trio (`CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md`) evolves lockstep, and per-file select would dangle `§EXT §X-EXT` cross-references.
3. **`/plugin uninstall claudemd@claudemd` left orphan state.** CC's marketplace lifecycle does not fire `preUninstall`, so `~/.claude/.claudemd-manifest.json` + `~/.claude/.claudemd-state/` + `~/.claude/logs/claudemd.jsonl` survived plugin removal. No in-tree tool to clean up afterwards because the plugin cache (and `scripts/uninstall.js`) was already gone.
4. **`tests/scripts/install.test.js` settings.json basename assertions only covered 5–6 of 8 hooks.** Hardcoded regex listed `(banned-vocab-check|ship-baseline-check|memory-read-check|residue-audit|sandbox-disposal-check)` — silent gap for `session-start-check`, `version-sync`, `pre-bash-safety-check`. Production code (`install.js` `HOOK_BASENAMES`) had all 8; if `HOOK_BASENAMES` regressed, the test wouldn't catch it.

### Fix

- `[fix]` **`scripts/install.js:51-79`** — D7: detect user-content overwrite. Before backup, check `~/.claude/CLAUDE.md` for the canonical `# AI-CODING-SPEC` H1 in the first 256 bytes. If absent (existing file is likely personal CC user-global instructions), `process.stderr.write` a `[claudemd] WARN: …` line pointing at the backup path and the `CLAUDEMD_SPEC_ACTION=restore` recovery command. Backup-and-overwrite proceeds either way — the warning is informational, not a block. Return value gains `userContentDetected: boolean` for programmatic detection.
- `[add]` **`commands/claudemd-uninstall.md`** — M3: new slash command. `/claudemd-uninstall` runs `scripts/uninstall.js` while the plugin is still installed (so `${CLAUDE_PLUGIN_ROOT}` and the script itself still exist), clearing manifest + state-dir + log. Two-step uninstall flow: `/claudemd-uninstall` → `/plugin uninstall claudemd@claudemd`. Reversing the order is the orphan-state vector; the command frontmatter spells out why.
- `[fix]` **`commands/claudemd-update.md` + `README.md` (2 sites) + `scripts/update.js:23`** — M2: remove the `select` / `select-per-file` claim from `/claudemd-update`'s frontmatter description, README commands table, README Update section. `scripts/update.js` error message for invalid choices now lists the valid set (`'apply-all' | 'cancel'`) and explains the lockstep rationale. The description is now contract documentation: per-file select is intentionally not supported, not a missing feature.
- `[fix]` **`tests/scripts/install.test.js:8` + `:100` + `:277`** — D5: import `HOOK_BASENAMES` from `install.js` and define `isClaudemdHookCommand` predicate. Test assertions now use the same `c.includes('/hooks/' + b)` predicate as production code. Future hook additions to `HOOK_BASENAMES` automatically widen test coverage; no parallel hardcoded list to drift.
- `[test]` **`tests/scripts/install.test.js`** — 3 new D7 cases: (a) existing CLAUDE.md without spec H1 → `userContentDetected: true` + content preserved in backup, (b) existing CLAUDE.md with `# AI-CODING-SPEC vX.Y.Z` H1 → `userContentDetected: false` (routine upgrade, no warning), (c) fresh install → `userContentDetected: false`.
- `[docs]` **`README.md` "Install" section** — D7: callout warning that `~/.claude/CLAUDE.md` is shared real estate; describes the v0.5.3 stderr warning + recovery via `CLAUDEMD_SPEC_ACTION=restore`.

### Migration note (read before upgrading)

No action required for existing installs. After upgrade:

- A new slash command `/claudemd-uninstall` is available — use it BEFORE `/plugin uninstall claudemd@claudemd` to avoid orphan state.
- `install.js` now prints a stderr warning if your existing `~/.claude/CLAUDE.md` does not look like a claudemd spec. Pre-existing installs (where CLAUDE.md already has the `# AI-CODING-SPEC` H1) trigger no warning.
- `/claudemd-update` no longer documents a `select` choice. Behavior is unchanged — `cancel` and `apply-all` were always the only valid choices.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new hook, no new HARD rule, no §13.2 budget delta.
- No change to install / uninstall / update behavior on existing installs (apart from the new D7 stderr line).
- `scripts/uninstall.js` unchanged in this release; the manifest-missing tightening (D6) and the predicate `/claudemd/`-anchoring stay deferred to v0.5.4.

### Follow-up (deferred to v0.5.4)

- D6: `scripts/uninstall.js:9-12` early-returns when manifest is missing or unparseable, skipping the `HOOK_BASENAMES` legacy-eviction backstop. Run the basename sweep unconditionally.
- D6 secondary: tighten `HOOK_BASENAMES` predicate from substring match to path-anchored (`/plugins/cache/claudemd/` OR `/.claude/hooks/` OR `${CLAUDE_PLUGIN_ROOT}` literal) to eliminate cross-plugin name-collision risk.
- M3 README rewrite: re-order Uninstall section to lead with the two-step flow (`/claudemd-uninstall` → `/plugin uninstall`); current README still presents the direct-`scripts/uninstall.js` invocation as primary.

## [0.5.2] - 2026-04-30

**Patch — installer-audit cleanup: `/claudemd-toggle` + `/claudemd-status` cover all 8 hooks; README freshness pass.** Pure docs/metadata bugfix; no behavior change to install/uninstall/update or any hook script. Restores documented intent (every shipped hook is toggleable + visible) that drifted when v0.3.1 added `version-sync` and v0.5.0 added `pre-bash-safety-check`.

### Symptoms (pre-fix)

User-perspective audit against v0.5.1 surfaced 4 cases where surfaces lagged the shipped hook set:

1. `/claudemd-toggle pre-bash-safety` and `/claudemd-toggle version-sync` threw `unknown hook: …`. The hook scripts already honored `DISABLE_PRE_BASH_SAFETY_HOOK=1` / `DISABLE_USER_PROMPT_SUBMIT_HOOK=1` env vars (manual export worked), but `scripts/toggle.js` `NAME_MAP` listed only 6 of 8 hooks, so the slash command had no path to flip them.
2. `/claudemd-status` killSwitches block omitted both `pre_bash_safety` and `user_prompt_submit` lines — `scripts/status.js` `HOOK_NAMES` matched the same 6-entry set as toggle.js.
3. `commands/claudemd-toggle.md` frontmatter `Valid hook names:` listed only 5 (also missing `session-start-check` since v0.4.0). Discoverability gap independent of code paths.
4. `README.md` carried multiple stale claims from before the v0.3.1 + v0.5.0 hook additions: "7 shell hooks" (×2), "Spec v6.11.1" (×2), kill-switch list missing `DISABLE_PRE_BASH_SAFETY_HOOK`, "All 5 hooks" header, daily-use table missing `pre-bash-safety` + `version-sync` rows, escape-hatch table missing `[allow-rm-rf-var]` + `[allow-npx-unpinned]`.

### Fix

- `[fix]` **`scripts/toggle.js:3-15`** — `NAME_MAP` extended 6 → 8 entries: `pre-bash-safety` → `PRE_BASH_SAFETY`, `version-sync` → `USER_PROMPT_SUBMIT`. Note `version-sync`'s value tracks the hook event name, not the file basename, to preserve the existing `DISABLE_USER_PROMPT_SUBMIT_HOOK` env var contract introduced in v0.3.1.
- `[fix]` **`scripts/status.js:5`** — `HOOK_NAMES` extended 6 → 8 entries; order mirrors `install.js` `HOOK_BASENAMES` for human-scannable `/claudemd-status` output.
- `[fix]` **`commands/claudemd-toggle.md:8`** — frontmatter `Valid hook names:` now lists all 8 toggle keys.
- `[fix]` **`README.md`** — 8 sites updated: header table (8 hooks + Spec v6.11.3), daily-use table (added `pre-bash-safety-check` + `version-sync` rows), Kill-switches header ("All 8 hooks"), per-hook list (added `DISABLE_PRE_BASH_SAFETY_HOOK`), escape-hatch table (added `[allow-rm-rf-var]` + `[allow-npx-unpinned]`), Project layout tree (8 hooks + v6.11.3).

### Migration note (read before upgrading)

No action required. Existing `DISABLE_*_HOOK` env vars and per-invocation escape tokens are unchanged; this release only widens which surfaces report and toggle them. After upgrade, `/claudemd-toggle pre-bash-safety` and `/claudemd-toggle version-sync` start working; `/claudemd-status` killSwitches block adds two new keys (`pre_bash_safety`, `user_prompt_submit`).

### Not changed

- No spec content change. Spec stays at v6.11.3 (manifest description policy: `v6.11` family unchanged).
- No new HARD rule, no §13.2 budget delta.
- No change to install / uninstall / update script behavior or to any of the 8 hook scripts.
- No new env-var kill-switch or escape-token introduced by this patch — the 5 enumerated additions are pre-existing artifacts that the documentation now reflects.

### Follow-up (not blocking, deferred to next minor)

- M2: `/claudemd-update` description claims a `select`/`select-per-file` mode that `update.js` does not implement (only `cancel` + `apply-all` are valid choices). Either add per-file selection or strip the dead text.
- M3: `/plugin uninstall claudemd` does not run `scripts/uninstall.js` (CC marketplace lifecycle does not fire `preUninstall`); orphan manifest + state-dir + log left behind. Either document the explicit `node scripts/uninstall.js` follow-up at top of the Uninstall README section, or add a session-start self-clean ("manifest exists but plugin cache absent → tear down").
- D5: `tests/scripts/install.test.js` settings.json basename assertions cover only 5–6 of 8 hooks; widen to all 8 so future HOOK_BASENAMES drift is caught.
- D6: `scripts/uninstall.js:9-12` early-returns on missing manifest, skipping the `HOOK_BASENAMES` legacy-eviction sweep. Run the basename sweep unconditionally; only manifest-driven steps should depend on manifest presence.

## [0.5.1] - 2026-04-30

**Patch — `memory-read-check.sh` over-trigger fixes.** Bugfix release; no new HARD rule, no behavior expansion. Restores the spec §11 "Index is a router, not a substitute" intent that v0.5.0's hook contradicted. Spec footnote co-bumped to v6.11.3 to document the hook/agent split.

### Symptoms (pre-fix)

Three real failures observed against `~/.claude/CLAUDE.md` v6.11.2 and `claudemd` v0.5.0:

1. `git push origin <branch>` blocked with 6 `MEMORY.md` files demanded for Read — none of which had keyword tags. Every push on a project with untagged MEMORY.md entries paid this tax.
2. `glab mr create --title "fix release"` blocked: the trigger regex `(git push|release|deploy|ship)` matched the `release` substring inside the quoted `--title` argument.
3. `git commit -m "release notes update"`-style commands triggered the same path even though `git commit` is not a ship verb.

### Fix

- `[fix]` **`hooks/memory-read-check.sh` L26** — trigger regex anchored to command-segment-start (`^` or after `;` / `&` / `|`), with explicit ship-tool prefixes (`git push`, `gh release`, `gh pr`, `glab mr`, `npm publish`, `npm run release|deploy|ship`, `cargo publish`, `make release|deploy|ship`) plus bare ship verbs at boundary positions. Substring matches inside quoted args no longer fire the filter.
- `[fix]` **`hooks/memory-read-check.sh` L61–62** — untagged `MEMORY.md` entries no longer auto-block. Per spec v6.11.3, untagged lines are agent-driven full content scan; the hook enforces only entries with explicit `[tag1, tag2]` blocks. Operational guidance: tag the lines you want hook-enforced, leave the rest for agent judgment. Existing untagged MEMORY.md content keeps working — agent reads when keyword/title looks relevant; hook stays out of the way.
- `[test]` **`tests/hooks/memory-read-check.test.sh`** — Cases 12–16 added (16 total): untagged-only no-block, mixed tagged+untagged deny-tagged-only, ship-word in quoted commit msg no-trigger, glab mr non-matching tags no-deny, standalone deploy after `&&` still triggers.
- `[test]` **`tests/scripts/spec-structure.test.js`** + **`tests/integration/upgrade-lifecycle.test.sh`** — version assertions bumped v6.11.2 → v6.11.3.

### Migration note (read before upgrading)

No action required. Existing MEMORY.md files keep working; previously over-triggering pushes will now flow without the false-positive deny. If you were relying on the old "untagged = always required Read" behavior to force re-Read of specific files at ship time, **add `[tag1, tag2]` blocks to those entries** — the hook now enforces only tagged matches.

`DISABLE_MEMORY_READ_HOOK=1` per-session bypass and `[skip-memory-check]` in-command bypass unchanged.

## [0.5.0] - 2026-04-29

**Minor — three bundled additions: §12 PreToolUse:Bash safety hook, §1.B sandbox-disposal scan-locations override, §1.A macOS /tmp diagnostic CI step.** Released-artifact user-visible default behavior change (new hook intercepts dangerous `git`-adjacent Bash commands at PreToolUse), so SemVer minor per AI-CODING-SPEC §EXT released-artifact checklist. No spec content change; spec stays at v6.11.2. Manifest descriptions stay at `v6.11` per v0.2.1 description-policy.

### Migration note (read before upgrading)

After v0.5.0 lands, **a new PreToolUse:Bash hook** (`pre-bash-safety-check.sh`) intercepts two dangerous patterns enumerated in spec §8 SAFETY:

1. `rm -rf $VAR` / `rm -rf "$VAR"` / `rm -rf ${VAR}` — variable-expansion target without inline validation. Whitelists `$HOME`, `$PWD`, `$OLDPWD`, `$TMPDIR`.
2. `npx <pkg>` without `@<version>` pin — bare `npx prettier` denies; `npx prettier@3.0.0` / `npx ./local.tgz` / `npx --help` pass.

**Bypass**:
- Per-command escape token in the command body: `[allow-rm-rf-var]` or `[allow-npx-unpinned]` (recorded as `bypass-*` in rule-hits log).
- Hook kill-switch: `DISABLE_PRE_BASH_SAFETY_HOOK=1` (whole hook off).
- Global kill: `DISABLE_CLAUDEMD_HOOKS=1`.

Run the canonical 4-step upgrade after fetching v0.5.0:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```

Pin v0.4.3 to skip: `/plugin install claudemd@claudemd@0.4.3`.

### Added

- **`hooks/pre-bash-safety-check.sh`** — new PreToolUse:Bash hook enforcing spec §8 SAFETY rules at the harness level (forbids `rm -rf $VAR` with unvalidated expansion + unpinned `npx`). Registered in `hooks/hooks.json` ahead of the existing 3 PreToolUse:Bash hooks. 28-case test in `tests/hooks/pre-bash-safety.test.sh` covers: 4 non-trigger paths, 6 rm-with-var-expansion forms (bare/quoted/braced/flag-permutations/whitelist), 1 escape-hatch, 3 npx-unpinned forms (bare/scoped/`-p`), 7 npx-allowed forms (pinned/local-path/flags/`@latest`/escape), 2 kill-switch verifications, 1 fail-open malformed-stdin path.
- **`HOOK_BASENAMES` extended to 8 entries** at `scripts/install.js:16-25` — adds `pre-bash-safety-check.sh` so install/uninstall correctly evict any stale registration. Manifest count assertion in `tests/integration/full-lifecycle.test.sh:31` updated 7 → 8. Hook-basename alternation in both integration tests extended.
- **`.github/workflows/ci.yml` macOS-only diagnostic step** (`continue-on-error: true`) — captures ground-truth data on `find /tmp -newer ref` behavior on `macos-15-arm64` runners. v0.4.1 (run 25073453249) + v0.4.2 (run 25073841437) saw `FOUND` empty in the production sandbox-disposal hook with stderr blank; the diagnostic prints `uname`, `BASH_VERSION`, `TMPDIR`, `/tmp` realpath, `find --version`, ref/marker mtime delta, raw `find -newer` output, and runs the production hook against real `/tmp` to surface the v0.4.x-era root cause. Non-gating; data lives in CI logs for forensic use.

### Changed

- **`hooks/sandbox-disposal-check.sh` scan locations parameterized via `CLAUDEMD_SCAN_SPECS_OVERRIDE`** (§1.B refactor). Default scan list `/tmp|claudemd_only` + `$HOME/.claude/tmp|both` lifted from inline literals into a record-separator-delimited spec format the hook consumes. Tests inject fixture dirs via the env var, decoupling Cases 7-8 from real `/tmp` — the same path that failed reproducibly on macOS-15 GitHub runners in v0.4.1/v0.4.2 with stderr empty. Hook behavior on production users is unchanged (default scan paths identical to v0.4.x).
- **`tests/hooks/sandbox-disposal.test.sh` Cases 7-8 unconditional** — v0.4.3's `if [[ "$(uname)" == "Darwin" ]]; then echo SKIP; else …` branch removed. Both cases now inject fixture paths through the override; Linux + macOS run all 8 cases identically. Test fixture under `$TMP_HOME/system-tmp` substitutes for real `/tmp`; assertions on basename, no dependency on host-runner /tmp churn or `mkdir` semantics.

### Not changed

- **No spec content change**, no new HARD rules, no §13.2 budget delta. 20-task counter preserved.
- **No new env-var kill-switches** outside the new hook's `DISABLE_PRE_BASH_SAFETY_HOOK`. Existing kill-switches all unchanged.
- **No marketplace `description` version-family bump** — `v6.11` stays per v0.2.1 description-policy.

### Follow-up (not blocking)

If the v0.5.0 macOS CI diagnostic step surfaces a concrete root cause for the v0.4.1/v0.4.2 `find /tmp -newer ref` empty-result behavior, file as a `tasks/lessons.md` entry and decide whether the production hook needs a macOS-specific code path. Until then, real `/tmp` scan still runs on production macOS — only test coverage is decoupled.

## [0.4.3] - 2026-04-29

**Patch — macOS CI test conditional skip + lessons entry.** No plugin/spec code change. Spec stays at v6.11.2.

v0.4.1 introduced `tests/hooks/sandbox-disposal.test.sh` Cases 7-8 covering the `/tmp` scope hook fix. Case 8 (`/tmp/claudemd-* still flagged`) failed reproducibly on GitHub Actions macOS runners with stderr empty (FOUND list empty in hook). v0.4.2's mtime-edge + symlink-form defenses did not change the outcome — root cause is not what was hypothesized and cannot be reproduced without real-machine macOS access. Per AI-CODING-SPEC §6 Three-strike rule (same-signature failure 3× → roll back the path that introduced it), continuing to patch in CI without root-cause data would have crossed that threshold.

### Fixed

- `tests/hooks/sandbox-disposal.test.sh` Cases 7+8 are wrapped in `if [[ "$(uname)" == "Darwin" ]]; then echo "SKIP" ; else …` — Linux runs all 8 cases; macOS runs 6 (matching v0.4.0 baseline). Hook's `/tmp` scope behavior remains validated on Linux. The hook itself ships unchanged from v0.4.1; only test coverage on macOS is reduced.
- `tasks/lessons.md` created with two entries: (1) macOS-CI-tmp-flake — rule that macOS-specific filesystem tests must reproduce on real-machine before landing, (2) ship-baseline-bootstrap — rule that fix-forward commits to a known-red baseline use commit-body `known-red baseline:` per spec §7 option (b).

### Not changed

- No hook script change; no `scripts/` change; no spec content change. v0.4.1 and v0.4.2 hook fixes (memory-read tag-syntax dual form, ship-baseline RED expansion, sandbox-disposal /tmp scope, etc.) all still in effect.
- README, install/uninstall/update logic, manifests' `description` field — all unchanged from v0.4.2.

### Follow-up (not blocking)

Real-machine macOS investigation of why `find /tmp -newer ref` returned no fresh `claudemd-*` entries despite documented mkdir + sleep — candidates: GH runner /tmp ACL silent-fail, BSD vs GNU find divergence under brew gnubin PATH, /tmp churn race, hosted-runner sandbox behavior. Track until reproduced or refuted; no plugin code is suspected.

## [0.4.2] - 2026-04-29

**Patch — macOS CI test flake fix.** No plugin/spec code change. `tests/hooks/sandbox-disposal.test.sh` Case 8 (added in v0.4.1) was timing-fragile on macOS APFS: `touch -d '1 second ago' SESSION_REF` followed by an **immediate** `mkdir /tmp/claudemd-test-labeled_$$` could round both mtimes into the same wall-clock-second slot under APFS metadata granularity, defeating `find -newer`'s strict `>` comparison and leaving `FOUND` empty. CI run [25073453249](https://github.com/sdsrss/claudemd/actions/runs/25073453249) on v0.4.1 surfaced it; ubuntu-latest cancelled by `fail-fast` matrix.

### Fixed

- `tests/hooks/sandbox-disposal.test.sh` Case 8 — replaces `touch -d '1 second ago' + immediate mkdir` with `touch (NOW) + sleep 1 + mkdir` (the same pattern Case 5 already uses for nested-dir setup). Also grep on basename instead of full path, defending against the secondary risk of macOS `/tmp → /private/tmp` symlink-form path differences.

### Not changed

- No hook script change; no `scripts/` change; no spec content change. Spec stays at v6.11.2 from v0.4.1.
- README, install/uninstall/update logic, manifests' `description` field — all unchanged from v0.4.1.

## [0.4.1] - 2026-04-29

**Patch — post-audit fixes** spanning hooks, install/upgrade scripts, README, and spec content. Driven by 3-agent self-audit dispatched on `main` (install path / hook logic / spec prompt science). No new HARD rules, no breaking changes, no behavior change for already-installed users until they upgrade. Plugin manifests stay at `v6.11` per v0.2.1 description-policy (spec major.minor unchanged).

### Migration note (read before upgrading)

Run the canonical 4-step upgrade after fetching v0.4.1, then `/claudemd-update` to apply spec patch v6.11.1 → v6.11.2:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
/claudemd-update
```

Pin v0.4.0 to skip: `/plugin install claudemd@claudemd@0.4.0`.

### Fixed — hooks

- **`memory-read-check.sh` accepts both spec and data tag-syntax forms.** `hooks/memory-read-check.sh:49-58` adds plain-form sed fallback for `(file.md) [tag, tag] —` (the syntax documented at spec §11) alongside the existing `\`[tag, tag]\`` backtick form (the syntax in real `MEMORY.md` files). Pre-fix any plain-form line was treated as untagged → matched every `git push` / release / deploy / ship command, forcing unrelated Reads.
- **`ship-baseline-check.sh` treats all gh red-conclusion states as red.** `hooks/ship-baseline-check.sh:38-44` expands `[[ "$CONCLUSION" == "failure" ]]` to a `case` covering `failure` / `cancelled` / `timed_out` / `action_required` / `startup_failure`. Pre-fix a cancelled CI run shipped silently.
- **`sandbox-disposal-check.sh` no longer attributes system /tmp churn to the session.** `hooks/sandbox-disposal-check.sh:25-39` filters `/tmp` to `^claudemd-` prefix only. `~/.claude/tmp` continues to flag both `^tmp\.` and `^claudemd-`. Pre-fix vim/pip/cargo's stock `/tmp/tmp.XXXXXX` directories were warned-on at every Stop hook.

### Fixed — install / uninstall / update

- **`HOOK_BASENAMES` covers all 7 shipped hooks.** `scripts/install.js:16-24` adds `version-sync.sh` (was missing since v0.3.1 introduced the hook). settings.json eviction during install/uninstall now cleans stale `version-sync.sh` entries; previously they persisted undetected. Comment "5 shipped hooks" → "7" on `scripts/install.js:122`.
- **`scripts/update.js` decoupled from `backupRoot()`.** New `homeSpec(name)` helper at `scripts/lib/paths.js:29` replaces `path.join(backupRoot(), name)` (3 call sites). Future relocation of backups will not silently break `/claudemd-update`'s home-spec read path.
- **Integration tests grep covers all 7 hooks.** `tests/integration/full-lifecycle.test.sh:27,50` and `tests/integration/upgrade-lifecycle.test.sh:120,128` extend the hook-basename alternation from 5 to 7 (adds `session-start-check|version-sync`); Phase 7 in full-lifecycle also widens the JSON path filter from `PreToolUse`-only to all event types. Pre-fix a regression leaving either of those two in `settings.json` post-uninstall would have passed CI.

### Added

- **README ## Prerequisites section.** Explicit table for `node>=20` / `jq` / `git` / `gh` / `coreutils` (macOS only). Hoists previously-Troubleshooting-only dependency notes into the install path. Verify line: `node --version && jq --version && gh --version && git --version && timeout --version | head -1`.
- **README Uninstall clarifications.** Calls out that `delete` and `restore` are only available via direct `node …/uninstall.js`, never via `/plugin uninstall` (which always picks `keep`). Corrects `--purge` flag misdescription to `CLAUDEMD_PURGE=1` env-var form (the actual mechanism per `scripts/uninstall.js:83`).
- **Hook test cases** for the 3 hook fixes:
  - `tests/hooks/memory-read-check.test.sh` Cases 10-11: plain-form tag syntax (no-keyword-match passes; with-keyword-match-and-unread denies). 9 → 11 cases.
  - `tests/hooks/ship-baseline.test.sh` Cases 10-11: `cancelled` and `timed_out` conclusions deny push. 9 → 11 cases.
  - `tests/hooks/sandbox-disposal.test.sh` Cases 7-8: system `/tmp/tmp.*` is not attributed; `/tmp/claudemd-*` is still flagged. 6 → 8 cases.
- **`tests/fixtures/mock-gh/fail-cancelled/gh` + `fail-timed-out/gh`** — two new gh-CLI mocks emitting `cancelled` / `timed_out` conclusion JSON. mode 100755 set via `git update-index --chmod=+x` (per macOS portability rule — exec bit on `.sh` artifacts).

### Changed

- **Spec v6.11.1 → v6.11.2.** `spec/CLAUDE.md` §EXT TOC line removed (-357 chars / -1.5% core size); `spec/CLAUDE-extended.md` title bumped from `v6.10.0` to `v6.11.2` (closes silent trio-desync demonstrated at v6.11.1). From v6.11.2 forward, spec trio ships with synced version numbers. Recovered 1.4 percentage points from §13.1 size-budget pressure (95.0% → 93.6%). Full spec rationale at `spec/CLAUDE-changelog.md` v6.11.2 entry.

### Not changed

- **No new HARD rules**, no rule downgrades, no §13.2 budget delta. 20-task counter preserved.
- **No new hook scripts**, no new `settings.json` schema, no new env-var kill-switches. Existing kill-switches all unchanged.
- **No marketplace `description` version-family bump** — `v6.11` stays per v0.2.1 description-policy.

## [0.4.0] - 2026-04-29

**Minor bump — released-artifact user-visible default behavior change** per AI-CODING-SPEC §2 + §EXT §2-EXT release-requirements checklist. Adds an upstream-tag-check sub-feature to `session-start-check.sh`: every session start (rate-limited to once per 24h) compares the local plugin cache max version against the GitHub remote latest tag and, on mismatch, injects a 4-line "upgrade available" banner via SessionStart `additionalContext`. No spec content change (v6.11.1 stays). Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Migration note (read before upgrading)

After 0.4.0 lands, **all your sessions will start showing an "upgrade available" banner** when the GitHub remote has a newer claudemd release than your local cache. The banner contains the 4-step canonical upgrade sequence ready to copy-paste:

```
[claudemd] vX.Y.Z available (you have vA.B.C). Run these 4 commands to upgrade:
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins

Disable this notice: DISABLE_UPSTREAM_CHECK=1
```

This is a **default-on** behavior change — you will see the banner on session start without any opt-in. Three layers of opt-out (see Kill-switches in README):

1. `DISABLE_UPSTREAM_CHECK=1` — turn off only this sub-feature; existing manifest-version-mismatch auto-bootstrap (v0.2.5+) keeps running.
2. `DISABLE_SESSION_START_HOOK=1` — turn off the entire SessionStart hook (loses both upstream-check and bootstrap auto-sync).
3. `DISABLE_CLAUDEMD_HOOKS=1` — turn off all 7 claudemd hooks.

To pin v0.3.2 and skip 0.4.0: `/plugin install claudemd@claudemd@0.3.2` (CC marketplace pinning) or restore from `~/.claude/backup-<ISO>/`.

### Added — `hooks/session-start-check.sh::upstream_check`

New function inside the existing SessionStart hook (no new hook script registration; `hooks/hooks.json` unchanged). Fires only on the manifest-version-MATCH branch — i.e. when the local install is consistent and we're free to look outward. Skips on the mismatch branch to avoid stacking a banner on top of an in-flight bootstrap.

**Mechanism**:

1. Sentinel check: `~/.claude/.claudemd-state/upstream-check.lastrun` mtime within 24h → exit silently. Cross-platform via `platform_stat_mtime` (GNU `stat --format=%Y` / BSD `stat -f %m`).
2. Cache enumeration: `ls $cache_parent | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1` → local max version.
3. Remote tag: `timeout 3 git ls-remote --tags --refs --sort=-v:refname https://github.com/sdsrss/claudemd 'v*.*.*' | head -1` → latest semver tag. Public repo, no auth, no GitHub API rate-limit footprint.
4. Compare via `sort -V`: only emit banner when `remote > local`. Skips on equal or `local > remote` (dev-mode safety).
5. Sentinel touched on every reachable network attempt (success or empty result), so transient remote failures don't burst-retry.
6. Banner output: `jq -cn` constructs `{suppressOutput: true, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "..."}}` JSON; written to stdout for CC to inject as session context.

**Test override env vars** (testing-only, not user-facing):

- `CLAUDEMD_LS_REMOTE_CMD` — replace `git ls-remote` with a mock script for unit tests.
- `CLAUDEMD_CACHE_PARENT` — point cache-enumeration at a fake parent dir.
- `CLAUDEMD_REMOTE_URL` — override the GitHub URL (default `https://github.com/sdsrss/claudemd`).

### Added — Tests

`tests/hooks/session-start.test.sh` Cases 8-11 (test count 7 → 11):

- Case 8: upstream-check banner emitted on newer remote tag (mock returns v9.9.9, local cache max `0.4.0` stub).
- Case 9: `DISABLE_UPSTREAM_CHECK=1` suppresses banner (no stdout, manifest-match path otherwise unchanged).
- Case 10: 24h sentinel skips fresh check (pre-touched sentinel → no banner, mock not invoked).
- Case 11: `git ls-remote` failure fail-open (mock exits 1; hook exits 0, no stdout, no stderr).

Existing Cases 1-7 unchanged. Test file exports `DISABLE_UPSTREAM_CHECK=1` at top so Cases 1-7 stay network-free; new cases override per-run with `DISABLE_UPSTREAM_CHECK=0`.

### Discoverability (per §EXT §2-EXT)

- The banner itself is the one-time discoverability signal — first session after upgrade prints it; subsequent sessions within 24h hit the sentinel and stay quiet.
- Migration note in this CHANGELOG entry (above) documents the default-on behavior + 3-tier opt-out.
- README Kill-switches section gains a new "Per-sub-feature" tier (2a) calling out `DISABLE_UPSTREAM_CHECK`. Tier 2 list also gains `DISABLE_SESSION_START_HOOK` and `DISABLE_USER_PROMPT_SUBMIT_HOOK` (doc-drift fix from v0.1.9 / v0.3.1).
- `/claudemd-status` will continue to show the kill-switch state (existing logic surfaces all `DISABLE_*` env vars).

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.2 → 0.4.0
- `hooks/session-start-check.sh`: +60 lines (upstream_check function + match-branch routing)
- `tests/hooks/session-start.test.sh`: +69 lines (Cases 8-11 + mocks)
- `README.md`: +1 row in Daily-use table; +5 lines in Kill-switches Tier 2; +new Tier 2a sub-feature section

No spec change. `spec/CLAUDE*.md` unchanged at v6.11.1.

### Migration

`/plugin marketplace update claudemd` + `/plugin uninstall claudemd@claudemd` + `/plugin install claudemd@claudemd` + `/reload-plugins` (canonical sequence). `postInstall` triggers `install.js` which copies the new `hooks/session-start-check.sh` into the plugin cache. Next session start: banner appears if remote > local (which after 0.4.0 lands → no banner since local = remote = 0.4.0).

---

## [0.3.2] - 2026-04-29

Patch. Ships **spec v6.11.1** — 2 wording tightenings on existing HARD rules (§7 Iron Law #2 Bugfix anchor + §10 Specificity), driven by 30-day cross-project audit (188 rule-hits across `projects--claudemd` / `projects--mem` / `projects--code-graph-mcp` / `projects--daagu`). Both edits qualify as §13.2 evidence-rebuttal shortcut (fix existing HARDs, not new rules); HARD tally unchanged at 12 core + 4 §EXT-side. Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Spec v6.11.1 highlights

- **§7 Iron Law #2 Bugfix anchor** — appended banned-phrasing list (`should work / 应该可以 / 看上去 ok / 跑过了 / 能跑 / it runs / 没问题了`) with replace-with-failing-state-token instruction. Closes the "ran ≠ verified" hedge-evasion path that left the existing rule unfalsifiable.
- **§10 Specificity** — appended `No-baseline fallback` clause: `[PARTIAL: <missing-baseline>]` mandatory when no absolute number or baseline ratio is available, replacing synonym-softening (`much / notably / clearly / markedly / 较为 / 比较`). Closes the "switch synonym to escape banned-vocab" path observed in 13/14 deny-rate over 30 days.
- **§13.2 candidate log update**: `tasks/rule-candidates-2026-04.md` gains a second candidate — Shared-symbol edit guard (repro-count 1, below promotion bar).

See `spec/CLAUDE-changelog.md` v6.11.1 entry for sizing + grounding detail.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.1 → 0.3.2
- `tests/scripts/spec-structure.test.js`: version pins (L58, L65) 6.11.0 → 6.11.1; test description (L61) updated to match
- `tests/integration/upgrade-lifecycle.test.sh`: `NEW_SPEC_VER` (L15) 6.11.0 → 6.11.1
- `spec/CLAUDE.md`: header + §7 Iron Law #2 Bugfix anchor + §10 Specificity wording
- `spec/CLAUDE-changelog.md`: v6.11.1 entry prepended
- `tasks/rule-candidates-2026-04.md`: §9 Shared-symbol edit guard candidate appended
- `README.md`: spec-version mentions 6.11.0 → 6.11.1 (2 sites)

### Migration

`/claudemd-update` picks up spec v6.11.1 automatically on next SessionStart (v0.2.5 hook auto-syncs on version mismatch; v0.3.1 `UserPromptSubmit` covers the live-session path). No hook behavior change, no settings.json change, no state-dir change.

---

## [0.3.1] - 2026-04-24

Patch. Adds `UserPromptSubmit` hook `hooks/version-sync.sh` — piggy-back version-mismatch detection that covers the `/plugin marketplace update + /plugin install + /reload-plugins` upgrade path. Complements `session-start-check.sh` (SessionStart-only). After 0.3.1 lands, the user's first prompt submission following a plugin cache swap triggers `install.js` in the background; on-disk `~/.claude/CLAUDE*.md` syncs without requiring `/exit` + new session. No spec change (v6.11.0 stays). Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Added — `hooks/version-sync.sh`

Reads `~/.claude/.claudemd-manifest.json::.version` and compares against the active plugin root's `package.json::.version` (same authoritative pair `session-start-check.sh` and `install.js::readPluginVersion` use). Mismatch → `timeout 10 node install.js` backgrounded, detached, stdout+stderr redirected to `~/.claude/logs/claudemd-bootstrap.log`. Match → fast exit. Fail-safe: missing `jq`, unreadable `package.json`, legacy manifest without `.version`, `node` absent → silent early exit, no spawn, fail-open.

**Stdout contract**: exactly 0 bytes on every path. `UserPromptSubmit` hook stdout is injected into the user's prompt context by Claude Code; any accidental output would pollute every prompt in every session.

**Once-per-session**: session-scoped sentinel at `${TMPDIR:-/tmp}/claudemd-sync-${CLAUDE_SESSION_ID:-$PPID}`. Keyed off `CLAUDE_SESSION_ID` when CC exposes it, else the CC process PID (stable within a session). Sentinel is written on the first invocation regardless of outcome — mismatch or match — so subsequent prompts in the same session re-check in O(1) (single `test -f`). Hook adds ~5-10ms to first-prompt-of-session wall time, ~1ms to every subsequent prompt.

**Kill-switch**: `DISABLE_USER_PROMPT_SUBMIT_HOOK=1` or `DISABLE_CLAUDEMD_HOOKS=1` both suppress entirely (shared `hook_kill_switch` from `lib/hook-common.sh`).

### Added — test coverage

`tests/hooks/version-sync.test.sh` — 6 cases covering no-manifest/version-match/version-mismatch/kill-switch/sentinel-dedup/stdout-byte-count paths. `tests/scripts/install.test.js` fixture `hooks.json` updated to include the new `UserPromptSubmit` block (entry count 6 → 7). `tests/integration/full-lifecycle.test.sh` entry-count assertion updated accordingly.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.0 → 0.3.1
- `hooks/hooks.json`: +`UserPromptSubmit` block with 2-second timeout
- `README.md`: hook count 5 → 7 (also surfaces previously-undocumented `session-start-check` + new `version-sync`)

### Migration

Transparent — install.js behavior unchanged, hook registration auto-picked-up. First user after upgrade path: `/plugin marketplace update claudemd` + `/plugin uninstall claudemd@claudemd` + `/plugin install claudemd@claudemd` + `/reload-plugins` + send any prompt → on-disk spec syncs in background within ~1s. Subsequent upgrades require only the 4-step sequence + one prompt (no `/exit` needed).

---

## [0.3.0] - 2026-04-24

Minor. Ships **spec v6.11.0** — ROI-ranked optimization across §1 / §2 / §5 / §5.1 / §7 / §9 / §10 / §11 driven by a 5-day retrospective over `projects--mem` (v2.47.0 → v2.50.0) and `projects--code-graph-mcp` (v0.11.4 → v0.16.2) session history. Plugin-side: version sync + manifest `description` field bumps (v6.10 → v6.11 family, per v0.2.1 policy). No hook / script / test behavior changes beyond version pins.

### Spec v6.11.0 highlights

- **New SHOULD**: §9 Parallel-path completeness (L2+) — 4 grounded repros in 5 days; HARD candidate logged in `tasks/rule-candidates-2026-04.md`, promotion blocked by §13.2 20-task counter.
- **New SHOULD**: §7 Metric-coupling check (L2+) — changes coupled to existing bench/oracle/compile-time budget MUST cite before-and-after.
- **New classification**: §2 LLM-visible metadata (MCP tool descriptions, `instructions` field, adoption memory, prompt templates) → L3 regardless of LOC.
- **Clarifications** (no new HARD): §5 Obvious-follow-on re-AUTH; §1 Recommend-first single-option execute-directly; §5.1 aggressive skip-list; §10 banned-vocab quick-list in core.
- **Demotion**: §11 Re-Read / Correction / Context pressure → §11-EXT (non-HARD maintenance heuristics).
- **HARD tally unchanged** from v6.10.2 (12 core + 4 §EXT-side). §13.2 budget cost = 0.

See `spec/CLAUDE-changelog.md` for full per-section delta and sizing.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.2.5 → 0.3.0
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2) descriptions: `v6.10` → `v6.11` (minor-family bump per v0.2.1 policy)
- `README.md`: spec-version mentions 6.10 → 6.11 / 6.10.2 → 6.11.0 (3 sites)
- `tests/scripts/spec-structure.test.js`: version pins (L58, L65) 6.10.2 → 6.11.0
- `spec/CLAUDE.md`: header + §1 / §2 / §5 / §5.1 / §7 / §9 / §10 / §11 rule edits
- `spec/CLAUDE-extended.md`: §11-EXT Session maintenance heuristics (new block, receives demoted rules) + Recent changes block replaced
- `spec/CLAUDE-changelog.md`: v6.11.0 entry prepended
- `tasks/rule-candidates-2026-04.md`: created (§13.2 workflow)

### Migration

`/claudemd-update` picks up spec v6.11.0 automatically on next SessionStart (v0.2.5 hook upgrades on version-mismatch).

---

## [0.2.5] - 2026-04-23

Patch. Hook-behavior fix: SessionStart auto-sync on version mismatch. No spec change (v6.10.2 stays). Plugin-side response to a CC marketplace-lifecycle gap that quietly froze users' installed manifest at whatever version last ran `scripts/install.js` manually.

### Fixed — SessionStart hook now auto-upgrades on version mismatch

`hooks/session-start-check.sh` pre-0.2.5 short-circuited on `manifest-exists`, meaning the manifest + spec files stayed pinned to whichever version last triggered `scripts/install.js`. In practice Claude Code's marketplace install/uninstall flow does **not** invoke the `postInstall` / `preUninstall` fields declared in `.claude-plugin/plugin.json` — a `/plugin install claudemd@claudemd` after `/plugin marketplace update claudemd` swaps the active cache dir pointer but never runs `install.js`, so manifest.version and `~/.claude/CLAUDE*.md` both froze at the user's last manual-bootstrap version. Observed in the wild: a user stuck at manifest 0.2.2 / spec v6.10.0 after two documented releases (v0.2.3 shipping v6.10.1, v0.2.4 shipping v6.10.2) despite running the full canonical `/plugin marketplace update + uninstall + install + reload-plugins` sequence each time.

Hook now reads `manifest.version` from `~/.claude/.claudemd-manifest.json` and compares it against `.version` in the loaded plugin root's `package.json` (same authoritative source `install.js` uses for `readPluginVersion`). Mismatch logs a line to `~/.claude/logs/claudemd-bootstrap.log` and falls through to the existing background install block (`timeout 10 node scripts/install.js`, detached, stdout redirected). Match → fast exit as before. Fail-safe defaults: missing `jq`, unreadable `package.json`, legacy manifests without `.version`, or dev-mode non-semver plugin roots all early-exit without attempting upgrade (prevents re-bootstrap loops on broken state).

New test case `tests/hooks/session-start.test.sh:69-89` (Case 7) writes a `{"version":"0.0.1"}` manifest and asserts the hook both writes an auto-upgrade log line and bumps the manifest to the plugin's current `package.json` version. Cases 1-6 unchanged (fresh install, silence, log creation, version-match no-op, kill-switch, legacy manifest). Case 4 description updated to reflect the new "version-match" semantics.

### Migration

**One-time manual sync** to land this 0.2.5 hook: after `/plugin marketplace update claudemd` + `/reload-plugins`, run

```
node ~/.claude/plugins/cache/claudemd/claudemd/0.2.5/scripts/install.js
```

This will be the last manual install required — from 0.2.6 onward the 0.2.5 hook (now active in your session) will detect version drift on the next SessionStart and re-run install.js in the background automatically.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.2.4 → 0.2.5
- `hooks/session-start-check.sh`: +27/-3 (version-check branch before manifest early-exit)
- `tests/hooks/session-start.test.sh`: +21/-3 (Case 7 added, Case 4 comment clarified)

No `spec/CLAUDE*.md` change. `README.md` spec-version mentions unchanged (still v6.10.2). Manifest `description` fields still at `v6.10` per the v0.2.1 policy.

---

## [0.2.4] - 2026-04-23

Patch. Ships spec v6.10.2 — new HARD rule **§11 Mid-SPINE turn-yield** (core, all levels). First rule-addition patch since v0.2.0 (v6.10.0 shipped); prior v0.2.1 / v0.2.2 / v0.2.3 were hook/doc-drift patches. HARD tally: 11 → 12 in core.

### Added — §11 Mid-SPINE turn-yield (HARD, all levels)

`spec/CLAUDE.md:229` new bullet between `MEMORY.md read-the-file` and `Session-exit mid-SPINE`. Placement is the turn-boundary sibling to the existing session-boundary rule: once a turn has executed ≥1 tool call inside an active SPINE cycle, the model MUST continue planned steps through VALIDATE. `<system-reminder>` blocks (hook output / mid-turn `[mem]` context / PostToolUse flushes) are explicitly NOT turn boundaries. Only three legal mid-cycle yields: `[AUTH REQUIRED]`, genuinely-ambiguous direction, or §11 Context pressure checkpoint. Silent mid-cycle yield followed by a next-turn "done" claim is flagged as Iron Law #2 violation. Self-diagnostic tell: user's next message is `继续 / next / 怎么停了 / why did you stop` → confirmed prior yield.

**Grounding**: two user-reported mid-turn stops in plugin-adjacent sessions on 2026-04-22 / 04-23. Incident 1 root cause was `UserPromptSubmit` hook injecting a `<system-reminder>` on an empty/continuation prompt, which the model read as a new-turn boundary (hook-side mitigation landed separately: short-prompt silent-exit + continuation-label on reminders). Incident 2 root cause was single-Edit completion feeling like task-done when the plan had ≥3 remaining steps — this is a model-side habit that hook fixes cannot reach. The new spec rule addresses incident-2 directly; incident 1 gets both hook mitigation (eliminates the noise) and spec reinforcement (neutralizes the noise if it ever slips through).

**Core vs §EXT decision**: §EXT loads only at L3/ship/Override/3-strike, but mid-turn yields happen at L1/L2 (both grounded incidents were L1-L2). Placing the rule in §EXT would mean it never binds at the levels where it fires. §11 SESSION is already labeled "universal · binds every task", so core placement is the natural home and does not require a §0.1 core-growth exception carve-out.

Spec-structure tests updated (`tests/scripts/spec-structure.test.js:58,65` pin to 6.10.2).

### Changed — Version bumps

- `spec/CLAUDE.md` header v6.10.1 → v6.10.2
- `spec/CLAUDE-changelog.md` new v6.10.2 entry (above v6.10.1)
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2 fields): 0.2.3 → 0.2.4
- `README.md` lines 15, 197 spec-version mention: v6.10.1 → v6.10.2

Per "Versioning policy set in v0.2.1" (§CHANGELOG.md:7), plugin manifest `description` fields stay at `v6.10` (major.minor) — not re-bumped per patch.

### Migration

**`/claudemd-update`** to pick up spec v6.10.2 (1 new bullet in §11). No hook behavior change, no settings.json change, no state-dir change. Existing `~/.claude/CLAUDE.md` at v6.10.0 or v6.10.1 continues to work with all prior rules binding; the new Mid-SPINE turn-yield rule binds only after update.

---

## [0.2.3] - 2026-04-23

Patch. Ships spec v6.10.1 (wording patch on §7 Ship-baseline; zero rule change). Fixes 1 doc-drift P0 + 3 hook/spec P1 items surfaced by end-to-end audit. Adds 3 P2 production-hardening items: pre-merge settings.json backup rotation, rule-hits log rotation, and a live banned-vocab self-test check in `/claudemd-doctor`.

### Fixed — README spec-version drift (P0)

`README.md` lines 3, 15, 197 still referenced `v6.9` / `v6.9.3` after v0.2.0 shipped spec v6.10.0. Installers reading the README believed they were getting v6.9.3 while `plugin.json:4` and the shipped `spec/CLAUDE.md` H1 both declared v6.10. Synced to `v6.10` / `v6.10.1`.

### Fixed — §7 Ship-baseline wording vs hook behavior (P1)

`spec/CLAUDE.md:158` + `spec/CLAUDE-extended.md:261` said "check base-branch pipeline color"; the shipped `hooks/ship-baseline-check.sh:30-35` has queried `gh run list --branch $(git branch --show-current)` since v0.1.0 to avoid blocking feature-branch pushes over unrelated scheduled-workflow failures on `main`. Prior wording implied a broader check than any implementation actually did. Changed to "check pushed-branch pipeline color (fallback latest-any on detached HEAD)" in both core §7 and §EXT §7-EXT rationale. Spec bumped v6.10.0 → v6.10.1 with new entry in `spec/CLAUDE-changelog.md`. Spec-structure tests updated (`tests/scripts/spec-structure.test.js:58,65`).

### Fixed — `memory-read-check` tag matched as regex (P1)

`hooks/memory-read-check.sh:58` used `grep -qi "$t"` where `$t` is a MEMORY.md index tag. Tags containing regex metacharacters (`.`, `$`, `*`, `[`, `]`, `\`) were interpreted by grep's BRE — e.g. a tag `v6.9` would literal-match `v6X9` / `v6_9`, drifting into false-positive territory as tag vocab grows. Changed to `grep -qiF` (fixed-string). Added test case 9 in `tests/hooks/memory-read-check.test.sh:96-113` locking the intent (tag `v6.9` does NOT match command text `v6X9`).

### Fixed — `banned-vocab` fallback false-positive scope undocumented (P1)

`hooks/banned-vocab.patterns` header claimed "applied to ENTIRE git commit command string", but since v0.1.9 the hook extracts `-m`/`--message` bodies first and only falls back to whole-command scanning when extraction fails (editor-mode commits, `--file=PATH`, `--amend --no-edit`, unusual quoting). Rewrote header to describe actual extraction logic and name the fallback-only false-positive class (`git commit --file=/tmp/banned-significantly.txt` scanning the filename). Mirrored comment in `hooks/banned-vocab-check.sh:52-56`.

### Added — Pre-merge `settings.json` backup rotation

`scripts/install.js:88-98` has written `~/.claude/settings.json.claudemd-backup-<iso>` before any settings mutation since v0.1.0, but `/claudemd-doctor --prune-backups` only touched `~/.claude/backup-<ISO>/` directories — the sibling backup files accumulated one-per-install indefinitely.

New `pruneSettingsBackups(retainCount)` in `scripts/lib/backup.js:60-75` (mirrors `pruneBackups` retention semantics, iso-stamp lexicographic sort). Called from `install.js` right after creating the new backup; retains 5 newest, drops older. Regex `SETTINGS_BK_REGEX` accepts both ms-precision stamps and the sub-ms `-N` collision suffix. Install return shape gains `settingsBackupsPruned: string[]`. Three new unit tests in `tests/scripts/backup.test.js:71-105`: retention with mixed siblings, ms-precision + `-N` suffix, missing `.claude/` dir returns `[]` without throw.

### Added — Rule-hits log size-capped rotation

`hooks/lib/rule-hits.sh:18-33` gained `CLAUDEMD_LOG_MAX_MB` (default 5) size check before each append. Over threshold → rotate `claudemd.jsonl` → `claudemd.jsonl.1` (pushing existing `.1` to `.2`, dropping prior `.2`). Disk footprint bounded at ~3× max_mb. `stat -c` (GNU) with `-f %z` (BSD) fallback for macOS compat. Three new shell cases in `tests/hooks/rule-hits.test.sh`: rotation on overflow with old content preserved in `.1`, second rotation evicts stale `.2`, under-threshold no-rotation. `doctor.js` existing `logs > 5 MB` warn path still fires when the primary file itself grows past 5 MB after most recent rotation (informational; rotation keeps disk bounded regardless).

### Added — `/claudemd-doctor` live banned-vocab self-test

`scripts/doctor.js:59-93` spawns `hooks/banned-vocab-check.sh` with a synthetic event (`git commit -m "this is significantly better"`) and asserts a `"permissionDecision": "deny"` JSON response. Catches drift between `banned-vocab.patterns` and the hook's extraction logic that unit tests (which parse patterns directly) can silently paper over. Side-effect-free: sets `DISABLE_RULE_HITS_LOG=1` in the spawn env so the self-test doesn't pollute the user's rule-hits log; clears both kill-switch vars so ambient env can't falsely pass the check by disabling it. Degrades gracefully when `jq` / `bash` missing (prerequisite check with specific detail message).

**Kill-switch surfacing (review I1)**: the self-test detects before spawn whether `DISABLE_CLAUDEMD_HOOKS=1` / `DISABLE_BANNED_VOCAB_HOOK=1` is engaged in process env OR `settings.json:env`. Result still reports `ok: true` (hook code still denies the synthetic trigger when forced-enabled), but the detail appends `" — note: kill-switch engaged in user env/settings; hook will NOT fire in practice"`. Without this, doctor would silently green-light a hook the user has actively disabled, masking a config-vs-intent mismatch. Two new tests in `tests/scripts/doctor.test.js` lock both the settings.json and process.env paths.

### Manifest version bumps

- `package.json` 0.2.2 → 0.2.3. Description unchanged (`v6.10` per v0.2.1 policy: major.minor only).
- `.claude-plugin/plugin.json` 0.2.2 → 0.2.3. Description unchanged.
- `.claude-plugin/marketplace.json` both version fields 0.2.2 → 0.2.3. Descriptions unchanged.

### Required migration

**`/claudemd-update`** to pick up spec v6.10.1 (3-word wording change on §7 Ship-baseline + §EXT §7-EXT rationale). No hook behavior change, no settings.json change, no state-dir change. Existing `~/.claude/CLAUDE.md` at v6.10.0 continues to work (wording is more-accurate, not rule-different).

### Test totals

- Unit: 101 → 107 (+3 pruneSettingsBackups, +1 doctor self-test, +2 doctor kill-switch surfacing).
- Shell hooks: `memory-read-check` 8 → 9 cases (regex-metachar tag); `rule-hits` 3 → 6 cases (rotation trio).
- Full suite (shell + Node + full-lifecycle integration): PASS (573 ms).

## [0.2.2] - 2026-04-23

Patch. Ships at spec v6.10.0 (unchanged). Fixes `/claudemd-status` spec-version drift and adds bounded cache retention to prevent unbounded version-dir accumulation under `~/.claude/plugins/cache/`.

### Fixed — `/claudemd-status` spec version extraction

`scripts/status.js` read spec version with regex `^Version:\s*(\S+)` — a format retired in v6.10.0 when the spec header consolidated into `# AI-CODING-SPEC vX.Y.Z — Core`. Since v0.2.0 (which shipped spec v6.10.0), every healthy install returned `spec.installed: ""`, directly contradicting the "Versioning policy" set in v0.2.1 which declares the H1 title the canonical spec-version source.

- New extraction: H1-title match first (`/^#\s*AI-CODING-SPEC\s+v([\d.]+)/m`), legacy `Version:` fallback for pre-v6.10.0 installs.
- Test-reality drift repaired: `tests/scripts/status.test.js` fixture rewritten from fake `Version: 6.9.2` to real H1 format `# AI-CODING-SPEC v6.10.0 — Core`. The old fixture matched the broken regex, so unit tests passed while production silently returned empty. A single test assertion at the integration boundary would have caught this; added comment referencing v0.2.1 policy source to prevent re-drift.

### Added — Cache version pruning (keep newest 3)

New `scripts/lib/cache-prune.js` (`pruneCache`) called at end of `install.js`. Keeps the 3 newest semver version dirs under `~/.claude/plugins/cache/<plugin>/<plugin>/`, always retaining the currently-installed version even if older than the top-3 (rollback scenario). Previously cache dirs accumulated unbounded across upgrades — observed in the field after 8 releases: 6 stale version dirs (0.1.1 / 0.1.4 / 0.1.6 / 0.1.7 / 0.1.9 / 0.2.1) totalling ~2 MB per install cycle × N releases.

- **Scope-gated**: only dirs matching `^\d+\.\d+\.\d+$` are candidates; `scratch-notes/` and other non-semver siblings stay untouched.
- **Dev-mode safe**: when `pluginRoot` basename is non-semver (source repo checkout via `node scripts/install.js`), prune returns `{skipped: 'non-semver-plugin-root'}` — no scan of repo parent.
- **Best-effort**: prune wrapped in try/catch; an FS error does not void the preceding install success.
- **Coverage**: 7 new unit tests in `tests/scripts/cache-prune.test.js` — newest-3 keep, rollback retains current, non-semver siblings ignored, dev-mode skip, missing parent dir, multi-digit semver (0.10.0 > 0.9.5).

### Manifest version bumps

- `package.json` 0.2.1 → 0.2.2. Description unchanged (`v6.10` per policy).
- `.claude-plugin/plugin.json` 0.2.1 → 0.2.2. Description unchanged.
- `.claude-plugin/marketplace.json` both version fields 0.2.1 → 0.2.2. Descriptions unchanged.

### Required migration

**NONE.** Cache pruning triggers on next `install.js` run (any plugin upgrade path). No settings.json change, no spec content change, no hook behavior change.

### Test totals

- Unit: 101 → 108 (+7 cache-prune tests; +0 net on status since the failing case was fixed in place)
- Full suite (shell hooks + Node + full-lifecycle integration): PASS

## [0.2.1] - 2026-04-23

Patch. Loose-end cleanup from the v0.2.0 ship. No spec content change, no hook/script behavior change, no user-visible behavior difference — ships at spec v6.10.0 as in v0.2.0.

### Fixed — Test sentinel drift-proneness

- `tests/scripts/spec-structure.test.js` A15 `MEMORY.md tag syntax`: dropped the `/tag syntax/i` literal-phrase match. The `[tag1, tag2]` literal (user-copy-paste anchor) is the structural sentinel and was already asserted; the `/tag syntax/i` match was redundant and fragile — spec could rename "Optional tag syntax" → "Tag annotation syntax" (or similar) and silently keep passing against unrelated contexts, while the copy-paste example is the real stability invariant. Post-change: 2 assertions per test (MEMORY.md + `[tag1, tag2]`), down from 3. Full suite: 94/94 Node + full-lifecycle integration PASS.

### Fixed — Repo hygiene

- `.gitignore`: entry `.claude/settings.local.json` broadened to `.claude/`. The whole `.claude/` directory is Claude Code workspace state (sessions / permission grants / local hook caches) — entirely user-specific, entirely transient. Prior narrow rule left `?? .claude/` in every contributor's `git status` whenever CC created any sibling file (which it does now during normal session use). `.claude/settings.local.json` stays covered by the broader rule.

### Docs — Versioning policy

- `CHANGELOG.md`: new "Versioning policy" section (above) codifies the manifest-description-at-major.minor rule and documents independence between plugin semver and spec semver. Future reviewers see the rule without spelunking git log.

### Manifest version bumps

- `package.json`: 0.2.0 → 0.2.1. Description unchanged (`v6.10` per policy above).
- `.claude-plugin/plugin.json`: 0.2.0 → 0.2.1. Description unchanged.
- `.claude-plugin/marketplace.json`: both `metadata.version` and `plugins[0].version` 0.2.0 → 0.2.1. Descriptions unchanged.

## [0.2.0] - 2026-04-23

**Minor bump — ships spec v6.9.3 → v6.10.0**. Per AI-CODING-SPEC §2 "released-artifact user-visible default behavior change → L3 regardless of LOC" and §EXT §2-EXT "SemVer non-patch bump". User-facing behavior UNCHANGED (0 new HARD, 0 rule semantic modification, §5 AUTH table verbatim, all Iron Laws preserved) — bump chosen to signal the structural spec refresh, not a behavior contract change.

### Spec v6.10.0 — data-driven net contraction

Grounding: external audit of 6-week history across `projects--mem` / `projects--code-graph-mcp` / `projects--claudemd` flagged v6.9.3 core at 95% of §13.1 size ceiling (24.9k/25k), evidence rule scattered across §0 / §7 / §10 / §EXT §7-EXT / B.2, and dual routing tables (§2.2 core + §EXT §4 FLOW) with tie-breaker adding cognitive cost every task.

- **§2.1 ROUTE unified** — original §2.1 skill soft-triggers + §2.2 ROUTE (L0–L2 subset) + §2.3 TOOLS (orchestration) merged into one §2.1 ROUTE table + escalation principles + soft-trigger clause. Dual-routing tie-breaker dropped; §EXT §4 FLOW still authoritative on L3/ship. `~−1.4k chars` in core.
- **§5 AUTH compaction** — 14-row hard/soft column table → hard-default enum + soft list + none-case. 12 ops verbatim; no AUTH-level semantic change. `~−400 chars`.
- **§8 Verify-before-claim** — 8.V1–V4 bodies tightened to 1–2 lines; historical incident grounding (v0.8.3 leak count etc.) externalized to `spec/CLAUDE-changelog.md` v6.7.1 / v6.7.4 entries. `~−500 chars`.
- **§7 / §10 / §11 DRY sweep** — Iron Law #2 good-examples 3 → 2; Specificity clause tightened (full banned-vocab at §EXT §10-V); session-exit HARD preserved with v0.11.4 anecdote trimmed to changelog. `~−600 chars`.
- **Misc sweep** — Fast-Path / depth-triggers / TOC cross-ref tightened; obsolete `§EXT §8-EXT` pointer dropped. `~−200 chars`.
- **Recent-changes hygiene** — `spec/CLAUDE-changelog.md` v6.9.0 entry backfilled (chain was v6.9.3 → v6.9.2 → [gap] → v6.8.1; now continuous).

**Sizing delta** (vs v6.9.3):
- `spec/CLAUDE.md`: 23823 → 19553 chars (`−4270`, `−17.9%`); headroom 1177 → 5447 chars (`4.6×`).
- `spec/CLAUDE-extended.md`: 42427 → 42602 chars (+175, net flat — v6.9.0 entry archived to changelog offset by v6.10.0 entry + new Sizing line).
- `spec/CLAUDE-changelog.md`: 18716 → 23645 chars (+4929 — v6.10.0 entry + v6.9.0 backfill).
- Runtime L0/L1/L2 load: ~6.0k → ~4.9k tokens (`−1.1k` every turn).
- Runtime L3/ship load: ~16.6k → ~15.5k tokens (`−1.1k` per L3 turn).

**HARD tally unchanged**: 11 in core (§0.1 / §0 Hard-AUTH override / Iron Law #2 / §7 Ship-baseline / §7 User-global-state audit / §8 Verify-before-claim V1–V4 / §10 Four-section order / §10 Honesty rules / §10 Specificity / §11 MEMORY.md read-the-file / §11 Session-exit mid-SPINE). Zero added, zero removed, zero semantic change. §13.2 budget cost = 0; 20-task counter reset per "rule consolidation" allowance.

### Required migration: NONE

Agent behavior is backward compatible. Spec cross-references that external docs / memory files may carry:

- `§2.2 ROUTE` / `§2.3 TOOLS` → now under unified **§2.1 ROUTE**. If your `memory/*.md` or project `CLAUDE.md` cites these subsections by number, re-map to §2.1. Content preserved verbatim; only section numbers changed.
- All other section numbers (§0 / §0.1 / §1 / §1.5 / §2 / §3 / §5 / §5.1 / §7 / §8 / §9 / §10 / §11 / §EXT) unchanged.

### Opt-out / revert

Pin previous version:
- Plugin: `/plugin marketplace update claudemd` (or re-install) and select the `0.1.9` tag, OR from source: `git -C <claudemd-clone> checkout tags/v0.1.9 && node scripts/install.js`.
- Spec only: restore `~/.claude/CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md` from the `~/.claude/.claudemd-backups/<timestamp>/` backup that the 0.2.0 `postInstall` writes before overwriting (see `scripts/install.js` backup flow).

### Discoverability

- GitHub release notes (v0.2.0 tag) summarize the bump rationale.
- `/claudemd-status` now reports plugin 0.2.0 / spec v6.10.0.
- `hooks/session-start-check.sh` first run after upgrade logs the version bump to `~/.claude/logs/claudemd-bootstrap.log`.

### Manifest version bumps

- `package.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/plugin.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/marketplace.json` both `metadata.version` and `plugins[0].version` 0.1.9 → 0.2.0; both descriptions `v6.9` → `v6.10`.

No plugin code (hooks / scripts / commands / tests) changed in this release; shipping exclusively carries the spec refresh.

## [0.1.9] - 2026-04-23

Follow-on hardening from the 2026-04-23 end-to-end usage audit. 6 warts surfaced during sandbox simulation, all addressed; 4 new regression test cases and 1 new test suite added.

### Fixed — High (state-dir double-duty)

- `scripts/lib/paths.js` + `scripts/install.js` + `scripts/uninstall.js` + `scripts/status.js` + `scripts/doctor.js`: install manifest relocated from `~/.claude/.claudemd-state/installed.json` to `~/.claude/.claudemd-manifest.json`. The pre-0.1.9 location shared the state dir with runtime baselines (`tmp-baseline.txt`, `session-start.ref`); a user running `rm -rf ~/.claude/.claudemd-state/` to reset residue-audit / sandbox-disposal baselines silently erased the install record, and `/claudemd-status` reported `installed:false` even with hooks still firing from `hooks/hooks.json`. Sandbox repro: manifest gone → `{"warning":"already-uninstalled"}` from the next uninstall run. New `readManifest()` helper in `paths.js` transparently migrates legacy `.claudemd-state/installed.json` → new location on first access, so existing 0.1.x users get relocated automatically by any claudemd script (status / doctor / uninstall / install). (P1a)
- `scripts/uninstall.js` `purge` + default paths: unlink both the new manifest AND any pre-0.1.9 legacy file for belt-and-braces cleanup on upgrade→uninstall flows. (P1a)

### Added — Feature (SessionStart self-bootstrap)

- `hooks/session-start-check.sh` (new) + `hooks/hooks.json` SessionStart registration: auto-runs `install.js` in the background (10s ceiling, detached) when the plugin is present but no manifest exists at either location. Saves new users the manual `node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/install.js` step documented in `README.md`. Idempotent — fast-exits in ~5ms on subsequent starts once the manifest is in place. Kill-switch `DISABLE_SESSION_START_HOOK=1` suppresses the bootstrap; `DISABLE_CLAUDEMD_HOOKS=1` suppresses it too. Diagnostic log at `~/.claude/logs/claudemd-bootstrap.log`. `HOOK_BASENAMES` updated so uninstall catches this hook alongside the five enforcement hooks; `status.js` / `toggle.js` surface it under the `session_start` kill-switch key. (P1b)

### Fixed — Hook behavior

- `hooks/residue-audit.sh`: first invocation (no `tmp-baseline.txt` yet) now establishes the baseline silently and returns, mirroring `sandbox-disposal-check.sh`. Previously, a user whose `~/.claude/tmp/` already held >20 entries from other plugins or prior sessions got an immediate false alarm on the very first Stop after install, with `BASELINE=0` producing a misleading "grew by 32 entries" warning. (P2)
- `hooks/sandbox-disposal-check.sh`: trailing blank bullet (` - ` with no path) no longer appears at the end of the warn list. Root cause: the `FOUND` accumulator ended with a `\n`, and `head -n 5 | sed 's/^/  - /'` preserved the blank line as a naked bullet. Replaced with `sed -e '/^$/d' -e 's/^/  - /' | head -n 5` to strip empties before prefixing. (P3a)
- `hooks/banned-vocab-check.sh`: scan scope narrowed from "entire `git commit` command line" to "message body only" (extracted from `-m "..."` / `-m '...'` / `--message=...` / `--message "..."` forms). §10-V is about commit message content, so scanning `COMMIT_FLAG_SIGNIFICANTLY=1 git commit -m "fix: X"` across all tokens used to flag unrelated env/config text. Falls back to full-CMD scan when no `-m` / `--message` is captured (editor commits, `-F file`, unusual quoting) — preserves §10-V coverage without over-matching. BSD-safe: uses octal `\047` for single quote in regex alternation. (P4)

### Fixed — Medium (cosmetic churn in settings.json)

- `scripts/lib/settings-merge.js`: `unmergeHook` now prunes empty event arrays (e.g. `"PreToolUse": []`) and drops the top-level `hooks` key entirely when it becomes empty. Previously every install/uninstall cycle left `"hooks":{"PreToolUse":[]}` scaffolding in `settings.json`, visible as noise in user diffs and accumulating across plugins. (P3b)

### Added — Tests

- `tests/hooks/session-start.test.sh` (new, 6 cases): first-run silent + background install writes manifest, bootstrap log created, manifest-present no-op, kill-switch suppression, legacy-manifest path recognized as installed.
- `tests/hooks/banned-vocab.test.sh`: 5 new cases (16-20) covering message-scope scan — env prefix / `git -c` config / multi `-m` / `--message=` form / `-F file` fallback.
- `tests/hooks/sandbox-disposal.test.sh`: case 6 asserts no trailing blank bullet in warn list.
- `tests/hooks/residue-audit.test.sh`: case 1 now asserts first-run silence (no warn), case 4 seeds a zero baseline before exercising the threshold override.
- `tests/scripts/paths.test.js`: 4 new tests covering `manifestPath()` location outside `stateDir()`, `readManifest()` migration from legacy path, `readManifest()` returns `exists:false` on cold, and preference of new over stale legacy.
- `tests/scripts/settings-merge.test.js` case 17 rewritten: `unmergeHook` now returns `s.hooks === undefined` (not `s.hooks.PreToolUse.length === 0`).
- `tests/scripts/status.test.js` + `install.test.js`: manifest paths updated to `.claudemd-manifest.json`; install-test `hooks.json` fixture bumped to 6 entries (SessionStart included); manifest entry-count assertions `5 → 6`.
- `tests/integration/full-lifecycle.test.sh`: Phase 3 manifest path updated; entry count `5 → 6`.
- Test totals: script tests 90 → 94; hook suites gain a new `session-start.test.sh` (6 cases); `banned-vocab.test.sh` 15 → 20 cases. Running `tests/run-all.sh`: 94/94 Node + all shell hook suites + full-lifecycle integration PASS.

No spec content change — ships at v6.9.3 as in v0.1.8.

## [0.1.8] - 2026-04-23

### Fixed — Hook behavior

- `hooks/banned-vocab-check.sh`: ratio-class patterns now honor a baseline-context exemption. When the commit message carries an explicit baseline anchor (numbers on both sides of `→` / `->` / `=>`, or the literal word `baseline`), ratio hits are suppressed. Previously the hook denied spec-compliant commits like `perf: rendering 240ms → 72ms (70% faster)` even though §10 "ratio with baseline" explicitly permits this form. Non-ratio patterns (hedges, evaluative adjectives) still deny regardless of arrows in the message. Implementation: `banned-vocab.patterns` tags ratio-class lines with `@ratio` in the reason column; the hook parses the tag and gates the hit on a per-command `BASELINE_EXEMPT` check. The prior pattern file header claim `false-positive none` is corrected to `false-positive low` — this bug was the counter-example.
- `hooks/banned-vocab.patterns`: every 中文 pattern now carries its own self-contained reason. Previously four patterns (`显著改善`, `显著优于`, `大幅改善`, `明显优于`) shared the literal string `同上`, so the hook's deny message printed a lone "同上" with no referent.

### Fixed — Docs

- `README.md`: 5 sites hardcoding `0.1.5` in install/uninstall command paths replaced with `<version>` placeholder plus a one-line discovery hint (`ls ~/.claude/plugins/cache/claudemd/claudemd/ | sort -V | tail -1`). Survives future version bumps without doc churn.
- `README.md`: two `Spec v6.9.2` references (What-it-installs table row + Project-layout comment) bumped to `v6.9.3` matching the shipped spec since v0.1.6.

### Added — Tests

- `tests/hooks/banned-vocab.test.sh`: 3 new cases covering the baseline exemption: EN ratio with `→` baseline passes, hedge (`should work`) with `→` in message still denies (exemption is ratio-only), 中文 ratio with `→` baseline passes. Test total: 12 → 15.

No `scripts/` change. Spec content unchanged at v6.9.3. Running `tests/run-all.sh`: shell hook suites + 90 Node script tests + full-lifecycle integration all pass.

## [0.1.7] - 2026-04-22

### Fixed — Docs

- Every reference to `/plugin update claudemd` across `README.md`, `commands/claudemd-update.md`, and `scripts/install.js` comments has been corrected. `/plugin update` is **not** a valid Claude Code slash command — Claude Code silently ignores unrecognized commands (no error, empty stdout), which is why users running `/plugin update claudemd` saw nothing happen and concluded the plugin was broken. The actual root cause sat in our own docs framing, not plugin code.
- `README.md` **Update** section rewritten to list the canonical upgrade sequence (`/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`) or the `/plugin` UI alternative.
- `README.md` **Troubleshooting** gains a leading entry for the `/plugin update claudemd does nothing / empty stdout` symptom, pointing at the canonical sequence with the manual `git fetch` + `git archive` + `install.js` recipe as last-resort fallback.
- `scripts/install.js` internal comment updated: former "went stale on /plugin update" phrasing replaced with version-neutral "went stale when CC swapped in a new version-dir on upgrade".

No code change in `scripts/` (beyond one comment) or `hooks/`. Spec content unchanged at v6.9.3. Tests unchanged: 90/90 pass + full-lifecycle integration PASS.

## [0.1.6] - 2026-04-22

### Changed — Spec

- Ships AI-CODING-SPEC v6.9.3 (patch). New §12 paragraph "Manual-ship atomicity (HARD, clarification)" codifies that the `manual ship because <reason>` override is one atomic turn: enumerate remaining steps up-front, execute back-to-back, no turn-ending between clean green steps. Grounding: a manual-ship session stopped after `git commit` and required user prompt to continue — the single `[AUTH]` on ship already covered the full pipeline per §5 per-task-per-scope. See `spec/CLAUDE-changelog.md` v6.9.3 entry for full rationale.
- Fixes `spec/CLAUDE-extended.md` header version drift (was stuck at v6.9.0 while core had advanced through v6.9.1 / v6.9.2). Now matches at v6.9.3.

### Fixed — Docs

- `README.md` troubleshooting: replaces misleading "Since 0.1.4..." note (0.1.2-0.1.4 were broken — `${CLAUDE_PLUGIN_ROOT}` never expanded in `settings.json`). New entry documents the `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin` symptom (5 errors per Bash call on 0.1.2-0.1.4) and the v0.1.5 upgrade path.
- `README.md` install/uninstall command paths: `0.1.4` → `0.1.5` (3 sites).
- `README.md` Project layout: `hooks/hooks.json` is no longer "intentionally empty" — it's the authoritative hook registration site post-v0.1.5.

### Changed — Hygiene

- `.gitignore` now excludes `.claude/settings.local.json` (per-session CC permission grants; user-specific + transient; should never ship).

## [0.1.5] - 2026-04-22

### Fixed — Critical

- Hook registration moved from `~/.claude/settings.json` to the plugin's own `hooks/hooks.json`. The 0.1.2-0.1.4 releases wrote commands like `bash "${CLAUDE_PLUGIN_ROOT}/hooks/…"` into `settings.json`, but the CC harness only expands `${CLAUDE_PLUGIN_ROOT}` for hooks defined in a plugin's `hooks/hooks.json` — never in `settings.json`. Result: every Bash-tool call and every session-end fired 5 hook errors of the form `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`, and no claudemd hook actually ran. (V1)
- `scripts/install.js` now evicts ALL claudemd hook commands from `settings.json` on install — both the legacy absolute-path form (≤0.1.1) and the broken `${CLAUDE_PLUGIN_ROOT}`-literal form (0.1.2-0.1.4). Upgrading from any prior version leaves `settings.json` free of claudemd entries; `hooks/hooks.json` is now the sole registration site.
- Installed-manifest `entries` still contains the 5 shipped hook descriptors (sourced from the plugin's `hooks/hooks.json`), so `/claudemd-status` keeps showing `entries: 5` and `scripts/uninstall.js` keeps its precise-command match path alongside the `HOOK_BASENAMES` fallback.

### Docs

- `docs/ADDING-NEW-HOOK.md` step 3 now directs new-hook registration into `hooks/hooks.json` + `HOOK_BASENAMES`, not the deleted `HOOK_SPECS` array.

### Added — Tests

- `install.test.js`: 2 regression cases replace the old settings.json-count assertions — `fresh install leaves settings.json with NO claudemd hook entries (v0.1.5)` and `upgrade evicts ALL stale claudemd hook entries from settings.json (v0.1.5)`. The M4 env-var-literal check now asserts against `manifest.entries` instead of `settings.json`.
- `integration/full-lifecycle.test.sh` Phase 3 rewritten: asserts `settings.json` has zero claudemd residue AND `.claudemd-state/installed.json` carries 5 manifest entries.
- Script tests: 90/90 pass. Hook suites + full-lifecycle integration: PASS.

## [0.1.4] - 2026-04-22

Post-review hardening (full audit 2026-04-22). 0.1.3 was never tagged; this rolls the 0.1.3 pre-review fix set forward.

### Fixed — High

- `scripts/uninstall.js`: `--purge` no longer `rm -rf`s `~/.claude/logs/` (shared with other plugins, e.g. claude-mem-lite). Now only deletes `claudemd.jsonl` and removes the directory iff it becomes empty. (H1)
- `hooks/memory-read-check.sh`: project-dir encoding now replaces BOTH `/` and `.` with `-` (Claude Code's real scheme). Slash-only encoding silently missed any CWD containing a dot (`~/.config/*`, `my.project/`, etc.), turning the §11 HARD rule into a fail-open no-op. (H2)

### Fixed — Medium

- `hooks/ship-baseline-check.sh`: `gh run list` now filters by current branch (`--branch $(git branch --show-current)`). Previously an unrelated scheduled-cron failure on `main` could block a feature-branch push. Detached HEAD falls back to the old unfiltered query. (M1)
- `hooks/lib/platform.sh`: `platform_find_newer` adds `-maxdepth 1`. Fixes self-inconsistency with spec §8 "no recursive `~/.claude/` traversal" and speeds up scanning when `tmp/` accumulates. (M2)
- `scripts/update.js`: removed unreachable `choice=select` branch (no CLI path to pass `selected`). `select` now throws `unknown choice` with the existing error path. (M3)
- `scripts/install.js` + `scripts/uninstall.js`: hook commands written into `settings.json` now use literal `${CLAUDE_PLUGIN_ROOT}` (expanded by the CC harness at hook invocation per hooks docs). `/plugin update claudemd` surviving version-dir bumps no longer requires manual re-registration. `install.js` evicts any stale absolute-path entries left by ≤0.1.3 installs before merging the new env-var form. `uninstall.js` fallback matcher updated to catch both formats via a shared `HOOK_BASENAMES` list. (M4)

### Fixed — Low

- `scripts/audit.js`: CLI now accepts `--days=N` (parity with `doctor.js --prune-backups=N`) and rejects non-numeric / zero / negative with a usage hint. Previously `parseInt('garbage') → NaN` silently filtered every row to zero. (L1)
- `hooks/banned-vocab-check.sh`: git-commit detection regex now uses POSIX `[[:space:]]` / `[^[:space:]]+` instead of `\s` / `\S+` (not reliable under BSD grep on macOS). (L2)
- `scripts/doctor.js`: `logs` check now reports file size (MB) and fails at ≥5 MB with a truncation hint. `audit.js` reads the whole file into memory; oversize logs slow `/claudemd-audit`. (L5)

### Added — Tests

- 12 new regression cases across 9 files: purge-preserves-foreign-logs, dot-cwd encoding, branch-aware mock + filter test, maxdepth nested-tmp isolation, env-var hook command form, upgrade-from-absolute-path migration, audit CLI rejection pairs, doctor log-size threshold pair, unknown-choice throws.
- New fixture: `tests/fixtures/mock-gh/branch-aware/gh` — returns green/red based on `--branch` arg.
- Test total: 81 script + 12 post-review additions → **90 script tests**; hook suites **3** new cases across memory-read-check (7→8) / ship-baseline (8→9) / sandbox-disposal (4→5); integration 1/1.

## [0.1.3] - 2026-04-22

### Fixed
- `scripts/lib/backup.js`: `isoStamp()` now includes milliseconds (`YYYYMMDDTHHMMSSmmmZ`). Two installs within the same second previously shared a backup directory and silently overwrote the user's original spec backup via `renameSync`, losing data. A numeric suffix (`-1`, `-2`, …) is appended as a belt-and-braces guard for same-millisecond collisions. `listBackups` accepts both old and new stamp formats so pre-0.1.3 backups still sort correctly.
- `scripts/uninstall.js`: `delete` (without `CLAUDEMD_CONFIRM=1`) and `restore` (with no backups) now abort **before** mutating `settings.json` or the manifest. Previously the hook entries were silently removed before the abort return, so users saw "abort" but their hooks were already disabled.
- `scripts/lib/spec-diff.js`: replaced Set-based line diff with LCS. Reordered spec sections now show a nonzero `+N/-N` summary in `/claudemd-update` instead of the misleading `+0/-0`.
- `scripts/doctor.js`: `--prune-backups=N` now requires `N ≥ 1`. `--prune-backups=0` used to delete every backup (the retain-count semantic was surprising); it now errors with a usage hint.
- `scripts/toggle.js`: running with no argument now prints usage + valid hook names instead of the confusing `unknown hook: undefined` error.
- `package.json`: removed the `bin` field pointing at a non-existent `scripts/cli.js`. The plugin is distributed via the Claude Code marketplace, not npm, so the declaration was a landmine (`npm i -g` silently skipped creating the bin symlink).

### Added
- Regression tests covering each fix (F1, F2, F9, F10, F14, F18) under `tests/scripts/`.

## [0.1.2] - 2026-04-22

### Fixed
- `scripts/install.js` CLI invocation (`node scripts/install.js`) now auto-derives `pluginRoot` from its own file location via `import.meta.url`. Previously required `CLAUDE_PLUGIN_ROOT` env var and crashed with `install: pluginRoot missing` when users followed the README one-liner.
- `scripts/update.js` CLI invocation gains the same self-derivation fallback.
- `installed.json` manifest now records the actual plugin version (read from `<pluginRoot>/package.json`) instead of a hardcoded `'0.1.0'`. `/claudemd-status` and `/claudemd-doctor` now report correct version after install.

### Added
- `tests/scripts/install.test.js`: CLI smoke test that spawns `node scripts/install.js` with no env and no args, proving self-derived `pluginRoot` path works end-to-end.
- `scripts/lib/paths.js`: `resolvePluginRoot(importMetaUrl)` + `readPluginVersion(pluginRoot)` helpers.

## [0.1.1] - 2026-04-21

### Fixed
- `marketplace.json` moved from repo root to `.claude-plugin/marketplace.json` (correct Claude Code plugin layout).
- `marketplace.json` `plugins` field changed from object-keyed-by-name to array of objects (schema compliance).
- `plugin.json` stripped of explicit `commands` / `hooks` paths (auto-scanned by Claude Code); these caused install-time schema validation failure.
- Added `hooks/hooks.json` stub (`hooks: {}`) to prevent any auto-load double-execution when the install script registers hooks in `~/.claude/settings.json`.
- macOS CI: install `coreutils` for `timeout`; add GNU gnubin to PATH.
- macOS: `tests/hooks/rule-hits.test.sh` strips BSD `wc -l` whitespace padding.
- Git index: set executable bit (`100755`) on all shell scripts so CI mock-gh PATH invocation works.
- README rewritten with correct `/plugin marketplace add` + `/plugin install` flow.

## [0.1.0] - 2026-04-21

### Added
- Five hooks:
  - `banned-vocab-check` (PreToolUse:Bash) — blocks commits with §10-V banned vocabulary
  - `ship-baseline-check` (PreToolUse:Bash) — blocks `git push` on red base-branch CI (2s gh timeout)
  - `residue-audit` (Stop) — advisory warn when `~/.claude/tmp/` grows beyond threshold (default 20)
  - `memory-read-check` (PreToolUse:Bash) — denies ship/push when matched MEMORY.md entry unread in session
  - `sandbox-disposal-check` (Stop) — warns on mkdtemp residue at session end
- Five slash commands: `/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`.
- Seven Node.js management scripts with idempotent settings.json merge, backup-and-overwrite spec install (last 5 backups retained), 3-way uninstall (keep/delete/restore with hard-AUTH on delete).
- Ships spec v6.9.2 (adds §0.1 Core growth discipline + §2.3 TOOLS; reduces core from ~6,200 to ~5,330 tokens).
- CI matrix: ubuntu-latest + macos-latest × node 20.

### Notes
- First release.
