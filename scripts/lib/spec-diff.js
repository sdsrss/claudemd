export function diffSpec(a, b) {
  const aLines = new Set((a || '').split('\n'));
  const bLines = new Set((b || '').split('\n'));
  let added = 0, removed = 0;
  for (const l of bLines) if (!aLines.has(l)) added++;
  for (const l of aLines) if (!bLines.has(l)) removed++;
  return { added, removed };
}

export function summarizeDiff(perFile) {
  return perFile.map(f => `  ${f.file}: +${f.added} / -${f.removed}`).join('\n');
}
