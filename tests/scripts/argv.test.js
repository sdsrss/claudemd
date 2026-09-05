import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';
import { parseStrict, ArgvError, parsePositiveInt, invokedAsMain } from '../../scripts/lib/argv.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARGV_LIB = path.join(REPO_ROOT, 'scripts/lib/argv.js');
const sandbox = useHomeSandbox('argv-main');

// The probe reports BOTH verdicts: the helper's, and the pre-fix expression it
// replaces. `naive: false` next to `helper: true` is what makes each case below
// a control rather than an assertion that something still works — if the two
// ever agree, the case has stopped exercising the bug (2026-09-05 audit P0-1).
const PROBE = `import { invokedAsMain } from ${JSON.stringify(ARGV_LIB)};
const naive = import.meta.url === \`file://\${process.argv[1]}\`;
console.log(JSON.stringify({ helper: invokedAsMain(import.meta.url), naive }));
`;

function runProbe(dirWithProbe, invokeDir = dirWithProbe) {
  fs.mkdirSync(dirWithProbe, { recursive: true });
  fs.writeFileSync(path.join(dirWithProbe, 'probe.mjs'), PROBE);
  const r = spawnSync(process.execPath, [path.join(invokeDir, 'probe.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('invokedAsMain: true through a symlinked directory, where the href compare is false', () => {
  const real = sandbox.dir('real');
  const link = path.join(sandbox.home, 'link');
  fs.symlinkSync(real, link, 'dir');
  assert.deepEqual(runProbe(real, link), { helper: true, naive: false });
});

test('invokedAsMain: true under a path containing a space (URL percent-encoding)', () => {
  assert.deepEqual(runProbe(sandbox.dir('sp ace')), { helper: true, naive: false });
});

test('invokedAsMain: false when the module is imported rather than run', () => {
  // This suite imported argv.js; argv.js is not the program node was started on.
  assert.equal(invokedAsMain(new URL('../../scripts/lib/argv.js', import.meta.url).href), false);
});

test('a real CLI reached through a symlinked repo root still runs its main block', () => {
  // The end of P0-1: `node <symlink>/scripts/status.js` used to print 0 bytes and
  // exit 0. install.js failed the same way while reporting success.
  const link = path.join(sandbox.home, 'repo-link');
  fs.symlinkSync(REPO_ROOT, link, 'dir');
  const r = spawnSync(process.execPath, [path.join(link, 'scripts/status.js')], {
    encoding: 'utf8',
    env: sandbox.env(),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 0, 'main block produced no output through the symlink');
  assert.ok(JSON.parse(r.stdout).plugin, 'status output is not the documented JSON shape');
});

test('parsePositiveInt: accepts plain + integer-valued-float, rejects fraction/hex/exp/zero/junk', () => {
  // Accepted
  assert.equal(parsePositiveInt('30'), 30);
  assert.equal(parsePositiveInt('1'), 1);
  assert.equal(parsePositiveInt('30.0'), 30); // trailing-zero float = integer value
  assert.equal(parsePositiveInt('30.00'), 30);
  assert.equal(parsePositiveInt(' 30 '), 30); // surrounding whitespace trimmed
  assert.equal(parsePositiveInt(7), 7); // numeric input
  // Rejected → null
  assert.equal(parsePositiveInt('1.5'), null); // true fraction
  assert.equal(parsePositiveInt('0x1e'), null); // hex over-coercion
  assert.equal(parsePositiveInt('1e2'), null); // exponential over-coercion
  assert.equal(parsePositiveInt('0'), null); // not positive
  assert.equal(parsePositiveInt('-5'), null); // sign
  assert.equal(parsePositiveInt('abc'), null); // junk
  assert.equal(parsePositiveInt(''), null);
  assert.equal(parsePositiveInt(null), null);
  assert.equal(parsePositiveInt(undefined), null);
});

test('happy path: bool + value flag together', () => {
  const r = parseStrict(['--apply', '--age-days=7'], {
    bools: ['--apply'],
    values: ['--age-days'],
  });
  assert.equal(r.bools.has('--apply'), true);
  assert.equal(r.values['--age-days'], '7');
});

test('empty argv: no flags, no errors', () => {
  const r = parseStrict([], { bools: ['--apply'], values: ['--age-days'] });
  assert.equal(r.bools.size, 0);
  assert.deepEqual(r.values, {});
});

test('value with empty string: --days= (caller validates)', () => {
  const r = parseStrict(['--days='], { values: ['--days'] });
  assert.equal(r.values['--days'], '');
});

test('value containing = sign preserved (--days=7,14)', () => {
  const r = parseStrict(['--days=7,14,28'], { values: ['--days'] });
  assert.equal(r.values['--days'], '7,14,28');
});

test('Bug A: space-form --age-days 0 rejected (was silent default)', () => {
  assert.throws(
    () => parseStrict(['--age-days', '0'], { values: ['--age-days'] }),
    e => e instanceof ArgvError && /requires '=value' form/.test(e.message)
  );
});

test('Bug C: unknown flag rejected (was silent ignore)', () => {
  assert.throws(
    () => parseStrict(['--unknown=x'], { values: ['--age-days'] }),
    e => e instanceof ArgvError && /Unknown flag/.test(e.message)
  );
});

test('unknown bare argument rejected', () => {
  assert.throws(
    () => parseStrict(['garbage'], { bools: ['--apply'] }),
    e => e instanceof ArgvError && /Unknown argument/.test(e.message)
  );
});

test('boolean flag with =value rejected (--apply=yes)', () => {
  assert.throws(
    () => parseStrict(['--apply=yes'], { bools: ['--apply'] }),
    e => e instanceof ArgvError && /does not take a value/.test(e.message)
  );
});

test('repeated value flag: last wins (no error)', () => {
  const r = parseStrict(['--days=1', '--days=2'], { values: ['--days'] });
  assert.equal(r.values['--days'], '2');
});
