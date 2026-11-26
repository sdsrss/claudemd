# Where the C/S arms' extra cost goes: process artifacts and extra steps per run.
import json, glob, collections, re, statistics as st
rows=[json.load(open(f)) for f in glob.glob('out-main/*/*/result.json')]
def feats(r):
    d=r.get('diff') or {}
    f={}
    f['specFile']=any(k.startswith('tasks/') for k in d)
    f['commit']=(r.get('commits') or 0)>0
    stream=open(glob.glob(f"out-main/{r['arm']}/{r['task']}-{r['rep']}/stream.jsonl")[0]).read()
    cmds=[]
    for line in stream.splitlines():
        try: o=json.loads(line)
        except: continue
        if o.get('type')=='assistant':
            for b in o['message']['content']:
                if b.get('type')=='tool_use' and b['name']=='Bash': cmds.append(b['input'].get('command',''))
    f['testRuns']=sum(1 for c in cmds if re.search(r'npm test|node --test',c))
    f['web']=any(re.search(r'\bcurl\b|WebFetch|wget',c) for c in cmds) or 'WebFetch' in (r.get('toolNames') or {})
    f['reportHeading']=bool(re.search(r'^## (汇报|Report)',r.get('final',''),re.M))
    return f
agg=collections.defaultdict(list)
for r in rows: agg[r['arm']].append(feats(r))
for a in ['V','H','S','C','L','Cx','Lx']:
    fs=agg[a]; n=len(fs)
    print(f"{a}: n={n} specFile {sum(x['specFile'] for x in fs)}/{n}  commit {sum(x['commit'] for x in fs)}/{n}  web-lookup {sum(x['web'] for x in fs)}/{n}  test runs median {st.median([x['testRuns'] for x in fs])} mean {st.mean([x['testRuns'] for x in fs]):.1f}  汇报 heading {sum(x['reportHeading'] for x in fs)}/{n}")
