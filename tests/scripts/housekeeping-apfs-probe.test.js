// housekeeping-apfs-probe.test.js — TEMPORARY probe (D#494, 0.113.4 release PR).
//
// 529ad53 counted a vitest dir as deleted only when this process's rmdir of its
// top succeeded. Four parallel `tmp --apply` runs over 800 dirs then summed to
// 800 on Linux (tmpfs, ext4) and to 946 on macos-latest (PR CI run 39426400220),
// so the fix was backed out (864b03a). No macOS host is at hand, so this file
// records, on every CI leg, what four racing processes see per directory and
// prints it with t.diagnostic. It asserts only that the racers ran: it is a
// recording, not a gate. It is removed, or replaced by a fix and its test,
// before v0.113.4 is tagged.
//
// Modes (each on a fresh root of N dirs, four racers started together):
//   bare     — empty dirs; each racer rmdirs every name.
//   bottomup — 529ad53's removal without its re-check: readdir ssr, rm files,
//              rmdir ssr, rmdir top; a racer counts a dir when its top rmdir
//              returned without throwing.
//   recheck  — bottomup behind 529ad53's re-check (children non-empty and only
//              ssr/client, newest mtime older than a minute).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const N = 800;
const RACERS = 4;
const HEX = 'a'.repeat(40);

// Runs in each racer: argv = [mode, root, startAtMs]. Prints one JSON object.
const CHILD = `
import fs from 'node:fs';
import path from 'node:path';
const [mode, root, startAt] = process.argv.slice(-3);
const t0 = process.hrtime.bigint();
const now = () => Number((process.hrtime.bigint() - t0) / 1000n);
const names = fs.readdirSync(root);
const dupNames = names.length - new Set(names).size;
// readdir order, as 529ad53's sweep walked its targets: every racer meets the
// same dir at about the same moment.
const order = names;
const wait = Number(startAt) - Date.now();
if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
const log = {};
const counted = [];
const step = (name, what, fn) => {
  try {
    const r = fn();
    (log[name] ??= []).push([what, 'ok', now(), r ?? null]);
    return true;
  } catch (e) {
    (log[name] ??= []).push([what, e.code || String(e), now(), null]);
    return false;
  }
};
for (const name of order) {
  const top = path.join(root, name);
  if (mode === 'bare') {
    if (step(name, 'rmdir-top', () => fs.rmdirSync(top))) counted.push(name);
    continue;
  }
  if (mode === 'recheck') {
    let ok = false;
    step(name, 'recheck', () => {
      const kids = fs.readdirSync(top);
      let newest = fs.lstatSync(top).mtimeMs;
      if (kids.length === 0 || kids.some(k => k !== 'ssr' && k !== 'client')) return 'shape:' + kids.join(',');
      for (const k of kids) {
        newest = Math.max(newest, fs.lstatSync(path.join(top, k)).mtimeMs);
        for (const f of fs.readdirSync(path.join(top, k)))
          newest = Math.max(newest, fs.lstatSync(path.join(top, k, f)).mtimeMs);
      }
      if (Date.now() - newest < 60000) return 'fresh';
      ok = true;
      return 'pass';
    });
    if (!ok) continue;
  }
  const ep = path.join(top, 'ssr');
  let files = [];
  step(name, 'readdir-ssr', () => {
    files = fs.readdirSync(ep);
    return files.length;
  });
  for (const f of files) step(name, 'rm-file', () => fs.rmSync(path.join(ep, f), { force: true }));
  step(name, 'rmdir-ssr', () => fs.rmdirSync(ep));
  if (step(name, 'rmdir-top', () => {
    const ino = fs.lstatSync(top).ino;
    fs.rmdirSync(top);
    return ino;
  })) counted.push(name);
}
process.stdout.write(JSON.stringify({ mode, pid: process.pid, listed: names.length, dupNames, counted, log }));
`;

function build(root, mode) {
  const t = (Date.now() - 2 * 3600000) / 1000;
  for (let i = 0; i < N; i++) {
    const d = path.join(root, String(i).padStart(21, 'x'));
    if (mode === 'bare') {
      fs.mkdirSync(d);
      continue;
    }
    fs.mkdirSync(path.join(d, 'ssr'), { recursive: true });
    const f = path.join(d, 'ssr', HEX);
    fs.writeFileSync(f, 'const x = 1;\n');
    for (const p of [f, path.join(d, 'ssr'), d]) fs.utimesSync(p, t, t);
  }
}

function race(mode, root) {
  const startAt = Date.now() + 1500;
  return Promise.all(
    Array.from(
      { length: RACERS },
      () =>
        new Promise(resolve => {
          const c = spawn(process.execPath, [
            '--input-type=module',
            '-e',
            CHILD,
            mode,
            root,
            String(startAt),
          ]);
          let out = '';
          let err = '';
          c.stdout.on('data', d => (out += d));
          c.stderr.on('data', d => (err += d));
          c.on('close', code => resolve({ code, out, err }));
        })
    )
  );
}

for (const mode of ['bare', 'bottomup', 'recheck']) {
  test(`apfs probe (${mode}): four racers over ${N} dirs`, { timeout: 120000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-apfs-probe-'));
    try {
      build(root, mode);
      const runs = await race(mode, root);
      assert.deepEqual(
        runs.map(r => r.code),
        Array(RACERS).fill(0),
        runs.map(r => r.err).join('\n')
      );
      const outs = runs.map(r => JSON.parse(r.out));
      const byName = new Map();
      for (const o of outs) for (const n of o.counted) byName.set(n, [...(byName.get(n) || []), o.pid]);
      const doubled = [...byName].filter(([, pids]) => pids.length > 1);
      const hist = {};
      for (const o of outs)
        for (const events of Object.values(o.log))
          for (const [what, res, , r] of events) {
            const k = `${what}:${res}${typeof r === 'string' ? `:${r}` : ''}`;
            hist[k] = (hist[k] || 0) + 1;
          }
      const leftover = fs.readdirSync(root).length;
      t.diagnostic(
        `apfs-probe mode=${mode} platform=${process.platform} node=${process.version} tmp=${fs.realpathSync(root)} ` +
          `n=${N} sum=${outs.reduce((s, o) => s + o.counted.length, 0)} perRacer=${outs.map(o => o.counted.length)} ` +
          `doubled=${doubled.length} leftover=${leftover} listed=${outs.map(o => o.listed)} dupNames=${outs.map(o => o.dupNames)}`
      );
      t.diagnostic(`apfs-probe mode=${mode} steps ${JSON.stringify(hist)}`);
      for (const [name] of doubled.slice(0, 3))
        for (const o of outs)
          if (o.log[name])
            t.diagnostic(`apfs-probe mode=${mode} ${name} pid=${o.pid} ${JSON.stringify(o.log[name])}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
