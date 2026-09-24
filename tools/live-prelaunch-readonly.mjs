// Manual prelaunch audit. No trial/profile submissions, no Google data writes,
// no changes to collection-open properties, and no deployment actions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire('/tmp/rubi-live-audit/package.json');
const {chromium} = require('playwright');
const site = 'https://kimgyoomin.github.io/RUBI_Human_Preference_Path/';
const main = JSON.parse(fs.readFileSync('config/study.main.json','utf8'));
const pilot = JSON.parse(fs.readFileSync('public/study.json','utf8'));
const expectedEndpoint = 'https://script.google.com/macros/s/AKfycbzkk-mfGemkhbChiP7ldNRfIUYLNJTVzVh40JtScTIYSG2qP6QpWh9rtFHsOKfSvnTnWw/exec';
assert.equal(pilot.responseApi,expectedEndpoint);
assert.equal(main.responseApi,expectedEndpoint);
fs.mkdirSync('artifacts/live-prelaunch',{recursive:true});
const report = {checkedAtUtc:new Date().toISOString(),auditedApplicationCommit:'6f294b3ebd3fab5da9baf7e37b23d13bff33129a',site,paths:[],privatePaths:[],collector:{},blockedNonPingPosts:0,trialOrProfileRequests:0,scope:'public Pages GET and collector ping only; no Google research writes'};
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const context = await browser.newContext({viewport:{width:1365,height:900}});
await context.route('**/*',async route=>{
  const req=route.request();
  if(req.method()!=='POST')return route.continue();
  let allowed=false;
  try {
    const url=new URL(req.url());
    const raw=new URLSearchParams(req.postData()||'').get('payload');
    const request=raw?JSON.parse(raw):null;
    allowed=url.href===expectedEndpoint&&request?.kind==='ping';
    if(request?.kind==='trial'||request?.kind==='profile')report.trialOrProfileRequests++;
  } catch {}
  if(!allowed){report.blockedNonPingPosts++;return route.abort('blockedbyclient');}
  return route.continue();
});
const page=await context.newPage();
const researchSelectors=['#generate','#api-url','#studio-mode','#g-research','#download-responses'];
await page.addInitScript(()=>{
  localStorage.setItem('isAdmin','true');
  localStorage.setItem('role','researcher');
  localStorage.setItem('rubi-research','true');
});
async function ping(experimentId,studyStatus){
  return page.evaluate(async({endpoint,experimentId,studyStatus})=>{
    const requestId=crypto.randomUUID();
    return new Promise(resolve=>{
      const frame=document.createElement('iframe');frame.name='audit-'+requestId;frame.hidden=true;
      const form=document.createElement('form');form.method='POST';form.action=endpoint;form.target=frame.name;form.hidden=true;
      const field=document.createElement('input');field.name='payload';field.value=JSON.stringify({kind:'ping',requestId,payload:{experimentId,studyStatus}});form.append(field);
      const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);form.remove();frame.remove();};
      const receive=event=>{
        let trusted=false;
        try {const u=new URL(event.origin);trusted=u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'));}catch{}
        const d=event.data;
        if(!trusted||!d||d.source!=='rubi-hpp-apps-script'||d.requestId!==requestId)return;
        cleanup();
        resolve({ok:d.ok,kind:d.kind,service:d.service,collectorVersion:d.collectorVersion,releaseVersion:d.releaseVersion,datasetTag:d.datasetTag,schemaReady:d.schemaReady,collectionOpen:d.collectionOpen,experimentId:d.experimentId,studyStatus:d.studyStatus,message:d.message});
      };
      const timer=setTimeout(()=>{cleanup();resolve({ok:false,timeout:true,message:'Read-only ping timed out; deployment state not inferred.'});},40000);
      window.addEventListener('message',receive);document.body.append(frame,form);form.submit();
    });
  },{endpoint:expectedEndpoint,experimentId,studyStatus});
}
try {
  const response=await context.request.get(site+'study.json',{timeout:30000});
  assert.equal(response.status(),200);const deployed=await response.json();
  report.deployedStudy={id:deployed.id,status:deployed.status,protocolVersion:deployed.protocolVersion};
  assert.equal(deployed.id,pilot.id);assert.equal(deployed.status,'draft');assert.equal(deployed.responseApi,expectedEndpoint);
  for(const suffix of ['', '?mode=research','?mode=research&admin=true','?mode=%72esearch','#research']){
    const r=await page.goto(site+suffix,{waitUntil:'domcontentloaded',timeout:60000});
    assert.equal(r.status(),200);await page.locator('#g-start').waitFor({state:'visible',timeout:30000});
    for(const selector of researchSelectors)assert.equal(await page.locator(selector).count(),0,selector+' is exposed');
    const scripts=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(x=>/\.js(?:\?|$)/.test(x)));
    assert.ok(!scripts.some(x=>/\/assets\/main-[^/]+\.js/.test(x)),'research bundle loaded');
    report.paths.push({suffix,participantVisible:true,researchElements:0,researchBundleLoaded:false});
  }
  await page.screenshot({path:'artifacts/live-prelaunch/public-research-blocked-live.png',fullPage:true});
  for(const path of ['src/main.ts','config/study.main.json','apps-script/Code.gs','api/server.mjs']){
    const r=await context.request.get(site+path,{timeout:30000});
    assert.equal(r.status(),404,'Internal source is publicly served: '+path);report.privatePaths.push({path,status:r.status()});
  }
  report.collector.pilot=await ping(pilot.id,pilot.status);
  report.collector.main=await ping(main.id,main.status);
  const c=report.collector.main;
  report.collector.mainDeployment=c.ok&&c.releaseVersion===main.requiredReleaseVersion&&c.datasetTag===main.datasetTag&&c.schemaReady===true
    ?(c.collectionOpen===false?'V8_DEPLOYED_MAIN_CLOSED':c.collectionOpen===true?'V8_DEPLOYED_MAIN_OPEN':'V8_DEPLOYED_OPEN_STATE_UNKNOWN')
    :(c.timeout?'UNVERIFIED_NETWORK_TIMEOUT':'OWNER_REDEPLOY_REQUIRED');
  assert.equal(report.trialOrProfileRequests,0);
  report.publicBoundary='PASS';report.status='AUDIT_COMPLETE';
  console.log('LIVE_PRELAUNCH_READONLY',JSON.stringify(report));
} catch(error){
  report.status='AUDIT_FAILED';report.error=String(error);
  await page.screenshot({path:'artifacts/live-prelaunch/failure.png',fullPage:true}).catch(()=>{});
  throw error;
} finally {
  fs.writeFileSync('artifacts/live-prelaunch/report.json',JSON.stringify(report,null,2));
  await browser.close();
}
