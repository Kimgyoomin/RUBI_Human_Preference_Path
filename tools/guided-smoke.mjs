import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export async function residentChecks(browser){
  const p=await browser.newPage();
  try{
    await p.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
    const result=await p.evaluate(async()=>{
      const {fetchHostedBundle}=await import('/src/runtime/bundle-loader.ts');
      const {OnnxNetworks}=await import('/src/runtime/onnx.ts');
      const {Physics}=await import('/src/runtime/physics.ts');
      const {makeScenario}=await import('/src/core/scenario.ts');
      const loaded=await fetchHostedBundle(new URL('/models/rubi-web/',location.href),()=>{});
      const networks=await OnnxNetworks.create(loaded.bundle.files);
      const engine=await Physics.create(loaded.bundle,makeScenario(.05,.4,.5));
      const originalModel=engine.model,originalId=engine.runtimeId,report=[];
      let baseline;
      try{
        for(const height of [.05,.07,.09,.11,.05]){
          engine.setScenario(makeScenario(height,.4,.5));
          const resetQpos=Array.from(engine.data.qpos),resetQvel=Array.from(engine.data.qvel);
          const direct=await engine.rollout('direct',networks,new AbortController().signal,()=>{});
          let repeatError=null;
          if(!baseline)baseline=direct.frames;
          else if(height===.05){
            repeatError=baseline.length===direct.frames.length?0:Infinity;
            for(let i=0;i<Math.min(baseline.length,direct.frames.length);i++)for(let j=0;j<baseline[i].qpos.length;j++)repeatError=Math.max(repeatError,Math.abs(baseline[i].qpos[j]-direct.frames[i].qpos[j]));
          }
          const detour=await engine.rollout('detour',networks,new AbortController().signal,()=>{});
          report.push({height,runtimeId:engine.runtimeId,sameModel:engine.model===originalModel,resetQpos,resetQvel,
            direct:{completed:direct.completed,reason:direct.reason,duration:direct.duration,maxError:direct.maxError,initialQpos:direct.initialQpos,initialQvel:direct.initialQvel},
            detour:{completed:detour.completed,reason:detour.reason,duration:detour.duration,maxError:detour.maxError,initialQpos:detour.initialQpos,initialQvel:detour.initialQvel},repeatError});
        }
        return {originalId,report};
      }finally{engine.dispose();await networks.dispose();}
    });
    await writeFile('artifacts/resident-heights.json',JSON.stringify(result,null,2));
    for(const r of result.report){
      assert.equal(r.sameModel,true);assert.equal(r.runtimeId,result.originalId);
      assert.deepEqual(r.direct.initialQpos,r.detour.initialQpos);assert.deepEqual(r.direct.initialQvel,r.detour.initialQvel);
      assert.ok(r.resetQvel.every(v=>v===0));assert.ok(Math.hypot(r.resetQpos[0],r.resetQpos[1])<1e-8);
      assert.ok(r.direct.completed,`direct ${r.height*100}cm failed: ${r.direct.reason}`);
      assert.ok(r.detour.completed,`detour ${r.height*100}cm failed: ${r.detour.reason}`);
      if(r.repeatError!==null)assert.ok(r.repeatError<1e-7,`reset replay diverged: ${r.repeatError}`);
    }
    console.log('RESIDENT_HEIGHTS_PASS',JSON.stringify(result));return result;
  }finally{await p.close();}
}

