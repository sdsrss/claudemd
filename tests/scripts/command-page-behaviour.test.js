// command-page-behaviour.test.js — D#493 (0.113.4).
//
// 0.113.3 changed what six commands do and left their pages, the text the model
// reads before it runs them and tells the user what happened, saying the old
// thing: an audit "of this project" that scores every project, "exits 0 by
// default" beside a new exit 1, a status field the page never names. A page is
// an instruction, so a stale one is a wrong instruction.
//
// Each case pins the page's sentence as a whole line (a regex over a page is
// satisfied by the next reword that still says the wrong thing) and, where the
// behaviour is cheap to run, runs it and checks that what the sentence names —
// an exit status, a field, a value, a command — is what the code produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageLines = name =>
  fs.readFileSync(path.join(REPO, 'commands', `claudemd-${name}.md`), 'utf8').split('\n');
const assertLine = (name, line) =>
  assert.ok(pageLines(name).includes(line), `commands/claudemd-${name}.md lacks the line:\n${line}`);
const run = (script, args, env) =>
  spawnSync(process.execPath, [path.join(REPO, 'scripts', script), ...args], { encoding: 'utf8', env });

const box = useHomeSandbox('cmdpage');

test('bypass-audit: the page says --cwd is a lookup fallback, as --help does', () => {
  assertLine(
    'bypass-audit',
    "The audit covers every project's suggest rows in the rule-hits log, not only this one: each row is scored against the transcript in the project the row names. `--cwd` (default: the current working directory) is only where a transcript is looked for when that fails or the row names no project, so it does not narrow the numbers to one project."
  );
  assertLine(
    'bypass-audit',
    '- `totalMissingTranscript` ≈ `totalSuggestions` = the transcripts are in neither place the audit looks: the project each row names, then `--cwd`. A deleted or synthetic session cannot be recovered; for sessions that ran in another project, re-run with `--cwd=<that project>`.'
  );
  const r = run('lesson-bypass-audit.js', ['--help'], box.env());
  assert.equal(r.status, 0);
  assert.match(r.stdout.replace(/\s+/g, ' '), /does NOT narrow the audit/);
});

test('analyze: the page names exit 1 for an audit that cannot run, and the CLI exits 1 on a non-directory --project', () => {
  assertLine(
    'analyze',
    "This command is read-only. Without `--strict` it exits 0 whatever it finds; `--strict` exits 1 on CRITICAL or HIGH findings — suitable for pre-tag ship gate. Either way it exits 1 when the audit cannot run (a `--project`/`--cwd` that is not a directory, the two given different values, a file it reads that cannot be read, such as a spec file or the project's MEMORY.md) and 2 on an argument it does not accept: report those as a failed run, not as a clean audit."
  );
  const missing = path.join(box.home, 'no-such-project');
  const r = run('spec-coherence-audit.js', [`--project=${missing}`], box.env());
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /is not a directory/);
  assert.equal(run('spec-coherence-audit.js', ['--no-such-flag'], box.env()).status, 2);
  // The CLI's own --help said the same stale thing ("always exit 0").
  const help = run('spec-coherence-audit.js', ['--help'], box.env());
  assert.doesNotMatch(help.stdout, /always exit 0/);
  assert.match(help.stdout, /Default: exit 0 whatever the findings \(advisory\)\./);
});

test('uninstall: the restore bullet says a symlinked file comes back as a link', () => {
  assertLine(
    'uninstall',
    '  This restores; it does not remove. A file that was a symlink when claudemd backed it up (a `CLAUDE.md` kept in a dotfiles repo, say) comes back as a link to the file it pointed at, not as a copy (an absolute link, also when the original was relative); a link whose target is gone is skipped. `CLAUDE-extended.md`, `CLAUDE-changelog.md` and `OPERATOR.md` — spec files claudemd added that you never had — are left in place, because removing spec files is `CLAUDEMD_SPEC_ACTION=delete` and that path is gated behind `CLAUDEMD_CONFIRM=1`. Claude Code does not auto-load those three, so they are inert; delete them by hand if you want them gone. `~/.claude/spec-modules/` is left in place too, and with the claudemd hooks gone nothing injects it.'
  );
});

