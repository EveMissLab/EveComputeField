import { createHash } from 'node:crypto';
export function canonical(v) {
  if (typeof v==='number'&&!Number.isFinite(v)) throw Error('nonfinite canonical value');
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const digest=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
export const sum=a=>{let s=0;for(const x of a)s+=x;return s;};
export function finite(v,name,min=-Infinity,max=Infinity){if(!Number.isFinite(v)||v<min||v>max)throw Error(`invalid ${name}`);return v;}
export function mergeKnown(defaults,input={}) { if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid configuration object');
  for(const k of Object.keys(input))if(!Object.hasOwn(defaults,k))throw Error(`unknown option ${k}`);
  return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,v&&typeof v==='object'&&!Array.isArray(v)?mergeKnown(v,input[k]??{}):input[k]??v]));
}
