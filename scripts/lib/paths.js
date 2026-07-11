import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const home = () => process.env.HOME || os.homedir();

export const pluginCacheDir    = () => path.join(home(), '.claude/plugins/cache/claudemd');
// Production hook root: the path Claude Code resolves ${CLAUDE_PLUGIN_ROOT} to
// at hook-fire time. /plugin update is a silent no-op in current CC versions
// (memory: reference_plugin_update_manual_refresh.md), so this can lag the
// shipped plugin version. install-drift compares this against the source repo.
export const marketplacePluginRoot = () => path.join(home(), '.claude/plugins/marketplaces/claudemd');
export const stateDir          = () => path.join(home(), '.claude/.claudemd-state');
// Manifest lives outside stateDir so that `rm -rf ~/.claude/.claudemd-state/`
// — which a user might run to reset residue-audit / sandbox-disposal baselines
// — does not also erase the install manifest. Pre-0.1.9 manifests lived at
// `stateDir()/installed.json`; any claudemd script that reads the manifest
// calls `readManifest()` (below), which transparently relocates legacy files
// on first touch.
export const manifestPath      = () => path.join(home(), '.claude/.claudemd-manifest.json');
export const legacyManifestPath = () => path.join(stateDir(), 'installed.json');
export const logsDir           = () => path.join(home(), '.claude/logs');
export const settingsPath      = () => path.join(home(), '.claude/settings.json');
// code-graph's composite statusline registry — primary in ~/.cache (volatile)
// + durable mirror in ~/.claude (code-graph self-heals the primary from it).
// claudemd registers itself as a guest provider here rather than clobbering the
// single statusLine slot. Both are code-graph-owned; we read/write our own entry.
export const codeGraphRegistryPath        = () => path.join(home(), '.cache/code-graph/statusline-registry.json');
export const codeGraphProvidersBackupPath = () => path.join(home(), '.claude/statusline-providers.json');
export const backupRoot        = () => path.join(home(), '.claude');
export const specHome          = () => [
  path.join(home(), '.claude/CLAUDE.md'),
  path.join(home(), '.claude/CLAUDE-extended.md'),
  path.join(home(), '.claude/CLAUDE-changelog.md'),
  path.join(home(), '.claude/OPERATOR.md'),
];
// Address a single home-spec file by basename. Decoupled from backupRoot()
// (which happens to share the same dir today) so that a future relocation
// of backups does not silently break update.js's home-spec read path.
export const homeSpec          = (name) => path.join(home(), '.claude', name);

// Reads the manifest from its canonical location, falling back to (and
// relocating) the pre-0.1.9 location. Any consumer (install / uninstall /
// status / doctor) gets the migration as a side effect on first access.
// Returns { exists, path, data, migrated } — never throws on missing file.
export function readManifest() {
  const newPath = manifestPath();
  if (fs.existsSync(newPath)) {
    try {
      return { exists: true, path: newPath, data: JSON.parse(fs.readFileSync(newPath, 'utf8')), migrated: false };
    } catch {
      return { exists: true, path: newPath, data: null, migrated: false };
    }
  }
  const oldPath = legacyManifestPath();
  if (fs.existsSync(oldPath)) {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(oldPath, 'utf8')); } catch { /* fall through */ }
    if (data) {
      try {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        fs.writeFileSync(newPath, JSON.stringify(data, null, 2));
        fs.unlinkSync(oldPath);
      } catch { /* best-effort migration; leave legacy in place on FS error */ }
    }
    return { exists: true, path: newPath, data, migrated: true };
  }
  return { exists: false, path: newPath, data: null, migrated: false };
}

export function resolvePluginRoot(importMetaUrl) {
  const explicit = process.env.CLAUDE_PLUGIN_ROOT;
  if (explicit) return explicit;
  const scriptsDir = path.dirname(fileURLToPath(importMetaUrl));
  return path.resolve(scriptsDir, '..');
}

export function readPluginVersion(pluginRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Strict MAJOR.MINOR.PATCH — the only shape this plugin ships and the manifest
// records. Version-direction logic (install.js downgrade guard, doctor
// staleness check) is SKIPPED when either side fails this shape (dev-mode
// 'unknown', test fixtures like '9.9.9-test'): fail-open on unparseable
// versions, never fail-block.
export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Numeric x.y.z compare: -1 | 0 | 1. Callers gate inputs through SEMVER_RE.
export function semverCmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
