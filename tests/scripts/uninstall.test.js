import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install } from '../../scripts/install.js';
import { uninstall } from '../../scripts/uninstall.js';
import { HOOK_BASENAMES } from '../../scripts/lib/hook-registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let tmpHome, savedHome, pluginRoot;

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-uninst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  // Each opens with the `# AI-CODING-SPEC` H1, like every shipped spec file:
  // uninstall reads ownership from it (R20 M1/M2), so a fixture without it is
  // a plugin shape that does not exist.
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), '# AI-CODING-SPEC v0 — Core\nplugin\n');
  fs.writeFileSync(
    path.join(pluginRoot, 'spec/CLAUDE-extended.md'),
    '# AI-CODING-SPEC v0 — Extended\nplugin-ext\n'
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'spec/CLAUDE-changelog.md'),
    '# AI-CODING-SPEC — Version history\nplugin-cl\n'
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'spec/OPERATOR.md'),
    '# AI-CODING-SPEC — Operator handbook\nplugin-op\n'
  );
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  // Registry-derived, not a hand-picked 5 (audit-2026-08-22 条目 8): uninstall's
  // eviction predicate is built from HOOK_BASENAMES, so a fixture holding a
  // subset can never exercise the entries most likely to be missed.
  for (const basename of HOOK_BASENAMES) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', basename), '#!/bin/bash\nexit 0\n');
  }
  // Hook manifest — the real plugin ships one, and install() now refuses a
  // plugin root without it (a hook-less install used to report success, with
  // the version check then reading that state as healthy). Hand-built fixtures
  // must carry it too or they stop resembling the artifact under test.
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks/hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: '"${CLAUDE_PLUGIN_ROOT}/hooks/ship-baseline-check.sh"',
                timeout: 10,
              },
              { type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/memory-read-check.sh"', timeout: 10 },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/residue-audit.sh"', timeout: 10 },
            ],
          },
        ],
      },
    })
  );
  // Renderer the install-time statusLine adopt copies to ~/.claude. Without it
  // install()'s adopt hits ENOENT → {action:'error'} and the suite never
  // exercises a successful install-time statusLine set (M4).
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho x\n');
  // Co-existing foreign hook
  fs.writeFileSync(
    path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: 'node /foreign/hook.mjs', timeout: 5 }] },
        ],
      },
    })
  );
  await install({ pluginRoot });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('keep option: spec files remain, plugin entries removed', async () => {
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')));
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.PreToolUse?.length || 0, 0);
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'node /foreign/hook.mjs');
});

test('unparseable settings.json degrades to a reported skip, not a blocked uninstall', async () => {
  // 2026-08-16 user-journey E2E: readSettings() threw at the top of uninstall,
  // so a trailing comma in a file this plugin does not own made the plugin
  // un-removable — exit 1, manifest still present, state still present. Since
  // v0.1.5 the hooks live in the plugin's own hooks.json and settings.json
  // normally carries ZERO claudemd entries, so this eviction is the least
  // load-bearing step here: skip it, report it, finish the rest.
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), '{\n  "model": "opus",\n}\n');
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.match(res.settingsWarning || '', /not valid JSON/);
  assert.ok(
    !fs.existsSync(path.join(tmpHome, '.claude/.claudemd-manifest.json')),
    'manifest must be removed even when settings.json cannot be parsed'
  );
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')));
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'),
    '{\n  "model": "opus",\n}\n',
    'the unparseable file is left exactly as the user wrote it'
  );
  // removeStatusline() reads the SAME file, so it fails on the same input —
  // claudemd still owns the statusLine after this "successful" uninstall. The
  // warning must say so; naming only hook entries told the user the statusLine
  // was gone when it was not (2026-08-16 pre-tag review).
  assert.equal(res.statusline.action, 'error');
  assert.match(res.settingsWarning, /statusLine/);
});

test('parseable settings.json leaves settingsWarning null', async () => {
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.settingsWarning, null);
});

test('158: a settings.json with nothing of claudemd in it is not rewritten', async () => {
  // Eviction removed nothing, yet the file was written back pretty-printed:
  // a compact settings.json came out reformatted. install.js already writes
  // only when eviction removed something.
  const settingsP = path.join(tmpHome, '.claude/settings.json');
  const compact = '{"model":"opus","hooks":{"PostToolUse":[]}}';
  fs.writeFileSync(settingsP, compact);
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.settingsWarning, null);
  assert.equal(fs.readFileSync(settingsP, 'utf8'), compact);
});

test('delete option: requires confirmHardAuth=true, then removes spec', async () => {
  const refused = await uninstall({ specAction: 'delete', confirmHardAuth: false });
  assert.equal(refused.specAction, 'abort');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), 'refused delete preserves files');

  const approved = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(approved.specAction, 'delete');
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), false);
});

test('restore option: finds newest backup and copies back', async () => {
  // Simulate a prior spec existed before install by creating a backup dir manually
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');

  const res = await uninstall({ specAction: 'restore' });
  assert.equal(res.specAction, 'restore');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'prior-version\n');
  // The result must SAY what it put back. restoreBackup has always returned the
  // list and uninstall has always discarded it, so "restored nothing" and
  // "restored everything" printed the same JSON (2026-09-05 audit ENG-01).
  assert.deepEqual(res.restored, [path.join(tmpHome, '.claude/CLAUDE.md')]);
  assert.equal(res.warning, undefined, 'a restore that put files back carries no warning');
});

