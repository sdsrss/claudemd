// Recompute PINNED_BLOCKS / HEADING_INVENTORY in tests/scripts/spec-structure.test.js
// from the current spec files (v9.0.0 rewrite). Same hashing as the test.
import fs from 'node:fs';
import crypto from 'node:crypto';
const T = 'tests/scripts/spec-structure.test.js';
const files = { CORE: 'spec/CLAUDE.md', EXT: 'spec/CLAUDE-extended.md' };
const lvl = l => (/^(#{1,6}) /.exec(l) || [, ''])[1].length;
const h = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
function blockFor(lines, idx) {
  let start = idx; while (start >= 0 && lvl(lines[start]) === 0) start--;
  const level = lvl(lines[start]); let end = start + 1;
  while (end < lines.length) { const l = lvl(lines[end]); if (l > 0 && l <= level) break; end++; }
  return lines.slice(start, end).join('\n');
}
const blocks = [], inv = [];
for (const [k, f] of Object.entries(files)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let end = 0; while (end < lines.length && !/^## /.test(lines[end])) end++;
  blocks.push(`  { file: ${k}, heading: '', sha256: '${h(lines.slice(0, end).join('\n'))}' },`);
  lines.forEach((l, i) => { if (/^## /.test(l)) blocks.push(`  { file: ${k}, heading: ${JSON.stringify(l)}, sha256: '${h(blockFor(lines, i))}' },`); });
  const heads = lines.filter(l => /^#{1,6} /.test(l));
  inv.push(`  { file: ${k}, count: ${heads.length}, sha256: '${h(heads.join('\n'))}' },`);
}
let s = fs.readFileSync(T, 'utf8');
const swap = (name, body) => {
  const i = s.indexOf(`const ${name} = [`); const j = s.indexOf('\n];\n', i) + 3;
  s = s.slice(0, i) + `const ${name} = [\n${body.join('\n')}\n];` + s.slice(j);
};
swap('PINNED_BLOCKS', blocks); swap('HEADING_INVENTORY', inv);
fs.writeFileSync(T, s);
console.log(blocks.join('\n')); console.log(inv.join('\n'));
