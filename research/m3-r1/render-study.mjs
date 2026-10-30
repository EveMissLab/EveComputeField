import { createRequire } from 'node:module';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ECF_PLAYWRIGHT_PACKAGE??'playwright');
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../../examples/fluid'),out=path.join(here,'results');await mkdir(out,{recursive:true});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://127.0.0.1').pathname;if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}const target=path.resolve(source,`.${name==='/'?'/index.html':name}`);if(!target.startsWith(source+path.sep)||!(await stat(target)).isFile())throw Error('not found');res.writeHead(200,{'Content-Type':types[path.extname(target)]??'application/octet-stream'});res.end(await readFile(target));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1600,height:1400}}),page=await context.newPage(),errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
async function sample(label){return page.evaluate(async label=>{
  const intervals=[];let last=null,batches=0,mutations=0;const world=document.querySelector('#world'),begin=performance.now();
  const observer=new MutationObserver(records=>{batches++;mutations+=records.length;});observer.observe(world,{attributes:true,subtree:true});
  await new Promise(resolve=>{function frame(t){if(last!==null)intervals.push(t-last);last=t;if(intervals.length>=120)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});observer.disconnect();
  const elapsed=performance.now()-begin,sorted=[...intervals].sort((a,b)=>a-b),snapshot=window.__fluidSnapshot();
  return{label,frames:intervals.length,elapsed_ms:elapsed,raf_interval_median_ms:sorted[60],raf_interval_p95_ms:sorted[113],raf_cadence_hz:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),svg_mutation_batches:batches,svg_mutation_records:mutations,svg_update_batch_hz:batches*1000/elapsed,svg_nodes:world.querySelectorAll('*').length,canvas_nodes:document.querySelectorAll('canvas').length,state:snapshot.state,paused:snapshot.paused};
},label);}
let report;
try{
  await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__fluidSnapshot?.().state.time_s>1);
  const samples=[await sample('baseline')];
  for(const[id,key]of[['flow','End'],['tide','Home'],['friction','End']]){await page.locator('#'+id).focus();await page.keyboard.press(key);}
  samples.push(await sample('boundary-control-extremes'));
  await page.locator('#toggle').click();await page.waitForFunction(()=>window.__fluidSnapshot().paused);samples.push(await sample('paused-solver-SVG-loop'));
  const negative=await page.evaluate(async()=>{const before=JSON.stringify(window.__fluidSnapshot().state);document.querySelector('#fall-streaks').setAttribute('opacity','.5');document.querySelector('#ocean-wavelets').setAttribute('opacity','.5');await new Promise(r=>setTimeout(r,100));const same=before===JSON.stringify(window.__fluidSnapshot().state);document.querySelector('#fall-streaks').removeAttribute('opacity');document.querySelector('#ocean-wavelets').removeAttribute('opacity');return{visual_style_only_does_not_change_physics:same};});
  assert(negative.visual_style_only_does_not_change_physics);assert(samples.every(s=>s.canvas_nodes===0&&Number.isFinite(s.state.mass_residual_m2)));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await page.screenshot({path:path.join(out,'m3-live-svg.png'),fullPage:true});
  report={outcome:'passed',browser:await browser.version(),samples,negative_controls:negative,page_errors:errors,external_requests:external,
    scope:'Standalone original browser M3 solver and SVG DOM. RAF cadence and mutation batches include solver/browser work; not isolated GPU render time or SLA. Backend resident continuation is measured separately.'};
}catch(error){report={outcome:'failed',error:error.stack,page_errors:errors,external_requests:external};process.exitCode=1;}
finally{await writeFile(path.join(out,'render-study.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report));}