test('R15: restore still works after a default uninstall removed the manifest', async () => {
  // The natural order: uninstall (default keep), then remember the personal
  // file. Neither restore nor delete reads the manifest, yet the no-manifest
  // early return made both a no-op `already-uninstalled`.
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');
  await uninstall({ specAction: 'keep' });

  const res = await uninstall({ specAction: 'restore' });
  assert.equal(res.specAction, 'restore');
  assert.deepEqual(res.restored, [path.join(tmpHome, '.claude/CLAUDE.md')]);
  assert.equal(res.warning, undefined, 'R18 L2: a restore that worked is not "already-uninstalled"');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'prior-version\n');
});

// Before 0.68.3, /claudemd-update wrote its spec backups into the personal
// namespace too, so on such a machine the newest `backup-` dir can hold only an
// old spec while the user's own CLAUDE.md sits in an older one
// (tasks/specs/restore-skip-spec-only.md).
const SPEC_TEXT = '# AI-CODING-SPEC v6.12.0 — Core\nold spec\n';
function backupDir(stamp, files) {
  const d = path.join(tmpHome, `.claude/backup-${stamp}`);
  fs.mkdirSync(d);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
  return d;
}

// The four spec files a pre-0.68.3 update could back up (every one that differed
// from the plugin's); a real update dir holds several of them (0.116.6 review H1).
const SPEC_SET = {
  'CLAUDE.md': SPEC_TEXT,
  'CLAUDE-extended.md': '# AI-CODING-SPEC v6.12.0 — Extended\n',
  'CLAUDE-changelog.md': '# AI-CODING-SPEC — Version history\n',
  'OPERATOR.md': '# AI-CODING-SPEC — Operator handbook\n',
};
for (const [label, before] of [
  ['with the manifest', async () => {}],
  ['after a default uninstall removed the manifest', () => uninstall({ specAction: 'keep' })],
]) {
  for (const [layout, files] of [
    ['a lone spec CLAUDE.md', { 'CLAUDE.md': SPEC_TEXT }],
    ['the four spec files a pre-0.68.3 update wrote', SPEC_SET],
  ]) {
    test(`restore skips a newer backup that holds ${layout} (${label})`, async () => {
      backupDir('20260301T000000Z', { 'CLAUDE.md': 'personal\n' });
      const specOnly = backupDir('20260601T000000Z', files);
      await before();
      const res = await uninstall({ specAction: 'restore' });
      assert.equal(res.specAction, 'restore');
      assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'personal\n');
      assert.deepEqual(res.skippedSpecOnly, [specOnly]);
      assert.deepEqual(
        fs.readdirSync(specOnly).sort(),
        Object.keys(files).sort(),
        'the skipped dir is left as it was'
      );
    });
  }
}

test('restore does not skip a spec-shaped backup that holds anything else, a link, or no spec', async () => {
  const cases = [
    ['a sibling file', d => fs.writeFileSync(path.join(d, 'notes.md'), 'mine\n'), SPEC_TEXT],
    ['a subdirectory', d => fs.mkdirSync(path.join(d, 'hooks')), SPEC_TEXT],
    ['a symlinked CLAUDE.md', null, SPEC_TEXT],
    ['a CLAUDE.md that is not spec-shaped', () => {}, 'newer personal\n'],
    [
      'a sibling spec file name the user wrote',
      d => fs.writeFileSync(path.join(d, 'CLAUDE-extended.md'), 'my own notes\n'),
      SPEC_TEXT,
    ],
    ['a spec heading below the first line', () => {}, 'My notes\n# AI-CODING-SPEC-inspired rules I keep\n'],
    [
      'a spec-headed file under another name',
      d => fs.writeFileSync(path.join(d, 'my-spec-copy.md'), SPEC_TEXT),
      SPEC_TEXT,
    ],
    [
      'spec files but no CLAUDE.md',
      d => {
        fs.rmSync(path.join(d, 'CLAUDE.md'));
        fs.writeFileSync(path.join(d, 'OPERATOR.md'), '# AI-CODING-SPEC — Operator handbook\n');
      },
      null,
    ],
  ];
  for (const [what, extra, expected] of cases) {
    for (const n of fs.readdirSync(path.join(tmpHome, '.claude'))) {
      if (n.startsWith('backup-')) fs.rmSync(path.join(tmpHome, '.claude', n), { recursive: true });
    }
    backupDir('20260301T000000Z', { 'CLAUDE.md': 'personal\n' });
    let newer;
    if (extra === null) {
      newer = backupDir('20260601T000000Z', {});
      // Absolute: a relative TMPDIR would leave the link dangling (review L6).
      const target = path.resolve(tmpHome, 'dotfiles-CLAUDE.md');
      fs.writeFileSync(target, SPEC_TEXT);
      fs.symlinkSync(target, path.join(newer, 'CLAUDE.md'));
    } else {
      newer = backupDir('20260601T000000Z', { 'CLAUDE.md': expected ?? SPEC_TEXT });
      extra(newer);
    }
    fs.rmSync(path.join(tmpHome, '.claude/CLAUDE.md'), { force: true });
    const res = await uninstall({ specAction: 'restore' });
    assert.equal(res.skippedSpecOnly, undefined, `${what}: nothing is skipped`);
    if (expected === null) {
      // The newest dir has no CLAUDE.md to put back: it is still the one restored.
      assert.equal(
        fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')),
        false,
        `${what}: the newest backup is restored`
      );
      continue;
    }
    assert.equal(
      fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'),
      expected,
      `${what}: the newest backup is restored`
    );
  }
});