test('refresh: the page relays what the script prints when the install fails after the uninstall', () => {
  const line =
    'If the script exits non-zero after its uninstall step succeeded, its stderr says the plugin is NOT installed now: relay that and the reinstall commands it prints — `claude plugin install claudemd@claudemd` in a shell, or `/plugin install claudemd@claudemd` and then `/reload-plugins` inside Claude Code. Do not report the refresh as done.';
  assertLine('refresh', line);
  // Run the script against a `claude` shim whose install fails, as
  // refresh-plugin.test.js 162 does, and read what it actually prints.
  const bin = box.dir('bin');
  fs.writeFileSync(
    path.join(bin, 'claude'),
    '#!/usr/bin/env bash\n[[ "$*" == plugin\\ install* ]] && exit 3\nexit 0\n'
  );
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const r = spawnSync('bash', [path.join(REPO, 'scripts/refresh-plugin.sh')], {
    encoding: 'utf8',
    env: box.env({ PATH: [bin, '/usr/bin', '/bin'].join(':') }),
  });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /is NOT installed now/);
  // The whole line, so a changed command or a sentence around it fails here.
  assert.ok(
    r.stderr
      .split('\n')
      .includes(
        'Reinstall it: claude plugin install claudemd@claudemd   (inside Claude Code: /plugin install claudemd@claudemd, then /reload-plugins)'
      ),
    r.stderr
  );
});

test('status: every field and value the page names for an unparseable manifest is in the output', () => {
  const line =
    '- If `plugin.manifestError` is `unparseable`: an install manifest is on disk but could not be read. Relay `plugin.detail`, which names `/claudemd-install` as the fix, and do not suggest `/plugin install`. `plugin.hint` is `manifest-unparseable` unless the cache hint above applies, which keeps its own hint and `cacheVersions`; then give both.';
  assertLine('status', line);
  fs.writeFileSync(box.claude('.claudemd-manifest.json'), '{"version":"0.1.0","entr');
  const r = run('status.js', [], box.env());
  assert.equal(r.status, 0, r.stderr);
  const plugin = JSON.parse(r.stdout).plugin;
  assert.equal(plugin.manifestError, 'unparseable');
  assert.equal(plugin.manifestPath, box.claude('.claudemd-manifest.json'));
  assert.match(plugin.detail, /\/claudemd-install/);
  assert.equal(plugin.hint, 'manifest-unparseable');
  fs.mkdirSync(box.claude('plugins/cache/claudemd/claudemd/0.6.5'), { recursive: true });
  const cached = JSON.parse(run('status.js', [], box.env()).stdout).plugin;
  assert.equal(cached.hint, 'cache-present-bootstrap-pending');
  assert.deepEqual(cached.cacheVersions, ['0.6.5']);
  assert.equal(cached.manifestError, 'unparseable');
});

