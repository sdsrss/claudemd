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
    '- `totalMissingTranscript` ≈ `totalSuggestions` = the transcripts are gone from `~/.claude/projects/<encoded>/` (deleted, or the sessions were synthetic), or the rows name no project and `--cwd` is not the project where they fired. Only that last case is fixed by re-running with `--cwd=<that project>`.'
  );
  const r = run('lesson-bypass-audit.js', ['--help'], box.env());
  assert.equal(r.status, 0);
  assert.match(r.stdout.replace(/\s+/g, ' '), /does NOT narrow the audit/);
});

test('analyze: the page names exit 1 for an audit that cannot run, and the CLI exits 1 on a non-directory --project', () => {
  assertLine(
    'analyze',
    'This command is read-only. Without `--strict` it exits 0 whatever it finds; `--strict` exits 1 on CRITICAL or HIGH findings — suitable for pre-tag ship gate. Either way it exits 1 when the audit cannot run (a `--project`/`--cwd` that is not a directory, the two given different values, a spec file it cannot read) and 2 on an argument it does not accept: report those as a failed run, not as a clean audit.'
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

test('uninstall: the restore bullet says a symlinked file comes back as the same link', () => {
  assertLine(
    'uninstall',
    '  This restores; it does not remove. A file that was a symlink when claudemd backed it up (a `CLAUDE.md` kept in a dotfiles repo, say) comes back as the same link to the same target, not as a copy. `CLAUDE-extended.md`, `CLAUDE-changelog.md` and `OPERATOR.md` — spec files claudemd added that you never had — are left in place, because removing spec files is `CLAUDEMD_SPEC_ACTION=delete` and that path is gated behind `CLAUDEMD_CONFIRM=1`. Claude Code does not auto-load those three, so they are inert; delete them by hand if you want them gone. `~/.claude/spec-modules/` is left in place too, and with the claudemd hooks gone nothing injects it.'
  );
});

test('refresh: the page relays the reinstall line the script prints when the install fails after the uninstall', () => {
  const line =
    'If the script exits non-zero after its uninstall step succeeded, its stderr says the plugin is NOT installed now: relay that and the reinstall commands it prints — `claude plugin install claudemd@claudemd` in a shell, or `/plugin install claudemd@claudemd` and then `/reload-plugins` inside Claude Code. Do not report the refresh as done.';
  assertLine('refresh', line);
  // The commands the page quotes are the ones the script prints.
  const sh = fs.readFileSync(path.join(REPO, 'scripts/refresh-plugin.sh'), 'utf8');
  const plugin = /^PLUGIN="?([^"\n]+)"?$/m.exec(sh)?.[1];
  assert.equal(plugin, 'claudemd@claudemd');
  const printed = sh.replaceAll('$PLUGIN', plugin);
  assert.match(printed, /is NOT installed now/);
  for (const cmd of [
    'claude plugin install claudemd@claudemd',
    '/plugin install claudemd@claudemd',
    '/reload-plugins',
  ])
    assert.ok(printed.includes(cmd) && line.includes(cmd), cmd);
});

test('status: every field and value the page names for an unparseable manifest is in the output', () => {
  const line =
    '- If `plugin.manifestError` is `unparseable`: the manifest at `plugin.manifestPath` exists but is not valid JSON. Relay `plugin.detail`, which names `/claudemd-install` as the fix, and do not suggest `/plugin install`. `plugin.hint` is `manifest-unparseable` unless the cache hint above applies, which keeps its own hint and `cacheVersions`; then give both.';
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

test('statusline: the page says remove restores the whole saved slot and adopt refuses a non-object settings.json', () => {
  assertLine(
    'statusline',
    "Show the transition first: run `detect --json`; if `verdict` is `claudemd`, state what `settings.statusLine` will become (the prior statusLine as it was saved — the whole object, `padding` included — if one was saved, else removed) and that `~/.claude/claudemd-statusline.sh` will be deleted. If `verdict` is `host` and `guestRegistered`, remove unregisters claudemd from the host's registry (restoring a superseded provider if one was saved) and deletes the renderer; the host keeps the slot. Then run:"
  );
  const line =
    "If `adopt` exits 1 with `statusline-adopt failed: statusline: <path> parses to null, not a JSON object` (or `to an array`, `to a JSON number`): nothing was written, and `detect` reads such a file as `absent`. Tell the user to replace the file's content with a JSON object (`{}` is valid) and re-run.";
  assertLine('statusline', line);
  fs.writeFileSync(box.claude('settings.json'), 'null\n');
  const detect = run('statusline-adopt.js', ['detect', '--json'], box.env());
  assert.equal(JSON.parse(detect.stdout).verdict, 'absent');
  const adopt = run('statusline-adopt.js', ['adopt', '--json'], box.env());
  assert.equal(adopt.status, 1);
  assert.match(adopt.stderr, /^statusline-adopt failed: statusline: \S+ parses to null, not a JSON object/m);
  assert.equal(fs.readFileSync(box.claude('settings.json'), 'utf8'), 'null\n');
});
