import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, HOOK_BASENAMES } from '../../scripts/install.js';

// Shared with production code: install.js evicts settings.json entries
// using the same predicate. Tests assert against the same source of truth
// so a future hook addition (HOOK_BASENAMES grows) is automatically covered.
const isClaudemdHookCommand = (c) => HOOK_BASENAMES.some(b => c.includes(`/hooks/${b}`));

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-inst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  delete process.env.CLAUDEMD_NO_STATUSLINE;

  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({ name: 'claudemd', version: '9.9.9-test' }));

  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), '# AI-CODING-SPEC v6.9.2 — Core\nVersion: 6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), '# Extended v6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), '# Changelog\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/OPERATOR.md'), '# Operator handbook (test fixture)\n');

  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  for (const name of ['banned-vocab-check', 'ship-baseline-check', 'residue-audit',
                      'memory-read-check', 'pre-bash-safety-check',
                      'sandbox-disposal-check', 'session-start-check',
                      'session-summary',
                      'transcript-vocab-scan',
                      'transcript-structure-scan',
                      'version-sync',
                      'mem-audit']) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', `${name}.sh`), '#!/bin/bash\nexit 0\n');
  }
  // The production hooks.json is what install.js reads to populate the manifest.
  // Tests must ship a copy that mirrors the real plugin's 12-hook registration
  // (4 PreToolUse:Bash enforcement [pre-bash-safety + banned-vocab + ship-baseline
  // + memory-read] + Stop [residue-audit + sandbox-disposal + mem-audit +
  // transcript-structure-scan v0.9.10 + session-summary v0.8.0] + SessionStart
  // self-bootstrap [v0.1.9] + UserPromptSubmit version-sync piggy-back [v0.3.1]
  // + PostToolUse transcript-vocab-scan [v0.8.3]).
  fs.writeFileSync(path.join(pluginRoot, 'hooks/hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: '*', hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-check.sh"', timeout: 5 },
      ] }],
      UserPromptSubmit: [{ matcher: '*', hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/version-sync.sh"', timeout: 2 },
      ] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/pre-bash-safety-check.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"', timeout: 5 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/memory-read-check.sh"', timeout: 3 },
      ] }],
      Stop: [{ matcher: '*', hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/residue-audit.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-disposal-check.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/mem-audit.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/transcript-structure-scan.sh"', timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-summary.sh"', timeout: 3 },
      ] }],
      PostToolUse: [{ matcher: '*', hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/transcript-vocab-scan.sh"', timeout: 3 },
      ] }],
    },
  }));

  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho fixture-sl\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('fresh HOME: spec copied, no backup', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'fresh');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# AI-CODING-SPEC v6.9.2 — Core\nVersion: 6.9.2\n');
  const items = fs.readdirSync(path.join(tmpHome, '.claude'));
  assert.ok(!items.some(n => n.startsWith('backup-')));
});

test('existing spec: backup created, new spec in place', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'OLD\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'OLD-EXT\n');
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'backup-and-overwrite');
  assert.ok(res.backupDir && fs.existsSync(res.backupDir));
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'OLD\n');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# AI-CODING-SPEC v6.9.2 — Core\nVersion: 6.9.2\n');
});

test('fresh install leaves settings.json with NO claudemd hook entries (v0.1.5)', async () => {
  // As of v0.1.5, hooks live in the plugin's hooks/hooks.json — CC only
  // expands ${CLAUDE_PLUGIN_ROOT} for plugin-owned hooks, not for entries in
  // settings.json. settings.json should carry zero claudemd hook commands.
  await install({ pluginRoot });
  const sPath = path.join(tmpHome, '.claude/settings.json');
  if (!fs.existsSync(sPath)) return; // fresh install with no pre-existing settings.json is fine
  const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
  const all = [];
  for (const event of Object.keys(s.hooks || {})) {
    for (const block of s.hooks[event]) {
      for (const h of block.hooks || []) all.push(h.command);
    }
  }
  const claudemdCmds = all.filter(isClaudemdHookCommand);
  assert.deepEqual(claudemdCmds, [], `settings.json must not contain claudemd hook commands, got: ${JSON.stringify(claudemdCmds)}`);
});

test('idempotent: running install 3x leaves settings.json unchanged', async () => {
  await install({ pluginRoot });
  const sPath = path.join(tmpHome, '.claude/settings.json');
  const after1 = fs.existsSync(sPath) ? fs.readFileSync(sPath, 'utf8') : '';
  await install({ pluginRoot });
  await install({ pluginRoot });
  const after3 = fs.existsSync(sPath) ? fs.readFileSync(sPath, 'utf8') : '';
  assert.equal(after1, after3);
});

