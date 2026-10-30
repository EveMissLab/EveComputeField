import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMemoryDomain, observeR3Banks} from './memory.mjs';

test('virtual domain owns a zero-copy shared backing with checked offsets',()=>{
  const d=new VirtualMemoryDomain({fieldId:'field-A',quotaBytes:64});
  const h=d.allocate({name:'water_h',type:'f64',elements:4});
  const view=d.view(h,{write:true});view[0]=2.75;
  assert.equal(d.view(h,{offset:0,elements:1})[0],2.75);
  assert.equal(d.describe().mapped_bytes,32);
  assert.throws(()=>d.view(h,{offset:4,elements:1}),/length/);
  assert.throws(()=>d.allocate({name:'too-big',elements:5}),/quota/);
  assert.throws(()=>d.borrow({name:'alias',buffer:view.buffer}),/aliased/);
});
test('remap requires quiescence, invalidates old handles, does not promise revocation',()=>{
  const d=new VirtualMemoryDomain({fieldId:'f',quotaBytes:100});
  const h=d.allocate({name:'bank',elements:4}),v=d.view(h,{write:true});v[0]=9;
  const replacement=new SharedArrayBuffer(32);
  assert.throws(()=>d.rebind('bank',replacement,{expectedGeneration:1}),/quiescent/);
  assert.throws(()=>d.rebind('bank',new SharedArrayBuffer(16),{expectedGeneration:1,quiescent:true}),/shape/);
  const newHandle=d.rebind('bank',replacement,{expectedGeneration:1,quiescent:true});
  assert.equal(newHandle.generation,2);
  assert.throws(()=>d.view(h),/stale/);
  assert.equal(d.view(newHandle)[0],0);
  assert.equal(v[0],9); // raw pre-existing views cannot be revoked
});
test('read-only mapping denies write *requests*, but not raw JS aliasing',()=>{
  const d=new VirtualMemoryDomain({fieldId:'f'}),h=d.borrow({name:'x',type:'u8',access:'read-only',buffer:new SharedArrayBuffer(8)});
  assert.throws(()=>d.view(h,{write:true}),/read-only/);
  const other={...h,field_id:'another-field'};
  assert.throws(()=>d.view(other),/foreign/);
});
test('R3 state bank observation flips logical active handle without copying arrays',()=>{
  const buffers={};for(const n of ['h0','q0','h1','q1'])buffers[n]=new SharedArrayBuffer(64);
  const solver={buffers,bank:0,options:{precision:'f64'}};
  const catalog=observeR3Banks(solver,{fieldId:'f'});
  assert.equal(catalog.active().h.name,'h0');
  solver.bank=1;
  assert.equal(catalog.active().h.name,'h1');
  catalog.domain.view(catalog.active().h,{write:true})[0]=7;
  assert.equal(new Float64Array(buffers.h1)[0],7);
  assert.equal(catalog.domain.describe().mapped_bytes,256);
});
