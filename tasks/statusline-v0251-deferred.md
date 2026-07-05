# Deferred — statusLine review Minors (from v0.25.1 code review)

Source: `superpowers:requesting-code-review` whole-feature audit of `60312c8..cce65ee`
(v0.25.0 statusLine). v0.25.1 shipped the Important (I1) + M1 + the two test-gap
Minors (M3, M4). These two Minors were deferred — cosmetic, no safety value, and
M2 touches the empirically-verified renderer (don't perturb it for a cosmetic
gain). Pick up in a future patch only if convenient.

## M2 — renderer emits a literal two-line status when a field contains a newline
- File: `scripts/statusline.sh` (after the `IFS= read -r -d ''` reads).
- What: NUL-delimiting already prevents field *misalignment* (the important part,
  shipped v0.25.0). But a `cwd`/`model` value containing a real `\n` is printed
  verbatim → the status line wraps to two lines, breaking the one-line contract.
- Severity: Minor / cosmetic. A newline in a filesystem path is pathological.
- Fix if taken: strip `\r`/`\n` from `cwd` and `model` after the read (e.g.
  `cwd=${cwd//$'\n'/ }`), and add a fixture with an embedded-newline path asserting
  single-line output.

## M5 — `--json` flag inert; `--dry-run` on a non-forced foreign reports `foreign`
- Files: `scripts/statusline-adopt.js` (arg handling), `scripts/lib/statusline.js:58-60`.
- What: `detect`/`adopt`/`remove` always emit JSON, so `--json` never changes
  output (documented in the CLI help, harmless). Separately, `adopt --dry-run` on a
  foreign slot without `--force` returns `action:'foreign'` (the no-force guard
  returns before the dry-run branch) rather than a `dry-run` shape — no write either
  way, minor UX inconsistency.
- Severity: Minor / cosmetic. No correctness or safety impact.
- Fix if taken: either drop `--json` from the help as a no-op alias, or gate
  human-readable output behind its absence; and let the `--dry-run` + foreign +
  no-force combination report a `dry-run` shape describing "would skip (foreign)".
