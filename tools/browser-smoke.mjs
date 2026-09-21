import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Synthetic engine fixtures are separate from the real RUBI locomotion check below.
const v = n => { const a=[]; do {const b=n%128;n=Math.floor(n/128);a.push(b|(n?128:0));}while(n);return Buffer.from(a); };
const int=(n,x)=>Buffer.concat([v(n*8),v(x)]);
const bytes=(n,x)=>{const b=Buffer.isBuffer(x)?x:Buffer.from(x);return Buffer.concat([v(n*8+2),v(b.length),b]);};
const msg=(...x)=>Buffer.concat(x);
const info=(name,dims)=>bytes(1,name).length && msg(bytes(1,name),bytes(2,bytes(1,msg(int(1,1),bytes(2,msg(...dims.map(d=>bytes(1,int(1,d)))))))));
function model(input,output){
  const node=msg(bytes(1,'mlp_input'),bytes(1,'W'),bytes(2,'mlp_output'),bytes(3,'test_matmul'),bytes(4,'MatMul'));
  const weights=msg(int(1,input),int(1,output),int(2,1),bytes(8,'W'),bytes(9,Buffer.alloc(input*output*4)));
  const graph=msg(bytes(1,node),bytes(2,'rubi_runtime_smoke_only'),bytes(5,weights),bytes(11,info('mlp_input',[input])),bytes(12,info('mlp_output',[output])));
  return msg(int(1,8),bytes(2,'rubi-runtime-smoke'),bytes(7,graph),bytes(8,int(2,13)));
}

