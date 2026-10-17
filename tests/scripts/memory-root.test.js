// memoryRoot (scripts/lib/paths.js) is the JS twin of hook_memory_root
// (hooks/lib/hook-common.sh): the directory whose encoded name holds memory/
// for a session that started in a given dir. Claude Code keys memory/ by the
// canonical git root, so the memory gates read MEMORY.md there (D#391); the JS
// readers used process.cwd() and, from a repo subdirectory, reported no index
// and skipped (D#401). The parity half runs both engines over the same layouts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { memoryRoot, encodeProjectCwd } from '../../scripts/lib/paths.js';
import { auditSpecCoherence } from '../../scripts/spec-coherence-audit.js';
import { memoryMaintenance } from '../../scripts/lib/memory-maintenance.js';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIB = path.join(REPO, 'hooks/lib/hook-common.sh');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-memroot-'));
after(() => fs.rmSync(T, { recursive: true, force: true }));
// HOME and the other path seams point into a fresh sandbox for every test.
const box = useHomeSandbox('memroot');

const git = (...a) => {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
};
const repo = path.join(T, 'repo');
git('init', '-q', repo);
git('-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
fs.mkdirSync(path.join(repo, 'sub/deep'), { recursive: true });
git('-C', repo, 'worktree', 'add', '-q', path.join(T, 'wt'));
fs.mkdirSync(path.join(T, 'wt/sub'), { recursive: true });
// A copy of a worktree: its admin dir points back at wt, not at the copy.
fs.cpSync(path.join(T, 'wt'), path.join(T, 'fake'), { recursive: true });
// A bare repository with a worktree: memory/ goes with the bare repo itself.
git('clone', '-q', '--bare', repo, path.join(T, 'bare.git'));
git('-C', path.join(T, 'bare.git'), 'worktree', 'add', '-q', path.join(T, 'bwt'));
// A `.git` file that is not a gitdir pointer: the dir holding it is the root.
fs.mkdirSync(path.join(T, 'odd/in'), { recursive: true });
fs.writeFileSync(path.join(T, 'odd/.git'), 'not a pointer\n');
fs.mkdirSync(path.join(T, 'plain/x'), { recursive: true });

const bashRoot = start => {
  const r = spawnSync('bash', ['-c', 'source "$1" && hook_memory_root "$2"', '_', LIB, start], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

const CASES = [
  ['repo root', repo, repo],
  ['subdirectory', path.join(repo, 'sub/deep'), repo],
  ['subdirectory with trailing slashes', path.join(repo, 'sub') + '//', repo],
  ['linked worktree', path.join(T, 'wt'), repo],
  ['inside a linked worktree', path.join(T, 'wt/sub'), repo],
  ['copied worktree (admin dir does not point back)', path.join(T, 'fake'), path.join(T, 'fake')],
  ['worktree of a bare repository', path.join(T, 'bwt'), path.join(T, 'bare.git')],
  ['.git file that is not a pointer', path.join(T, 'odd/in'), path.join(T, 'odd')],
  ['outside git', path.join(T, 'plain/x'), path.join(T, 'plain/x')],
  ['relative start is returned as given', 'rel/dir', 'rel/dir'],
];

for (const [name, start, want] of CASES) {
  test(`memoryRoot = hook_memory_root: ${name}`, () => {
    // Outside git the walk reaches `/`; a stray `.git` above the temp dir
    // would make the expected value wrong, so say so instead of failing oddly.
    if (want === path.join(T, 'plain/x') && bashRoot(start) !== want) {
      assert.fail(`a .git above ${T} hides the outside-git case: ${bashRoot(start)}`);
    }
    assert.equal(memoryRoot(start), want);
    assert.equal(bashRoot(start), want);
  });
}

test('spec-coherence-audit reads the root MEMORY.md from a subdirectory', () => {
  // checkMemoryIndex resolves the projects root from os.homedir(), which reads
  // the sandbox's HOME.
  const mem = box.claude('projects', encodeProjectCwd(repo), 'memory');
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [A](a.md) — x\n');
  fs.writeFileSync(path.join(mem, 'a.md'), 'a\n');
  const r = auditSpecCoherence({ pluginRoot: REPO, projectCwd: path.join(repo, 'sub/deep') });
  const c = r.checks.find(x => x.name === 'memory-index');
  assert.notEqual(c.stats.status, 'no-index', JSON.stringify(c.stats));
  assert.equal(c.stats.memDir, mem);
});

test('memoryMaintenance looks in the root memory dir from a worktree', async () => {
  const home = box.home;
  const r = await memoryMaintenance({
    cwd: path.join(T, 'wt/sub'),
    homeDir: home,
    logPath: path.join(home, 'none.jsonl'),
    memLiteDbPath: path.join(home, 'none.db'),
  });
  assert.equal(r.memDir, path.join(home, '.claude/projects', encodeProjectCwd(repo), 'memory'));
});
