'use strict';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';let frozen=false,busy=false,latest=null,lastHash=null;
const fmt=(x,n=3)=>Number(x).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n});
function svg(name,attrs,parent){const e=document.createElementNS(NS,name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));parent.appendChild(e);return e;}
function render(s){const m=s.metrics,v=m.volumes_m3;
  for(const k of['fall','pool','river','ocean'])$(k+'-value').textContent=fmt(v[k])+' m³';
  $('fall-detail').textContent=`落下延遲 ${fmt(m.fall_delay_s)} s`;$('pool-detail').textContent=`水位 ${fmt(m.pool_stage_m)} m`;
  $('river-detail').textContent=`${m.cells} 格 · 深度 ${fmt(m.min_depth_m)}–${fmt(m.max_depth_m)} m`;$('ocean-detail').textContent=`水位 ${fmt(m.ocean_stage_m)} m`;
  $('time').textContent=`t = ${fmt(m.time_s)} s · ${m.steps} steps`;$('residual').textContent=m.raw_residual_m3.toExponential(3)+' m³';
  $('supply').textContent=fmt(m.flux_integrals_m3.supply);$('export').textContent=fmt(m.flux_integrals_m3.export);$('cfl').textContent=fmt(m.max_face_cfl);$('partitions').textContent=`${s.organization.partitions} / ${s.organization.organization.replace('partitioned-','')}`;
  $('field').textContent=s.id+' · '+s.state_sha256.slice(0,12);
  const t=m.time_s,dt=m.max_dt_s||1;
  $('fall-flow').textContent=`空中 ${fmt(v.fall)} m³`;$('pool-flow').textContent=`深潭 ${fmt(m.pool_stage_m)} m`;$('ocean-flow').textContent=`海洋 ${fmt(m.ocean_stage_m)} m`;
  $('pool-water').setAttribute('cy',462-(m.pool_stage_m-2.15)*13);$('pool-rings').setAttribute('transform',`translate(0,${-(m.pool_stage_m-2.15)*13})`);
  const streaks=$('fall-streaks');streaks.replaceChildren();for(let i=0;i<18;i++){const phase=(i*.173+t*.7)%1,y=250+phase*185;svg('path',{d:`M${342+phase*40+i%3*4} ${y}q0 11 4 24`,stroke:'#dcf7e7','stroke-width':1+i%3*.5,opacity:.25+i%4*.12,fill:'none'},streaks);}
  const group=$('river-cells'),tracers=$('river-tracers');group.replaceChildren();tracers.replaceChildren();const h=s.river.h,n=h.length;
  const point=(f,depth)=>{const x=460+645*f,y=458+22*Math.sin(5*f)+35*f,w=13+depth*15;return {x,y,w};};
  for(let i=0;i<n;i++){const a=point(i/n,h[i]),b=point((i+1)/n,h[Math.min(n-1,i+1)]);svg('path',{d:`M${a.x} ${a.y-a.w}L${b.x} ${b.y-b.w}L${b.x} ${b.y+b.w}L${a.x} ${a.y+a.w}Z`,fill:'url(#water)'},group);}
  for(let i=0;i<24;i++){const f=(i/24+t*.016)%1,p=point(f,h[Math.min(n-1,Math.floor(f*n))]);svg('ellipse',{cx:p.x,cy:p.y+(i%3-1)*6,rx:4,ry:1,opacity:.5},tracers);}
  const sea=$('sea-lines');sea.replaceChildren();for(let j=0;j<8;j++){const y=445+j*13-(m.ocean_stage_m-1.53)*13;svg('path',{d:`M1080 ${y}q45 -4 95 0t205 0`,opacity:.3+j*.035},sea);}
  const p=$('profile-content');p.replaceChildren();const bed=s.river.bed,eta=bed.map((z,i)=>z+h[i]),lo=Math.min(...bed)-.1,hi=Math.max(...eta)+.15,x=i=>42+620*i/(n-1),y=z=>139-(z-lo)/(hi-lo)*112;
  for(let j=0;j<4;j++){const z=lo+(hi-lo)*j/3,yy=y(z);svg('line',{x1:42,y1:yy,x2:662,y2:yy,stroke:'#29434b','stroke-width':.6},p);const label=svg('text',{x:5,y:yy+3,fill:'#82a6a9','font-size':10},p);label.textContent=fmt(z,1);}
  const line=a=>a.map((z,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(z).toFixed(2)).join(' ');
  svg('path',{d:line(eta)+' '+bed.map((z,i)=>`L${x(n-1-i)} ${y(bed[n-1-i])}`).join(' ')+' Z',fill:'#337f85',opacity:.4},p);
  svg('path',{d:line(bed),stroke:'#8c9d7b','stroke-width':2,fill:'none'},p);svg('path',{d:line(eta),stroke:'#85dcca','stroke-width':2,fill:'none'},p);
  for(const[f,label]of[[0,'0 m'],[.5,`${fmt(s.river.length/2,0)} m`],[1,`${fmt(s.river.length,0)} m`]]){const e=svg('text',{x:42+620*f,y:160,'text-anchor':f===1?'end':'start',fill:'#82a6a9','font-size':10},p);e.textContent=label;}
  window.__r2View={id:s.id,state_sha256:s.state_sha256,metrics:structuredClone(m),frozen};
}
async function poll(force=false){if(busy||frozen&&!force)return;busy=true;try{const r=await fetch('/demo/state',{cache:'no-store'});if(!r.ok)throw Error('水場尚未就緒');latest=await r.json();if(latest.state_sha256!==lastHash||force){render(latest);lastHash=latest.state_sha256;}$('connection').textContent=frozen?'讀取已暫停':'RAM 常駐 · '+latest.metrics.steps+' steps';}catch(e){$('connection').textContent=e.message;}finally{busy=false;}}
$('refresh').onclick=()=>poll(true);$('freeze').onclick=()=>{frozen=!frozen;$('freeze').textContent=frozen?'繼續讀取':'暫停讀取';$('freeze').setAttribute('aria-pressed',String(frozen));if(window.__r2View)window.__r2View.frozen=frozen;$('connection').textContent=frozen?'讀取已暫停':'RAM 常駐';if(!frozen)poll();};
poll();setInterval(()=>poll(),500);
