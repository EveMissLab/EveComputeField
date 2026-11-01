import test from 'node:test';
import assert from 'node:assert/strict';
import {ConeMemoryField,fullConeStep,normalizeConeEvent,fluidR3InfluencePolicy} from './cone-memory.mjs';
const I={kind:'inertial'};
const P=(...cells)=>({kind:'pulse',cells});
const seed=(w,h)=>{const b=Buffer.alloc(w*h);let x=0x9e3779b9;
  for(let i=0;i<b.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;b[i]=(x>>>0)%5===0?1:0;}return b;};
function oracle(initial,w,h,events){let b=Buffer.from(initial);for(const e of events)b=fullConeStep(b,w,h,e);return b;}

// This oracle deliberately has no access to VMD handles, staged cones or branch caches.
test('sparse VMD/causal cone computes exact multi-ordinal physical states, with actual reductions',()=>{
  const w=32,h=32,initial=seed(w,h),f=new ConeMemoryField({width:w,height:h,initial,horizon:4,tileCells:64,threshold:.40});
  try{
    const seq=[P(3,4),I,I,I];f.predict('A',seq);
    const work=f.computeBudget(4);
    assert.equal(work.length,4);assert.equal(f.head.ordinal,0);
    for(let t=1;t<=4;t++){
      assert.ok(f.verifyFull('A',t));
      assert.deepEqual(f.inspect('A',t),oracle(initial,w,h,seq.slice(0,t)));
    }
    assert.ok(f.stats.candidate_cells<4*w*h);
    assert.ok(f.stats.region_bytes>=5*w*h);
    assert.ok(f.memory.regions.some(x=>x.name.startsWith('r')));
    const old=f.stats.region_bytes;
    assert.equal(f.cancelBranch('A'),true);
    assert.equal(f.stats.region_bytes,5*w*h);
    assert.ok(old>f.stats.region_bytes);
  } finally {assert.equal(f.close(),0);}
});

test('branch lineage and inherited prefix share physical backing without sharing authority',()=>{
  const w=24,h=24,initial=seed(w,h),f=new ConeMemoryField({width:w,height:h,initial,horizon:3});
  try{
    const a=[P(1),I,I],b=[P(1),P(13),I];
    f.predict('A',a,{priority:3});f.predict('B',b,{parentBranch:'A',forkDepth:2});
    assert.throws(()=>f.predict('bad',[P(2),I,I],{parentBranch:'A',forkDepth:2}),/prefix/);
    const work=f.computeBudget(20);
    assert.equal(work.length,6);
    assert.ok(f.stats.alias_frames>=1);
    for(const id of ['A','B'])for(let t=1;t<=3;t++)assert.ok(f.verifyFull(id,t));
    assert.equal(f.getCandidate('A',1).content_merkle_sha256,f.getCandidate('B',1).content_merkle_sha256);
    assert.notEqual(f.getCandidate('A',1).lineage_digest,f.getCandidate('B',1).lineage_digest);
    const r1=f.commit(P(1));assert.equal(r1.reused,true);
    const r2=f.commit(P(13));assert.equal(r2.reused,true);
    const r3=f.commit(I);assert.equal(r3.reused,true);
    assert.equal(f.head.ordinal,3);
    assert.deepEqual(f.readHead(),oracle(initial,w,h,b));
  }finally{assert.equal(f.close(),0);}
});

test('unexpected actual input reacts with full work and invalidates incompatible future cones',()=>{
  const initial=seed(16,16),f=new ConeMemoryField({width:16,height:16,initial,horizon:3});
  try{
    f.predict('predicted',[P(1),I,I]);f.computeBudget(5);
    const r=f.commit(P(250));
    assert.equal(r.reused,false);assert.equal(r.pending_frames,0);
    assert.deepEqual(f.readHead(),oracle(initial,16,16,[P(250)]));
    assert.equal(f.commit(I).reused,false);
    assert.deepEqual(f.readHead(),oracle(initial,16,16,[P(250),I]));
  }finally{assert.equal(f.close(),0);}
});