test('status: an unparseable settings.json is named in the output, and the page says to relay it (160a)', () => {
  // Reproduced 2026-10-20: a truncated ~/.claude/settings.json read exactly
  // like one that sets no kill switch — `pendingKillSwitches: {}`, empty
  // stderr, no field naming the file — because readSettings' throw was caught
  // into `{}`.
  const settings = box.claude('settings.json');
  const body = JSON.stringify({ env: { DISABLE_TMP_SWEEP_HOOK: '1' } });
  // The project layer is the sandbox home, whose .claude/settings.json IS the
  // user file and is skipped; the repo's own .claude/settings.json stays out.
  const env = box.env({ CLAUDE_PROJECT_DIR: box.home });
  delete env.DISABLE_TMP_SWEEP_HOOK;
  const statusOut = () => {
    const r = run('status.js', [], env);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  // Control: the same file, parseable, reports the switch it sets, and no
  // settings error.
  fs.writeFileSync(settings, body);
  const valid = statusOut();
  assert.deepEqual(valid.pendingKillSwitches.tmp_sweep, { effective: false, persisted: true });
  assert.equal(valid.settings, undefined, JSON.stringify(valid.settings));
  fs.writeFileSync(settings, body.slice(0, -3));
  const broken = statusOut();
  assert.equal(broken.settings?.settingsError, 'unparseable', JSON.stringify(broken));
  assert.equal(broken.settings.settingsPath, settings);
  assert.match(broken.settings.detail, /not valid JSON/);
  // V8's message quotes the file around some faults — this one comes back as
  // `..."":{"T":tru,"U":"sk-l"...` — and settings.json can hold tokens in
  // `env`: the detail the model relays carries none of it.
  fs.writeFileSync(settings, '{"env":{"T":tru,"U":"sk-leak-9"}}');
  const quoted = statusOut();
  assert.equal(quoted.settings?.settingsError, 'unparseable');
  assert.doesNotMatch(quoted.settings.detail, /sk-l/);
  assertLine(
    'status',
    '- If `settings.settingsError` is `unparseable`: `settings.settingsPath` (the user `settings.json`) is on disk but is not valid JSON, so the kill switches it sets are left out of `pendingKillSwitches` and the `persisted` values. Relay `settings.detail` and do not describe the kill-switch state as complete.'
  );
});

test('install: the page names specBackupDir, and the field holds the copy of an edited spec (163)', () => {
  assertLine(
    'install',
    '- `specBackupDir`: on `overwrite-spec`, the `spec-backup-<ISO>/` directory the replaced spec files were copied to because they differed from the shipped ones (an older version, or edits made to the installed spec); `null` otherwise. When it is set, name it: anything the user had added to `~/.claude/CLAUDE.md` by hand is in that copy, not in the new file.'
  );
  const env = box.env({ CLAUDE_PLUGIN_ROOT: REPO, CLAUDEMD_NO_STATUSLINE: '1' });
  assert.equal(run('install.js', [], env).status, 0);
  const edited = `${fs.readFileSync(box.claude('CLAUDE.md'), 'utf8')}\nmy note\n`;
  fs.writeFileSync(box.claude('CLAUDE.md'), edited);
  const r = run('install.js', [], env);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.spec, 'overwrite-spec');
  assert.match(path.basename(out.specBackupDir), /^spec-backup-/);
  assert.equal(fs.readFileSync(path.join(out.specBackupDir, 'CLAUDE.md'), 'utf8'), edited);
});

test('statusline: the page says remove restores the whole saved slot and adopt refuses a non-object settings.json', () => {
  assertLine(
    'statusline',
    "Show the transition first: run `detect --json`; if `verdict` is `claudemd`, state what `settings.statusLine` will become (the prior statusLine as it was saved — the whole object, `padding` included — if one was saved, else removed) and that `~/.claude/claudemd-statusline.sh` will be deleted. If `verdict` is `host` and `guestRegistered`, remove unregisters claudemd from the host's registry (restoring a superseded provider if one was saved and the host has no provider with its id now) and deletes the renderer unless another provider runs it once the remove is done: one listed in `rendererRunBy`, or a superseded provider the remove restores; then the file stays and the result's `rendererKept` names that provider. The host keeps the slot. Then run:"
  );
  const line =
    "If `adopt` exits 1 with `statusline-adopt failed: statusline: <path> parses to null, not a JSON object` (or to `an array`, `a JSON string`, `a JSON number` or `a JSON boolean`): nothing was written, and `detect` reads such a file as `absent`. Tell the user to replace the file's content with a JSON object (`{}` is valid) and re-run.";
  assertLine('statusline', line);
  fs.writeFileSync(box.claude('settings.json'), 'null\n');
  const detect = run('statusline-adopt.js', ['detect', '--json'], box.env());
  assert.equal(JSON.parse(detect.stdout).verdict, 'absent');
  const adopt = run('statusline-adopt.js', ['adopt', '--json'], box.env());
  assert.equal(adopt.status, 1);
  assert.match(adopt.stderr, /^statusline-adopt failed: statusline: .+ parses to null, not a JSON object/m);
  assert.equal(fs.readFileSync(box.claude('settings.json'), 'utf8'), 'null\n');
});

