import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const server=spawn('npm',['run','dev','--','--port','4181','--strictPort'],{stdio:'inherit'});
const origin='http://127.0.0.1:4181';
let browser;
const report={environment:{source:'GitHub Actions or local runner; localhost serving, not participant internet timing',node:process.version},models:[],rollouts:null};
try {
  for(let i=0;i<100;i++) {try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  report.environment.browser=browser.version();
  for(const variant of ['rubi','rubi-web']) {
    const context=await browser.newContext(),page=await context.newPage();
    await page.route('**/__perf__.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Model benchmark</title>'}));
    await page.goto(origin+'/__perf__.html');
    const measurement=await page.evaluate(async variant=>{
      const {Physics}=await import('/src/runtime/physics.ts');
      const {makeScenario}=await import('/src/core/scenario.ts');
      const {fetchHostedBundle}=await import('/src/runtime/bundle-loader.ts');
      const start=performance.now();let bundle,metrics;
      const base=new URL('/models/'+variant+'/',location.href);
      if(variant==='rubi') {
        const {fetchHostedFiles}=await import('/src/runtime/hosted-bundle.ts');
        const {loadFiles}=await import('/src/core/model.ts');
        bundle=await loadFiles(await fetchHostedFiles(base));
        metrics={elapsedMs:performance.now()-start,decodedBytes:[...bundle.files.values()].reduce((n,b)=>n+b.length,0)};
      } else ({bundle,metrics}=await fetchHostedBundle(base));
      const engine=await Physics.create(bundle,makeScenario(0,.8,.3)),m=engine.model;
      try {
        const state={};
        for(const name of ['body_mass','body_inertia','body_ipos','body_iquat','body_pos','body_quat','jnt_pos','jnt_axis','jnt_range','dof_damping','dof_frictionloss','dof_armature','actuator_gear','actuator_ctrlrange','qpos0']) state[name]=Array.from(m[name]);
        state.collision=[];
        for(let g=0;g<m.ngeom;g++) if(m.geom_contype[g]||m.geom_conaffinity[g]) {
          const row={body:m.geom_bodyid[g],type:m.geom_type[g],contype:m.geom_contype[g],conaffinity:m.geom_conaffinity[g]};
          for(const [name,width] of [['geom_size',3],['geom_pos',3],['geom_quat',4],['geom_friction',3],['geom_solref',2],['geom_solimp',5]]) row[name]=Array.from(m[name].slice(g*width,(g+1)*width));
          state.collision.push(row);
        }
        const samples=[];
        for(let i=0;i<1000;i++) {engine.mj.mj_step(m,engine.data);if(i%100===0)samples.push(Array.from(engine.data.qpos));}
        return {variant,loader:metrics,physics:engine.loadMetrics,nq:m.nq,nv:m.nv,nu:m.nu,meshes:m.nmesh,faces:Array.from(m.mesh_facenum).reduce((a,b)=>a+b,0),state,samples};
      } finally {engine.dispose();}
    },variant);
    report.models.push(measurement);
    console.log('MODEL_BENCHMARK',JSON.stringify({...measurement,state:'saved separately',samples:'saved separately'}));
    await context.close();
  }
  const [original,web]=report.models;
  assert.equal(web.physics.splitCount,0,'optimized web bundle must not use runtime STL splitting');
  assert.deepEqual(web.state,original.state,'compiled physics parameters changed');
  let maxDelta=0;
  original.samples.forEach((sample,i)=>sample.forEach((value,j)=>maxDelta=Math.max(maxDelta,Math.abs(value-web.samples[i][j]))));
  assert.ok(maxDelta<1e-8,`zero-control 2s trajectory changed: ${maxDelta}`);
  report.physicsComparison={staticParameters:'identical',steps:1000,dt:.002,maxQposDifference:maxDelta,scope:'zero-control trajectory including constraints; not full locomotion equivalence proof'};
  // Actual optimized application: load -> height change -> A/B policy -> repeat.
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('RUBI 연결 완료'),null,{timeout:180000});
  await page.screenshot({path:'artifacts/web-optimized-ready.png',fullPage:true});
  await page.locator('#height').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
  const firstStart=Date.now();await page.locator('#generate').click();
  await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:240000});
  assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
  assert.ok(await page.locator('#export-runs').isEnabled(),'both real rollouts must finish without a runtime exception');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-runs').click();
  const download=await downloadPromise;await download.saveAs('artifacts/real-flat-rollouts.json');
  const runs=JSON.parse(await readFile('artifacts/real-flat-rollouts.json','utf8'));
  report.rollouts={wallMs:Date.now()-firstStart,performance:runs.performance,routes:Object.fromEntries(Object.entries(runs.rollouts).map(([k,r])=>[k,{completed:r.completed,reason:r.reason,duration:r.duration,inferences:r.inferences,computeMs:r.computeMs}]))};
  await page.screenshot({path:'artifacts/web-optimized-flat.png',fullPage:true});
  if(Object.values(runs.rollouts).every(r=>r.completed)) {
    const repeated=Date.now();await page.locator('#generate').click();
    await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:60000});
    const cache=JSON.parse(await page.locator('#performance-metrics').textContent());
    assert.ok(cache.direct.cacheHit&&cache.detour.cacheHit,'same-condition repeat must reuse both successful clips');
    report.cachedRepeat={wallMs:Date.now()-repeated,metrics:cache};
  } else report.cachedRepeat={skipped:'A locomotion failure is not cached. Diagnose controller/model independently.'};
  assert.deepEqual(errors,[]);
  report.runtimeErrors=errors;report.status='PASS';
  console.log('PERFORMANCE_REPORT',JSON.stringify({...report,models:report.models.map(({state,samples,...rest})=>rest)}));
} catch(e) {report.status='FAIL';report.error=String(e);throw e;}
finally {
  await writeFile('artifacts/performance-report.json',JSON.stringify(report,null,2));
  await browser?.close();server.kill('SIGTERM');
}
