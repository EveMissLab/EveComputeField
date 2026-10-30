import test from 'node:test';import assert from 'node:assert/strict';
import { ResidentManager } from './resident-manager.mjs';
test('association is reserved before await and blocks racing advance',async()=>{
  const m=new ResidentManager();let release;const gate=new Promise(r=>release=r),creating=m.createAndBind('pending',{}, {},null,null,()=>gate);
  const advancing=m.advance('pending',10);assert.equal(m.entry('pending').pending,true);release();try{await creating;await advancing;assert.equal(m.view('pending').metrics.steps,10);}finally{await m.close();}
});
test('failed association cannot advance or save',async()=>{
  const m=new ResidentManager();try{await assert.rejects(m.createAndBind('bad',{}, {},null,null,async()=>{throw Error('injected');}),/association/);await assert.rejects(m.advance('bad',1),/blocked/);await assert.rejects(m.snapshot('bad'),/blocked/);}finally{await m.close();}
});
test('queued save holds transition while later advance waits; hot arrays reused',async()=>{
  const m=new ResidentManager();try{await m.createAndBind('retained',{}, {partitions:2,organization:'partitioned-workers'},null,null);await m.advance('retained',10);let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
    let saved;const saving=m.persist('retained',async snapshot=>{saved=snapshot;entered();await gate;return snapshot;});await ready;const advancing=m.advance('retained',10);assert.equal(m.view('retained').metrics.steps,10);release();await saving;await advancing;assert.equal(saved.checkpoint.steps,10);assert.equal(m.view('retained').metrics.steps,20);assert.equal(m.view('retained').worker_pool_creations,1);assert.equal(m.view('retained').buffers_reused,true);
  }finally{await m.close();}
});
test('audit append failure keeps accepted RAM state and blocks further calls',async()=>{
  const m=new ResidentManager(async()=>{throw Error('injected disk failure');});try{await m.createAndBind('audit',{}, {},null,null);await assert.rejects(m.advance('audit',2),/audit append/);assert.equal(m.view('audit').metrics.steps,2);await assert.rejects(m.advance('audit',1),/blocked/);}finally{await m.close();}
});
