import { mkdir,writeFile } from 'node:fs/promises';import path from 'node:path';import { fileURLToPath } from 'node:url';import { CoupledSolver,KERNEL_SHA } from './solver.mjs';
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'results');await mkdir(out,{recursive:true});const traces=[];
for(const family of['pool-pulse','ocean-tide'])for(const area of(family==='pool-pulse'?[3,30,300]:[6,600,6000])){
  const config=family==='pool-pulse'?{pool:{area},source:{kind:'pulse',amplitude:1,at:2,duration:2}}:{ocean:{area,tide_amplitude:.5,tide_period:12}};
  const control=structuredClone(config);if(family==='pool-pulse')control.source.amplitude=0;else control.ocean.tide_amplitude=0;
  const a=new CoupledSolver(config),b=new CoupledSolver(control),rows=[];
  try{for(let sample=0;sample<=30;sample++){if(sample){a.advanceSeconds(2);b.advanceSeconds(2);}const x=a.measure(),y=b.measure();rows.push({time_s:x.time_s,pool_stage_m:x.pool_stage_m,ocean_stage_m:x.ocean_stage_m,pool_perturbation_m:x.pool_stage_m-y.pool_stage_m,ocean_perturbation_m:x.ocean_stage_m-y.ocean_stage_m,river_volume_perturbation_m3:x.volumes_m3.river-y.volumes_m3.river,raw_residual_m3:x.raw_residual_m3,external_supply_m3:x.flux_integrals_m3.supply,external_export_m3:x.flux_integrals_m3.export});}
    traces.push({family,area_m2:area,forcing_config:a.config,control_config:b.config,rows,final:a.measure(),control_final:b.measure()});
  }finally{await a.close();await b.close();}
}
const report={schema:'ecf-m3-r2-response/v2',kernel_sha256:KERNEL_SHA,duration_s:60,simulations:12,paired_controls:true,description:'Each area has its own matched no-pulse/no-tide control. Differences isolate forcing response from the common initial transient. Both ends respond through the river over time; no instantaneous teleconnection is assumed.',traces};
await writeFile(path.join(out,'response.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(traces.map(t=>({family:t.family,area:t.area_m2,final:t.rows.at(-1)}))));