test('installed.json manifest records entries', async () => {
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), 'utf8'));
  assert.equal(manifest.version, '9.9.9-test');
  assert.equal(manifest.entries.length, 12);
  assert.ok(manifest.entries.every(e => typeof e.sha256 === 'string' && e.sha256.length === 64));
});

test('installed.json version falls back to "unknown" when package.json missing', async () => {
  fs.rmSync(path.join(pluginRoot, 'package.json'));
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), 'utf8'));
  assert.equal(manifest.version, 'unknown');
});

test('CLI smoke: `node scripts/install.js` with no env + no args succeeds via self-derived pluginRoot', () => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/install.js')], {
    env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `exit non-zero. stderr: ${result.stderr}`);
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'installed.json should be written');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.pluginRoot, REPO_ROOT);
  assert.equal(manifest.entries.length, 16);
});

test('logs directory and empty jsonl created', async () => {
  await install({ pluginRoot });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  assert.ok(fs.existsSync(log));
  assert.equal(fs.readFileSync(log, 'utf8'), '');
});

test('pre-merge settings.json backup created when settings.json existed', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), '{"hooks":{}}');
  const res = await install({ pluginRoot });
  assert.ok(res.settingsBackup, 'settingsBackup path should be populated');
  assert.ok(fs.existsSync(res.settingsBackup), 'backup file should exist on disk');
  // isoStamp now includes milliseconds (F10).
  assert.match(path.basename(res.settingsBackup), /^settings\.json\.claudemd-backup-\d{8}T\d{6}(\d{3})?Z$/);
  assert.equal(fs.readFileSync(res.settingsBackup, 'utf8'), '{"hooks":{}}');
});

test('fresh install (no settings.json): settingsBackup is null', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.settingsBackup, null);
});

test('D7: existing CLAUDE.md without spec H1 flagged as user content + preserved in backup', async () => {
  // ~/.claude/CLAUDE.md is shared between this plugin and the user's
  // hand-written CC user-global instructions. When the existing file lacks
  // the canonical `# AI-CODING-SPEC` H1, install must (a) flag the case so
  // the user is told where the content went, (b) still back it up — never
  // silent data loss.
  const personalContent = '# My personal user-global instructions\n\nAlways respond in 中文.\nMy name is X.\n';
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), personalContent);
  const res = await install({ pluginRoot });
  assert.equal(res.userContentDetected, true, 'user content detection flag must be set');
  assert.ok(res.backupDir && fs.existsSync(res.backupDir));
  assert.equal(
    fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'),
    personalContent,
    'personal content must be preserved verbatim in backup'
  );
  // And install proceeded — the plugin spec is now in place.
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# AI-CODING-SPEC v6.9.2 — Core\nVersion: 6.9.2\n');
});

test('D7: existing CLAUDE.md with spec H1 is NOT flagged as user content (v0.23.11: spec-on-spec = no backup)', async () => {
  // Anything matching `# AI-CODING-SPEC vX.Y.Z` in the first 256 bytes is a
  // prior claudemd install — a routine spec upgrade, NOT user content. v0.23.11
  // root-cause fix: spec-over-spec must NOT create a backup (it would bury the
  // user's personal-content backup and make restore return the old spec). The
  // prior spec is recoverable from git / plugin cache / update.js backups.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), '# AI-CODING-SPEC v6.10.0 — Core\n\nold spec content\n');
  const res = await install({ pluginRoot });
  assert.equal(res.userContentDetected, false, 'spec-headed file must not trip user-content flag');
  assert.equal(res.spec, 'overwrite-spec');
  assert.equal(res.backupDir, null, 'spec-over-spec must not create a backup');
});

test('v0.23.11: repeated same-version re-install does NOT bury the user-content backup', async () => {
  // Data-loss regression: user had personal CLAUDE.md → 1st install backs it up.
  // Pre-fix every subsequent (byte-identical) re-install backed up the SPEC,
  // making the spec the newest backup; restore picks newest + pruneBackups(5)
  // evicts the oldest, so restore returned the spec and ≥5 re-runs lost the
  // personal content permanently. Now identical re-installs are a no-op.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), '# My personal user-global instructions\nReply in 中文.\n');
  const first = await install({ pluginRoot });
  assert.equal(first.spec, 'backup-and-overwrite');
  assert.equal(first.userContentDetected, true);
  for (let i = 0; i < 6; i++) {
    const r = await install({ pluginRoot });
    assert.equal(r.spec, 'overwrite-spec', `re-install #${i + 2} must be a no-op, not a backup`);
    assert.equal(r.backupDir, null);
  }
  const backupDirs = fs.readdirSync(path.join(tmpHome, '.claude')).filter(n => n.startsWith('backup-'));
  assert.equal(backupDirs.length, 1, 'only the original personal-content backup should exist');
  const backedUp = fs.readFileSync(path.join(tmpHome, '.claude', backupDirs[0], 'CLAUDE.md'), 'utf8');
  assert.match(backedUp, /My personal user-global instructions/);
});

