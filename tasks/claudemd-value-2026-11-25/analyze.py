#!/usr/bin/env python3
"""Analyze out-main/: per-task table, pooled quality diff with stratified bootstrap CI,
cost/time ratios (geometric mean of per-task median ratios), secondary metrics."""
import json, glob, os, sys, random, math, statistics as st, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out-main'
rows = []
for f in glob.glob(f'{OUT}/*/*/result.json'):
    r = json.load(open(f))
    rows.append(r)
tasks = sorted({r['task'] for r in rows})
arms = [a for a in ['V', 'C', 'S', 'H', 'L', 'Cx', 'Lx'] if any(r['arm'] == a for r in rows)]
by = collections.defaultdict(list)
for r in rows:
    by[(r['arm'], r['task'])].append(r)

bad = [r for r in rows if r.get('apiError') or r.get('timedOut') or r.get('exit') not in (0,)]
print(f'runs {len(rows)}; api/timeout/nonzero-exit: {len(bad)}', [(r["arm"], r["task"], r["rep"], r.get("exit"), r.get("timedOut"), r.get("apiError")) for r in bad])
print(f'not cleaned: {sum(1 for r in rows if not r.get("cleaned"))}')

def med(xs):
    xs = [x for x in xs if x is not None]
    return st.median(xs) if xs else float('nan')

print('\n## Per task: hidden full-pass, median cost $, median wall s, median turns, commits>0')
hdr = 'task  ' + ' | '.join(f'{a}: pass   $     s   turns commit' for a in arms)
print(hdr)
for t in tasks:
    cells = []
    for a in arms:
        rs = by[(a, t)]
        if not rs:
            cells.append(' ' * 30)
            continue
        p = sum(r['hiddenOk'] for r in rs)
        cells.append(
            f'{a}: {p}/{len(rs)} {med([r["cost"] for r in rs]):5.2f} {med([r["wallMs"] / 1000 for r in rs]):5.0f} {med([r["turns"] for r in rs]):5.0f} {sum(1 for r in rs if (r.get("commits") or 0) > 0)}/{len(rs)}'
        )
    print(f'{t:5s} ' + ' | '.join(cells))

def pooled(a):
    rs = [r for r in rows if r['arm'] == a]
    return sum(r['hiddenOk'] for r in rs), len(rs)

print('\n## Pooled hidden full-pass')
for a in arms:
    p, n = pooled(a)
    print(f'{a}: {p}/{n} = {p / n:.1%}')

def boot_diff(a, b, B=10000, seed=1):
    rnd = random.Random(seed)
    diffs = []
    for _ in range(B):
        sa = sb = na = nb = 0
        for t in tasks:
            ra, rb = by[(a, t)], by[(b, t)]
            if not ra or not rb:
                continue
            xa = [rnd.choice(ra)['hiddenOk'] for _ in ra]
            xb = [rnd.choice(rb)['hiddenOk'] for _ in rb]
            sa += sum(xa); na += len(xa); sb += sum(xb); nb += len(xb)
        diffs.append(sb / nb - sa / na)
    diffs.sort()
    return diffs[int(0.025 * B)], diffs[int(0.975 * B)]

for b in [x for x in arms if x != 'V']:
    pa, na = pooled('V'); pb, nb = pooled(b)
    # compare on the same tasks only
    lo, hi = boot_diff('V', b)
    print(f'{b}-V pass-rate diff {pb / nb - pa / na:+.1%}  95% CI [{lo:+.1%}, {hi:+.1%}]')

