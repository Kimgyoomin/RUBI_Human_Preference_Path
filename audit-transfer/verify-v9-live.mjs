// No trial/profile writes, admin actions or collection-property changes.
import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const site='https://kimgyoomin.github.io/RUBI_Human_Preference_Path/';
const endpoint='https://script.google.com/macros/s/AKfycbzkk-mfGemkhbChiP7ldNRfIUYLNJTVzVh40JtScTIYSG2qP6QpWh9rtFHsOKfSvnTnWw/exec';
fs.mkdirSync('artifacts/v9-live',{recursive:true});
const report={checkedAtUtc:new Date().toISOString(),site,trialProfileRequests:0,blockedOtherPosts:0,pages:[]};
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
 let trusted=false;try{const u=new URL(e.origin);trusted=u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname.endsWith('.googleusercontent.com'));}catch{}
 const x=e.data;if(trusted&&x?.source==='rubi-hpp-apps-script'&&x?.kind==='ping')window.__auditReplies.push({ok:x.ok,releaseVersion:x.releaseVersion,protocol:x.protocolVersion,collectionOpen:x.collectionOpen,datasetTag:x.datasetTag,schemaReady:x.schemaReady});
});});
try{
 let s;
 for(let i=0;i<160;i++){
  const r=await context.request.get(site+'study.json?audit=v9-'+i,{timeout:15000});
  if(r.status()===200){const x=await r.json();if(x.protocolVersion==='height-blocks-no-repeat-v9'){s=x;break;}}
  await new Promise(r=>setTimeout(r,4000));
 }
 assert.ok(s,'v9 Pages not observed');assert.equal(s.responseApi,endpoint);assert.equal(s.collectionPhase,'owner-ui-check-v1');
 report.study={id:s.id,protocol:s.protocolVersion,candidates:s.heightBlocks.detoursMm,requiredRelease:s.requiredReleaseVersion};
 for(const mode of ['legacy-v7','current']){
  const p=await context.newPage();await p.goto(site+'?protocol='+mode,{waitUntil:'domcontentloaded',timeout:45000});
  await p.waitForFunction(()=>window.__auditReplies.length>0,null,{timeout:45000});
  await p.waitForFunction(()=>document.querySelector('#g-welcome')||document.querySelector('#app p[role="status"]'),null,{timeout:15000});
  assert.equal(await p.locator('#g-research,#generate,#api-url').count(),0);
  const replies=await p.evaluate(()=>window.__auditReplies),reply=replies.at(-1);
  assert.equal(reply.ok,true);assert.equal(reply.schemaReady,true);assert.equal(reply.datasetTag,'main-v1');
  const welcome=await p.locator('#g-welcome').count()>0;
  const message=await p.locator('#app p[role="status"]').textContent().catch(()=>null);
  if(mode==='legacy-v7'&&reply.collectionOpen)assert.ok(welcome,'legacy must remain usable');
  if(mode==='current'&&reply.releaseVersion!=='no-repeat-collector-v9')assert.ok(!welcome&&message?.includes('업데이트'),'new protocol must wait for owner collector redeploy');
  report.pages.push({mode,welcome,message,replies});
  await p.screenshot({path:'artifacts/v9-live/'+mode+'.png',fullPage:true});await p.close();
 }
 assert.equal(report.trialProfileRequests,0);report.status='PASS';console.log('V9_READONLY_LIVE',JSON.stringify(report));
}catch(e){report.status='FAIL';report.error=String(e);throw e;}
finally{fs.writeFileSync('artifacts/v9-live/report.json',JSON.stringify(report,null,2));await browser.close();}