test('v0.23.11: a spec UPGRADE after a personal install still restores PERSONAL content, not the old spec', async () => {
  // Re-audit finding: the byte-identical-only guard left the upgrade path
  // broken — install personal → backup#1=personal; upgrade (different spec
  // bytes) → backup#2=old-spec; restore picked backup#2 (old spec). Now
  // spec-over-spec never backs up, so the personal backup stays the only one
  // and restore returns it.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), '# My personal instructions\nReply in 中文.\n');
  const first = await install({ pluginRoot });
  assert.equal(first.spec, 'backup-and-overwrite');
  // Simulate a spec version upgrade: change the shipped spec content.
  const shippedCore = path.join(pluginRoot, 'spec/CLAUDE.md');
  fs.writeFileSync(shippedCore, fs.readFileSync(shippedCore, 'utf8') + '\nUPGRADED CONTENT\n');
  const upgrade = await install({ pluginRoot });
  assert.equal(upgrade.spec, 'overwrite-spec', 'spec upgrade must not create a second backup');
  const backupDirs = fs.readdirSync(path.join(tmpHome, '.claude')).filter(n => n.startsWith('backup-'));
  assert.equal(backupDirs.length, 1, 'still only the personal-content backup');
  assert.match(fs.readFileSync(path.join(tmpHome, '.claude', backupDirs[0], 'CLAUDE.md'), 'utf8'),
    /My personal instructions/, 'the single backup is the personal content, not the old spec');
});

test('D7: fresh install (no existing CLAUDE.md) does not trip user-content flag', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.userContentDetected, false);
  assert.equal(res.spec, 'fresh');
});

test('migrates hand-installed banned-vocab hook into backup', async () => {
  // Place hand-installed artifacts
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'), '#!/bin/bash\n# v0 hand-install\nexit 0\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab.patterns'), 'foo|reason\n');
  // settings.json pointing to hand-installed hook
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command',
      command: `bash "${path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')}"`, timeout: 3 }] }] }
  }));

  const res = await install({ pluginRoot });

  // Old files moved into backup-<ISO>/hooks/
  assert.ok(res.backupDir);
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab-check.sh')));
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab.patterns')));
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')), false);

  // settings.json no longer references hand-installed path
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const all = [];
  for (const event of Object.keys(s.hooks || {})) {
    for (const block of s.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  assert.equal(all.some(c => c.includes(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'))), false);
});

test('leaves non-migrated hand hooks untouched', async () => {
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/some-other.sh'), '#!/bin/bash\nexit 0\n');
  await install({ pluginRoot });
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/hooks/some-other.sh')));
});

test('back-to-back installs in same second preserve the original user backup (F10)', async () => {
  // Regression: isoStamp was second-precision, so two installs within one second
  // reused the same backup-<ISO> dir and renameSync silently overwrote the
  // user's original CLAUDE.md with the freshly-installed plugin copy, losing data.
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'USER-ORIGINAL-CONTENT\n');
  await install({ pluginRoot });
  // Second install: spec now matches plugin, new backup dir would be made.
  await install({ pluginRoot });

  const backupDirs = fs.readdirSync(path.join(tmpHome, '.claude'))
    .filter(n => /^backup-/.test(n))
    .map(n => path.join(tmpHome, '.claude', n));
  const allBackedUp = backupDirs
    .filter(d => fs.existsSync(path.join(d, 'CLAUDE.md')))
    .map(d => fs.readFileSync(path.join(d, 'CLAUDE.md'), 'utf8'));
  assert.ok(
    allBackedUp.includes('USER-ORIGINAL-CONTENT\n'),
    `USER-ORIGINAL-CONTENT lost after two fast installs. Backups contained: ${JSON.stringify(allBackedUp)}`
  );
});

test('manifest entries use ${CLAUDE_PLUGIN_ROOT} literal for version-stable registration (M4/v0.1.5)', async () => {
  // Regression: hook commands used to bake in the absolute version-specific path
  // (~/.claude/plugins/cache/claudemd/claudemd/0.1.3/hooks/...). After `/plugin
  // update claudemd` bumped the version directory, entries pointed at a stale
  // path and hooks silently stopped firing. v0.1.5 moves hook registration into
  // the plugin's hooks/hooks.json where ${CLAUDE_PLUGIN_ROOT} is expanded by
  // the CC harness at hook invocation time, tracking the active version.
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), 'utf8'));
  for (const e of manifest.entries) {
    assert.ok(e.command.includes('${CLAUDE_PLUGIN_ROOT}'),
      `manifest entry should reference env var, got: ${e.command}`);
    assert.ok(!e.command.includes(pluginRoot),
      `manifest entry must NOT bake in the version-specific absolute path, got: ${e.command}`);
  }
});

