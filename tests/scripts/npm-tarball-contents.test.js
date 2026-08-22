// The published npm tarball actually contains what the CLI needs (2026-07-27
// audit, M5).
//
// .npmignore is a whitelist — `*` then a re-include list — and its own header
// says "Verify with: `npm pack --dry-run`". That verification existed in no
// workflow and no test: every other test runs the CLI out of the repo checkout,
// where each file exists by construction. Adding one import to a shipped module
// therefore published a package that throws ERR_MODULE_NOT_FOUND on the first
// `npx claudemd-cli`, with the whole four-leg matrix green.
//
// This walks the CLI's transitive LOCAL import closure and requires every hop to
// be inside the tarball, so the whitelist is checked against real dependencies
// rather than against someone remembering to update it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/** Files the tarball would ship, as repo-relative POSIX paths. */
function tarballFiles() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(raw);
  // npm <=11 emits an array of pack results; npm >=12 emits an object keyed by
  // package name. Accept both so the suite is green on whichever npm the
  // machine carries (CI node20/22 ships npm 10/11; a dev box may run 12+).
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return new Set((entry.files || []).map(f => f.path.replace(/\\/g, '/')));
}

/** Transitive closure of relative imports starting at `entry` (repo-relative). */
function localImportClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(REPO_ROOT, rel);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    // Static `from '...'` plus dynamic `import('...')`; only relative specifiers
    // are ours to ship — bare specifiers are node: builtins or real deps.
    const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)].map(m => m[1]);
    for (const s of specs) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), s));
      queue.push(resolved);
    }
  }
  return seen;
}

test('every local module the CLI imports is in the tarball', () => {
  const files = tarballFiles();
  const closure = localImportClosure('bin/claudemd-lint.js');

  assert.ok(closure.size >= 2, `import closure looks empty: ${[...closure].join(', ')}`);
  for (const rel of closure) {
    assert.ok(
      files.has(rel),
      `${rel} is imported by the CLI but excluded from the tarball — add it to .npmignore's re-include list`
    );
  }
});

test('runtime data files the CLI reads are in the tarball', () => {
  const files = tarballFiles();
  // lint.js reads this at runtime; a missing patterns file is a silent
  // zero-pattern scan, not a crash — worse than ERR_MODULE_NOT_FOUND.
  assert.ok(files.has('hooks/banned-vocab.patterns'), 'hooks/banned-vocab.patterns missing from tarball');
  assert.ok(files.has('package.json'), 'package.json missing from tarball');
  assert.ok(files.has('bin/claudemd-lint.js'), 'bin entry point missing from tarball');
});

test('the tarball stays plugin-free (whitelist did not invert)', () => {
  const files = tarballFiles();
  // The whitelist ships the standalone CLI only. If `*` ever stops applying,
  // this catches the blast radius before publish rather than after.
  const shipped = [...files];
  const leaked = shipped.filter(f =>
    f.startsWith('spec/') || f.startsWith('commands/') || f.startsWith('tests/') ||
    (f.startsWith('hooks/') && f.endsWith('.sh')) ||
    (f.startsWith('scripts/') && !f.startsWith('scripts/lib/'))
  );
  assert.deepEqual(leaked, [], `plugin-only artifacts leaked into the tarball: ${leaked.join(', ')}`);
  assert.ok(shipped.length < 40, `tarball grew to ${shipped.length} files — whitelist may have inverted`);
});

test('the tarball stays small — nothing large sneaks back into the whitelist', () => {
  // audit-2026-08-22 条目 21: CHANGELOG.md was 727 KB, 89% of a 796 KB tarball
  // whose actual runtime is bin/ + two lib files. `npx claudemd-cli` fetches
  // that tarball on every cold run, so the cost was paid per invocation, by
  // every user, forever. It was on the whitelist from the first publish and
  // nothing measured it — hence a ceiling rather than a note.
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000,
  });
  const parsed = JSON.parse(raw);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const unpacked = entry.unpackedSize;
  const CEILING = 200 * 1024;
  assert.ok(
    unpacked > 0 && unpacked < CEILING,
    `npm tarball unpacked size is ${Math.round(unpacked / 1024)} KB, ceiling ${CEILING / 1024} KB. ` +
    'Something large joined the .npmignore whitelist — check what, and whether the CLI actually needs it at runtime.',
  );
  const files = (entry.files || []).slice().sort((a, b) => b.size - a.size);
  assert.ok(files.length > 0, 'npm pack reported no files — nothing to measure');
  const biggest = files[0];
  assert.ok(
    biggest.size < unpacked * 0.6,
    `${biggest.path} is ${Math.round(biggest.size / unpacked * 100)}% of the tarball — one file dominating the package is the 条目 21 shape`,
  );
});
