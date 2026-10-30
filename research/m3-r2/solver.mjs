import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { Waterfall,Reservoir,sourceConfig,sourceIntegral } from './components.mjs';
import { hydroFace,updateRange } from './numerics.mjs';
import { digest,finite,mergeKnown,sum } from './util.mjs';
export { digest } from './util.mjs';
export const KERNEL_SHA=digest(['solver.mjs','components.mjs','numerics.mjs','partition-worker.mjs','util.mjs'].map(f=>readFileSync(new URL(f,import.meta.url),'utf8').replace(/\r\n?/g,'\n')).join('\n'));
const DEFAULT={cells:96,length:96,width:1,bed_up:1.05,bed_down:.33,roughness:.028,initial_q:.8,fall_height:12,
  source:{kind:'constant',base:1,amplitude:0,at:2,duration:2,period:6},
  pool:{area:30,bottom:1.05,stage:2.15,min_stage:1.07},
  ocean:{area:600,bottom:0,stage:1.53,min_stage:.4,external_stage:1.53,base_export:.8,rating:.5,tide_amplitude:0,tide_period:6}};
const OPT={precision:'f64',dt_max:.03,cfl:.39,storage_guard:true,time_mode:'adaptive',partitions:1,organization:'monolithic',exchange:'direct',fault:'none'};
const PHYS=['precision','dt_max','cfl','storage_guard','time_mode','fault'];
const shared=(T,n)=>new T(new SharedArrayBuffer(T.BYTES_PER_ELEMENT*n));
function checked(config,options){
  const c=mergeKnown(DEFAULT,config),o=mergeKnown(OPT,options);c.source=sourceConfig(c.source);
  if(!Number.isInteger(c.cells)||c.cells<8||c.cells>1024)throw Error('cells must be integer 8..1024');
  finite(c.length,'length',1,10000);finite(c.width,'width',.01,1000);for(const k of['bed_up','bed_down'])finite(c[k],k,-1000,1000);
  finite(c.roughness,'roughness',0,.2);finite(c.initial_q,'initial_q',-100,100);finite(c.fall_height,'fall_height',0,1000);
  for(const k of['external_stage','base_export'])finite(c.ocean[k],k,-1000,1000);finite(c.ocean.rating,'rating',0,1000);finite(c.ocean.tide_amplitude,'tide_amplitude',0,100);finite(c.ocean.tide_period,'tide_period',.01,10000);
  if(!['f64','f32-state'].includes(o.precision))throw Error('invalid precision');finite(o.dt_max,'dt_max',1e-6,1);finite(o.cfl,'CFL',.001,4);
  if(typeof o.storage_guard!=='boolean'||!['adaptive','fixed'].includes(o.time_mode))throw Error('invalid time policy');
  if(!Number.isInteger(o.partitions)||o.partitions<1||o.partitions>16||c.cells%o.partitions)throw Error('partitions must divide grid in 1..16');
  if(!['monolithic','partitioned-serial','partitioned-workers'].includes(o.organization)||o.organization==='monolithic'&&o.partitions!==1||o.organization==='partitioned-workers'&&o.partitions<2)throw Error('invalid organization');
  if(!['direct','message-copy'].includes(o.exchange)||!['none','missing-pool-debit'].includes(o.fault))throw Error('invalid exchange/fault');return {c,o};
}
class CellPool{
  constructor(s,options){this.count=options.partitions;this.control=shared(Int32Array,5);this.parameters=shared(Float64Array,3);
    const buffers=Object.fromEntries(['h','q','fh','fl','fr','nh','nq'].map(k=>[k,s[k].buffer]));buffers.control=this.control.buffer;buffers.parameters=this.parameters.buffer;
    this.workers=Array.from({length:this.count},(_,p)=>new Worker(new URL('./partition-worker.mjs',import.meta.url),{workerData:{buffers,precision:options.precision,start:p*s.n/this.count,end:(p+1)*s.n/this.count},execArgv:[]}));
    for(const w of this.workers)w.on('error',e=>{this.error=e;});const deadline=performance.now()+10000;
    while(true){const ready=Atomics.load(this.control,4);if(ready>=this.count)break;if(performance.now()>deadline){for(const w of this.workers)w.terminate();throw Error('worker startup deadline');}Atomics.wait(this.control,4,ready,100);}
  }
  update(dt,dx,roughness){if(this.error)throw this.error;this.parameters.set([dt,dx,roughness]);Atomics.store(this.control,2,0);Atomics.store(this.control,3,0);Atomics.store(this.control,1,1);Atomics.add(this.control,0,1);Atomics.notify(this.control,0);const deadline=performance.now()+10000;
    while(true){const done=Atomics.load(this.control,2);if(done>=this.count)break;if(performance.now()>deadline)throw Error('worker barrier deadline');Atomics.wait(this.control,2,done,100);}return Atomics.load(this.control,3)-1;
  }
  async close(){Atomics.store(this.control,1,3);Atomics.add(this.control,0,1);Atomics.notify(this.control,0);await Promise.all(this.workers.map(w=>w.terminate()));}
}
export class CoupledSolver{
  constructor(config={},options={}){
    const {c,o}=checked(config,options);this.config=c;this.options=o;this.n=c.cells;this.dx=c.length/this.n;this.closed=false;
    this.fall=new Waterfall({height:c.fall_height,source:c.source});this.poolStorage=new Reservoir(c.pool);this.oceanStorage=new Reservoir(c.ocean);
    this.bed=new Float64Array(this.n);const T=o.precision==='f64'?Float64Array:Float32Array;
    for(const k of['h','q'])this[k]=shared(T,this.n);for(const k of['nh','nq'])this[k]=shared(Float64Array,this.n);for(const k of['fh','fl','fr'])this[k]=shared(Float64Array,this.n+1);
    for(let i=0;i<this.n;i++){const f=(i+.5)/this.n;this.bed[i]=c.bed_up+(c.bed_down-c.bed_up)*f;this.h[i]=c.pool.stage+(c.ocean.stage-c.pool.stage)*f-this.bed[i];this.q[i]=c.initial_q;}
    if(c.pool.min_stage<Math.max(c.bed_up,this.bed[0])+.02||c.ocean.min_stage<Math.max(c.bed_down,this.bed[this.n-1])+.02||![...this.h].every(x=>x>=.02))throw Error('wet connections required by geometry');
    this.quantize=o.precision==='f64'?x=>x:Math.fround;
    for(const model of[this.fall,this.poolStorage,this.oceanStorage])model.volume=this.quantize(model.volume);
    this.poolStorage.validate(this.poolStorage.volume);this.oceanStorage.validate(this.oceanStorage.volume);
    this.time=0;this.steps=0;this.ledger={supply:0,landing:0,pool_river:0,river_ocean:0,export:0};this.roundoff={fall:0,pool:0,river:0,ocean:0};this.initial=this.volumes();
    this.maxCFL=0;this.maxStorage=0;this.minDt=0;this.maxDt=0;this.lastTransfer=null;this.barriers=0;this.copied=0;this.changes=[];this.profile={faces_ms:0,policy_ms:0,update_ms:0,audit_commit_ms:0};
    this.makePool=options=>new CellPool(this,options);this.pool=o.organization==='partitioned-workers'?this.makePool(o):null;
  }
  riverVolume(h=this.h){return sum(h)*this.dx*this.config.width;}
  volumes(){return {fall:this.fall.volume,pool:this.poolStorage.volume,river:this.riverVolume(),ocean:this.oceanStorage.volume};}
  externalStage(t=this.time){const c=this.config.ocean;return c.external_stage+c.tide_amplitude*Math.sin(2*Math.PI*t/c.tide_period);}
  faces(){let fastest=0;const c=this.config,n=this.n;let up=0,down=0;
    for(let j=0;j<=n;j++){let hl,ql,zl,hr,qr,zr;
      if(j===0){zl=c.bed_up;hl=this.poolStorage.stage()-zl;ql=this.q[0]/this.h[0]*hl;hr=this.h[0];qr=this.q[0];zr=this.bed[0];}
      else if(j===n){hl=this.h[n-1];ql=this.q[n-1];zl=this.bed[n-1];zr=c.bed_down;hr=this.oceanStorage.stage()-zr;qr=this.q[n-1]/this.h[n-1]*hr;}
      else{hl=this.h[j-1];ql=this.q[j-1];zl=this.bed[j-1];hr=this.h[j];qr=this.q[j];zr=this.bed[j];}
      if(!(hl>=.02&&hr>=.02))throw Error('dry boundary unsupported');const f=hydroFace(hl,ql,zl,hr,qr,zr);this.fh[j]=f.mass;this.fl[j]=f.left;this.fr[j]=f.right;fastest=Math.max(fastest,f.wave);if(j===0)up=f.wave;if(j===n)down=f.wave;
    }return {fastest,up,down};
  }
  step(want=this.options.dt_max){
    if(this.closed)throw Error('solver closed');finite(want,'requested timestep',1e-15,30);
    const begin=performance.now(),c=this.config,o=this.options,n=this.n,w=c.width,speeds=this.faces(),afterFaces=performance.now();
    const qpr=this.fh[0]*w,qrs=this.fh[n]*w,exportRate=c.ocean.base_export+c.ocean.rating*(this.oceanStorage.stage()-this.externalStage());
    const storageRate=Math.max(w*speeds.up/c.pool.area,(w*speeds.down+c.ocean.rating)/c.ocean.area);
    let dt=Math.min(want,o.dt_max,this.fall.nextEvent(this.time)-this.time);
    if(o.time_mode==='adaptive'){
      dt=Math.min(dt,o.cfl*this.dx/speeds.fastest);if(o.storage_guard)dt=Math.min(dt,.25/storageRate);
      const donors=[[this.poolStorage.volume-this.poolStorage.minimum(),Math.max(0,qpr)],[this.oceanStorage.volume-this.oceanStorage.minimum(),Math.max(0,-qrs)+Math.max(0,exportRate)]];
      for(let i=0;i<n;i++)donors.push([(this.h[i]-.02)*this.dx*w,w*(Math.max(0,-this.fh[i])+Math.max(0,this.fh[i+1]))]);
      for(const [available,outgoing]of donors)if(outgoing>0)dt=Math.min(dt,.9*available/outgoing);
    }
    if(!(dt>=1e-10)||!Number.isFinite(dt))throw Error('timestep below supported wet-storage resolution');
    const fall=this.fall.propose(this.time,dt),transfer={supply:fall.supply,landing:fall.landing,pool_river:qpr*dt,river_ocean:qrs*dt,export:exportRate*dt};
    if(o.exchange==='message-copy'){
      // Actual in-process packaging cost for 3 physical links + P-1 river seams.
      const packets=[{link:'fall-pool',volume:transfer.landing},{link:'pool-river',volume:transfer.pool_river},{link:'river-ocean',volume:transfer.river_ocean}];
      for(let p=1;p<o.partitions;p++)packets.push({link:`river-${p}`,face:p*n/o.partitions,mass_rate:this.fh[p*n/o.partitions]});
      const copy=structuredClone(packets);[transfer.landing,transfer.pool_river,transfer.river_ocean]=copy.slice(0,3).map(x=>x.volume);
      for(const packet of copy.slice(3))this.fh[packet.face]=packet.mass_rate;this.copied+=packets.length;
    }
    const afterPolicy=performance.now();let failed=-1;
    if(this.pool){failed=this.pool.update(dt,this.dx,c.roughness);this.barriers++;}
    else for(let p=0;p<o.partitions;p++){failed=updateRange(this.h,this.q,this.fh,this.fl,this.fr,this.nh,this.nq,p*n/o.partitions,(p+1)*n/o.partitions,dt,this.dx,c.roughness);if(failed>=0)break;}
    if(failed>=0)throw Error(`numerical stability rejection at cell ${failed}, t=${this.time}`);
    const afterUpdate=performance.now(),before=this.volumes(),raw={fall:fall.volume,pool:before.pool+transfer.landing-(o.fault==='missing-pool-debit'?0:transfer.pool_river),river:this.riverVolume(this.nh),ocean:before.ocean+transfer.river_ocean-transfer.export};
    const expected={fall:transfer.supply-transfer.landing,pool:transfer.landing-transfer.pool_river,river:transfer.pool_river-transfer.river_ocean,ocean:transfer.river_ocean-transfer.export};
    const tolerance=128*Number.EPSILON*Math.max(1,...Object.values(before).map(Math.abs),...Object.values(transfer).map(Math.abs));
    for(const k of Object.keys(raw))if(!Number.isFinite(raw[k])||Math.abs(raw[k]-before[k]-expected[k])>tolerance)throw Error(`component budget rejection: ${k}`);
    if(Math.abs(sum(Object.values(raw))-sum(Object.values(before))-transfer.supply+transfer.export)>tolerance*4)throw Error('global budget rejection');
    const stored={fall:this.quantize(raw.fall),pool:this.quantize(raw.pool),river:0,ocean:this.quantize(raw.ocean)};
    if(stored.fall<0)throw Error('negative airborne storage');this.poolStorage.validate(stored.pool);this.oceanStorage.validate(stored.ocean);
    for(let i=0;i<n;i++){const h=this.quantize(this.nh[i]),q=this.quantize(this.nq[i]);if(h<.02||!Number.isFinite(h)||!Number.isFinite(q))throw Error('quantized state invalid');stored.river+=h;}
    stored.river*=this.dx*w;
    // All proposed component states are valid. Commit together, retaining the same arrays.
    this.h.set(this.nh);this.q.set(this.nq);this.fall.volume=stored.fall;this.poolStorage.volume=stored.pool;this.oceanStorage.volume=stored.ocean;
    for(const k of Object.keys(this.roundoff))this.roundoff[k]+=stored[k]-raw[k];for(const k of Object.keys(transfer))this.ledger[k]+=transfer[k];
    this.time+=dt;this.steps++;this.minDt=this.minDt===0?dt:Math.min(this.minDt,dt);this.maxDt=Math.max(this.maxDt,dt);this.maxCFL=Math.max(this.maxCFL,dt*speeds.fastest/this.dx);this.maxStorage=Math.max(this.maxStorage,dt*storageRate);this.lastTransfer={dt,...transfer};
    this.profile.faces_ms+=afterFaces-begin;this.profile.policy_ms+=afterPolicy-afterFaces;this.profile.update_ms+=afterUpdate-afterPolicy;this.profile.audit_commit_ms+=performance.now()-afterUpdate;return dt;
  }
  advanceSteps(count){if(!Number.isInteger(count)||count<0||count>20000)throw Error('steps must be 0..20000');for(let i=0;i<count;i++)this.step();}
  advanceSeconds(seconds){finite(seconds,'duration',1e-8,120);let left=seconds,steps=0;while(left>1e-11){if(++steps>50000)throw Error('duration step budget');left-=this.step(left);}}
  measure(){const v=this.volumes(),l=this.ledger,residuals={fall:v.fall-this.initial.fall-l.supply+l.landing,pool:v.pool-this.initial.pool-l.landing+l.pool_river,river:v.river-this.initial.river-l.pool_river+l.river_ocean,ocean:v.ocean-this.initial.ocean-l.river_ocean+l.export};
    const corrected=Object.fromEntries(Object.entries(residuals).map(([k,x])=>[k,x-this.roundoff[k]]));return {time_s:this.time,steps:this.steps,cells:this.n,volumes_m3:v,total_m3:sum(Object.values(v)),pool_stage_m:this.poolStorage.stage(),ocean_stage_m:this.oceanStorage.stage(),fall_delay_s:this.fall.delay,flux_integrals_m3:{...l},roundoff_m3:{...this.roundoff},component_raw_residual_m3:residuals,component_corrected_residual_m3:corrected,raw_residual_m3:sum(Object.values(v))-sum(Object.values(this.initial))-l.supply+l.export,corrected_residual_m3:sum(Object.values(v))-sum(Object.values(this.initial))-l.supply+l.export-sum(Object.values(this.roundoff)),min_depth_m:Math.min(...this.h),max_depth_m:Math.max(...this.h),min_dt_s:this.minDt,max_dt_s:this.maxDt,max_face_cfl:this.maxCFL,max_storage_number:this.maxStorage};
  }
  checkpoint(){const state={schema:'ecf-storage-coupled-state/v2',kernel_sha256:KERNEL_SHA,config:structuredClone(this.config),physics_options:Object.fromEntries(PHYS.map(k=>[k,this.options[k]])),bed_sha256:digest([...this.bed]),h:[...this.h],q:[...this.q],volumes:{fall:this.fall.volume,pool:this.poolStorage.volume,ocean:this.oceanStorage.volume},time:this.time,steps:this.steps,initial:{...this.initial},ledger:{...this.ledger},roundoff:{...this.roundoff},maxCFL:this.maxCFL,maxStorage:this.maxStorage,minDt:this.minDt,maxDt:this.maxDt,lastTransfer:this.lastTransfer?{...this.lastTransfer}:null};return {...state,integrity_sha256:digest(state)};}
  static restore(checkpoint,organization={}){
    const {integrity_sha256,...s}=checkpoint;if(s.schema!=='ecf-storage-coupled-state/v2'||s.kernel_sha256!==KERNEL_SHA||digest(s)!==integrity_sha256)throw Error('checkpoint kernel/integrity mismatch');
    for(const k of Object.keys(organization))if(!['organization','partitions','exchange'].includes(k))throw Error('restore can only override organization');
    const solver=new CoupledSolver(s.config,{...s.physics_options,...organization});
    try{if(s.bed_sha256!==digest([...solver.bed]))throw Error('bed mismatch');for(const k of['h','q'])if(!Array.isArray(s[k])||s[k].length!==solver.n||!s[k].every(Number.isFinite))throw Error('invalid checkpoint array');
      if(!s.h.every(x=>x>=.02)||!Number.isInteger(s.steps)||s.steps<0||s.steps>10000000)throw Error('invalid checkpoint state');
      for(const k of['time','maxCFL','maxStorage','minDt','maxDt'])finite(s[k],k,0);
      const keys={volumes:['fall','ocean','pool'],initial:['fall','ocean','pool','river'],roundoff:['fall','ocean','pool','river'],ledger:['export','landing','pool_river','river_ocean','supply']};
      for(const group of Object.keys(keys)){if(Object.keys(s[group]).sort().join(',')!==keys[group].join(','))throw Error('invalid checkpoint ledger shape');for(const x of Object.values(s[group]))finite(x,group);}
      if(digest(s.initial)!==digest(solver.initial))throw Error('initial inventory inconsistent with configuration');
      if(s.steps===0&&(s.time!==0||s.minDt!==0||s.maxDt!==0||s.lastTransfer!==null)||s.steps>0&&(!(s.minDt>0)||s.maxDt<s.minDt||s.time<s.steps*s.minDt-1e-7||s.time>s.steps*s.maxDt+1e-7))throw Error('checkpoint time history inconsistent');
      const arithmeticTolerance=64*Number.EPSILON*(s.steps+1)*Math.max(1,sum(Object.values(s.initial))+Math.abs(s.ledger.supply)+Math.abs(s.ledger.export));
      const exactSupply=sourceIntegral(s.time,solver.fall.source),exactLanding=sourceIntegral(s.time-solver.fall.delay,solver.fall.source)-sourceIntegral(-solver.fall.delay,solver.fall.source);
      if(Math.abs(s.ledger.supply-exactSupply)>arithmeticTolerance||Math.abs(s.ledger.landing-exactLanding)>arithmeticTolerance)throw Error('source/delay phase ledger inconsistent');
      if(s.physics_options.precision==='f64'){
        if(Object.values(s.roundoff).some(x=>x!==0))throw Error('f64 roundoff must be zero');
      }else{
        // Independent conservative envelope from nonnegative inventories, declared supply,
        // maximum possible external import, and f32 relative rounding error per step.
        // It is an error bound, never authentication of an arbitrary caller's history.
        const oc=s.config.ocean,importCap=Math.max(0,-oc.base_export-oc.rating*(oc.min_stage-oc.external_stage-oc.tide_amplitude));
        const epsilon=2**-24,ratio=epsilon*s.steps;
        const maxInventory=(sum(Object.values(s.initial))+Math.max(0,exactSupply)+importCap*s.time)/(1-ratio);
        const envelope=ratio*maxInventory+arithmeticTolerance;
        if(Object.values(s.roundoff).some(x=>Math.abs(x)>envelope))throw Error('f32 quantization envelope exceeded');
      }
      solver.poolStorage.validate(s.volumes.pool);solver.oceanStorage.validate(s.volumes.ocean);if(s.volumes.fall<0)throw Error('negative waterfall');
      solver.h.set(s.h);solver.q.set(s.q);solver.fall.volume=s.volumes.fall;solver.poolStorage.volume=s.volumes.pool;solver.oceanStorage.volume=s.volumes.ocean;
      for(const k of['time','steps','initial','ledger','roundoff','maxCFL','maxStorage','minDt','maxDt','lastTransfer'])solver[k]=structuredClone(s[k]);
      const m=solver.measure();if(Math.max(...Object.values(m.component_corrected_residual_m3).map(Math.abs))>arithmeticTolerance)throw Error('restored budget inconsistent');
      if(solver.checkpoint().integrity_sha256!==integrity_sha256)throw Error('checkpoint not representable in selected precision');return solver;
    }catch(error){void solver.close();throw error;}
  }
  organization(){return {organization:this.options.organization,partitions:this.options.partitions,exchange:this.options.exchange,internal_interfaces:this.options.partitions+2,physical_links:3,external_links:2,river_seams:this.options.partitions-1,barriers:this.barriers,copied_interfaces:this.copied,profile_ms:{...this.profile},changes:structuredClone(this.changes),serial_components:['face assembly','shared timestep','reservoir proposals','ordered budget audit/commit']};}
  async reorganize(partitions,organization,exchange=this.options.exchange){const {o}=checked(this.config,{...this.options,partitions,organization,exchange});const candidate=o.organization==='partitioned-workers'?this.makePool(o):null,old=this.pool;await old?.close();this.pool=candidate;this.options=o;this.changes.push({at_step:this.steps,partitions,organization,exchange});}
  async close(){if(this.closed)return;this.closed=true;await this.pool?.close();}
}