// D#610: code-graph keeps a slot it took over as provider `_previous`, so our
// command can render inside the host while claudemd is not a registered guest.
// The page branched on guestRegistered alone and registered a guest there,
// which showed claudemd's segment twice.
test('statusline: the page stops when a host provider already runs our renderer, and detect/adopt say what it names', () => {
  assertLine(
    'statusline',
    '- `host` → the slot is owned by a composite host (`host`, e.g. `code-graph`) that renders multiple providers. Do NOT clobber it. Run `detect --json` and read `providers`, `guestRegistered` and `rendererInUse`:'
  );
  assertLine(
    'statusline',
    "  - `guestRegistered: false`, `rendererInUse: true` → the host already runs claudemd's renderer under another provider id, listed in `rendererRunBy` (code-graph keeps a slot it took over as `_previous`). Registering would show claudemd's segment twice. Report that id and STOP; register (Step 1) only if the user asks for a second segment. If `dest.matchesShipped` is `false`, offer `adopt --empty-only`, which refreshes the renderer copy and registers nothing."
  );
  assertLine(
    'statusline',
    "  - `guestRegistered: true` → claudemd is already a segment. Report and STOP unless the user wants a refresh (re-run adopt). If `rendererRunBy` is non-empty, another provider runs the same renderer and claudemd's segment shows twice: say so; `remove` unregisters claudemd's own entry and keeps the renderer for that provider."
  );
  assertLine(
    'statusline',
    'Report the `action` (`removed` / `restored` / `unregistered` / `not-ours`). For `unregistered`, cite `restored` if any, `notRestored` if set (saved providers left in `~/.claude/.claudemd-state/statusline-prev.json` because the host already has a provider with that id), and `rendererKept` (the providers the renderer was kept for) if set. If `not-ours`, nothing was changed.'
  );
  assertLine(
    'statusline',
    "  - `guestRegistered: false`, `rendererInUse: false` → claudemd will register as a guest so both segments show (`claudemd | code-graph`). Read the `psCandidates` array from `detect --json` — each entry is a hand-made PS1 (a `bash` script under `~/.claude/` that isn't a plugin, e.g. `user-ps1`) claudemd can supersede. If it is non-empty, list those `id`s and ASK: supersede one (`adopt --supersede=<id>`, saved for restore) or keep both (`adopt`). Continue to Step 1."
  );
  const own = 'bash "$HOME/.claude/claudemd-statusline.sh"';
  const providers = [
    { id: '_previous', command: own, needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ];
  const registry = path.join(box.home, '.cache/code-graph/statusline-registry.json');
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.mkdirSync(box.claude(), { recursive: true });
  fs.writeFileSync(registry, JSON.stringify(providers));
  fs.writeFileSync(box.claude('statusline-providers.json'), JSON.stringify(providers));
  fs.writeFileSync(
    box.claude('settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } })
  );
  fs.writeFileSync(
    box.claude('claudemd-statusline.sh'),
    '#!/usr/bin/env bash\n# an older claudemd renderer\n'
  );
  const detect = () => JSON.parse(run('statusline-adopt.js', ['detect', '--json'], box.env()).stdout);
  const d = detect();
  assert.equal(d.verdict, 'host');
  assert.equal(d.guestRegistered, false);
  assert.equal(d.rendererInUse, true);
  assert.deepEqual(d.rendererRunBy, ['_previous']);
  assert.equal(d.dest.matchesShipped, false);
  const before = fs.readFileSync(registry, 'utf8');
  const a = run('statusline-adopt.js', ['adopt', '--empty-only', '--json'], box.env());
  assert.equal(a.status, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).action, 'renderer-refreshed');
  const after = detect();
  assert.equal(after.dest.matchesShipped, true);
  assert.equal(after.guestRegistered, false);
  assert.equal(fs.readFileSync(registry, 'utf8'), before, 'nothing registered');
});

test('doctor: the page says when to run --ack-fail-open, and the fields and file it names are what the flag produces', () => {
  assertLine(
    'doctor',
    "For `hook-fail-open` when `ok=false`: a hook skipped enforcement and recorded why; the detail lists each hook and reason. Most reasons are a prerequisite the user can restore (`jq`, a patterns file, a writable `~/.claude/.claudemd-state/`). `transcript-missing` and `event-fields-missing` mean a hook could not locate the session transcript or the event fields it reads: a `CLAUDE_CONFIG_DIR` that moves transcripts out of `~/.claude/projects`, or sessions run without transcripts, cause the first, and a change in what Claude Code writes or sends can cause either, which no local setting fixes. Say which applies when you can tell. Help the user fix what can be fixed; while a cause persists, each new row turns the check red again, so acknowledging does not clear it. Run `--ack-fail-open` only after the user says the cause is fixed, never to turn the check green on your own. It records each fail-open event the row counts, by its time, hook and reason, in `fail-open-ack.json` in doctor's state directory (`~/.claude/.claudemd-state/` unless `CLAUDEMD_STATE_DIR` names another; the hooks always use `~/.claude/.claudemd-state/`); those stop counting, and any other such event turns the row red again. That is how a cause that is not fixed shows itself: the next time the affected hook skips enforcement it records a new one (while it can write to `~/.claude/.claudemd-state/`, at most one a minute per hook and reason). Report `failOpenAck`: `written` and `acknowledged` (how many it newly acknowledged), or the `reason` nothing was written. If doctor exits 1 with `cannot write the fail-open acknowledgement`, nothing was acknowledged or pruned and there is no check list: show the message. The error code at its end says why: `EACCES` or `EROFS` means the directory it names is not writable (when that is `~/.claude/.claudemd-state/`, that is itself a cause of fail-open); `EISDIR` means a directory sits at the file's path; `EEXIST` or `ENOTDIR` means a file sits where the state directory or one of its parents should be."
  );
  const doctorRun = () => JSON.parse(run('doctor.js', ['--ack-fail-open'], box.env()).stdout);
  const none = doctorRun().failOpenAck;
  assert.equal(none.written, false);
  assert.equal(typeof none.reason, 'string');
  fs.mkdirSync(box.claude('logs'), { recursive: true });
  fs.writeFileSync(
    box.claude('logs/claudemd.jsonl'),
    `{"ts":"${new Date(Date.now() - 60000).toISOString()}","hook":"banned-vocab","event":"fail-open","spec_section":"§hooks-fail-open","extra":{"reason":"jq-missing"},"session_id":null}\n`
  );
  const ack = doctorRun().failOpenAck;
  assert.deepEqual([ack.written, ack.acknowledged], [true, 1]);
  assert.ok(fs.existsSync(path.join(box.stateDir, 'fail-open-ack.json')));
});

// 0.117.5: four page sentences the 0.116.6, 0.117.0 and 0.117.4 entries listed
// under 'Not changed'. Each case pins the new line and runs what it names.
const INSTALL_HELD_LINE =
  "- `cachePruned.removed`: list of older cache version dirs reclaimed (best-effort; install succeeds regardless). `cachePruned.held`: older dirs install would otherwise remove (it keeps three: the current version and the newest others) that stay because a session opened earlier may still run its hooks from them, each with a `reason`: `orphaned-recently` (Claude Code's `.orphaned_at` mark in the dir is under 14 days old, or does not read as a number) or `hook-rows-recently` (the hook log has a row from that version in the last 14 days). Name them when the list is non-empty. A later install removes each once neither reason holds, and Claude Code deletes a dir it marked 14 days after marking it; a mark that does not read as a number holds its dir on every install.";

test('install: the page names cachePruned.held and its two reasons, and pruneCache returns those reasons', () => {
  assertLine('install', INSTALL_HELD_LINE);
  const versions = path.join(box.home, '.claude/plugins/cache/claudemd/claudemd');
  for (const v of ['0.1.1', '0.1.4', '0.1.6', '0.1.9', '0.2.1']) {
    fs.mkdirSync(path.join(versions, v), { recursive: true });
  }
  fs.writeFileSync(path.join(versions, '0.1.4', '.orphaned_at'), String(Date.now() - 86400000));
  fs.mkdirSync(box.claude('logs'), { recursive: true });
  fs.writeFileSync(
    box.claude('logs/claudemd.jsonl'),
    `{"ts":"${new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z')}","hook":"verify-log","event":"verify-run","hook_version":"0.1.1"}\n`
  );
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { pruneCache } = await import(${JSON.stringify(path.join(REPO, 'scripts/lib/cache-prune.js'))});` +
        `console.log(JSON.stringify(pruneCache(${JSON.stringify(path.join(versions, '0.2.1'))}, { keep: 3 }).held));`,
    ],
    { encoding: 'utf8', env: box.env() }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    JSON.parse(r.stdout).sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: '0.1.1', reason: 'hook-rows-recently' },
      { name: '0.1.4', reason: 'orphaned-recently' },
    ]
  );
});

test('install and uninstall: restore passes over newer spec-only backups, as both pages now say', () => {
  assertLine(
    'install',
    "Backup is conditional, not universal: only genuine USER content is moved aside, into `~/.claude/backup-<ISO>/`. An existing `~/.claude/CLAUDE.md` that is already a claudemd spec never enters `backup-<ISO>/`, so no backup install writes there has the spec as its `CLAUDE.md`; the three spec files beside the user's own `CLAUDE.md` (`CLAUDE-extended.md`, `CLAUDE-changelog.md`, `OPERATOR.md`, when present) move with it, so that restore puts the whole earlier state back. A `/claudemd-update` before 0.68.3 also wrote spec backups into that namespace. `CLAUDEMD_SPEC_ACTION=restore` passes over a newer backup that holds a `CLAUDE.md` and nothing but spec files (it lists it in `skippedSpecOnly` and leaves it in place) and restores the newest other one, or the newest of all when every backup is like that; a backup of spec files with no `CLAUDE.md` is not passed over, and restore puts those spec files back. A spec that was already installed is not discarded either: unless it already matches the shipped spec, it is copied to `spec-backup-<ISO>/` — a separate namespace that restore does not read — so edits somebody made to an installed spec stay recoverable without putting a spec back in restore's reach. Pre-plugin hand-installed hook files go to their own `handhook-backup-<ISO>/` namespace."
  );
  assertLine(
    'uninstall',
    '- Restore your pre-claudemd `~/.claude/CLAUDE*.md` from the newest backup that is not a spec backup (a `/claudemd-update` before 0.68.3 wrote spec backups there; restore passes over a newer dir that holds a `CLAUDE.md` and nothing but spec files, leaves it in place and lists it in `skippedSpecOnly`, and uses the newest backup when every one is such a dir; a dir of spec files with no `CLAUDE.md` is not passed over, and its spec files are restored):'
  );
  assertLine(
    'uninstall',
    'On a restore, `skippedSpecOnly` (when present) lists the newer backup dirs passed over because they hold a `CLAUDE.md` and nothing but spec files; they are left in place. Name them, so the user knows the restored files came from an older backup.'
  );
  const mk = (stamp, text) => {
    const d = box.claude(`backup-${stamp}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), text);
    return d;
  };
  mk('20260301T000000Z', 'personal\n');
  const specOnly = mk('20260601T000000Z', '# AI-CODING-SPEC v6.10.0 — Core\nold spec\n');
  const r = run('uninstall.js', [], box.env({ CLAUDEMD_SPEC_ACTION: 'restore' }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).skippedSpecOnly, [specOnly]);
  assert.equal(fs.readFileSync(box.claude('CLAUDE.md'), 'utf8'), 'personal\n');
});

