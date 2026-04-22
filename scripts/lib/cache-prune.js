import fs from 'node:fs';
import path from 'node:path';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Prune sibling version dirs of `pluginRoot` down to `keep` newest (by semver),
// always retaining `pluginRoot` itself. Scope-gated to cache layouts — the
// basename of pluginRoot must be a 3-part numeric semver, otherwise pruning
// is a no-op. This protects dev-mode `node scripts/install.js` from scanning
// the parent of a working tree.
export function pruneCache(pluginRoot, { keep = 3 } = {}) {
  const currentVersion = path.basename(pluginRoot);
  const versionsDir = path.dirname(pluginRoot);

  if (!SEMVER_RE.test(currentVersion)) {
    return { kept: [], removed: [], skipped: 'non-semver-plugin-root' };
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
