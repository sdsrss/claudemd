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
const HOLD_MS = 14 * 86400 * 1000;

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
    for (const s of candidates) {
      const mark = orphanedAt(s.dir);
      // `!(age >= HOLD_MS)` holds a NaN mark and a future-dated one too.
      if (mark !== null && !(now - mark >= HOLD_MS)) {
        held.push({ name: s.name, reason: 'orphaned-recently' });
      } else if (logged.has(s.name)) {
        held.push({ name: s.name, reason: 'hook-rows-recently' });
      } else {
        fs.rmSync(s.dir, { recursive: true, force: true });
        removed.push(s.dir);
      }
    }
  }

  return { kept: [...keepSet], removed, held, skipped: null };
}
