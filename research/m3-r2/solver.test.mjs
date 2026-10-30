import test from 'node:test';
import assert from 'node:assert/strict';
import { CoupledSolver,digest } from './solver.mjs';
import { Waterfall, Reservoir } from './components.mjs';

test('free-fall step reaches basin after delay, inventory closes exactly', () => {
  const w = new Waterfall({height:4.905,source:{kind:'step',base:1,amplitude:2,at:2}});
  assert.equal(w.delay,1);
  const p=w.propose(0,2.5); assert.equal(p.supply,3.5); assert.equal(p.landing,2.5); assert.equal(p.volume,2);
  w.commit(p); const q=w.propose(2.5,1); assert.equal(q.supply,3); assert.equal(q.landing,2); assert.equal(q.volume,3);
});
test('reservoir stage and signed rating are independent of river',()=>{
  const r=new Reservoir({area:10,bottom:0,stage:2,min_stage:.02});
  assert.equal(r.volume,20); assert.equal(r.stage(),2);
  assert.equal(r.propose(3,-2,1),25); assert.throws(()=>r.propose(0,100,1),/wet|storage/);
});
test('lake at rest over sloped bed remains still with four inventories',async()=>{
  const s=new CoupledSolver({source:{base:0},pool:{stage:2.2},ocean:{stage:2.2,external_stage:2.2,base_export:0},initial_q:0});
  try {const before=[...s.h];s.advanceSteps(400);assert.ok(Math.max(...s.q.map(Math.abs))<1e-12);assert.ok(Math.max(...s.h.map((h,i)=>Math.abs(h-before[i])))<1e-12);assert.ok(Math.abs(s.measure().raw_residual_m3)<1e-10);} finally {await s.close();}
});
test('flat frictionless uniform moving water is steady',async()=>{
  const s=new CoupledSolver({bed_up:0,bed_down:0,roughness:0,initial_q:.8,source:{base:.8},pool:{bottom:0,stage:1.2,min_stage:.02},ocean:{stage:1.2,external_stage:1.2,base_export:.8}});
  try{s.advanceSteps(300);assert.ok(Math.max(...s.h.map(h=>Math.abs(h-1.2)))<1e-12);assert.ok(Math.max(...s.q.map(q=>Math.abs(q-.8)))<1e-12);}finally{await s.close();}
});
test('serial partitions and actual workers have identical physical trajectories',async()=>{
  const config={cells:64,source:{kind:'pulse',base:1,amplitude:1,at:.2,duration:.7},ocean:{tide_amplitude:.2,tide_period:3}};
  const a=new CoupledSolver(config),b=new CoupledSolver(config,{partitions:4,organization:'partitioned-serial',exchange:'message-copy'}),c=new CoupledSolver(config,{partitions:4,organization:'partitioned-workers'});
  try{for(const s of[a,b,c])s.advanceSteps(240);assert.deepEqual(b.checkpoint(),a.checkpoint());assert.deepEqual(c.checkpoint(),a.checkpoint());assert.ok(c.organization().barriers===240);assert.ok(b.organization().copied_interfaces>0);}finally{await Promise.all([a.close(),b.close(),c.close()]);}
});
test('checkpoint during pulse and tide restores exact phase and continuation',async()=>{
  const a=new CoupledSolver({source:{kind:'pulse',base:1,amplitude:.8,at:.4,duration:1},ocean:{tide_amplitude:.2,tide_period:4}});let b;
  try{a.advanceSteps(38);b=CoupledSolver.restore(a.checkpoint(),{partitions:2,organization:'partitioned-workers'});a.advanceSteps(100);b.advanceSteps(100);assert.deepEqual(b.checkpoint(),a.checkpoint());}finally{await a.close();await b?.close();}
});
test('unbalanced interface negative control rejects before physical commit',async()=>{
  const s=new CoupledSolver({}, {fault:'missing-pool-debit'});try{const before=s.checkpoint();assert.throws(()=>s.step(),/budget/);assert.deepEqual(s.checkpoint(),before);}finally{await s.close();}
});
test('float32 raw drift is exposed separately from corrected budgets',async()=>{
  const s=new CoupledSolver({}, {precision:'f32-state'});try{s.advanceSteps(1000);const m=s.measure();assert.ok(Math.abs(m.raw_residual_m3)>1e-9);assert.ok(Math.abs(m.corrected_residual_m3)<1e-9);assert.ok(m.max_face_cfl<=.39+1e-12);}finally{await s.close();}
});
test('small independent storage adapts common step and remains wet',async()=>{
  const s=new CoupledSolver({pool:{area:.1},ocean:{area:1}});try{s.advanceSteps(300);const m=s.measure();assert.ok(m.min_dt_s<.01);assert.ok(m.max_storage_number<=.25+1e-12);assert.ok(Math.abs(m.corrected_residual_m3)<1e-9);}finally{await s.close();}
});
test('reorganization preserves state; failed replacement preserves working pool',async()=>{
  const s=new CoupledSolver({}, {partitions:2,organization:'partitioned-workers'});try{s.advanceSteps(10);const before=s.checkpoint(),old=s.pool;s.makePool=()=>{throw Error('injected startup failure');};await assert.rejects(s.reorganize(4,'partitioned-workers'),/startup/);assert.equal(s.pool,old);assert.deepEqual(s.checkpoint(),before);await s.reorganize(4,'partitioned-serial');assert.deepEqual(s.checkpoint(),before);s.advanceSteps(2);}finally{await s.close();}
});
test('invalid geometry, nonfinite forcing and tampered checkpoint are refused',async()=>{
  assert.throws(()=>new CoupledSolver({width:0}));assert.throws(()=>new CoupledSolver({pool:{area:-1}}));assert.throws(()=>new CoupledSolver({source:{base:NaN}}));
  const s=new CoupledSolver();try{const cp=s.checkpoint();cp.h[0]+=1;assert.throws(()=>CoupledSolver.restore(cp),/integrity/);}finally{await s.close();}
});
test('rehashed ledger corruption cannot use roundoff as an arbitrary compensator',async()=>{
  for(const precision of['f64','f32-state']){const s=new CoupledSolver({}, {precision});try{s.advanceSteps(60);const cp=s.checkpoint();cp.volumes.pool+=1;cp.roundoff.pool+=1;const {integrity_sha256,...body}=cp;cp.integrity_sha256=digest(body);assert.throws(()=>CoupledSolver.restore(cp),/roundoff|envelope/);}finally{await s.close();}}
});
test('valid f32 checkpoint resumes inside independent quantization envelope',async()=>{
  const s=new CoupledSolver({}, {precision:'f32-state'});let b;try{s.advanceSteps(1000);b=CoupledSolver.restore(s.checkpoint());s.advanceSteps(40);b.advanceSteps(40);assert.deepEqual(s.checkpoint(),b.checkpoint());}finally{await s.close();await b?.close();}
});
