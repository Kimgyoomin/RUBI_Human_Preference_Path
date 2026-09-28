import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const site='https://kimgyoomin.github.io/RUBI_Human_Preference_Path/';
const endpoint='https://script.google.com/macros/s/AKfycbzkk-mfGemkhbChiP7ldNRfIUYLNJTVzVh40JtScTIYSG2qP6QpWh9rtFHsOKfSvnTnWw/exec';
const report={checkedAtUtc:new Date().toISOString(),site,scope:'Pages GET and collector ping only; no trial/profile writes or admin actions',trialProfileRequests:0,blockedOtherPosts:0,paths:[]};
fs.mkdirSync('artifacts/external-pilot-live',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1365,height:900}});
await context.route('**/*',async route=>{
 const req=route.request();if(req.method()!=='POST')return route.continue();
 let p;try{p=JSON.parse(new URLSearchParams(req.postData()||'').get('payload')||'{}');}catch{}
 if(p?.kind==='trial'||p?.kind==='profile')report.trialProfileRequests++;
 if(req.url()===endpoint&&p?.kind==='ping')return route.continue();
 report.blockedOtherPosts++;return route.abort('blockedbyclient');
});
await context.addInitScript(()=>{window.__auditReplies=[];window.addEventListener('message',e=>{
 let trusted=false;try{const u=new URL(e.origin);trusted=u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'));}catch{}
 const x=e.data;if(trusted&&x?.source==='rubi-hpp-apps-script'&&x?.kind==='ping')window.__auditReplies.push({ok:x.ok,releaseVersion:x.releaseVersion,collectionOpen:x.collectionOpen,datasetTag:x.datasetTag,schemaReady:x.schemaReady});
});});
const page=await context.newPage();
try{
 const response=await context.request.get(site+'study.json?audit=external-'+Date.now());assert.equal(response.status(),200);
 const config=await response.json();assert.equal(config.collectionPhase,'external-pilot-v1');assert.equal(config.protocolVersion,'height-blocks-no-repeat-v9');assert.equal(config.responseApi,endpoint);
 assert.deepEqual(config.heightBlocks.heightsCm,[5,7,9,11]);assert.deepEqual(config.heightBlocks.detoursMm,[400,600,800,1000,1200,1400,1600,1800,2000,2200,2400]);assert.equal(config.heightBlocks.questionsPerHeight,4);
 report.study={id:config.id,phase:config.collectionPhase,protocol:config.protocolVersion};
 const pilotKey=`RUBI_Human_Preference_Path:${config.id}:${config.protocolVersion}:external-pilot-v1`;
 const checkKey=`RUBI_Human_Preference_Path:${config.id}:${config.protocolVersion}:owner-ui-check-v1`;
 for(const suffix of ['','?mode=research','?mode=research&admin=true','?protocol=current']){
  await page.goto(site+suffix,{waitUntil:'domcontentloaded',timeout:45000});await page.locator('#g-welcome').waitFor({state:'visible',timeout:60000});
  const reply=await page.evaluate(()=>window.__auditReplies.at(-1));assert.equal(reply?.releaseVersion,'no-repeat-collector-v9');assert.equal(reply?.collectionOpen,true);assert.equal(reply?.schemaReady,true);assert.equal(reply?.datasetTag,'main-v1');
  assert.equal(await page.locator('#g-research,#generate,#api-url').count(),0);assert.equal(await page.locator('#g-ui-check-note').isVisible(),false);assert.equal(await page.locator('#g-external-pilot-note').isVisible(),true);
  const session=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),pilotKey);assert.match(session.id,/^pilot-[0-9a-f-]{36}$/);assert.equal(session.responses.length,0);
  report.paths.push({suffix,pilotWelcome:true,developerNotice:false,researchControls:0,localPilotPrefix:true});report.collector=reply;
 }
 const pilotRaw=await page.evaluate(k=>localStorage.getItem(k),pilotKey);
 await page.screenshot({path:'artifacts/external-pilot-live/participant-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/external-pilot-live/participant-mobile.png',fullPage:true});
 // Explicit nonprivileged test URL, with storage isolated from external participants.
 await page.goto(site+'?collection=ui-check&protocol=current',{waitUntil:'domcontentloaded'});await page.locator('#g-welcome').waitFor({state:'visible',timeout:60000});
 assert.equal(await page.locator('#g-ui-check-note').isVisible(),true);assert.equal(await page.locator('#g-external-pilot-note').isVisible(),false);assert.equal(await page.locator('#g-research').count(),0);
 const checkRaw=await page.evaluate(k=>{const x=JSON.parse(localStorage.getItem(k));x.consent=true;const value=JSON.stringify(x);localStorage.setItem(k,value);return value;},checkKey);
 await page.goto(site,{waitUntil:'domcontentloaded'});await page.locator('#g-welcome').waitFor({state:'visible',timeout:60000});
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),pilotKey),pilotRaw);assert.equal(await page.evaluate(k=>localStorage.getItem(k),checkKey),checkRaw);
 assert.equal(await page.locator('#g-ui-check-note').isVisible(),false);report.purposeIsolation=true;
 for(const path of ['src/main.ts','apps-script/Code.gs','config/study.main.json']){const r=await context.request.get(site+path);assert.equal(r.status(),404);}
 assert.equal(report.trialProfileRequests,0);report.status='PASS';console.log('EXTERNAL_PILOT_LIVE',JSON.stringify(report));
}catch(error){report.status='FAIL';report.error=String(error);await page.screenshot({path:'artifacts/external-pilot-live/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{fs.writeFileSync('artifacts/external-pilot-live/report.json',JSON.stringify(report,null,2));await browser.close();}
