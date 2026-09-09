import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const home = () => process.env.HOME || os.homedir();

// The whole plugin cache — every marketplace, every plugin. Distinct from
// pluginCacheDir() below, which is the subtree of the marketplace that happens
// to be NAMED `claudemd`: a user may add this marketplace under any name, so
// `cache/<their-name>/claudemd/<version>` is an equally valid install location.
// cache-prune.js's delete guard deliberately keeps the narrower path.
export const pluginsCacheRoot = () => path.join(home(), '.claude/plugins/cache');
export const pluginCacheDir = () => path.join(home(), '.claude/plugins/cache/claudemd');
// The marketplace CLONE — `git fetch` lands here on `/plugin marketplace
// update`. NOT the hook root: Claude Code copies marketplace plugins into the
// versioned cache and runs them from there, so this directory can be several
// commits ahead of the code that actually executes. Use activePluginRoot()
// for anything that means "what CC runs"; this one is only the upstream side
// of that comparison.
//
// Also note it exists ONLY for `source: github` marketplaces. A marketplace
// added from a local path or a git path is recorded with `installLocation`
// pointing at that path itself and no clone is made here at all.
export const marketplacePluginRoot = () => path.join(home(), '.claude/plugins/marketplaces/claudemd');
export const installedPluginsPath = () => path.join(home(), '.claude/plugins/installed_plugins.json');
export const knownMarketplacesPath = () => path.join(home(), '.claude/plugins/known_marketplaces.json');
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
export const stateDir = () => process.env.CLAUDEMD_STATE_DIR || path.join(home(), '.claude/.claudemd-state');
// Manifest lives outside stateDir so that `rm -rf ~/.claude/.claudemd-state/`
// — which a user might run to reset residue-audit / sandbox-disposal baselines
// — does not also erase the install manifest. Pre-0.1.9 manifests lived at
// `stateDir()/installed.json`; any claudemd script that reads the manifest
// calls `readManifest()` (below), which transparently relocates legacy files
// on first touch.
export const manifestPath = () => path.join(home(), '.claude/.claudemd-manifest.json');
export const legacyManifestPath = () => path.join(stateDir(), 'installed.json');
export const logsDir = () => path.join(home(), '.claude/logs');
export const settingsPath = () => path.join(home(), '.claude/settings.json');
// code-graph's composite statusline registry — primary in ~/.cache (volatile)
// + durable mirror in ~/.claude (code-graph self-heals the primary from it).
// claudemd registers itself as a guest provider here rather than clobbering the
// single statusLine slot. Both are code-graph-owned; we read/write our own entry.
export const codeGraphRegistryPath = () => path.join(home(), '.cache/code-graph/statusline-registry.json');
export const codeGraphProvidersBackupPath = () => path.join(home(), '.claude/statusline-providers.json');
export const backupRoot = () => path.join(home(), '.claude');
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
export const specHome = () => SPEC_FILES.map(n => path.join(home(), '.claude', n));
// Address a single home-spec file by basename. Decoupled from backupRoot()
// (which happens to share the same dir today) so that a future relocation
// of backups does not silently break update.js's home-spec read path.
export const homeSpec = name => path.join(home(), '.claude', name);

