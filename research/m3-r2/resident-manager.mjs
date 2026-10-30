import { performance } from 'node:perf_hooks';
import { CoupledSolver,KERNEL_SHA,digest } from './solver.mjs';
export function validateReceipt(receipt){if(!receipt)return;const {receipt_sha256,...c}=receipt;if(c.schema!=='ecf-storage-resident-receipt/v2'||c.kernel_sha256!==KERNEL_SHA||digest(c)!==receipt_sha256)throw Error('receipt integrity/kernel mismatch');}
export class ResidentManager{
  constructor(eventSink=async()=>{}){this.entries=new Map();this.eventSink=eventSink;}
  entry(id){const e=this.entries.get(id);if(!e)throw Error('resident id not found');return e;}
  async createAndBind(id,config,options,checkpoint,receipt,bind=async()=>{}){
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(id??''))throw Error('invalid id');if(this.entries.has(id)||this.entries.size>=4)throw Error('resident duplicate/capacity');validateReceipt(receipt);
    if(receipt&&(receipt.field_id!==id||receipt.state_after_sha256!==checkpoint?.integrity_sha256))throw Error('receipt state/field mismatch');
    if((checkpoint?.physics_options??options)?.fault&& (checkpoint?.physics_options??options).fault!=='none')throw Error('fault mode is offline-only');
    const start=performance.now(),s=checkpoint?CoupledSolver.restore(checkpoint,options):new CoupledSolver(config,options);
    const e={id,solver:s,head:receipt??null,queue:Promise.resolve(),blocked:true,pending:true,calls:0,poolCreations:s.pool?1:0,initialH:s.h.buffer,initialQ:s.q.buffer,initialPool:s.pool,setup_ms:performance.now()-start};this.entries.set(id,e);
    const result=e.queue.then(async()=>{try{await bind(e);e.pending=false;e.blocked=false;return this.view(id);}catch(error){e.pending=false;throw Error(`association failed; RAM retained and blocked: ${error.message}`);}});e.queue=result.catch(()=>{});return result;
  }
  queued(id,action){const e=this.entry(id),result=e.queue.then(()=>{if(e.blocked)throw Error('resident blocked pending association/audit recovery');return action(e);});e.queue=result.catch(()=>{});return result;}
  view(id){const e=this.entry(id);return {id,metrics:e.solver.measure(),organization:e.solver.organization(),state_sha256:e.solver.checkpoint().integrity_sha256,receipt_head:e.head?.receipt_sha256??null,advance_calls:e.calls,worker_pool_creations:e.poolCreations,buffers_reused:e.solver.h.buffer===e.initialH&&e.solver.q.buffer===e.initialQ,original_pool_reused:e.solver.pool===e.initialPool,setup_ms:e.setup_ms,rss_bytes:process.memoryUsage().rss,blocked:e.blocked,pending_association:e.pending};}
  async record(e,before,kind){if(e.head&&e.head.state_after_sha256!==before.integrity_sha256){e.blocked=true;throw Error('audit state divergence');}const after=e.solver.checkpoint();
    const c={schema:'ecf-storage-resident-receipt/v2',kernel_sha256:KERNEL_SHA,field_id:e.id,sequence:(e.head?.sequence??-1)+1,previous_sha256:e.head?.receipt_sha256??null,kind,state_before_sha256:before.integrity_sha256,state_after_sha256:after.integrity_sha256,from_step:before.steps,to_step:after.steps,from_time_s:before.time,to_time_s:after.time,organization:{partitions:e.solver.options.partitions,organization:e.solver.options.organization,exchange:e.solver.options.exchange}};
    const receipt={...c,receipt_sha256:digest(c)};try{await this.eventSink(e.id,receipt);}catch(error){e.blocked=true;throw Error(`audit append failed; valid RAM state retained and blocked: ${error.message}`);}e.head=receipt;
  }
  advance(id,steps){return this.queued(id,async e=>{if(!Number.isInteger(steps)||steps<0||steps>10000)throw Error('steps must be 0..10000');const before=e.solver.checkpoint(),start=performance.now();try{e.solver.advanceSteps(steps);}catch(error){e.blocked=true;throw Error(`advance stopped at last accepted step; RAM retained and blocked: ${error.message}`);}const compute=performance.now()-start;e.calls++;await this.record(e,before,'advance');return {...this.view(id),compute_ms:compute,total_with_audit_ms:performance.now()-start};});}
  reorganize(id,partitions,organization,exchange){return this.queued(id,async e=>{const before=e.solver.checkpoint(),old=e.solver.pool;await e.solver.reorganize(partitions,organization,exchange);if(e.solver.pool&&e.solver.pool!==old)e.poolCreations++;await this.record(e,before,'quiescent-reorganization');return this.view(id);});}
  persist(id,save){return this.queued(id,e=>save({schema:'ecf-storage-resident-checkpoint/v2',checkpoint:e.solver.checkpoint(),options:{organization:e.solver.options.organization,partitions:e.solver.options.partitions,exchange:e.solver.options.exchange},receipt:e.head}));}
  snapshot(id){return this.persist(id,async snapshot=>snapshot);}
  async close(){for(const e of this.entries.values()){await e.queue;await e.solver.close();}}
}
