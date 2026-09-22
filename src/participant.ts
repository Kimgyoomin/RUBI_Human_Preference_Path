import './guided.css';
import { fetchHostedBundle } from './runtime/bundle-loader.ts';
import type { Bundle } from './core/model.ts';
import { makeScenario } from './core/scenario.ts';
import type { RouteKey, Scenario } from './core/scenario.ts';
import { Physics } from './runtime/physics.ts';
import type { Rollout } from './runtime/physics.ts';
import { OnnxNetworks } from './runtime/onnx.ts';
import { Viewer, CAMERA_PROTOCOL } from './runtime/viewer.ts';
import { LiveClock } from './runtime/live-clock.ts';
import { AppsScriptTransport } from './runtime/apps-script.ts';
import { GUIDED_PROTOCOL, LABEL_CONDITION, validProfile, pilotOrder, canChoose, choiceDescription } from './core/guided-study.ts';
import type { ProfileAnswers, PilotScene } from './core/guided-study.ts';

type Study={id:string;status:'draft'|'released';responseApi:string;bundleBaseUrl:string;scenarios:PilotScene[];guidedScenarios?:PilotScene[]};
type Phase='welcome'|'profile'|'intro'|'loading'|'observe'|'choice'|'saving'|'complete';
type Session={id:string;participantId:string;startedAt:string;order:number[];presentations:RouteKey[];index:number;profile?:ProfileAnswers;consent:boolean;tutorialCompleted:boolean;complete:boolean;pending?:Record<string,unknown>;responses:Record<string,unknown>[]};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const btn=(id:string)=>$<HTMLButtonElement>(id);
const app=$('app');
app.innerHTML=`
<header class="g-header"><div class="g-brand"><span class="g-brand-icon">R</span><div>RUBI<small>HUMAN PREFERENCE PATH</small></div></div><a id="g-research" href="?mode=research">연구자 화면</a></header>
<main class="g-main">
<div id="g-error" class="g-error" role="alert" hidden></div>
<div id="g-pilot-note" class="g-pilot-note" hidden>개발 파일럿 · 현재 응답은 본 조사와 구분하여 보관합니다.</div>
<nav class="g-steps" aria-label="참여 순서"><span>동의</span><span>사전 경험</span><span>이용 안내</span><span>경로 비교</span><span>완료</span></nav>
<section id="g-welcome" class="g-panel">
<p class="g-eyebrow">경로 선택 연구</p><h1 tabindex="-1">어느 경로를 맡기시겠습니까?</h1>
<p>두 이동 경로를 관찰하고 로봇에게 맡길 경로를 선택하는 설문입니다. 시작 전에 사전 경험을 간단히 묻습니다.</p>
<p>이름이나 이메일은 요청하지 않습니다. 선택, 관찰·응답 시간, 시뮬레이션 실행 정보와 사전 경험 응답을 임의의 세션 ID로 연결해 저장합니다.</p>
<label class="g-consent"><input id="g-consent" type="checkbox"> 연구 안내를 읽었으며 응답 저장에 동의합니다.</label>
<button id="g-start" class="g-primary" disabled>다음</button><p id="g-resume" class="g-muted"></p>
</section>
<section id="g-profile" class="g-panel" hidden><p class="g-eyebrow">시작 전 질문</p><h1 tabindex="-1">참가 전 경험을 알려주세요.</h1>
<p>아직 이번 시뮬레이션을 보기 전의 경험을 기준으로 답해 주세요. 세 질문은 서로 독립적입니다.</p>
<form id="g-profile-form" class="g-profile-grid">
<label>로봇 관련 업무·연구·전공 수업 또는 개발 프로젝트 경험이 있나요?
<select id="g-robotics" required><option value="">선택하세요</option><option value="yes">예</option><option value="no">아니요</option><option value="prefer_not_to_say">응답하지 않음</option></select></label>
<label>이번 설문에 참여하기 전에 RUBI라는 로봇을 알고 있었나요?
<select id="g-knew" required><option value="">선택하세요</option><option value="yes">예</option><option value="no">아니요</option><option value="unsure">확실하지 않음</option><option value="prefer_not_to_say">응답하지 않음</option></select></label>
<label>이번 설문 전에 RUBI가 움직이는 모습을 본 적이 있나요?
<select id="g-exposure" required><option value="">선택하세요</option><option value="none">본 적 없음</option><option value="video_only">영상으로만 봄</option><option value="in_person">현장에서 직접 봄</option><option value="both">영상과 현장 모두</option><option value="unsure">확실하지 않음</option><option value="prefer_not_to_say">응답하지 않음</option></select></label>
<button id="g-profile-next" class="g-primary" type="submit">안내 보기</button></form>
</section>
<section id="g-intro" class="g-panel" hidden><p class="g-eyebrow">이용 안내</p><h1 tabindex="-1">보고, 비교하고, 선택하세요.</h1>
<p>RUBI는 두 다리로 이동하는 로봇입니다. 학습된 보행 제어기가 물리 시뮬레이션에서 경로를 따라갑니다. 자신의 보행이 아니라 <strong>RUBI에게 맡길 경로</strong>를 선택해 주세요.</p>
<div class="g-tutorial"><div><b>1</b><strong>경로 A 보기</strong><p>버튼을 누르면 출발점에서 보행을 시작합니다.</p></div><div><b>2</b><strong>경로 B 보기</strong><p>같은 출발 상태로 돌아가 다른 경로를 보여줍니다.</p></div><div><b>3</b><strong>선호 선택</strong><p>두 경로를 본 뒤 높이와 추가거리를 확인합니다.</p></div></div>
<div class="g-legend"><span><i class="g-start-dot"></i>초록 채운 원: 출발점</span><span><i class="g-goal-ring"></i>빨강 표적: 목적점</span></div>
<p>선호 차이가 거의 없으면 <strong>두 경로가 비슷함</strong>을 선택하세요. 이해하지 못했다는 뜻으로 선택하지 말고, 필요한 경로를 다시 보거나 참여를 중단할 수 있습니다.</p>
<button id="g-begin" class="g-primary">경로 비교 시작</button>
</section>
<section id="g-loading" class="g-panel g-centred" hidden><div class="g-spinner" aria-hidden="true"></div><h1 tabindex="-1">실행 환경을 준비하고 있습니다.</h1><p id="g-load-status" role="status" aria-live="polite">모델과 보행 제어기를 한 번 불러옵니다.</p><button id="g-load-retry" class="g-primary" hidden>다시 연결</button></section>
<section id="g-observe" hidden><div class="g-trial-heading"><div><p id="g-counter" class="g-eyebrow"></p><h1 id="g-observe-title" tabindex="-1">경로 A를 확인하세요.</h1></div><span id="g-watch-status" role="status" aria-live="polite"></span></div>
<div class="g-viewport"><canvas id="g-world" aria-label="로봇의 경로 보행 화면"></canvas></div>
<div class="g-actionbar"><p id="g-action-hint">버튼을 누르면 같은 출발 상태에서 보행합니다.</p><button id="g-watch" class="g-primary">경로 A 보기</button><button id="g-stop" class="g-secondary" hidden>중지</button></div>
</section>
<section id="g-choice" class="g-panel" hidden><p id="g-choice-counter" class="g-eyebrow"></p><h1 tabindex="-1">RUBI에게 어느 경로를 맡기겠습니까?</h1><p>방금 본 보행과 아래 경로 정보를 함께 고려해 주세요.</p>
<div class="g-compare"><article class="g-route-a"><h2>경로 A</h2><p id="g-desc-a"></p><button id="g-replay-a" class="g-secondary">A 다시 보기</button></article><article class="g-route-b"><h2>경로 B</h2><p id="g-desc-b"></p><button id="g-replay-b" class="g-secondary">B 다시 보기</button></article></div>
<div class="g-choices"><button id="g-choose-a">경로 A 선택</button><button id="g-tie">두 경로가 비슷함</button><button id="g-choose-b">경로 B 선택</button></div><p class="g-muted">비슷함: 어느 경로를 맡겨도 선호 차이가 거의 없습니다.</p></section>
<section id="g-saving" class="g-panel g-centred" hidden><h1 tabindex="-1">응답을 저장하고 있습니다.</h1><p id="g-save-status" role="status" aria-live="polite">저장 확인 후 다음 문항으로 이동합니다.</p><button id="g-save-retry" class="g-primary" hidden>같은 응답 다시 저장</button></section>
<section id="g-complete" class="g-panel g-centred" hidden><p class="g-eyebrow">참여 완료</p><h1 tabindex="-1">감사합니다.</h1><p id="g-complete-message">경로 응답과 사전 경험 응답을 저장했습니다.</p></section>
</main><footer class="g-footer">RUBI · 경로 선호 연구<span id="g-storage-status"></span></footer>`;

