import fs from 'node:fs';
import path from 'node:path';
// Single source (2026-07-27 audit, L8): this file declared its own
// `/^\d+\.\d+\.\d+$/` shadowing the exported one in paths.js. Equivalent today,
// tested only on the paths.js side — the shape every drifted seam starts as.
import { SEMVER_RE, pluginCacheDir } from './paths.js';

// Prune sibling version dirs of `pluginRoot` down to `keep` newest (by semver),
// always retaining `pluginRoot` itself.
//
// TWO independent gates, because the first one alone was not a location check
// (2026-09-02 audit R11-02). `SEMVER_RE.test(basename)` constrains the SHAPE of
// the name and says nothing about WHERE the scan happens, so this function
// would rm -rf semver-named siblings of any directory it was pointed at — a
// `git worktree add ../0.70.0`, a version-named checkout, a CLAUDE_PLUGIN_ROOT
// aimed at one. paths.js had exported pluginCacheDir() the whole time and no
// caller had ever asked it.
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
  try { realRoot = fs.realpathSync(pluginRoot); }
  catch { return { kept: [], removed: [], skipped: 'missing-versions-dir' }; }

  const currentVersion = path.basename(realRoot);
  const versionsDir = path.dirname(realRoot);

  if (!SEMVER_RE.test(currentVersion)) {
    return { kept: [], removed: [], skipped: 'non-semver-plugin-root' };
  }

  let cacheRoot;
  try { cacheRoot = fs.realpathSync(pluginCacheDir()); }
  catch { return { kept: [], removed: [], skipped: 'outside-plugin-cache' }; }
  if (!(versionsDir + path.sep).startsWith(cacheRoot + path.sep)) {
    return { kept: [], removed: [], skipped: 'outside-plugin-cache' };
  }

  if (!fs.existsSync(versionsDir)) {
    return { kept: [], removed: [], skipped: 'missing-versions-dir' };
  }

  const siblings = fs.readdirSync(versionsDir)
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
  for (const s of siblings) {
    if (!keepSet.has(s.name)) {
      fs.rmSync(s.dir, { recursive: true, force: true });
      removed.push(s.dir);
    }
  }

  return { kept: [...keepSet], removed, skipped: null };
}
