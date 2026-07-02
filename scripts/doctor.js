import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logsDir, settingsPath, specHome, readManifest, marketplacePluginRoot } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';
import { compareSpecs } from './lib/spec-hash.js';
import { compareHooks } from './lib/install-drift.js';
import { readHits, groupBySection, blockingDenyCount, excludeTestSessions } from './lib/rule-hits-parse.js';
import { scanMemoryTags } from './lib/memory-tags.js';
import { parseStrict, ArgvError, printHelpAndExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/doctor.js [--prune-backups=N]

Run health checks on claudemd installation. Flags missing deps, spec drift,
settings.json issues, hook drift, backup inventory, rule-usage health.

Options:
  --prune-backups=N   Keep the N newest backup dirs (positive integer ≥1).
                      To remove ALL backups, delete ~/.claude/backup-*
                      manually — this flag cannot do that.
  --help, -h          Print this message and exit.

Wrapped by /claudemd-doctor.

Exit codes: 0 success | 1 validation error | 2 argv-shape error.`;

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// v0.7.1 R-N6 — doctor surfaces §0.1 demotion candidates from v0.7.0's
// bypass-vs-deny audit data. A spec section whose users override its denies
// more often than they comply with them is signalling either "rule too strict"
// or "rule wording confuses". §0.1 Core growth discipline says core entries
// with 0 hits in 90d are demotion candidates; this catch is the inverse —
// hits exist, but they're routinely escape-hatched.
const RULE_USAGE_WINDOW_DAYS = 30;
const RULE_USAGE_DEMOTION_RATIO = 0.5;
// Floor below which the bypass:deny ratio is statistically meaningless.
// 3 events over 30 days is the smallest sample where a 50%+ override rate
// reliably distinguishes signal from a single-incident artifact.
const RULE_USAGE_MIN_TOTAL = 3;
// v0.23.6 — §8 SAFETY family (§8, §8.V*, §8-rm-rf-var, §8-npx) is immutable
// per spec §5.1 Never-downgrade: it can never be demoted. A high bypass ratio
// here is expected ceremony on inherently-risky-but-known-safe ops (npx with
// no lockfile under user trust, rm -rf on a validated var) — NOT a "rule too
// strict → demote" signal. Surface the ratio for visibility, but never emit
// the "§0.1 demotion candidate" label, which would recommend an action the
// policy forbids. Anchored so §8/§8./§8- match but a hypothetical §80 wouldn't.
// Scope is deliberately §8-only: the other §5.1 Never-downgrade sections that
// own a rule-hits label (§7-user-global-state, §iron-law-2) are advisory
// Stop-hook-only (warn / structure-advisory, never deny+bypass), so total=0 <
// RULE_USAGE_MIN_TOTAL and they cannot reach this demote branch — §8-npx /
// §8-rm-rf-var are the only immutable sections that actually do.
const IMMUTABLE_SECTION_RE = /^§8([.\-]|$)/;

export async function doctor({ pruneBackups: prune } = {}) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const m = readManifest();
  push('manifest', m.exists && m.data != null,
    m.exists && m.data != null
      ? (m.migrated ? `present at ${m.path} (relocated from pre-0.1.9 state dir)` : 'present')
      : 'missing — is plugin installed?');

  // D8 (v0.5.4): orphan-manifest detection. CC marketplace lifecycle does not
  // fire `preUninstall`, so /plugin uninstall claudemd@claudemd leaves the
  // manifest behind. Verify `manifest.pluginRoot` still exists; if not,
  // surface the cleanup hint pointing at /claudemd-uninstall (which must run
  // BEFORE /plugin uninstall to avoid this state — see commands/claudemd-
  // uninstall.md). Advisory only: orphan manifest is benign but stale.
  if (m.exists && m.data?.pluginRoot) {
    const orphan = !fs.existsSync(m.data.pluginRoot);
    push('plugin cache', !orphan,
      orphan
        ? `manifest.pluginRoot (${m.data.pluginRoot}) no longer exists — orphan manifest. ` +
          `Likely cause: /plugin uninstall claudemd@claudemd ran without /claudemd-uninstall first. ` +
          `Either /plugin install claudemd@claudemd to rebootstrap, or rm ~/.claude/.claudemd-manifest.json by hand.`
        : `present at ${m.data.pluginRoot}`);
  }

  if (fs.existsSync(settingsPath())) {
    try { readSettings(); push('settings.json', true, 'parseable'); }
    catch (e) { push('settings.json', false, e.message); }
  } else {
    push('settings.json', false, 'missing');
  }

  for (const p of specHome()) {
    push(`spec:${path.basename(p)}`, fs.existsSync(p),
      fs.existsSync(p) ? 'present' : 'missing');
  }

  // v0.6.0: SHA-256 drift detection. Compares installed ~/.claude/<spec>
  // against shipped <pluginRoot>/spec/<spec>. Surfaces (a) local edits to
  // installed spec after install, (b) post-upgrade staleness when the
  // plugin updated but the user hasn't run /claudemd-update yet. Does NOT
  // cover supply-chain integrity — the marketplace/npm signature is the
  // right layer for that.
  const drift = compareSpecs(PLUGIN_ROOT);
  for (const s of drift) {
    if (s.shipped === null) {
      push(`spec-hash:${s.name}`, false,
        `shipped spec missing at ${path.join(PLUGIN_ROOT, 'spec', s.name)}`);
    } else if (s.installed === null) {
      push(`spec-hash:${s.name}`, false,
        `installed spec missing — /plugin install claudemd@claudemd to bootstrap`);
    } else if (s.match) {
      push(`spec-hash:${s.name}`, true, `${s.shipped.slice(0, 12)}… matches`);
    } else {
      push(`spec-hash:${s.name}`, false,
        `installed ${s.installed.slice(0, 12)}… ≠ shipped ${s.shipped.slice(0, 12)}… — local edits or stale install; run /claudemd-update to sync`);
    }
  }

  // v0.9.22: production-hook drift. Source-of-truth (this PLUGIN_ROOT) vs
  // the ${CLAUDE_PLUGIN_ROOT} Claude Code actually resolves at hook-fire time.
  // /plugin update is a silent no-op in current CC versions (memory:
  // reference_plugin_update_manual_refresh.md), so a v0.9.21 source repo can
  // ship while the marketplace install still runs v0.9.11 hook code. Pre-fix
  // symptom: rule-hits.jsonl saw two project encodings simultaneously
  // (`-mnt-data-ssd-...` from new code path vs `-mnt-data_ssd-...` from
  // stale `tr '/.' '-'`) — silently splitting telemetry across two keys and
  // making §11-memory-read a silent no-op for `_`-bearing cwds. Skip cases
  // (self-compare / no marketplace install / source has no hooks/) are not
  // flagged — the surface is "you have both source AND a stale market install".
  const drift2 = compareHooks(PLUGIN_ROOT, marketplacePluginRoot());
  if (drift2.skipped) {
    push('hook-drift', true, `skipped (${drift2.skippedReason})`);
  } else if (drift2.driftCount === 0) {
    push('hook-drift', true, 'marketplace hooks match source');
  } else {
    const sample = drift2.diffs.slice(0, 3).map(d => `${d.path} (${d.reason})`).join(', ');
    const more = drift2.diffs.length > 3 ? ` +${drift2.diffs.length - 3} more` : '';
    push('hook-drift', false,
      `${drift2.driftCount} hook script(s) differ between source and ${marketplacePluginRoot()}: ${sample}${more}. ` +
      `Likely cause: /plugin update is a silent no-op. Fix: /plugin uninstall claudemd@claudemd then /plugin install claudemd@claudemd, then /reload-plugins.`);
  }

  const which = (bin) => {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  push('jq', which('jq'), which('jq') ? 'present' : 'missing (required at runtime)');
  push('gh', which('gh'), which('gh') ? 'present' : 'missing (ship-baseline will fail-open silent)');

  const backups = listBackups();
  push('backups', true, `${backups.length} backup dir(s)`);

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logExists = fs.existsSync(logPath);
  const logBytes = logExists ? fs.statSync(logPath).size : 0;
  const logLines = logExists
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  const logMB = (logBytes / (1024 * 1024)).toFixed(1);
  // 5MB is well past normal daily usage — audit.js reads the whole file into
  // memory, so oversized logs slow /claudemd-audit and eat RAM. No auto-rotate;
  // just surface so the user can truncate deliberately.
  const LOG_WARN_MB = 5;
  const logOk = logBytes < LOG_WARN_MB * 1024 * 1024;
  push('logs', logOk,
    logOk
      ? `${logLines} rule-hits row(s), ${logMB} MB`
      : `${logLines} rule-hits row(s), ${logMB} MB — exceeds ${LOG_WARN_MB} MB; truncate ~/.claude/logs/claudemd.jsonl`);

  // Live self-tests: feed synthetic events into the shipped hooks and assert a
  // deny JSON comes back. Catches drift between hook patterns (banned-vocab.
  // patterns, pre-bash-safety detectors) and extraction/sanitize logic that
  // unit tests (which import regexes or parse files directly) can silently
  // paper over. Side-effect-free:
  //   - DISABLE_RULE_HITS_LOG=1 suppresses the jsonl append
  //   - kill-switch vars cleared per-spawn so the user's env can't make the
  //     test pass by disabling the very check we're verifying
  // Detect user-intent kill-switch BEFORE forcing the env clear. The self-
  // test clears kill-switch vars so it can verify the hook CODE's enforcement
  // path still works — a separate axis from user intent. When the user has
  // disabled the hook, the pass result is about code integrity, not live
  // enforcement; surface that distinction in the detail so `/claudemd-doctor`
  // output doesn't look like everything is enforced when it isn't.
  const ksEnvPlugin = process.env.DISABLE_CLAUDEMD_HOOKS === '1';

  // v0.19.1 A2 — self-test matrix covers §10-V (banned-vocab) + §8-rm-rf-var +
  // §8-npx. Each entry feeds a synthetic event into the named hook with the
  // env-clear pattern (user kill-switch surfaced as note, not as test failure)
  // so the test always proves CODE integrity even when live enforcement is OFF.
  // Adding a row = add an entry; loop drives the rest.
  const selfTests = [
    {
      name: 'banned-vocab self-test',
      hook: 'banned-vocab-check.sh',
      ksEnvVar: 'DISABLE_BANNED_VOCAB_HOOK',
      event: {
        session_id: 'doctor-selftest',
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "this is significantly better"' },
      },
      successDetail: 'synthetic "significantly" trigger correctly denied',
    },
    {
      name: 'pre-bash-safety self-test:rm-rf-var',
      hook: 'pre-bash-safety-check.sh',
      ksEnvVar: 'DISABLE_PRE_BASH_SAFETY_HOOK',
      event: {
        session_id: 'doctor-selftest',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf $UNSAFE_VAR' },
      },
      successDetail: 'synthetic "rm -rf $UNSAFE_VAR" trigger correctly denied (§8-rm-rf-var)',
    },
    {
      name: 'pre-bash-safety self-test:npx-unpinned',
      hook: 'pre-bash-safety-check.sh',
      ksEnvVar: 'DISABLE_PRE_BASH_SAFETY_HOOK',
      // Empty cwd → npx_pkg_locally_resolved returns false → §8-npx denies.
      // This is the deterministic "no lockfile, no local install" path the
      // §8 NPX rule actually guards.
      event: {
        session_id: 'doctor-selftest',
        tool_name: 'Bash',
        cwd: '',
        tool_input: { command: 'npx unknown-pkg-x9z2' },
      },
      successDetail: 'synthetic "npx unknown-pkg-x9z2" (no lockfile/local) correctly denied (§8-npx)',
    },
    {
      // v0.21.1 — Path 2 prose scan code-integrity check. Stages a synthetic
      // transcript at $HOME/.claude/projects/<encoded-cwd>/<sid>.jsonl with a
      // §10-V high-fire token in the assistant turn, then drives the hook with
      // a ship-verb command. Fail-mode this catches: region-marker regex
      // regression silently scanning 0 patterns (the v0.21.0 docstring-FP bug)
      // — tests caught it but doctor was blind. Setup writes to a mkdtemp HOME
      // so the synth transcript never lands in the user's real projects tree.
      name: 'banned-vocab self-test:prose-scan',
      hook: 'banned-vocab-check.sh',
      ksEnvVar: 'DISABLE_BANNED_VOCAB_HOOK',
      setup: (tmpDir) => {
        const synthCwd = '/doctor/selftest';
        const synthSid = 'doctor-selftest-prose';
        // Match banned-vocab-check.sh `tr '/._' '-'` per
        // feedback_cc_cwd_encoding_dots.md.
        const encoded = synthCwd.replace(/[/._]/g, '-');
        const transDir = path.join(tmpDir, '.claude/projects', encoded);
        fs.mkdirSync(transDir, { recursive: true });
        const turn = JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'This significantly improves throughput.' }] },
        });
        fs.writeFileSync(path.join(transDir, `${synthSid}.jsonl`), turn + '\n');
        return {
          event: {
            session_id: synthSid,
            tool_name: 'Bash',
            cwd: synthCwd,
            tool_input: { command: 'git push origin main' },
          },
          envOverride: { HOME: tmpDir },
        };
      },
      successDetail: 'synthetic prose "significantly" + git push correctly denied (Path 2 prose scan)',
    },
  ];

  for (const t of selfTests) {
    const hookPath = path.join(PLUGIN_ROOT, 'hooks', t.hook);
    if (!fs.existsSync(hookPath)) {
      push(t.name, false, `hook missing at ${hookPath}`);
      continue;
    }
    if (!which('jq') || !which('bash')) {
      push(t.name, false, 'prerequisite missing (jq + bash required)');
      continue;
    }
    // Per-hook kill-switch state — same dual-axis (user-env vs settings.json)
    // detection the original banned-vocab branch used.
    const tKsEnv = process.env[t.ksEnvVar] === '1';
    let tKsSettings = false;
    if (fs.existsSync(settingsPath())) {
      try {
        const s = readSettings();
        tKsSettings = s.env?.[t.ksEnvVar] === '1';
      } catch { /* unparseable surfaced separately */ }
    }
    const tKsEngaged = ksEnvPlugin || tKsEnv || tKsSettings;

    // v0.21.1 — selfTests with `setup` stage fixtures into a mkdtemp dir and
    // get an `envOverride.HOME` so the spawned hook sees the staged tree.
    // Cleanup is the creating-task's responsibility per §8.V4. Leaks here
    // would land under os.tmpdir(), not the user's ~/.claude/projects/.
    let event = t.event;
    let envOverride = {};
    let cleanupDir = null;
    if (t.setup) {
      cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-selftest-'));
      const s = t.setup(cleanupDir);
      event = s.event;
      envOverride = s.envOverride || {};
    }

    const r = spawnSync('bash', [hookPath], {
      input: JSON.stringify(event),
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        DISABLE_RULE_HITS_LOG: '1',
        DISABLE_CLAUDEMD_HOOKS: '',
        [t.ksEnvVar]: '',
        // v0.21.2 — neutralize user-env Path 2 toggles. If the user has set
        // CLAUDEMD_PATH2_DRY_RUN=1 (observability rollout) or
        // BANNED_VOCAB_PROSE_SCAN=0 (Path 2 disabled), the prose-scan self-
        // test would silently pass-as-empty instead of testing the deny path.
        // Self-tests verify hook CODE integrity, not live enforcement —
        // separate axis from user intent.
        CLAUDEMD_PATH2_DRY_RUN: '',
        BANNED_VOCAB_PROSE_SCAN: '',
        ...envOverride,
      },
    });

    if (cleanupDir) {
      try { fs.rmSync(cleanupDir, { recursive: true, force: true }); } catch { /* tmp leak benign */ }
    }

    const denied = r.status === 0 && /"permissionDecision"\s*:\s*"deny"/.test(r.stdout || '');
    const ksNote = tKsEngaged
      ? ' — note: kill-switch engaged in user env/settings; hook will NOT fire in practice'
      : '';
    push(t.name, denied,
      (denied
        ? t.successDetail
        : `hook did not deny synthetic trigger (status=${r.status}, stdout="${(r.stdout || '').slice(0, 80).replace(/\s+/g, ' ').trim()}")`)
      + ksNote);
  }

  // v0.7.1 R-N6 — bypass:deny ratio per spec section. Surfaces §0.1
  // demotion candidates from v0.7.0's `byBypass` data. Sections firing < 3
  // events in 30d are skipped (statistical floor); the (unset) bucket is
  // skipped as it carries pre-v0.7.0 rows with no section attribution.
  //
  // v0.8.5 R-N6+ — when a section trips the demotion threshold, surface
  // WHICH `[allow-X]` token is driving the bypass. Operator now sees both
  // (a) "rule too strict / wording confuses" (high ratio) AND (b) "via
  // which escape token" — the latter distinguishes "single token consistently
  // overused" (likely rule design issue) from "multiple tokens distributed"
  // (likely cross-cutting friction). Token detail only attached to demotion
  // candidates; healthy rows stay terse.
  const ruleHitsLog = path.join(logsDir(), 'claudemd.jsonl');
  const { hits: recentHits, totalLines: rhTotal, skipped: rhSkipped } = readHits(ruleHitsLog, RULE_USAGE_WINDOW_DAYS);
  // Hook fail-open advisory. A `fail-open` row means a hook hit a missing
  // prerequisite and exited 0 instead of enforcing. Classify by REASON, not by
  // session attribution: hook_record_failopen (hooks/lib/hook-common.sh) does
  // NOT thread session_id, so every fail-open row is session_id:null (real or
  // synthetic) — gating on session_id would make the ok:false branch dead code
  // and silently downgrade genuine bypasses. The discriminating signal is the
  // reason:
  //   - `bad-event` (empty/malformed stdin) CANNOT occur on a live CC
  //     PreToolUse pipe (CC always pipes the event JSON) → synthetic/manual
  //     invocation (`echo "" | hook`, fail-open.test.sh) → advisory ok:true.
  //   - `jq-missing` / `patterns-missing` are genuine live-env failures that
  //     disable enforcement → ok:false, investigate and restore.
  // Pre-fix this was unconditional ok:false, so 2 stray bad-event rows
  // mis-reported a healthy install.
  const failOpenEvents = recentHits.filter(h => h.event === 'fail-open');
  if (failOpenEvents.length > 0) {
    const liveFailOpen = failOpenEvents.filter(h => (h.extra?.reason || '') !== 'bad-event');
    const noiseCount = failOpenEvents.length - liveFailOpen.length;
    const byReason = {};
    for (const h of liveFailOpen) {
      const key = `${h.hook}:${h.extra?.reason || '(unspecified)'}`;
      byReason[key] = (byReason[key] || 0) + 1;
    }
    const summary = Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
    if (liveFailOpen.length > 0) {
      checks.push({
        name: 'hook-fail-open',
        ok: false,
        detail: `${liveFailOpen.length} live-environment fail-open event(s) in ${RULE_USAGE_WINDOW_DAYS}d (${summary}); enforcement silently bypassed (jq / patterns-file prerequisite missing). Investigate and restore.`,
      });
    } else {
      checks.push({
        name: 'hook-fail-open',
        ok: true,
        detail: `${noiseCount} bad-event fail-open event(s) in ${RULE_USAGE_WINDOW_DAYS}d (empty-stdin synthetic/manual hook invocation — cannot occur on a live PreToolUse pipe); advisory only, not a live bypass.`,
      });
    }
  }
  // Surface log-corruption signal as an advisory check. Threshold 1% — below
  // that is normal noise (race writes during rotation, partial last-line
  // flushes); above signals systemic damage worth investigating because
  // §13.1 demote decisions are downstream.
  if (rhTotal > 0 && rhSkipped / rhTotal > 0.01) {
    const pct = Math.round((rhSkipped / rhTotal) * 1000) / 10;
    checks.push({
      name: 'rule-hits-integrity',
      ok: false,
      detail: `${rhSkipped}/${rhTotal} rule-hits log lines failed JSON.parse (${pct}%); §13.1 audit data is biased. Inspect ~/.claude/logs/claudemd.jsonl for truncated rows.`,
    });
  }
  // Rule-usage (and its §0.1 demote verdict) must count REAL sessions only,
  // matching audit.js (excludeTestSessions). readHits returns raw rows; without
  // this filter, manual-probe / sentinel-session rows (session_id ≤7 chars —
  // the excludeTestSessions cohort) inflate deny/bypass counts: the 2026-07-03
  // audit observed ship-baseline deny=17 here vs =9 in audit.js on the same 30d
  // window. The fail-open check above intentionally stays on raw recentHits —
  // its rows are session_id:null (excludeTestSessions keeps them) and it
  // classifies by reason, not session.
  const realHits = excludeTestSessions(recentHits);
  const bySection = groupBySection(realHits);
  for (const section of Object.keys(bySection).sort()) {
    // v0.9.37: skip all (unset*) variants — `(unset)` (single-bucket legacy)
    // + `(unset-historical)` / `(unset-current)` (cutover-split). All three
    // are bookkeeping buckets, not spec rules, and would self-FP as demote
    // candidates if scored against deny/bypass ratio.
    if (section === '(unset)' || section.startsWith('(unset-')) continue;
    const data = bySection[section];
    // Count the full blocking-deny family (deny + deny-repeat + deny-prose),
    // not just literal `deny`. Pre-fix this undercounted blocks for §11-memory-
    // read (deny-repeat) and §10-V (deny-prose), inflating bypass:deny and
    // FALSELY flagging healthy rules as §0.1 demote candidates.
    const deny = blockingDenyCount(data.byEvent);
    const bypass = data.byEvent['bypass-escape-hatch'] || 0;
    const total = deny + bypass;
    if (total < RULE_USAGE_MIN_TOTAL) continue;
    const ratio = bypass / total;
    const ratioPct = (ratio * 100).toFixed(0);
    if (ratio > RULE_USAGE_DEMOTION_RATIO && IMMUTABLE_SECTION_RE.test(section)) {
      // §8 SAFETY is §5.1 Never-downgrade — a high bypass ratio is expected
      // ceremony on known-safe ops, NOT a demote signal. Surface for visibility,
      // but never the "§0.1 demotion candidate" label (an action policy forbids).
      // Low-ratio §8 falls through to the normal healthy branch below.
      push(`rule-usage:${section}`, true,
        `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, immutable §8 SAFETY — high bypass is known-safe-op ceremony, not a §0.1 demote signal)`);
      continue;
    }
    if (ratio > RULE_USAGE_DEMOTION_RATIO) {
      // R-N6+: per-token breakdown of the section's bypass events. Sort by
      // count desc, secondary alpha so output is deterministic across runs.
      const tokens = {};
      for (const h of realHits) {
        if (h.event !== 'bypass-escape-hatch') continue;
        if ((h.spec_section || '(unset)') !== section) continue;
        const tok = h.extra?.token || '(unspecified)';
        tokens[tok] = (tokens[tok] || 0) + 1;
      }
      const tokenList = Object.entries(tokens)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tok, n]) => `[${tok}]×${n}`)
        .join(', ');
      push(`rule-usage:${section}`, false,
        `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, §0.1 demotion candidate; bypass via ${tokenList})`);
    } else {
      push(`rule-usage:${section}`, true,
        `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, healthy)`);
    }
  }

  // v0.9.35 — §11-EXT Tag-specificity (SHOULD) static check. Scans
  // ~/.claude/projects/*/memory/MEMORY.md for tags that substring-match
  // incidental release-notes / commit-message prose at ship time. Same FP
  // family as v0.9.27→v0.9.28 (`cli`⊂`clippy`) and the 2026-05-11
  // `semantic`⊂`semantics` incident. Advisory only — spec §11-EXT is SHOULD,
  // not MUST. See scripts/lib/memory-tags.js for heuristic + wordlist.
  const { findings: tagFindings, scannedFiles } = scanMemoryTags();
  if (tagFindings.length === 0) {
    push('memory-tag-specificity', true,
      `scanned ${scannedFiles} MEMORY.md file(s), 0 generic-tag candidates`);
  } else {
    // Group by memDir+file for readable output: one row per (memDir, file)
    // listing all flagged tags with reasons.
    const byEntry = new Map();
    for (const f of tagFindings) {
      const key = `${f.memDir}::${f.file}`;
      if (!byEntry.has(key)) byEntry.set(key, { memDir: f.memDir, file: f.file, tags: [] });
      byEntry.get(key).tags.push(`${f.tag}(${f.reasons.join(',')})`);
    }
    const sample = [...byEntry.values()].slice(0, 3).map(e => {
      const projectDir = path.basename(path.dirname(e.memDir));
      return `${projectDir}/${e.file}: ${e.tags.join(', ')}`;
    });
    const more = byEntry.size > 3 ? ` +${byEntry.size - 3} more` : '';
    push('memory-tag-specificity', false,
      `${tagFindings.length} generic-tag candidate(s) across ${byEntry.size} entry(ies) in ${scannedFiles} MEMORY.md file(s); ` +
      `risk of §11 ship-time FP per spec §11-EXT (v6.11.11). ` +
      `Samples: ${sample.join(' | ')}${more}. ` +
      `Fix: rename to multi-word plugin-specific (e.g. \`impact\`→\`impact-analysis\`, \`refs\`→\`find-references\`).`);
  }

  const pruned = prune != null ? pruneBackups(prune) : [];

  return { checks, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  let parsed;
  try {
    parsed = parseStrict(process.argv.slice(2), { values: ['--prune-backups'] });
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  let prune;
  const raw = parsed.values['--prune-backups'];
  if (raw !== undefined) {
    // parsePositiveInt rejects '2.5' (truncation footgun) AND '0x1e'/'1e2'
    // (Number() over-coercion) — extra important here because this flag is
    // DESTRUCTIVE: e.g. `--prune-backups=0x1` would silently retain only 1.
    const val = parsePositiveInt(raw);
    if (val === null) {
      console.error(
        `--prune-backups requires a positive integer retain count (got '${raw}').\n` +
        `  Examples: --prune-backups=5 (keep 5 newest), --prune-backups=1 (keep only the newest).\n` +
        `  To remove ALL backups, delete ~/.claude/backup-* manually — this flag cannot do that.`
      );
      process.exit(1);
    }
    prune = val;
  }
  doctor({ pruneBackups: prune }).then(r => console.log(JSON.stringify(r, null, 2)));
}