// ~/.claude itself, for files that are neither a spec nor a backup — the
// statusline renderer this plugin installs, for one. It used to reach for
// homeSpec(), whose stated reason for existing is that a future relocation of
// the BACKUP root must not silently move the spec read path; borrowing it for a
// shell script means a later change made for spec reasons quietly moves the
// renderer too (audit R11-30).
export const claudeHome = (...parts) => path.join(home(), '.claude', ...parts);

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
  try {
    real = fs.realpathSync(p);
  } catch {
    // realpathSync throws on a DANGLING symlink too — a dotfiles target that
    // has not been checked out yet — and falling through to `p` would then let
    // the rename replace the link with a regular file, which is the exact case
    // this function exists to prevent (0.71.4 pre-tag review). Resolve the link
    // by hand; if p is simply absent, write at p.
    try {
      if (fs.lstatSync(p).isSymbolicLink()) {
        // Resolve the relative target against the REAL parent, not the lexical
        // one (Round-14 audit SCR-M2). path.resolve collapses `..` as text; the
        // kernel walks it from the directory the path actually lands in, and
        // the two disagree the moment an ancestor is itself a symlink —
        // `~/.claude -> ~/config/claude`, the synced-dotfiles shape this whole
        // branch exists for. Pre-fix the write landed at whatever sat at the
        // lexical path (a different file, or nothing — the link stayed
        // dangling), so toggle.js reported the kill-switch set and it was not.
        // backup.js#createBackup was given this exact repair in 0.76.2 and this
        // second site was missed.
        let base = path.dirname(p);
        try {
          base = fs.realpathSync(base);
        } catch {
          /* unreadable ancestor — keep the lexical parent, no worse than before */
        }
        real = path.resolve(base, fs.readlinkSync(p));
      }
    } catch {
      /* not a symlink and not present — new file at p */
    }
  }

  let fileMode = mode;
  if (fileMode === undefined) {
    try {
      fileMode = fs.statSync(real).mode & 0o777;
    } catch {
      /* new file — inherit default */
    }
  }

  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.tmp-${process.pid}`;
  try {
    // `mode` on writeFileSync is passed to open(2), so the file is created no
    // more permissive than the target (umask can only clear bits further).
    // Without it the payload sat at 0664 between write and chmod — and for
    // settings.json that payload is the user's `env` block (0.71.4 pre-tag
    // review measured the window on a real 0600 file). The chmod still follows,
    // to force the exact bits back past umask.
    fs.writeFileSync(
      tmp,
      JSON.stringify(data, null, 2) + '\n',
      fileMode !== undefined ? { mode: fileMode } : undefined
    );
    if (fileMode !== undefined) fs.chmodSync(tmp, fileMode);
    fs.renameSync(tmp, real);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
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
      return {
        exists: true,
        path: newPath,
        data: JSON.parse(fs.readFileSync(newPath, 'utf8')),
        migrated: false,
      };
    } catch {
      return { exists: true, path: newPath, data: null, migrated: false };
    }
  }
  const oldPath = legacyManifestPath();
  if (fs.existsSync(oldPath)) {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    } catch {
      /* fall through */
    }
    if (data) {
      try {
        // Atomic (R11-34): a bare write followed by unlinking the source can
        // leave a half-written manifest AND no legacy file — readManifest's own
        // catch then returns data:null, callers read that as "not installed",
        // and another install spawns.
        writeJsonAtomic(newPath, data);
        fs.unlinkSync(oldPath);
      } catch {
        /* best-effort migration; leave legacy in place on FS error */
      }
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

// The directory Claude Code resolves ${CLAUDE_PLUGIN_ROOT} to when it fires our
// hooks — i.e. the code that ACTUALLY RUNS. Per the plugins reference: "Absolute
// path to the plugin's installation directory", and marketplace plugins are
// copied into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` rather
// than used in place.
//
// This function exists because three doctor checks used to reach for
// marketplacePluginRoot() instead, on a comment that called it the hook root.
// It is not, and the gap is not cosmetic — it inverts the checks in the one
// state they were written for. `/plugin marketplace update` advances the clone
// while the cache keeps serving the old version (verified: a no-version-bump
// change reaches the clone and `claude plugin update` then reports "already at
// the latest version"), so source and clone agree, the drift check reports
// "match", and the stale hooks it was meant to catch keep running. The reverse
// miss is just as real: for a marketplace added from a local or git PATH no
// clone is ever created, so both checks skipped permanently.
//
// Resolution order, most authoritative first:
//   1. installed_plugins.json — what CC itself recorded at install/update time.
//   2. newest semver dir in the plugin cache — correct whenever (1) is absent
//      or predates the plugin (bootstrap-pending, hand-managed cache).
//   3. the marketplace clone — pre-cache layouts kept the plugin there.
// Returns { root, source }; root is null when nothing resolves, so callers can
// report the reason instead of comparing against a path that never existed.
export function activePluginRoot() {
  try {
    const data = JSON.parse(fs.readFileSync(installedPluginsPath(), 'utf8'));
    // Keyed `<plugin>@<marketplace>`; the marketplace half is whatever name the
    // user added it under, so match on the plugin half only.
    const entries = [];
    for (const [id, list] of Object.entries(data?.plugins ?? {})) {
      if (id.split('@')[0] !== 'claudemd') continue;
      for (const e of Array.isArray(list) ? list : []) {
        if (e && typeof e.installPath === 'string') entries.push(e);
      }
    }
    // Newest version wins when the plugin is installed at several scopes.
    //
    // A TOTAL order, not the mixed comparator this first shipped with (v0.84.0
    // pre-ship review, L5): `semverCmp` for semver pairs and `localeCompare`
    // otherwise is not transitive, and Array.sort on a non-total order may
    // return an arbitrary permutation rather than merely an imperfect one. Rank
    // semver-shaped versions above unparseable ones, compare within each class,
    // and fall back to the installPath so equal versions still order
    // deterministically across runs.
    entries.sort((a, b) => {
      const av = String(a.version ?? '');
      const bv = String(b.version ?? '');
      const as = SEMVER_RE.test(av);
      const bs = SEMVER_RE.test(bv);
      if (as !== bs) return as ? 1 : -1;
      if (as && bs) {
        const c = semverCmp(av, bv);
        if (c !== 0) return c;
      } else {
        const c = av.localeCompare(bv);
        if (c !== 0) return c;
      }
      return String(a.installPath).localeCompare(String(b.installPath));
    });
    // Existence alone is not enough, so both gates apply (the shape-vs-location
    // distinction cache-prune.js already had to learn): installPath is an
    // ABSOLUTE path recorded when the plugin was installed, so a home that was
    // copied, moved or restored from a backup carries a record pointing into
    // the OTHER tree — which usually still exists, so an existence check passes
    // and every drift comparison below silently runs against a stranger's
    // plugin. Constrain it to this home's cache; a record outside it is stale by
    // construction, and the cache scan underneath resolves the real one.
    const cacheRoot = pluginsCacheRoot() + path.sep;
    for (let i = entries.length - 1; i >= 0; i--) {
      const p = entries[i].installPath;
      if (p.startsWith(cacheRoot) && fs.existsSync(p)) {
        return { root: p, source: 'installed-plugins' };
      }
    }
  } catch {
    /* absent or unparseable — fall through to the cache scan */
  }

  // Marketplace-agnostic, for the same reason the guard above is: the cache is
  // keyed by the name the user added the marketplace under, so scanning only
  // `cache/claudemd/claudemd/` finds nothing for anyone who named it otherwise.
  try {
    const cacheRoot = pluginsCacheRoot();
    let best = null;
    for (const mkt of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!mkt.isDirectory()) continue;
      const base = path.join(cacheRoot, mkt.name, 'claudemd');
      let versions;
      try {
        versions = fs.readdirSync(base, { withFileTypes: true });
      } catch {
        continue; // this marketplace does not carry claudemd
      }
      for (const v of versions) {
        if (!v.isDirectory() || !SEMVER_RE.test(v.name)) continue;
        if (best === null || semverCmp(v.name, best.version) > 0) {
          best = { version: v.name, root: path.join(base, v.name) };
        }
      }
    }
    if (best) return { root: best.root, source: 'plugin-cache' };
  } catch {
    /* no cache dir — fall through to the clone */
  }

  const mkt = marketplacePluginRoot();
  if (fs.existsSync(mkt)) return { root: mkt, source: 'marketplace-clone' };
  return { root: null, source: 'none' };
}

