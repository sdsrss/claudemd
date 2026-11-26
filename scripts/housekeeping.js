import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { printHelpAndExit, invokedAsMain, parseStrictOrExit, parsePositiveInt } from './lib/argv.js';

const USAGE = `Usage: node scripts/housekeeping.js tmp [--apply] [--root=DIR] [--min-age-minutes=N]

tmp       Reclaim the per-run directories vitest leaves in the temp root.
          vitest 5.0.0 creates join(os.tmpdir(), nanoid()) on its root object
          and never removes it; on a tmpfs /tmp that is unreclaimable RAM.
          A directory is a target ONLY when all of these hold: its name is 21
          chars of [A-Za-z0-9_-]; it is a real directory owned by this uid; its
          children are a non-empty subset of {ssr, client}, each a real
          directory; every grandchild is a regular file named by 40 hex chars;
          and the newest mtime anywhere inside is older than the floor
          (60 min, or 24 h while a vitest watch-mode process of this uid runs).
          Also reclaims agent temp residue (spec §5-EXT), reported under
          \`agent\`: a real directory owned by this uid, named agent-tmp-*,
          with no .keep at its top, in which no entry (read with lstat; a
          symlink is never followed) has an mtime or ctime within 72 h; one
          holding a socket or FIFO, that is or holds a mount of another
          filesystem, past 200000 entries or with an unreadable subdirectory
          is listed under \`skipped\` instead.
          CLAUDEMD_TMP_SWEEP_TEST_NOW_MS (epoch ms) sets the clock ages are
          judged against, only together with --root or
          CLAUDEMD_TMP_SWEEP_ROOTS (test seam).
          Roots: $TMPDIR, os.tmpdir(), /tmp, /var/tmp and ~/.cache/tmp,
          de-duplicated (CLAUDEMD_TMP_SWEEP_ROOTS, colon-separated, replaces
          the list).
Options:
  --apply                tmp: delete (default is a dry run that only reports).
  --root=DIR             tmp: scan only DIR, an existing directory (test seam).
  --min-age-minutes=N    tmp: override the vitest age floor (the agent-tmp-*
                         floor stays 72 h).
  --help, -h             Print this message and exit.

Output: JSON on stdout.

Exit codes: 0 success | 2 argv-shape error, a bad --min-age-minutes, or a
--root that is not a directory | 3 tmp --apply recorded an error for a
target (each one is listed in \`errors\`, with its errno).`;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const VITEST_DIR_NAME = /^[A-Za-z0-9_-]{21}$/;
const VITEST_ENV_NAMES = new Set(['ssr', 'client']);
const HEX40 = /^[0-9a-f]{40}$/;

export function ageFloorMs({ watchAlive }) {
  return watchAlive ? 24 * HOUR : HOUR;
}

// A process line runs vitest when a token naming the vitest binary is either
// the program / its first argument (`vitest …`, `npx vitest …`,
// `node vitest.mjs …`) or a node_modules path. `grep vitest` does not count.
// Watch mode is vitest's default: anything but `run` / `--run` is a watcher.
export function vitestWatchAlive(lines) {
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    const i = tokens.findIndex(
      (t, idx) => /^vitest(\.m?js)?$/.test(path.basename(t)) && (idx <= 1 || t.includes('/node_modules/'))
    );
    if (i === -1) continue;
    const after = tokens.slice(i + 1);
    if (after[0] === 'run' || after.some(t => t === '--run')) continue;
    return true;
  }
  return false;
}

