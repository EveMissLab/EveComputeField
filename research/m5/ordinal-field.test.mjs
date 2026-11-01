import test from 'node:test';import assert from 'node:assert/strict';
import {OrdinalDepthField} from './ordinal-field.mjs';
const B=n=>{const b=Buffer.alloc(8);b.writeBigInt64BE(BigInt(n));return b;};
const n=b=>Number(b.readBigInt64BE());
const event=(step=1)=>({kind:'advance',data:{step}});
const transition=async(payload,e)=>B(n(payload)+e.data.step);
const observe=async(payload,ctx)=>Buffer.from(`ordinal ${ctx.absolute_ordinal}: ${n(payload)}`);
const make=()=>new OrdinalDepthField({initial:B(0),transition,observe,horizon:4});

test('multi-ordinal deepest READY physics precedes shallow observer; no speculative commit',async()=>{
  const f=make();f.predict('A',[event(1),event(2),event(3)]);
  const ready=await f.computeBudget(3);
  assert.deepEqual(ready.map(x=>[x.role,x.ordinal]),[['physics',1],['physics',2],['physics',3]]);
  assert.equal(f.head.ordinal,0);assert.equal(n(f.head.payload),0);
  assert.equal(n(f.candidate('A',3).payload),6);
  await f.computeBudget(3);assert.equal(f.stats.observers,3);
  const r=await f.commit(event(1));assert.equal(r.reused,true);assert.equal(r.ordinal,1);
  assert.equal(f.head.parent_digest,f.trace()[0].digest);
  assert.equal(n(f.head.payload),1);assert.equal(n(f.candidate('A',3).payload),6);
  assert.equal((await f.commit(event(2))).reused,true);
  assert.equal((await f.commit(event(3))).reused,true);
  assert.equal(n(f.head.payload),6);
});

test('actual unexpected event forces reactive fallback and invalidates prior descendants',async()=>{
  const f=make();f.predict('A',[event(1),event(1)]);await f.computeBudget(3);
  const r=await f.commit(event(5));assert.equal(r.reused,false);
  assert.equal(n(f.head.payload),5);assert.equal(f.stats.candidates,0);
  assert.equal(f.trace().length,2);assert.equal(f.head.ordinal,1);
});

test('multi-branch inherited prefix checked; changed event invalidates deeper cone only',async()=>{
  const f=make();f.predict('A',[event(1),event(1),event(1)]);
  f.predict('B',[event(1),event(2),event(2)],{parentBranch:'A',forkDepth:2});
  assert.throws(()=>f.predict('bad',[event(5),event(2)],{parentBranch:'A',forkDepth:2}),/pre-fork/);
  await f.computeBudget(14);
  assert.equal(n(f.candidate('B',3).payload),5);
  assert.equal(n(f.candidate('A',3).payload),3);
  f.replaceBranchTail('B',3,[event(4)]);
  assert.equal(f.candidate('B',2)!==null,true);
  assert.equal(f.candidate('B',3),null);
  await f.computeBudget(5);assert.equal(n(f.candidate('B',3).payload),7);
  assert.equal((await f.commit(event(1))).reused,true);
  assert.equal(f.candidate('B',3)!==null,true);
  const result=await f.commit(event(2));assert.equal(result.reused,true);
  assert.equal(f.candidate('A',3),null);
  assert.equal((await f.commit(event(4))).reused,true);
  assert.equal(n(f.head.payload),7);
});

test('world/model changes invalidate all predictions; output buffers cannot mutate field',async()=>{
  const f=make();f.predict('A',[event(1),event(2)]);await f.computeBudget(3);
  const copy=f.candidate('A',1);copy.payload.fill(0xFF);
  assert.equal(n(f.candidate('A',1).payload),1);
  assert.equal(f.setWorldRevision('world-v1'),2);
  assert.equal(f.stats.candidates,0);assert.equal((await f.commit(event(7))).reused,false);
  f.predict('B',[event(1)]);await f.computeBudget(1);
  assert.equal(f.setModelRevision('model-v2'),1);
  assert.equal((await f.commit(event(1))).reused,false);
});

test('commit verification denial never promotes candidate; failure preserves authoritative head',async()=>{
  const f=make();f.predict('A',[event(1)]);await f.computeBudget(1);
  const denied=await f.commit(event(1),{verifyCandidate:async()=>false});
  assert.equal(denied.reused,false);assert.equal(n(f.head.payload),1);
  const broken=new OrdinalDepthField({initial:B(0),transition:()=>{throw Error('kernel failed');}});
  await assert.rejects(broken.commit(event(1)),/kernel failed/);assert.equal(broken.head.ordinal,0);
});

test('candidate bytes quota and invalid event versions fail closed',async()=>{
  const f=new OrdinalDepthField({initial:B(0),transition,observe:null,maxPendingBytes:12,maxFrameBytes:8,horizon:2});
  assert.throws(()=>f.predict('bad',[{kind:'oops',data:{x:Infinity}}]),/finite JSON/);
  f.predict('A',[event(1),event(1)]);
  await assert.rejects(f.computeBudget(2),/budget/);
  assert.equal(f.head.ordinal,0);assert.equal(f.stats.candidates,1);
  const o=new OrdinalDepthField({initial:B(0),transition,horizon:0});
  assert.throws(()=>o.predict('A',[event()]),/branch or depth budget/);
});
