import { mkdir,readFile,open,link,unlink,stat } from 'node:fs/promises';import path from 'node:path';import { randomUUID,createHash } from 'node:crypto';import { digest,KERNEL_SHA } from './solver.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export class BlobStore{
  constructor(root){this.root=path.resolve(root);}
  file(sha){if(!/^[0-9a-f]{64}$/.test(sha))throw Error('invalid blob hash');return path.join(this.root,sha+'.bin');}
  async put(bytes){await mkdir(this.root,{recursive:true});const sha=hash(bytes),file=this.file(sha),tmp=path.join(this.root,randomUUID()+'.pending');
    const h=await open(tmp,'wx');try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
    try{await link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;}finally{await unlink(tmp);}
    const stored=await readFile(file);if(stored.length!==bytes.length||hash(stored)!==sha)throw Error('blob write/readback mismatch');return {sha256:sha,bytes:bytes.length};
  }
  async save(cp){const h=await this.put(cp.h),q=await this.put(cp.q),body={schema:'ecf-network-blob-checkpoint/v3',kernel_sha256:KERNEL_SHA,metadata:cp.metadata,arrays:{h,q},state_sha256:cp.integrity_sha256,custody:'local content-addressed LE binary blobs + M2 manifest; not core FieldSpec solver state'};return {...body,manifest_sha256:digest(body)};}
  async read(manifest){const {manifest_sha256,...body}=manifest;if(body.schema!=='ecf-network-blob-checkpoint/v3'||body.kernel_sha256!==KERNEL_SHA||digest(body)!==manifest_sha256)throw Error('manifest integrity/kernel mismatch');
    const m=body.metadata,n=m.cells,bpe=m.dtype==='float64-le'?8:m.dtype==='float32-le'?4:0;if(!Number.isInteger(n)||n<8||n>1048576||!bpe)throw Error('manifest size/dtype invalid');
    const arrays={};for(const k of['h','q']){const ref=body.arrays[k];if(ref.bytes!==n*bpe)throw Error('blob declared length mismatch');const file=this.file(ref.sha256),info=await stat(file);if(info.size!==ref.bytes)throw Error('blob length mismatch');const data=await readFile(file);if(hash(data)!==ref.sha256)throw Error('blob hash mismatch');arrays[k]=data;}
    return {metadata:m,...arrays,integrity_sha256:body.state_sha256};
  }
}