test('restore falls back to the newest backup when every backup holds only a spec', async () => {
  backupDir('20260301T000000Z', { 'CLAUDE.md': '# AI-CODING-SPEC v6.10.0 — Core\nolder spec\n' });
  backupDir('20260601T000000Z', { 'CLAUDE.md': SPEC_TEXT });
  const res = await uninstall({ specAction: 'restore' });
  assert.equal(res.skippedSpecOnly, undefined);
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), SPEC_TEXT);
});

test('CLI: a skipped spec-only backup is named on stderr and in the JSON', () => {
  backupDir('20260301T000000Z', { 'CLAUDE.md': 'personal\n' });
  const specOnly = backupDir('20260601T000000Z', { 'CLAUDE.md': SPEC_TEXT });
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/uninstall.js')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome, CLAUDEMD_SPEC_ACTION: 'restore' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).skippedSpecOnly, [specOnly]);
  assert.match(r.stderr, /restore skipped 1 newer backup\(s\) that hold only spec files/);
  assert.ok(r.stderr.includes(specOnly), r.stderr);
  assert.ok(
    r.stderr.includes(`Restoring ${path.join(tmpHome, '.claude/backup-20260301T000000Z')}`),
    r.stderr
  );
});

test(
  'restore does not pass over a newest backup it cannot list (it fails as 0.116.5 did)',
  { skip: process.getuid?.() === 0 },
  async () => {
    // findLegacySpecBackups reads an unlistable dir as having no siblings; restore
    // must not take that as "holds only a spec" (0.116.6 review L1).
    backupDir('20260301T000000Z', { 'CLAUDE.md': 'personal\n' });
    const locked = backupDir('20260601T000000Z', { 'CLAUDE.md': SPEC_TEXT, 'notes.md': 'mine\n' });
    fs.chmodSync(locked, 0o300);
    try {
      await assert.rejects(uninstall({ specAction: 'restore' }), /EACCES/);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  }
);

test("R18 M2 / R20 M1: with no manifest a delete removes the spec files and keeps the user's", async () => {
  // restore → (edit) → delete is the order the restore docs lead to. Without a
  // manifest, ownership is read from the file: claudemd's spec files open with
  // the `# AI-CODING-SPEC` H1, a restored personal file does not. An
  // unconditional delete removed the user's file (R18 M2); a no-op left the
  // spec in place after a confirmed delete and reported it as done (R20 M1).
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');
  for (const n of ['CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md']) {
    fs.writeFileSync(path.join(tmpHome, '.claude', n), `# AI-CODING-SPEC — ${n}\n`);
  }
  const restored = await uninstall({ specAction: 'restore' });
  assert.equal(restored.warning, undefined, 'a restore that put files back carries no warning');
  fs.appendFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'edited after restore\n');
  const res = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(res.specAction, 'delete');
  assert.deepEqual(res.kept, [path.join(tmpHome, '.claude/CLAUDE.md')]);
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'),
    'prior-version\nedited after restore\n'
  );
  assert.equal(
    fs.existsSync(path.join(tmpHome, '.claude/OPERATOR.md')),
    false,
    'the spec-shaped sibling is gone'
  );
});

test('R20 M1: with no manifest a confirmed delete removes a spec-shaped CLAUDE.md', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), '# AI-CODING-SPEC v9 — Core\n');
  await uninstall({ specAction: 'keep' });
  const res = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(res.specAction, 'delete');
  assert.equal(res.warning, undefined);
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), false);
});

test("R20 M2: a second restore does not overwrite the user's edits to the first one", async () => {
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');
  await uninstall({ specAction: 'restore' });
  fs.appendFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'edited after restore\n');
  const again = await uninstall({ specAction: 'restore' });
  assert.deepEqual(again.kept, [path.join(tmpHome, '.claude/CLAUDE.md')]);
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'),
    'prior-version\nedited after restore\n'
  );
});

test('R23 M1: without a manifest only a file whose FIRST line is the H1 counts as the spec', async () => {
  // looksLikeSpec accepts the H1 on any line of the first 256 characters, so a
  // personal file quoting it on line 4 was deleted with no copy, and a restore
  // overwrote one. Uninstall's own test reads the first line.
  await uninstall({ specAction: 'keep' }); // a default uninstall removes the manifest
  const mine = '# My own rules\nuse pnpm\n\n# AI-CODING-SPEC notes I pasted\n';
  const home = path.join(tmpHome, '.claude/CLAUDE.md');
  fs.writeFileSync(home, mine);
  const del = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.deepEqual(del.kept, [home]);
  assert.equal(fs.readFileSync(home, 'utf8'), mine, 'delete keeps it');

  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');
  const res = await uninstall({ specAction: 'restore' });
  assert.deepEqual(res.kept, [home]);
  assert.equal(fs.readFileSync(home, 'utf8'), mine, 'restore does not overwrite it');

  // Control: the spec's H1 on the first line, behind a byte-order mark, goes.
  fs.writeFileSync(home, '\uFEFF# AI-CODING-SPEC v9 — Core\nbody\n');
  const del2 = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(del2.kept, undefined, 'nothing kept: the field is omitted');
  assert.equal(fs.existsSync(home), false);
});

test('D#392: the first-line test wants `# AI-CODING-SPEC ` itself, not a newline or a longer word after `#`', async () => {
  // `#\s*AI-CODING-SPEC\b` crossed the newline after a bare `#` and took
  // `#AI-CODING-SPEC` and `# AI-CODING-SPEC-like`; every shipped spec file's
  // first line is `# AI-CODING-SPEC ` (all tags through v0.111.0).
  await uninstall({ specAction: 'keep' }); // a default uninstall removes the manifest
  const home = path.join(tmpHome, '.claude/CLAUDE.md');
  for (const mine of [
    '#\nAI-CODING-SPEC v8 notes\n',
    '#AI-CODING-SPEC notes\n',
    '# AI-CODING-SPEC-like rules\n',
  ]) {
    fs.writeFileSync(home, mine);
    const res = await uninstall({ specAction: 'delete', confirmHardAuth: true });
    assert.deepEqual(res.kept, [home], JSON.stringify(mine));
    assert.equal(fs.readFileSync(home, 'utf8'), mine);
  }
});

