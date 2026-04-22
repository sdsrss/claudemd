import fs from 'node:fs';
import path from 'node:path';
import { backupRoot, resolvePluginRoot } from './lib/paths.js';
import { diffSpec } from './lib/spec-diff.js';
import { createBackup, pruneBackups } from './lib/backup.js';

const SPEC_FILES = ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md'];

export async function update({ pluginRoot, choice = 'cancel' } = {}) {
  if (!pluginRoot) throw new Error('update: pluginRoot missing');

  const diffs = [];
  for (const name of SPEC_FILES) {
    const homeFile = path.join(backupRoot(), name);
    const pluginFile = path.join(pluginRoot, 'spec', name);
    const homeText = fs.existsSync(homeFile) ? fs.readFileSync(homeFile, 'utf8') : '';
    const pluginText = fs.existsSync(pluginFile) ? fs.readFileSync(pluginFile, 'utf8') : '';
    const d = diffSpec(homeText, pluginText);
    diffs.push({ file: name, ...d });
  }

  if (choice === 'cancel') return { applied: false, diffs };
  if (choice !== 'apply-all') throw new Error(`unknown choice: ${choice}`);

  const targets = SPEC_FILES.filter(n => diffs.find(d => d.file === n && (d.added > 0 || d.removed > 0)));

  if (targets.length === 0) {
    return { applied: false, diffs, reason: 'no changes to apply' };
  }

  const existing = targets.map(n => path.join(backupRoot(), n)).filter(fs.existsSync);
  const { dir: backupDir } = createBackup(existing, { label: 'backup' });
  pruneBackups(5);

  for (const name of targets) {
    fs.copyFileSync(path.join(pluginRoot, 'spec', name), path.join(backupRoot(), name));
  }

  return { applied: true, backupDir, diffs, targets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const choice = process.env.CLAUDEMD_UPDATE_CHOICE || 'cancel';
  update({ pluginRoot, choice }).then(r => console.log(JSON.stringify(r, null, 2)));
}