export async function guidedChecks(browser){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const study=JSON.parse(await readFile('public/study.json','utf8'));
  study.guidedScenarios=[{height:.05,detour:.4,speed:.5},{height:.07,detour:.8,speed:.5}];
  await page.route('**/study.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(study)}));
  // TEST TRANSPORT ONLY: intercept all collector requests, never append to the
  // actual private Sheet from CI. Researcher smoke still verifies the real ping.
  await page.route('https://script.google.com/macros/s/**/exec',async route=>{
    const request=JSON.parse(new URLSearchParams(route.request().postData()||'').get('payload')||'{}');
    const payload=request.payload||{};
    if(request.kind!=='ping')writes.push(request);
    const reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:true,kind:request.kind,service:'rubi-hpp',experimentId:study.id,studyStatus:study.status,
      submissionId:request.kind==='profile'?payload.sessionId:payload.submissionId};
    await route.fulfill({contentType:'text/html',body:`<!doctype html><script>top.postMessage(${JSON.stringify(reply)},'http://127.0.0.1:4177');</script>`});
  });
  try{
    await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='welcome');
    assert.equal(await page.locator('#g-world').isVisible(),false);
    assert.equal(await page.locator('#generate').count(),0);
    await page.screenshot({path:'artifacts/guided-welcome.png',fullPage:true});
    await page.locator('#g-consent').check();await page.locator('#g-start').click();
    await page.locator('#g-robotics').selectOption('no');await page.locator('#g-knew').selectOption('yes');await page.locator('#g-exposure').selectOption('video_only');
    assert.equal((await page.evaluate(()=>window.__rubiGuidedTest())).modelCreateCount,0,'model must not be shown before background questions');
    await page.screenshot({path:'artifacts/guided-profile.png',fullPage:true});
    await page.locator('#g-profile-next').click();await page.locator('#g-begin').click();
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe',null,{timeout:120000});
    const initial=await page.evaluate(()=>window.__rubiGuidedTest());
    assert.equal(initial.modelCreateCount,1);assert.equal(initial.onnxCreateCount,1);assert.equal(initial.spriteCount,0);
    assert.ok(initial.markerNames.includes('start-green-disc'));assert.ok(initial.markerNames.includes('goal-red-target'));
    assert.ok(initial.camera[0]<initial.target[0]);
    assert.equal(await page.locator('.g-viewport').innerText(),'');
    const runs=[];
    for(let trial=0;trial<2;trial++){
      for(let route=0;route<2;route++){
        let completed=false;
        for(let attempt=0;attempt<3;attempt++){
          const previousSeen=(await page.evaluate(()=>window.__rubiGuidedTest())).seen.length;
          await page.locator('#g-watch').click();
          if(trial===0&&route===0&&attempt===0){await page.waitForTimeout(3300);await page.screenshot({path:'artifacts/guided-live.png',fullPage:true});}
          await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='choice'||(!document.querySelector('#g-watch').hidden&&!document.querySelector('#g-watch').disabled),null,{timeout:120000});
          const snapshot=await page.evaluate(()=>window.__rubiGuidedTest());
          if(snapshot.phase==='choice'||snapshot.seen.length>previousSeen){completed=true;break;}
          assert.ok(Object.values(snapshot.runs).every(r=>r.completed),'live route failed');
        }
        assert.ok(completed,'live/replay observation did not pass timing gate');
      }
      await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='choice');
      const snapshot=await page.evaluate(()=>window.__rubiGuidedTest());
      assert.equal(snapshot.modelCreateCount,1);assert.equal(snapshot.onnxCreateCount,1);assert.equal(snapshot.runtimeId,initial.runtimeId);
      assert.deepEqual(snapshot.runs.direct.initialQpos,snapshot.runs.detour.initialQpos);
      assert.deepEqual(snapshot.runs.direct.initialQvel,snapshot.runs.detour.initialQvel);
      runs.push({height:snapshot.scenario.height,direct:snapshot.runs.direct.duration,detour:snapshot.runs.detour.duration});
      if(trial===0){await page.screenshot({path:'artifacts/guided-choice.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/guided-choice-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});}
      await page.locator('#g-tie').click();
      await page.waitForFunction(t=>window.__rubiGuidedTest?.().index>t,trial,{timeout:30000});
      if(trial===0)await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe');
    }
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='complete',null,{timeout:30000});
    assert.equal(writes.filter(r=>r.kind==='trial').length,2);assert.equal(writes.filter(r=>r.kind==='profile').length,1);
    for(const request of writes.filter(r=>r.kind==='trial')){
      assert.equal(request.payload.labelConditionVersion,'rear-oblique-no-labels-then-numeric-v1');assert.equal(request.payload.profileTiming,'before_simulation');
      assert.equal(request.payload.choice,'tie');assert.equal(request.payload.runs.direct.frames,undefined);assert.equal(request.payload.runs.detour.frames,undefined);
      assert.ok(Date.parse(request.payload.profileAnsweredAtUtc)<=Date.parse(request.payload.createdAt));
    }
    assert.deepEqual(errors,[]);
    const report={status:'PASS',collector:'mock intercepted; no real Sheets writes',realPolicy:true,runtimeId:initial.runtimeId,modelCreateCount:1,onnxCreateCount:1,runs,trialSubmissions:2,profileSubmissions:1};
    await writeFile('artifacts/guided-smoke.json',JSON.stringify(report,null,2));console.log('GUIDED_UI_PASS',JSON.stringify(report));return report;
  }catch(e){await page.screenshot({path:'artifacts/guided-failure.png',fullPage:true}).catch(()=>{});console.log('GUIDED_FAILURE',JSON.stringify(await page.evaluate(()=>({error:document.querySelector('#g-error')?.textContent,phase:window.__rubiGuidedTest?.().phase,watch:document.querySelector('#g-watch-status')?.textContent,hint:document.querySelector('#g-action-hint')?.textContent})).catch(()=>({}))));throw e;}
  finally{await page.close();}
}
