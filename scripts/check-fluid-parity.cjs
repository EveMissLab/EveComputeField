// Verify Go and browser-JS solver share the SAME scientific reference calculation.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {Solver}=require('../examples/fluid/fluid-core.js');
if(process.argv.length<3)throw Error('usage: node scripts/check-fluid-parity.cjs go-result.json');
const out=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const scenario=JSON.parse(fs.readFileSync('examples/fluid/scenario.json','utf8'));
const a=new Solver(scenario);a.advance(scenario.duration_s);
const b=a.measure();
for(const [name,x,y] of [
 ['cells',out.cells,a.n],['steps',out.steps,a.steps],['final_volume_m2',out.final_volume_m2,b.water_m2],
 ['integrated_boundary_in_m2',out.integrated_boundary_in_m2,a.massIn],
 ['integrated_boundary_out_m2',out.integrated_boundary_out_m2,a.massOut],
 ['mass_residual_m2',out.mass_residual_m2,b.mass_residual_m2]]){
 assert.ok(Math.abs(x-y)<1e-11,`${name}: Go ${x}, JS ${y}`);
}
assert.equal(out.samples.length,17);
for(let j=0;j<17;j++){
 const i=Math.floor(j*(a.n-1)/16),s=out.samples[j];
 assert.ok(Math.abs(s.depth_m-a.h[i])<1e-11,'sample depth mismatch at '+j);
 assert.ok(Math.abs(s.velocity_m_s-a.q[i]/a.h[i])<1e-11,'sample velocity mismatch at '+j);
}
console.log('M3_FLUID_GO_JS_PARITY_PASS (96 cells / 17 samples / mass & boundary flux)');
