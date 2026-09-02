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
// CLAUDEMD_STATE_DIR is the documented test seam for the state root. It lives
// here rather than at each call site: doctor.js and clean-residue.js each
// inlined `process.env.CLAUDEMD_STATE_DIR || path.join(os.homedir(), …)` while
// install.js / uninstall.js / statusline-adopt.js called this function, so the
// same directory had three authorities (audit-2026-08-22 条目 13). `home()`
// rather than `os.homedir()` for the same reason the rest of this file uses it:
// tests redirect HOME.
//
// SCOPE, stated because the first version of this comment overstated it
// (v0.69.0 pre-tag review): the seam is now ONE function instead of three, and
// it reaches every JS caller. It does NOT reach the bash hooks — they resolve
// `STATE_DIR="$HOME/.claude/.claudemd-state"` directly, and they are what
// writes every ephemeral class the reapers delete (ext-read-*, vocab-scan-*,
// failopen-*, session-start-<sid>.ref, tmp-baseline-<sid>.txt,
// session-summary-<sid>.lastrun). Redirect this variable and you still get a
// directory no hook has written to; redirect HOME and you get both sides.
// Anything that recursively DELETES the result must not trust it blindly —
// see the basename guard on uninstall.js's --purge path.
export const stateDir          = () => process.env.CLAUDEMD_STATE_DIR || path.join(home(), '.claude/.claudemd-state');
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
// SINGLE SOURCE for the shipped spec set. It existed four times — install.js,
// update.js, lib/spec-hash.js and the specHome() list right below — with no
// join, so a fifth spec file would have been installed by one of them and
// ignored by the others (2026-08-29 audit R10-17b). This leaf module is the
// right home: all three consumers already import from it, so nothing gains a
// dependency, and spec-hash.js's stated reason for its own copy ("no
// install-side dependency") is satisfied without one.
//
// Order is load-bearing for specHome(): CLAUDE.md first, because install.js
// and backup.js both treat element 0 as the canonical user-facing file.
export const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md'];
export const specHome          = () => SPEC_FILES.map(n => path.join(home(), '.claude', n));
// Address a single home-spec file by basename. Decoupled from backupRoot()
// (which happens to share the same dir today) so that a future relocation
// of backups does not silently break update.js's home-spec read path.
export const homeSpec          = (name) => path.join(home(), '.claude', name);

// SINGLE SOURCE for every JSON file this plugin writes into the user's home
// (2026-09-02 audit R11-01/R11-10). The tmp+rename idiom had three hand-copied
// forms — settings-merge.js, statusline-hosts.js, and a plain non-atomic
// writeFileSync for the manifest — and the settings.json one dropped two
// properties of the file it replaced:
//
//   MODE:    `writeFileSync(tmp)` creates with 0666 & ~umask, so a 0600
//            settings.json came back 0664 on a umask-002 box. That file's `env`
//            block is where users keep ANTHROPIC_API_KEY.
//   SYMLINK: `rename(tmp, p)` replaces a symlink with a regular file, so a
//            `~/.claude/settings.json -> dotfiles/settings.json` setup silently
//            detached and the dotfiles copy froze on old content.
//
// So: resolve through the link FIRST (write beside the real target, since
// rename() cannot cross filesystems), then carry the existing mode forward.
// An explicit `mode` wins; a file that does not exist yet gets the default.
// chmod after write because writeFileSync's mode is still masked by umask.
export function writeJsonAtomic(p, data, { mode } = {}) {
  let real = p;
  try { real = fs.realpathSync(p); } catch { /* new file — write at p itself */ }

  let fileMode = mode;
  if (fileMode === undefined) {
    try { fileMode = fs.statSync(real).mode & 0o777; } catch { /* new file — inherit default */ }
  }

  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    if (fileMode !== undefined) fs.chmodSync(tmp, fileMode);
    fs.renameSync(tmp, real);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw e;
  }
}

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

// CC encodes a project cwd → the `~/.claude/projects/<dir>` directory name by
// replacing EVERY non-[a-zA-Z0-9-] char with '-'. This is the single JS source
// for that transform and MUST stay identical to the production hooks'
// `hook_encode_project` (hooks/lib/rule-hits.sh — character-wise bash loop);
// a JS-side encoder that locates a transcript/project dir the hooks wrote has
// to agree byte-for-byte or it silently points at a non-existent dir. The
// narrow `/[/._]/g` form (abandoned in the hooks) leaves spaces/+/@/()
// untouched and mis-locates any such cwd. The identity is PINNED by a
// cross-language parity test (tests/hooks/rule-hits.test.sh ARCH-2, CJK +
// accented + specials fixtures) — pre-2026-07-17 the bash side was `tr -c`
// (byte-wise) and every CJK char diverged (1 dash here, 3 there). Known
// residual: non-BMP chars (emoji) — this replace counts UTF-16 code units
// (2 dashes), the bash loop counts codepoints (1 dash); no real project
// path hits this.
export function encodeProjectCwd(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9-]/g, '-');
}

// Claude Code's per-project transcript root, and the per-project dir inside it.
// The ENCODER was single-sourced by the 2026-07-15 audit; the DIRECTORY it feeds
// was still rebuilt from a `.claude/projects` literal in five call sites
// (sampling-audit ×2, lesson-bypass-audit ×2, memory-maintenance), so a change to
// the layout had five places to miss. `home` is injectable for tests.
export function projectsRoot(home = os.homedir()) {
  return path.join(home, '.claude', 'projects');
}

// Encoded per-project dir. Pass an already-encoded name through `encoded`
// (rule-hits rows carry one) or a raw cwd through `cwd`.
export function projectDir({ cwd, encoded, home = os.homedir() } = {}) {
  const name = encoded !== undefined ? encoded : encodeProjectCwd(cwd);
  return path.join(projectsRoot(home), name);
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
