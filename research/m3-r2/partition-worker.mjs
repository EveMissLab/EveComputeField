import { workerData } from 'node:worker_threads';
import { updateRange } from './numerics.mjs';
const {buffers,precision,start,end}=workerData,T=precision==='f64'?Float64Array:Float32Array;
const h=new T(buffers.h),q=new T(buffers.q),[fh,fl,fr,nh,nq]=['fh','fl','fr','nh','nq'].map(k=>new Float64Array(buffers[k]));
const control=new Int32Array(buffers.control),parameters=new Float64Array(buffers.parameters);let last=0;
Atomics.add(control,4,1);Atomics.notify(control,4);
while(true){const epoch=Atomics.load(control,0);if(epoch===last){Atomics.wait(control,0,last);continue;}last=epoch;if(Atomics.load(control,1)===3)break;
  const failed=updateRange(h,q,fh,fl,fr,nh,nq,start,end,parameters[0],parameters[1],parameters[2]);
  if(failed>=0)Atomics.compareExchange(control,3,0,failed+1);Atomics.add(control,2,1);Atomics.notify(control,2);
}
