import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Anchored regexes — names MUST start with the prefix. Defends against
// future fnmatch-style globs that would falsely match `not-claudemd-sync-*`.
const SENTINEL_PATTERN = /^claudemd-sync-/;
const SANDBOX_PATTERN  = /^claudemd-(mockgh|work)\./;

export function scan({ tmpDir = os.tmpdir(), now = Date.now() } = {}) {
  if (!fs.existsSync(tmpDir)) return { sentinels: [], sandboxes: [] };
  let entries;
  try {
    entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return { sentinels: [], sandboxes: [] };
  }
  const sentinels = [];
  const sandboxes = [];
  for (const entry of entries) {
    const full = path.join(tmpDir, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    const ageDays = (now - stat.mtimeMs) / 86400000;
    if (SENTINEL_PATTERN.test(entry.name) && entry.isFile()) {
      sentinels.push({ path: full, ageDays });
    } else if (SANDBOX_PATTERN.test(entry.name) && entry.isDirectory()) {
      sandboxes.push({ path: full, ageDays });
    }
  }
  return { sentinels, sandboxes };
}

export function clean({ tmpDir = os.tmpdir(), apply = false, ageDaysMin = 1, now = Date.now() } = {}) {
  const { sentinels, sandboxes } = scan({ tmpDir, now });
  const targets = [
    ...sentinels.filter(s => s.ageDays >= ageDaysMin),
    ...sandboxes.filter(s => s.ageDays >= ageDaysMin),
  ];
  if (!apply) {
    return { dryRun: true, targets, deleted: 0 };
  }
  let deleted = 0;
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true });
      deleted++;
    } catch { /* best-effort; partial delete is fine */ }
  }
  return { dryRun: false, targets, deleted };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ageArg = args.find(a => a.startsWith('--age-days='));
  const rawAge = ageArg ? ageArg.split('=')[1] : '1';
  const ageDaysMin = Number(rawAge);
  if (!Number.isFinite(ageDaysMin) || ageDaysMin < 0) {
    console.error(`--age-days requires a non-negative number (got '${rawAge}').`);
    process.exit(1);
  }

  const result = clean({ apply, ageDaysMin });
  const sentinelCount = result.targets.filter(t => SENTINEL_PATTERN.test(path.basename(t.path))).length;
  const sandboxCount  = result.targets.filter(t => SANDBOX_PATTERN.test(path.basename(t.path))).length;
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    tmpDir: process.env.TMPDIR || os.tmpdir(),
    ageDaysMin,
    sentinels: sentinelCount,
    sandboxes: sandboxCount,
    deleted: result.deleted,
    paths: result.targets.map(t => ({ path: t.path, ageDays: Math.round(t.ageDays * 10) / 10 })),
  }, null, 2));
}
