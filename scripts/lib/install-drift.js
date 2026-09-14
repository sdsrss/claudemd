import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './spec-hash.js';

// compareHooks(sourceRoot, marketRoot)
//
// Surfaces the silent-drift class where the source-of-truth plugin tree
// (the dev's git repo or the active <pluginRoot>) has shipped newer hook
// scripts than what's actually wired up at ~/.claude/plugins/marketplaces/
// claudemd/. Symptom: HARD rules silently no-op in production because
// /plugin update is a silent no-op (memory: reference_plugin_update_manual_refresh.md).
// Detection axis: SHA-256 of every hook .sh under hooks/. Excludes config
// (.patterns, .json) — that drift is /claudemd-update territory.
//
// Returns:
//   { skipped: bool, skippedReason?: string,
//     driftCount: number,
//     diffs: [{path, reason: 'differs'|'missing-in-market'|'missing-in-source'}] }
//
// Skip cases (not a drift signal):
//   - sourceRoot === marketRoot by realpath: /claudemd-doctor running FROM
//     the marketplace install ends up here. Self-compare always matches.
//   - marketRoot path missing: no marketplace install on this machine
//     (e.g. plugin uninstalled, or claudemd-cli npm package only).
//   - sourceRoot has no hooks/ dir: claudemd-cli npm package ships bin/
//     but no hooks/. Nothing to compare.
export function compareHooks(sourceRoot, marketRoot) {
  if (!fs.existsSync(marketRoot)) {
    return { skipped: true, skippedReason: 'market-root-missing', driftCount: 0, diffs: [] };
  }

  let srcReal, mktReal;
  try {
    srcReal = fs.realpathSync(sourceRoot);
  } catch {
    srcReal = sourceRoot;
  }
  try {
    mktReal = fs.realpathSync(marketRoot);
  } catch {
    mktReal = marketRoot;
  }
  if (srcReal === mktReal) {
    return { skipped: true, skippedReason: 'self-compare', driftCount: 0, diffs: [] };
  }

  const srcHooksDir = path.join(sourceRoot, 'hooks');
  if (!fs.existsSync(srcHooksDir) || !fs.statSync(srcHooksDir).isDirectory()) {
    return { skipped: true, skippedReason: 'no-hooks-in-source', driftCount: 0, diffs: [] };
  }

  // The same question about the OTHER side, which this function asked for two
  // years without answering (round-16 audit 6.6 H-2). Absent this, a marketRoot
  // that exists but carries no hooks/ makes every source script report
  // `missing-in-market` — 19 of them today — and the caller reads a solid red
  // where the truth is "there is nothing here to compare against". Reachable
  // three ways: a hook-root record whose directory was emptied or replaced, a
  // sparse or partial clone, a monorepo marketplace whose catalog entry we
  // could not resolve. doctor.js guarded its upstream call site for exactly
  // this; the running axis had no guard, and that one counts toward exit 3.
  //
  // Asked AFTER the source check so `no-hooks-in-source` keeps priority: the
  // claudemd-cli npm package ships bin/ and no hooks/, and that case wants the
  // reason naming its own side.
  const mktHooksDir = path.join(marketRoot, 'hooks');
  if (!fs.existsSync(mktHooksDir) || !fs.statSync(mktHooksDir).isDirectory()) {
    return { skipped: true, skippedReason: 'no-hooks-in-market', driftCount: 0, diffs: [] };
  }

  const srcFiles = listShellFilesRecursive(srcHooksDir).map(p => path.relative(sourceRoot, p));
  if (srcFiles.length === 0) {
    // Source has hooks/ but no .sh files (e.g., config-only sub-dir or
    // mid-development empty tree). Nothing to compare.
    return { skipped: true, skippedReason: 'no-hooks-in-source', driftCount: 0, diffs: [] };
  }

  const diffs = [];
  for (const rel of srcFiles) {
    const srcHash = sha256File(path.join(sourceRoot, rel));
    const mktPath = path.join(marketRoot, rel);
    const mktHash = sha256File(mktPath);
    if (mktHash === null) {
      diffs.push({ path: rel, reason: 'missing-in-market' });
    } else if (mktHash !== srcHash) {
      diffs.push({ path: rel, reason: 'differs' });
    }
  }

  // Reverse direction (2026-07-26 audit): a hook present in the marketplace root
  // but absent from source is exactly what a RETIRED hook leaves behind — the
  // shape v0.57.0 created by deleting mid-spine-yield-scan. Iterating source only
  // meant that residue never surfaced as drift.
  const srcSet = new Set(srcFiles);
  for (const abs of listShellFilesRecursive(path.join(marketRoot, 'hooks'))) {
    const rel = path.relative(marketRoot, abs);
    if (!srcSet.has(rel)) diffs.push({ path: rel, reason: 'missing-in-source' });
  }

  return { skipped: false, driftCount: diffs.length, diffs };
}

function listShellFilesRecursive(dir) {
  const out = [];
  // A missing dir is "no files", not an error: the reverse-direction scan calls
  // this on the marketplace root, which legitimately has no hooks/ in a
  // partial-install or test sandbox.
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listShellFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith('.sh')) {
      out.push(full);
    }
  }
  return out;
}
