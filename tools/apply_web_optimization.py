#!/usr/bin/env python3
"""One-time guarded source migration. Refuses unexpected source instead of guessing."""
from pathlib import Path
import json

def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    if new in s:
        return
    if s.count(old) != 1:
        raise RuntimeError(f'{path}: expected exactly one migration anchor: {old[:100]}')
    p.write_text(s.replace(old, new, 1))

main = 'src/main.ts'
replace(main, "import { fetchHostedFiles } from './runtime/hosted-bundle.ts';", "import { fetchHostedBundle } from './runtime/bundle-loader.ts';\nimport { RolloutCache, rolloutKey } from './core/rollout-cache.ts';")
replace(main, "let scenario=makeScenario(),bundle:Bundle|undefined,networks:OnnxNetworks|undefined,engine:Physics|undefined;", "const rolloutCache = new RolloutCache();\nconst performanceMetrics: Record<string, unknown> = {pipeline: 'web-v1'};\nfunction showPerformance() { el('performance-metrics').textContent = JSON.stringify(performanceMetrics, null, 2); }\nlet scenario=makeScenario(),bundle:Bundle|undefined,networks:OnnxNetworks|undefined,engine:Physics|undefined;")
replace(main, '<button class="secondary research-only" id="export-runs" disabled>실행 기록 내려받기</button>', '<button class="secondary research-only" id="export-runs" disabled>실행 기록 내려받기</button><details class="research-only"><summary>성능 측정 · web-v1</summary><pre id="performance-metrics" style="white-space:pre-wrap;font-size:11px"></pre><p class="hint">자산 바이트는 압축 전 크기입니다. 계산시간과 보행시간은 다릅니다.</p></details>')
# Both dimensions matter for reuse; the current UI keeps these fixed but future studies may not.
replace(main, "if(engine && Math.abs(engine.scenario.height-scenario.height)<1e-10)", "if(engine && Math.abs(engine.scenario.height-scenario.height)<1e-10 && engine.scenario.width===scenario.width && engine.scenario.depth===scenario.depth)")
replace(main, "async function importFiles(files:File[]) {", "async function importFiles(files:File[], preparedBundle?:Bundle) {")
replace(main, "    const candidate=await loadFiles(files);nextNetworks=await OnnxNetworks.create(candidate.files);nextEngine=await Physics.create(candidate,scenario);", """    const candidate=preparedBundle ?? await loadFiles(files);
    // Do not overlap two MuJoCo models or two policy sessions during re-import.
    viewer.engine=undefined; viewer.clear(viewer.robot); viewer.robotMeshes=[]; viewer.robot.visible=false;
    engine?.dispose(); engine=undefined; await networks?.dispose(); networks=undefined; bundle=undefined;
    rolloutCache.clear();
    let stage=performance.now(); nextNetworks=await OnnxNetworks.create(candidate.files);
    performanceMetrics.onnxCreateMs=performance.now()-stage;
    stage=performance.now(); nextEngine=await Physics.create(candidate,scenario);
    performanceMetrics.physicsCreateMs=performance.now()-stage;
    performanceMetrics.physicsStages=nextEngine.loadMetrics;
    stage=performance.now();""")