// The tree a REINSTALL would copy from — the upstream side of the drift the
// cache can suffer. Distinct from activePluginRoot() and needed alongside it:
// `/claudemd-doctor` runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js`, so for
// an end user doctor's own PLUGIN_ROOT *is* the active root and comparing the
// two is a self-compare that can never report anything. Their drift axis is
// "what I run" vs "what the marketplace now holds", and it is a live state:
// `/plugin marketplace update` advances the marketplace on its own, and a change
// carrying no version bump then leaves `claude plugin update` reporting
// "already at the latest version" with the new code sitting upstream, unused.
//
// Resolution: which marketplace owns claudemd (installed_plugins.json keys are
// `<plugin>@<marketplace>`) → where that marketplace lives
// (known_marketplaces.json `installLocation`, which is the clone for a `github`
// source and the user's own directory for a `directory` one) → where the plugin
// sits inside it (its marketplace.json entry's `source`, `./` for this plugin).
// Every step falls back rather than guessing, and the last fallback is the
// historical hardcoded clone path.
export function upstreamPluginRoot() {
  let marketplace = null;
  try {
    const data = JSON.parse(fs.readFileSync(installedPluginsPath(), 'utf8'));
    // Resolve the marketplace that owns the install activePluginRoot() ACTUALLY
    // PICKED, not whichever `claudemd@*` key happens to come first (v0.84.0
    // pre-ship review, L4). With claudemd installed from two marketplaces the
    // two resolvers otherwise disagree, and `hook-drift:upstream` compares
    // marketplace A's cache against marketplace B's clone — a diff between two
    // unrelated trees, reported as if it were staleness.
    const active = activePluginRoot().root;
    let fallback = null;
    for (const [id, list] of Object.entries(data?.plugins ?? {})) {
      const at = id.indexOf('@');
      if (at <= 0 || id.slice(0, at) !== 'claudemd') continue;
      const name = id.slice(at + 1);
      if (fallback === null) fallback = name;
      if (active && (Array.isArray(list) ? list : []).some(e => e?.installPath === active)) {
        marketplace = name;
        break;
      }
    }
    if (marketplace === null) marketplace = fallback;
  } catch {
    /* fall through to the hardcoded clone */
  }

  let location = null;
  try {
    const known = JSON.parse(fs.readFileSync(knownMarketplacesPath(), 'utf8'));
    const entry = marketplace ? known?.[marketplace] : null;
    if (entry && typeof entry.installLocation === 'string') location = entry.installLocation;
  } catch {
    /* fall through */
  }
  if (!location || !fs.existsSync(location)) {
    const mkt = marketplacePluginRoot();
    return fs.existsSync(mkt) ? { root: mkt, source: 'marketplace-clone' } : { root: null, source: 'none' };
  }

  // `source` may also be an object (a remote the marketplace points at), which
  // is not a directory on this machine and so not comparable — treat it as no
  // upstream rather than joining an object onto a path.
  let rel = './';
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(location, '.claude-plugin/marketplace.json'), 'utf8'));
    const plugin = (cat?.plugins ?? []).find(p => p?.name === 'claudemd');
    if (plugin && typeof plugin.source === 'string') rel = plugin.source;
    else if (plugin && plugin.source !== undefined) return { root: null, source: 'none' };
  } catch {
    /* no catalog to read — assume the marketplace root is the plugin root */
  }
  const root = path.resolve(location, rel);
  return fs.existsSync(root) ? { root, source: 'marketplace' } : { root: null, source: 'none' };
}
