// hook-portability.test.js (v0.23.11) — static BSD/macOS portability gate for
// hook shell sources, runnable in the suite (so it fires on the Linux CI leg
// too, not only when real BSD tools happen to be on PATH).
//
// Why: BSD/macOS `grep -E` / `sed -E` treat the GNU escapes `\s` / `\d` / `\w`
// as LITERAL letters, so a pattern like `[0-9]+%\s+faster` silently stops
// matching on a stock Mac — the enforcement quietly disappears. The macOS CI
// leg prepends Homebrew gnubin to PATH, so it runs GNU tools and never catches
// this class (it's why the `\s` in banned-vocab.patterns shipped). This static
// check is tool-independent. Use POSIX bracket classes ([[:space:]] etc.); `\b`
// is fine (BSD grep supports it). banned-vocab.patterns is guarded separately
// by spec-pattern-drift.test.js (drift-7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function hookShellSources() {
  const dirs = ['hooks', 'hooks/lib'];
  const files = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.sh')) files.push(path.join(abs, name));
    }
  }
  return files;
}

// Strip full-line and trailing inline comments so a fix-note mentioning `\s`
// (the hooks document this very gotcha) does not trip the gate — mirrors the
// comment-stripping the CI bash-3.2 gate does.
function stripComments(line) {
  return line.replace(/^\s*#.*$/, '').replace(/\s#.*$/, '');
}

test('hook .sh sources use POSIX classes, not BSD-unsafe \\s/\\d/\\w', () => {
  const offenders = [];
  for (const f of hookShellSources()) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const code = stripComments(lines[i]);
      if (/\\[sdwSDW]/.test(code)) {
        offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Hook shell sources using GNU-only regex escapes (break on BSD/macOS grep/sed):\n` +
    offenders.join('\n') +
    `\nResolution: \\s→[[:space:]], \\d→[[:digit:]], \\w→[[:alnum:]_]. \\b is OK.`);
});
