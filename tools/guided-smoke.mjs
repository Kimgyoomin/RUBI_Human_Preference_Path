import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export {guidedChecks} from './block-ux-checks.mjs';

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
    const candidates=await p.evaluate(async()=>{
      const {fetchHostedBundle}=await import('/src/runtime/bundle-loader.ts');const {OnnxNetworks}=await import('/src/runtime/onnx.ts');const {Physics}=await import('/src/runtime/physics.ts');const {makeScenario}=await import('/src/core/scenario.ts');
      const {bundle}=await fetchHostedBundle(new URL('/models/rubi-web/',location.href),()=>{}),networks=await OnnxNetworks.create(bundle.files),engine=await Physics.create(bundle,makeScenario(.05,.4,.5)),report=[];
      try{for(const h of [.05,.07,.09,.11])for(const d of [.4,.6,.8,1,1.2,1.4,1.6]){
        engine.setScenario(makeScenario(h,d,.5));const r=await engine.rollout('detour',networks,new AbortController().signal,()=>{});report.push({h,d,completed:r.completed,reason:r.reason,duration:r.duration});
      }}finally{engine.dispose();await networks.dispose();}return report;
    });
    for(const r of candidates)assert.ok(r.completed,`candidate detour failed: ${JSON.stringify(r)}`);
    await writeFile('artifacts/block-candidates.json',JSON.stringify(candidates,null,2));
    console.log('RESIDENT_HEIGHTS_PASS',JSON.stringify(result));console.log('BLOCK_CANDIDATES_PASS',JSON.stringify(candidates));return {...result,candidates};
  }finally{await p.close();}
}
