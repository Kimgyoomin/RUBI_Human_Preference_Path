import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mockCollector} from '../tests/fixtures/collector-mock.mjs';

export async function guidedChecks(browser){
  const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[],writes=[],timings=[];
  page.on('pageerror',e=>errors.push(e.message));
  const study=JSON.parse(await readFile('config/study.pilot.json','utf8'));
  const manifest=JSON.parse(await readFile('public/media/rubi-intro-v1/manifest.json','utf8'));
  const film=await readFile('public/media/rubi-intro-v1/rubi-intro.mp4');
  assert.equal(createHash('sha256').update(film).digest('hex'),manifest.videoSha256);
  assert.equal(manifest.episodes.length,6);assert.ok(manifest.episodes.every(e=>e.run.completed));
  study.heightBlocks.heightsCm=[5,9]; // Eight real trials, not fabricated walking.
  const collector=mockCollector();let oldCollector=true,lostAck=false;
  await page.route('**/study.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(study)}));
  // Every write intercepted; execute the real Code.gs against in-memory Sheets.
  await page.route('https://script.google.com/macros/s/**/exec',async route=>{
    const request=JSON.parse(new URLSearchParams(route.request().postData()||'').get('payload')||'{}');
    const payload=request.payload||{};if(request.kind!=='ping')writes.push(request);
    let reply;
    try{
      const result=collector.call(request.kind,payload);
      reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:true,...result};
      if(request.kind==='ping'&&oldCollector)reply.collectorVersion='old-deployment';
      if(request.kind==='trial'&&!lostAck){lostAck=true;reply.ok=false;reply.message='테스트용 저장 확인 응답 유실';}
    }catch(e){reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:false,message:String(e)};}
    await route.fulfill({contentType:'text/html',body:`<!doctype html><script>top.postMessage(${JSON.stringify(reply)},'http://127.0.0.1:4177');</script>`});
  });
  const state=()=>page.evaluate(()=>window.__rubiGuidedTest());
  try{
    await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='welcome');
    assert.equal(await page.locator('#g-world').isVisible(),false);assert.equal(await page.locator('#generate').count(),0);
    assert.equal(await page.locator('#g-intro-video').getAttribute('src'),null);
    await page.locator('#g-consent').check();await page.locator('#g-start').click();
    await page.locator('#g-robotics').selectOption('no');await page.locator('#g-knew').selectOption('yes');await page.locator('#g-exposure').selectOption('video_only');
    assert.equal((await state()).modelCreateCount,0);await page.locator('#g-profile-next').click();
    await page.waitForFunction(()=>document.querySelector('#g-intro-video').readyState>=2,null,{timeout:45000});
    assert.equal(await page.locator('#g-begin').isEnabled(),false);assert.equal(await page.locator('#g-intro-chapters button').count(),6);
    await page.locator('#g-intro-video').evaluate(async v=>{v.muted=true;await v.play();});
    await page.waitForFunction(()=>document.querySelector('#g-intro-video').currentTime>.25);
    await page.locator('#g-intro-video').evaluate(v=>v.pause());
    const media=await page.locator('#g-intro-video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration}));
    assert.equal(media.width,960);assert.equal(media.height,540);assert.ok(Math.abs(media.duration-manifest.durationSeconds)<.2);
    await page.screenshot({path:'artifacts/intro-screen-desktop.png',fullPage:true});
    await page.locator('#g-intro-ack').check();await page.locator('#g-begin').click();
    await page.waitForFunction(()=>document.querySelector('#g-error')?.textContent?.includes('업데이트가 필요'));
    assert.equal(writes.length,0,'old collector must be blocked before any submission');oldCollector=false;
    await page.locator('#g-load-retry').click();
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe',null,{timeout:120000});
    const initial=await state();assert.equal(initial.introduction.contentId,manifest.contentId);
    assert.equal(initial.modelCreateCount,1);assert.equal(initial.onnxCreateCount,1);assert.equal(initial.spriteCount,0);
    assert.ok(initial.markerNames.includes('start-green-disc'));assert.ok(initial.markerNames.includes('goal-red-target'));
    assert.equal(await page.locator('.g-viewport').innerText(),'');assert.equal(await page.locator('#g-tie').count(),0);
    assert.equal(await page.locator('#g-choose-a').isEnabled(),false);
    const rows=[],expected=[];
    for(let trial=0;trial<8;trial++){
      for(let route=0;route<2;route++){
        let qualified=false;
        for(let attempt=0;attempt<3;attempt++){
          const seenBefore=(await state()).seen.length;await page.locator('#g-watch').click();
          await page.waitForFunction(()=>{const s=window.__rubiGuidedTest?.();return s&&!s.running||(s?.running&&!document.querySelector('#g-enough').disabled);},null,{timeout:120000});
          if(await page.locator('#g-enough').isVisible()&&await page.locator('#g-enough').isEnabled())await page.locator('#g-enough').click();
          await page.waitForFunction(()=>!window.__rubiGuidedTest?.().running,null,{timeout:120000});
          const s=await state();timings.push({trial,route,attempt,seen:s.seen,views:s.previewEvents});
          if(s.seen.length>seenBefore||s.phase==='choice'){qualified=true;break;}
          assert.ok(Object.values(s.runs).every(r=>r.completed),'physical rollout failed');
        }
        assert.ok(qualified,'viewing did not qualify after three attempts');
      }
      await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='choice');const s=await state();
      assert.equal(s.query.blockIndex,Math.floor(trial/4)+1);assert.equal(s.query.trialInBlock,trial%4+1);
      assert.equal(s.scenario.height,s.plan.blocks[Math.floor(trial/4)].heightCm/100);
      assert.equal(s.runtimeId,initial.runtimeId);assert.equal(s.modelCreateCount,1);assert.equal(s.onnxCreateCount,1);
      assert.deepEqual(s.runs.direct.initialQpos,s.runs.detour.initialQpos);assert.deepEqual(s.runs.direct.initialQvel,s.runs.detour.initialQvel);
      assert.ok(s.previewEvents.some(e=>e.earlyFinish&&e.qualified));assert.equal(await page.locator('#g-world').isVisible(),true);
      for(const [letter,key] of [['a',s.aKey],['b',s.bKey]]){
        const text=await page.locator('#g-choose-'+letter).textContent();assert.ok(text.includes(letter.toUpperCase()+'로 보내기'));
        assert.ok(text.includes(key==='direct'?`${Math.round(s.scenario.height*100)} cm`:`${s.scenario.detour.toFixed(1)} m 더`));
      }
      assert.equal(await page.locator('.g-binary-choices button').count(),2);rows.push({height:s.scenario.height,query:s.query});
      if(trial===0){
        await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'artifacts/block-choice-desktop.png',fullPage:true});
        const layout=await page.evaluate(()=>({world:document.querySelector('.g-viewport').getBoundingClientRect().toJSON(),choice:document.querySelector('#g-choice').getBoundingClientRect().toJSON(),scroll:document.documentElement.scrollWidth,width:innerWidth}));
        assert.ok(layout.world.height<=420);assert.ok(layout.choice.x>layout.world.x);assert.ok(layout.scroll<=layout.width);
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/block-choice-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1024,height:768});
      }
      if(trial<2){
        await page.locator('#g-replay-a').click();await page.waitForFunction(()=>window.__rubiGuidedTest?.().running);
        assert.equal(await page.locator('#g-choice').isVisible(),true);
        const button=trial===0?'#g-choose-a':'#g-choose-b';expected.push(trial===0?s.aKey:s.bKey);
        assert.equal(await page.locator(button).isEnabled(),true);await page.waitForTimeout(120);await page.locator(button).evaluate(e=>{e.click();e.click();});
      }else if(trial<7){
        const pick=s.scenario.detour<1.1?'detour':'direct';expected.push(pick);await page.locator(pick===s.aKey?'#g-choose-a':'#g-choose-b').click();
      }else{
        expected.push('skip');await page.locator('.g-skip summary').click();page.once('dialog',d=>d.accept());await page.locator('#g-skip').click();
      }
      if(trial===0){
        await page.locator('#g-save-retry').waitFor({state:'visible'});assert.equal((await state()).index,0);
        assert.equal(collector.rows('Trials').length,1);assert.equal(collector.rows('Sessions')[0].status,'started');
        assert.equal(collector.rows('Sessions')[0].knewRubiBeforeStudy,'yes');await page.locator('#g-save-retry').click();
      }
      await page.waitForFunction(t=>window.__rubiGuidedTest?.().index>t,trial,{timeout:30000});
      if(trial<7){await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='observe');await page.waitForTimeout(300);assert.equal((await state()).seen.length,0,'stale replay overwrote next question');}
    }
    await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='complete',null,{timeout:30000});
    const attempts=writes.filter(r=>r.kind==='trial');assert.equal(attempts.length,9);
    const trials=[...new Map(attempts.map(r=>[r.payload.submissionId,r])).values()];assert.equal(trials.length,8);assert.equal(writes.filter(r=>r.kind==='profile').length,1);
    trials.forEach(({payload:p},i)=>{
      assert.equal(p.protocolVersion,'height-blocks-binary-v7');assert.equal(p.labelConditionVersion,'same-policy-intro-blocks-explicit-binary-v2');assert.equal(p.choice,expected[i]);
      assert.equal(p.tutorialVersion,manifest.version+':'+manifest.contentId);assert.equal(p.introduction.contentId,manifest.contentId);
      assert.ok(Date.parse(p.profileAnsweredAtUtc)<=Date.parse(p.introduction.acknowledgedAtUtc));
      if(i<2){assert.equal(p.choiceDuringReplay,true);assert.ok(p.previewEvents.some(e=>e.interrupted&&e.mode==='replay'));}else if(i===7)assert.equal(p.skipReason,'insufficient_information');
      assert.equal(p.runs.direct.frames,undefined);assert.equal(p.runs.detour.frames,undefined);
    });
    assert.equal(collector.rows('Trials').length,8);assert.equal(collector.rows('Runs').length,16);assert.equal(collector.rows('Sessions')[0].status,'completed');
    const completed=await state();await page.screenshot({path:'artifacts/block-complete.png',fullPage:true});await page.reload();await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='complete');
    page.once('dialog',d=>d.accept());await page.locator('#g-restart').click();await page.waitForFunction(()=>window.__rubiGuidedTest?.().phase==='welcome');
    const repeated=await state();assert.notEqual(repeated.sessionId,completed.sessionId);assert.equal(repeated.participantId,completed.participantId);assert.equal(repeated.repeatIndex,1);
    const archive=await page.evaluate(id=>{const k=Object.keys(localStorage).find(k=>k.endsWith(':archive:'+id));return k?JSON.parse(localStorage.getItem(k)):null;},completed.sessionId);
    assert.ok(archive?.complete);assert.equal(archive.responses.length,8);assert.equal(writes.length,10);assert.deepEqual(errors,[]);
    const report={status:'PASS',collector:'actual Code.gs with in-memory Sheet API; no real Google writes',realPolicy:true,intro:{contentId:manifest.contentId,...media,episodes:6},rows,trialSubmissions:8,profileSubmissions:1,restartPreserved:true,replayChoices:true,saveRetry:true,firstTrialProfile:true};
    await writeFile('artifacts/block-ux.json',JSON.stringify(report,null,2));console.log('GUIDED_UI_PASS',JSON.stringify(report));return report;
  }catch(e){
    await page.screenshot({path:'artifacts/block-failure.png',fullPage:true}).catch(()=>{});await writeFile('artifacts/review-timing-failure.json',JSON.stringify(timings,null,2));
    console.log('REVIEW_FAILURE',JSON.stringify(await page.evaluate(()=>({error:document.querySelector('#g-error')?.textContent,state:window.__rubiGuidedTest?.(),mediaError:document.querySelector('#g-intro-video')?.error?.message})).catch(()=>({}))));throw e;
  }finally{await page.close();}
}
