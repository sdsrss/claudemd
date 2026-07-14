# B-1 — npx command-position anchor rework (2026-07-13)

## STATUS: SHIPPED in v0.47.0 (2026-07-13)

Implemented via approach (1) below — the npx gate now splits into command segments,
strips env-assignments + transparent wrappers (mirroring the rm gate), and matches a
runner only at command position. FN-matrix 32/32 (message/prose runner-words allow;
`env`/`sudo -E`/`FOO=bar`/`time` npx + `$(npx)` + `\npx`/`/usr/bin/npx` deny; pinned-under-
wrapper allow), full corpus 255 → 264 zero-regression, shellcheck clean. Accepted residual:
`xargs npx <pkg>` now allowed (same long-tail class as `xargs rm`). Original analysis below
kept for the record.

---


## Problem (confirmed, reproduced)

The npx gate false-positives on **plain command-words inside a $-containing double-quoted
string** — the classic case being a git commit message:

```
git commit -m "add npx setup step for $PROJECT"   → DENY (FP)
git commit -m "$VER: run npx vitest in ci"        → DENY (FP)
```

`sanitize_cmd` preserves $-containing double-quoted bodies verbatim (deliberate — needed so
`rm -rf "$B"` keeps its target visible). The npx anchor `(^|[[:space:];&|`({])npx ` matches
`npx` after **any whitespace**, so a prose `npx <word>` inside the preserved message body
fires. Telemetry corroboration: `§8-npx` deny distribution has `npx cd (unpinned) ×4` —
nobody runs `npx cd`; that is prose being scanned as a command.

Root cause is shared with SEC-3/SEC-4: the detector operates on a flattened string that
conflates command-position tokens with quoted DATA text. Full model in
`docs/s8-detection-precision-design-2026-07-13.md`.

## Why it was NOT shipped in v0.46.0

The obvious fix — make the npx anchor command-position-only like curl
(`(^|[;&|`({])[[:space:]]*`, dropping plain-space) — **regresses wrapper-prefixed npx**:
`env npx unpinned` / `command npx unpinned` are in the sanctioned 233-corpus as MUST-deny
(readonly-bypass defense, `feedback_readonly_whitelist_exec_wrappers`). Dropping plain-space
makes `env npx` (npx preceded by a space, before it a non-separator wrapper word) ALLOW.
Caught by the full 233-corpus at landing (sandbox B-1 case set was too narrow and missed it).

## The real fix (next batch)

The npx gate must distinguish wrapper-preceded npx (`env`/`command`/`sudo`/`timeout`/… npx →
deny) from prose-preceded npx (`setup npx` → allow) — i.e. do a **wrapper/assignment token
strip like the rm gate already does** (`pre-bash-safety-check.sh:439-478`), then check the
command-position token, instead of a single permissive regex. Candidate approaches:
1. Refactor the npx gate to token-walk (strip leading env-assignments + transparent wrappers,
   then match npx only at a real command position). Mirrors the rm gate; larger change.
2. OR fix `sanitize_cmd` to strip plain words from quoted bodies, keeping only `$VAR`/`$(…)`/
   backtick (design doc Option A) — kills the FP at the source but touches the crown-jewel
   §8-bypass-history function; highest regression risk.

Prefer (1). §8 SAFETY + L3 → single AUTH + full FN-matrix (`feedback_s8_false_negative_audit`):
must keep `env npx`/`command npx`/`sudo npx`/stacked wrappers DENY, `$(npx)` DENY, and prose
`npx <word>` in a quoted message ALLOW.

## Acceptance oracle

`docs/s8-detection-precision-design-2026-07-13.md` §3 corpus (axis-2 FP rows) + the 233-corpus
wrapper-npx deny rows. Land only when both are green.

## Immediate workaround (until fixed)

Commit messages describing `npx <word>` with a `$` in the body: use single quotes
(`-m '…npx vitest…'`, no expansion) or the `[allow-npx-unpinned]` token.