test('D#392: without a manifest a module counts only with its heading right after the frontmatter', async () => {
  // MODULE_H1_RE was /m over the first 2,048 characters, so a file of the
  // user's quoting the heading on any early line was deleted. Every shipped
  // module has the heading on the second line after the closing fence.
  await uninstall({ specAction: 'keep' });
  const modDir = path.join(tmpHome, '.claude/spec-modules');
  fs.mkdirSync(modDir, { recursive: true });
  const heading = '# AI-CODING-SPEC v8.1.0 — module: ship\n';
  const theirs = {
    'quoted.md': `# My notes on ship\n\n${heading}`,
    'later.md': `---\nmodule: ship\n---\n\nMy notes\n${heading}`,
  };
  for (const [f, body] of Object.entries(theirs)) fs.writeFileSync(path.join(modDir, f), body);
  const ours = path.join(modDir, 'ship.md');
  fs.writeFileSync(ours, `---\nmodule: ship\ntriggers: a---b\n---\n\n${heading}\nbody\n`);
  const res = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(fs.existsSync(ours), false, "claudemd's module goes");
  assert.deepEqual(
    res.kept.sort(),
    Object.keys(theirs)
      .map(f => path.join(modDir, f))
      .sort()
  );
  for (const [f, body] of Object.entries(theirs))
    assert.equal(fs.readFileSync(path.join(modDir, f), 'utf8'), body);
});

test('R23 M2: without a manifest a delete keeps spec-modules files claudemd did not write', async () => {
  await uninstall({ specAction: 'keep' }); // a default uninstall removes the manifest
  const modDir = path.join(tmpHome, '.claude/spec-modules');
  fs.mkdirSync(modDir, { recursive: true });
  const ours = path.join(modDir, 'ship.md');
  const theirs = path.join(modDir, 'mine.md');
  // Shipped modules open with frontmatter; the module H1 comes after it.
  fs.writeFileSync(ours, '---\nmodule: ship\n---\n\n# AI-CODING-SPEC v8.1.0 — module: ship\n');
  fs.writeFileSync(theirs, '# My module\nkeep me\n');
  const res = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(fs.existsSync(ours), false, "claudemd's module goes");
  assert.equal(fs.readFileSync(theirs, 'utf8'), '# My module\nkeep me\n');
  assert.deepEqual(res.kept, [theirs]);
});

test('ENG-01: a restore that puts nothing back says so instead of reporting success', async () => {
  // The live shape: install moved a stow-style relative symlink into the backup
  // dir, where it dangles. restoreBackup skips unstattable entries (R10-04), so
  // the loop completes having copied zero files and the exit code, the
  // `specAction: "restore"` field and the stderr were all indistinguishable from
  // a real restore. The user is told to run this command by install's own WARN.
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.symlinkSync(path.join(tmpHome, 'gone/CLAUDE.md'), path.join(bkDir, 'CLAUDE.md'));
  const specBefore = fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8');

  const res = await uninstall({ specAction: 'restore' });

  assert.equal(res.specAction, 'restore', 'the requested disposition still ran');
  assert.deepEqual(res.restored, [], 'zero files, stated as zero');
  assert.equal(res.warning, 'restore-empty');
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'),
    specBefore,
    'nothing was restored, so the spec is still in place — the warning is the only signal'
  );
});

test('ENG-01: keep/delete report restored:null, not a bare missing key', async () => {
  // Same reasoning as specAction:'noop' below — consumers read `.restored`
  // unconditionally; null means "not a restore", [] means "restored nothing".
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.restored, null);
});

test('manifest consumed for precise removal', async () => {
  const manifest = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  assert.ok(fs.existsSync(manifest));
  await uninstall({ specAction: 'keep', purge: true });
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/.claudemd-state')), false);
});

test('idempotent: running uninstall twice is safe', async () => {
  await uninstall({ specAction: 'keep' });
  const second = await uninstall({ specAction: 'keep' });
  assert.equal(second.warning, 'already-uninstalled');
  // Coverage: the no-manifest early return (uninstall.js:73) also carries a
  // `statusline` field. On this second call there is no claudemd-owned
  // statusLine left to remove, so removeStatusline() reports 'not-ours' —
  // asserting it here guards that field from silently disappearing from the
  // no-manifest branch (the only other test touching `statusline` exercises
  // the final, manifest-present return at uninstall.js:110).
  assert.equal(second.statusline.action, 'not-ours');
});

test('aborted delete (no confirm) does not mutate settings.json or manifest (F14)', async () => {
  // Regression: the unconfirmed-delete abort was returned AFTER settings.json
  // had already been cleaned of plugin hooks. Users saw "abort", thought
  // nothing changed, but hooks were silently removed.
  const settingsPath = path.join(tmpHome, '.claude/settings.json');
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  const before = fs.readFileSync(settingsPath, 'utf8');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

  const r = await uninstall({ specAction: 'delete', confirmHardAuth: false });
  assert.equal(r.specAction, 'abort');
  assert.equal(
    fs.readFileSync(settingsPath, 'utf8'),
    before,
    'settings.json must be untouched after aborted delete'
  );
  assert.equal(
    fs.readFileSync(manifestPath, 'utf8'),
    manifestBefore,
    'manifest must be untouched after aborted delete'
  );
});

