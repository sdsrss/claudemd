import fs from 'node:fs';
import path from 'node:path';
// Single source (2026-07-27 audit, L8): this file declared its own
// `/^\d+\.\d+\.\d+$/` shadowing the exported one in paths.js. Equivalent today,
// tested only on the paths.js side — the shape every drifted seam starts as.
import { SEMVER_RE, pluginCacheDir, logsDir } from './paths.js';
import { readLogRows } from './rule-hits-parse.js';

// A version dir past `keep` can still be the hook root of a running session:
// Claude Code keeps a session on the version it loaded until /reload-plugins or
// a restart. D#635 (2026-11-01): 0.117.3's install removed 0.116.6 while two
// sessions ran their hooks from it, and there every claudemd hook then exited
// 127 ("No such file or directory"), which does not block, so the §8 gates were
// off until a reload. Claude Code itself marks a superseded dir with
// `.orphaned_at` (ms since epoch) and deletes it 14 days later, "so a session
// that already loaded the old version keeps running"
// (code.claude.com/docs/en/plugins/loading, "Cleanup of previous versions").
// A candidate is held while that mark is under 14 days old (or not a number), or
// while the hook log has a row from its version in the last 14 days, which also
// covers dirs nothing marked. The log window is as long as the mark's because a
// session can stay open for days without firing a hook.
//
// With DISABLE_RULE_HITS_LOG=1 the hooks write no rows (hook-common.sh reads
// `== "1"`), so a missing row says nothing about use, and a dir nothing marked
// is held too (`no-log-signal`, D#643). A marked dir is not: Claude Code deletes
// it itself once the mark is 14 days old and no live process holds it (below).
//
// Before all three comes the direct signal (D#652): Claude Code writes
// `.in_use/<pid>` = {"pid":N,"procStart":"…"} in each version dir a process
// loads, removes it when that process exits, and its own 14-day sweep skips a
// dir while one of those names a live process ("Skipping orphan cleanup, in use
// by live session"; read from the 2.1.309, 2.1.310 and 2.1.316 binaries
// 2026-11-02, the docs page above does not mention it). It works with the log
// off and for sessions whose environment this install never sees. For a version
// dir that is a symlink, Claude Code writes the record under
// `~/.claude/plugins/.in_use-links/` instead, which this prune does not read.
const HOLD_MS = 14 * 86400 * 1000;

// The pid answers signal 0, and when the marker has a procStart string and /proc
// can give the pid's start time (field 22 of /proc/<pid>/stat), the two match, so
// a reused pid does not count. Where this differs from Claude Code 2.1.316 it
// holds more: EPERM counts as alive here (the process exists under another user;
// Claude Code counts any kill error as dead), and a marker with no procStart
// string counts on its pid alone (Claude Code does that only when the field is
// absent). Without /proc (macOS, where Claude
// Code compares `ps -o lstart=` instead) the pid alone decides: a reused pid
// holds one dir too many until Claude Code sweeps the dead marker. A pid that
// is not a positive integer counts as dead: kill(0) and kill(-1) reach process
// groups, not one process.
function isLive(marker) {
  const pid = marker?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== 'EPERM') return false;
  }
  if (typeof marker.procStart !== 'string') return true;
  let stat;
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return true;
  }
  // comm, inside the parentheses, may hold spaces; field 3 starts after `) `.
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === marker.procStart;
}

// Whether any `.in_use` entry of `dir` names a live process. An entry that does
// not read or parse as JSON counts for nothing. Here this prune holds less than
// Claude Code 2.1.316, which deletes an entry that does not parse but counts one
// it cannot read as live, and a `.tmp.` one under 10 minutes old too (a record
// being written). It also reads only regular files up to a size cap; this prune
// reads any entry. The prune never writes or deletes an entry itself;
// a dir it removes goes with its entries.
function inUseByLiveProcess(dir) {
  const markers = path.join(dir, '.in_use');
  let names;
  try {
    names = fs.readdirSync(markers);
  } catch {
    return false;
  }
  return names.some(name => {
    try {
      return isLive(JSON.parse(fs.readFileSync(path.join(markers, name), 'utf8')));
    } catch {
      return false;
    }
  });
}

// Number when the mark exists (NaN when it does not parse), null when absent.
function orphanedAt(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, '.orphaned_at'), 'utf8');
  } catch {
    return null;
  }
  return /^\s*\d+\s*$/.test(text) ? Number(text) : NaN;
}

