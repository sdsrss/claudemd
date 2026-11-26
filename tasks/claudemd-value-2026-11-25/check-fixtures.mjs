// Liveness check for tasks.mjs: each hidden test must FAIL on the untouched
// fixture and PASS after a reference fix. Run: VALUE_SCRATCH=<dir> node check-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TASKS, runHidden, visibleSuite } from './tasks.mjs';

const SCRATCH = process.env.VALUE_SCRATCH;
const sub = (dir, rel, from, to) => {
  const p = path.join(dir, rel);
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`ref fix: ${rel} lacks ${from}`);
  fs.writeFileSync(p, s.split(from).join(to));
};
const REF = {
  K1: d => {
    sub(d, 'src/stock.js', 'row.qty < row.min', 'Number(row.qty) < Number(row.min)');
    sub(d, 'src/reorder.js', 'row.qty <= row.min', 'Number(row.qty) <= Number(row.min)');
  },
  K2: d => {
    sub(d, 'src/users.js', 'cache.set(id, row);\n  return normalize(row);', 'const n = normalize(row);\n  cache.set(id, n);\n  return n;');
    sub(d, 'src/users.js', 'ids.map(id => cache.get(id) ?? db.findUser(id))', 'ids.map(id => getUser(id))');
  },
  K3: d => {
    sub(d, 'src/dates.js', '`${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`', '`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`');
    sub(d, 'src/report.js', "const [m, , y] = formatDate(d).split('/');", "const [y, m] = formatDate(d).split('-');");
  },
  K4: d => sub(d, 'src/slug.js', '.toLowerCase()', ".normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase()"),
  K5: d => {
    sub(d, 'src/money.js', 'export function formatMoney(cents) {', "const SYM = { USD: '$', EUR: '€', GBP: '£' };\nexport function formatMoney(cents, currency = 'USD') {");
    sub(d, 'src/money.js', '`${sign}$${', '`${sign}${SYM[currency]}${');
  },
  K6: d => sub(d, 'src/amount.js', ".replace('$', '')", ".replace(/[$,]/g, '')"),
  K7: d =>
    fs.writeFileSync(
      path.join(d, 'src/versions.js'),
      `const parse = v => { const [core, pre] = v.split('+')[0].split(/-(.*)/s); return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }; };
const isNum = s => /^\\d+$/.test(s);
export function compareSemver(a, b) {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  if (!A.pre.length || !B.pre.length) return A.pre.length === B.pre.length ? 0 : A.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1; if (y === undefined) return 1;
    if (x === y) continue;
    if (isNum(x) && isNum(y)) return Number(x) < Number(y) ? -1 : 1;
    if (isNum(x)) return -1; if (isNum(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export function pickLatest(versions) { return [...versions].sort(compareSemver).at(-1); }
`
    ),
  K9: d => {
    fs.writeFileSync(path.join(d, 'src/commands.js'), fs.readFileSync(path.join(d, 'src/commands.js'), 'utf8')
      .replace("export function add(title) {", "export function add(title, due) {")
      .replace("const item = { id: data.nextId++, title, done: false };", "const item = { id: data.nextId++, title, done: false };\n  if (due) item.due = due;"));
    fs.writeFileSync(path.join(d, 'bin/todo.js'), `#!/usr/bin/env node
import { add, done, list } from '../src/commands.js';
import { today } from '../src/clock.js';
const valid = s => /^\\d{4}-\\d{2}-\\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const [cmd, ...rest] = process.argv.slice(2);
const show = i => console.log(\`[\${i.done ? 'x' : ' '}] \${i.id} \${i.title}\${i.due ? ' (due ' + i.due + ')' : ''}\`);
try {
  if (cmd === 'add') {
    const k = rest.indexOf('--due'); let due;
    if (k >= 0) { due = rest[k + 1]; rest.splice(k, 2); if (!due || !valid(due)) throw new Error('bad date'); }
    const item = add(rest.join(' '), due); console.log(\`added #\${item.id}\`);
  } else if (cmd === 'done') { done(Number(rest[0])); console.log('ok'); }
  else if (cmd === 'list') {
    let items = list();
    if (rest.includes('--overdue')) items = items.filter(i => !i.done && i.due && i.due < today()).sort((a, b) => a.due.localeCompare(b.due));
    items.forEach(show);
  } else { console.error('usage'); process.exit(2); }
} catch (e) { console.error(e.message); process.exit(1); }
`);
  },
  K8: d => {
    sub(d, 'src/config.js', '30000', '60000');
    sub(d, 'README.md', '30 seconds (30000 ms)', '60 seconds (60000 ms)');
  },
};

let bad = 0;
for (const [id, task] of Object.entries(TASKS)) {
  const root = fs.mkdtempSync(path.join(SCRATCH, `agent-tmp-value-check-${id}-`));
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  task.setup(dir);
  const before = runHidden(dir, path.join(root, 'h1'), id, task.hidden);
  const visBefore = visibleSuite(dir);
  REF[id](dir);
  const after = runHidden(dir, path.join(root, 'h2'), id, task.hidden);
  const visAfter = visibleSuite(dir);
  const ok = !before.ok && after.ok;
  if (!ok) bad++;
  console.log(
    `${ok ? 'live' : 'BROKEN'} ${id}: hidden before ${before.pass}p/${before.fail}f, after ${after.pass}p/${after.fail}f; visible before ${visBefore.pass}p/${visBefore.fail}f, after-ref ${visAfter.pass}p/${visAfter.fail}f`
  );
  if (!after.ok) console.log(after.out.slice(-1500));
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