test('aborted restore (no backups) does not mutate settings.json or manifest (F14)', async () => {
  const settingsPath = path.join(tmpHome, '.claude/settings.json');
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  const before = fs.readFileSync(settingsPath, 'utf8');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');
  // No backup-* dirs were created during install (fresh HOME had no prior
  // spec files; beforeEach already ensured that).
  const r = await uninstall({ specAction: 'restore' });
  assert.equal(r.specAction, 'abort');
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore);
});

test("purge: deletes only claudemd.jsonl, preserves other tools' logs (H1)", async () => {
  // Regression: ~/.claude/logs is shared with other plugins (claude-mem-lite etc).
  // Purge used to rm -rf the whole directory and nuke neighbor logs.
  const logsDir = path.join(tmpHome, '.claude/logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const claudemdLog = path.join(logsDir, 'claudemd.jsonl');
  const foreignLog = path.join(logsDir, 'claude-mem-lite.jsonl');
  const foreignSubdir = path.join(logsDir, 'some-tool');
  fs.writeFileSync(claudemdLog, '{"own":true}\n');
  fs.writeFileSync(foreignLog, '{"foreign":true}\n');
  fs.mkdirSync(foreignSubdir);
  fs.writeFileSync(path.join(foreignSubdir, 'x.log'), 'keep-me\n');

  await uninstall({ specAction: 'keep', purge: true });

  assert.equal(fs.existsSync(claudemdLog), false, 'own jsonl must be removed');
  assert.ok(fs.existsSync(foreignLog), 'foreign plugin log must be preserved');
  assert.ok(fs.existsSync(foreignSubdir), 'foreign subdir must be preserved');
  assert.ok(fs.existsSync(logsDir), 'logs dir must remain (other tools may still use it)');
});

test('purge: removes logs dir when empty after claudemd.jsonl deletion (H1)', async () => {
  const logsDir = path.join(tmpHome, '.claude/logs');
  // install() in beforeEach already created logsDir + empty claudemd.jsonl.
  // Nothing else lives there, so purge should clean up the now-empty dir.
  await uninstall({ specAction: 'keep', purge: true });
  assert.equal(fs.existsSync(logsDir), false, 'empty logs dir after own-log removal should be cleaned up');
});

test('D6: manifest missing but settings.json has legacy ${CLAUDE_PLUGIN_ROOT} entry → eviction still runs', async () => {
  // Real scenario: user installed ≤0.1.4 (which wrote ${CLAUDE_PLUGIN_ROOT}-
  // literal entries into settings.json), then hand-deleted manifest. Pre-fix
  // uninstall.js early-returned `'already-uninstalled'` without clearing
  // settings.json — orphan hook entry left forever.
  fs.unlinkSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'));
  const settingsP = path.join(tmpHome, '.claude/settings.json');
  const s = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  s.hooks ||= {};
  s.hooks.PreToolUse = [
    {
      matcher: 'Bash',
      hooks: [
        { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh"', timeout: 3 },
      ],
    },
  ];
  fs.writeFileSync(settingsP, JSON.stringify(s));

  const res = await uninstall({ specAction: 'keep' });

  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(
    res.settingsRemoved,
    1,
    'legacy ${CLAUDE_PLUGIN_ROOT} entry must be evicted even with manifest missing'
  );

  const after = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  const all = [];
  for (const event of Object.keys(after.hooks || {})) {
    for (const block of after.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  assert.equal(
    all.some(c => c.includes('banned-vocab-check.sh')),
    false,
    'no claudemd hook command should remain after eviction'
  );
  assert.ok(
    all.some(c => c.includes('node /foreign/hook.mjs')),
    'foreign hook from beforeEach must survive'
  );
});

test('D6: predicate is path-anchored — does NOT evict same-basename hook from another plugin', async () => {
  // Pre-0.5.4 substring predicate `c.includes('/hooks/banned-vocab-check.sh')`
  // would have matched a hypothetical other-plugin hook with the same
  // basename, accidentally evicting it. v0.5.4 path-anchors to known claudemd
  // residue forms only.
  fs.unlinkSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'));
  const settingsP = path.join(tmpHome, '.claude/settings.json');
  const s = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  s.hooks ||= {};
  // Hypothetical other-plugin shipping a same-basename hook. Note: this path
  // contains `/plugins/cache/` but NOT `/plugins/cache/claudemd/`, so the
  // path-anchored predicate must reject it.
  s.hooks.PreToolUse = [
    {
      matcher: 'Bash',
      hooks: [
        {
          type: 'command',
          command: 'bash "/home/x/.claude/plugins/cache/some-other-plugin/0.1.0/hooks/banned-vocab-check.sh"',
          timeout: 3,
        },
      ],
    },
  ];
  fs.writeFileSync(settingsP, JSON.stringify(s));

  const res = await uninstall({ specAction: 'keep' });

  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(res.settingsRemoved, 0, 'must not evict other-plugin hook of same basename');

  const after = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  const all = [];
  for (const event of Object.keys(after.hooks || {})) {
    for (const block of after.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  assert.ok(
    all.some(c => c.includes('plugins/cache/some-other-plugin/0.1.0/hooks/banned-vocab-check.sh')),
    'other-plugin hook must survive uninstall'
  );
});

test('D6: settingsRemoved field present on normal keep path (manifest exists)', async () => {
  // Sanity check: uninstall return value carries settingsRemoved (number) on
  // the success path, not just on the manifest-missing path. The exact count
  // depends on what install wrote from the fixture's hooks/hooks.json. Numeric
  // coverage of the field is what matters; the eviction count itself is
  // exercised by the two D6 cases above.
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.equal(typeof res.settingsRemoved, 'number', 'settingsRemoved must be a number on normal keep path');
});

test('uninstall removes a claudemd-owned statusLine + the renderer', async () => {
  // Arrange: adopt claudemd's statusLine into the sandbox home.
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-unpkg-'));
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho x\n');
  const { adopt } = await import('../../scripts/lib/statusline.js');
  adopt({ pluginRoot });
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));

  const res = await uninstall({});
  assert.equal(res.statusline.action, 'removed');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine, undefined);
  assert.ok(!fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('uninstall leaves a foreign statusLine untouched', async () => {
  fs.writeFileSync(
    path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'node /foreign/sl.js' } })
  );
  const res = await uninstall({});
  assert.equal(res.statusline.action, 'not-ours');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.statusLine.command, 'node /foreign/sl.js');
});

test('no-manifest uninstall still removes a claudemd-owned statusLine (M3)', async () => {
  // beforeEach install() adopted claudemd's statusLine into the empty slot and
  // wrote the renderer. Deleting the manifest sends uninstall down the
  // no-manifest early return (uninstall.js:73) — removeStatusline() runs
  // *before* that return, so the slot must still be un-wired and the renderer
  // deleted, not left orphaned pointing at a live settings.json command. This
  // is the constraint-#5 no-manifest sub-case, previously unasserted.
  const sBefore = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.ok(
    sBefore.statusLine?.command?.includes('claudemd-statusline.sh'),
    'precondition: beforeEach install set a claudemd statusLine'
  );
  assert.ok(
    fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')),
    'precondition: renderer present'
  );

  fs.unlinkSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'));
  const res = await uninstall({ specAction: 'keep' });

  assert.equal(res.warning, 'already-uninstalled', 'no-manifest early return taken');
  assert.equal(res.statusline.action, 'removed', 'statusLine un-wired despite missing manifest');
  const sAfter = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(sAfter.statusLine, undefined, 'slot cleared');
  assert.ok(
    !fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')),
    'renderer deleted, not left dangling'
  );
});

test('uninstall unregisters a guest claudemd from a composite host, leaving the host slot untouched', async () => {
  // Arrange: code-graph (a composite host) owns the settings.json statusLine
  // slot, and claudemd is registered as a guest inside its registry alongside
  // code-graph itself — the host+guestRegistered branch of remove() at
  // statusline.js:128 (Task 5), previously unexercised by this suite.
  const registryPath = path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(
    registryPath,
    JSON.stringify([
      {
        id: 'claudemd',
        command: `bash "${path.join(tmpHome, '.claude/claudemd-statusline.sh')}"`,
        needsStdin: true,
      },
      { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
    ])
  );
  fs.writeFileSync(
    path.join(tmpHome, '.claude/settings.json'),
    JSON.stringify({
      statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' },
    })
  );
  fs.writeFileSync(path.join(tmpHome, '.claude/claudemd-statusline.sh'), '#!/usr/bin/env bash\necho x\n');

  const res = await uninstall({});

  assert.equal(res.statusline.action, 'unregistered');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.ok(!registry.some(p => p.id === 'claudemd'), 'claudemd must be unregistered from the host registry');
  assert.ok(
    registry.some(p => p.id === 'code-graph'),
    'host entry must survive uninstall'
  );
  assert.ok(!fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')), 'renderer must be deleted');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(
    s.statusLine.command,
    'node "/cg/scripts/statusline-composite.js"',
    'host keeps the slot — settings.json statusLine must be unchanged'
  );
});

test('--purge refuses to recurse when CLAUDEMD_STATE_DIR is not our directory (v0.69.0 pre-tag review S1)', async () => {
  // stateDir() began honouring CLAUDEMD_STATE_DIR in 0.69.0 so the seam would
  // reach writers as well as readers. That turned uninstall's `--purge`
  // recursive delete — a fixed path since it was written — into `rm -rf $VAR`
  // on a variable the clean-residue USAGE advertises in `--help`. An operator
  // who exports it and then purges would lose that whole directory.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-notours-'));
  const saved = process.env.CLAUDEMD_STATE_DIR;
  try {
    // One file of ours, one that is not.
    fs.writeFileSync(path.join(outside, 'ext-read-abc.ts'), 'ours\n');
    fs.writeFileSync(path.join(outside, 'the-users-notes.md'), 'NOT OURS\n');
    fs.mkdirSync(path.join(outside, 'someones-subdir'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'someones-subdir/keep.txt'), 'NOT OURS\n');

    process.env.CLAUDEMD_STATE_DIR = outside;
    await uninstall({ specAction: 'keep', purge: true });

    assert.ok(fs.existsSync(outside), 'the directory itself must survive');
    assert.ok(
      fs.existsSync(path.join(outside, 'the-users-notes.md')),
      'a file claudemd never wrote must survive --purge'
    );
    assert.ok(
      fs.existsSync(path.join(outside, 'someones-subdir/keep.txt')),
      '--purge must not recurse into a directory that is not ours'
    );
    assert.ok(
      !fs.existsSync(path.join(outside, 'ext-read-abc.ts')),
      "claudemd's own state file should still be removed"
    );
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_STATE_DIR;
    else process.env.CLAUDEMD_STATE_DIR = saved;
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('--purge still clears the whole directory when it IS .claudemd-state (seam stays usable)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-ours-'));
  const sd = path.join(root, '.claudemd-state');
  const saved = process.env.CLAUDEMD_STATE_DIR;
  try {
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'ext-read-abc.ts'), 'x\n');
    fs.mkdirSync(path.join(sd, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sd, 'nested/deep.txt'), 'x\n');
    process.env.CLAUDEMD_STATE_DIR = sd;
    await uninstall({ specAction: 'keep', purge: true });
    assert.ok(!fs.existsSync(sd), 'a fixture named .claudemd-state must purge exactly as production does');
  } finally {
    if (saved === undefined) delete process.env.CLAUDEMD_STATE_DIR;
    else process.env.CLAUDEMD_STATE_DIR = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// R11-26 (2026-09-03 audit): every test above calls uninstall() as a library
// function, so `confirmHardAuth` was covered but the env→arg mapping that
// produces it (`CLAUDEMD_CONFIRM === '1'`, uninstall.js:265) was not — and
// that mapping is the entire hard-AUTH gate on deleting the user's spec files.
// A loosened comparison (`process.env.CLAUDEMD_CONFIRM` truthiness) would have
// passed every existing test while turning `CLAUDEMD_CONFIRM=0` into a confirm.
test('R11-26: the CLAUDEMD_CONFIRM env→arg mapping gates the spec delete on exactly "1"', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'uninstall.js');
  const specFile = path.join(tmpHome, '.claude/CLAUDE.md');
  const run = confirm =>
    spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        HOME: tmpHome,
        CLAUDEMD_SPEC_ACTION: 'delete',
        ...(confirm === undefined ? {} : { CLAUDEMD_CONFIRM: confirm }),
      },
    });

  assert.ok(fs.existsSync(specFile), 'premise: install() seeded the spec into the sandbox HOME');

  // Every non-"1" spelling must abort — including the ones a shell user would
  // reasonably reach for.
  for (const notOne of [undefined, '', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', '01']) {
    const r = run(notOne);
    assert.equal(r.status, 0, `CLAUDEMD_CONFIRM=${JSON.stringify(notOne)}: stderr=${r.stderr}`);
    assert.equal(
      JSON.parse(r.stdout).specAction,
      'abort',
      `CLAUDEMD_CONFIRM=${JSON.stringify(notOne)} must not confirm a spec delete`
    );
    assert.ok(fs.existsSync(specFile), `CLAUDEMD_CONFIRM=${JSON.stringify(notOne)} left the spec deleted`);
  }

  // …and "1" must actually confirm, or the abort assertions above would pass
  // on a gate that is simply always closed.
  const ok = run('1');
  assert.equal(ok.status, 0, `stderr=${ok.stderr}`);
  assert.equal(JSON.parse(ok.stdout).specAction, 'delete');
  assert.equal(fs.existsSync(specFile), false, 'CLAUDEMD_CONFIRM=1 must carry the delete through');
});

