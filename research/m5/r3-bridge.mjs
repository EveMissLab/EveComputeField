// ODTS-style ordinal-depth scheduling over the existing R3 full physical oracle.
// R3 has globally coupled timestep/storage. NEVER infer a local PDE influence
// cone from a synthetic CA neighborhood; candidate advances are full R3 solves.
import {OrdinalDepthField} from './ordinal-field.mjs';
import {NetworkSolver,KERNEL_SHA} from '../m3-r3/solver.mjs';

export const R3_DEPTH_SCHEMA='ecf-m5-r3-checkpoint/v1';
function decode(bytes){
  if(!Buffer.isBuffer(bytes))throw Error('checkpoint wire input must be Buffer');
  const record=JSON.parse(bytes.toString('utf8'));
  if(record.schema!==R3_DEPTH_SCHEMA||!record.checkpoint?.metadata||
      record.checkpoint.metadata.kernel_sha256!==KERNEL_SHA)throw Error('R3 checkpoint/model mismatch');
  return record.checkpoint;
}
function encode(cp){return Buffer.from(JSON.stringify({schema:R3_DEPTH_SCHEMA,checkpoint:cp}),'utf8');}
export function depthEvent(steps=1){
  if(!Number.isSafeInteger(steps)||steps<1||steps>32)throw Error('invalid physical step count');
  return {kind:'advance',data:{steps}};
}
export async function advanceR3Checkpoint(input,event){
  if(event?.kind!=='advance'||!Number.isSafeInteger(event?.data?.steps)||
      event.data.steps<1||event.data.steps>32)throw Error('unknown/unsafe R3 temporal event');
  const s=NetworkSolver.restore(decode(input),{workers:0});
  try{s.advanceSteps(event.data.steps);return encode(s.checkpoint());}
  finally{await s.close();}
}
export function stateFromBytes(bytes){return decode(bytes).integrity_sha256;}
export async function createR3DepthField({graph,fieldId='fluid-depth',horizon=3,
  worldRevision='river-v1',maxPendingBytes=16*1024*1024}={}){
  const solver=new NetworkSolver(graph,{workers:0});
  let initial;
  try{initial=encode(solver.checkpoint());}finally{await solver.close();}
  const field=new OrdinalDepthField({fieldId,initial,horizon,worldRevision,
    modelRevision:'r3-'+KERNEL_SHA.slice(0,24),maxPendingBytes,
    maxFrameBytes:maxPendingBytes,transition:advanceR3Checkpoint,
    observe:async(bytes,context)=>Buffer.from(JSON.stringify({
      ordinal:context.absolute_ordinal,physical_state_sha256:stateFromBytes(bytes)}))});
  return {field,initial_state:Buffer.from(initial),kernel_sha256:KERNEL_SHA};
}
export const verifyR3Candidate=async (parent,event,candidate)=>{
  // Strict independent recomputation. This is a correctness diagnostic and
  // deliberately charges a full R3 solve; NOT a speedup-enabled commit.
  return (await advanceR3Checkpoint(parent,event)).equals(candidate);
};
