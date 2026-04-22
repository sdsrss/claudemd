// Line-level diff summary used by /claudemd-update.
// Uses longest-common-subsequence so reordered content shows nonzero delta
// (Set-based diff hid reorders as 0/0, misleading users about what apply-all
// would actually overwrite).

function lcsLength(a, b) {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[n];
}

export function diffSpec(a, b) {
  const aLines = (a || '').split('\n');
  const bLines = (b || '').split('\n');
  const common = lcsLength(aLines, bLines);
  return { added: bLines.length - common, removed: aLines.length - common };
}

export function summarizeDiff(perFile) {
  return perFile.map(f => `  ${f.file}: +${f.added} / -${f.removed}`).join('\n');
}
