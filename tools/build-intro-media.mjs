import { chromium } from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Deterministic frame capture, NOT a real-time screen recording. A slow CI GPU
// cannot change the time scale: frame n always represents n/30 simulation seconds.
// All episodes are the first rollout of the same survey policy, without retries,
// manual animation, changing gains/command scaling, or trimming failed attempts.
const FPS=30, WIDTH=960, HEIGHT=540;
const out='public/media/rubi-intro-v1',work='artifacts/intro-build';
await mkdir(out,{recursive:true});await mkdir(work,{recursive:true});
const server=spawn('npm',['run','dev','--','--port','4188','--strictPort'],{stdio:'inherit'});
let browser,encoder,encoderDone;let encoderError='';
const episodes=[
  {id:'flat',title:'평평한 곳에서 걷기',height:0,detour:.8,route:'direct'},
  {id:'step-05',title:'5 cm 턱을 올라갔다 내려오기',height:.05,detour:.8,route:'direct'},
  {id:'step-07',title:'7 cm 턱을 올라갔다 내려오기',height:.07,detour:.8,route:'direct'},
  {id:'step-09',title:'9 cm 턱을 올라갔다 내려오기',height:.09,detour:.8,route:'direct'},
  {id:'step-11',title:'11 cm 턱을 올라갔다 내려오기',height:.11,detour:.8,route:'direct'},
  {id:'bypass',title:'턱을 피해 평평한 곳으로 돌아가기',height:.07,detour:1.2,route:'detour'}
];
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4188/')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'intro Vite server did not start');
  execFileSync('ffmpeg',['-version'],{stdio:'ignore'});
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  const page=await browser.newPage({viewport:{width:WIDTH,height:HEIGHT}});
  await page.exposeFunction('writeIntroFrame',async image=>{
    if(!encoder||encoder.stdin.destroyed)throw new Error('Intro encoder unavailable: '+encoderError);
    const bytes=Buffer.from(image.substring(image.indexOf(',')+1),'base64');
    if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');
  });
  await page.goto('http://127.0.0.1:4188/',{waitUntil:'networkidle'});
  await page.evaluate(async({WIDTH,HEIGHT})=>{
    // Replace only this private capture page. No profile, trial or collector call.
    document.body.innerHTML='<div id="capture"><canvas id="film"></canvas></div>';
    Object.assign(document.body.style,{margin:'0'});Object.assign(document.querySelector('#capture').style,{width:WIDTH+'px',height:HEIGHT+'px'});
    const {fetchHostedBundle}=await import('/src/runtime/bundle-loader.ts');
    const {OnnxNetworks}=await import('/src/runtime/onnx.ts');
    const {Physics}=await import('/src/runtime/physics.ts');
    const {Viewer,CAMERA_PROTOCOL}=await import('/src/runtime/viewer.ts');
    const {makeScenario}=await import('/src/core/scenario.ts');
    const {PROFILE}=await import('/src/core/terrain-controller.ts');
    const loaded=await fetchHostedBundle(new URL('/models/rubi-web/',location.href),()=>{});
    const networks=await OnnxNetworks.create(loaded.bundle.files);
    const engine=await Physics.create(loaded.bundle,makeScenario(0,.8,.5));
    const viewer=new Viewer(document.querySelector('#film'));cancelAnimationFrame(viewer.animation);
    viewer.attach(engine);viewer.setParticipantView(true);viewer.resize();
    window.__introCapture={networks,engine,viewer,makeScenario,hashes:loaded.bundle.hashes,profile:PROFILE,camera:CAMERA_PROTOCOL};
  },{WIDTH,HEIGHT});
  const results=[];let start=0;
  for(const ep of episodes){
    const clip=`${work}/${ep.id}.mp4`;encoderError='';
    encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(FPS),'-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',clip],{stdio:['pipe','ignore','pipe']});
    encoder.stderr.on('data',b=>{encoderError+=b;});
    encoderDone=once(encoder,'close');
    const result=await page.evaluate(async({ep,FPS})=>{
      const c=window.__introCapture,s=c.makeScenario(ep.height,ep.detour,.5);
      c.engine.setScenario(s);c.viewer.aKey=ep.route;c.viewer.setScenario(s,ep.route);
      const run=await c.engine.rollout(ep.route,c.networks,new AbortController().signal,()=>{});
      if(!run.completed)throw new Error('Introduction episode failed: '+ep.id+' '+run.reason);
      c.viewer.resetFollow([0,0,0]);c.viewer.robot.visible=true;
      const frameCount=Math.ceil(run.duration*FPS)+1;let sourceIndex=0;
      for(let i=0;i<frameCount;i++){
        const t=Math.min(i/FPS,run.duration);
        while(sourceIndex+1<run.frames.length&&run.frames[sourceIndex+1].time<=t)sourceIndex++;
        c.engine.applyFrame(run.frames[sourceIndex]);c.viewer.updateRobot();
        c.viewer.followCamera(i*1000/FPS);c.viewer.controls.update();c.viewer.renderer.render(c.viewer.scene,c.viewer.camera);
        await window.writeIntroFrame(c.viewer.canvas.toDataURL('image/jpeg',.90));
      }
      const {frames,...metadata}=run;
      return {run:metadata,frameCount,scenarioId:s.id,geometry:s.geometry};
    },{ep,FPS});
    encoder.stdin.end();const [exit]=await encoderDone;encoder=undefined;
    assert.equal(exit,0,encoderError);assert.equal(result.run.completed,true);
    const mediaDuration=result.frameCount/FPS;
    results.push({...ep,startSeconds:start,mediaDurationSeconds:mediaDuration,...result});start+=mediaDuration;
    console.log('INTRO_EPISODE_PASS',JSON.stringify({id:ep.id,simulationSeconds:result.run.duration,frames:result.frameCount,completed:true}));
  }
  const paths=episodes.map(ep=>`file '${ep.id}.mp4'`).join('\n');await writeFile(`${work}/concat.txt`,paths+'\n');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',`${work}/concat.txt`,'-c','copy','-movflags','+faststart',`${out}/rubi-intro.mp4`]);
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','2','-i',`${out}/rubi-intro.mp4`,'-frames:v','1',`${out}/poster.jpg`]);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',`${out}/rubi-intro.mp4`],{encoding:'utf8'}));
  const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,WIDTH);assert.equal(video.height,HEIGHT);assert.ok(Math.abs(Number(probe.format.duration)-start)<.15);
  const context=await page.evaluate(()=>({assetHashes:window.__introCapture.hashes,profile:window.__introCapture.profile,cameraProtocol:window.__introCapture.camera}));
  const sources={};for(const path of ['package-lock.json','tools/build-intro-media.mjs','src/runtime/physics.ts','src/runtime/viewer.ts','src/core/model.ts','src/core/scenario.ts','src/core/terrain-controller.ts','src/runtime/onnx.ts'])sources[path]=sha(await readFile(path));
  const film=await readFile(`${out}/rubi-intro.mp4`);
  const manifest={version:'same-policy-intro-v1',source:'actual survey MuJoCo WASM and ONNX rollout',simulationOnly:true,nominalNavigationCommand:.5,physicsDt:.002,policyDt:.01,fps:FPS,width:WIDTH,height:HEIGHT,durationSeconds:Number(probe.format.duration),video:'rubi-intro.mp4',poster:'poster.jpg',videoSha256:sha(film),videoBytes:film.length,...context,sourceHashes:sources,episodes:results};
  manifest.contentId=sha(Buffer.from(JSON.stringify({assetHashes:context.assetHashes,sources,episodes,FPS,WIDTH,HEIGHT})));
  await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
  await writeFile(`${work}/report.json`,JSON.stringify(manifest,null,2)+'\n');
  await copyFile(`${out}/rubi-intro.mp4`,'artifacts/rubi-intro.mp4');await copyFile(`${out}/poster.jpg`,'artifacts/rubi-intro-poster.jpg');
  await page.evaluate(async()=>{const c=window.__introCapture;c.viewer.dispose();c.engine.dispose();await c.networks.dispose();});
  console.log('INTRO_MEDIA_PASS',JSON.stringify({duration:manifest.durationSeconds,bytes:film.length,contentId:manifest.contentId,episodes:results.length}));
}catch(e){encoder?.kill();await rm(`${out}/manifest.json`,{force:true});throw e;}
finally{await browser?.close();server.kill('SIGTERM');}
