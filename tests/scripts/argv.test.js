import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrict, ArgvError, parsePositiveInt } from '../../scripts/lib/argv.js';

test('parsePositiveInt: accepts plain + integer-valued-float, rejects fraction/hex/exp/zero/junk', () => {
  // Accepted
  assert.equal(parsePositiveInt('30'), 30);
  assert.equal(parsePositiveInt('1'), 1);
  assert.equal(parsePositiveInt('30.0'), 30);   // trailing-zero float = integer value
  assert.equal(parsePositiveInt('30.00'), 30);
  assert.equal(parsePositiveInt(' 30 '), 30);   // surrounding whitespace trimmed
  assert.equal(parsePositiveInt(7), 7);          // numeric input
  // Rejected → null
  assert.equal(parsePositiveInt('1.5'), null);   // true fraction
  assert.equal(parsePositiveInt('0x1e'), null);  // hex over-coercion
  assert.equal(parsePositiveInt('1e2'), null);   // exponential over-coercion
  assert.equal(parsePositiveInt('0'), null);     // not positive
  assert.equal(parsePositiveInt('-5'), null);    // sign
  assert.equal(parsePositiveInt('abc'), null);   // junk
  assert.equal(parsePositiveInt(''), null);
  assert.equal(parsePositiveInt(null), null);
  assert.equal(parsePositiveInt(undefined), null);
});

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
