import { finite,mergeKnown } from './util.mjs';
export const G=9.81;
export const SOURCE={kind:'constant',base:1,amplitude:0,at:2,duration:2,period:6};
export function sourceConfig(input={}) {
  const c=mergeKnown(SOURCE,input); if(!['constant','step','pulse','sine'].includes(c.kind))throw Error('invalid source kind');
  for(const k of['base','amplitude','at'])finite(c[k],`source ${k}`,0,1000);
  for(const k of['duration','period'])finite(c[k],`source ${k}`,1e-4,10000);
  if(c.kind==='sine'&&c.amplitude>c.base)throw Error('source must remain nonnegative');return c;
}
export function sourceIntegral(t,c) {
  const base=c.base*t;if(t<0)return base;
  if(c.kind==='step')return base+c.amplitude*Math.max(0,t-c.at);
  if(c.kind==='pulse')return base+c.amplitude*Math.min(c.duration,Math.max(0,t-c.at));
  if(c.kind==='sine')return base+c.amplitude*(1-Math.cos(2*Math.PI*t/c.period))*c.period/(2*Math.PI);
  return base;
}
export class Waterfall {
  constructor({height=12,source={}}={}){finite(height,'waterfall height',0,1000);this.height=height;this.source=sourceConfig(source);this.delay=Math.sqrt(2*height/G);this.volume=this.source.base*this.delay;}
  propose(t,dt){const supply=sourceIntegral(t+dt,this.source)-sourceIntegral(t,this.source),landing=sourceIntegral(t+dt-this.delay,this.source)-sourceIntegral(t-this.delay,this.source);return {supply,landing,volume:this.volume+supply-landing};}
  commit(p){this.volume=p.volume;}
  nextEvent(t){let edges=[0];if(['step','pulse'].includes(this.source.kind)){edges.push(this.source.at);if(this.source.kind==='pulse')edges.push(this.source.at+this.source.duration);}edges=[...edges,...edges.map(x=>x+this.delay)];return Math.min(...edges.filter(x=>x>t+1e-11),Infinity);}
}
export class Reservoir {
  constructor({area,bottom,stage,min_stage}){finite(area,'reservoir area',.001,1e9);finite(bottom,'reservoir bottom',-1000,1000);finite(stage,'reservoir stage',-1000,1000);finite(min_stage,'minimum stage',bottom+1e-6,1000);if(stage<min_stage)throw Error('reservoir initial storage below wet minimum');Object.assign(this,{area,bottom,min_stage});this.volume=area*(stage-bottom);}
  stage(volume=this.volume){return this.bottom+volume/this.area;}
  minimum(){return this.area*(this.min_stage-this.bottom);}
  propose(inflow,outflow,dt){const v=this.volume+dt*(inflow-outflow);this.validate(v);return v;}
  validate(v){if(!Number.isFinite(v)||v<this.minimum())throw Error('reservoir storage below wet connection minimum');}
}
