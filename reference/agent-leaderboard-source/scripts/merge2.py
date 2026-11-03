import json,sys
kind,hin,out=sys.argv[1:4]; pairs=list(zip(sys.argv[4::2],sys.argv[5::2]))
key='agent' if kind=='agent' else 'source'
n=lambda s:float(s.replace('$','').replace(',','').replace('%','').strip() or 0)
def parse(path):
    rows=[];tot=None
    for l in open(path).read().splitlines():
        a=l.split('|')
        if len(a)!=6: continue
        v=dict(leads=int(n(a[1])),quoted=int(n(a[2])),submitted=int(n(a[3])),premium=round(n(a[4]),2),spend=n(a[5]))
        name=a[0].strip()
        if name in ('','Agency'): tot=v; continue
        rows.append({key:name,**v})
    return rows,tot
h=json.load(open(hin))['rows']; before=len(h)
dates={d for d,_ in pairs}
h=[r for r in h if r['date'] not in dates]; kept=len(h)
for d,p in pairs:
    rows,tot=parse(p)
    s=lambda k:round(sum(r[k] for r in rows),2)
    print(d,kind,'rows',len(rows),'sum',s('leads'),s('submitted'),s('premium'),'total',tot)
    h+=[{'date':d,**r} for r in rows]
h.sort(key=lambda r:(r['date'],-r['premium']))
json.dump({'rows':h},open(out,'w'))
print('history rows before',before,'kept',kept,'after',len(h))
