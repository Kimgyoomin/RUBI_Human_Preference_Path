import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root=path.resolve('dist'),base='/RUBI_Human_Preference_Path/';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
fs.mkdirSync('artifacts',{recursive:true});
const server=http.createServer((req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(!url.pathname.startsWith(base)){res.writeHead(404).end();return;}
    const file=path.resolve(root,decodeURIComponent(url.pathname.slice(base.length))||'index.html');
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  }catch{res.writeHead(400).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;const results=[];
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(origin+base,{waitUntil:'networkidle',timeout:60000});
    await page.locator('#world').waitFor({state:'visible'});
    assert.match(await page.locator('h1').innerText(),/같은 목적지/);
    assert.equal(await page.locator('#choose-a').isDisabled(),true);assert.equal(await page.locator('#choose-b').isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'horizontal overflow');
    await page.locator('[data-camera="top"]').click();
    await page.screenshot({path:`artifacts/${label}.png`,fullPage:true});
    assert.deepEqual(errors,[],'Unhandled browser errors');
    results.push({label,status:'PASS',viewport,unhandledErrors:errors,diagnostic:await page.locator('#error').innerText()});await page.close();
  }
  for(const file of ['vendor/mujoco/mujoco.wasm','vendor/ort/ort-wasm-simd-threaded.wasm']){
    const response=await fetch(origin+base+file);assert.equal(response.status,200,file);
    const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual(Array.from(bytes.slice(0,4)),[0,97,115,109],file+' WASM header');results.push({asset:file,status:'PASS',bytes:bytes.length});
  }
  console.log(JSON.stringify({status:'PASS',checks:results,realRubiLocomotionTested:false},null,2));fs.writeFileSync('artifacts/browser-smoke.json',JSON.stringify(results,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