function psLines() {
  const r = spawnSync('ps', ['-U', String(process.getuid()), '-o', 'args='], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.split('\n');
}

// CLAUDEMD_TMP_SWEEP_ROOTS (colon-separated) replaces the list outright — the
// hook suite's seam, so a test never sweeps the real temp root.
export function defaultTmpRoots() {
  const seam = process.env.CLAUDEMD_TMP_SWEEP_ROOTS;
  if (seam) return seam.split(':').filter(Boolean);
  const roots = [
    process.env.TMPDIR,
    os.tmpdir(),
    '/tmp',
    '/var/tmp',
    path.join(os.homedir(), '.cache', 'tmp'),
  ];
  return roots.filter(Boolean);
}

// The roots a scan reads, each resolved once: a root that does not resolve is
// skipped, and two spellings of one directory are scanned once.
function* realRoots(roots) {
  const seen = new Set();
  for (const r of roots) {
    let real;
    try {
      real = fs.realpathSync(r);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    let entries;
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      continue;
    }
    yield { real, entries };
  }
}

// Returns { bytes, newestMs } when `dir` carries the exact vitest signature,
// null otherwise. lstat throughout: a symlink anywhere disqualifies.
function vitestSignature(dir, uid) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory() || st.uid !== uid) return null;
  let newestMs = st.mtimeMs;
  let bytes = 0;
  let children;
  try {
    children = fs.readdirSync(dir);
  } catch {
    return null;
  }
  if (children.length === 0) return null;
  for (const c of children) {
    if (!VITEST_ENV_NAMES.has(c)) return null;
    const cp = path.join(dir, c);
    let cst;
    let files;
    try {
      cst = fs.lstatSync(cp);
      if (!cst.isDirectory()) return null;
      files = fs.readdirSync(cp);
    } catch {
      return null;
    }
    newestMs = Math.max(newestMs, cst.mtimeMs);
    for (const f of files) {
      if (!HEX40.test(f)) return null;
      let fst;
      try {
        fst = fs.lstatSync(path.join(cp, f));
      } catch {
        return null;
      }
      if (!fst.isFile()) return null;
      newestMs = Math.max(newestMs, fst.mtimeMs);
      bytes += fst.size;
    }
  }
  return { bytes, newestMs };
}

export function scanVitestTmp({
  roots = defaultTmpRoots(),
  now = Date.now(),
  minAgeMs,
  uid = process.getuid(),
} = {}) {
  const targets = [];
  for (const { real, entries } of realRoots(roots)) {
    for (const e of entries) {
      if (!VITEST_DIR_NAME.test(e.name) || !e.isDirectory()) continue;
      const full = path.join(real, e.name);
      const sig = vitestSignature(full, uid);
      if (!sig || now - sig.newestMs < minAgeMs) continue;
      targets.push({ path: full, bytes: sig.bytes });
    }
  }
  return targets;
}

// Deletes scan targets, re-checking each one's signature and age right before
// its rm: scan and delete are separate moments, and a run that restarted in
// between has made the directory fresh again.
//
// Several sweeps racing over one root each count what they removed, so their
// sum can exceed the dirs removed. Counting only a successful rmdir of the top
// (529ad53, backed out in 864b03a) does not fix that on macOS: there, two
// processes' rmdir(2) of the same empty dir can both return success (PR CI run
// 39461011037: 801, 897 and 885 successes for 800 dirs on Node 20, 22 and 24;
// Linux exactly 800). Node 26 on Linux overcounts too: 4 sweeps over 400
// agent-tmp-* dirs summed 678 to 1,134 (D#718, 2026-11-03).
//
// The sweep that loses such a race finds the dir, or part of it, already gone,
// and rmSync throws ENOENT. That is not a failure: before D#718 L7 it went into
// `errors` and the CLI exited 3, in 19 of 20 processes over those five runs.
// It is not this sweep's deletion either, so it is not counted. Whatever is
// left of a half-removed dir is judged again at the next sweep: removing its
// entries refreshed the parent dir's mtime and ctime.
function rmTarget(p, errors) {
  try {
    fs.rmSync(p, { recursive: true });
    return true;
  } catch (e) {
    if (e.code !== 'ENOENT') errors.push({ path: p, code: e.code || String(e) });
    return false;
  }
}

export function removeVitestTargets({ targets, minAgeMs, uid = process.getuid(), now = Date.now() }) {
  let deleted = 0;
  let bytes = 0;
  const errors = [];
  for (const t of targets) {
    const sig = vitestSignature(t.path, uid);
    if (!sig || now - sig.newestMs < minAgeMs) continue;
    if (rmTarget(t.path, errors)) {
      deleted++;
      bytes += t.bytes;
    }
  }
  return { deleted, bytes, errors };
}

