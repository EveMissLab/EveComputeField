import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlacement, selectPlacement, applyPlacement} from './planner.mjs';

const layout = (edges = 4, tilesPerEdge = 4) => ({
  cells: edges * tilesPerEdge * 256,
  reaches: Array.from({length: edges}, (_, edge) => ({index: edge, cells: tilesPerEdge * 256})),
  tiles: Array.from({length: edges * tilesPerEdge}, (_, t) => ({edge: Math.floor(t / tilesPerEdge),
    start: (t % tilesPerEdge) * 256, end: (t % tilesPerEdge + 1) * 256})),
});
const sha = 'b'.repeat(64);
const proof = {graphSha256:sha,kernelSha256:sha,expectedHost:{cpu:'synthetic test only'}};
const evidence = (L, speed = 1.4, identical = true) => ({schema:'ecf-m4-matched-probes/v1',cells:L.cells,
  tile_count:L.tiles.length,kernel_sha256:sha,graph_sha256:sha,host:{cpu:'synthetic test only'},
  arms:[{workers:4,mode:'fused',exchange:'direct',setup_ms:1,pairs:Array.from({length:8},(_,i)=>({
    block: Math.floor(i/4),serial_ms:14,parallel_ms:14/speed,identical_state:identical}))}]});

test('360 and 720 logical units map onto the *same* four physical R3 workers',()=>{
  const L=layout(),a=createPlacement({fieldId:'f',logicalUnits:360,layout:L,workers:4});
  const b=createPlacement({fieldId:'f',logicalUnits:720,layout:L,workers:4});
  assert.equal(a.tiles.length,16); assert.equal(a.active_logical_units,16);
  assert.deepEqual(a.tiles.map(x=>x.worker),b.tiles.map(x=>x.worker));
  assert.notEqual(a.mapping_sha256,b.mapping_sha256);
  assert.deepEqual(a.ranges.map(x=>x.end_tile-x.start_tile),[4,4,4,4]);
  assert.equal(a.worker_seams,0); // cuts occur on physical reach boundaries
  assert.equal(createPlacement({logicalUnits:1,layout:L,workers:0}).active_logical_units,1);
});
test('reject invalid mapping and inconsistent tile ownership',()=>{
  const L=layout();
  assert.throws(()=>createPlacement({logicalUnits:0,layout:L}),/logical/);
  assert.throws(()=>createPlacement({logicalUnits:720,layout:L,workers:9}),/worker/);
  const bad=structuredClone(L);bad.tiles[2].start+=10;
  assert.throws(()=>createPlacement({logicalUnits:360,layout:bad}),/contiguous/);
  assert.throws(()=>createPlacement({logicalUnits:360,layout:L,mode:'shell'}),/strategy/);
});
test('selection requires two matched-state blocks and setup-amortized benefit',()=>{
  const L=layout();
  const ok=selectPlacement({logicalUnits:360,layout:L,...proof,evidence:evidence(L),expectedCalls:20});
  assert.equal(ok.placement.workers,4);assert.equal(ok.selected.passes_operational_gate,true);
  assert.equal(selectPlacement({logicalUnits:360,layout:L,...proof,evidence:evidence(L,1.05),expectedCalls:20}).placement.workers,0);
  assert.equal(selectPlacement({logicalUnits:360,layout:L,...proof,evidence:evidence(L,1.4,false),expectedCalls:20}).placement.workers,0);
  const costly=evidence(L);costly.arms[0].setup_ms=100;
  assert.equal(selectPlacement({logicalUnits:360,layout:L,...proof,evidence:costly,expectedCalls:1}).placement.workers,0);
  const mismatched=evidence(L);mismatched.tile_count++;
  assert.throws(()=>selectPlacement({logicalUnits:360,layout:L,...proof,evidence:mismatched}),/unbound/);
});
test('applyPlacement validates digest and confirms state and backing invariants',async()=>{
  const L=layout(),buf=new SharedArrayBuffer(64);
  const solver={layout:L,options:{workers:0,mode:'fused',exchange:'direct'},buffers:{h0:buf},
    stateHash:()=>sha,async reorganize(w,m,e){this.options={workers:w,mode:m,exchange:e};}};
  const mapping=createPlacement({fieldId:'f',logicalUnits:360,layout:L,workers:4});
  const receipt=await applyPlacement(solver,mapping);
  assert.equal(solver.options.workers,4);assert.equal(receipt.physical_state_unchanged,true);
  await assert.rejects(applyPlacement(solver,{...mapping,mapping_sha256:'0'.repeat(64)}),/tampered/);
});