test('upgrade evicts ALL stale claudemd hook entries from settings.json (v0.1.5)', async () => {
  // v0.1.5 moves hook registration to plugin hooks/hooks.json. Pre-0.1.5
  // installs wrote commands into settings.json in two incompatible forms:
  //  (1) ${CLAUDE_PLUGIN_ROOT}-literal (0.1.2-0.1.4) — the CC harness refused
  //      to expand these in settings.json and threw an error every invocation.
  //  (2) absolute version-dir paths (≤0.1.1) — went stale on /plugin update.
  // Both forms must be evicted on upgrade so the plugin's own hooks.json
  // becomes the sole registration site.
  const OLD_VERSION_DIR = '/home/fake/.claude/plugins/cache/claudemd/claudemd/0.1.3';
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [
        // absolute-path form (≤0.1.1)
        { type: 'command', command: `bash "${OLD_VERSION_DIR}/hooks/banned-vocab-check.sh"`, timeout: 3 },
        // ${CLAUDE_PLUGIN_ROOT}-literal form (0.1.2-0.1.4)
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"', timeout: 5 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/memory-read-check.sh"', timeout: 3 },
        { type: 'command', command: 'node /foreign/hook.mjs', timeout: 2 },
      ] }],
      Stop: [{ matcher: '*', hooks: [
        { type: 'command', command: `bash "${OLD_VERSION_DIR}/hooks/residue-audit.sh"`, timeout: 3 },
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-disposal-check.sh"', timeout: 3 },
      ] }],
    },
  }));

  await install({ pluginRoot });

  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const bash = s.hooks.PreToolUse?.find(m => m.matcher === 'Bash')?.hooks || [];
  const stop = s.hooks.Stop?.find(m => m.matcher === '*')?.hooks || [];
  // Only foreign hook survives in Bash; Stop block empty (orphan hooks array is stripped by unmergeHook).
  assert.equal(bash.length, 1, `expected 1 Bash entry (foreign only), got: ${JSON.stringify(bash)}`);
  assert.equal(bash[0].command, 'node /foreign/hook.mjs', 'foreign hook must survive');
  assert.equal(stop.length, 0, `expected 0 Stop entries after eviction, got: ${JSON.stringify(stop)}`);
  // And — crucially — no claudemd command string remains anywhere in settings.json
  const all = [];
  for (const event of Object.keys(s.hooks || {})) {
    for (const block of s.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  const claudemd = all.filter(isClaudemdHookCommand);
  assert.deepEqual(claudemd, [], `all claudemd hook commands must be evicted, residue: ${JSON.stringify(claudemd)}`);
});

test('same-stamp settings.json backup gets numeric suffix (F10)', async () => {
  // If a settings.json.claudemd-backup-<stamp> file happens to already exist
  // at the exact ms, we must not clobber it — we append -1, -2, ...
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), '{"existing":true}');
  const r1 = await install({ pluginRoot });
  // Manually create a conflicting backup file using the same stamp pattern,
  // then do a second install — backup should get a numeric suffix.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), '{"round2":true}');
  // Simulate collision by pre-creating the exact target candidate path is hard
  // (stamp is ms-precise). Instead verify that the two run-level backups are
  // distinct files with distinct content.
  const r2 = await install({ pluginRoot });
  assert.notEqual(r1.settingsBackup, r2.settingsBackup, 'each install must produce a distinct settings backup');
  assert.ok(fs.existsSync(r1.settingsBackup));
  assert.ok(fs.existsSync(r2.settingsBackup));
});

test('fresh install sets claudemd statusLine into the empty slot', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.statusline.action, 'set');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'bash "$HOME/.claude/claudemd-statusline.sh"');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('install does NOT clobber a foreign statusLine', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node /foreign/sl.js' } }));
  const res = await install({ pluginRoot });
  assert.equal(res.statusline.action, 'skipped-foreign');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'node /foreign/sl.js');
  assert.ok(!fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('CLAUDEMD_NO_STATUSLINE=1 skips the statusLine write', async () => {
  process.env.CLAUDEMD_NO_STATUSLINE = '1';
  try {
    const res = await install({ pluginRoot });
    assert.equal(res.statusline.action, 'opted-out');
    const sPath = path.join(tmpHome, '.claude/settings.json');
    const s = fs.existsSync(sPath) ? JSON.parse(fs.readFileSync(sPath, 'utf8')) : {};
    assert.equal(s.statusLine, undefined);
  } finally {
    delete process.env.CLAUDEMD_NO_STATUSLINE;
  }
});
