import test from 'node:test';import assert from 'node:assert/strict';import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';import path from 'node:path';import { fileURLToPath } from 'node:url';
import { NetworkSolver,makeNetwork } from './solver.mjs';import { BlobStore } from './blob-store.mjs';
const base=path.join(path.dirname(fileURLToPath(import.meta.url)),'.runtime/test-blobs');await mkdir(base,{recursive:true});
test('large binary sidecar reads same state and rejects corrupted array bytes',async()=>{
  const root=await mkdtemp(path.join(base,'witness-')),store=new BlobStore(root),s=new NetworkSolver(makeNetwork({trunk:2,tributaries:2,cells:4096}));let b;
  try{s.advanceSteps(12);const manifest=await store.save(s.capture());assert.ok(Buffer.byteLength(JSON.stringify(manifest))<65536);b=NetworkSolver.restore(await store.read(manifest),{workers:2});assert.equal(b.stateHash(),s.stateHash());const corrupt=Buffer.alloc(manifest.arrays.h.bytes);await writeFile(store.file(manifest.arrays.h.sha256),corrupt);await assert.rejects(store.read(manifest),/hash/);}finally{await s.close();await b?.close();}
});
