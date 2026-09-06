// doctor-hook-tests.js — the two synthetic-event tables `/claudemd-doctor` runs
// against the shipped hooks, extracted from doctor.js (round-13 P2-1, partial).
//
// SOURCE-TEXT SUBJECT. tests/scripts/subject-set-drift.test.js reads THIS FILE
// as text, not as a value: it extracts the covered set from the liveness table's
// object-literal shape and the complement from the skip map's declaration, then
// requires their union to equal HOOK_REGISTRY. Both tables were moved together
// for that reason — splitting them across two files would change what that
// gate's union is computed over. tests/scripts/spec-structure.test.js also reads
// this file, for retired vocabulary. Adding a check here that either gate should
// see means checking that gate still names this path
// (feedback_gate_scope_must_cover_its_subject).
//
// DO NOT quote either extraction pattern verbatim in a comment here. The first
// draft of this header did, and both greps found the comment instead of the
// code: the covered set gained a phantom entry from the illustrative name, and
// the skip map's non-greedy match terminated inside the header, reporting an
// empty complement and failing the gate for four hooks that are listed. Describe
// the shapes, do not reproduce them — the same trap tests/lib/shell-files.sh
// records for the tool it feeds.
//
// Everything the tables need that doctor() owns is passed in: `push` appends to
// its checks array, `which` is its memoised binary lookup, `pluginRoot` is where
// the hooks live. Nothing here reads doctor's other locals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { settingsPath, encodeProjectCwd } from './paths.js';
import { HOOK_REGISTRY } from './hook-registry.js';
import { readSettings } from './settings-merge.js';

