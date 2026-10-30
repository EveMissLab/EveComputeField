"""Export standalone SVG research figures; no Canvas/WebGL dependency."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
out=Path(__file__).resolve().parent/'results'
s=json.loads((out/'study.json').read_text(encoding='utf-8'))
r=json.loads((out/'refinement.json').read_text(encoding='utf-8'))
response=json.loads((out/'response.json').read_text(encoding='utf-8'))
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none','figure.dpi':130})
colors=['#087e8b','#d7812b','#765d9b']
fig,axes=plt.subplots(1,2,figsize=(12,4.4),layout='constrained')
for ax,cells in zip(axes,[96,512]):
    for mode,marker,color in [('direct','o',colors[0]),('message-copy','s',colors[1])]:
        for org,style in [('partitioned-serial','-'),('partitioned-workers','--')]:
            rows=[x for x in s['complexity'] if x['cells']==cells and x['exchange']==mode and (x['organization']['organization']==org or org=='partitioned-serial' and x['partitions']==1)]
            rows.sort(key=lambda x:x['partitions'])
            ax.plot([x['partitions'] for x in rows],[x['median_ms'] for x in rows],marker+style,color=color,label=f"{'serial' if org.endswith('serial') else 'workers'}, {mode}")
    ax.set(title=f'{cells} river cells + 3 other inventories',xlabel='River partitions P (internal links = P+2)',ylabel='Median ms per 80 steps')
    ax.set_xticks([1,2,4,8]);ax.grid(alpha=.18);ax.legend(fontsize=8)
fig.suptitle('Retained RAM / hot continuation: more partitions did not pay off on this host',fontsize=12)
fig.savefig(out/'complexity.svg');fig.savefig(out/'complexity-qa.png');plt.close(fig)
fig,axes=plt.subplots(1,2,figsize=(12,4.2),layout='constrained')
grid=r['grid'][:-1]
axes[0].loglog([x['cells'] for x in grid],[x['depth_l1_vs_512_m'] for x in grid],'o-',color=colors[0]);axes[0].set(xlabel='River cells',ylabel='Mean absolute depth error (m)',title='Grid refinement vs projected 512-cell reference');axes[0].grid(alpha=.2)
rows=r['cfl'][1:];axes[1].bar(['CFL 0.39','CFL 4'],[x['depth_l1_vs_small_step_m'] for x in rows],color=colors[:2]);axes[1].set(ylabel='Mean absolute depth error (m)',title='Conservative and finite can still be oscillatory')
axes[1].text(.04,.94,'Same grid/source, T=4 s; dt=0.005 s reference',transform=axes[1].transAxes,va='top',fontsize=9)
fig.savefig(out/'accuracy.svg');fig.savefig(out/'accuracy-qa.png');plt.close(fig)
fig,axes=plt.subplots(2,2,figsize=(12,7),layout='constrained')
for family,row in [('pool-pulse',0),('ocean-tide',1)]:
    for t,color in zip([x for x in response['traces'] if x['family']==family],colors):
        times=[x['time_s'] for x in t['rows']]
        for col,key in enumerate(['pool_perturbation_m','ocean_perturbation_m']):
            axes[row,col].plot(times,[x[key] for x in t['rows']],color=color,label=f"Area {t['area_m2']:g} m²")
    for col,name in enumerate(['Deep basin','Ocean']):
        axes[row,col].set(title=f"{name}: {'supply pulse' if row==0 else 'external tide'} minus matched control",xlabel='Time (s)',ylabel='Stage perturbation (m)');axes[row,col].axhline(0,color='#777777',lw=.5);axes[row,col].grid(alpha=.18);axes[row,col].legend(fontsize=8)
fig.suptitle('Independent storage changes transient response; both boundaries communicate through the river',fontsize=12)
fig.savefig(out/'coupled-response.svg');fig.savefig(out/'coupled-response-qa.png');plt.close(fig)
print('SVG figures: complexity.svg, accuracy.svg, coupled-response.svg')
