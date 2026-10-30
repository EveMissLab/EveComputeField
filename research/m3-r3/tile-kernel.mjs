import { hydroFace } from '../m3-r2/numerics.mjs';import { G } from '../m3-r2/components.mjs';
export const STRIDE=10;
export function views(buffers,precision){const T=precision==='f64'?Float64Array:Float32Array,v={};for(const k of['h0','q0','h1','q1'])v[k]=new T(buffers[k]);for(const k of['bed','fh','fl','fr','stages','boundarySpeed','stats','parameters'])v[k]=new Float64Array(buffers[k]);return v;}
function face(v,e,j,h,q){const o=e.offset,n=e.cells;let hl,ql,zl,hr,qr,zr;
  if(j===0){zl=e.bed_up;hl=v.stages[e.from]-zl;ql=q[o]/h[o]*hl;hr=h[o];qr=q[o];zr=v.bed[o];}
  else if(j===n){hl=h[o+n-1];ql=q[o+n-1];zl=v.bed[o+n-1];zr=e.bed_down;hr=v.stages[e.to]-zr;qr=q[o+n-1]/h[o+n-1]*hr;}
  else{hl=h[o+j-1];ql=q[o+j-1];zl=v.bed[o+j-1];hr=h[o+j];qr=q[o+j];zr=v.bed[o+j];}
  if(!(hl>=.02&&hr>=.02))return null;return hydroFace(hl,ql,zl,hr,qr,zr);
}
export function prepare(v,layout,startTile,endTile,bank){const h=bank?v.h1:v.h0,q=bank?v.q1:v.q0;
  for(let t=startTile;t<endTile;t++){const tile=layout.tiles[t],e=layout.reaches[tile.edge],base=t*STRIDE,o=e.offset;let speed=0,donor=Infinity,old=0,left=0,failed=0;
    for(let j=tile.start;j<=tile.end;j++){const f=face(v,e,j,h,q);if(!f){failed=o+j+1;break;}speed=Math.max(speed,f.wave/e.dx);
      // The right-hand tile owns a shared face. This tile's terminal halo is read-only.
      if(j<tile.end||j===e.cells){v.fh[e.face+j]=f.mass;v.fl[e.face+j]=f.left;v.fr[e.face+j]=f.right;}
      if(j===0)v.boundarySpeed[2*e.index]=f.wave;if(j===e.cells)v.boundarySpeed[2*e.index+1]=f.wave;
      if(j>tile.start){const i=o+j-1,hh=h[i],out=Math.max(0,-left)+Math.max(0,f.mass);old+=hh;if(out>0)donor=Math.min(donor,.9*(hh-.02)*e.dx/out);}left=f.mass;
    }
    v.stats[base]=speed;v.stats[base+1]=donor;v.stats[base+2]=old*e.dx*e.width;v.stats[base+8]=failed;
  }
}
export function update(v,layout,startTile,endTile,bank,precision){const h=bank?v.h1:v.h0,q=bank?v.q1:v.q0,nh=bank?v.h0:v.h1,nq=bank?v.q0:v.q1,dt=v.parameters[0],quantize=precision==='f64'?x=>x:Math.fround;
  for(let t=startTile;t<endTile;t++){const tile=layout.tiles[t],e=layout.reaches[tile.edge],base=t*STRIDE;let raw=0,stored=0,min=Infinity,max=0,velocity=0,failed=0;
    for(let j=tile.start;j<tile.end;j++){const i=e.offset+j,k=e.face+j,hh=h[i]-dt/e.dx*(v.fh[k+1]-v.fh[k]),transport=q[i]-dt/e.dx*(v.fl[k+1]-v.fr[k]);
      const qq=transport/(1+dt*G*e.roughness*e.roughness*Math.abs(transport)/Math.pow(Math.max(hh,.02),7/3)),a=quantize(hh),b=quantize(qq);
      if(!(a>=.02)||!Number.isFinite(a)||!Number.isFinite(b)){failed=i+1;break;}nh[i]=a;nq[i]=b;raw+=hh;stored+=a;min=Math.min(min,a);max=Math.max(max,a);velocity=Math.max(velocity,Math.abs(b/a));
    }
    v.stats[base+3]=raw*e.dx*e.width;v.stats[base+4]=stored*e.dx*e.width;v.stats[base+5]=min;v.stats[base+6]=max;v.stats[base+7]=velocity;v.stats[base+8]=failed;
  }
}
