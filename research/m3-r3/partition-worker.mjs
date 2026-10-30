import { workerData } from 'node:worker_threads';import { views,prepare,update } from './tile-kernel.mjs';
const {buffers,layout,precision,start,end}=workerData,v=views(buffers,precision),control=new Int32Array(buffers.control);let last=0;
Atomics.add(control,4,1);Atomics.notify(control,4);
while(true){const epoch=Atomics.load(control,0);if(epoch===last){Atomics.wait(control,0,last);continue;}last=epoch;const phase=Atomics.load(control,1);if(phase===3)break;
  try{const bank=Atomics.load(control,5);if(phase===1)prepare(v,layout,start,end,bank);else update(v,layout,start,end,bank,precision);}catch{Atomics.store(control,3,1);}
  Atomics.add(control,2,1);Atomics.notify(control,2);
}
