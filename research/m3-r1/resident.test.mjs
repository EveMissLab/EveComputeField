import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentManager } from './resident-manager.mjs';
import { ResearchSolver } from './solver.mjs';
test('resident calls retain the same arrays and worker pool',async()=>{
  const events=[],manager=new ResidentManager(async(id,e)=>events.push(e)),reference=new ResearchSolver();
  try{manager.create('resident-test',{}, {partitions:2,organization:'partitioned-workers'});const e=manager.entry('resident-test'),pool=e.solver.pool,buffer=e.solver.h.buffer;
    for(let i=0;i<10;i++)await manager.advance('resident-test',20);reference.advanceSteps(200);
    assert.equal(e.solver.pool,pool);assert.equal(e.solver.h.buffer,buffer);assert.equal(manager.view('resident-test').worker_pool_creations,1);
    assert.equal(manager.view('resident-test').state_sha256,reference.checkpoint().integrity_sha256);assert.equal(events.length,10);
    const s=await manager.snapshot('resident-test');assert.equal(s.receipt.state_after_sha256,s.checkpoint.integrity_sha256);
  }finally{await manager.close();await reference.close();}
});
test('queued resident calls serialize and restore a saved state and receipt head',async()=>{
  const a=new ResidentManager(),b=new ResidentManager();
  try{a.create('queue-test');await Promise.all(Array.from({length:4},()=>a.advance('queue-test',10)));const saved=await a.snapshot('queue-test');
    b.create('queue-test',{},saved.options,saved.checkpoint,saved.receipt);await b.advance('queue-test',10);await a.advance('queue-test',10);
    assert.equal(a.view('queue-test').state_sha256,b.view('queue-test').state_sha256);
  }finally{await a.close();await b.close();}
});
test('checkpoint persistence holds the queue until the exact state/receipt pair is saved',async()=>{
  const m=new ResidentManager();let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  try{m.create('persist-test');await m.advance('persist-test',10);
    const saving=m.persist('persist-test',async envelope=>{entered();await gate;return envelope;});await started;
    const advancing=m.advance('persist-test',10);await new Promise(r=>setTimeout(r,10));
    assert.equal(m.view('persist-test').metrics.steps,10);release();const saved=await saving;await advancing;
    assert.equal(saved.checkpoint.steps,10);assert.equal(saved.receipt.state_after_sha256,saved.checkpoint.integrity_sha256);assert.equal(m.view('persist-test').metrics.steps,20);
  }finally{release?.();await m.close();}
});
test('failed delayed association never permits an advance or receipt',async()=>{
  const events=[],m=new ResidentManager(async(id,event)=>events.push(event));let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  try{
    const creating=m.createAndBind('binding-fail',{}, {},null,null,async()=>{entered();await gate;throw Error('forced binding failure');});
    const creationRejected=assert.rejects(creating,/association save failed/);await started;
    const advancing=m.advance('binding-fail',10),advanceRejected=assert.rejects(advancing,/audit recovery/);
    await new Promise(r=>setTimeout(r,10));assert.equal(m.view('binding-fail').metrics.steps,0);assert(m.view('binding-fail').pending_association);
    release();await creationRejected;await advanceRejected;assert.equal(m.view('binding-fail').metrics.steps,0);assert.equal(events.length,0);assert(m.view('binding-fail').blocked);
  }finally{release?.();await m.close();}
});
test('delayed successful association enables queued advance only after binding',async()=>{
  const m=new ResidentManager();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  try{const creating=m.createAndBind('binding-ok',{}, {},null,null,async()=>{entered();await gate;});await started;const advancing=m.advance('binding-ok',10);
    await new Promise(r=>setTimeout(r,10));assert.equal(m.view('binding-ok').metrics.steps,0);release();await creating;await advancing;assert.equal(m.view('binding-ok').metrics.steps,10);assert(!m.view('binding-ok').blocked);
  }finally{release?.();await m.close();}
});
