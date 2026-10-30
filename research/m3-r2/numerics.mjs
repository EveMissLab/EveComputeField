import { G } from './components.mjs';
export const wave=(h,q)=>Math.abs(q/h)+Math.sqrt(G*h);
// Audusse et al. (2004), first-order hydrostatic reconstruction, common mass flux.
export function hydroFace(hl,ql,zl,hr,qr,zr){
  const z=Math.max(zl,zr),a=Math.max(0,hl+zl-z),b=Math.max(0,hr+zr-z),ua=ql/hl,ub=qr/hr;
  const qa=ua*a,qb=ub*b,c=Math.max(Math.abs(ua)+Math.sqrt(G*a),Math.abs(ub)+Math.sqrt(G*b));
  const momentum=.5*(qa*ua+.5*G*a*a+qb*ub+.5*G*b*b)-.5*c*(qb-qa);
  return {mass:.5*(qa+qb)-.5*c*(b-a),left:momentum+.5*G*(hl*hl-a*a),right:momentum+.5*G*(hr*hr-b*b),wave:Math.max(c,wave(hl,ql),wave(hr,qr))};
}
export function updateRange(h,q,fh,fl,fr,nh,nq,start,end,dt,dx,roughness){
  for(let i=start;i<end;i++){
    const hh=h[i]-dt/dx*(fh[i+1]-fh[i]),transport=q[i]-dt/dx*(fl[i+1]-fr[i]);
    const qq=transport/(1+dt*G*roughness*roughness*Math.abs(transport)/Math.pow(Math.max(hh,.02),7/3));
    if(!(hh>=.02)||!Number.isFinite(hh)||!Number.isFinite(qq))return i;
    nh[i]=hh;nq[i]=qq;
  }return -1;
}