test('doctor: the page says a failing row with advisory: true does not count, as countsTowardExit reads it', async () => {
  assertLine(
    'doctor',
    'A row with `ok: false` that also carries `advisory: true` does not count toward the exit code: its basis was inferred on this run, as its text says. Show it with [△] and say it does not count.'
  );
  const { countsTowardExit } = await import(path.join(REPO, 'scripts/doctor.js'));
  assert.equal(countsTowardExit({ name: 'hook-drift', ok: false, advisory: true }), false);
  assert.equal(countsTowardExit({ name: 'hook-drift', ok: false }), true);
});

// 0.117.5 pre-tag review M1: a spec backup with no `CLAUDE.md` is not passed
// over (holdsOnlySpecFiles needs one), and restore puts its spec files back. Both
// pages now say so; this runs the reviewer's repro.
test('install and uninstall: a backup of spec files with no CLAUDE.md is restored, as both pages say', () => {
  const mk = (stamp, files) => {
    const d = box.claude(`backup-${stamp}`);
    fs.mkdirSync(d, { recursive: true });
    for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(d, n), t);
    return d;
  };
  mk('20260301T000000Z', { 'CLAUDE.md': 'personal\n' });
  mk('20260601T000000Z', { 'CLAUDE-extended.md': '# AI-CODING-SPEC v6.10.0 — Extended\nold\n' });
  const r = run('uninstall.js', [], box.env({ CLAUDEMD_SPEC_ACTION: 'restore' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).skippedSpecOnly, undefined, 'not passed over');
  assert.equal(
    fs.readFileSync(box.claude('CLAUDE-extended.md'), 'utf8'),
    '# AI-CODING-SPEC v6.10.0 — Extended\nold\n',
    'its spec file is restored'
  );
  const home = box.claude('CLAUDE.md');
  const now = fs.existsSync(home) ? fs.readFileSync(home, 'utf8') : null;
  assert.notEqual(now, 'personal\n', "the older dir's CLAUDE.md is not used");
});
