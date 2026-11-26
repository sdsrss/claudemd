# Harness artifact check: runs that read the in-repo CLAUDE.md (impossible in real use, where it lives in ~/.claude).
import json, glob, re, statistics as st, collections, math
rows=[json.load(open(f)) for f in glob.glob('out-main/*/*/result.json')]
def reads_claude(arm, task, rep):
    n=0
    for line in open(f'out-main/{arm}/{task}-{rep}/stream.jsonl'):
        try: o=json.loads(line)
        except: continue
        if o.get('type')!='assistant': continue
        for b in o['message']['content']:
            if b.get('type')!='tool_use': continue
            i=b['input']; s=(i.get('command') or '')+' '+(i.get('file_path') or '')
            if re.search(r'(^|[\s/;&|])CLAUDE\.md\b', s) and not re.search(r'\.claude/', s.split('CLAUDE.md')[0][-20:]):
                if b['name']=='Read' or re.search(r'\b(cat|head|sed|less|grep)\b[^|;&]*CLAUDE\.md', s): n+=1
    return n
by=collections.defaultdict(list)
for r in rows:
    r['readClaude']=reads_claude(r['arm'],r['task'],r['rep'])>0
    by[r['arm']].append(r)
for a in ['V','H','S','C','L','Cx','Lx']:
    rs=by[a]; k=sum(r['readClaude'] for r in rs)
    print(f'{a}: runs reading in-repo CLAUDE.md {k}/{len(rs)}')
# Cost ratio C/V and L/V restricted to runs that did NOT read CLAUDE.md
V={t:st.median([r['cost'] for r in by['V'] if r['task']==t]) for t in sorted({r['task'] for r in rows})}
for a in ['C','S','L']:
    ratios=[]; per=[]
    for t,v in V.items():
        xs=[r['cost'] for r in by[a] if r['task']==t and not r['readClaude']]
        if xs: ratios.append(st.median(xs)/v); per.append(f'{t} {st.median(xs)/v:.2f}(n={len(xs)})')
    print(f'{a}/V excluding CLAUDE.md readers: geo-mean {math.exp(sum(map(math.log,ratios))/len(ratios)):.2f}  ', ', '.join(per))
