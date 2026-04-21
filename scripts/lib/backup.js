import fs from 'node:fs';
import path from 'node:path';
import { backupRoot } from './paths.js';

function isoStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+Z$/, 'Z');
}

export function createBackup(files, { label = 'backup' } = {}) {
  const dir = path.join(backupRoot(), `${label}-${isoStamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  const movedFiles = [];
  for (const src of files) {
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, path.basename(src));
    fs.renameSync(src, dest);
    movedFiles.push(dest);
  }
  return { dir, movedFiles };
}

export function listBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(name => /^backup-\d{8}T\d{6}Z$/.test(name))
    .map(name => ({
      dir: path.join(root, name),
      iso: name.replace(/^backup-/, ''),
      size: dirSize(path.join(root, name)),
    }))
    .sort((a, b) => b.iso.localeCompare(a.iso));
}

export function pruneBackups(retainCount = 5) {
  const backups = listBackups();
  const removed = [];
  for (const b of backups.slice(retainCount)) {
    fs.rmSync(b.dir, { recursive: true, force: true });
    removed.push(b.dir);
  }
  return removed;
}

export function restoreBackup(backupDir, targetRoot) {
  const restored = [];
  for (const name of fs.readdirSync(backupDir)) {
    const src = path.join(backupDir, name);
    const dest = path.join(targetRoot, name);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      restored.push(dest);
    }
  }
  return restored;
}

function dirSize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    total += stat.isFile() ? stat.size : 0;
  }
  return total;
}
