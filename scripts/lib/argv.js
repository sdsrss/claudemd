// Strict argv parser for slash-command CLI scripts (clean-residue / audit /
// sparkline). Three contracts the previous inline parsers silently violated:
//   1. `--key=value` is the ONLY accepted shape for value flags. The space form
//      `--key value` falls back to default + ignores the value, exiting 0 — same
//      footgun family as the v0.9.14 `claudemd-cli lint <path>` silent-success.
//   2. Unknown flags reject loudly. Pre-fix, every script's `args.find()` lookup
//      silently dropped anything it didn't recognize, so a typo produced
//      indistinguishable-from-success output.
//   3. `--key=value` for boolean flags rejects (`--apply=yes` shouldn't parse
//      as `--apply` true).
// Caller catches `ArgvError` and exits 2 (distinct from numeric-validation
// exit 1) so wrappers can tell parsing-shape errors from validation errors.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export class ArgvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArgvError';
  }
}

// invokedAsMain(import.meta.url) — "did node start the program at THIS file?"
//
// The obvious spelling compares `import.meta.url` against a `file://` string
// built from process.argv[1]. Both halves of that comparison lie:
//   - node resolves import.meta.url through symlinks, argv[1] stays as typed,
//     so a plugin dir reached through a link (a dotfiles ~/.claude, a
//     `git worktree`, macOS /var -> /private/var) compares unequal;
//   - a URL percent-encodes what a path spells literally, so one space in the
//     path is `%20` on one side and ` ` on the other.
// Either way the main block does not run: the CLI exits 0 having printed
// nothing, which every caller reads as success. install.js failing this way
// returns "ok" while writing no manifest, so SessionStart re-enters the
// fresh-install branch forever (2026-09-05 audit P0-1).
//
// realpath BOTH sides and the two failure modes collapse into one comparison.
// Throwing inputs (argv[1] undefined under `node -e`, a path that no longer
// exists) mean "not the program" — false, never a crash.
export function invokedAsMain(importMetaUrl) {
  try {
    return fs.realpathSync(fileURLToPath(importMetaUrl)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

// Discoverability helper: when `--help` or `-h` is the first non-empty arg
// (or anywhere in argv for scripts with no flags), print usage to stdout and
// exit 0. Caller invokes BEFORE parseStrict so unknown-arg rejection doesn't
// shadow the universal first-probe of every Unix CLI. Pre-fix, every
// parseStrict-using script (audit / sparkline / hard-rules-audit /
// clean-residue / doctor) responded `Unknown argument: '--help'.` exit 2 —
// classic discoverability bug for new users.
export function printHelpAndExit(argv, usage) {
  if (argv.some(a => a === '--help' || a === '-h')) {
    process.stdout.write(usage.endsWith('\n') ? usage : usage + '\n');
    process.exit(0);
  }
}

// Strict positive-integer validator for numeric flags (`--days` / `--age-days`
// / `--prune-backups` / `--sample`). Returns the integer when `raw` (after
// trimming surrounding whitespace) is a plain base-10 positive integer with no
// leading zero, else null. `Number()` alone is too permissive — it coerces
// '0x1e' → 30, '1e2' → 100, ' 30 ' → 30 — all of which pass `Number.isInteger`
// despite help text promising a "positive integer", a silent contract
// divergence (inverse of the `parseInt` truncation footgun). Mirrors the
// `/^[1-9][0-9]*$/` guard already used for CLAUDEMD_BATCH_THRESHOLD in status.js.
// resolveDaysFlag / resolveDaysListFlag — the `--days` precedence, once.
//
// Five scripts carried the same expression with five different env-var names
// (CLAUDEMD_{AUDIT,RULES,SPARKLINE,SAMPLING,BYPASS}_DAYS), so the RULE — flag
// beats env, an EMPTY env falls back to the default, and the result must be a
// plain positive integer — lived nowhere and had to be re-derived by whoever
// added the sixth (2026-09-02 audit R11-13e). The per-script `--days` examples
// in the error text stay with each script; only the resolution moves here.
//
// Returns `{ raw, days }` (or `{ raw, windows }`), with the parsed value null on
// a bad shape, matching parsePositiveInt's contract: the CLI decides what to
// print and which exit code to use, a library does not call process.exit.
export function resolveDaysFlag(parsed, { env, dflt }) {
  // `||` not `??` on the env read, deliberately: `CLAUDEMD_AUDIT_DAYS=` (set but
  // empty, the shape an unset shell variable takes in a wrapper) means "no
  // preference", not "the empty string is my answer".
  const raw = parsed.values['--days'] ?? (process.env[env] || String(dflt));
  return { raw, days: parsePositiveInt(raw) };
}

// The comma-separated variant (sparkline's three trend windows). `windows` is
// null when any element fails to parse or fewer than `min` survive — one null in
// the middle of a list is as useless as an unparseable scalar, and returning a
// partial list is how '1.5,2,3' silently became [1,2,3] with a wrong header.
export function resolveDaysListFlag(parsed, { env, dflt, min = 2 }) {
  const raw = parsed.values['--days'] ?? (process.env[env] || String(dflt));
  const windows = String(raw)
    .split(',')
    .map(x => parsePositiveInt(x));
  const ok = windows.length >= min && !windows.some(w => w === null);
  return { raw, windows: ok ? windows : null };
}

export function parsePositiveInt(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  // Plain base-10 notation only — rejects hex ('0x1e'), exponential ('1e2'),
  // signs, and interior junk that `Number()` would coerce. Leading zeros ARE
  // accepted ('007' → 7): the header above cites a `/^[1-9][0-9]*$/` guard as
  // the model, but this pattern is `[0-9]+` and never rejected them
  // (2026-08-29 audit R10-20). Left as-is rather than tightened — '007' is
  // unambiguous base-10 here and no caller distinguishes it — but the comment
  // no longer claims otherwise. A trailing-zero
  // decimal ('30.0', '30.00') is allowed through the shape gate so the
  // integer-valued-float check below can accept it (existing contract: callers
  // / scripts may pass '30.0'); a true fraction ('1.5') passes the shape gate
  // but fails Number.isInteger and is rejected.
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function parseStrict(argv, { bools = [], values = [] } = {}) {
  const out = { bools: new Set(), values: {} };
  const knownBool = new Set(bools);
  const knownValue = new Set(values);
  for (const a of argv) {
    if (knownBool.has(a)) {
      out.bools.add(a);
      continue;
    }
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const k = a.slice(0, eq);
      const v = a.slice(eq + 1);
      if (knownValue.has(k)) {
        out.values[k] = v;
        continue;
      }
      if (knownBool.has(k)) {
        throw new ArgvError(`Boolean flag '${k}' does not take a value (got '${a}').`);
      }
      throw new ArgvError(`Unknown flag: '${k}'.`);
    }
    if (knownValue.has(a)) {
      throw new ArgvError(`'${a}' requires '=value' form (got '${a}' bare). Use '${a}=N'.`);
    }
    throw new ArgvError(`Unknown argument: '${a}'.`);
  }
  return out;
}
// parseStrictOrExit — parseStrict with the exit contract every CLI in this repo
// repeated verbatim: an ArgvError is a usage error, so print the one-line reason
// and exit 2; anything else is a bug and keeps its stack. Seventeen main blocks
// spelled this out by hand (jscpd's nine largest non-test clones were all this
// block), which is seventeen chances for one of them to swallow the rethrow or
// exit with a different code than its own USAGE documents.
export function parseStrictOrExit(argv, spec = {}) {
  try {
    return parseStrict(argv, spec);
  } catch (e) {
    if (e instanceof ArgvError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}

// Space-form argv validator for the published `claudemd-cli` binary.
//
// Lived in bin/claudemd-lint.js until audit-2026-08-22 条目 14: a second argv
// authority beside parseStrict, and scripts/lint-argv.js authenticated it BY
// FUNCTION NAME, so any file that declared a local function called
// `validateAndExpandFlags` satisfied the gate without validating anything. The
// gate had been widened to accommodate the duplicate instead of the duplicate
// being converged. It is not merged into parseStrict because the two contracts
// genuinely differ and the difference is published: parseStrict rejects the
// `--key value` space form and positional arguments, both of which
// `claudemd-cli lint <path> --comment-char ';'` documents and users' pre-commit
// hooks depend on.
//
// Strict-validate flag-shaped args + normalize `--key=value` → `--key value`
// pairs so the existing space-form parsing below works on either shape.
// Catches the same antipattern the slash-command CLIs hit in v0.9.16/0.9.17:
// `args.includes('--json')` returns false for `--json=yes`, so the flag was
// silently dropped; `args.indexOf('--file')` returns -1 for `--file=PATH`,
// so the value was silently ignored; an unknown `--jzon` typo was silently
// stripped from positional and never surfaced. Each path now exits 2.
export function validateAndExpandFlags(args, knownBools, knownValues, sub) {
  const out = [];
  const bools = new Set(knownBools);
  const values = new Set(knownValues);
  for (const a of args) {
    if (!a.startsWith('--')) {
      out.push(a);
      continue;
    }
    if (a.includes('=')) {
      const eq = a.indexOf('=');
      const k = a.slice(0, eq);
      const v = a.slice(eq + 1);
      if (bools.has(k)) {
        process.stderr.write(
          `${sub}: '${k}' is a boolean flag and does not take a value (got '${a}'). Drop the '=...' suffix.\n`
        );
        process.exit(2);
      }
      if (values.has(k)) {
        out.push(k);
        out.push(v);
        continue;
      }
      process.stderr.write(`${sub}: unknown flag '${k}' (got '${a}').\n`);
      process.exit(2);
    }
    if (bools.has(a) || values.has(a)) {
      out.push(a);
      continue;
    }
    process.stderr.write(`${sub}: unknown flag '${a}'.\n`);
    process.exit(2);
  }
  return out;
}
