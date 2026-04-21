import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { stateDir, logsDir, settingsPath, specHome } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';

export async function doctor({ pruneBackups: prune } = {}) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const manifestPath = path.join(stateDir(), 'installed.json');
  push('manifest', fs.existsSync(manifestPath),
    fs.existsSync(manifestPath) ? 'present' : 'missing — is plugin installed?');

  if (fs.existsSync(settingsPath())) {
    try { readSettings(); push('settings.json', true, 'parseable'); }
    catch (e) { push('settings.json', false, e.message); }
  } else {
    push('settings.json', false, 'missing');
  }

  for (const p of specHome()) {
    push(`spec:${path.basename(p)}`, fs.existsSync(p),
      fs.existsSync(p) ? 'present' : 'missing');
  }

  const which = (bin) => {
    try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  push('jq', which('jq'), which('jq') ? 'present' : 'missing (required at runtime)');
  push('gh', which('gh'), which('gh') ? 'present' : 'missing (ship-baseline will fail-open silent)');

  const backups = listBackups();
  push('backups', true, `${backups.length} backup dir(s)`);

  const logPath = path.join(logsDir(), 'claudemd.jsonl');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  push('logs', true, `${logLines} rule-hits row(s)`);

  const pruned = prune != null ? pruneBackups(prune) : [];

  return { checks, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const pruneArg = args.find(a => a.startsWith('--prune-backups='));
  const prune = pruneArg ? parseInt(pruneArg.split('=')[1], 10) : undefined;
  doctor({ pruneBackups: prune }).then(r => console.log(JSON.stringify(r, null, 2)));
}