test('global events and very broad influence fall back to exact full evaluation',()=>{
  const initial=seed(16,16);
  const a=new ConeMemoryField({width:16,height:16,initial,horizon:2,threshold:.02});
  const b=new ConeMemoryField({width:16,height:16,initial,horizon:2,threshold:.9});
  try{
    a.predict('A',[P(0,1,2,3,4,5),I]);b.predict('B',[{kind:'global-invert'},I]);
    const x=a.computeBudget(2),y=b.computeBudget(2);
    assert.equal(x[0].reason,'coverage-fallback');
    assert.equal(y[0].reason,'global-event');
    assert.equal(a.verifyFull('A',2),true);
    assert.equal(b.verifyFull('B',2),true);
    assert.equal(a.stats.full_fallbacks>=1,true);
    assert.equal(b.stats.full_fallbacks>=1,true);
  }finally{a.close();b.close();}
  assert.equal(fluidR3InfluencePolicy().mode,'global-full');
});

test('memory quota rejects candidate without leaked regions or speculative authority',()=>{
  const initial=seed(16,16),f=new ConeMemoryField({width:16,height:16,initial,horizon:2,
    tileCells:64,threshold:1,quotaBytes:3*256+30});
  try{
    f.predict('A',[P(1),I]);const before=f.memory.mapped_bytes;
    assert.throws(()=>f.computeBudget(1),/quota/);
    assert.equal(f.stats.pending_frames,0);
    assert.equal(f.memory.mapped_bytes,before);
    assert.equal(f.head.ordinal,0);
  }finally{assert.equal(f.close(),0);}
});

test('revision drift blocks speculation and promotion rather than silently reusing stale memory',()=>{
  const f=new ConeMemoryField({width:16,height:16,initial:seed(16,16),horizon:2});
  try{
    f.predict('A',[P(0),I]);f.computeBudget(2);
    assert.equal(f.setWorldRevision('world-revised'),2);
    assert.equal(f.blocked,true);
    assert.throws(()=>f.computeBudget(2),/rebase/);
    assert.throws(()=>f.commit(P(0)),/rebase/);
    assert.equal(f.stats.region_bytes,3*256);
  }finally{assert.equal(f.close(),0);}
});

test('event validator rejects unknown effects, duplicate coordinates and unsupported globals',()=>{
  assert.throws(()=>normalizeConeEvent({kind:'pulse',cells:[3,3]},128),/invalid/);
  assert.throws(()=>normalizeConeEvent({kind:'pulse',cells:[128]},128),/invalid/);
  assert.throws(()=>normalizeConeEvent({kind:'run-script',code:'rm -rf'},128),/unsupported/);
  assert.throws(()=>normalizeConeEvent({kind:'inertial',unsafe:true},128),/unexpected/);
});

test('toroidal wrap and changed baseline forcing are included in selective dependence',()=>{
  const width=20,height=20,initial=seed(width,height),baseline=[P(0,19,380,399),I,I],
    candidate=[P(1,18,381,398),I,P(0)];
  const f=new ConeMemoryField({width,height,initial,baselineEvents:baseline,horizon:3,threshold:.75,tileCells:20});
  try{
    f.predict('alternative',candidate);const records=f.computeBudget(3);
    assert.equal(records.length,3);
    for(let k=1;k<=3;k++)assert.deepEqual(f.inspect('alternative',k),
      oracle(initial,width,height,candidate.slice(0,k)));
    assert.equal(records[0].receipt_sha256.length,64);
    assert.equal(records[0].event_sha256.length,64);
    assert.equal(records[0].parent_content_merkle_sha256.length,64);
  }finally{assert.equal(f.close(),0);}
});