// ============================================================================
// Round-14 audit SCR-M6 — the purge branch that exists to REFUSE recursing.
// ============================================================================

test('SCR-M6: a redirected state dir keeps the user files whose names start like ours', async () => {
  // `CLAUDEMD_STATE_FILE_RE` anchored only at the start, and half its stems are
  // ordinary English. Point CLAUDEMD_STATE_DIR somewhere that is not named
  // `.claudemd-state` — the seam exists so it CAN be pointed elsewhere — and
  // the branch written to protect an unexpected directory deleted the user's
  // own files out of it.
  const alien = path.join(tmpHome, 'my-notes');
  fs.mkdirSync(alien, { recursive: true });
  const userFiles = {
    'session-start-plan.txt': 'my plan\n',
    'session-summary-notes.md': '# notes\n',
    'tmp-baseline-mine.csv': 'a,b\n',
    'installed.json.bak': '{}\n',
    'mem-audit.lastrun.backup': 'x\n',
  };
  for (const [n, c] of Object.entries(userFiles)) fs.writeFileSync(path.join(alien, n), c);
  // …and genuinely-ours files in the same directory, which MUST go.
  const ours = ['session-start.ref', 'tmp-baseline.txt', 'mem-audit.lastrun', 'l2-task-counter'];
  for (const n of ours) fs.writeFileSync(path.join(alien, n), 'ours\n');

  const savedStateDir = process.env.CLAUDEMD_STATE_DIR;
  process.env.CLAUDEMD_STATE_DIR = alien;
  try {
    await uninstall({ purge: true });
  } finally {
    if (savedStateDir === undefined) delete process.env.CLAUDEMD_STATE_DIR;
    else process.env.CLAUDEMD_STATE_DIR = savedStateDir;
  }

  for (const [n, c] of Object.entries(userFiles)) {
    assert.equal(
      fs.existsSync(path.join(alien, n)),
      true,
      `purge deleted the user's ${n} from a directory it was told not to recurse into`
    );
    assert.equal(fs.readFileSync(path.join(alien, n), 'utf8'), c);
  }
  for (const n of ours) {
    assert.equal(fs.existsSync(path.join(alien, n)), false, `purge left claudemd's own ${n} behind`);
  }
  assert.equal(fs.existsSync(alien), true, 'and the directory itself is never removed');
});

