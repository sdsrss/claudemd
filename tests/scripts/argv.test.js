import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrict, ArgvError } from '../../scripts/lib/argv.js';

test('happy path: bool + value flag together', () => {
  const r = parseStrict(['--apply', '--age-days=7'], {
    bools: ['--apply'], values: ['--age-days'],
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
    (e) => e instanceof ArgvError && /requires '=value' form/.test(e.message)
  );
});

test('Bug C: unknown flag rejected (was silent ignore)', () => {
  assert.throws(
    () => parseStrict(['--unknown=x'], { values: ['--age-days'] }),
    (e) => e instanceof ArgvError && /Unknown flag/.test(e.message)
  );
});

test('unknown bare argument rejected', () => {
  assert.throws(
    () => parseStrict(['garbage'], { bools: ['--apply'] }),
    (e) => e instanceof ArgvError && /Unknown argument/.test(e.message)
  );
});

test('boolean flag with =value rejected (--apply=yes)', () => {
  assert.throws(
    () => parseStrict(['--apply=yes'], { bools: ['--apply'] }),
    (e) => e instanceof ArgvError && /does not take a value/.test(e.message)
  );
});

test('repeated value flag: last wins (no error)', () => {
  const r = parseStrict(['--days=1', '--days=2'], { values: ['--days'] });
  assert.equal(r.values['--days'], '2');
});
