// help-discoverability.test.js — Round-1 user-test regression: every
// slash-command CLI must (a) accept `--help` / `-h` and exit 0 with a
// usage block, (b) reject unknown args with exit 2 (no silent fallback).
//
// Pre-fix history (this round):
//   - status.js / lint-argv.js silently ignored ALL args and exited 0 —
//     same antipattern family documented in feedback_cli_flag_shape_silent_fallback.md.
//   - audit / sparkline / hard-rules-audit / clean-residue / doctor
//     rejected `--help` as `Unknown argument: '--help'.` (exit 2),
//     blocking new-user discoverability on the most universal CLI probe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Each entry: [scriptRelPath, usageMatcher].
// usageMatcher is a regex that must match stdout when --help fires.
const SCRIPTS = [
  ['scripts/audit.js',            /Usage:.*audit\.js/],
  ['scripts/sparkline.js',        /Usage:.*sparkline\.js/],
  ['scripts/hard-rules-audit.js', /Usage:.*hard-rules-audit\.js/],
  ['scripts/clean-residue.js',    /Usage:.*clean-residue\.js/],
  ['scripts/doctor.js',           /Usage:.*doctor\.js/],
  ['scripts/status.js',           /Usage:.*status\.js/],
  ['scripts/lint-argv.js',        /Usage:.*lint-argv\.js/],
  // Round-5 additions: lifecycle scripts. Pre-fix `install --help` actually
  // RAN the install destructively because argv was silently dropped.
  ['scripts/install.js',          /Usage:.*install\.js/],
  ['scripts/uninstall.js',        /Usage:.*uninstall\.js/],
  ['scripts/update.js',           /Usage:.*update\.js/],
];

const run = (relScript, args) => spawnSync(
  process.execPath,
  [path.join(REPO_ROOT, relScript), ...args],
  { encoding: 'utf8', timeout: 10000 },
);

for (const [rel, usageRe] of SCRIPTS) {
  test(`${rel}: --help exits 0 and prints usage to stdout`, () => {
    const r = run(rel, ['--help']);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, usageRe);
    assert.match(r.stdout, /--help.*[Pp]rint/);
  });

  test(`${rel}: -h exits 0 and prints usage to stdout`, () => {
    const r = run(rel, ['-h']);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, usageRe);
  });

  test(`${rel}: bogus arg exits 2 (not silent-success)`, () => {
    // Pre-fix behavior for status.js + lint-argv.js was exit 0 with full
    // output ignoring the bogus arg — the silent-fallback antipattern.
    const r = run(rel, ['--zzz-not-a-real-flag=1']);
    assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout}`);
    assert.match(r.stderr, /Unknown flag|Unknown argument/);
  });
}
