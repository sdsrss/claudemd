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

export class ArgvError extends Error {
  constructor(message) { super(message); this.name = 'ArgvError'; }
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

export function parseStrict(argv, { bools = [], values = [] } = {}) {
  const out = { bools: new Set(), values: {} };
  const knownBool = new Set(bools);
  const knownValue = new Set(values);
  for (const a of argv) {
    if (knownBool.has(a)) { out.bools.add(a); continue; }
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const k = a.slice(0, eq);
      const v = a.slice(eq + 1);
      if (knownValue.has(k)) { out.values[k] = v; continue; }
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
