import test from 'node:test';import assert from 'node:assert/strict';
import {makeNetwork} from '../m3-r3/solver.mjs';
import {createR3DepthField,advanceR3Checkpoint,depthEvent,
  stateFromBytes,verifyR3Candidate} from './r3-bridge.mjs';

test('real R3 waterfall/river/ocean state agrees with ordinal candidates and actual events',async()=>{
  const graph=makeNetwork({trunk:2,tributaries:2,cells:32,pulse:true,tide:.2});
  const {field,initial_state}=await createR3DepthField({graph,horizon:3});
  field.predict('A',[depthEvent(2),depthEvent(1),depthEvent(2)],{priority:3});
  field.predict('B',[depthEvent(2),depthEvent(2),depthEvent(1)],{parentBranch:'A',forkDepth:2});
  const work=await field.computeBudget(20);
  assert.ok(work.some(x=>x.ordinal===3&&x.role==='physics'));
  assert.equal(field.head.ordinal,0);
  let oracle=Buffer.from(initial_state);
  for(const e of [depthEvent(2),depthEvent(2),depthEvent(1)]){
    oracle=await advanceR3Checkpoint(oracle,e);
    const receipt=await field.commit(e,{verifyCandidate:verifyR3Candidate});
    assert.equal(receipt.reused,true);
    assert.equal(stateFromBytes(field.head.payload),stateFromBytes(oracle));
    assert.ok(field.head.payload.equals(oracle));
  }
  assert.equal(field.head.ordinal,3);
  assert.equal(field.stats.pending_bytes,0);
});

test('unpredicted event and world revision preserve physical full-step equivalence',async()=>{
  const graph=makeNetwork({trunk:2,tributaries:2,cells:16});
  const {field,initial_state}=await createR3DepthField({graph,horizon:2});
  field.predict('A',[depthEvent(2),depthEvent(2)]);
  await field.computeBudget(3);
  field.setWorldRevision('changed-tide-policy');
  let oracle=await advanceR3Checkpoint(initial_state,depthEvent(1));
  const r=await field.commit(depthEvent(1));
  assert.equal(r.reused,false);
  assert.equal(stateFromBytes(field.head.payload),stateFromBytes(oracle));
});
