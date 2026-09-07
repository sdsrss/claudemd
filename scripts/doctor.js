import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  logsDir,
  settingsPath,
  specHome,
  homeSpec,
  readManifest,
  marketplacePluginRoot,
  readPluginVersion,
  SEMVER_RE,
  semverCmp,
  stateDir,
} from './lib/paths.js';
import { routingPrimaries } from './lib/spec-routing.js';
import {
  listBackups,
  pruneBackups,
  backupGlobs,
  findLegacySpecBackups,
  BACKUP_LABELS,
} from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';
import { compareSpecs } from './lib/spec-hash.js';
import { compareHooks } from './lib/install-drift.js';
import {
  readHits,
  groupBySection,
  blockingDenyCount,
  excludeTestSessions,
  IMMUTABLE_SECTION_RE,
} from './lib/rule-hits-parse.js';
import { scanMemoryTags, scanMemoryIndexSizes, MEMORY_INDEX_BUDGET_BYTES } from './lib/memory-tags.js';
import {
  memoryMaintenance,
  CITE_MIN,
  PROMOTE_MIN_AGE_DAYS,
  RECALL_MAX_AGE_DAYS,
  STALE_AGE_DAYS,
} from './lib/memory-maintenance.js';
import { scanRunbookReviewSteps } from './lib/runbook-review-check.js';
import { runHookSelfTests } from './lib/doctor-hook-tests.js';
import { cleanStateDir, readRetentionFromClaudeMd, DEFAULT_RETENTION_DAYS } from './clean-residue.js';
import { printHelpAndExit, parsePositiveInt, invokedAsMain, parseStrictOrExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/doctor.js [--prune-backups=N]

Run health checks on claudemd installation. Flags missing deps, spec drift,
settings.json issues, hook drift, backup inventory, rule-usage health, and §4
Routing primaries disabled via skillOverrides.

Options:
  --prune-backups=N   Keep the N newest backup dirs per namespace (positive
                      integer ≥1). Dirs reported by the
                      backup-namespace-legacy check are skipped — never
                      deleted, never counted toward N — and listed under
                      pruneSkippedLegacy; sort those by hand. To remove ALL
                      backups, delete
                      ${backupGlobs()}
                      manually — this flag cannot do that.
  --help, -h          Print this message and exit.

Wrapped by /claudemd-doctor.


Read-only with ONE exception: reading the install manifest relocates a
pre-0.1.9 ~/.claude/.claudemd-state/installed.json to its current path.
The move is lossless and happens once (Round-14 audit SCR-L5 — the
"read-only command" description did not mention it).
Exit codes: 0 all checks passed | 1 validation error | 2 argv-shape error | 3 one or more checks failed.`;

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// v0.7.1 R-N6 — doctor surfaces §0.1 demotion candidates from v0.7.0's
// bypass-vs-deny audit data. A spec section whose users override its denies
// more often than they comply with them is signalling either "rule too strict"
// or "rule wording confuses". OPERATOR.md §13.1 says core entries
// with 0 hits in 30d are demotion candidates; this catch is the inverse —
// hits exist, but they're routinely escape-hatched.
const RULE_USAGE_WINDOW_DAYS = 30;
const RULE_USAGE_DEMOTION_RATIO = 0.5;
// Floor below which the bypass:deny ratio is statistically meaningless.
// 3 events over 30 days is the smallest sample where a 50%+ override rate
// reliably distinguishes signal from a single-incident artifact.
const RULE_USAGE_MIN_TOTAL = 3;
// v0.23.6 — why this file cares about IMMUTABLE_SECTION_RE (imported above; the
// pattern itself lives in lib/rule-hits-parse.js since 2026-09-02, audit
// R11-13c, because hard-rules-audit.js held a byte-identical copy):
// the §8 SAFETY family is immutable per spec §5.1 Never-downgrade, so a high
// bypass ratio there is expected ceremony on risky-but-known-safe ops (npx with
// no lockfile under user trust, rm -rf on a validated var), NOT a "rule too
// strict → demote" signal. Surface the ratio, never emit the "§0.1 demotion
// candidate" label — it would recommend an action the policy forbids.
// Scope is §8-only on purpose: the other §5.1 Never-downgrade sections that own
// a rule-hits label (§7-user-global-state, §iron-law-2) are advisory
// Stop-hook-only (warn / structure-advisory, never deny+bypass), so total=0 <
// RULE_USAGE_MIN_TOTAL and they cannot reach this demote branch at all.

// Advisory checks are operator judgement calls whose steady state is non-zero
// (generic memory tags, index size over a SOFT budget, promote candidates, a
// bypass ratio with no codified demote rule). Counting them would make
// `/claudemd-doctor` report failure on a healthy install every time, which is
// how an exit code stops carrying information.
//
// `routing:skills-enabled` joined the list in 0.71.1, on the release that added
// it. Its steady state is non-zero BY ADJUDICATION: spec v6.25.4 settles that
// §4 keeps naming skills an operator may reasonably have switched off, and that
// the degradation path is §12's fallback table. Without this entry the check
// would have made `/claudemd-doctor` exit 3 forever on any machine that disabled
// a routed skill — the exact failure the paragraph above describes, shipped in
// the same release that describes the check as advisory. Caught by the pre-tag
// review; the regex was the half of "advisory" that had not been written down.
//
// Exported (rather than inlined at the CLI exit-code site, where it lived until
// 0.71.1) so a test can assert the real predicate instead of reading this
// comment — a gate that reads prose is the failure this repo keeps closing.
const ADVISORY =
  /^(memory-tag-specificity|memory-index-size|memory-maintenance:|rule-usage:|runbook-review-step|state-dir-orphans|routing:skills-enabled|gh$)/;
export const isAdvisoryCheck = name => ADVISORY.test(name);

export async function doctor({ pruneBackups: prune } = {}) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const m = readManifest();
  push(
    'manifest',
    m.exists && m.data != null,
    m.exists && m.data != null
      ? m.migrated
        ? `present at ${m.path} (relocated from pre-0.1.9 state dir)`
        : 'present'
      : 'missing — is plugin installed?'
  );

  // D8 (v0.5.4): orphan-manifest detection. CC marketplace lifecycle does not
  // fire `preUninstall`, so /plugin uninstall claudemd@claudemd leaves the
  // manifest behind. Verify `manifest.pluginRoot` still exists; if not,
  // surface the cleanup hint pointing at /claudemd-uninstall (which must run
  // BEFORE /plugin uninstall to avoid this state — see commands/claudemd-
  // uninstall.md). Advisory only: orphan manifest is benign but stale.
  if (m.exists && m.data?.pluginRoot) {
    const orphan = !fs.existsSync(m.data.pluginRoot);
    push(
      'plugin cache',
      !orphan,
      orphan
        ? `manifest.pluginRoot (${m.data.pluginRoot}) no longer exists — orphan manifest. ` +
            `Likely cause: /plugin uninstall claudemd@claudemd ran without /claudemd-uninstall first. ` +
            `Either /plugin install claudemd@claudemd to rebootstrap, or rm ~/.claude/.claudemd-manifest.json by hand.`
        : `present at ${m.data.pluginRoot}`
    );
    // v0.36.0 — stale-pluginRoot detection (tasks/manifest-pluginroot-stale-
    // cache.md): the recorded root still exists but holds an OLDER plugin than
    // the marketplace. CC may keep firing hooks from that dir until the
    // registration is refreshed; pre-guard those hooks downgraded the home
    // spec every session (reproduced 2026-07-11). The bootstrap paths now
    // refuse the downgrade; this check surfaces the state so the user runs
    // the refresh instead of wondering why hooks lag a version. Skipped when
    // either side has no strict-semver version (dev-mode root, no marketplace
    // install) — nothing comparable to diagnose.
    if (!orphan) {
      const rootVer = readPluginVersion(m.data.pluginRoot);
      const mktVer = readPluginVersion(marketplacePluginRoot());
      if (SEMVER_RE.test(rootVer) && SEMVER_RE.test(mktVer)) {
        const stale = semverCmp(rootVer, mktVer) < 0;
        push(
          'plugin cache:staleness',
          !stale,
          stale
            ? `manifest.pluginRoot holds v${rootVer} but the marketplace has v${mktVer} — stale registration; ` +
                `hooks may run old code. Fix: /claudemd-refresh (or /plugin uninstall claudemd@claudemd, /plugin install claudemd@claudemd, /reload-plugins).`
            : `manifest.pluginRoot v${rootVer} is current vs marketplace v${mktVer}`
        );
      }
    }
  }

  if (fs.existsSync(settingsPath())) {
    try {
      readSettings();
      push('settings.json', true, 'parseable');
    } catch (e) {
      push('settings.json', false, e.message);
    }
  } else {
    push('settings.json', false, 'missing');
  }

  for (const p of specHome()) {
    push(`spec:${path.basename(p)}`, fs.existsSync(p), fs.existsSync(p) ? 'present' : 'missing');
  }

  // §4 Routing primaries that this machine has switched off.
  //
  // The spec routes work at named skills; `skillOverrides` in settings.json can
  // turn any of them off; nothing related the two. The 2026-07-10 /doctor cleanup
  // disabled 49 zero-use skills and deliberately kept the ones CORE §2.1 routes —
  // but §EXT §4 is a SECOND routing table, and eight of its primaries went off
  // with it. The gap surfaced once, by accident, during an unrelated /doctor run
  // in July; it was carried to a governance review, appeared in no review record,
  // and fell off the loop silently. An accident is not a detector, so this is one.
  //
  // Read against the INSTALLED spec, not the repo's: what the agent loads at
  // runtime is ~/.claude/CLAUDE-extended.md, and a machine can sit on an older
  // copy (that drift has its own check above). Advisory — a routed-but-disabled
  // skill degrades through the §12 fallback table rather than breaking anything,
  // which is exactly why it can stay wrong for months without a complaint.
  const extSpec = homeSpec('CLAUDE-extended.md');
  if (fs.existsSync(extSpec) && fs.existsSync(settingsPath())) {
    let overrides = null;
    try {
      overrides = readSettings().skillOverrides || {};
    } catch {
      /* unparseable settings.json is already its own failing check */
    }
    if (overrides) {
      let primaries;
      try {
        primaries = routingPrimaries(fs.readFileSync(extSpec, 'utf8'));
      } catch {
        primaries = new Map();
      }
      const isOff = n => overrides[n] === 'off' || overrides[n] === false;
      const off = [...primaries.keys()].filter(tok => isOff(tok.split('/')[1]));
      // A floor, for the same reason the §12 join in spec-structure.test.js has
      // one: an installed spec whose §4 table moved would resolve zero primaries,
      // find zero disabled ones, and report a clean routing surface having read
      // nothing. Below the floor the honest answer is "could not evaluate".
      if (primaries.size < 15) {
        push(
          'routing:skills-enabled',
          false,
          `resolved only ${primaries.size} §4 Routing primary skill(s) from ${extSpec} — the table moved or the spec is truncated; cannot evaluate whether routed skills are enabled.`
        );
      } else if (off.length > 0) {
        push(
          'routing:skills-enabled',
          false,
          `${off.length} of ${primaries.size} §4 Routing primaries are "off" in skillOverrides: ${off.join(', ')}. ` +
            'The spec routes work at skills this machine cannot invoke. Fix either side: re-enable them in ' +
            '~/.claude/settings.json, or drop the rows from §4 Routing (and their §12 Fallback rows) so the ' +
            'table describes what is actually reachable.'
        );
      } else {
        push('routing:skills-enabled', true, `all ${primaries.size} §4 Routing primaries are enabled`);
      }
    }
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
      push(`spec-hash:${s.name}`, false, `shipped spec missing at ${path.join(PLUGIN_ROOT, 'spec', s.name)}`);
    } else if (s.installed === null) {
      push(
        `spec-hash:${s.name}`,
        false,
        `installed spec missing — /plugin install claudemd@claudemd to bootstrap`
      );
    } else if (s.match) {
      push(`spec-hash:${s.name}`, true, `${s.shipped.slice(0, 12)}… matches`);
    } else {
      push(
        `spec-hash:${s.name}`,
        false,
        `installed ${s.installed.slice(0, 12)}… ≠ shipped ${s.shipped.slice(0, 12)}… — local edits or stale install; run /claudemd-update to sync`
      );
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
    const sample = drift2.diffs
      .slice(0, 3)
      .map(d => `${d.path} (${d.reason})`)
      .join(', ');
    const more = drift2.diffs.length > 3 ? ` +${drift2.diffs.length - 3} more` : '';
    push(
      'hook-drift',
      false,
      `${drift2.driftCount} hook script(s) differ between source and ${marketplacePluginRoot()}: ${sample}${more}. ` +
        `Likely cause: /plugin update is a silent no-op. Fix: /claudemd-refresh (or /plugin uninstall claudemd@claudemd then /plugin install claudemd@claudemd, then /reload-plugins).`
    );
  }

  // 2026-08-16 audit F3: second spec axis. Axis 1 above (shipped-source vs
  // installed) self-compares when doctor runs from the repo, so it can never
  // see the drift the SessionStart banner fires on: marketplace-shipped (what
  // CC actually installs) vs installed ~/.claude. The hooks side has carried
  // this axis since v0.9.22 (compareHooks above); the spec side was blind —
  // during the v0.66.0 post-tag-edit incident the banner fired 713 times over
  // 4 days while doctor exited 0 and reported every spec hash green.
  const mktRoot = marketplacePluginRoot();
  if (!fs.existsSync(mktRoot)) {
    push('spec-cache-drift', true, 'skipped (market-root-missing)');
  } else if (path.resolve(mktRoot) === path.resolve(PLUGIN_ROOT)) {
    push('spec-cache-drift', true, 'skipped (self-compare)');
  } else if (!fs.existsSync(path.join(mktRoot, 'spec'))) {
    push('spec-cache-drift', true, 'skipped (market-spec-missing)');
  } else {
    // Missing-file rows are axis-1 territory (install completeness); this
    // axis flags only same-version content forks: both present, hashes differ.
    const cacheDrift = compareSpecs(mktRoot).filter(s => !s.missing && !s.match);
    if (cacheDrift.length === 0) {
      push('spec-cache-drift', true, 'installed spec matches marketplace-shipped');
    } else {
      push(
        'spec-cache-drift',
        false,
        `${cacheDrift.length} spec file(s) differ between installed ~/.claude and ${mktRoot}: ` +
          `${cacheDrift.map(s => s.name).join(', ')}. Same-version content fork — ` +
          `post-tag spec edit or interrupted copy. Fix: ship a version bump ` +
          `(spec edits belong in the plugin), or /claudemd-update if installed is stale.`
      );
    }
  }

  const which = bin => {
    try {
      execSync(`command -v ${bin}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  // Resolve once each: the previous form called which() twice per binary (four
  // execSync spawns for two lookups).
  const hasJq = which('jq');
  const hasGh = which('gh');
  push('jq', hasJq, hasJq ? 'present' : 'missing (required at runtime)');
  // `gh` is advisory: it is needed only by ship-baseline-check, and a machine
  // that never pushes to GitHub is not unhealthy for lacking it. As a counted
  // check it made `/claudemd-doctor` exit 3 forever there — the exact
  // "steady state is non-zero, so the exit code stops carrying information"
  // shape the ADVISORY block above exists to prevent (audit R11-23). Still
  // reported, with what it costs.
  push(
    'gh',
    hasGh,
    hasGh ? 'present' : 'missing (advisory) — ship-baseline-check fails open silently without it'
  );

  // Inventory spans EVERY namespace (audit-2026-08-22 P1-1). Reporting only the
  // default label would have made update.js's `spec-backup-` dirs invisible to
  // the one command a user runs to see what claudemd left in ~/.claude — the
  // "gate narrower than its subject" shape this release is closing elsewhere.
  const backupsByLabel = Object.values(BACKUP_LABELS).map(label => ({ label, dirs: listBackups({ label }) }));
  const backups = backupsByLabel.flatMap(b => b.dirs);
  const backupBreakdown = backupsByLabel
    .filter(b => b.dirs.length > 0)
    .map(b => `${b.label}-* ${b.dirs.length}`)
    .join(', ');
  push('backups', true, `${backups.length} backup dir(s)${backupBreakdown ? ` (${backupBreakdown})` : ''}`);

  // Legacy spec backups sitting in the PERSONAL namespace. P1-1 stopped new
  // ones landing there but is forward-only, so on an installation old enough to
  // have run updates before 0.68.3, `CLAUDEMD_SPEC_ACTION=restore` still
  // returns whichever of these is newest instead of the user's own CLAUDE.md,
  // and they still count against pruneBackups(BACKUP_RETAIN_COUNT).
  //
  // Reported, never moved. A spec-shaped dir here may have been written by
  // update.js OR by an install.js from before v0.23.11 (which backed up
  // unconditionally) — and in the second case it can hold user files alongside
  // the spec. Nothing available at runtime tells the two apart, so the choice
  // is the user's; see tasks/legacy-spec-backup-migration.md.
  const legacySpecBackups = findLegacySpecBackups();
  push(
    'backup-namespace-legacy',
    legacySpecBackups.length === 0,
    legacySpecBackups.length === 0
      ? 'no spec-shaped dirs in the personal backup namespace'
      : `${legacySpecBackups.length} dir(s) under ~/.claude/${BACKUP_LABELS.personal}-* hold a ` +
          `spec-shaped CLAUDE.md, so restore returns a spec rather than your own file: ` +
          legacySpecBackups
            .map(b => `${path.basename(b.dir)}` + (b.siblings.length ? ` (+ ${b.siblings.join(', ')})` : ''))
            .join(', ') +
          `. Not moved automatically — a dir with sibling files may be a genuine ` +
          `personal backup from a pre-v0.23.11 install. Inspect, then move or delete by hand.`
  );

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logExists = fs.existsSync(logPath);
  const logBytes = logExists ? fs.statSync(logPath).size : 0;
  const logLines = logExists ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0;
  const logMB = (logBytes / (1024 * 1024)).toFixed(1);
  // 5MB is well past normal daily usage — audit.js reads the whole file into
  // memory, so oversized logs slow /claudemd-audit and eat RAM. No auto-rotate;
  // just surface so the user can truncate deliberately.
  const LOG_WARN_MB = 5;
  const logOk = logBytes < LOG_WARN_MB * 1024 * 1024;
  push(
    'logs',
    logOk,
    logOk
      ? `${logLines} rule-hits row(s), ${logMB} MB`
      : `${logLines} rule-hits row(s), ${logMB} MB — exceeds ${LOG_WARN_MB} MB; truncate ~/.claude/logs/claudemd.jsonl`
  );

  // The two synthetic-event tables live in lib/doctor-hook-tests.js. They are a
  // source-text subject of two gates (subject-set-drift's liveness partition and
  // spec-structure's retired-vocabulary list), both of which name that path.
  runHookSelfTests({ push, which, pluginRoot: PLUGIN_ROOT });

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
  const {
    hits: recentHits,
    totalLines: rhTotal,
    skipped: rhSkipped,
  } = readHits(ruleHitsLog, RULE_USAGE_WINDOW_DAYS);
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
  //
  // Third class, 2026-09-05 audit ENG-03: the gate ran and had NOTHING TO
  // EVALUATE. `mem-index-missing` means the project has no MEMORY.md, which is
  // the normal state of most projects. Lumping it with the prerequisite
  // failures printed "enforcement silently bypassed (jq / patterns-file
  // prerequisite missing). Investigate and restore." — a repair instruction
  // that repairs nothing — and held doctor at exit 3 for the full 30-day window
  // after one ship command in one index-less project. That is the
  // steady-state-nonzero shape 0.72.0 and 0.74.2 already fixed twice elsewhere:
  // an exit code that is always red carries no information.
  //
  // EXACTLY ONE reason is advisory, and the two that were nearly added beside it
  // are why this comment is long (0.76.2 pre-tag review, H-1 / MEDIUM-1 — two
  // independent reviewers converged on it). `transcript-missing` and
  // `event-fields-missing` are not "no memory here", they are the cwd-encoding
  // DRIFT ALARM that audit R10-06b added. memory-read-check.sh says it outright
  // beside those very emitters — "A mis-derived ENCODED makes BOTH paths miss,
  // which is indistinguishable from 'this project has no memory index' unless
  // the row says which one was absent" — and records that the encoding has
  // really drifted twice, each time silently no-opping the gate with nothing
  // left behind to say so. `transcript-missing` is emitted only AFTER the index
  // was found, so it means the project HAS memory and the session file is
  // unlocatable, which is the drift signature itself. An earlier draft of this
  // block put both in the advisory set and cited memory-read-check.sh as the
  // authority for doing so; that file says the opposite. Fed 200 rows of the
  // drift signature, that draft answered ok:true, "enforcement itself is
  // intact" — the wrong sentence for a total bypass.
  //
  // The UNEVALUABLE set is the closed one, so a reason nobody has classified yet
  // (a new emitter, a renamed constant) lands in the ok:false bucket by default
  // rather than being quietly downgraded to advisory.
  const UNEVALUABLE_REASONS = new Set(['mem-index-missing']);
  const failOpenEvents = recentHits.filter(h => h.event === 'fail-open');
  if (failOpenEvents.length > 0) {
    const liveFailOpen = failOpenEvents.filter(h => (h.extra?.reason || '') !== 'bad-event');
    const noiseCount = failOpenEvents.length - liveFailOpen.length;
    const unevaluable = liveFailOpen.filter(h => UNEVALUABLE_REASONS.has(h.extra?.reason || ''));
    const prereqFailOpen = liveFailOpen.filter(h => !UNEVALUABLE_REASONS.has(h.extra?.reason || ''));
    const summarize = rows => {
      const byReason = {};
      for (const h of rows) {
        const key = `${h.hook}:${h.extra?.reason || '(unspecified)'}`;
        byReason[key] = (byReason[key] || 0) + 1;
      }
      return Object.entries(byReason)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`)
        .join(', ');
    };
    // Both counts print on either branch: a red row must not hide the advisory
    // rows behind it, and an advisory row must not read as "nothing happened".
    const unevaluableClause = unevaluable.length
      ? ` Separately, ${unevaluable.length} gate invocation(s) could not evaluate (${summarize(unevaluable)}) — the project had no MEMORY.md / transcript, which is not a bypass.`
      : '';
    if (prereqFailOpen.length > 0) {
      checks.push({
        name: 'hook-fail-open',
        ok: false,
        detail: `${prereqFailOpen.length} live-environment fail-open event(s) in ${RULE_USAGE_WINDOW_DAYS}d (${summarize(prereqFailOpen)}); enforcement silently bypassed (jq / patterns-file prerequisite missing). Investigate and restore.${unevaluableClause}`,
      });
    } else if (unevaluable.length > 0) {
      checks.push({
        name: 'hook-fail-open',
        ok: true,
        detail: `${unevaluable.length} gate invocation(s) in ${RULE_USAGE_WINDOW_DAYS}d could not evaluate (${summarize(unevaluable)}): the project directory had no MEMORY.md index or no session transcript, so the rule had nothing to check — enforcement itself is intact. Add a memory index to those projects if they should have one; otherwise this is expected.`,
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
      push(
        `rule-usage:${section}`,
        true,
        `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, immutable §8 SAFETY — high bypass is known-safe-op ceremony, not a §0.1 demote signal)`
      );
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
      // v0.57.0 — label corrected. This branch used to read "§0.1 demotion
      // candidate", citing a rule the spec does not contain: §0.1 demotes on
      // ZERO hits, and a bypass-rate threshold appears in the spec only as a
      // §13.3 PROMOTION gate (<10% to advance). A high override rate is a real
      // signal, but the action it licenses is a review, not a demotion — and
      // the mislabel cost the operator a full re-adjudication every run
      // (2026-07-25 audit; `tasks/banned-vocab-demote-evaluation-2026-07-25.md`
      // settled the same question for §10-V). Since v0.57.0 `banned-vocab`
      // bypass rows carry `extra.matched`, so the review can act per-term.
      push(
        `rule-usage:${section}`,
        false,
        `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, high override — take to the §13.2 batch review; ` +
          `no demote-by-bypass-rate rule exists, so this is not a demotion candidate); bypass via ${tokenList}`
      );
    } else {
      push(`rule-usage:${section}`, true, `30d deny=${deny} bypass=${bypass} (ratio ${ratioPct}%, healthy)`);
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
    push(
      'memory-tag-specificity',
      true,
      `scanned ${scannedFiles} MEMORY.md file(s), 0 generic-tag candidates`
    );
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
    push(
      'memory-tag-specificity',
      false,
      `${tagFindings.length} generic-tag candidate(s) across ${byEntry.size} entry(ies) in ${scannedFiles} MEMORY.md file(s); ` +
        `risk of §11 ship-time FP per spec §11-EXT (v6.11.11). ` +
        `Samples: ${sample.join(' | ')}${more}. ` +
        `Fix: rename to multi-word plugin-specific (e.g. \`impact\`→\`impact-analysis\`, \`refs\`→\`find-references\`).`
    );
  }

  // v0.30.0 E2 — cross-layer memory maintenance (plan P5). Wrong-layer
  // placement fails silently; this surfaces candidates only — migration is a
  // §5-scoped write and stays the operator's call. See lib/memory-maintenance.js.
  const mm = await memoryMaintenance();
  const promoteDetail = mm.promoteSkipped
    ? `skipped: ${mm.promoteSkipped}`
    : mm.promoteToDurable.length === 0
      ? `0 candidates (mem-lite lessons cited ≥${CITE_MIN}× alive ≥${PROMOTE_MIN_AGE_DAYS}d)`
      : `${mm.promoteToDurable.length} promote-to-durable candidate(s) — high-frequency recall is de-facto ` +
        `long-term knowledge; consider a MEMORY.md entry (operator's call, no auto-migration): ` +
        mm.promoteToDurable
          .slice(0, 5)
          .map(c => `#${c.id} "${c.title}" (cited ${c.citedCount}×)`)
          .join(', ');
  // A SKIPPED check is not a PASSED check — but "optional dependency absent" is
  // not a broken check either. claude-mem-lite is a separate plugin and Node
  // 20–22.4 (the declared engines floor, and a CI matrix leg) has no node:sqlite,
  // so failing on those would report a broken install to every user without the
  // plugin and set exit 3 on a healthy machine. Only an unreadable DB is a real
  // failure; the two absence reasons stay ok with the reason in the detail.
  const promoteUnavailable =
    mm.promoteSkipped != null && /DB not found|node:sqlite unavailable/.test(mm.promoteSkipped);
  const promoteOk = promoteUnavailable || (mm.promoteSkipped == null && mm.promoteToDurable.length === 0);
  push('memory-maintenance:promote', promoteOk, promoteDetail);
  push(
    'memory-maintenance:recall-repatriation',
    mm.recallRepatriation.length === 0,
    mm.recallRepatriation.length === 0
      ? `0 recall_*.md older than ${RECALL_MAX_AGE_DAYS}d in ${mm.memDir}`
      : `${mm.recallRepatriation.length} plugin-absent fallback file(s) linger past ${RECALL_MAX_AGE_DAYS}d — ` +
          `migrate into claude-mem-lite or delete: ` +
          mm.recallRepatriation
            .slice(0, 5)
            .map(c => `${c.file} (${c.ageDays}d)`)
            .join(', ')
  );
  push(
    'memory-maintenance:stale',
    mm.staleDurable.length === 0,
    mm.staleDurable.length === 0
      ? `0 durable files >${STALE_AGE_DAYS}d without a telemetry keyword mention (${mm.scannedDurableFiles} scanned)`
      : `${mm.staleDurable.length} durable file(s) >${STALE_AGE_DAYS}d old with zero keyword mentions in the ` +
          `telemetry window — review tags or retire: ` +
          mm.staleDurable
            .slice(0, 5)
            .map(c => `${c.file} (${c.ageDays}d)`)
            .join(', ')
  );

  // v0.35.0 R2 — Tier-2 index size budget (soft). See lib/memory-tags.js
  // MEMORY_INDEX_BUDGET_BYTES for rationale (2026-07-11 spec-audit R2: the
  // index loads every session and had no size governance; §0.1 only caps
  // core/extended). Advisory: doctor reports, operator prunes.
  // v0.74.2 — each index is judged against ITS OWN budget: the default, or the
  // one it declares (`<!-- index-budget: 28KB -->`). A declared budget is named
  // in the line it makes green, so raising it is a visible decision rather than
  // a silent one, and a malformed declaration fails the check instead of
  // quietly reverting to the default.
  const idx = scanMemoryIndexSizes();
  const budgetKb = (MEMORY_INDEX_BUDGET_BYTES / 1024).toFixed(0);
  const kb = b => (b / 1024).toFixed(1);
  const label = i =>
    `${path.basename(path.dirname(i.memDir))}/MEMORY.md ${kb(i.bytes)}KB (${i.entries} entries` +
    (i.budgetDeclared ? `, declared budget ${(i.budgetBytes / 1024).toFixed(0)}KB` : '') +
    ')';
  const malformed = idx.indexes.filter(i => i.budgetError);
  const overBudget = idx.indexes.filter(i => i.bytes > i.budgetBytes);
  const declaredCount = idx.indexes.filter(i => i.budgetDeclared).length;
  const declaredNote = declaredCount > 0 ? `; ${declaredCount} declare their own budget` : '';
  // The two faults are reported TOGETHER, never as alternatives. An earlier
  // draft branched malformed-else-overBudget, so one typo anywhere on the
  // machine suppressed every genuine over-budget index in the same run — an
  // advisory withholding the finding the operator needed, which is the exact
  // failure this release is about. Caught in the pre-tag review.
  const malformedNote =
    malformed.length > 0
      ? `${malformed.length}/${idx.scannedFiles} MEMORY.md file(s) carry an unusable index-budget declaration: ` +
        malformed
          .map(i => `${path.basename(path.dirname(i.memDir))}/MEMORY.md — ${i.budgetError}`)
          .join(', ') +
        `. The declaration is ignored until it parses, so the ${budgetKb}KB default is in force for those files. `
      : '';
  if (malformed.length === 0 && overBudget.length === 0) {
    const largest = idx.indexes[0]; // scan returns bytes-desc sorted
    push(
      'memory-index-size',
      true,
      `${idx.scannedFiles} MEMORY.md file(s) within budget (default ${budgetKb}KB${declaredNote})` +
        (largest ? ` (largest ${label(largest)})` : '')
    );
  } else if (overBudget.length === 0) {
    push('memory-index-size', false, malformedNote.trimEnd());
  } else {
    const sample = overBudget.slice(0, 3).map(label).join(', ');
    const more = overBudget.length > 3 ? ` +${overBudget.length - 3} more` : '';
    push(
      'memory-index-size',
      false,
      malformedNote +
        `${overBudget.length}/${idx.scannedFiles} MEMORY.md file(s) exceed their budget (default ${budgetKb}KB${declaredNote}): ${sample}${more}. ` +
        `The Tier-2 index loads into context every session of its project — prune closed-loop project_* entries, ` +
        `compress descriptions, or declare a budget you have judged acceptable with an ` +
        `\`<!-- index-budget: NNKB -->\` line in the index (operator's call, no auto-trim; spec-audit 2026-07-11 R2).`
    );
  }

  // v0.61.0 — ship-runbook review-step presence (advisory). Origin: the
  // 2026-07-27 v0.60.0 incident sweep found ALL SIX projects' ship runbooks
  // lacked a review-before-tag step (§EXT §12 Author ≠ reviewer) — and this
  // check's first live run caught a SEVENTH the manual sweep missed (gsd,
  // filename had neither "runbook" nor "ship"). Detection is ABSENCE of a
  // review-step fingerprint in runbook-classified files, never a keyword hit
  // on "self-review" (fixed runbooks legitimately contain that word as a
  // named degrade). Listing only — rewriting a runbook is a §5-scoped write
  // to user-authored memory (tasks/deferred-2026-07-27-doctor-runbook-review-check.md).
  // v0.65.0 — state-dir orphan visibility (2026-07-28 audit H3). The plugin's
  // own state dir accumulated 39 orphans (oldest 79 days) while sitting outside
  // every cleaner AND every health check: this file had zero references to it,
  // clean-residue.js had zero, and residue-audit.sh only watches ~/.claude/tmp.
  // Growth is unbounded — one `ext-read-*` leaks per session that never reaches
  // SessionEnd — so the point of this check is that the count is SEEN, not that
  // some threshold is sacred. Reporting only; deletion stays behind the AUTH'd
  // /claudemd-clean-residue path.
  // v0.74.2 — the threshold judges the REAPABLE subset, not the whole
  // population. Those are different sets, and only one of them is actionable:
  // three of the eight ephemeral kinds (session-ref / session-summary /
  // tmp-baseline) are written once per session and are supposed to sit here for
  // the whole retention window, so the total is session-rate x window and
  // crossed a fixed 50-file line permanently once v0.68/v0.69 added them to the
  // pattern list. Measured 2026-09-04 on the maintainer's machine: 189
  // ephemeral files, 0 past the window — the advisory was red and the remedy it
  // printed was a no-op, which is the shape that teaches an operator to ignore
  // the health checker. Same class as R11-27's floor: a threshold on the scan
  // total is not a threshold on the decidable subset.
  try {
    const stateDirPath = stateDir();
    const ORPHAN_ADVISORY_THRESHOLD = 50;
    // Derived from the growth model, not picked: the population is
    // session-rate x retention window x 3 per-session sentinel kinds. Measured
    // 2026-09-04 at 189 files = 63 sessions in a 7-day window (~9/day). 1000 is
    // that same arithmetic at ~48 sessions/day — over five times the observed
    // rate, so ordinary heavy use cannot reach it and a per-invocation writer
    // reaches it in hours.
    const POPULATION_CEILING = 1000;
    // Window resolved the way clean-residue resolves it, from the same helper —
    // a project that sets TMP_RETENTION_DAYS moves BOTH numbers together. Dry
    // run: `apply` defaults to false, so this never deletes.
    //
    // The window is read from `<cwd>/CLAUDE.md`, so it depends on where doctor
    // was STARTED (Round-14 audit SCR-MAINT). That is the intended behaviour —
    // a project sets its own retention and both tools must agree — but the
    // number moving between two runs with no visible cause is not, so the
    // message below names where it came from.
    const projectWindow = readRetentionFromClaudeMd();
    const windowSource =
      projectWindow == null ? 'the built-in default' : `TMP_RETENTION_DAYS in ${process.cwd()}/CLAUDE.md`;
    const {
      scanned: candidates,
      targets,
      retentionDays: window,
    } = cleanStateDir({
      stateDir: stateDirPath,
      retentionDays: projectWindow ?? DEFAULT_RETENTION_DAYS,
    });
    const summarize = list => {
      const byKind = list.reduce((acc, c) => {
        acc[c.kind] = (acc[c.kind] || 0) + 1;
        return acc;
      }, {});
      return (
        Object.entries(byKind)
          .map(([k, n]) => `${k}=${n}`)
          .join(', ') || 'none'
      );
    };
    // Both numbers on BOTH paths: "clean" and "nothing was reapable" must not
    // print the same thing, and the total is the figure that shows unbounded
    // growth even while the reapable subset is zero.
    const scale = `${targets.length} reapable of ${candidates.length} ephemeral state file(s) in ${stateDirPath}`;
    const breakdown = `(past the ${window}-day window from ${windowSource}: ${summarize(targets)}; all: ${summarize(candidates)})`;
    const advisory = 'Advisory: this never fails the doctor exit code.';
    if (targets.length > ORPHAN_ADVISORY_THRESHOLD) {
      push(
        'state-dir-orphans',
        false,
        `${scale} exceed the ${ORPHAN_ADVISORY_THRESHOLD} advisory threshold — ` +
          `run /claudemd-clean-residue --apply to delete exactly those ${targets.length} ` +
          `${breakdown}. ${advisory}`
      );
    } else if (candidates.length > POPULATION_CEILING) {
      // The second failure mode, and the one this check was BORN for (v0.65.0:
      // "growth is unbounded — one ext-read-* leaks per session that never
      // reaches SessionEnd"). Moving the primary threshold onto the reapable
      // subset would otherwise have left no value of the total that can fail:
      // if a hook regression makes session_id vary per INVOCATION rather than
      // per session, every write lands in a fresh filename, nothing ever ages
      // past the window, `targets` stays 0 forever, and the directory grows
      // without bound behind a green check. Caught in the pre-tag review of
      // this very release, which measured it staying green at 5,000 files.
      //
      // Deliberately a different remedy: `--apply` is a no-op here too, and
      // shipping a red line whose fix does nothing is the defect this release
      // exists to remove — it must not be reintroduced one branch over.
      push(
        'state-dir-orphans',
        false,
        `${scale} — the total exceeds the ${POPULATION_CEILING}-file ceiling while only ` +
          `${targets.length} are reapable ${breakdown}. /claudemd-clean-residue --apply will NOT ` +
          `help: the writers are outrunning the ${window}-day window. Look for a per-session ` +
          `sentinel being written per INVOCATION (a session_id that changes within one session). ` +
          `${advisory}`
      );
    } else {
      push(
        'state-dir-orphans',
        true,
        `${scale} — past the ${window}-day window from ${windowSource}: ${summarize(targets)}; all: ${summarize(candidates)}`
      );
    }
  } catch (e) {
    // Never let a health check take down the health checker — but SAY SO
    // (Round-14 audit SCR-MAINT). A bare `catch {}` here meant an internal
    // throw produced no check line and no count, so the whole orphan inventory
    // was simply absent from a green, exit-0 report — indistinguishable from a
    // clean state dir. Advisory, like every other outcome of this block.
    push(
      'state-dir-orphans',
      true,
      `could not be measured (${e && e.message ? e.message : e}) — this check reported nothing, ` +
        `which is not the same as a clean state dir. Advisory: this never fails the doctor exit code.`
    );
  }

  const rrs = scanRunbookReviewSteps({});
  if (rrs.missing.length === 0) {
    push(
      'runbook-review-step',
      true,
      `${rrs.scannedRunbooks} ship-runbook file(s) scanned, all carry a review-before-tag step`
    );
  } else {
    const sample = rrs.missing
      .slice(0, 4)
      .map(m => `${m.project.replace(/^-.*-projects-/, '')}/${m.file} [${m.tier}]`)
      .join(', ');
    const more = rrs.missing.length > 4 ? ` +${rrs.missing.length - 4} more` : '';
    push(
      'runbook-review-step',
      false,
      `${rrs.missing.length}/${rrs.scannedRunbooks} ship-runbook file(s) lack a review-before-tag step: ${sample}${more}. ` +
        `Add the §EXT §12 Author ≠ reviewer line at the decision point (rule text loaded ≠ enforced — ` +
        `the checklist wins); operator edit, no auto-rewrite.`
    );
  }

  // Retain N per namespace. Pruning only the default label would leave the
  // maintenance flag unable to reach the dirs the inventory above now reports.
  //
  // The legacy spec-shaped dirs the `backup-namespace-legacy` check reports are
  // excluded — neither deleted nor counted against the retain window. They live
  // in the personal namespace but were written by update.js (or a pre-v0.23.11
  // install.js), and on a pre-0.68.3 layout they are the NEWEST dirs there, so
  // an unfiltered prune retained the spec and deleted the user's real backup:
  // the check above says "not moved automatically, the choice is the user's"
  // while the same run destroyed the thing it was protecting (2026-08-29 audit
  // R10-03). One caliber for both: `pruneSkippedLegacy` reports the exact set
  // the inventory named, so the two numbers cannot drift apart silently.
  const pruneSkippedLegacy = legacySpecBackups.map(b => b.dir);
  const pruned =
    prune != null
      ? Object.values(BACKUP_LABELS).flatMap(label =>
          pruneBackups(prune, { label, exclude: pruneSkippedLegacy })
        )
      : [];

  return { checks, pruned, pruneSkippedLegacy: prune != null ? pruneSkippedLegacy : [] };
}