let phase:Phase='welcome',study:Study,scenes:PilotScene[]=[],state:Session;
let viewer:Viewer|undefined,engine:Physics|undefined,networks:OnnxNetworks|undefined,bundle:Bundle|undefined,collector:AppsScriptTransport|undefined;
let scenario:Scenario,aKey:RouteKey='direct',bKey:RouteKey='detour',active:RouteKey='direct';
let runs:Partial<Record<RouteKey,Rollout>>={},seen=new Set<RouteKey>(),running=false,abort:AbortController|undefined;
let trialStart=0,decisionStart=0,previewEvents:{route:RouteKey;atMs:number;mode:string}[]=[],replays={direct:0,detour:0},viewTime={direct:0,detour:0};
let replayReturn=false,finalizing=false,modelCreateCount=0,onnxCreateCount=0;
const storageKey=()=>`RUBI_Human_Preference_Path:${study.id}:${GUIDED_PROTOCOL}`;
const fail=(e:unknown)=>{$('g-error').textContent=String(e instanceof Error?e.message:e);$('g-error').hidden=false;};
const clearError=()=>{$('g-error').hidden=true;};
const save=()=>{localStorage.setItem(storageKey(),JSON.stringify(state));};
const selectValue=(id:string)=>$<HTMLSelectElement>(id).value;
function show(next:Phase){
  phase=next;
  for(const name of ['welcome','profile','intro','loading','observe','choice','saving','complete'])$( `g-${name}`).hidden=name!==next;
  const step=next==='welcome'?0:next==='profile'?1:next==='intro'||next==='loading'?2:next==='complete'?4:3;
  document.querySelectorAll('.g-steps span').forEach((e,i)=>e.classList.toggle('current',i===step));
  $(`g-${next}`).querySelector<HTMLElement>('h1')?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'instant'});if(next==='observe')viewer?.resize();
}
function label(key:RouteKey){return key===aKey?'A':'B';}
function readyPath(key:RouteKey){
  active=key;show('observe');
  $('g-counter').textContent=`문항 ${state.index+1} / ${scenes.length}`;
  $('g-observe-title').textContent=`경로 ${label(key)}를 확인하세요.`;
  $('g-watch-status').textContent=seen.size?`경로 ${label(aKey)} 확인 완료`:'';
  $('g-action-hint').textContent='같은 출발 상태에서 시작합니다. 보행을 끝까지 확인해 주세요.';
  btn('g-watch').textContent=`경로 ${label(key)} 보기`;btn('g-watch').disabled=false;btn('g-watch').hidden=false;btn('g-stop').hidden=true;
  engine!.setScenario(scenario);viewer!.aKey=aKey;viewer!.setScenario(scenario,key);viewer!.robot.visible=true;viewer!.updateRobot();viewer!.resetFollow([0,0,0]);
}
function nextTrial(){
  const s=scenes[state.order[state.index]];scenario=makeScenario(s.height,s.detour,s.speed);
  aKey=state.presentations[state.index];bKey=aKey==='direct'?'detour':'direct';
  runs={};seen=new Set();viewTime={direct:0,detour:0};replays={direct:0,detour:0};previewEvents=[];trialStart=performance.now();replayReturn=false;
  readyPath(aKey);
}
async function connect(){
  if(!study.responseApi)throw new Error('응답 저장 주소가 없습니다. 연구자에게 알려주세요.');
  collector?.dispose();collector=new AppsScriptTransport(study.responseApi);
  const reply=await collector.ping(study.id,study.status);
  if(reply.service!=='rubi-hpp'||reply.experimentId!==study.id||reply.studyStatus!==study.status)throw new Error('응답 서비스의 연구 설정이 다릅니다.');
  $('g-storage-status').textContent='중앙 저장 연결 확인';
}
async function prepare(){
  clearError();show('loading');btn('g-load-retry').hidden=true;
  try{
    await connect();
    if(!bundle){
      const base=new URL(study.bundleBaseUrl,new URL(import.meta.env.BASE_URL,location.href));
      const loaded=await fetchHostedBundle(base,text=>{$('g-load-status').textContent=text;});bundle=loaded.bundle;
    }
    $('g-load-status').textContent='보행 제어기와 로봇을 준비하고 있습니다.';
    if(!networks){networks=await OnnxNetworks.create(bundle.files);onnxCreateCount++;}
    scenario=makeScenario(scenes[state.order[state.index]].height,scenes[state.order[state.index]].detour,.5);
    if(!engine){engine=await Physics.create(bundle,scenario);modelCreateCount++;}
    if(!viewer){viewer=new Viewer($<HTMLCanvasElement>('g-world'));viewer.attach(engine);viewer.setParticipantView(true);}
    if(state.pending){show('saving');await sendPending();return;}
    nextTrial();
  }catch(e){fail(e);btn('g-load-retry').hidden=false;}
}
function showChoice(){
  if(!canChoose(seen,{direct:runs.direct?.completed,detour:runs.detour?.completed}))return;
  $('g-choice-counter').textContent=`문항 ${state.index+1} / ${scenes.length}`;
  $('g-desc-a').textContent=choiceDescription(scenario,aKey);$('g-desc-b').textContent=choiceDescription(scenario,bKey);
  show('choice');decisionStart=performance.now();
}
async function observe(key:RouteKey){
  if(running||!engine||!viewer||!networks)return;
  clearError();running=true;abort=new AbortController();const signal=abort.signal;
  btn('g-watch').disabled=true;btn('g-watch').hidden=true;btn('g-stop').hidden=false;
  $('g-watch-status').textContent=`경로 ${label(key)} 관찰 중`;
  $('g-action-hint').textContent='보행 중에는 별도 조작이 필요하지 않습니다.';
  engine.setScenario(scenario);viewer.setScenario(scenario,key);viewer.resetFollow([0,0,0]);viewer.robot.visible=true;viewer.updateRobot();
  const clock=new LiveClock(),cached=runs[key];
  previewEvents.push({route:key,atMs:performance.now()-trialStart,mode:cached?.completed?'replay':'live'});replays[key]++;
  try{
    let run:Rollout;
    if(cached?.completed){
      run=cached;
      for(const frame of run.frames){await clock.frame(frame.time,signal);engine.applyFrame(frame);viewer.updateRobot();}
    }else{
      run=await engine.rollout(key,networks,signal,()=>{}, {onFrame:async frame=>{
        await clock.frame(frame.time,signal);viewer!.updateRobot();
      }});
      runs[key]=run;
    }
    run.visibleWallMs=clock.visibleWallMs;run.realTimeFactor=run.duration/(Math.max(clock.visibleWallMs,1)/1000);run.maxDisplayGapMs=clock.maxGapMs;
    run.displayMode=cached?.completed?'replay':'live';viewTime[key]+=run.duration;
    if(!run.completed){
      seen.delete(key);$('g-action-hint').textContent='이 경로가 완주하지 못해 선호 응답을 받지 않습니다. 다시 확인하거나 연구자에게 알려주세요.';
      $('g-watch-status').textContent=run.reason;btn('g-watch').textContent='출발점에서 다시 확인';btn('g-watch').hidden=false;return;
    }
    // Live computation on a slow device can bias perceived duration. Offer the
    // already-computed clip instead of silently accepting slow-motion viewing.
    if(run.realTimeFactor<.90||clock.maxGapMs>400){
      seen.delete(key);$('g-watch-status').textContent='원활한 관찰을 위해 다시 보기가 필요합니다.';
      $('g-action-hint').textContent='기기의 계산·표시 지연을 감지했습니다. 같은 실행 기록을 정속으로 다시 보여드립니다.';
      btn('g-watch').textContent='같은 보행 다시 보기';btn('g-watch').hidden=false;return;
    }
    seen.add(key);
    if(replayReturn||seen.size===2){replayReturn=false;showChoice();}
    else readyPath(bKey);
  }catch(e){
    if((e as Error).name==='AbortError'){$('g-action-hint').textContent='중지했습니다. 다시 누르면 출발점에서 시작합니다.';}
    else fail(e);
    btn('g-watch').textContent=`경로 ${label(key)} 다시 보기`;btn('g-watch').hidden=false;
  }finally{clock.dispose();running=false;btn('g-watch').disabled=false;btn('g-stop').hidden=true;}
}
function summary(run:Rollout){const {frames,...metadata}=run;return metadata;}
async function choose(choice:RouteKey|'tie'){
  if(phase!=='choice'||!canChoose(seen,{direct:runs.direct?.completed,detour:runs.detour?.completed}))return;
  clearError();
  const payload={schemaVersion:1,consent:true,submissionId:crypto.randomUUID(),participantId:state.participantId,sessionId:state.id,
    experimentId:study.id,studyStatus:study.status,protocolVersion:GUIDED_PROTOCOL,trialId:`guided-v4-${state.index}-${scenario.id}`,
    trialSequence:state.index+1,isPractice:false,scenario:{...scenario,lengthMetric:'planned_xy_polyline',crossingType:'platform_ascent_and_descent'},
    choice,presentation:{a:aKey,b:bKey},runs:{direct:summary(runs.direct!),detour:summary(runs.detour!)},hashes:bundle!.hashes,
    previewCoverage:{direct:1,detour:1},viewTime:{...viewTime},replays:{...replays},previewEvents:[...previewEvents],
    decisionMs:performance.now()-decisionStart,elapsedTrialMs:performance.now()-trialStart,trialOrder:state.order,
    labelConditionVersion:LABEL_CONDITION,cameraProtocol:CAMERA_PROTOCOL,controllerVersion:'cosine-follower-v2',
    tutorialVersion:'guided-instructions-v1',tutorialCompleted:true,consentVersion:'consent-v1',sessionStartedAtUtc:state.startedAt,
    profileTiming:'before_simulation',profileAnsweredAtUtc:state.profile!.answeredAtUtc,preProfile:state.profile,
    browser:{userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight]},createdAt:new Date().toISOString()};
  try{state.pending=payload;save();show('saving');await sendPending();}catch(e){fail(e);show('saving');btn('g-save-retry').hidden=false;}
}
async function sendPending(){
  if(!state.pending)return;btn('g-save-retry').hidden=true;clearError();
  $('g-save-status').textContent='저장 확인 후 다음 문항으로 이동합니다.';
  try{
    if(!collector)await connect();
    const p=state.pending,reply=await collector!.request('trial',p,30000);
    if(reply.kind!=='trial'||reply.submissionId!==p.submissionId)throw new Error('저장 확인 ID가 일치하지 않습니다.');
    if(!state.responses.some(r=>r.submissionId===p.submissionId))state.responses.push(p);
    state.pending=undefined;state.index++;save();
    $('g-save-status').textContent='응답이 저장되었습니다.';
    if(state.index>=scenes.length)await finalize();else{await new Promise(r=>setTimeout(r,350));nextTrial();}
  }catch(e){fail(e);$('g-save-status').textContent='응답은 이 기기에 보관했습니다. 같은 ID로 다시 저장하므로 중복을 방지합니다.';btn('g-save-retry').hidden=false;}
}
async function finalize(){
  if(finalizing)return;finalizing=true;show('saving');btn('g-save-retry').hidden=true;
  $('g-save-status').textContent='시작 전에 답한 경험 설문을 연결하고 있습니다.';
  try{
    if(!collector)await connect();
    const p=state.profile!;
    // Deployed collector's profile endpoint also marks a session completed.
    // Therefore collect BEFORE viewing, but finalize remotely only at the end.
    const reply=await collector!.request('profile',{experimentId:study.id,studyStatus:study.status,sessionId:state.id,participantId:state.participantId,
      profileSchemaVersion:'pre-profile-v1',roboticsRelatedExperience:p.roboticsRelatedExperience,knewRubiBeforeStudy:p.knewRubiBeforeStudy,
      rubiExposureBeforeStudy:p.rubiExposureBeforeStudy,profileCompletedAtUtc:new Date().toISOString(),profileAnsweredAtUtc:p.answeredAtUtc,
      groupingRuleVersion:'cohort-v1'},30000);
    if(reply.kind!=='profile'||reply.submissionId!==state.id)throw new Error('배경 설문 저장 확인이 다릅니다.');
    state.complete=true;save();show('complete');
  }catch(e){fail(e);btn('g-save-retry').hidden=false;}finally{finalizing=false;}
}
btn('g-start').onclick=()=>{
  if(!$<HTMLInputElement>('g-consent').checked)return;state.consent=true;
  try{save();if(state.profile){$<HTMLSelectElement>('g-robotics').value=state.profile.roboticsRelatedExperience;$<HTMLSelectElement>('g-knew').value=state.profile.knewRubiBeforeStudy;$<HTMLSelectElement>('g-exposure').value=state.profile.rubiExposureBeforeStudy;}show('profile');}catch(e){fail(e);}
};
$<HTMLInputElement>('g-consent').onchange=()=>{btn('g-start').disabled=!$<HTMLInputElement>('g-consent').checked;};
$<HTMLFormElement>('g-profile-form').onsubmit=e=>{
  e.preventDefault();const p={roboticsRelatedExperience:selectValue('g-robotics'),knewRubiBeforeStudy:selectValue('g-knew'),rubiExposureBeforeStudy:selectValue('g-exposure'),answeredAtUtc:new Date().toISOString()};
  if(!validProfile(p))return;
  try{state.profile=p;save();show('intro');}catch(error){fail(error);}
};
btn('g-begin').onclick=()=>{state.tutorialCompleted=true;try{save();void prepare();}catch(e){fail(e);}};
btn('g-load-retry').onclick=()=>void prepare();btn('g-watch').onclick=()=>void observe(active);btn('g-stop').onclick=()=>abort?.abort();
btn('g-replay-a').onclick=()=>{replayReturn=true;readyPath(aKey);void observe(aKey);};
btn('g-replay-b').onclick=()=>{replayReturn=true;readyPath(bKey);void observe(bKey);};
btn('g-choose-a').onclick=()=>void choose(aKey);btn('g-choose-b').onclick=()=>void choose(bKey);btn('g-tie').onclick=()=>void choose('tie');
btn('g-save-retry').onclick=()=>{if(state.pending)void sendPending();else void finalize();};
async function bootstrap(){
  try{
    const res=await fetch(`${import.meta.env.BASE_URL}study.json`,{cache:'no-cache'});if(!res.ok)throw new Error('연구 설정을 불러오지 못했습니다.');study=await res.json();
    scenes=study.guidedScenarios??study.scenarios;
    if(!scenes.length||!['draft','released'].includes(study.status))throw new Error('연구 설정을 확인하세요.');
    scenes.forEach(s=>{makeScenario(s.height,s.detour,s.speed);if(s.speed!==.5)throw new Error('참가자용 기준 명령은 0.50으로 고정되어야 합니다.');});
    $('g-pilot-note').hidden=study.status!=='draft';
    let restored:Session|undefined;
    try{restored=JSON.parse(localStorage.getItem(storageKey())??'null')??undefined;}catch{}
    const valid=restored&&restored.order.length===scenes.length&&new Set(restored.order).size===scenes.length&&restored.order.every(i=>Number.isInteger(i)&&i>=0&&i<scenes.length)&&restored.presentations.length===scenes.length&&restored.presentations.every(k=>k==='direct'||k==='detour')&&Number.isInteger(restored.index)&&restored.index>=0&&restored.index<=scenes.length;
    const participantKey='RUBI_Human_Preference_Path:rubi-hpp-participant';
    const participantId=localStorage.getItem(participantKey)?JSON.parse(localStorage.getItem(participantKey)!):crypto.randomUUID();localStorage.setItem(participantKey,JSON.stringify(participantId));
    state=valid?restored!:{id:crypto.randomUUID(),participantId,startedAt:new Date().toISOString(),order:pilotOrder(scenes),presentations:scenes.map(()=>crypto.getRandomValues(new Uint8Array(1))[0]%2?'direct':'detour'),index:0,consent:false,tutorialCompleted:false,complete:false,responses:[]};
    save();if(state.complete){show('complete');return;}
    if(state.index===scenes.length){show('saving');await finalize();return;}
    if(state.index>0)$('g-resume').textContent=`이 기기에 ${state.index}개 응답이 저장되어 있습니다. 이어서 참여합니다.`;
    show('welcome');
  }catch(e){fail(e);btn('g-start').disabled=true;}
}
if(import.meta.env.DEV){
  Object.assign(window,{__rubiGuidedTest:()=>({phase,index:state?.index,scenes,scenario,aKey,bKey,seen:[...seen],runs,runtimeId:engine?.runtimeId,modelCreateCount,onnxCreateCount,
    qpos:engine?Array.from(engine.data.qpos):[],qvel:engine?Array.from(engine.data.qvel):[],camera:viewer?.camera.position.toArray(),target:viewer?.controls.target.toArray(),spriteCount:viewer?.world.children.filter(c=>c.type==='Sprite').length,
    markerNames:viewer?.world.children.map(c=>c.name).filter(Boolean)})});
}
void bootstrap();
