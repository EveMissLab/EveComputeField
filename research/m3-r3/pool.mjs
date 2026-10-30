import { Worker } from 'node:worker_threads';import { performance } from 'node:perf_hooks';
const shared=(T,n)=>new T(new SharedArrayBuffer(T.BYTES_PER_ELEMENT*n));
export class TilePool{
  constructor(s,workers){this.count=workers;this.control=shared(Int32Array,6);const buffers={...s.buffers,control:this.control.buffer};
    this.workers=Array.from({length:workers},(_,p)=>new Worker(new URL('./partition-worker.mjs',import.meta.url),{workerData:{buffers,layout:s.layout,precision:s.options.precision,start:Math.floor(p*s.layout.tiles.length/workers),end:Math.floor((p+1)*s.layout.tiles.length/workers)},execArgv:[]}));
    for(const w of this.workers)w.on('error',e=>this.error=e);const deadline=performance.now()+15000;while(true){const ready=Atomics.load(this.control,4);if(ready>=workers)break;if(performance.now()>deadline){for(const w of this.workers)w.terminate();throw Error('R3 worker startup timeout');}Atomics.wait(this.control,4,ready,100);}
  }
  phase(phase,bank){if(this.error)throw this.error;Atomics.store(this.control,2,0);Atomics.store(this.control,3,0);Atomics.store(this.control,5,bank);Atomics.store(this.control,1,phase);Atomics.add(this.control,0,1);Atomics.notify(this.control,0);const deadline=performance.now()+30000;
    while(true){const done=Atomics.load(this.control,2);if(done>=this.count)break;if(performance.now()>deadline)throw Error('R3 barrier timeout');Atomics.wait(this.control,2,done,100);}if(Atomics.load(this.control,3))throw Error('R3 worker numerical exception');
  }
  async close(){Atomics.store(this.control,1,3);Atomics.add(this.control,0,1);Atomics.notify(this.control,0);await Promise.all(this.workers.map(w=>w.terminate()));}
}