if (invokedAsMain(import.meta.url)) {
  printHelpAndExit(process.argv.slice(2), USAGE);
  const parsed = parseStrictOrExit(process.argv.slice(2), { values: ['--prune-backups'] });
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
          `  To remove ALL backups, delete ${backupGlobs()} manually — this flag cannot do that.`
      );
      process.exit(1);
    }
    prune = val;
  }
  doctor({ pruneBackups: prune })
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
      // Exit non-zero when checks failed. This always exited 0 regardless of
      // results (4/42 failing still reported success), so any CI step or hook
      // gating on `node scripts/doctor.js` was a no-op (2026-07-25 audit).
      //
      // Code 3, not 1: 1 already means "argv rejected", and reusing it would make
      // a failing health check indistinguishable from a typo'd flag — the same
      // exit-code overloading this pass is removing elsewhere.
      const failed = (r.checks || []).filter(c => c && c.ok === false && !isAdvisoryCheck(c.name)).length;
      if (failed > 0) process.exitCode = 3;
    })
    .catch(err => {
      // Without this, ANY throw inside doctor() surfaced as a bare unhandled
      // rejection — Node prints a stack and exits before a single check line is
      // written, so the one command a user runs to diagnose ~/.claude fails in
      // the least diagnostic way available. The backup inventory reads whatever
      // dirs happen to be in ~/.claude, and 0.68.3 widened that from one
      // namespace to three, so a dangling symlink or an unreadable dir there is
      // a live input, not a hypothetical.
      console.error(`[claudemd] doctor failed: ${err && err.message ? err.message : err}`);
      if (process.env.CLAUDEMD_DEBUG) console.error(err);
      process.exitCode = 1;
    });
}
