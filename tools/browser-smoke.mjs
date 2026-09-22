import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {residentChecks,guidedChecks} from './guided-smoke.mjs';

// Separate synthetic engine fixture; never used as a research locomotion clip.
const v=n=>{const a=[];do{const b=n%128;n=Math.floor(n/128);a.push(b|(n?128:0));}while(n);return Buffer.from(a);};
const int=(n,x)=>Buffer.concat([v(n*8),v(x)]);
const bytes=(n,x)=>{const b=Buffer.isBuffer(x)?x:Buffer.from(x);return Buffer.concat([v(n*8+2),v(b.length),b]);};
const msg=(...x)=>Buffer.concat(x);
const info=(name,dims)=>msg(bytes(1,name),bytes(2,bytes(1,msg(int(1,1),bytes(2,msg(...dims.map(d=>bytes(1,int(1,d)))))))));
function model(input,output){
  const node=msg(bytes(1,'mlp_input'),bytes(1,'W'),bytes(2,'mlp_output'),bytes(3,'test_matmul'),bytes(4,'MatMul'));
  const weights=msg(int(1,input),int(1,output),int(2,1),bytes(8,'W'),bytes(9,Buffer.alloc(input*output*4)));
  const graph=msg(bytes(1,node),bytes(2,'rubi_runtime_smoke_only'),bytes(5,weights),bytes(11,info('mlp_input',[input])),bytes(12,info('mlp_output',[output])));
  return msg(int(1,8),bytes(2,'rubi-runtime-smoke'),bytes(7,graph),bytes(8,int(2,13)));
}
await mkdir('artifacts',{recursive:true});await mkdir('public/__smoke_models',{recursive:true});
await writeFile('public/__smoke_models/encoder.onnx',model(330,32));await writeFile('public/__smoke_models/policy.onnx',model(65,6));
const server=spawn('npm',['run','dev','--','--port','4177','--strictPort'],{stdio:'inherit'});
let browser,page;
try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4177/')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Vite server did not start');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // CI never sends test participant records to the owner's real Sheet.
  await page.route('https://script.google.com/macros/s/**/exec',async route=>{
    const request=JSON.parse(new URLSearchParams(route.request().postData()||'').get('payload')||'{}');
    if(request.kind!=='ping')throw new Error('Unexpected collector write in researcher smoke');
    const reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:true,kind:'ping',service:'rubi-hpp',experimentId:request.payload.experimentId,studyStatus:request.payload.studyStatus};
    await route.fulfill({contentType:'text/html',body:`<script>top.postMessage(${JSON.stringify(reply)},'http://127.0.0.1:4177');</script>`});
  });
  await page.goto('http://127.0.0.1:4177/?mode=research',{waitUntil:'networkidle'});
  await page.locator('#world').waitFor();assert.ok(await page.locator('#world').isVisible());
  await page.waitForFunction(()=>document.querySelector('#api-status')?.textContent?.includes('중앙 저장 연결 확인'),null,{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('RUBI 연결 완료'),null,{timeout:180000});
  assert.ok(await page.locator('#error').isHidden(),'real asset load error');assert.ok(await page.locator('#generate').isEnabled());
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  const runtime=await page.evaluate(async()=>{
    const {loadEngine}=await import('/src/runtime/physics.ts');const mj=await loadEngine(),vfs=new mj.MjVFS();
    vfs.addBuffer('smoke.xml',new TextEncoder().encode('<mujoco><option timestep="0.002"/><worldbody><body pos="0 0 1"><freejoint/><geom type="sphere" size="0.05" mass="1"/></body></worldbody></mujoco>'));
    let model,data;
    try{
      model=mj.MjModel.from_xml_path('smoke.xml',vfs);data=new mj.MjData(model);mj.mj_forward(model,data);for(let i=0;i<10;i++)mj.mj_step(model,data);
      const physics={time:data.time,z:data.qpos[2]};const {OnnxNetworks}=await import('/src/runtime/onnx.ts'),files=new Map();
      for(const name of ['encoder.onnx','policy.onnx'])files.set(name,new Uint8Array(await (await fetch('/__smoke_models/'+name)).arrayBuffer()));
      const networks=await OnnxNetworks.create(files);
      try{const latent=await networks.encode(new Float32Array(330)),action=await networks.act(new Float32Array(65));return {physics,latentSize:latent.length,actionSize:action.length,finite:[...latent,...action].every(Number.isFinite),fixture:'synthetic engine fixture'};}
      finally{await networks.dispose();}
    }finally{data?.delete();model?.delete();vfs.delete();}
  });
  assert.ok(Math.abs(runtime.physics.time-.02)<1e-9);assert.ok(runtime.physics.z<1);assert.equal(runtime.latentSize,32);assert.equal(runtime.actionSize,6);assert.ok(runtime.finite);
  await page.locator('#height').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#generate').click();
  await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:240000});
  const actual=JSON.parse(await page.locator('#performance-metrics').textContent());
  assert.ok(actual.direct.completed&&actual.detour.completed,'actual flat routes must arrive');
  for(const key of ['direct','detour']){assert.equal(actual[key].nominalSpeedMps,.5);assert.ok(actual[key].achievedMeanXyMps>0);}
  await page.locator('#generate').click();await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:60000});
  const cached=JSON.parse(await page.locator('#performance-metrics').textContent());assert.ok(cached.direct.cacheHit&&cached.detour.cacheHit);
  const bypasses=[];
  for(const extra of [.4,2.4]){
    await page.locator('#height').evaluate(e=>{e.value='5';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#detour').evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},extra);
    await page.locator('#generate').click();await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:240000});
    assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
    const downloading=page.waitForEvent('download');await page.locator('#export-runs').click();const download=await downloading;
    const path=`artifacts/smooth-h5-d${extra}.json`;await download.saveAs(path);const exported=JSON.parse(await readFile(path,'utf8')),run=exported.rollouts.detour;
    assert.ok(run.completed,'actual cosine bypass must arrive');assert.ok(Math.abs(run.plannedLength-(6+extra))<1e-9);assert.equal(exported.scenario.routes.detour.length,481);assert.ok(exported.scenario.geometry.minCenterlineClearanceM>=.4);
    bypasses.push({extra,duration:run.duration,completed:run.completed,maxError:run.maxError});
  }
  assert.deepEqual(errors,[]);await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
  await page.close();page=undefined;
  const resident=await residentChecks(browser);
  const guided=await guidedChecks(browser);
  const report={status:'PASS',runtime,actualFlat:actual,cachedRepeat:cached,bypasses,resident,guided};
  await writeFile('artifacts/browser-smoke.json',JSON.stringify(report,null,2));console.log('BROWSER_SMOKE_PASS',JSON.stringify({status:report.status,actualFlat:actual,bypasses,resident,guided}));
}catch(e){await page?.screenshot({path:'artifacts/browser-failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{await browser?.close();server.kill('SIGTERM');await rm('public/__smoke_models',{recursive:true,force:true});}