replace(main, "    resetTrial();el('file-status').textContent=", "    performanceMetrics.viewerAttachMs=performance.now()-stage; showPerformance();\n    resetTrial();el('file-status').textContent=")
replace(main, "    await rebuild();viewer.robot.visible=false;", "    const rebuildStart=performance.now(); await rebuild(); performanceMetrics.rebuildMs=performance.now()-rebuildStart; viewer.robot.visible=false;")
replace(main, """      const computeStarted=performance.now();
      const run=await engine!.rollout(key,networks,abort.signal,(time)=>{el('progress-label').textContent=`경로 ${label} · 시뮬레이션 ${time.toFixed(1)}초 계산 중`;});
      rollouts[key]={...run,computeMs:performance.now()-computeStarted};refresh();""", """      const cacheKey=rolloutKey(bundle.hashes,PROFILE,scenario,key), cached=rolloutCache.get(cacheKey);
      if(cached) {
        rollouts[key]={...cached,id:crypto.randomUUID(),scenarioId:scenario.id,cacheHit:true,sourceRolloutId:cached.id,sourceComputeMs:cached.computeMs,computeMs:0};
        el('progress-label').textContent=`경로 ${label} · 동일 조건의 검증된 실행 기록 재사용`;
      } else {
        const computeStarted=performance.now();
        const run=await engine!.rollout(key,networks,abort.signal,(time)=>{el('progress-label').textContent=`경로 ${label} · 시뮬레이션 ${time.toFixed(1)}초 계산 중`;});
        rollouts[key]={...run,computeMs:performance.now()-computeStarted,cacheHit:false};
        rolloutCache.set(cacheKey,rollouts[key]!);
      }
      performanceMetrics[key]={computeMs:rollouts[key]!.computeMs,simulationSeconds:rollouts[key]!.duration,cacheHit:rollouts[key]!.cacheHit,completed:rollouts[key]!.completed,reason:rollouts[key]!.reason};
      performanceMetrics.cacheEntries=rolloutCache.size;showPerformance();refresh();""")
replace(main, "schemaVersion:1,scenario,profile:PROFILE,hashes:bundle?.hashes,rollouts", "schemaVersion:1,scenario,profile:PROFILE,hashes:bundle?.hashes,rollouts,performance:performanceMetrics")
replace(main, "      const files=await fetchHostedFiles(base);\n      await importFiles(files);", "      const loaded=await fetchHostedBundle(base,status);\n      performanceMetrics.assets=loaded.metrics;\n      await importFiles([],loaded.bundle);")

physics = 'src/runtime/physics.ts'
replace(physics, 'export type Rollout={computeMs?:number;', 'export type Rollout={cacheHit?:boolean;sourceRolloutId?:string;sourceComputeMs?:number;computeMs?:number;')
replace(physics, '  removedWorlds:string[]=[];', '  removedWorlds:string[]=[];\n  loadMetrics:Record<string,number>={};\n  private disposed=false;')
replace(physics, '    const mj=await loadEngine(),vfs=new mj.MjVFS(); let model:any,data:any;', '    const started=performance.now(),mj=await loadEngine(),engineMs=performance.now()-started,vfs=new mj.MjVFS(); let model:any,data:any;\n    const prepareStart=performance.now();')
replace(physics, "      model=mj.MjModel.from_xml_path('rubi.xml',vfs); data=new mj.MjData(model);", "      const prepareMs=performance.now()-prepareStart,compileStart=performance.now();\n      model=mj.MjModel.from_xml_path('rubi.xml',vfs); data=new mj.MjData(model);\n      const compileMs=performance.now()-compileStart;")
replace(physics, '      engine.validate(); engine.reset(); return engine;', "      engine.validate(); engine.reset(); engine.loadMetrics={engineMs,prepareMs,compileMs,totalMs:performance.now()-started,splitCount:prepared.split.length}; return engine;")
replace(physics, '  dispose() {this.data.delete();this.model.delete();this.vfs.delete();}', '  dispose() {if(this.disposed)return;this.disposed=true;this.data.delete();this.model.delete();this.vfs.delete();}')
# Preserve the control loop's await, dt, decimation, gains, and all policy math.

viewer = 'src/runtime/viewer.ts'
replace(viewer, "import * as T from 'three';", "import * as T from 'three';\nimport { meshGeometry } from './mesh-geometry.ts';")
replace(viewer, 'this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));', 'this.renderer.setPixelRatio(1);')
replace(viewer, 'this.renderer.shadowMap.enabled=true;', 'this.renderer.shadowMap.enabled=false;')
replace(viewer, '    const m=engine.model;', '    const m=engine.model,meshCache=new Map<number,T.BufferGeometry>();')
replace(viewer, """        const meshId=m.geom_dataid[id],va=m.mesh_vertadr[meshId],vn=m.mesh_vertnum[meshId],fa=m.mesh_faceadr[meshId],fn=m.mesh_facenum[meshId];
        geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(m.mesh_vert.slice(3*va,3*(va+vn))),3));
        geometry.setIndex(new T.BufferAttribute(new Uint32Array(m.mesh_face.slice(3*fa,3*(fa+fn))),1));geometry.computeVertexNormals();""", """        const meshId=m.geom_dataid[id];
        geometry=meshCache.get(meshId) ?? meshGeometry(m,meshId);meshCache.set(meshId,geometry);""")