test('SCR-M6: CLAUDEMD_PURGE with no manifest still purges', async () => {
  // The `already-uninstalled` return sat ~90 lines above the purge branch, so a
  // purge requested by the one user who most needs it — manifest gone, state
  // dir and logs still there — did nothing and said nothing.
  const stateDirPath = path.join(tmpHome, '.claude/.claudemd-state');
  fs.mkdirSync(stateDirPath, { recursive: true });
  fs.writeFileSync(path.join(stateDirPath, 'session-start.ref'), 'x\n');
  const logs = path.join(tmpHome, '.claude/logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'claudemd.jsonl'), '{}\n');
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), { force: true });

  const res = await uninstall({ purge: true });
  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(res.purged, true, 'the result must say whether the purge ran');
  assert.equal(fs.existsSync(stateDirPath), false, 'state dir survived a purge');
  assert.equal(fs.existsSync(path.join(logs, 'claudemd.jsonl')), false, 'log survived a purge');
});

test('SCR-M6: no manifest and no purge leaves the state dir alone', async () => {
  const stateDirPath = path.join(tmpHome, '.claude/.claudemd-state');
  fs.mkdirSync(stateDirPath, { recursive: true });
  fs.writeFileSync(path.join(stateDirPath, 'session-start.ref'), 'x\n');
  fs.rmSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), { force: true });

  const res = await uninstall({});
  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(res.purged, false);
  assert.equal(fs.existsSync(stateDirPath), true, 'a keep-mode uninstall must not purge');
});

