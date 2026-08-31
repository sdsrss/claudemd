import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homeSpec, SPEC_FILES } from './paths.js';

// Spec files shipped under <pluginRoot>/spec/ and installed at ~/.claude/<name>.
// Imported from lib/paths.js (2026-08-29 audit R10-17b) — this used to be a
// hand-copy justified by "no install-side dependency", but paths.js is a leaf
// this module already imports, so the single source costs nothing and a fifth
// spec file can no longer be installed by one consumer and ignored by another.

export function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Returns one row per spec file with shipped + installed hashes and a
// match/missing summary. Detects local drift (user/process modified
// ~/.claude/CLAUDE.md after install) AND post-upgrade staleness (plugin
// upgraded, spec not re-synced via /claudemd-update). Does NOT cover
// supply-chain integrity — that's the marketplace/npm signature layer.
export function compareSpecs(pluginRoot) {
  return SPEC_FILES.map(name => {
    const shipped = sha256File(path.join(pluginRoot, 'spec', name));
    const installed = sha256File(homeSpec(name));
    return {
      name,
      shipped,
      installed,
      match: shipped !== null && installed !== null && shipped === installed,
      missing: shipped === null || installed === null,
    };
  });
}
