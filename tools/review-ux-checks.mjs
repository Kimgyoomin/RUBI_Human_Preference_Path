import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export async function guidedChecks(browser){
  const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[],writes=[],timings=[];
  page.on('pageerror',e=>errors.push(e.message));
  const study=JSON.parse(await readFile('public/study.json','utf8'));
  study.guidedScenarios=[{height:.05,detour:.4,speed:.5},{height:.07,detour:.8,speed:.5}];
  await page.route('**/study.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(study)}));
  // Deliberately intercept every collector write. Do not populate real research Sheets.
  await page.route('https://script.google.com/macros/s/**/exec',async route=>{
    const request=JSON.parse(new URLSearchParams(route.request().postData()||'').get('payload')||'{}');
    const payload=request.payload||{};if(request.kind!=='ping')writes.push(request);
    const reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:true,kind:request.kind,service:'rubi-hpp',experimentId:study.id,studyStatus:study.status,submissionId:request.kind==='profile'?payload.sessionId:payload.submissionId};
    await route.fulfill({contentType:'text/html',body:`<!doctype html><script>top.postMessage(${JSON.stringify(reply)},'http://127.0.0.1:4177');</script>`});
  });
  const state=()=>page.evaluate(()=>window.__rubiGuidedTest());
  async function onboard(){
    await page.locator('#g-consent').check();await page.locator('#g-start').click();
    await page.locator('#g-robotics').selectOption('no');await page.locator('#g-knew').selectOption('yes');await page.locator('#g-exposure').selectOption('video_only');
    await page.locator('#g-profile-next').click();await page.locator('#g-begin').click();
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe',null,{timeout:120000});
  }
  try{
    await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='welcome');
    assert.equal(await page.locator('#g-world').isVisible(),false);
    assert.equal(await page.locator('#generate').count(),0);
    await page.screenshot({path:'artifacts/review-welcome.png',fullPage:true});
    await onboard();
    const initial=await state();
    assert.equal(initial.modelCreateCount,1);assert.equal(initial.onnxCreateCount,1);assert.equal(initial.spriteCount,0);
    assert.ok(initial.markerNames.includes('start-green-disc'));assert.ok(initial.markerNames.includes('goal-red-target'));
    assert.equal(await page.locator('.g-viewport').innerText(),'');
    assert.equal(await page.locator('#g-choose-a').isEnabled(),false,'unseen paths must not be selectable');
    const rows=[];
    for(let trial=0;trial<2;trial++){
      for(let route=0;route<2;route++){
        let qualified=false;
        for(let attempt=0;attempt<3;attempt++){
          const before=await state(),seenBefore=before.seen.length;
          await page.locator('#g-watch').click();
          // Wait for the actual common-X checkpoint, not a test override of the gate.
          await page.waitForFunction(()=>{
            const s=window.__rubiGuidedTest?.();
            return s&&!s.running || (s?.running&&!document.querySelector('#g-enough').disabled);
          },null,{timeout:120000});
          const canEnd=await page.locator('#g-enough').isVisible() && await page.locator('#g-enough').isEnabled();
          if(canEnd)await page.locator('#g-enough').click();
          await page.waitForFunction(()=>!window.__rubiGuidedTest?.().running,null,{timeout:120000});
          const snapshot=await state();timings.push({trial,route,attempt,seen:snapshot.seen,views:snapshot.previewEvents});
          if(snapshot.seen.length>seenBefore||snapshot.phase==='choice'){qualified=true;break;}
          assert.ok(Object.values(snapshot.runs).every(r=>r.completed),'physical rollout failed rather than display timing');
        }
        assert.ok(qualified,'viewing did not qualify after three attempts');
      }
      await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='choice');
      const snapshot=await state();
      assert.equal(snapshot.runtimeId,initial.runtimeId);assert.equal(snapshot.modelCreateCount,1);assert.equal(snapshot.onnxCreateCount,1);
      assert.deepEqual(snapshot.runs.direct.initialQpos,snapshot.runs.detour.initialQpos);
      assert.deepEqual(snapshot.runs.direct.initialQvel,snapshot.runs.detour.initialQvel);
      assert.ok(snapshot.previewEvents.some(e=>e.earlyFinish&&e.qualified),'early finish was not exercised');
      assert.equal(await page.locator('#g-world').isVisible(),true,'world stays visible beside answer controls');
      rows.push({height:snapshot.scenario.height,views:snapshot.previewEvents});
      if(trial===0){
        await page.setViewportSize({width:1440,height:900});
        await page.screenshot({path:'artifacts/review-choice-desktop.png',fullPage:true});
        const layout=await page.evaluate(()=>({world:document.querySelector('.g-viewport').getBoundingClientRect().toJSON(),choice:document.querySelector('#g-choice').getBoundingClientRect().toJSON(),scroll:document.documentElement.scrollWidth,width:innerWidth}));
        assert.ok(layout.world.height<=420);assert.ok(layout.choice.x>layout.world.x);assert.ok(layout.scroll<=layout.width);
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:'artifacts/review-choice-mobile.png',fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.setViewportSize({width:1024,height:768});
      }
      // Start a replay, then choose before its end. Choices must remain enabled.
      await page.locator('#g-replay-a').click();
      await page.waitForFunction(()=>window.__rubiGuidedTest?.().running);
      assert.equal(await page.locator('#g-choice').isVisible(),true);
      assert.equal(await page.locator('#g-tie').isEnabled(),true);
      await page.waitForTimeout(120);
      // Double invocation also tests submission/race protection without a second write.
      await page.locator('#g-tie').evaluate(e=>{e.click();e.click();});
      await page.waitForFunction(t=>window.__rubiGuidedTest?.().index>t,trial,{timeout:30000});
      if(trial===0){
        await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe');
        await page.waitForTimeout(300);
        assert.equal((await state()).seen.length,0,'stale replay callback overwrote next question');
      }
    }
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='complete',null,{timeout:30000});
    assert.equal(writes.filter(r=>r.kind==='trial').length,2);assert.equal(writes.filter(r=>r.kind==='profile').length,1);
    for(const {payload} of writes.filter(r=>r.kind==='trial')){
      assert.equal(payload.protocolVersion,'guided-self-paced-v5');
      assert.equal(payload.labelConditionVersion,'core-view-no-labels-review-with-choice-v2');
      assert.equal(payload.choiceDuringReplay,true);assert.equal(payload.choice,'tie');
      assert.ok(payload.previewCoverage.direct>0&&payload.previewCoverage.direct<1);
      assert.ok(payload.previewCoverage.detour>0&&payload.previewCoverage.detour<1);
      assert.equal(payload.runs.direct.frames,undefined);assert.equal(payload.runs.detour.frames,undefined);
      assert.ok(payload.previewEvents.some(e=>e.interrupted&&e.mode==='replay'));
      assert.ok(Date.parse(payload.profileAnsweredAtUtc)<=Date.parse(payload.createdAt));
    }
    const completed=await state();await page.screenshot({path:'artifacts/review-complete.png',fullPage:true});
    await page.reload();await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='complete');
    page.once('dialog',d=>d.accept());await page.locator('#g-restart').click();
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='welcome');
    const repeated=await state();
    assert.notEqual(repeated.sessionId,completed.sessionId);assert.equal(repeated.participantId,completed.participantId);assert.equal(repeated.repeatIndex,1);
    const archive=await page.evaluate(id=>{
      const key=Object.keys(localStorage).find(k=>k.endsWith(':archive:'+id));return key?JSON.parse(localStorage.getItem(key)):null;
    },completed.sessionId);
    assert.ok(archive?.complete);assert.equal(archive.responses.length,2);assert.equal(writes.length,3,'restart must not write or erase Sheet rows');
    assert.deepEqual(errors,[]);
    const report={status:'PASS',collector:'mock only; no real Sheets writes',realPolicy:true,rows,timings,trialSubmissions:2,profileSubmissions:1,restartPreserved:true,replayChoices:true};
    await writeFile('artifacts/review-ux.json',JSON.stringify(report,null,2));console.log('GUIDED_UI_PASS',JSON.stringify(report));return report;
  }catch(e){
    await page.screenshot({path:'artifacts/review-failure.png',fullPage:true}).catch(()=>{});
    await writeFile('artifacts/review-timing-failure.json',JSON.stringify(timings,null,2));
    console.log('REVIEW_FAILURE',JSON.stringify(await page.evaluate(()=>({error:document.querySelector('#g-error')?.textContent,state:window.__rubiGuidedTest?.()})).catch(()=>({}))));throw e;
  }finally{await page.close();}
}
