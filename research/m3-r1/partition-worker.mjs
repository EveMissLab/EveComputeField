import { workerData } from 'node:worker_threads';
import { updateRange } from './numerics.mjs';
const { buffers, precision, n, start, end } = workerData;
const Type = precision === 'f64' ? Float64Array : Float32Array;
const h = new Type(buffers.h), q = new Type(buffers.q), nh = new Type(buffers.nh), nq = new Type(buffers.nq);
const fh = new Float64Array(buffers.fh), fq = new Float64Array(buffers.fq);
const control = new Int32Array(buffers.control), parameters = new Float64Array(buffers.parameters);
let last = 0;
Atomics.add(control, 4, 1); Atomics.notify(control, 4);
while (true) {
  let epoch = Atomics.load(control, 0);
  if (epoch === last) { Atomics.wait(control, 0, last); continue; }
  last = epoch;
  if (Atomics.load(control, 1) === 3) break;
  const failed = updateRange(h, q, fh, fq, nh, nq, start, end, parameters[0], parameters[1], parameters[2]);
  if (failed >= 0) Atomics.compareExchange(control, 3, 0, failed + 1);
  Atomics.add(control, 2, 1); Atomics.notify(control, 2);
}
