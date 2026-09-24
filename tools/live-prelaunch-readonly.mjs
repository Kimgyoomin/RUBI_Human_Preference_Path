// Read-only post-deployment audit: no trial/profile writes or property changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('/tmp/rubi-live-audit/package.json');
const {chromium}=require('playwright');
const site='https://kimgyoomin.github.io/RUBI_Human_Preference_Path/';
const main=JSON.parse(fs.readFileSync('config/study.main.json','utf8'));
const pilot=JSON.parse(fs.readFileSync('config/study.pilot.json','utf8'));
const expectedEndpoint=main.responseApi;
const commit='ff47cca12d5f0ffcd49950671bc92316bfbd9918';
fs.mkdirSync('artifacts/live-prelaunch',{recursive:true});
const report={checkedAtUtc:new Date().toISOString(),auditedApplicationCommit:commit,site,paths:[],privatePaths:[],collector:{},blockedNonPingPosts:0,trialOrProfileRequests:0,scope:'main UI-check deployment GET and collector ping only; no real response writes or property changes'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1365,height:900}});
await context.route('**/*',async route=>{
 const req=route.request();if(req.method()!=='POST')return route.continue();
 let allowed=false;
 try{
  const raw=new URLSearchParams(req.postData()||'').get('payload'),request=raw?JSON.parse(raw):null;
  allowed=req.url()===expectedEndpoint&&request?.kind==='ping';
  if(request?.kind==='trial'||request?.kind==='profile')report.trialOrProfileRequests++;
 }catch{}
 if(!allowed){report.blockedNonPingPosts++;return route.abort('blockedbyclient');}
 return route.continue();
});
const page=await context.newPage();
await page.addInitScript(()=>{localStorage.setItem('isAdmin','true');localStorage.setItem('role','researcher');localStorage.setItem('rubi-research','true');});
async function ping(experimentId,studyStatus){
 return page.evaluate(async({endpoint,experimentId,studyStatus})=>{
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{
   const frame=document.createElement('iframe');frame.name='audit-'+requestId;frame.hidden=true;
   const form=document.createElement('form');form.method='POST';form.action=endpoint;form.target=frame.name;form.hidden=true;
   const field=document.createElement('input');field.name='payload';field.value=JSON.stringify({kind:'ping',requestId,payload:{experimentId,studyStatus}});form.append(field);
   const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);form.remove();frame.remove();};
   const receive=event=>{
    let trusted=false;try{const u=new URL(event.origin);trusted=u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'));}catch{}
    const d=event.data;if(!trusted||!d||d.source!=='rubi-hpp-apps-script'||d.requestId!==requestId)return;
    cleanup();resolve({ok:d.ok,kind:d.kind,service:d.service,collectorVersion:d.collectorVersion,releaseVersion:d.releaseVersion,datasetTag:d.datasetTag,schemaReady:d.schemaReady,collectionOpen:d.collectionOpen,experimentId:d.experimentId,studyStatus:d.studyStatus,message:d.message});
   };
   const timer=setTimeout(()=>{cleanup();resolve({ok:false,timeout:true,message:'Read-only ping timed out.'});},40000);
   window.addEventListener('message',receive);document.body.append(frame,form);form.submit();
  });
 },{endpoint:expectedEndpoint,experimentId,studyStatus});
}
try{
 // Allow the independently verified main deployment job to finish; no deployment is triggered here.
 let deployed;
 for(let attempt=0;attempt<120;attempt++){
  const response=await context.request.get(site+'study.json?audit='+commit+'&attempt='+attempt,{timeout:15000});
  if(response.status()===200){const candidate=await response.json();if(candidate.id===main.id&&candidate.collectionPhase==='owner-ui-check-v1'){deployed=candidate;break;}}
  await new Promise(r=>setTimeout(r,3000));
 }
 assert.ok(deployed,'Expected owner UI-check deployment was not observed within the audit window.');
 assert.equal(deployed.status,'released');assert.equal(deployed.responseApi,expectedEndpoint);
 report.deployedStudy={id:deployed.id,status:deployed.status,protocolVersion:deployed.protocolVersion,collectionPhase:deployed.collectionPhase};
 for(const suffix of ['','?mode=research','?mode=research&admin=true','?mode=%72esearch','#research']){
  const url=new URL(site+suffix);url.searchParams.set('audit',commit);
  const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);
  await page.waitForFunction(()=>document.querySelector('#g-start')||document.body.innerText.includes('지금은 설문을 받지 않고 있습니다.'),null,{timeout:40000});
  const closed=(await page.locator('body').innerText()).includes('지금은 설문을 받지 않고 있습니다.');
  for(const selector of ['#generate','#api-url','#studio-mode','#g-research','#download-responses'])assert.equal(await page.locator(selector).count(),0,selector+' exposed');
  if(!closed){assert.equal(await page.locator('#g-ui-check-note').isVisible(),true);assert.match(await page.locator('#g-ui-check-id').textContent(),/ui-check-[0-9a-f-]{36}/);}
  const scripts=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(x=>/\.js(?:\?|$)/.test(x)));
  assert.ok(!scripts.some(x=>/\/assets\/main-[^/]+\.js/.test(x)));
  report.paths.push({suffix,closedGate:closed,researchElements:0,researchBundleLoaded:false,uiCheckLabelVerified:!closed});
 }
 await page.screenshot({path:'artifacts/live-prelaunch/main-ui-check-live.png',fullPage:true});
 for(const path of ['src/main.ts','config/study.main.json','apps-script/Code.gs','api/server.mjs']){
  const r=await context.request.get(site+path,{timeout:30000});assert.equal(r.status(),404);report.privatePaths.push({path,status:r.status()});
 }
 report.collector.pilot=await ping(pilot.id,pilot.status);report.collector.main=await ping(main.id,main.status);
 const c=report.collector.main;
 assert.equal(c.ok,true);assert.equal(c.releaseVersion,main.requiredReleaseVersion);assert.equal(c.datasetTag,main.datasetTag);assert.equal(c.schemaReady,true);assert.equal(typeof c.collectionOpen,'boolean');
 report.collector.mainDeployment=c.collectionOpen?'MAIN_UI_CHECK_OPEN':'MAIN_UI_CHECK_CLOSED_OWNER_ACTION_REQUIRED';
 assert.equal(report.trialOrProfileRequests,0);report.publicBoundary='PASS';report.status='AUDIT_COMPLETE';
 console.log('LIVE_PRELAUNCH_READONLY',JSON.stringify(report));
}catch(e){report.status='AUDIT_FAILED';report.error=String(e);await page.screenshot({path:'artifacts/live-prelaunch/failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{fs.writeFileSync('artifacts/live-prelaunch/report.json',JSON.stringify(report,null,2));await browser.close();}