// ============================================================================
// Task 4, plan hook-root-ground-truth — the record must not survive a purge.
// ============================================================================

test('Task 4: CLAUDEMD_PURGE=1 removes the hook-root record on BOTH purge paths', async () => {
  // Two mechanisms, not one. A canonically-named state dir is removed wholesale
  // (`fs.rmSync(sd, {recursive:true})`), and any other name never gets recursed
  // into — there the per-file `CLAUDEMD_STATE_FILE_RE` decides, and an unmatched
  // stem is skipped SILENTLY. Testing only the first path is how a stem can be
  // missing from that regex while the suite stays green, which is exactly the
  // state this branch shipped: the record was written and registered nowhere.
  const canonical = path.join(tmpHome, '.claude/.claudemd-state');
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(path.join(canonical, 'hook-root.json'), '{"root":"/somewhere"}\n');
  await uninstall({ purge: true });
  assert.equal(fs.existsSync(canonical), false, 'the canonical state dir survived a purge');

  // The redirected dir: the seam exists so it CAN be pointed elsewhere, and the
  // branch that refuses to recurse is the one that needs the regex to be right.
  const alien = path.join(tmpHome, 'my-state');
  fs.mkdirSync(alien, { recursive: true });
  const ours = {
    'hook-root.json': '{"root":"/somewhere"}\n',
    // Stranded by a process killed between the printf and the mv in
    // `hook_record_plugin_root`. It has no ARCHITECTURE.md bullet and is a
    // STATE_IGNORE entry in the drift gate — so this case is the ONLY thing
    // holding it in the regex, and the drift join cannot notice if it leaves.
    'hook-root.json.4242': '{"root":"/somewhere"}\n',
    // The same idiom's other temp (R22): `hook_install_sentinel_write` fills
    // bootstrap-failed.json.$$ and renames it. Same STATE_IGNORE standing.
    'bootstrap-failed.json.4242': '{"ts":"","from":"","to":""}\n',
    // doctor --ack-fail-open (0.114.0) and its temp, stranded by a process
    // killed between the write and the rename.
    'fail-open-ack.json': '{"acknowledged":[]}\n',
    'fail-open-ack.json.4242': '{"acknowledged":[]}\n',
  };
  // The anchor control the Round-14 audit (SCR-M6) paid for: the temp suffix is
  // a pid, so the arm takes DIGITS only. A user's own backup of the record must
  // survive a branch whose whole purpose is not to touch an unexpected directory.
  const theirs = {
    'hook-root.json.bak': 'my backup\n',
    'hook-root.json.orig': 'mine\n',
    'bootstrap-failed.json.bak': 'mine\n',
    'fail-open-ack.json.bak': 'mine\n',
  };
  for (const [n, c] of Object.entries({ ...ours, ...theirs })) fs.writeFileSync(path.join(alien, n), c);

  const savedStateDir = process.env.CLAUDEMD_STATE_DIR;
  process.env.CLAUDEMD_STATE_DIR = alien;
  try {
    await uninstall({ purge: true });
  } finally {
    if (savedStateDir === undefined) delete process.env.CLAUDEMD_STATE_DIR;
    else process.env.CLAUDEMD_STATE_DIR = savedStateDir;
  }

  for (const n of Object.keys(ours))
    assert.equal(fs.existsSync(path.join(alien, n)), false, `purge left claudemd's own ${n} behind`);
  for (const [n, c] of Object.entries(theirs)) {
    assert.equal(fs.existsSync(path.join(alien, n)), true, `purge deleted the user's ${n}`);
    assert.equal(fs.readFileSync(path.join(alien, n), 'utf8'), c);
  }
  assert.equal(fs.existsSync(alien), true, 'and the directory itself is never removed');
});

test('SCR-L6: a restore that copies nothing back exits 3, not 0', () => {
  // The user reaches `CLAUDEMD_SPEC_ACTION=restore` from install's own WARN,
  // asking for their personal instructions back. A backup dir holding only an
  // entry that cannot be opened — which install itself produced for every
  // stow-style relative symlink until 0.76.2 — restored nothing and exited 0,
  // which reads as "done" to a human skimming and to any wrapper script.
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir, { recursive: true });
  fs.symlinkSync(path.join(tmpHome, 'gone/CLAUDE.md'), path.join(bkDir, 'CLAUDE.md'));

  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'uninstall.js')], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, HOME: tmpHome, CLAUDEMD_SPEC_ACTION: 'restore' },
  });
  assert.equal(r.status, 3, `expected exit 3; stdout=${r.stdout} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.warning, 'restore-empty');
  assert.deepEqual(out.restored, []);
});
