import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {releaseMock} from '../tests/fixtures/release-mock.mjs';

const origin='http://127.0.0.1:4173';
const base=origin+'/RUBI_Human_Preference_Path/';
const main=JSON.parse(await readFile('public/study.json','utf8'));
assert.equal(main.id,'rubi-hpp-main-v1');assert.equal(main.status,'released');assert.equal(main.collectionPhase,'owner-ui-check-v1');
const boundary=JSON.parse(await readFile('artifacts/public-build-boundary.json','utf8'));
assert.equal(boundary.participantOnly,true);assert.deepEqual(boundary.researchModules,[]);
assert.ok(!(await readdir('dist')).some(n=>['api','apps-script','src','config'].includes(n)));
const assetPaths=[];
async function scan(dir){for(const name of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+name.name;if(name.isDirectory())await scan(p);else assetPaths.push(p);}}
await scan('dist');assert.ok(!assetPaths.some(p=>p.endsWith('.map')),'no source maps in public artifact');
// Preview must use the same base as GITHUB_PAGES=true at build time.
// 4173 is Vite's standard preview port; never use Fetch-blocked protocol ports.
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'inherit',env:{...process.env,GITHUB_PAGES:'true'}});
let browser;
const diagnostics=[];
function instrument(page,label){
 const record={label,url:'',errors:[],failed:[]};diagnostics.push(record);
 page.on('pageerror',e=>record.errors.push(e.message));
 page.on('requestfailed',r=>record.failed.push({url:r.url(),error:r.failure()?.errorText}));
 page.on('framenavigated',f=>{if(f===page.mainFrame())record.url=f.url();});
}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
 const configResponse=await fetch(base+'study.json');
 assert.ok(configResponse.ok);assert.match(configResponse.headers.get('content-type')||'',/json/,'preview must serve the production base path');
 assert.equal((await configResponse.json()).id,JSON.parse(await readFile('dist/study.json','utf8')).id);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
 const attempts=['','?mode=research','?mode=research&admin=true','?mode=%72esearch','#research'];
 for(const path of attempts){
   const p=await browser.newPage();instrument(p,'boundary '+path);
   await p.addInitScript(()=>{localStorage.setItem('admin','true');localStorage.setItem('mode','research');});
   // No production or pilot writes are allowed from this test.
   await routeCollector(p,releaseMock(),[]);
   await p.goto(base+path,{waitUntil:'networkidle'});await p.locator('#g-welcome').waitFor({state:'visible'});
   assert.equal(await p.locator('#g-research').count(),0);assert.equal(await p.locator('#generate').count(),0);
   assert.equal(await p.locator('#studio-mode').count(),0);assert.equal(await p.evaluate(()=>typeof window.__rubiGuidedTest),'undefined');
   if(path==='?mode=research')await p.screenshot({path:'artifacts/public-research-blocked.png',fullPage:true});
   await p.close();
 }
 const closed=await browser.newPage();instrument(closed,'main closed');const closedServer=releaseMock({properties:{}});
 // Use the actual built study.json; mock only the Google transport/service.
 async function routeCollector(page,m,writes){
   await page.route('https://script.google.com/macros/s/**/exec',async route=>{
     const request=JSON.parse(new URLSearchParams(route.request().postData()||'').get('payload')||'{}');
     if(request.kind!=='ping')writes.push(request);
     let reply;
     try{reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:true,...m.call(request.kind,request.payload)};}
     catch(e){reply={source:'rubi-hpp-apps-script',requestId:request.requestId,ok:false,message:String(e)};}
     await route.fulfill({contentType:'text/html',body:`<script>top.postMessage(${JSON.stringify(reply)},'${origin}');</script>`});
   });
 }
 const closedWrites=[];await routeCollector(closed,closedServer,closedWrites);
 await closed.goto(base,{waitUntil:'networkidle'});await closed.getByText('지금은 설문을 받지 않고 있습니다.',{exact:false}).waitFor();
 assert.equal(await closed.locator('#g-consent').count(),0);assert.equal(closedWrites.length,0);assert.equal(closedServer.writes,0);
 await closed.screenshot({path:'artifacts/main-collection-closed.png',fullPage:true});await closed.close();
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 instrument(page,'main open actual policy');
 const m=releaseMock();await routeCollector(page,m,writes);
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#g-welcome').waitFor({state:'visible'});
 assert.equal(await page.locator('#g-research').count(),0);assert.equal(await page.locator('#g-pilot-note').isVisible(),false);
 assert.equal(await page.locator('#g-ui-check-note').isVisible(),true);
 const uiId=(await page.locator('#g-ui-check-id').textContent()).replace('점검 ID: ','');
 assert.match(uiId,/^ui-check-[0-9a-f-]{36}$/);
 await page.screenshot({path:'artifacts/owner-ui-check-welcome.png',fullPage:true});
 await page.locator('#g-consent').check();await page.locator('#g-start').click();
 await page.locator('#g-robotics').selectOption('no');await page.locator('#g-knew').selectOption('no');await page.locator('#g-exposure').selectOption('none');await page.locator('#g-profile-next').click();
 await page.waitForFunction(()=>document.querySelector('#g-intro-video').readyState>=2,null,{timeout:45000});
 await page.locator('#g-intro-video').evaluate(async v=>{v.muted=true;await v.play();});
 await page.waitForFunction(()=>document.querySelector('#g-intro-video').currentTime>.3);
 await page.locator('#g-intro-video').evaluate(v=>v.pause());await page.locator('#g-intro-ack').check();await page.locator('#g-begin').click();
 await page.locator('#g-observe').waitFor({state:'visible',timeout:120000});
 // Observe A then B using actual production JS/physics, no DEV hooks.
 for(const letter of ['A','B']){
   for(let attempt=0;attempt<3;attempt++){
     await page.locator('#g-watch').click();
     await page.waitForFunction(()=>{
       const e=document.querySelector('#g-enough'),w=document.querySelector('#g-watch'),s=document.querySelector('#g-stop');
       return (e&&!e.hidden&&!e.disabled)||(w&&!w.hidden&&!w.disabled&&s?.hidden);
     },null,{timeout:120000});
     if(await page.locator('#g-enough').isVisible()&&await page.locator('#g-enough').isEnabled())await page.locator('#g-enough').click();
     await page.waitForFunction(()=>document.querySelector('#g-stop').hidden,null,{timeout:120000});
     if(await page.locator('#g-choice').isVisible())break;
     if(letter==='A'&&(await page.locator('#g-watch').textContent()).includes('B'))break;
   }
 }
 await page.locator('#g-choice').waitFor({state:'visible',timeout:30000});
 await page.screenshot({path:'artifacts/main-choice-release.png',fullPage:true});
 await page.locator('#g-choose-a').click();
 await page.waitForFunction(()=>document.querySelector('#g-counter')?.textContent?.startsWith('2 /'),null,{timeout:30000});
 assert.equal(writes.filter(r=>r.kind==='trial').length,1);assert.equal(m.rows('Trials').length,1);assert.equal(m.rows('Runs').length,2);
 assert.equal(m.rows('Sessions')[0].profileCompleted,true);assert.equal(m.rows('Sessions')[0].status,'started');assert.equal(m.rows('Trials')[0].saveState,'complete');
 for(const tab of ['Trials','Runs','Sessions'])assert.ok(m.rows(tab).every(r=>r.sessionId===uiId));
 // Reload of a closed intake never sends more answers, even from a started test session.
 m.properties.set('RUBI_MAIN_COLLECTION_OPEN','false');
 await page.reload({waitUntil:'networkidle'});await page.getByText('지금은 설문을 받지 않고 있습니다.',{exact:false}).waitFor();
 assert.equal(await page.locator('#g-consent').count(),0);assert.equal(m.rows('Trials').length,1);
 m.properties.set('RUBI_MAIN_COLLECTION_OPEN','true');
 await page.reload({waitUntil:'networkidle'});await page.locator('#g-welcome').waitFor({state:'visible'});
 assert.equal((await page.locator('#g-ui-check-id').textContent()).replace('점검 ID: ',''),uiId);
 assert.match(await page.locator('#g-resume').textContent(),/1개 문항/);
 assert.equal(writes.filter(r=>r.kind==='trial').length,1);
 assert.deepEqual(errors,[]);
 await page.close();
 await writeFile('artifacts/public-release-checks.json',JSON.stringify({status:'PASS',pathsChecked:attempts,buildBoundary:boundary,
   assetCount:assetPaths.length,sourceMaps:0,collector:'generated release collector with in-memory Google services; NO real Sheets writes',closedGate:true,productionRealPolicyTrial:true,actualBuiltStudyConfig:true,uiCheckSessionTagged:true,closedOnResume:true,resumePreserved:true,trialRows:1,runRows:2,sessionRows:1},null,2));
 console.log('PUBLIC_RELEASE_CHECKS_PASS');
}catch(error){
 const livePages=browser?.contexts().flatMap(c=>c.pages())||[];
 for(let i=0;i<livePages.length;i++){
   const p=livePages[i];await p.screenshot({path:`artifacts/public-failure-${i}.png`,fullPage:true}).catch(()=>{});
   diagnostics.push({label:'failure state',url:p.url(),body:await p.locator('body').innerText().catch(()=>''),html:await p.locator('#app').innerHTML().catch(()=>'')});
 }
 await writeFile('artifacts/public-release-failure.json',JSON.stringify({error:String(error),diagnostics},null,2));
 console.error('PUBLIC_RELEASE_FAILURE',JSON.stringify({error:String(error),diagnostics}));throw error;
}finally{await browser?.close();server.kill('SIGTERM');}
