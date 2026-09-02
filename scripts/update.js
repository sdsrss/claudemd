import fs from 'node:fs';
import path from 'node:path';
import { homeSpec, resolvePluginRoot, SPEC_FILES } from './lib/paths.js';
import { diffSpec } from './lib/spec-diff.js';
import { copySpecFiles } from './lib/spec-hash.js';
import { createBackup, pruneBackups, BACKUP_LABELS } from './lib/backup.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const UPDATE_USAGE = `Usage: node scripts/update.js

Sync ~/.claude/CLAUDE*.md with the plugin-cache shipped spec. Read-only by
default (shows diffs); set CLAUDEMD_UPDATE_CHOICE=apply-all to write.

No flags. Behavior is read from the following env vars:
  CLAUDEMD_UPDATE_CHOICE  cancel (default — diff-only) | apply-all

Options:
  --help, -h     Print this message and exit.

Exit codes: 0 success | 2 argv-shape error.`;

export async function update({ pluginRoot, choice = 'cancel' } = {}) {
  if (!pluginRoot) throw new Error('update: pluginRoot missing');

  const diffs = [];
  for (const name of SPEC_FILES) {
    const homeFile = homeSpec(name);
    const pluginFile = path.join(pluginRoot, 'spec', name);
    const homeText = fs.existsSync(homeFile) ? fs.readFileSync(homeFile, 'utf8') : '';
    const pluginText = fs.existsSync(pluginFile) ? fs.readFileSync(pluginFile, 'utf8') : '';
    const d = diffSpec(homeText, pluginText);
    diffs.push({ file: name, ...d });
  }

  if (choice === 'cancel') return { applied: false, diffs };
  // Per-file select is intentionally not supported — spec trio evolves
  // lockstep (CLAUDE.md H1 is the canonical version; §EXT cross-references
  // would dangle if only some files updated). Choices: 'apply-all' | 'cancel'.
  if (choice !== 'apply-all') {
    throw new Error(
      `unknown choice: ${choice}. Valid: 'apply-all' | 'cancel'. ` +
        `Spec trio is lockstep; per-file select is not supported.`
    );
  }

  // Same fail-before-touch contract install.js:129 has carried since the
  // 2026-07-12 audit (SCRIPT-1) — it was never copied to this second entry
  // point (2026-08-29 audit R10-02). Without it a truncated plugin cache reads
  // as `pluginText === ''`, so diffSpec reports the whole file as removed and
  // the missing file becomes a *target*: createBackup renameSync-moves every
  // home spec away, the first copyFileSync of a present file lands, and the
  // copy of the absent one throws ENOENT — leaving ~/.claude with a partially
  // upgraded, partially empty spec set. Exactly the lockstep violation the
  // comment above forbids, and the shape a sandbox probe reproduced (cache
  // missing 2/4 → exit 1, two files new, two only in spec-backup-*).
  //
  // Checked over ALL SPEC_FILES, not just `targets`: a plugin file that is
  // missing while its home twin happens to be byte-identical-to-empty would
  // not be a target, and skipping it silently would leave that one file at the
  // old version while its siblings advance — the same mixed-version state by a
  // quieter route.
  const missingSpecs = SPEC_FILES.filter(n => !fs.existsSync(path.join(pluginRoot, 'spec', n)));
  if (missingSpecs.length > 0) {
    throw new Error(
      `update: shipped spec missing in ${pluginRoot}/spec/: ${missingSpecs.join(', ')}. ` +
        `Plugin cache is incomplete — re-run \`/plugin install claudemd@claudemd\` or ` +
        `re-clone from https://github.com/sdsrss/claudemd.`
    );
  }

  const targets = SPEC_FILES.filter(n => diffs.find(d => d.file === n && (d.added > 0 || d.removed > 0)));

  if (targets.length === 0) {
    return { applied: false, diffs, reason: 'no changes to apply' };
  }

  const existing = targets.map(n => homeSpec(n)).filter(fs.existsSync);
  // Own namespace, not install.js's `backup-` (audit-2026-08-22 P1-1). Sharing
  // it made every update push a spec-only backup on top of the user's personal
  // CLAUDE.md backup: `CLAUDEMD_SPEC_ACTION=restore` reads listBackups()[0] and
  // returned the old SPEC, and five updates pruned the personal content away.
  // Rotation still applies — within this namespace only.
  const { dir: backupDir } = createBackup(existing, { label: BACKUP_LABELS.spec });
  pruneBackups(5, { label: BACKUP_LABELS.spec });

  // Shared with install.js (R11-09): verifies each copy's sha256 and, because
  // createBackup already renamed the originals away, restores all of them from
  // the backup dir on any failure rather than leaving a half-written spec.
  copySpecFiles(pluginRoot, targets, { backupDir });

  return { applied: true, backupDir, diffs, targets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), UPDATE_USAGE);
  // No argv contract — update reads from env. Loud-fail on unknown flags.
  try {
    parseStrict(process.argv.slice(2), {});
  } catch (e) {
    if (e instanceof ArgvError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const choice = process.env.CLAUDEMD_UPDATE_CHOICE || 'cancel';
  // `.catch` translates env-shape errors (unknown CLAUDEMD_UPDATE_CHOICE) into
  // a one-line stderr + exit 1, mirroring the validation-error contract used by
  // audit.js / sparkline.js. Pre-fix, an unknown choice surfaced as a raw Node
  // promise-rejection stack trace + exit 1 — same exit code but unreadable for
  // users running /claudemd-update with a typo'd env var.
  update({ pluginRoot, choice })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => {
      console.error(e.message);
      process.exit(1);
    });
}