export function sweepVitestTmp({ apply = false, minAgeMs, ...opts } = {}) {
  if (minAgeMs == null) {
    const lines = psLines();
    // ps unavailable → assume a watcher may be alive and take the long floor.
    minAgeMs = ageFloorMs({ watchAlive: lines === null || vitestWatchAlive(lines) });
  }
  const targets = scanVitestTmp({ ...opts, minAgeMs });
  const removed = apply
    ? removeVitestTargets({ targets, minAgeMs, uid: opts.uid, now: opts.now })
    : { deleted: 0, bytes: 0, errors: [] };
  return { minAgeMs, targets, ...removed };
}

// ---- agent temp residue (agent-tmp-*) ----
//
// Spec §5-EXT Agent temp residue: an agent names a temp dir it creates
// agent-tmp-<task>-XXXXXX and retains one with a top-level .keep. A dir the
// creating task did not remove is reaped here once nothing inside changed for
// 72 h. The model-side rule waits 24 h, but it also checks that no open spec
// file, paused checkpoint or deferred item names the dir; this sweep cannot,
// so it waits longer and honours .keep alone.
//
// Not cc-*: Claude Code keeps its listening sockets in /tmp/cc-socks and
// ~/.cache/tmp/cc-socks (0.119.0 pre-tag review H1). A socket or FIFO
// anywhere inside also keeps the dir: something may be listening on it.
//
// Freshness is the newest of mtime and ctime of any entry, read with lstat: a
// symlink is never followed, so a fresh file outside does not keep the dir
// and is not deleted with it. ctime because `cp -a`, `rsync -a` and tar set
// mtimes back, the dir's own included, and none of them can set ctime (review
// M1). atime is left out, unlike systemd-tmpfiles: this walk's own readdir
// refreshes a directory's atime, so a dir would never age.
//
// An entry on another device than the dir's top keeps the dir (D#718 L8): a
// recursive rmSync enters mount points, and a user mounts without root (FUSE:
// sshfs, rclone). Path lookup crosses a mount point under lstat as under stat,
// so the mount point itself already carries the mounted filesystem's st.dev. A
// bind mount of the same filesystem keeps st.dev and is not caught; it needs
// root or a user namespace. The dir itself can be the mount point
// (`rclone mount remote: "$D"`); its top and every entry then share the mounted
// st.dev, so the top is also compared with its parent, the temp root (0.120.0
// pre-tag review H1).
export const AGENT_TMP_FLOOR_MS = 72 * HOUR;
const AGENT_DIR_NAME = /^agent-tmp-./;
const AGENT_MAX_ENTRIES = 200000;

// Returns { bytes } for an agent-tmp-* dir idle past `cutoffMs`, { skip: reason } when
// it cannot be judged, null when it is not a target.
function agentResidue(dir, uid, cutoffMs, maxEntries) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory() || st.uid !== uid || Math.max(st.mtimeMs, st.ctimeMs) >= cutoffMs) return null;
  try {
    fs.lstatSync(path.join(dir, '.keep'));
    return null;
  } catch {
    // no .keep: go on
  }
  let parent;
  try {
    parent = fs.lstatSync(path.dirname(dir));
  } catch {
    return null;
  }
  if (parent.dev !== st.dev) return { skip: 'mount-point' };
  let bytes = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    let names;
    try {
      names = fs.readdirSync(d);
    } catch {
      return { skip: 'unreadable' };
    }
    for (const n of names) {
      if (++seen > maxEntries) return { skip: 'too-many-entries' };
      let s;
      try {
        s = fs.lstatSync(path.join(d, n));
      } catch {
        return null; // vanished between readdir and lstat: something is at work in it
      }
      if (Math.max(s.mtimeMs, s.ctimeMs) >= cutoffMs) return null;
      if (s.dev !== st.dev) return { skip: 'mount-point' };
      if (s.isSocket() || s.isFIFO()) return { skip: 'socket-or-fifo' };
      if (s.isDirectory()) stack.push(path.join(d, n));
      else if (s.isFile()) bytes += s.size;
    }
  }
  return { bytes };
}