test('deterministic multi-seed, two-branch, six-depth parity with independent full oracle',()=>{
  for(let seedNum=0;seedNum<12;seedNum++){
    const width=16,height=16,initial=Buffer.alloc(width*height),horizon=6;
    for(let i=0;i<initial.length;i++)initial[i]=((i*37+seedNum*13)%(23+seedNum))<4?1:0;
    const eventsA=Array.from({length:horizon},(_,i)=>i===2?P((seedNum*13+i)%256):I);
    const eventsB=Array.from({length:horizon},(_,i)=>i===0?P((seedNum*31+5)%256):i===3?P((seedNum*7+101)%256):I);
    const f=new ConeMemoryField({width,height,initial,horizon,tileCells:16,threshold:.25});
    try{
      f.predict('A',eventsA);f.predict('B',eventsB);
      assert.equal(f.computeBudget(12).length,12);
      for(const [branch,events] of [['A',eventsA],['B',eventsB]])
        for(let t=1;t<=horizon;t++)assert.deepEqual(f.inspect(branch,t),
          oracle(initial,width,height,events.slice(0,t)));
      assert.equal(f.head.ordinal,0);
    } finally {assert.equal(f.close(),0);}
  }
});

test('cancelling a parent invalidates descendant candidate lineages and releases space',()=>{
  const initial=seed(16,16),f=new ConeMemoryField({width:16,height:16,initial,horizon:3});
  try{
    f.predict('A',[P(1),I,I]);f.predict('B',[P(1),P(2),I],{parentBranch:'A',forkDepth:2});
    f.computeBudget(6);assert.ok(f.stats.region_bytes>4*256);
    assert.equal(f.cancelBranch('A'),true);
    assert.equal(f.stats.pending_frames,0);
    assert.equal(f.stats.branches,0);
    assert.equal(f.stats.region_bytes,4*256);
  }finally{assert.equal(f.close(),0);}
});

test('new branch after unexpected commit uses true baseline delta, never false sparse reuse',()=>{
  const w=24,h=24,initial=seed(w,h),f=new ConeMemoryField({width:w,height:h,initial,horizon:4});
  try{
    f.predict('bad',[P(1),I,I,I]);f.computeBudget(4);
    const first=f.commit(P(99));assert.equal(first.reused,false);
    f.predict('continued',[P(99),I,P(14),I]);
    const records=f.computeBudget(3);assert.equal(records.length,3);
    for(let t=2;t<=4;t++)assert.deepEqual(f.inspect('continued',t),
      oracle(initial,w,h,[P(99),I,P(14),I].slice(0,t)));
  }finally{assert.equal(f.close(),0);}
});

test('baseline reservation requires quota for all planned ordinals before allocation',()=>{
  assert.throws(()=>new ConeMemoryField({width:16,height:16,initial:seed(16,16),
    horizon:4,quotaBytes:1024}),/baseline exceeds/);
});

test('optional full-oracle gate charges whole-grid work and verifies staged commit',()=>{
  const f=new ConeMemoryField({width:16,height:16,initial:seed(16,16),horizon:2});
  try{f.predict('A',[P(1),I]);f.computeBudget(2);
    const before=f.stats.oracle_cells;
    assert.equal(f.commit(P(1),{verifyFull:true}).reused,true);
    assert.equal(f.stats.oracle_cells-before,256);
    assert.equal(f.commit(I,{verifyFull:true}).reused,true);
    assert.equal(f.stats.oracle_cells-before,512);
  }finally{assert.equal(f.close(),0);}
});


test('branch fork cannot claim missing parent events as inherited ancestry',()=>{
  const f=new ConeMemoryField({width:16,height:16,initial:seed(16,16),horizon:4});
  try{f.predict('A',[I]);
    assert.throws(()=>f.predict('B',[I,I,I,I],{parentBranch:'A',forkDepth:4}),/parent prefix/);
    assert.equal(f.stats.branches,1);
  }finally{assert.equal(f.close(),0);}
});