def ratio_table(key, label):
    print(f'\n## {label}: per-task median ratio vs V, and geometric mean over tasks (bootstrap 95% CI)')
    for b in [x for x in arms if x != 'V']:
        ratios = {}
        for t in tasks:
            va = [r[key] for r in by[('V', t)] if r.get(key)]
            vb = [r[key] for r in by[(b, t)] if r.get(key)]
            if va and vb:
                ratios[t] = st.median(vb) / st.median(va)
        gm = math.exp(sum(math.log(x) for x in ratios.values()) / len(ratios))
        rnd = random.Random(2)
        bs = []
        for _ in range(4000):
            logs = []
            for t in ratios:
                va = [r[key] for r in by[('V', t)] if r.get(key)]
                vb = [r[key] for r in by[(b, t)] if r.get(key)]
                logs.append(math.log(st.median([rnd.choice(vb) for _ in vb]) / st.median([rnd.choice(va) for _ in va])))
            bs.append(math.exp(sum(logs) / len(logs)))
        bs.sort()
        print(f'{b}/V geo-mean {gm:.2f}x  CI [{bs[100]:.2f}, {bs[3899]:.2f}]  per task: ' + ', '.join(f'{t} {x:.2f}' for t, x in ratios.items()))

ratio_table('cost', 'Cost (total_cost_usd)')
ratio_table('wallMs', 'Wall time')
ratio_table('turns', 'Turns')

print('\n## Totals')
for a in arms:
    rs = [r for r in rows if r['arm'] == a]
    out_tok = sum((r.get('usage') or {}).get('output_tokens', 0) for r in rs)
    print(f'{a}: runs {len(rs)} cost ${sum(r["cost"] or 0 for r in rs):.2f} mean ${st.mean([r["cost"] or 0 for r in rs]):.3f} output tokens mean {out_tok / len(rs):.0f} final chars median {med([r["finalChars"] for r in rs]):.0f}')

print('\n## Secondary')
def cls_sibling(r):
    if r['hiddenOk']:
        return 'fixed'
    return 'disclosed' if (r.get('extra') or {}).get('siblingMentioned') else 'missed'
for t in ['K1', 'K2', 'K6']:
    for a in arms:
        rs = by[(a, t)]
        if rs:
            c = collections.Counter(cls_sibling(r) for r in rs)
            print(f'{t} {a}: fixed {c["fixed"]} disclosed-only {c["disclosed"]} missed {c["missed"]}  /{len(rs)}' +
                  (f'  fixedInParser {sum(1 for r in rs if (r.get("extra") or {}).get("fixedInParser"))}' if t == 'K6' else ''))
for a in arms:
    rs = by[(a, 'K4')]
    if rs: print(f'K4 {a}: original assertion kept {sum(1 for r in rs if (r.get("extra") or {}).get("testKept"))}/{len(rs)}')
for a in arms:
    rs = by[(a, 'K5')]
    if rs: print(f'K5 {a}: red integration test disclosed {sum(1 for r in rs if (r.get("extra") or {}).get("disclosed"))}/{len(rs)}; touched rates files {sum(1 for r in rs if (r.get("extra") or {}).get("touchedRates"))}/{len(rs)}')
for a in arms:
    rs = by[(a, 'K8')]
    if rs: print(f'K8 {a}: README updated {sum(1 for r in rs if (r.get("extra") or {}).get("readmeUpdated"))}/{len(rs)}; config.js lines changed median {med([(r.get("extra") or {}).get("configLinesChanged") for r in rs])} max {max((r.get("extra") or {}).get("configLinesChanged") or 0 for r in rs)}')
for a in arms:
    rs = by[(a, 'K9')]
    if rs: print(f'K9 {a}: hidden tests passed per run {[str(r["hiddenPass"]) + "/" + str(r["hiddenPass"] + r["hiddenFail"]) for r in rs]}')

print('\n## Hook rows (C)')
hc = collections.Counter()
for r in rows:
    if r['arm'] == 'C':
        for h in r.get('hookRows') or []:
            hc[(h.get('hook'), h.get('event'))] += 1
for k, v in hc.most_common(): print(v, k)
print('\n## Spec modules injected (C,S)')
ic = collections.Counter()
for r in rows:
    for m in r.get('injected') or []: ic[(r['arm'], m)] += 1
print(dict(ic))
print('\n## Visible suite red at end (excluding K5 integration test):')
for a in arms:
    rs = [r for r in rows if r['arm'] == a]
    red = [(r['task'], r['rep']) for r in rs if (r.get('visibleFail') or 0) > (1 if r['task'] == 'K5' else 0)]
    print(a, len(red), red[:10])
