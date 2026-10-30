/* SVG renderer only — no Canvas, WebGL, external libraries, or network requests.
 * FluidSolver supplies finite-volume state; SVG paths and circles are projections.
 */
(function () {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const svg=document.getElementById('world');
  if(!svg || !window.EveFluid)return;
  const axis=document.getElementById('river-axis'), river=document.getElementById('river-water');
  const riverTop=document.getElementById('river-shimmer'),riverBottom=document.getElementById('river-bottom');
  const flowLayer=document.getElementById('river-flows'),rippleLayer=document.getElementById('river-ripples');
  const sprayLayer=document.getElementById('waterfall-spray'),streakLayer=document.getElementById('fall-streaks');
  const foamLayer=document.getElementById('pool-foam'),waveLayer=document.getElementById('ocean-wavelets');
  const shimmerLayer=document.getElementById('ocean-shimmers');
  const solverCtor=window.EveFluid.Solver;
  let solver=new solverCtor(),paused=false,elapsedSinceFrame=0,frameWindow=0,frameCount=0,fps=60;
  let previous=null,animationTime=0,loopError=null;
  const length=axis.getTotalLength(),track=[];
  for(let i=0;i<=96;i++){
    const s=length*i/96,p=axis.getPointAtLength(s);
    const a=axis.getPointAtLength(Math.max(0,s-1)),b=axis.getPointAtLength(Math.min(length,s+1));
    const tx=b.x-a.x,ty=b.y-a.y,mag=Math.hypot(tx,ty)||1;
    track.push({x:p.x,y:p.y,nx:-ty/mag,ny:tx/mag});
  }
  // Deterministic seeded illustrations; they are visual tracers, not water volumes.
  let seed=471108;
  function rand(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
  function el(tag,atts,parent){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(atts||{}))e.setAttribute(k,String(v));if(parent)parent.appendChild(e);return e;}
  const tracer=[];
  for(let i=0;i<122;i++){
    const s=rand()*length,z=(rand()*2-1),r=.7+rand()*2.3;
    tracer.push({s,z,r,e:el('ellipse',{rx:(r*2.4).toFixed(1),ry:(r*.55).toFixed(1),fill:i%4===0?'#cbfff2':'#a3ede4',opacity:(.15+rand()*.55).toFixed(2)},flowLayer)});
  }
  const ripples=[];
  for(let i=0;i<25;i++)ripples.push({s:rand()*length,offset:rand()*2*Math.PI,width:16+rand()*22,
    e:el('path',{fill:'none',stroke:'#c9f2ec','stroke-width':1+rand()*1.8,opacity:.2+rand()*.23,'stroke-linecap':'round'},rippleLayer)});
  const streaks=[];
  for(let i=0;i<44;i++)streaks.push({phase:rand(),x:338+rand()*47,dy:15+rand()*49,
    e:el('path',{fill:'none',stroke:i%3?'#d4fff6':'#ffffff','stroke-width':(.65+rand()*2.4).toFixed(1),opacity:(.16+rand()*.48).toFixed(2),'stroke-linecap':'round'},streakLayer)});
  const spray=[];
  for(let i=0;i<96;i++)spray.push({phase:rand()*2,vx:(rand()-.5)*120,vy:42+rand()*77,r:.75+rand()*2.25,
    e:el('circle',{r:1,fill:i%3===0?'#ffffff':'#bdfaf0'},sprayLayer)});
  const rings=[];
  for(let i=0;i<14;i++)rings.push({phase:rand()*1.6,angle:-15+rand()*30,y:500+rand()*20,
    e:el('ellipse',{fill:'none',stroke:'#d5fff0','stroke-width':1.5,opacity:.5},foamLayer)});
  const waves=[];
  for(let i=0;i<23;i++)waves.push({y:487+i*13.1,phase:rand()*6.28,
    e:el('path',{fill:'none',stroke:i%3===0?'#b4f5e3':'#87d9d8','stroke-width':i%4===0?2.1:1.1,opacity:i%3===0?.32:.19},waveLayer)});
  const glints=[];
  for(let i=0;i<42;i++)glints.push({x:965+rand()*530,y:510+rand()*230,phase:rand()*6.28,w:8+rand()*34,
    e:el('path',{fill:'none',stroke:'#c0f5e1','stroke-width':.8+rand()*1.4,opacity:.25,'stroke-linecap':'round'},shimmerLayer)});
  function pointAt(s){return axis.getPointAtLength(Math.max(0,Math.min(length,s)));}
  function fluidWidth(f){
    const d=solver.sample(f).h;
    const base=29+f*61;
    return base*Math.max(.83,Math.min(1.27,Math.sqrt(d/1.15)));
  }
  function updateRiver(){
    const upper=[],lower=[];
    for(let i=0;i<track.length;i++){
      const p=track[i],f=i/96,w=fluidWidth(f);
      upper.push([p.x-p.nx*w,p.y-p.ny*w]);
      lower.push([p.x+p.nx*w,p.y+p.ny*w]);
    }
    const pair=arr=>arr.map(p=>p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' L ');
    river.setAttribute('d','M '+pair(upper)+' L '+pair(lower.reverse())+' Z');
    riverTop.setAttribute('d','M '+pair(upper.slice(2,89)));
    riverBottom.setAttribute('d','M '+pair(lower.slice(3,91)));
  }
  function updateTracers(dt){
    for(const t of tracer){
      const f=t.s/length,s=solver.sample(f);
      t.s=(t.s+Math.max(0,s.u)*length/96*dt)%length;
      const p=pointAt(t.s),a=pointAt(Math.max(0,t.s-2)),b=pointAt(Math.min(length,t.s+2)),angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      const nX=-(b.y-a.y)/(Math.hypot(b.x-a.x,b.y-a.y)||1),nY=(b.x-a.x)/(Math.hypot(b.x-a.x,b.y-a.y)||1);
      const width=fluidWidth(t.s/length)*.67;
      t.e.setAttribute('transform',`translate(${(p.x+nX*t.z*width).toFixed(1)} ${(p.y+nY*t.z*width).toFixed(1)}) rotate(${angle.toFixed(1)})`);
    }
    for(const r of ripples){
      r.s=(r.s+Math.max(.1,solver.sample(r.s/length).u)*length/96*dt*.8)%length;
      const p=pointAt(r.s),a=pointAt(Math.max(0,r.s-1)),b=pointAt(Math.min(length,r.s+1)),mg=Math.hypot(b.x-a.x,b.y-a.y)||1;
      const nx=-(b.y-a.y)/mg,ny=(b.x-a.x)/mg,half=r.width/2;
      r.e.setAttribute('d',`M ${(p.x-nx*half).toFixed(1)} ${(p.y-ny*half).toFixed(1)} q 4 -3 ${(nx*r.width).toFixed(1)} ${(ny*r.width).toFixed(1)}`);
    }
  }
  function updateWaterfall(t){
    const intensity=Math.sqrt(solver.config.inflow_m2_s);
    for(const st of streaks){
      const y=274+((st.phase*240+t*210*(.75+intensity*.3))%240);
      const drift=(y-287)*.20;
      st.e.setAttribute('d',`M ${(st.x+drift).toFixed(1)} ${y.toFixed(1)} q -3 ${(.4*st.dy).toFixed(1)} 6 ${st.dy.toFixed(1)}`);
    }
    for(const p of spray){
      const z=(t*.8+p.phase)%1.8;
      const x=415+p.vx*z*.57,y=499-p.vy*z+58*z*z;
      p.e.setAttribute('cx',x.toFixed(1));p.e.setAttribute('cy',y.toFixed(1));
      p.e.setAttribute('r',(p.r*(.7+intensity*.2)).toFixed(2));
      p.e.setAttribute('opacity',Math.max(0,Math.min(.8,(1.8-z)*.55)).toFixed(2));
    }
    for(const r of rings){
      const phase=(t*.36+r.phase)%1.6;
      r.e.setAttribute('cx',(417+phase*8).toFixed(1));r.e.setAttribute('cy',r.y.toFixed(1));
      r.e.setAttribute('rx',(9+phase*42).toFixed(1));r.e.setAttribute('ry',(3+phase*12).toFixed(1));
      r.e.setAttribute('opacity',((1-phase/1.6)*.55).toFixed(2));
    }
  }
  function updateSea(t){
    const tide=solver.config.tide_m,outflow=solver.measure().outflow_m2_s;
    for(const w of waves){
      const y=w.y-12*tide,d=[];
      for(let x=975;x<=1430;x+=13){
        const estuary=Math.exp(-(x-994)/190),amp=(2.0+2.4*estuary)*(.7+.3*outflow);
        const v=Math.sin(x*.025-t*1.7+w.phase)*amp+Math.sin(x*.051+t*.85+w.phase)*.75;
        d.push((d.length?'L':'M')+x+' '+(y+v).toFixed(1));
      }
      w.e.setAttribute('d',d.join(' '));
    }
    for(const g of glints){const y=g.y-12*tide+Math.sin(t+g.phase)*3;
      g.e.setAttribute('d',`M ${g.x.toFixed(1)} ${y.toFixed(1)} l ${g.w.toFixed(1)} ${(Math.sin(g.phase+t)*1.2).toFixed(1)}`);
    }
  }
  function text(id,v){document.getElementById(id).textContent=v;}
  function updateHUD(){const m=solver.measure();
    text('m-time',m.time_s.toFixed(1)+' s');text('m-vel',m.velocity_ms.toFixed(2)+' m/s');
    text('m-out',m.outflow_m2_s.toFixed(3));text('m-vol',m.water_m2.toFixed(2));
    text('m-mass',m.mass_residual_m2.toExponential(1));text('m-fps',Math.round(fps).toString());
  }
  function simulate(ts){
    if(previous===null)previous=ts;
    const actual=Math.min(.055,Math.max(0,(ts-previous)/1000));previous=ts;
    frameWindow+=actual;frameCount++;
    if(frameWindow>=.8){fps=frameCount/frameWindow;frameCount=0;frameWindow=0;}
    try{
      if(!paused){const dt=actual*3.2;solver.advance(dt);animationTime+=actual*1.65;updateTracers(dt);}
      // Limit geometry regeneration to 30fps; existing SVG remains visible in between.
      elapsedSinceFrame+=actual;
      if(elapsedSinceFrame>=1/30 || solver.steps===0){
        updateRiver();updateWaterfall(animationTime);updateSea(animationTime);updateHUD();elapsedSinceFrame=0;
      }
    }catch(e){loopError=e;paused=true;document.getElementById('note').textContent='計算停止：'+e.message;document.getElementById('note').classList.add('error');text('running','SIMULATION ERROR');}
    requestAnimationFrame(simulate);
  }
  function updateSliders(){
    const inflow=+document.getElementById('flow').value,tide=+document.getElementById('tide').value,friction=+document.getElementById('friction').value;
    text('flow-value',inflow.toFixed(2));text('tide-value',(tide>=0?'+':'')+tide.toFixed(2)+' m');text('friction-value',friction.toFixed(3));
    solver.setParameters({inflow_m2_s:inflow,tide_m:tide,roughness:friction});
  }
  for(const id of ['flow','tide','friction']) document.getElementById(id).addEventListener('input',updateSliders);
  document.getElementById('toggle').addEventListener('click',()=>{paused=!paused;text('toggle',paused?'繼續模擬':'暫停模擬');text('running',paused?'PAUSED':'SIMULATING');});
  document.getElementById('reset').addEventListener('click',()=>{solver=new solverCtor();document.getElementById('flow').value='1.0';document.getElementById('tide').value='0';document.getElementById('friction').value='0.03';updateSliders();animationTime=0;paused=false;loopError=null;text('toggle','暫停模擬');text('running','SIMULATING');document.getElementById('note').classList.remove('error');if(previous!==null && !loopError)updateRiver();});
  document.getElementById('export').addEventListener('click',()=>{
    const clone=svg.cloneNode(true);clone.removeAttribute('id');
    clone.setAttribute('xmlns',NS);clone.setAttribute('width','1400');clone.setAttribute('height','760');
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
    const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='EveComputeField-fluid-scene.svg';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),250);
  });
  updateSliders();updateRiver();updateWaterfall(0);updateSea(0);updateHUD();
  // Expose a read-only snapshot for browser smoke tests, not an authority API.
  window.__fluidSnapshot=()=>({state:solver.measure(),render:{riverPath:river.getAttribute('d'),circles:svg.querySelectorAll('circle').length},paused});
  requestAnimationFrame(simulate);
})();
