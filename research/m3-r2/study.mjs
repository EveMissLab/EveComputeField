import { performance } from 'node:perf_hooks';import os from 'node:os';import { mkdir,writeFile } from 'node:fs/promises';import path from 'node:path';import { fileURLToPath } from 'node:url';import assert from 'node:assert/strict';
import { CoupledSolver,KERNEL_SHA } from './solver.mjs';import { Waterfall,sourceIntegral } from './components.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.join(here,'results');await mkdir(out,{recursive:true});
const runID=new Date().toISOString(),cases=[];
async function trial(label,config={},options={},duration=6,group='stability'){
  let s,row;const start=performance.now();try{s=new CoupledSolver(config,options);let left=duration,count=0;while(left>1e-11){if(++count>25000)throw Error('bounded study step budget exceeded');left-=s.step(left);}
    row={label,group,config:s.config,options:s.options,outcome:'completed',metrics:s.measure(),state_sha256:s.checkpoint().integrity_sha256};
  }catch(e){let atomic=null;if(s){const before=s.checkpoint().integrity_sha256;try{s.step();}catch{atomic=s.checkpoint().integrity_sha256===before;}}
    row={label,group,config:s?.config??config,options:s?.options??options,outcome:'refused',reason:e.message,metrics:s?.measure(),repeat_rejected_step_preserves_state:atomic};
  }finally{await s?.close();}row.elapsed_ms=performance.now()-start;cases.push(row);return row;
}
for(const cells of[32,96,256,512])for(const dt_max of[.01,.03,.1])for(const precision of['f64','f32-state'])await trial(`grid-${cells}-dt-${dt_max}-${precision}`,{cells},{dt_max,precision});
for(const[pool,ocean]of[[.05,.5],[.5,20],[30,600]])for(const storage_guard of[true,false])for(const precision of['f64','f32-state'])await trial(`storage-${pool}-${ocean}-guard-${storage_guard}-${precision}`,{pool:{area:pool},ocean:{area:ocean}},{storage_guard,precision},3,'storage');
for(const[area,label]of[[3,'small'],[30,'base'],[300,'large']])await trial(`pool-response-${label}`,{pool:{area},source:{kind:'pulse',amplitude:1,at:1,duration:2}}, {},10,'physical-response');
for(const[area,label]of[[6,'small'],[600,'base'],[6000,'large']])await trial(`ocean-response-${label}`,{ocean:{area,tide_amplitude:.5,tide_period:4}}, {},10,'physical-response');
for(const height of[0,4.905,49.05])await trial(`fall-height-${height}`,{fall_height:height,source:{kind:'step',amplitude:1,at:1}}, {},8,'physical-response');
for(const kind of['step','pulse','sine'])await trial(`source-${kind}`,{source:{kind,amplitude:.9,at:1,duration:1.5,period:3}}, {},8,'forcing');
await trial('external-net-import',{ocean:{base_export:-1,rating:.5,tide_amplitude:.4}}, {},8,'forcing');
await trial('reverse-river-flow',{pool:{stage:1.7},ocean:{stage:2.2,base_export:0,external_stage:2.2},initial_q:-.4}, {},8,'forcing');
await trial('near-dry-export-refusal',{ocean:{area:.01,stage:.40001,base_export:100}}, {},1,'boundary-negative');
await trial('fixed-large-step',{cells:512},{dt_max:1,time_mode:'fixed',storage_guard:false},4,'numerical-negative');
await trial('unsafe-CFL',{cells:512,source:{kind:'step',amplitude:10,at:.05}},{cfl:4,dt_max:1,storage_guard:false},4,'numerical-negative');
await trial('broken-component-ledger',{}, {fault:'missing-pool-debit'},1,'ledger-negative');
// Exact and refinement references, distinct from conservation checks.
const fixtures={};
let s=new CoupledSolver({source:{base:0},pool:{stage:2.2},ocean:{stage:2.2,external_stage:2.2,base_export:0},initial_q:0});
try{const h=[...s.h];s.advanceSeconds(12);fixtures.lake_at_rest={metrics:s.measure(),max_q_m2_s:Math.max(...s.q.map(Math.abs)),max_depth_change_m:Math.max(...s.h.map((x,i)=>Math.abs(x-h[i])))};}finally{await s.close();}
s=new CoupledSolver({bed_up:0,bed_down:0,roughness:0,initial_q:.8,source:{base:.8},pool:{bottom:0,stage:1.2,min_stage:.02},ocean:{stage:1.2,external_stage:1.2,base_export:.8}});
try{s.advanceSeconds(12);fixtures.uniform_flow={metrics:s.measure(),max_depth_error_m:Math.max(...s.h.map(x=>Math.abs(x-1.2))),max_q_error_m2_s:Math.max(...s.q.map(x=>Math.abs(x-.8)))};}finally{await s.close();}
const fall=new Waterfall({height:4.905,source:{kind:'pulse',base:1,amplitude:2,at:1,duration:1}}),delay=[];let t=0;
for(let i=0;i<16;i++){const p=fall.propose(t,.25);fall.commit(p);t+=.25;const exact=sourceIntegral(t,fall.source)-sourceIntegral(t-fall.delay,fall.source);delay.push({time_s:t,air_m3:fall.volume,analytic_air_m3:exact,landing_m3:p.landing});assert.ok(Math.abs(fall.volume-exact)<1e-12);}
fixtures.delay={tau_s:fall.delay,trace:delay};
const refinement=[];for(const dt_max of[.04,.02,.01,.005]){s=new CoupledSolver({source:{kind:'sine',amplitude:.6,period:3},ocean:{tide_amplitude:.2}},{dt_max});try{s.advanceSeconds(6);refinement.push({dt_max,metrics:s.measure(),h:[...s.h],q:[...s.q]});}finally{await s.close();}}
const reference=refinement.at(-1);for(const r of refinement)r.depth_l1_vs_dt005_m=r.h.reduce((a,x,i)=>a+Math.abs(x-reference.h[i]),0)/r.h.length;
fixtures.timestep_refinement={reference:'finest dt=.005 at same grid, not exact physical truth',rows:refinement.map(({h,q,...r})=>r)};
// Hot continuation: every configuration gets one warm-up of 80 steps and 10 calls of 80.
// The call trajectory is dependent, not 10 independent initial conditions.
const complexity=[],expected=new Map();let index=0;
const arms=[];for(const cells of[96,512])for(const partitions of[1,2,4,8])for(const organization of(partitions===1?['monolithic']:['partitioned-serial','partitioned-workers']))for(const exchange of['direct','message-copy'])arms.push({cells,partitions,organization,exchange});
// Deterministically interleave arms so one mode does not own every cold/hot position.
arms.sort((a,b)=>((a.partitions*17+a.cells+(a.exchange==='direct'?3:11)+(a.organization==='partitioned-workers'?7:0))%31)-((b.partitions*17+b.cells+(b.exchange==='direct'?3:11)+(b.organization==='partitioned-workers'?7:0))%31));
for(const arm of arms){const {cells,...options}=arm,start=performance.now(),rssBefore=process.memoryUsage().rss;const a=new CoupledSolver({cells},options),setup=performance.now()-start,hbuf=a.h.buffer,qbuf=a.q.buffer,pool=a.pool;try{
  a.advanceSteps(80);const profileBefore={...a.profile},rows=[];for(let call=0;call<10;call++){const begin=performance.now();a.advanceSteps(80);rows.push(performance.now()-begin);}
  const ordered=[...rows].sort((a,b)=>a-b),cp=a.checkpoint(),wanted=expected.get(cells);if(wanted)assert.equal(cp.integrity_sha256,wanted);else expected.set(cells,cp.integrity_sha256);
  complexity.push({...arm,execution_order:index++,setup_ms:setup,calls:10,steps_per_call:80,warmup_steps:80,samples_ms:rows,median_ms:(ordered[4]+ordered[5])/2,p95_ms:ordered[9],min_ms:ordered[0],max_ms:ordered[9],time_s:a.time,physical_state_sha256:cp.integrity_sha256,all_organizations_exact:true,buffers_reused:hbuf===a.h.buffer&&qbuf===a.q.buffer,pool_reused:pool===a.pool,worker_pool_creations:pool?1:0,host_rss_before: rssBefore,host_rss_after:process.memoryUsage().rss,organization:a.organization(),measured_profile_ms:Object.fromEntries(Object.keys(a.profile).map(k=>[k,a.profile[k]-profileBefore[k]]))});
}finally{await a.close();}}
const ordinary=cases.filter(x=>!x.group.includes('negative')&&x.outcome==='completed'),maximum=(key,precision)=>Math.max(...ordinary.filter(x=>x.options.precision===precision).map(x=>Math.abs(x.metrics[key])));
const summary={total_cases:cases.length,completed:cases.filter(x=>x.outcome==='completed').length,refused:cases.filter(x=>x.outcome==='refused').length,f64_max_raw_residual_m3:maximum('raw_residual_m3','f64'),f32_max_raw_residual_m3:maximum('raw_residual_m3','f32-state'),f32_max_corrected_residual_m3:maximum('corrected_residual_m3','f32-state'),complexity_arms:complexity.length,complexity_calls:complexity.length*10,exact_organization_equivalence:true};
const report={schema:'ecf-m3-r2-study/v2',created_utc:runID,kernel_sha256:KERNEL_SHA,host:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length},summary,cases,fixtures,complexity,limits:['Synthetic reduced models; no measured natural site validation','Worker mode parallelizes only river cell updates; other work serial','message-copy is local structuredClone; no network/distributed scaling measured','Hot call samples are dependent and include phase changes along a trajectory','f32-state arithmetic remains double; explicit storage quantization ledger','Storage guard is a heuristic, not a universal stability proof','No 3D impact, wet/dry front, overflow, Coriolis or ocean-wave model']};
await writeFile(path.join(out,'study.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary));
