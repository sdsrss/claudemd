import fs from 'node:fs';
import path from 'node:path';
import { homeSpec, resolvePluginRoot } from './lib/paths.js';
import { diffSpec } from './lib/spec-diff.js';
import { createBackup, pruneBackups } from './lib/backup.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

const UPDATE_USAGE = `Usage: node scripts/update.js

Sync ~/.claude/CLAUDE*.md with the plugin-cache shipped spec. Read-only by
default (shows diffs); set CLAUDEMD_UPDATE_CHOICE=apply to write.

No flags. Behavior is read from the following env vars:
  CLAUDEMD_UPDATE_CHOICE  cancel (default — diff-only) | apply

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

  const targets = SPEC_FILES.filter(n => diffs.find(d => d.file === n && (d.added > 0 || d.removed > 0)));

  if (targets.length === 0) {
    return { applied: false, diffs, reason: 'no changes to apply' };
  }

  const existing = targets.map(n => homeSpec(n)).filter(fs.existsSync);
  const { dir: backupDir } = createBackup(existing, { label: 'backup' });
  pruneBackups(5);

  for (const name of targets) {
    fs.copyFileSync(path.join(pluginRoot, 'spec', name), homeSpec(name));
  }

  return { applied: true, backupDir, diffs, targets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  printHelpAndExit(process.argv.slice(2), UPDATE_USAGE);
  // No argv contract — update reads from env. Loud-fail on unknown flags.
  try {
    parseStrict(process.argv.slice(2), {});
  } catch (e) {
    if (e instanceof ArgvError) { console.error(e.message); process.exit(2); }
    throw e;
  }
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const choice = process.env.CLAUDEMD_UPDATE_CHOICE || 'cancel';
  update({ pluginRoot, choice }).then(r => console.log(JSON.stringify(r, null, 2)));
}