# Release GridHelper (LineSegments) too, not just Mesh/Line objects. Existing code
# handles Line subclasses, so retain it and avoid changing the rendering geometry.

p=Path('public/study.json'); study=json.loads(p.read_text());study['bundleBaseUrl']='./models/rubi-web/';p.write_text(json.dumps(study,ensure_ascii=False,indent=2)+'\n')
# Geometry derivatives live in a second bundle. Do not ship unused originals in Pages artifacts.
p=Path('package.json'); package=json.loads(p.read_text()); package['scripts']['build']='tsc --noEmit && vite build && node tools/prune-web-dist.mjs';p.write_text(json.dumps(package,indent=2)+'\n')
Path('tools/prune-web-dist.mjs').write_text("import { readFile, rm } from 'node:fs/promises';\nconst study=JSON.parse(await readFile('dist/study.json','utf8'));\nif(study.bundleBaseUrl==='./models/rubi-web/') { await readFile('dist/models/rubi-web/bundle.json'); await rm('dist/models/rubi',{recursive:true,force:true}); }\n")
Path('docs/WEB_OPTIMIZATION.md').write_text('''# Browser performance — web-v1

## Preserved scientific conditions
The original bundle in `public/models/rubi/` is unchanged. A separate `rubi-web/` bundle uses QEM derivatives for seven visual-only meshes; the XML, both policy files, and both contact foot meshes are byte-identical. Source hashes and bounds are in `web-assets-report.json`. AABB error is not a surface-error guarantee: visually review the derivatives before recruiting participants. Physics timestep, policy cadence, awaited inference, gains, reset, collision, and survey viewing rules are unchanged.

## Pipeline
Hosted assets go directly to a verified byte map. SHA-256 is checked once per successful load. Versioned URLs use HTTP force-cache; corrupt/stale bytes trigger one reload and still must pass the hash. `no-cache` on the small manifest means revalidation, not “never store”. No File-object roundtrip is used for hosted loading. Local file selection remains available.

Visual mesh normals reuse MuJoCo data using the actual face-to-normal indices; matching array lengths alone is not sufficient. The renderer defaults to DPR=1 with shadows off, inspired by the PongBot R2 demo. No PongBot controller/gains are transplanted into RUBI.

Successful rollouts have a bounded same-tab LRU cache. The key includes all model fingerprints, controller profile, physical terrain dimensions, speed, route vertices, route type and a contract version. Direct routes can be reused across detour-distance questions only when their actual simulation inputs are identical. Cache hits retain the source rollout ID and original compute time. Viewing coverage/consent and both-route success are still required. Nothing is reused across participants/devices.

## Reproduction
The reduced bundle is committed, so ordinary npm users do not need Python packages. To regenerate: `python -m pip install numpy==2.2.6 fast-simplification==0.1.13`, then `python tools/optimize_web_assets.py --apply`. This writes a derivative only. Run `npm test`, `npm run build`, and `node tools/performance-check.mjs` (Playwright Chromium required).

Benchmark stage timings are from the stated GitHub runner/browser and localhost asset serving. They are not predictions of the participant’s network speed. See performance JSON/logs for model compilation, real rollouts, and cached repeat timings separately.

## Reference
Implementation reference (not a drop-in controller): https://github.com/TAEM1N2/mujoco_wasm_Pongbot_R2 at e4c6ecf7e072f652960aa2723694cb7007068123, `src/main.js` and `src/mujocoUtils.js`. Our implementation is independent and preserves RUBI’s existing policy contract.
''')
print('SOURCE_MIGRATION_COMPLETE', flush=True)
