from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out=Path(__file__).resolve().parent/'results'
load=lambda f:json.loads((out/f).read_text(encoding='utf-8'))
c=load('crossover.json');b=load('boundary.json');cost=load('complexity.json');st=load('stability.json')
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none','figure.dpi':130})
colors=['#087e8b','#d7812b','#765d9b']
def save(fig,name):
    fig.savefig(out/(name+'.svg'));fig.savefig(out/(name+'-qa.png'));plt.close(fig)
fig,ax=plt.subplots(1,2,figsize=(12,4.5),layout='constrained')
for p,color in zip([2,4,8],colors):
    rows=sorted([r for r in c['summary'] if r['workers']==p],key=lambda r:r['total'])
    x=[r['total'] for r in rows];y=[r['geometric_median_speedup'] for r in rows]
    ax[0].plot(x,y,'o-',color=color,label=f'{p} retained workers')
    ax[0].fill_between(x,[r['bootstrap_95'][0] for r in rows],[r['bootstrap_95'][1] for r in rows],color=color,alpha=.1)
ax[0].set_xscale('log',base=2);ax[0].set(xlabel='Total river cells (4 reaches, 5 storage nodes)',ylabel='Serial / fused-worker compute time',title='Crossover and larger-grid benefit');ax[0].legend(fontsize=8)
rows=b['summary'];x=[r['total'] for r in rows];y=[r['geometric_median_speedup'] for r in rows]
ax[1].errorbar(x,y,yerr=[[v-r['bootstrap_95'][0] for v,r in zip(y,rows)],[r['bootstrap_95'][1]-v for v,r in zip(y,rows)]],fmt='o-',capsize=4,color=colors[0]);ax[1].set(xlabel='Total cells: independent boundary repeat',ylabel='Serial / 4-worker compute time',title='Small benefit begins between 1024 and1280 cells')
for a in ax:a.axhline(1,color='#888888',lw=.8);a.axhline(1.1,color='#aa5555',lw=.8,ls=':');a.grid(alpha=.18)
fig.suptitle('Hot, matched-state calls; shaded/error bars are within-run pointwise95% bootstrap intervals',fontsize=11)
save(fig,'crossover')
fig,ax=plt.subplots(1,2,figsize=(12,4.4),layout='constrained')
for a,total in zip(ax,[16384,65536]):
    rows=[r for r in cost['summary'] if r['total']==total and r['exchange']=='direct']
    for mode,color in zip(['fused','cells-only'],colors):
        rr=sorted([r for r in rows if r['mode']==mode],key=lambda r:r['trunk']+r['tributaries'])
        a.plot([r['trunk']+r['tributaries'] for r in rr],[r['parallel_median_ms'] for r in rr],'o-',color=color,label=f'4workers: {mode}')
    rr=sorted([r for r in rows if r['mode']=='fused'],key=lambda r:r['trunk']+r['tributaries'])
    a.plot([r['trunk']+r['tributaries'] for r in rr],[r['serial_median_ms'] for r in rr],'s--',color=colors[2],label='serial comparison')
    a.set_xscale('log',base=4);a.set_xticks([1,4,16,64],['1','4','16','64']);a.set(title=f'{total:,} total cells, same64 steps/call',xlabel='Reaches (up to65 independent storages)',ylabel='Median compute ms/call');a.grid(alpha=.18);a.legend(fontsize=8)
fig.suptitle('Coupling cost depends on interfaces and serial work, as well as grid size',fontsize=12)
save(fig,'integration-cost')
fig,ax=plt.subplots(1,2,figsize=(12,4.3),layout='constrained')
control,a=st['long_response'];times=[x['time_s'] for x in a['trace']]
for i,label,color in zip([0,1,3],['head basin','confluence','ocean'],colors):
    ax[0].plot(times,[x['node_stages_m'][i]-y['node_stages_m'][i] for x,y in zip(a['trace'],control['trace'])],label=label,color=color)
ax[0].set(title='Branched pulse minus matched no-pulse control',xlabel='Time(s)',ylabel='Storage-stage perturbation(m)');ax[0].legend();ax[0].grid(alpha=.18)
for row,color in zip(st['long_response'],colors):ax[1].plot([x['time_s'] for x in row['trace']],[x['raw_residual_m3'] for x in row['trace']],label=row['forcing'],color=color)
ax[1].set(title='Full graph water budget over60 seconds',xlabel='Time(s)',ylabel='Raw volume residual(m³)');ax[1].legend();ax[1].grid(alpha=.18)
save(fig,'network-response')
print('SVG figures exported: crossover.svg, integration-cost.svg, network-response.svg')