export function runHookSelfTests({ push, which, pluginRoot }) {
  const PLUGIN_ROOT = pluginRoot;
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
      setup: tmpDir => {
        const synthCwd = '/doctor/selftest';
        const synthSid = 'doctor-selftest-prose';
        // banned-vocab-check.sh locates the transcript via hook_encode_project
        // (a per-CHARACTER bash loop since 2026-07-17, not the `tr -c` it
        // replaced — the two differ on every non-ASCII char); use the
        // single-source JS encoder, which parity tests pin against it.
        const encoded = encodeProjectCwd(synthCwd);
        const transDir = path.join(tmpDir, '.claude/projects', encoded);
        fs.mkdirSync(transDir, { recursive: true });
        const turn = JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'This significantly improves throughput.' }],
          },
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
      } catch {
        /* unparseable surfaced separately */
      }
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
      try {
        fs.rmSync(cleanupDir, { recursive: true, force: true });
      } catch {
        /* tmp leak benign */
      }
    }

    const denied = r.status === 0 && /"permissionDecision"\s*:\s*"deny"/.test(r.stdout || '');
    const ksNote = tKsEngaged
      ? ' — note: kill-switch engaged in user env/settings; hook will NOT fire in practice'
      : '';
    push(
      t.name,
      denied,
      (denied
        ? t.successDetail
        : `hook did not deny synthetic trigger (status=${r.status}, stdout="${(r.stdout || '').slice(0, 80).replace(/\s+/g, ' ').trim()}")`) +
        ksNote
    );
  }

  // OBS-2 (roadmap, 2026-07-12 audit): field-liveness self-checks for the
  // advisory hooks the deny self-tests above don't reach. The Stop hooks +
  // PostToolUse fire every turn but never emit a deny, so a silent breakage (an
  // introduced jq/syntax error, an unbound var under `set -u`) was invisible to
  // doctor — before OBS-2 it self-tested only the two deny-emitting hooks. Each entry feeds a synthetic
  // event of the hook's registered type under an ISOLATED mkdtemp HOME (so the
  // state-writing hooks — residue-audit / session-summary / mem-audit /
  // sandbox-disposal — can't touch the real ~/.claude) and asserts the hook
  // exits 0 with no shell-crash signature on stderr. Hooks left out of the table
  // are enumerated with their reason in LIVENESS_SKIPPED below.
  const CRASH_RE = /: line \d+:|syntax error|unbound variable|: command not found/;
  const stopEvt = {
    session_id: 'doctor-selftest',
    hook_event_name: 'Stop',
    transcript_path: '/tmp/claudemd-doctor-none.jsonl',
  };
  // Kill-switch names come from HOOK_REGISTRY, not a hand-written literal per
  // row. They were spelled out here in a fourth parallel list, so a renamed
  // envVarSuffix would leave doctor clearing a variable no hook reads while the
  // user's real DISABLE_* survived into the spawn — the hook would exit at its
  // guard, satisfy status===0 with clean stderr, and this check would report
  // green on a hook it never actually ran (2026-07-25 audit).
  const ksFor = basename => {
    const entry = HOOK_REGISTRY.find(h => h.basename === basename);
    if (!entry) throw new Error(`doctor liveness: ${basename} is not in HOOK_REGISTRY`);
    return `DISABLE_${entry.envVarSuffix}_HOOK`;
  };
  // The complement, written out. The table below covers 11 of the 15 hooks; the
  // comment above named 2 of the 4 it leaves out, so two hooks were outside both
  // the check and its stated scope (audit-2026-08-22 条目 8). Keys here plus the
  // table's `hook` fields must union to HOOK_REGISTRY — asserted by
  // tests/scripts/subject-set-drift.test.js, so a hook added tomorrow has to
  // land in one list or the other rather than in neither.
  // Read as SOURCE by tests/scripts/subject-set-drift.test.js, not as a value — the
  // name and the object-literal shape are the contract, so this cannot be
  // renamed to `_LIVENESS_SKIPPED` (the gate's regex anchors on the identifier)
  // nor deleted (docs/ADDING-NEW-HOOK.md sends new hooks here).
  // eslint-disable-next-line no-unused-vars
  const LIVENESS_SKIPPED = {
    'session-start-check.sh':
      'bootstraps the install and makes a network call — unsafe to trigger from a health command; tests/hooks/session-start.test.sh covers it',
    'version-sync.sh':
      'spawns a background re-install — same reason; tests/integration/upgrade-lifecycle.test.sh covers it',
    'pre-bash-safety-check.sh':
      'a blocking PreToolUse gate whose no-op path needs a real Bash event; tests/hooks/pre-bash-safety.test.sh drives 598 corpus rows against it',
    'banned-vocab-check.sh': 'same blocking-gate shape; tests/hooks/banned-vocab.test.sh covers it',
  };
  const livenessTests = [
    {
      hook: 'memory-read-check.sh',
      ks: ksFor('memory-read-check.sh'),
      event: { session_id: 'doctor-selftest', tool_name: 'Read', tool_input: { file_path: '/tmp/none' } },
    },
    {
      hook: 'ship-baseline-check.sh',
      ks: ksFor('ship-baseline-check.sh'),
      event: { session_id: 'doctor-selftest', tool_name: 'Bash', tool_input: { command: 'true' } },
    },
    {
      hook: 'session-extended-read.sh',
      ks: ksFor('session-extended-read.sh'),
      event: { session_id: 'doctor-selftest', tool_name: 'Read', tool_input: { file_path: '/tmp/none' } },
    },
    {
      hook: 'transcript-vocab-scan.sh',
      ks: ksFor('transcript-vocab-scan.sh'),
      event: {
        session_id: 'doctor-selftest',
        tool_name: 'Bash',
        tool_input: { command: 'true' },
        tool_response: {},
      },
    },
    {
      hook: 'session-end-check.sh',
      ks: ksFor('session-end-check.sh'),
      event: { session_id: 'doctor-selftest', hook_event_name: 'SessionEnd' },
    },
    { hook: 'session-summary.sh', ks: ksFor('session-summary.sh'), event: stopEvt },
    { hook: 'mem-audit.sh', ks: ksFor('mem-audit.sh'), event: stopEvt },
    { hook: 'residue-audit.sh', ks: ksFor('residue-audit.sh'), event: stopEvt },
    { hook: 'sandbox-disposal-check.sh', ks: ksFor('sandbox-disposal-check.sh'), event: stopEvt },
    { hook: 'transcript-structure-scan.sh', ks: ksFor('transcript-structure-scan.sh'), event: stopEvt },
    {
      hook: 'memory-prompt-hint.sh',
      ks: ksFor('memory-prompt-hint.sh'),
      event: { session_id: 'doctor-selftest', hook_event_name: 'UserPromptSubmit', prompt: 'hello' },
    },
  ];
  for (const t of livenessTests) {
    const hookPath = path.join(PLUGIN_ROOT, 'hooks', t.hook);
    const name = `${t.hook.replace(/\.sh$/, '')} liveness`;
    if (!fs.existsSync(hookPath)) {
      push(name, false, `hook missing at ${hookPath}`);
      continue;
    }
    if (!which('jq') || !which('bash')) {
      push(name, false, 'prerequisite missing (jq + bash required)');
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-live-'));
    let r;
    try {
      fs.mkdirSync(path.join(tmp, '.claude/logs'), { recursive: true });
      r = spawnSync('bash', [hookPath], {
        input: JSON.stringify(t.event),
        encoding: 'utf8',
        timeout: 5000,
        // Isolated HOME + kill-switches cleared → tests CODE integrity, not live
        // enforcement; any state write lands in tmp and is removed below.
        env: {
          ...process.env,
          HOME: tmp,
          DISABLE_RULE_HITS_LOG: '1',
          DISABLE_CLAUDEMD_HOOKS: '',
          [t.ks]: '',
        },
      });
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* tmp leak benign */
      }
    }
    const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
    const crash = CRASH_RE.test(r.stderr || '');
    // Exiting at the kill-switch guard ALSO yields status===0 with clean stderr,
    // so "ran clean" is only meaningful if the switch we cleared is the one the
    // hook actually reads. Assert that against the hook's own guard argument.
    const guardArg = (fs.readFileSync(hookPath, 'utf8').match(/hook_kill_switch\s+([A-Z_]+)/) || [])[1];
    // Fail CLOSED on an unreadable guard: `guardArg ? … : true` let a hook with
    // no matchable `hook_kill_switch` line pass the very check that exists to
    // catch a kill-switch mismatch.
    const guardMatches = guardArg !== undefined && `DISABLE_${guardArg}_HOOK` === t.ks;
    const ok = r.status === 0 && !crash && !timedOut && guardMatches;
    push(
      name,
      ok,
      ok
        ? `ran clean on synthetic event (exit 0, no shell crash, kill-switch ${t.ks} verified)`
        : !guardMatches
          ? `kill-switch mismatch: registry says ${t.ks} but the hook guards on DISABLE_${guardArg}_HOOK — doctor cleared the wrong variable, so this hook may have no-opped`
          : `hook errored (status=${r.status}${timedOut ? ', TIMED OUT' : ''}, stderr="${(r.stderr || '').slice(0, 120).replace(/\s+/g, ' ').trim()}")`
    );
  }
}
