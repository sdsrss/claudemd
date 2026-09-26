import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.join(os.homedir(), '.claude/projects');
const cutoff = Date.now() - 21*864e5;
const pats = {sec:/§\s?\d/, ironlaw:/Iron Law/i, level:/\bL[0-3]\+?\b/, partial:/\[PARTIAL/, spine:/SPINE/, fourSec:/^(Done|Not done|Failed|Uncertain):/m, arrow:/→/, auth:/\[AUTH REQUIRED/};
const out = {};
for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d); let files; try { files = fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl')); } catch { continue; }
  const r = out[d] = {texts:0, turnsFinal:0}; for (const k in pats) { r[k]=0; r['final_'+k]=0; }
  for (const f of files) {
    const p = path.join(dir,f); if (fs.statSync(p).mtimeMs < cutoff) continue;
    const lines = fs.readFileSync(p,'utf8').split('\n');
    let lastText = null;
    const flush = () => { if (lastText) { r.turnsFinal++; for (const k in pats) if (pats[k].test(lastText)) r['final_'+k]++; } lastText=null; };
    for (const L of lines) { if (!L) continue; let o; try { o=JSON.parse(L);} catch {continue;}
      if (o.isSidechain) continue;
      if (o.type==='user' && o.message && typeof o.message.content==='string' && !o.isMeta) flush();
      if (o.type==='user' && Array.isArray(o.message?.content) && o.message.content.some(c=>c.type==='text') && !o.isMeta) flush();
      if (o.type!=='assistant') continue;
      for (const c of (o.message?.content||[])) if (c.type==='text' && c.text.length>=40) { r.texts++; lastText=c.text; for (const k in pats) if (pats[k].test(c.text)) r[k]++; }
    }
    flush();
  }
}
for (const [d,r] of Object.entries(out)) if (r.turnsFinal>20) console.log(d, JSON.stringify(r));
