const assert=require('node:assert/strict');
const test=require('node:test');
const {Solver}=require('./fluid-core.js');
test('finite volume water mass closes against boundary flux',()=>{
 const a=new Solver();a.advance(8);const m=a.measure();
 assert.ok(Math.abs(m.mass_residual_m2)<1e-8,m.mass_residual_m2+'');
 assert.ok(m.max_cfl<=.3900001); assert.ok(m.steps>=200);
 for(let i=0;i<a.n;i++){assert.ok(a.h[i]>.02);assert.ok(Number.isFinite(a.q[i]));}
});
test('replay is bitwise deterministic',()=>{
 const a=new Solver(),b=new Solver();a.advance(8);b.advance(8);
 assert.deepEqual([...a.h],[...b.h]);assert.deepEqual([...a.q],[...b.q]);
});
test('sea level and inflow are coupled to river values',()=>{
 const a=new Solver();a.advance(6);
 const b=new Solver({tide_m:.3});b.advance(6);
 const c=new Solver({inflow_m2_s:2.0});c.advance(6);
 assert.ok(Math.abs(a.sample(.98).h-b.sample(.98).h)>.01);
 assert.ok(Math.abs(a.sample(.01).u-c.sample(.01).u)>.04);
});
test('inflow adjustment preserves finite mass residual',()=>{
 const a=new Solver();a.advance(3);a.setParameters({inflow_m2_s:2.2,tide_m:-.3});a.advance(9);
 assert.ok(Math.abs(a.measure().mass_residual_m2)<1e-7);
});
test('invalid parameters fail closed',()=>{
 for(const v of [0,-1,NaN,Infinity,999]) assert.throws(()=>new Solver({cells:v}));
 assert.throws(()=>new Solver({roughness:0}));
 assert.throws(()=>new Solver({tide_m:1.2}));
});