export function scanAgentTmp({
  roots = defaultTmpRoots(),
  now = Date.now(),
  minAgeMs = AGENT_TMP_FLOOR_MS,
  uid = process.getuid(),
  maxEntries = AGENT_MAX_ENTRIES,
} = {}) {
  const targets = [];
  const skipped = [];
  for (const { real, entries } of realRoots(roots)) {
    for (const e of entries) {
      if (!AGENT_DIR_NAME.test(e.name) || !e.isDirectory()) continue;
      const full = path.join(real, e.name);
      const r = agentResidue(full, uid, now - minAgeMs, maxEntries);
      if (!r) continue;
      if (r.skip) skipped.push({ path: full, reason: r.skip });
      else targets.push({ path: full, bytes: r.bytes });
    }
  }
  return { targets, skipped };
}

// Re-judges each target right before its rm, as removeVitestTargets does.
export function removeAgentTargets({
  targets,
  minAgeMs = AGENT_TMP_FLOOR_MS,
  uid = process.getuid(),
  now = Date.now(),
  maxEntries = AGENT_MAX_ENTRIES,
}) {
  let deleted = 0;
  let bytes = 0;
  const errors = [];
  for (const t of targets) {
    const r = agentResidue(t.path, uid, now - minAgeMs, maxEntries);
    if (!r || r.skip) continue;
    if (rmTarget(t.path, errors)) {
      deleted++;
      bytes += r.bytes;
    }
  }
  return { deleted, bytes, errors };
}

// Both arms. `minAgeMs` is the vitest floor only; the agent floor is fixed.
export function sweepTmp({ apply = false, ...opts } = {}) {
  const vitest = sweepVitestTmp({ apply, ...opts });
  const { roots, now, uid } = opts;
  const scanned = scanAgentTmp({ roots, now, uid });
  const removed = apply
    ? removeAgentTargets({ targets: scanned.targets, uid, now })
    : { deleted: 0, bytes: 0, errors: [] };
  return { ...vitest, agent: { minAgeMs: AGENT_TMP_FLOOR_MS, ...scanned, ...removed } };
}

if (invokedAsMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  printHelpAndExit(argv, USAGE);
  const [sub, ...rest] = argv;
  if (sub === 'tmp') {
    const p = parseStrictOrExit(rest, { bools: ['--apply'], values: ['--root', '--min-age-minutes'] });
    const opts = { apply: p.bools.has('--apply') };
    if (p.values['--root'] !== undefined) {
      // A root that is not a directory scans nothing, and an empty report with
      // exit 0 reads as "nothing to reclaim".
      const r = p.values['--root'];
      if (!r || !fs.statSync(r, { throwIfNoEntry: false })?.isDirectory()) {
        console.error(`--root must be an existing directory (got '${r}').`);
        process.exit(2);
      }
      opts.roots = [r];
    }
    // Test seam: the clock both arms judge age against, honoured only while the
    // roots are redirected (--root or CLAUDEMD_TMP_SWEEP_ROOTS). ctime cannot
    // be set back, so a suite ages a fixture by moving the clock forward.
    const testNow = process.env.CLAUDEMD_TMP_SWEEP_TEST_NOW_MS;
    if (testNow && (opts.roots || process.env.CLAUDEMD_TMP_SWEEP_ROOTS)) {
      const n = Number(testNow);
      if (Number.isFinite(n)) opts.now = n;
    }
    if (p.values['--min-age-minutes'] !== undefined) {
      const n = parsePositiveInt(p.values['--min-age-minutes']);
      if (n === null) {
        console.error(
          `--min-age-minutes must be a positive integer (got '${p.values['--min-age-minutes']}').`
        );
        process.exit(2);
      }
      opts.minAgeMs = n * MINUTE;
    }
    const result = sweepTmp(opts);
    process.stdout.write(JSON.stringify(result) + '\n');
    // A target --apply could not delete is only an entry in `errors`; exit 0
    // read as "reclaimed" (131c). exitCode, not exit(): stdout drains first.
    if (result.errors.length > 0 || result.agent.errors.length > 0) process.exitCode = 3;
  } else {
    console.error(`Unknown subcommand: '${sub ?? ''}'. Expected 'tmp'.`);
    process.exit(2);
  }
}
