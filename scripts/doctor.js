import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { logsDir, settingsPath, specHome, readManifest } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';

export async function doctor({ pruneBackups: prune } = {}) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  const m = readManifest();
  push('manifest', m.exists && m.data != null,
    m.exists && m.data != null
      ? (m.migrated ? `present at ${m.path} (relocated from pre-0.1.9 state dir)` : 'present')
      : 'missing — is plugin installed?');

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
  const logExists = fs.existsSync(logPath);
  const logBytes = logExists ? fs.statSync(logPath).size : 0;
  const logLines = logExists
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  const logMB = (logBytes / (1024 * 1024)).toFixed(1);
  // 5MB is well past normal daily usage — audit.js reads the whole file into
  // memory, so oversized logs slow /claudemd-audit and eat RAM. No auto-rotate;
  // just surface so the user can truncate deliberately.
  const LOG_WARN_MB = 5;
  const logOk = logBytes < LOG_WARN_MB * 1024 * 1024;
  push('logs', logOk,
    logOk
      ? `${logLines} rule-hits row(s), ${logMB} MB`
      : `${logLines} rule-hits row(s), ${logMB} MB — exceeds ${LOG_WARN_MB} MB; truncate ~/.claude/logs/claudemd.jsonl`);

  const pruned = prune != null ? pruneBackups(prune) : [];

  return { checks, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const pruneArg = args.find(a => a.startsWith('--prune-backups='));
  let prune;
  if (pruneArg) {
    const raw = pruneArg.split('=')[1];
    const val = parseInt(raw, 10);
    if (!Number.isInteger(val) || val < 1) {
      console.error(
        `--prune-backups requires a positive integer retain count (got '${raw}').\n` +
        `  Examples: --prune-backups=5 (keep 5 newest), --prune-backups=1 (keep only the newest).\n` +
        `  To remove ALL backups, delete ~/.claude/backup-* manually — this flag cannot do that.`
      );
      process.exit(1);
    }
    prune = val;
  }
  doctor({ pruneBackups: prune }).then(r => console.log(JSON.stringify(r, null, 2)));
}
