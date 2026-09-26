import fs from 'fs'; import path from 'path'; import os from 'os';
const proj = process.argv[2]; const re = new RegExp(process.argv[3], 'm'); const n = +process.argv[4]||5;
const dir = path.join(os.homedir(), '.claude/projects', proj); const cutoff = Date.now()-21*864e5;
let finals=[];
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl'))) { const p=path.join(dir,f); if (fs.statSync(p).mtimeMs<cutoff) continue;
  let last=null; const flush=()=>{ if(last) finals.push(last); last=null; };
  for (const L of fs.readFileSync(p,'utf8').split('\n')) { if(!L) continue; let o; try{o=JSON.parse(L)}catch{continue}
    if (o.isSidechain) continue;
    if (o.type==='user' && !o.isMeta && (typeof o.message?.content==='string' || (Array.isArray(o.message?.content)&&o.message.content.some(c=>c.type==='text')))) flush();
    if (o.type==='assistant') for (const c of o.message?.content||[]) if (c.type==='text'&&c.text.length>=40) last=c.text; }
  flush(); }
const hit = finals.filter(t=>re.test(t));
console.log(`finals=${finals.length} hits=${hit.length}`);
for (const t of hit.slice(-n)) { const m = t.match(re); const i=m.index; console.log('---', t.slice(Math.max(0,i-160), i+160).replace(/\n/g,' ⏎ ')); }
