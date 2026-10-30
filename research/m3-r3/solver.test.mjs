import test from 'node:test';import assert from 'node:assert/strict';
import { NetworkSolver,makeNetwork } from './solver.mjs';
import { CoupledSolver } from '../m3-r2/solver.mjs';
import { digest } from '../m3-r2/util.mjs';
test('branched lake-at-rest keeps each reach and reservoir still',async()=>{
  const g=makeNetwork({trunk:3,tributaries:4,cells:64,still:true}),s=new NetworkSolver(g);try{const before=s.checkpoint();s.advanceSteps(80);assert.ok(Math.max(...s.q.map(Math.abs))<1e-11);assert.ok(Math.max(...s.h.map((h,i)=>Math.abs(h-before.h[i])))<1e-11);assert.ok(Math.abs(s.measure().raw_residual_m3)<1e-9);}finally{await s.close();}
});
test('flat uniform branched flow balances source, junctions and export',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:3,tributaries:3,cells:64,uniform:true}));try{const before=[...s.h],v=[...s.nodeV];s.advanceSteps(80);assert.ok(Math.max(...s.h.map((h,i)=>Math.abs(h-before[i])))<1e-12);assert.ok(Math.max(...s.nodeV.map((x,i)=>Math.abs(x-v[i])))<1e-11);}finally{await s.close();}
});
test('all partition modes have exactly the same network state',async()=>{
  const g=makeNetwork({trunk:3,tributaries:3,cells:512,pulse:true,tide:.2}),a=new NetworkSolver(g),b=new NetworkSolver(g,{workers:2,mode:'cells-only'}),c=new NetworkSolver(g,{workers:4,mode:'fused',exchange:'message-copy'});
  try{for(const s of[a,b,c])s.advanceSteps(120);assert.equal(a.stateHash(),b.stateHash());assert.equal(a.stateHash(),c.stateHash());assert.ok(c.organization().barriers===240);}finally{await Promise.all([a.close(),b.close(),c.close()]);}
});
test('checkpoint restores source phase, tributary ledgers and exact continuation',async()=>{
  const a=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:128,pulse:true,tide:.2}));let b;try{a.advanceSteps(70);b=NetworkSolver.restore(a.checkpoint(),{workers:2});a.advanceSteps(80);b.advanceSteps(80);assert.equal(a.stateHash(),b.stateHash());}finally{await a.close();await b?.close();}
});
test('broken confluence transfer rejects without swapping any physical bank',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:64}),{fault:'missing-node-debit'});try{const before=s.stateHash(),bank=s.bank;assert.throws(()=>s.step(),/budget/);assert.equal(s.bank,bank);assert.equal(s.stateHash(),before);}finally{await s.close();}
});
test('f32 storage roundoff is explicit and valid restart remains equivalent',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:64}),{precision:'f32-state'});let b;try{s.advanceSteps(100);const m=s.measure();assert.ok(Math.abs(m.corrected_residual_m3)<1e-8);assert.ok(Math.abs(m.raw_residual_m3)>1e-9);b=NetworkSolver.restore(s.checkpoint());assert.equal(s.stateHash(),b.stateHash());}finally{await s.close();await b?.close();}
});
test('invalid graph, duplicate edge and invalid worker layout refused',()=>{
  const g=makeNetwork({trunk:2,tributaries:1,cells:32});const bad=structuredClone(g);bad.reaches[0].from=999;assert.throws(()=>new NetworkSolver(bad));const dup=structuredClone(g);dup.reaches.push({...dup.reaches[0]});assert.throws(()=>new NetworkSolver(dup));assert.throws(()=>new NetworkSolver(g,{workers:32}));
});
test('single reach agrees with R2 to 1e-11 despite graph summation order',async()=>{
  const a=new NetworkSolver(makeNetwork({trunk:1,tributaries:0,cells:128})),b=new CoupledSolver({cells:128,initial_q:1,pool:{min_stage:1.13},ocean:{bottom:.33,min_stage:.41,base_export:1}});
  try{a.advanceSteps(80);b.advanceSteps(80);assert.equal(a.time,b.time);assert.ok(Math.max(...a.h.map((x,i)=>Math.abs(x-b.h[i])))<1e-11);assert.ok(Math.max(...a.q.map((x,i)=>Math.abs(x-b.q[i])))<1e-11);assert.ok(Math.abs(a.nodeV[0]-b.poolStorage.volume)<1e-11);assert.ok(Math.abs(a.nodeV[1]-b.oceanStorage.volume)<1e-11);}finally{await a.close();await b.close();}
});
test('node stiffness includes every incoming tributary and outgoing reach',async()=>{
  const g=makeNetwork({trunk:2,tributaries:4,cells:16,area:.1}),s=new NetworkSolver(g,{dt_max:1});try{s.step();const response=new Array(g.nodes.length).fill(0);for(const e of s.layout.reaches){response[e.from]+=e.width*s.v.boundarySpeed[2*e.index]/g.nodes[e.from].area;response[e.to]+=e.width*s.v.boundarySpeed[2*e.index+1]/g.nodes[e.to].area;}for(let i=0;i<g.nodes.length;i++)response[i]+=(g.nodes[i].external?.rating??0)/g.nodes[i].area;assert.ok(Math.abs(s.maxStorage-.25)<1e-12);assert.equal(s.maxStorage,s.time*Math.max(...response));}finally{await s.close();}
});
test('semantic f64 roundoff forgery is refused even if metadata hash is not the cause',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:2,tributaries:1,cells:64}));try{s.advanceSteps(10);const cp=s.checkpoint();cp.metadata.nodeV[0]+=1;cp.metadata.roundoff.nodes[0]+=1;assert.throws(()=>NetworkSolver.restore(cp),/roundoff/);}finally{await s.close();}
});
test('failed worker replacement leaves the original pool and state usable',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:128}),{workers:2});try{s.advanceSteps(4);const hash=s.stateHash(),pool=s.pool;s.makePool=()=>{throw Error('injected replacement failure');};await assert.rejects(s.reorganize(4),/replacement/);assert.equal(s.pool,pool);assert.equal(s.stateHash(),hash);s.advanceSteps(4);}finally{await s.close();}
});
test('candidate worker pool is closed if old pool close fails',async()=>{
  const s=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:512}),{workers:2});const oldClose=s.pool.close.bind(s.pool),make=s.makePool;let candidate;
  try{s.makePool=n=>(candidate=make(n));s.pool.close=async()=>{throw Error('injected close failure');};const hash=s.stateHash();await assert.rejects(s.reorganize(4),/close failure/);assert.ok(candidate.workers.every(w=>w.threadId===-1));assert.equal(s.options.workers,2);assert.equal(s.stateHash(),hash);}finally{s.pool.close=oldClose;await s.close();}
});
