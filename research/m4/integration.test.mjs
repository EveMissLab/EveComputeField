import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkSolver,makeNetwork} from '../m3-r3/solver.mjs';
import {createPlacement, applyPlacement} from './planner.mjs';
import {observeR3Banks} from './memory.mjs';

test('M4 maps actual R3 tile pool and switches execution without changing physics or SAB banks',async()=>{
  const graph=makeNetwork({trunk:2,tributaries:2,cells:64,pulse:true,tide:.2});
  const serial=new NetworkSolver(graph),adaptive=new NetworkSolver(graph);
  try{
    const catalog=observeR3Banks(adaptive,{fieldId:'r3-m4'});
    const hRef=adaptive.buffers.h0, prior=adaptive.stateHash();
    const plan=createPlacement({fieldId:'r3-m4',logicalUnits:720,layout:adaptive.layout,workers:2});
    const receipt=await applyPlacement(adaptive,plan);
    assert.equal(receipt.state_sha256,prior);
    assert.strictEqual(adaptive.buffers.h0,hRef);
    assert.equal(catalog.active().h.name,'h0');
    serial.advanceSteps(32);adaptive.advanceSteps(32);
    assert.equal(serial.stateHash(),adaptive.stateHash());
    assert.equal(catalog.domain.view(catalog.active().h)[0],adaptive.h[0]);
    const reverse=createPlacement({fieldId:'r3-m4',logicalUnits:360,layout:adaptive.layout,workers:0});
    await applyPlacement(adaptive,reverse);
    serial.advanceSteps(32);adaptive.advanceSteps(32);
    assert.equal(serial.stateHash(),adaptive.stateHash());
  } finally {await Promise.all([serial.close(),adaptive.close()]);}
});
