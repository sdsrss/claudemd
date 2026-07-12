import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/statusline.sh');
const ESC = '\x1b';

function render(payload, env) {
  return spawnSync('bash', [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, DISABLE_STATUSLINE_QUOTA: '', ...env },
  }).stdout;
}

// All meter segments (ctx / 5h / 7d) show USED percentage, floored.
const limits = (fh, sd) => ({
  ...(fh !== undefined && { five_hour: { used_percentage: fh, resets_at: 'x' } }),
  ...(sd !== undefined && { seven_day: { used_percentage: sd, resets_at: 'x' } }),
});

test('full payload renders PS1-colored segments', () => {
  const out = render({
    cwd: '/tmp/nonrepo-xyz',
    model: { display_name: 'Opus 4.8 (1M context)' },
    context_window: { used_percentage: 6 },
    rate_limits: limits(10, 16),
  });
  assert.match(out, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:`));            // user@host green + colon
  assert.ok(out.includes(`${ESC}[01;34mnonrepo-xyz${ESC}[00m`));                  // path blue, basename only
  assert.ok(!out.includes('/tmp/nonrepo-xyz'), 'full path must not render');
  assert.ok(out.includes(`${ESC}[00;36mOpus 4.8 (1M context)${ESC}[00m`));        // model cyan
  const seg = (body, c) => `${ESC}[02;${c}m${body}${ESC}[00m`;   // meter segments are faint
  assert.ok(out.includes(` [${seg('ctx:6%', 32)} · ${seg('5h:10%', 32)} · ${seg('7d:16%', 32)}]`),
    `single bracket, dot-separated, per-segment color; got: ${JSON.stringify(out)}`);
});

test('ctx threshold colors at boundaries', () => {
  const ctx = (p) => render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: p } });
  assert.ok(ctx(49).includes(`${ESC}[02;32mctx:49%`), 'green <50');
  assert.ok(ctx(50).includes(`${ESC}[02;33mctx:50%`), 'yellow 50');
  assert.ok(ctx(79).includes(`${ESC}[02;33mctx:79%`), 'yellow 79');
  assert.ok(ctx(80).includes(`${ESC}[02;31mctx:80%`), 'red 80');
  assert.ok(ctx(6.2).includes(`${ESC}[02;32mctx:6%`), 'decimal floored');
});

test('quota threshold colors at boundaries (same scale as ctx)', () => {
  const q = (used) => render({ cwd: '', model: { display_name: '' }, rate_limits: limits(used) });
  assert.ok(q(49).includes(`${ESC}[02;32m5h:49%`), 'used 49 green');
  assert.ok(q(50).includes(`${ESC}[02;33m5h:50%`), 'used 50 yellow');
  assert.ok(q(79).includes(`${ESC}[02;33m5h:79%`), 'used 79 yellow');
  assert.ok(q(80).includes(`${ESC}[02;31m5h:80%`), 'used 80 red');
  assert.ok(q(100).includes(`${ESC}[02;31m5h:100%`), 'used 100 red');
});

test('quota used percentage is floored', () => {
  const out = render({ cwd: '', model: { display_name: '' }, rate_limits: limits(90.3) });
  assert.ok(out.includes('5h:90%'), `got: ${JSON.stringify(out)}`);
  const out2 = render({ cwd: '', model: { display_name: '' }, rate_limits: limits('90.0') });
  assert.ok(out2.includes('5h:90%'), `got: ${JSON.stringify(out2)}`);
});

test('quota used_percentage slightly above 100 renders as-is, red (like ctx)', () => {
  const out = render({ cwd: '', model: { display_name: '' }, rate_limits: limits(105) });
  assert.ok(out.includes(`${ESC}[02;31m5h:105%`), `got: ${JSON.stringify(out)}`);
});

test('partial rate_limits → only the present window renders', () => {
  const out = render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 6 }, rate_limits: limits(10) });
  assert.ok(out.includes('5h:10%'));
  assert.ok(!out.includes('7d:'));
  const sdOnly = render({ cwd: '', model: { display_name: '' }, rate_limits: limits(undefined, 16) });
  assert.ok(sdOnly.includes('7d:16%'));
  assert.ok(!sdOnly.includes('5h:'));
});

test('rate_limits absent → ctx-only bracket, no separator', () => {
  const out = render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 6 } });
  assert.ok(out.includes(` [${ESC}[02;32mctx:6%${ESC}[00m]`), `got: ${JSON.stringify(out)}`);
  assert.ok(!out.includes('·'));
});

test('quotas without ctx → bracket with quota segments only', () => {
  const out = render({ cwd: '', model: { display_name: '' }, rate_limits: limits(10, 16) });
  assert.ok(out.includes(` [${ESC}[02;32m5h:10%${ESC}[00m · ${ESC}[02;32m7d:16%${ESC}[00m]`), `got: ${JSON.stringify(out)}`);
  assert.ok(!out.includes('ctx:'));
});

test('non-numeric quota value → segment hidden', () => {
  const out = render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 6 }, rate_limits: limits('N/A', -5) });
  assert.ok(!out.includes('5h:'));
  assert.ok(!out.includes('7d:'));
  assert.ok(out.includes('ctx:6%'));
});

test('absurd magnitude (int part >3 digits) hides the segment instead of rendering garbage', () => {
  // jq prints 1e19 as a plain digit string; bash [ -ge ] overflows past int64
  const out = render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 10000000000000000000 }, rate_limits: limits(10000000000000000000) });
  assert.ok(!out.includes('ctx:'), `ctx hidden; got: ${JSON.stringify(out)}`);
  assert.ok(!out.includes('5h:'), `quota hidden; got: ${JSON.stringify(out)}`);
});

test('DISABLE_STATUSLINE_QUOTA=0 keeps quota segments (only "1" disables)', () => {
  const out = render(
    { cwd: '', model: { display_name: '' }, rate_limits: limits(10, 16) },
    { DISABLE_STATUSLINE_QUOTA: '0' },
  );
  assert.ok(out.includes('5h:10%'));
  assert.ok(out.includes('7d:16%'));
});

test('DISABLE_STATUSLINE_QUOTA=1 hides quota segments, keeps ctx', () => {
  const out = render(
    { cwd: '', model: { display_name: '' }, context_window: { used_percentage: 6 }, rate_limits: limits(10, 16) },
    { DISABLE_STATUSLINE_QUOTA: '1' },
  );
  assert.ok(out.includes('ctx:6%'));
  assert.ok(!out.includes('5h:'));
  assert.ok(!out.includes('7d:'));
});

test('ctx hidden when absent or non-numeric', () => {
  assert.ok(!render({ cwd: '', model: { display_name: '' } }).includes('[ctx:'));
  assert.ok(!render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 'N/A' } }).includes('ctx:'));
});

test('post-/clear payload (explicit used_percentage:null) → ctx:0%, green', () => {
  // Byte-shape mirror of CC 2.1.206's fresh-session payload: rNn() returns
  // {used:null} until the first API response, so used_percentage is an
  // EXPLICIT null while the context_window object is fully present.
  const out = render({
    cwd: '',
    model: { display_name: '' },
    context_window: {
      total_input_tokens: 0,
      total_output_tokens: 0,
      context_window_size: 1000000,
      current_usage: null,
      used_percentage: null,
      remaining_percentage: null,
    },
    rate_limits: limits(0.4, 52.3),
  });
  assert.ok(out.includes(`${ESC}[02;32mctx:0%`), `ctx:0% shown; got: ${JSON.stringify(out)}`);
  assert.ok(out.includes('5h:0%') && out.includes('7d:52%'), 'quota segments unaffected');
});

test('context_window object without used_percentage key → ctx hidden (no fabricated 0%)', () => {
  const out = render({ cwd: '', model: { display_name: '' }, context_window: { context_window_size: 1000000 } });
  assert.ok(!out.includes('ctx:'), `got: ${JSON.stringify(out)}`);
});

test('non-object context_window → ctx hidden, no jq error blanking the line', () => {
  const out = render({ cwd: '/tmp/z', model: { display_name: 'M' }, context_window: 'garbage', rate_limits: limits(10) });
  assert.ok(!out.includes('ctx:'), `ctx hidden; got: ${JSON.stringify(out)}`);
  assert.ok(out.includes('5h:10%'), 'later fields still aligned');
});

test('no meter data at all → no bracket', () => {
  // ANSI escapes contain "["; the meter bracket is the only " [" (space-prefixed)
  const out = render({ cwd: '', model: { display_name: '' } });
  assert.ok(!out.includes(' ['), `got: ${JSON.stringify(out)}`);
});

test('empty stdin → user@host only, exit 0', () => {
  const res = spawnSync('bash', [SCRIPT], { input: '', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:$`));
});

test('git repo → branch segment; non-repo → none', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  const genv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execSync('git init -q && git commit -q --allow-empty -m init', { cwd: repo, env: genv });
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(render({ cwd: repo, model: { display_name: '' } }).includes(`${ESC}[00;35m(${branch})${ESC}[00m`));
  fs.rmSync(repo, { recursive: true, force: true });

  const nonrepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-nonrepo-'));
  assert.ok(!render({ cwd: nonrepo, model: { display_name: '' } }).includes(`${ESC}[00;35m(`));
  fs.rmSync(nonrepo, { recursive: true, force: true });
});

test('cwd "/" falls back to full path (basename would be empty)', () => {
  const out = render({ cwd: '/', model: { display_name: '' } });
  assert.ok(out.includes(`${ESC}[01;34m/${ESC}[00m`), `got: ${JSON.stringify(out)}`);
});

test('field with backslash escape does not truncate the line', () => {
  const out = render({ cwd: 'C:\\code\\proj', model: { display_name: 'Opus 4.8 (1M context)' }, context_window: { used_percentage: 6 }, rate_limits: limits(10, 16) });
  assert.ok(out.includes('C:\\code\\proj'), 'backslash path rendered literally');
  assert.ok(out.includes('Opus 4.8 (1M context)'), 'model survives backslash in cwd');
  assert.ok(out.includes('ctx:6%'), 'ctx survives backslash in cwd');
  assert.ok(out.includes('5h:10%'), 'quota survives backslash in cwd');
});

test('embedded newline in a field does not misalign later segments', () => {
  const out = render({ cwd: 'a\nb', model: { display_name: 'ModelX' }, context_window: { used_percentage: 10 }, rate_limits: limits(10, 16) });
  assert.ok(out.includes('ModelX'), 'model not overwritten by cwd tail');
  assert.ok(out.includes('ctx:10%'), 'ctx present');
  assert.ok(out.includes('7d:16%'), 'quota present');
});

test('detached HEAD → (detached:<sha>) segment', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-detach-'));
  const genv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execSync('git init -q && git commit -q --allow-empty -m one && git commit -q --allow-empty -m two', { cwd: repo, env: genv });
  const sha = execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  execSync(`git checkout -q ${sha}`, { cwd: repo, env: genv });
  const out = render({ cwd: repo, model: { display_name: '' } });
  assert.ok(out.includes(`${ESC}[00;35m(detached:${sha})${ESC}[00m`));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('M2: a field containing a newline still yields a single output line', () => {
  const out = render({ cwd: '/tmp/a\nb', model: { display_name: 'Opus\n4.8' }, context_window: { used_percentage: 5 } });
  assert.equal(out.split('\n').length, 1, 'output must be exactly one line');
  assert.match(out, /Opus 4\.8/, 'newline in model collapsed to a space');
});
