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

test('statusline: the page says remove restores the whole saved slot and adopt refuses a non-object settings.json', () => {
  assertLine(
    'statusline',
    "Show the transition first: run `detect --json`; if `verdict` is `claudemd`, state what `settings.statusLine` will become (the prior statusLine as it was saved — the whole object, `padding` included — if one was saved, else removed) and that `~/.claude/claudemd-statusline.sh` will be deleted. If `verdict` is `host` and `guestRegistered`, remove unregisters claudemd from the host's registry (restoring a superseded provider if one was saved) and deletes the renderer; the host keeps the slot. Then run:"
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