await mkdir('artifacts',{recursive:true});
await mkdir('public/__smoke_models',{recursive:true});
await writeFile('public/__smoke_models/encoder.onnx',model(330,32));
await writeFile('public/__smoke_models/policy.onnx',model(65,6));
const server=spawn('npm',['run','dev','--','--port','4177','--strictPort'],{stdio:'inherit'});
let browser,page;
try {
  let ready=false;
  for(let i=0;i<100;i++){
    try {if((await fetch('http://127.0.0.1:4177/')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  assert.ok(ready,'Vite server did not start');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
  await page.locator('#world').waitFor();
  assert.ok(await page.locator('#world').isVisible());
  assert.ok((await page.locator('h1').innerText()).includes('두 가지 경로'));
  await page.waitForFunction(()=>document.querySelector('#api-status')?.textContent?.includes('중앙 저장 연결 확인'),null,{timeout:30000});
  assert.ok((await page.locator('#api-status').innerText()).includes('중앙 저장 연결 확인'),'deployed Apps Script collector ping did not confirm');
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('RUBI 연결 완료'),null,{timeout:180000});
  assert.ok(await page.locator('#error').isHidden(),'actual RUBI bundle reported a UI error');
  assert.ok(await page.locator('#generate').isEnabled());
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  const runtime=await page.evaluate(async()=>{
    const {loadEngine}=await import('/src/runtime/physics.ts');
    const mj=await loadEngine(),vfs=new mj.MjVFS();
    vfs.addBuffer('smoke.xml',new TextEncoder().encode('<mujoco><option timestep="0.002"/><worldbody><body pos="0 0 1"><freejoint/><geom type="sphere" size="0.05" mass="1"/></body></worldbody></mujoco>'));
    let model,data;
    try{
      model=mj.MjModel.from_xml_path('smoke.xml',vfs);data=new mj.MjData(model);mj.mj_forward(model,data);
      for(let i=0;i<10;i++)mj.mj_step(model,data);
      const physics={time:data.time,z:data.qpos[2]};
      const {OnnxNetworks}=await import('/src/runtime/onnx.ts');
      const files=new Map();
      for(const name of ['encoder.onnx','policy.onnx']){
        const r=await fetch('/__smoke_models/'+name);files.set(name,new Uint8Array(await r.arrayBuffer()));
      }
      const networks=await OnnxNetworks.create(files);
      try{
        const latent=await networks.encode(new Float32Array(330)),action=await networks.act(new Float32Array(65));
        return {physics,latentSize:latent.length,actionSize:action.length,finite:[...latent,...action].every(Number.isFinite),fixture:'synthetic zero-weight engine fixture; real policy is tested separately'};
      }finally{await networks.dispose();}
    }finally{data?.delete();model?.delete();vfs.delete();}
  });
  assert.ok(Math.abs(runtime.physics.time-0.02)<1e-9);assert.ok(runtime.physics.z<1);
  assert.equal(runtime.latentSize,32);assert.equal(runtime.actionSize,6);assert.ok(runtime.finite);
  // Real ONNX + real RUBI model at the fixed study nominal speed.
  await page.locator('#speed').evaluate(e=>{e.value='0.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#height').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#generate').click();
  await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:240000});
  assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
  const actual=JSON.parse(await page.locator('#performance-metrics').textContent());
  assert.ok(actual.direct.completed&&actual.detour.completed,'actual flat RUBI routes did not both reach the goal');
  assert.ok(actual.direct.simulationSeconds>1&&actual.detour.simulationSeconds>1);
  for(const route of ['direct','detour']) {
    assert.equal(actual[route].nominalSpeedMps,0.5);
    assert.ok(Number.isFinite(actual[route].achievedMeanXyMps)&&actual[route].achievedMeanXyMps>0);
    assert.ok(Number.isFinite(actual[route].meanFollowerVxMps)&&actual[route].meanFollowerVxMps>=0);
  }
  await page.screenshot({path:'artifacts/actual-flat.png',fullPage:true});
  await page.locator('#generate').click();
  await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:60000});
  const cached=JSON.parse(await page.locator('#performance-metrics').textContent());
  assert.ok(cached.direct.cacheHit&&cached.detour.cacheHit,'same-condition successful rollouts were not reused');

  // Real bypasses around a nonzero platform at both limits of the detour slider.
  // Direct traversal at 5 cm is reported but is not the acceptance criterion here.
  const smoothBypasses=[];
  for(const extra of [0.4,2.4]) {
    await page.locator('#height').evaluate(e=>{e.value='5';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#detour').evaluate((e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));},extra);
    await page.locator('#generate').click();
    await page.waitForFunction(()=>!document.querySelector('#generate')?.disabled,null,{timeout:240000});
    assert.ok(await page.locator('#error').isHidden(),await page.locator('#error').textContent());
    const metrics=JSON.parse(await page.locator('#performance-metrics').textContent());
    assert.ok(metrics.detour.completed,`real cosine detour +${extra} m did not arrive: ${metrics.detour.reason}`);
    assert.equal(metrics.detour.cacheHit,false,'changed detour must be recomputed');
    const downloading=page.waitForEvent('download');
    await page.locator('#export-runs').click();
    const download=await downloading,path=`artifacts/smooth-h5-d${extra}.json`;
    await download.saveAs(path);
    const exported=JSON.parse(await readFile(path,'utf8'));
    assert.equal(exported.scenario.geometry.version,'cosine-bypass-v2');
    assert.equal(exported.scenario.routes.detour.length,481);
    assert.ok(Math.abs(exported.rollouts.detour.plannedLength-(6+extra))<1e-9);
    assert.ok(exported.scenario.geometry.minCenterlineClearanceM>=.4);
    const run=exported.rollouts.detour;
    smoothBypasses.push({height:.05,detour:extra,completed:run.completed,reason:run.reason,plannedLength:run.plannedLength,actualLength:run.actualLength,
      distanceAtArrivalM:run.distanceAtArrivalM,movingDurationS:run.movingDurationS,achievedMeanXyMps:run.achievedMeanXyMps,
      meanFollowerVxMps:run.meanFollowerVxMps,meanPolicyVxCommand:run.meanPolicyVxCommand,maxError:run.maxError,duration:run.duration,
      inferences:run.inferences,computeMs:run.computeMs,geometry:exported.scenario.geometry,direct:metrics.direct});
    await page.locator('#preview-b').click();
    await page.waitForTimeout(1500);
    await page.locator('#play').click();
    await page.screenshot({path:`artifacts/smooth-h5-d${extra}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
  assert.ok(await page.locator('#world').isVisible());assert.deepEqual(errors,[]);
  await writeFile('artifacts/browser-smoke.json',JSON.stringify({status:'PASS',runtime,actualFlat:actual,cachedRepeat:cached,smoothBypasses,errors},null,2));
  console.log('BROWSER_SMOKE_PASS',JSON.stringify({runtime,actualFlat:actual,cachedRepeat:cached,smoothBypasses}));
}catch(e){
  await page?.screenshot({path:'artifacts/browser-failure.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{
  await browser?.close();server.kill('SIGTERM');
  await rm('public/__smoke_models',{recursive:true,force:true});
}