// Versions with a hook row at or after `since`, across the rotated generations.
function versionsLoggedSince(since) {
  const seen = new Set();
  const { rows } = readLogRows(path.join(logsDir(), 'claudemd.jsonl'));
  for (const { row, t } of rows) {
    if (t >= since && typeof row.hook_version === 'string') seen.add(row.hook_version);
  }
  return seen;
}

// Prune sibling version dirs of `pluginRoot` down to `keep` newest (by semver),
// always retaining `pluginRoot` itself, and holding any older dir that may still
// be in use (above). `held` lists those with the reason.
//
// TWO independent gates, because the first one alone was not a location check
// (2026-09-02 audit R11-02). `SEMVER_RE.test(basename)` constrains the SHAPE of
// the name and says nothing about WHERE the scan happens, so this function
// would rm -rf semver-named siblings of any directory it was pointed at — a
// `git worktree add ../0.70.0`, a version-named checkout, a CLAUDE_PLUGIN_ROOT
// aimed at one. paths.js had exported pluginCacheDir() the whole time and
// nothing had ever consulted it AS A GUARD — `status.js` did read it, to build
// the cache-present hint (correction from the 0.71.4 pre-tag review; the first
// version of this comment said it had no caller at all).
//
// `startsWith(pluginCacheDir() + sep)`, NOT equality: the production layout is
// `~/.claude/plugins/cache/claudemd/claudemd/<version>`, so the versions dir
// sits one level BELOW pluginCacheDir(). An equality check reads tighter and
// would silently turn pruning off forever.
//
// realpath on both sides so a symlinked plugin root is judged by where it
// actually lands, and so the comparison is not fooled by `..` or a symlinked
// home. realpath also subsumes the old existence check.
export function pruneCache(pluginRoot, { keep = 3 } = {}) {
  let realRoot;
  const skip = skipped => ({ kept: [], removed: [], held: [], skipped });
  try {
    realRoot = fs.realpathSync(pluginRoot);
  } catch {
    return skip('missing-versions-dir');
  }

  const currentVersion = path.basename(realRoot);
  const versionsDir = path.dirname(realRoot);

  if (!SEMVER_RE.test(currentVersion)) {
    return skip('non-semver-plugin-root');
  }

  let cacheRoot;
  try {
    cacheRoot = fs.realpathSync(pluginCacheDir());
  } catch {
    return skip('outside-plugin-cache');
  }
  if (!(versionsDir + path.sep).startsWith(cacheRoot + path.sep)) {
    return skip('outside-plugin-cache');
  }

  if (!fs.existsSync(versionsDir)) {
    return skip('missing-versions-dir');
  }

  const siblings = fs
    .readdirSync(versionsDir)
    .filter(n => SEMVER_RE.test(n))
    .map(n => ({
      name: n,
      dir: path.join(versionsDir, n),
      parts: n.split('.').map(Number),
    }));

  siblings.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
    }
    return 0;
  });

  const keepSet = new Set([currentVersion]);
  for (const s of siblings) {
    if (keepSet.size >= keep) break;
    keepSet.add(s.name);
  }

  const removed = [];
  const held = [];
  const candidates = siblings.filter(s => !keepSet.has(s.name));
  if (candidates.length) {
    const now = Date.now();
    // Read only when something could go: most installs see ≤ keep dirs.
    const logged = versionsLoggedSince(now - HOLD_MS);
    const logOff = process.env.DISABLE_RULE_HITS_LOG === '1';
    for (const s of candidates) {
      const mark = orphanedAt(s.dir);
      if (inUseByLiveProcess(s.dir)) {
        held.push({ name: s.name, reason: 'in-use' });
      } else if (mark !== null && !(now - mark >= HOLD_MS)) {
        // `!(age >= HOLD_MS)` holds a NaN mark and a future-dated one too.
        held.push({ name: s.name, reason: 'orphaned-recently' });
      } else if (logged.has(s.name)) {
        held.push({ name: s.name, reason: 'hook-rows-recently' });
      } else if (logOff && mark === null) {
        held.push({ name: s.name, reason: 'no-log-signal' });
      } else {
        fs.rmSync(s.dir, { recursive: true, force: true });
        removed.push(s.dir);
      }
    }
  }

  return { kept: [...keepSet], removed, held, skipped: null };
}
