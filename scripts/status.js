import fs from 'node:fs';
import path from 'node:path';
import { logsDir, backupRoot, readManifest, resolvePluginRoot, pluginCacheDir } from './lib/paths.js';
import { compareSpecs } from './lib/spec-hash.js';
import { HOOK_ENV_SUFFIXES } from './lib/hook-registry.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/status.js

Print plugin / spec / kill-switch / feature / log status as JSON.
No flags. Wrapped by /claudemd-status.

Options:
  --help, -h     Print this message and exit.

Exit codes: 0 success | 2 argv-shape error.`;

export async function status() {
  const m = readManifest();
  let plugin = { installed: false };
  if (m.exists && m.data) {
    plugin = { installed: true, version: m.data.version, entries: m.data.entries.length };
  } else {
    // CC's `/plugin install claudemd@claudemd` lands the version dir under
    // ~/.claude/plugins/cache/claudemd/claudemd/<ver>/ but does NOT fire
    // postInstall, so install.js (which writes the manifest) has not run
    // yet. session-start-check.sh bootstraps it on the next session — until
    // then we surface the limbo state explicitly so /claudemd-status can
    // tell the user "files are on disk, restart or run install.js".
    try {
      const cacheBase = path.join(pluginCacheDir(), 'claudemd');
      if (fs.existsSync(cacheBase)) {
        const versions = fs.readdirSync(cacheBase, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^\d/.test(d.name))
          .map(d => d.name)
          .sort();
        if (versions.length > 0) {
          plugin.hint = 'cache-present-bootstrap-pending';
          plugin.cacheVersions = versions;
        }
      }
    } catch { /* best-effort hint; absence is non-fatal */ }
  }

  // Spec version source (per v0.2.1 "Versioning policy"): the `spec/CLAUDE.md`
  // H1 title — `# AI-CODING-SPEC vX.Y.Z — Core`. Pre-v6.10.0 specs used a
  // standalone `Version: X.Y.Z` line (retired in v6.10.0 restructure);
  // fallback regex preserves read compatibility with old installs.
  const coreSpec = path.join(backupRoot(), 'CLAUDE.md');
  const specVersion = (() => {
    if (!fs.existsSync(coreSpec)) return '';
    const text = fs.readFileSync(coreSpec, 'utf8');
    const h1 = text.match(/^#\s*AI-CODING-SPEC\s+v([\d.]+)/m);
    if (h1) return h1[1];
    const legacy = text.match(/^Version:\s*(\S+)/m);
    return legacy ? legacy[1] : '';
  })();

  // killSwitches.<name> reflects this-process env (= "currently in effect").
  // Pre-fix it ignored ~/.claude/settings.json's persisted env block, so a
  // user running `node scripts/status.js` directly after `/claudemd-toggle X`
  // saw `X: false` even though the toggle wrote DISABLE_X_HOOK=1 — toggle
  // takes effect on next CC session start (when CC loads settings.env).
  // We now also read settings.json's persisted env and surface a `pending`
  // diff: keys that will flip on the next session. The boolean `effective`
  // remains the canonical "this session" value (back-compat).
  const persistedEnv = (() => {
    try {
      const sp = path.join(process.env.HOME || '', '.claude', 'settings.json');
      if (!fs.existsSync(sp)) return {};
      const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
      return (s && s.env) || {};
    } catch { return {}; }
  })();
  const isOn = (key) => process.env[key] === '1';
  const persistedOn = (key) => persistedEnv[key] === '1';

  const killSwitches = { plugin: isOn('DISABLE_CLAUDEMD_HOOKS') };
  const pendingKillSwitches = {};
  if (isOn('DISABLE_CLAUDEMD_HOOKS') !== persistedOn('DISABLE_CLAUDEMD_HOOKS')) {
    pendingKillSwitches.plugin = { effective: isOn('DISABLE_CLAUDEMD_HOOKS'), persisted: persistedOn('DISABLE_CLAUDEMD_HOOKS') };
  }
  for (const name of HOOK_ENV_SUFFIXES) {
    const key = `DISABLE_${name}_HOOK`;
    const lower = name.toLowerCase();
    killSwitches[lower] = isOn(key);
    if (isOn(key) !== persistedOn(key)) {
      pendingKillSwitches[lower] = { effective: isOn(key), persisted: persistedOn(key) };
    }
  }

  // v0.6.0: SHA-256 drift summary. Truncate to 12 hex chars for display
  // (full hash is in doctor's per-file detail). One row per shipped spec.
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const hashes = compareSpecs(pluginRoot).map(s => ({
    name: s.name,
    match: s.match,
    shipped: s.shipped ? s.shipped.slice(0, 12) : null,
    installed: s.installed ? s.installed.slice(0, 12) : null,
  }));

  // v0.6.0+: surface opt-in feature flags so /claudemd-status reflects what
  // the hooks will actually do this session.
  //   bashSafetyIndirectCall (v0.6.0): bash/sh/zsh/eval unwrap in pre-bash-safety
  //   bashReadonlyFastPath (v0.8.3 R-N5): skip 4 PreToolUse:Bash hooks for
  //     definitely-read-only commands (ls / cat / git log / etc.)
  //   transcriptVocabScan (v0.8.3 R-N8): PostToolUse advisory scan of
  //     assistant text against §10-V banned-vocab.patterns
  const features = {
    bashSafetyIndirectCall: process.env.BASH_SAFETY_INDIRECT_CALL === '1',
    bashReadonlyFastPath: process.env.BASH_READONLY_FAST_PATH === '1',
    transcriptVocabScan: process.env.TRANSCRIPT_VOCAB_SCAN === '1',
  };

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;

  return {
    plugin,
    spec: { installed: specVersion, hashes },
    killSwitches,
    pendingKillSwitches,
    features,
    log: { lines: logLines },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  // Reject unknown args with the same loud-fail contract as the rest of the
  // slash-command CLIs. status.js takes no flags; pre-fix it silently
  // ignored ALL arguments (including typos) and exited 0 — the same
  // silent-fallback antipattern documented in feedback_cli_flag_shape_silent_fallback.md.
  try {
    parseStrict(process.argv.slice(2), {});
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  status().then(r => console.log(JSON.stringify(r, null, 2)));
}
