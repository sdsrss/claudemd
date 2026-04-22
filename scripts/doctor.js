import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logsDir, settingsPath, specHome, readManifest } from './lib/paths.js';
import { listBackups, pruneBackups } from './lib/backup.js';
import { readSettings } from './lib/settings-merge.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  // Live banned-vocab self-test: feed a synthetic event with a known trigger
  // ("significantly") to the shipped hook and assert a deny JSON comes back.
  // Catches drift between `banned-vocab.patterns` and the hook's extraction
  // logic that unit tests (which import the regex or parse the file
  // directly) can silently paper over. Side-effect-free:
  //   - DISABLE_RULE_HITS_LOG=1 suppresses the jsonl append
  //   - both kill-switch vars cleared so the user's env can't make the test
  //     pass by disabling the very check we're verifying
  const hookPath = path.join(PLUGIN_ROOT, 'hooks/banned-vocab-check.sh');
  if (!fs.existsSync(hookPath)) {
    push('banned-vocab self-test', false, `hook missing at ${hookPath}`);
  } else if (!which('jq') || !which('bash')) {
    push('banned-vocab self-test', false, 'prerequisite missing (jq + bash required)');
  } else {
    const event = JSON.stringify({
      session_id: 'doctor-selftest',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "this is significantly better"' },
    });
    const r = spawnSync('bash', [hookPath], {
      input: event,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        DISABLE_RULE_HITS_LOG: '1',
        DISABLE_CLAUDEMD_HOOKS: '',
        DISABLE_BANNED_VOCAB_HOOK: '',
      },
    });
    const denied = r.status === 0 && /"permissionDecision"\s*:\s*"deny"/.test(r.stdout || '');
    push('banned-vocab self-test', denied,
      denied
        ? 'synthetic "significantly" trigger correctly denied'
        : `hook did not deny synthetic trigger (status=${r.status}, stdout="${(r.stdout || '').slice(0, 80).replace(/\s+/g, ' ').trim()}")`);
  }

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
