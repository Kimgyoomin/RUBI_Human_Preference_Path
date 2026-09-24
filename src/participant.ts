import './guided.css';
import {isUiCheckStudy,collectionStorageKey,createSessionId,sessionMatchesPurpose} from './ui-session.ts';
import {fetchHostedBundle} from './runtime/bundle-loader.ts';
import type {Bundle} from './core/model.ts';
import {makeScenario} from './core/scenario.ts';
import type {RouteKey,Scenario} from './core/scenario.ts';
import {Coverage} from './core/study.ts';
import {Physics} from './runtime/physics.ts';
import type {Frame,Rollout} from './runtime/physics.ts';
import {OnnxNetworks} from './runtime/onnx.ts';
import {Viewer,CAMERA_PROTOCOL} from './runtime/viewer.ts';
import {LiveClock} from './runtime/live-clock.ts';
import {AppsScriptTransport} from './runtime/apps-script.ts';
import {validProfile,canChoose} from './core/guided-study.ts';
import type {ProfileAnswers,PilotScene} from './core/guided-study.ts';
import {OBSERVATION_POLICY,canFinishViewing,preserveAndRestart} from './core/observation-policy.ts';
import {routeChoice,isBinaryAnswer,assertIntroAssets,introRecordVersion} from './core/binary-study.ts';
import type {BinaryAnswer} from './core/binary-study.ts';
import {IntroVideo} from './runtime/intro-video.ts';
import {BLOCK_PROTOCOL as UX_PROTOCOL,BLOCK_LABEL_CONDITION as UX_LABEL_CONDITION,BLOCK_RULE,CANDIDATE_SET,COLLECTOR_VERSION,createBlockPlan,validBlockPlan,nextBlockQuestion,questionCount,acknowledgeAnswer} from './core/height-block-study.ts';
import type {BlockPlan,BlockAnswer,BlockQuestion} from './core/height-block-study.ts';

type Study={collectionPhase?:string;id:string;status:'draft'|'released';responseApi:string;bundleBaseUrl:string;scenarios:PilotScene[];guidedScenarios?:PilotScene[];heightBlocks?:{version:string;heightsCm:number[];detoursMm:number[];questionsPerHeight:number};introduction?:{manifestUrl:string}};
type Phase='welcome'|'profile'|'intro'|'loading'|'observe'|'choice'|'saving'|'complete';
type Session={id:string;participantId:string;startedAt:string;plan:BlockPlan;index:number;profile?:ProfileAnswers;consent:boolean;tutorialCompleted:boolean;complete:boolean;pending?:Record<string,unknown>;responses:Record<string,unknown>[];repeatIndex?:number;previousSessionId?:string;introduction?:{version:string;contentId:string;acknowledgedAtUtc:string}};
type ViewEvent={route:RouteKey;atMs:number;mode:'live'|'replay';shownSeconds:number;shownUntil:number;visibleWallMs:number;maxGapMs:number;earlyFinish:boolean;qualified:boolean;interrupted:boolean};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const btn=(id:string)=>$<HTMLButtonElement>(id);
$('app').innerHTML=`
<header class="g-header"><div class="g-brand"><span class="g-brand-icon">R</span><div>RUBI<small>HUMAN PREFERENCE PATH</small></div></div><a id="g-research" href="?mode=research">연구자 화면</a></header>
<main class="g-main">
<div id="g-error" class="g-error" role="alert" hidden></div>
<div id="g-pilot-note" class="g-pilot-note" hidden>현재는 설문을 시험하는 단계입니다. 이번 답변은 정식 조사와 구분해 보관합니다.</div>
<div id="g-ui-check-note" class="g-pilot-note" role="status" hidden>본 조사 저장을 확인하는 최종 점검입니다. 이번 응답은 본 조사 분석에서 제외합니다.<br><span id="g-ui-check-id"></span></div>
<nav class="g-steps" aria-label="참여 순서"><span>참여 동의</span><span>시작 전 질문</span><span>RUBI 알아보기</span><span>길 선택</span><span>완료</span></nav>
<section id="g-welcome" class="g-panel">
<p class="g-eyebrow">로봇의 이동 경로에 대한 설문</p><h1 tabindex="-1">RUBI가 이동할 길을 정해 주세요.</h1>
<p>여러분은 로봇이 이동할 길을 정하는 사용자입니다. 로봇의 움직임을 확인한 뒤, 같은 도착점으로 가는 두 길 중 하나를 지정해 주세요. 로봇에 대해 잘 몰라도 참여할 수 있습니다.</p>
<p>먼저 RUBI의 보행 예시를 보고 같은 높이의 턱을 네 번씩 비교하며 총 <span id="g-total">16</span>문항에 답합니다. 돌아가는 거리는 앞선 답에 따라 달라질 수 있습니다. 이름이나 이메일은 묻지 않습니다. 고른 답, 화면을 본 시간, 로봇의 움직임, 시작 전 질문의 답변을 함께 저장합니다.</p>
<label class="g-consent"><input id="g-consent" type="checkbox"> 안내를 읽었으며 답변 저장에 동의합니다.</label>
<button id="g-start" class="g-primary" disabled>시작 전 질문으로</button><p id="g-resume" class="g-muted"></p>
<button id="g-reset-welcome" class="g-secondary" hidden>처음부터 다시 시작</button></section>
<section id="g-profile" class="g-panel" hidden><p class="g-eyebrow">시작 전 질문</p><h1 tabindex="-1">로봇을 접해 본 경험이 있나요?</h1>
<p>이번 설문을 시작하기 전의 경험을 알려 주세요. 로봇을 처음 접하셨다면 ‘아니요’나 ‘본 적 없음’을 고르면 됩니다.</p>
<form id="g-profile-form" class="g-profile-grid">
<label>로봇과 관련된 일을 하거나, 연구·수업·개발 활동에 참여한 적이 있나요?
<select id="g-robotics" required><option value="">선택해 주세요</option><option value="yes">예</option><option value="no">아니요</option><option value="prefer_not_to_say">답하지 않겠습니다</option></select></label>
<label>이번 설문 전에 RUBI라는 로봇을 알고 있었나요?
<select id="g-knew" required><option value="">선택해 주세요</option><option value="yes">예</option><option value="no">아니요</option><option value="unsure">잘 모르겠습니다</option><option value="prefer_not_to_say">답하지 않겠습니다</option></select></label>
<label>이번 설문 전에 RUBI가 움직이는 모습을 본 적이 있나요?
<select id="g-exposure" required><option value="">선택해 주세요</option><option value="none">본 적 없음</option><option value="video_only">영상으로만 봄</option><option value="in_person">현장에서 직접 봄</option><option value="both">영상과 현장 모두</option><option value="unsure">잘 모르겠습니다</option><option value="prefer_not_to_say">답하지 않겠습니다</option></select></label>
<button id="g-profile-next" class="g-primary" type="submit">RUBI의 움직임 알아보기</button></form></section>
<section id="g-intro" class="g-panel" hidden><p class="g-eyebrow">RUBI 알아보기</p><h1 tabindex="-1">RUBI는 이렇게 걷습니다.</h1>
<p>RUBI는 두 다리로 걷는 로봇입니다. 아래 예시는 <strong>이 설문과 같은 로봇 모델·학습 제어기·시뮬레이션 환경</strong>으로 만들었습니다. 실제 로봇을 촬영한 영상은 아닙니다.</p>
<video id="g-intro-video" class="g-intro-video" controls playsinline muted preload="metadata" aria-label="RUBI의 평지, 턱 통과, 우회 시뮬레이션 소개"></video>
<p id="g-intro-status" class="g-muted" role="status" aria-live="polite">소개 영상을 준비하고 있습니다.</p>
<div id="g-intro-chapters" class="g-intro-chapters" aria-label="소개 영상의 구간 바로 보기"></div>
<button id="g-intro-retry" class="g-secondary" type="button">소개 영상 다시 불러오기</button>
<p class="g-muted">평지 걷기 → 5·7·9·11 cm 턱을 올라갔다 내려오기 → 평평한 곳으로 돌아가기 순서입니다. 예시는 이 설정에서의 동작이며, 실제 로봇의 모든 상황에서 같은 결과를 보장하지 않습니다.</p>
<h2>이제 여러분이 이동할 길을 정해 주세요.</h2>
<p>RUBI는 초록색 출발점에서 빨간색 도착점으로 이동합니다. 하나는 턱을 통과하는 짧은 길, 다른 하나는 턱을 피해 평평한 곳으로 더 돌아가는 길입니다. <strong>여러분이 직접 걸을 길이 아니라 RUBI에게 지정할 길</strong>을 선택해 주세요. 정답을 맞히는 문제가 아닙니다.</p>
<div class="g-tutorial"><div><b>1</b><strong>A와 B 보기</strong><p>두 길 모두 같은 자리에서 출발합니다.</p></div><div><b>2</b><strong>충분히 봤으면 다음으로</strong><p>가운데 구간을 지난 뒤 ‘이 정도면 알겠어요’를 누를 수 있습니다.</p></div><div><b>3</b><strong>조건을 확인하고 지정하기</strong><p>턱 높이와 더 돌아가는 거리가 적힌 두 버튼 중 하나를 고릅니다. 다시 보면서 선택해도 됩니다.</p></div></div>
<div class="g-legend"><span><i class="g-start-dot"></i>초록 원: 출발하는 곳</span><span><i class="g-goal-ring"></i>빨간 동그라미: 도착하는 곳</span></div>
<p>‘0.8 m 더 돌아가기’는 다른 길보다 이동거리가 0.8 m 길다는 뜻입니다. 정보를 이해하기 어려운 문항은 별도로 넘길 수 있습니다.</p>
<label class="g-consent"><input id="g-intro-ack" type="checkbox" disabled> 보행 예시를 확인했고, 로봇에게 지정할 길을 고르는 질문임을 이해했습니다.</label>
<button id="g-begin" class="g-primary" disabled>경로 비교 시작하기</button></section>
<section id="g-loading" class="g-panel g-centred" hidden><div class="g-spinner" aria-hidden="true"></div><h1 tabindex="-1">로봇을 준비하고 있어요.</h1><p id="g-load-status" role="status" aria-live="polite">처음에 한 번만 준비합니다. 잠시 기다려 주세요.</p><button id="g-load-retry" class="g-primary" hidden>다시 연결하기</button></section>
<div id="g-review-layout">
<section id="g-observe" hidden><div class="g-trial-heading"><div><p id="g-counter" class="g-eyebrow"></p><h1 id="g-observe-title" tabindex="-1">A가 가는 길을 보세요.</h1></div><span id="g-watch-status" role="status" aria-live="polite"></span></div>
<p id="g-block-note" class="g-muted" aria-live="polite"></p>
<div class="g-viewport"><canvas id="g-world" aria-label="로봇이 길을 따라 이동하는 화면"></canvas></div>
<div class="g-actionbar"><p id="g-action-hint"></p><div class="g-watch-actions"><button id="g-watch" class="g-primary">A 보기</button><button id="g-enough" class="g-primary" disabled hidden>이 정도면 알겠어요</button><button id="g-stop" class="g-secondary">보기 멈추기</button></div></div></section>
<section id="g-choice" class="g-panel" hidden><p id="g-choice-counter" class="g-eyebrow"></p><h1 tabindex="-1">RUBI를 어느 길로 보내시겠습니까?</h1><p class="g-choice-intro">두 길의 도착점은 같습니다. 본 움직임과 아래 조건을 함께 고려해 주세요.</p>
<div class="g-compare"><article class="g-route-a"><h2>경로 A</h2><p id="g-desc-a"></p><button id="g-replay-a" class="g-secondary">A 다시 보기</button></article><article class="g-route-b"><h2>경로 B</h2><p id="g-desc-b"></p><button id="g-replay-b" class="g-secondary">B 다시 보기</button></article></div>
<div class="g-choices g-binary-choices"><button id="g-choose-a">A로 보내기</button><button id="g-choose-b">B로 보내기</button></div>
<details class="g-skip"><summary>정보가 부족해 고르기 어렵나요?</summary><p>다시 본 뒤에도 고르기 어렵다면 이번 문항을 넘길 수 있습니다. 이 응답은 경로 선호와 별도로 저장합니다.</p><button id="g-skip" class="g-secondary">정보가 부족해 이번 문항 넘기기</button></details></section></div>
<section id="g-saving" class="g-panel g-centred" hidden><h1 tabindex="-1">답변을 저장하고 있어요.</h1><p id="g-save-status" role="status" aria-live="polite">저장되면 다음 문항으로 넘어갑니다.</p><button id="g-save-retry" class="g-primary" hidden>저장 다시 시도하기</button></section>
<section id="g-complete" class="g-panel g-centred" hidden><p class="g-eyebrow">참여 완료</p><h1 tabindex="-1">감사합니다.</h1><p id="g-complete-message">모든 답변이 저장되었습니다. 이제 창을 닫으셔도 됩니다.</p><button id="g-restart" class="g-primary">처음부터 다시 해보기</button><p class="g-muted">앞서 저장한 답변은 그대로 남고, 새 참여 기록이 만들어집니다.</p></section>
</main><footer class="g-footer">RUBI · 로봇의 길 선택 설문<span id="g-storage-status"></span></footer>`;

const introduction=new IntroVideo($('g-intro'));
let phase:Phase='welcome',study:Study,scenes:PilotScene[]=[],state:Session;
let viewer:Viewer|undefined,engine:Physics|undefined,networks:OnnxNetworks|undefined,bundle:Bundle|undefined,collector:AppsScriptTransport|undefined;
let query:BlockQuestion,total=16;
let scenario:Scenario,aKey:RouteKey='direct',bKey:RouteKey='detour',active:RouteKey='direct';
let runs:Partial<Record<RouteKey,Rollout>>={},seen=new Set<RouteKey>(),running=false,abort:AbortController|undefined;
let trialStart=0,decisionStart=0,previewEvents:ViewEvent[]=[],replays={direct:0,detour:0},viewTime={direct:0,detour:0};
let coverage={direct:new Coverage(),detour:new Coverage()};
let finalizing=false,selecting=false,modelCreateCount=0,onnxCreateCount=0;
let observationTask:Promise<void>|undefined,finishRequested=false,reviewing=false;
const storageKey=()=>collectionStorageKey(study.id,UX_PROTOCOL,isUiCheckStudy(study));
const fail=(e:unknown)=>{$('g-error').textContent=String(e instanceof Error?e.message:e);$('g-error').hidden=false;};
const clearError=()=>{$('g-error').hidden=true;};
const save=()=>{localStorage.setItem(storageKey(),JSON.stringify(state));};
const selectValue=(id:string)=>$<HTMLSelectElement>(id).value;
const eligible=()=>canChoose(seen,{direct:runs.direct?.completed,detour:runs.detour?.completed});
function show(next:Phase){
  $('g-ui-check-note').hidden=!isUiCheckStudy(study);
  $('g-ui-check-id').textContent=isUiCheckStudy(study)?`점검 ID: ${state?.id??''}`:'';
  phase=next;for(const name of ['welcome','profile','intro','loading','observe','choice','saving','complete'])$(`g-${name}`).hidden=name!==next;
  if(next!=='intro')introduction.pause();
  const compare=next==='choice'||(next==='observe'&&reviewing&&eligible());if(compare){$('g-observe').hidden=false;$('g-choice').hidden=false;}
  $('g-review-layout').classList.toggle('is-review',compare);$('g-review-layout').hidden=next!=='observe'&&next!=='choice';
  const step=next==='welcome'?0:next==='profile'?1:next==='intro'||next==='loading'?2:next==='complete'?4:3;
  document.querySelectorAll('.g-steps span').forEach((e,i)=>e.classList.toggle('current',i===step));$(`g-${next}`).querySelector<HTMLElement>('h1')?.focus({preventScroll:true});
  if(!compare)window.scrollTo({top:0,behavior:'instant'});if(next==='observe'||next==='choice')viewer?.resize();updateChoices();
}
function updateChoices(){
  for(const id of ['g-choose-a','g-choose-b','g-skip'])btn(id).disabled=!eligible()||selecting||Boolean(state?.pending);
  for(const id of ['g-replay-a','g-replay-b'])btn(id).disabled=running||selecting;
}
function label(key:RouteKey){return key===aKey?'A':'B';}
async function showIntro(){
  clearError();show('intro');
  try{const base=new URL(import.meta.env.BASE_URL,location.href);await introduction.load(new URL(study.introduction?.manifestUrl??'./media/rubi-intro-v1/manifest.json',base));}
  catch(e){fail(e);$('g-intro-status').textContent='소개 영상을 불러오지 못했습니다. 다시 불러오기 버튼을 눌러 주세요.';}
}
function readyPath(key:RouteKey){
  active=key;show('observe');$('g-block-note').textContent=query.trialInBlock===1?'새 높이의 턱입니다. 이어지는 네 문항에서는 턱은 같고 돌아가는 거리가 달라집니다.':'같은 높이의 턱입니다. 이번에 제시된 돌아가는 거리와 움직임을 보고 선택해 주세요.';$('g-counter').textContent=`${state.index+1} / ${total} 문항 · ${query.blockIndex}번째 묶음 ${query.trialInBlock}/4`;
  $('g-observe-title').textContent=`${label(key)}가 가는 길을 보세요.`;$('g-watch-status').textContent=seen.size?`${label(aKey)} 확인했어요`:'';
  $('g-action-hint').textContent='가운데 구간을 지난 뒤에는 끝까지 보지 않아도 됩니다.';
  btn('g-watch').textContent=`${label(key)} 보기`;btn('g-watch').disabled=false;btn('g-watch').hidden=false;btn('g-stop').hidden=true;btn('g-enough').hidden=true;
  engine!.setScenario(scenario);viewer!.aKey=aKey;viewer!.setScenario(scenario,key);viewer!.robot.visible=true;viewer!.updateRobot();viewer!.resetFollow([0,0,0]);
}
function currentQuery(){
  const q=nextBlockQuestion(state.plan,state.responses as unknown as BlockAnswer[]);
  if(!q)throw new Error('모든 질문을 마쳤습니다.');return q;
}
function nextTrial(){
  query=currentQuery();scenario=makeScenario(query.heightCm/100,query.detourMm/1000,.5);
  aKey=query.aRoute;bKey=aKey==='direct'?'detour':'direct';runs={};seen=new Set();
  viewTime={direct:0,detour:0};replays={direct:0,detour:0};previewEvents=[];coverage={direct:new Coverage(),detour:new Coverage()};
  trialStart=performance.now();decisionStart=0;reviewing=false;selecting=false;const skip=document.querySelector<HTMLDetailsElement>('.g-skip');if(skip)skip.open=false;readyPath(aKey);
}
async function connect(){
  if(!study.responseApi)throw new Error('답변을 저장할 곳에 연결하지 못했습니다. 연구자에게 알려 주세요.');
  collector?.dispose();collector=new AppsScriptTransport(study.responseApi);let reply;try{reply=await collector.ping(study.id,study.status);}catch(e){if(String(e).includes('experimentId'))throw new Error('저장 서비스 업데이트가 필요합니다. 연구자는 새 Code.gs로 기존 Apps Script 배포를 갱신해 주세요.');throw e;}
  if(reply.service!=='rubi-hpp'||reply.experimentId!==study.id||reply.studyStatus!==study.status)throw new Error('설문과 저장 서비스의 설정이 다릅니다. 연구자에게 알려 주세요.');
  if(reply.collectorVersion!==COLLECTOR_VERSION)throw new Error('저장 서비스 업데이트가 필요합니다. 연구자는 새 Code.gs로 기존 Apps Script 배포를 갱신해 주세요.');
  $('g-storage-status').textContent='답변 저장 연결됨';
}
async function prepare(){
  clearError();show('loading');btn('g-load-retry').hidden=true;
  try{
    await connect();if(state.pending){show('saving');await sendPending();return;}
    if(!bundle){const base=new URL(study.bundleBaseUrl,new URL(import.meta.env.BASE_URL,location.href));const loaded=await fetchHostedBundle(base,()=>{$('g-load-status').textContent='로봇을 화면에 불러오고 있어요. 처음에는 조금 걸릴 수 있습니다.';});bundle=loaded.bundle;}
    if(!introduction.manifest||!state.introduction)throw new Error('RUBI 소개를 먼저 확인해 주세요.');
    assertIntroAssets(introduction.manifest,bundle.hashes);
    $('g-load-status').textContent='로봇이 걸을 준비를 하고 있어요.';
    if(!networks){networks=await OnnxNetworks.create(bundle.files);onnxCreateCount++;}
    query=currentQuery();scenario=makeScenario(query.heightCm/100,query.detourMm/1000,.5);
    if(!engine){engine=await Physics.create(bundle,scenario);modelCreateCount++;}
    if(!viewer){viewer=new Viewer($<HTMLCanvasElement>('g-world'));viewer.attach(engine);viewer.setParticipantView(true);}nextTrial();
  }catch(e){fail(e);btn('g-load-retry').hidden=false;}
}
function fillChoice(){
  $('g-choice-counter').textContent=`${state.index+1} / ${total} 문항 · ${query.blockIndex}번째 묶음 ${query.trialInBlock}/4`;
  const a=routeChoice(scenario,aKey,'A'),b=routeChoice(scenario,bKey,'B');
  $('g-desc-a').textContent=a.detail;$('g-desc-b').textContent=b.detail;btn('g-choose-a').textContent=a.button;btn('g-choose-b').textContent=b.button;
}
function showChoice(){
  if(!eligible())return;reviewing=false;fillChoice();if(!decisionStart)decisionStart=performance.now();
  $('g-observe-title').textContent='필요하면 다시 보세요.';$('g-watch-status').textContent='두 길 모두 확인했어요';$('g-action-hint').textContent='다시 보는 중에도 답을 고를 수 있습니다.';
  btn('g-watch').hidden=true;btn('g-enough').hidden=true;btn('g-stop').hidden=true;show('choice');
}
function startObservation(key:RouteKey,replay=false){
  if(running||selecting)return;reviewing=replay&&eligible();active=key;readyPath(key);fillChoice();observationTask=observe(key).finally(()=>{observationTask=undefined;});
}
async function observe(key:RouteKey){
  if(running||!engine||!viewer||!networks)return;
  clearError();running=true;finishRequested=false;abort=new AbortController();const signal=abort.signal;
  const wasReview=reviewing&&eligible(),hadQualifiedView=seen.has(key);
  btn('g-watch').hidden=true;btn('g-enough').disabled=true;btn('g-enough').hidden=wasReview;btn('g-stop').hidden=false;
  $('g-watch-status').textContent=`${label(key)} 보는 중`;$('g-action-hint').textContent=wasReview?'다시 보기를 끝까지 기다리지 않고 답을 골라도 됩니다.':'가운데 구간을 지나면 ‘이 정도면 알겠어요’를 누를 수 있어요.';
  engine.setScenario(scenario);viewer.setScenario(scenario,key);viewer.resetFollow([0,0,0]);viewer.robot.visible=true;viewer.updateRobot();updateChoices();
  const clock=new LiveClock(),cached=runs[key],attemptCoverage=new Coverage();
  const event:ViewEvent={route:key,atMs:performance.now()-trialStart,mode:cached?.completed?'replay':'live',shownSeconds:0,shownUntil:0,visibleWallMs:0,maxGapMs:0,earlyFinish:false,qualified:false,interrupted:false};
  previewEvents.push(event);replays[key]++;let lastTime=0,checkpointSeen=false,lastFrame:Frame|undefined;
  const present=async(frame:Frame,apply:boolean)=>{
    if(finishRequested)return;await clock.frame(frame.time,signal);if(finishRequested)return;
    if(apply)engine!.applyFrame(frame);viewer!.updateRobot();lastFrame={time:frame.time,qpos:[...frame.qpos]};
    if(clock.maxGapMs<=400){coverage[key].add(lastTime,frame.time);attemptCoverage.add(lastTime,frame.time);}
    lastTime=frame.time;event.shownUntil=frame.time;event.visibleWallMs=clock.visibleWallMs;event.maxGapMs=clock.maxGapMs;
    event.shownSeconds=attemptCoverage.intervals.reduce((n,[a,b])=>n+b-a,0);
    checkpointSeen=checkpointSeen||canFinishViewing(scenario,frame.qpos[engine!.root],frame.time,event.visibleWallMs,event.maxGapMs);btn('g-enough').disabled=!checkpointSeen;
  };
  let run:Rollout|undefined;
  try{
    if(cached?.completed){run=cached;for(const frame of run.frames){if(finishRequested)break;await present(frame,true);}}
    else{run=await engine.rollout(key,networks,signal,()=>{}, {onFrame:frame=>present(frame,false)});runs[key]=run;}
    event.earlyFinish=finishRequested;if(lastFrame&&finishRequested){engine.applyFrame(lastFrame);viewer.updateRobot();}
    const rtf=event.shownUntil/(Math.max(event.visibleWallMs,1)/1000);
    if(!hadQualifiedView){run.visibleWallMs=event.visibleWallMs;run.realTimeFactor=rtf;run.maxDisplayGapMs=event.maxGapMs;run.displayMode=event.mode;}
    if(!run.completed){$('g-action-hint').textContent='로봇이 도착하지 못했습니다. 이번 문항은 답을 받지 않습니다. 다시 보거나 연구자에게 알려 주세요.';$('g-watch-status').textContent='다시 확인이 필요해요';btn('g-watch').textContent='출발점에서 다시 보기';btn('g-watch').hidden=false;return;}
    event.qualified=rtf>=.90&&event.maxGapMs<=400&&(checkpointSeen||attemptCoverage.fraction(run.duration)>=.98);
    if(event.qualified)seen.add(key);if(selecting)return;if(wasReview){showChoice();return;}
    if(!event.qualified){$('g-watch-status').textContent='화면이 끊겨 다시 확인이 필요해요.';$('g-action-hint').textContent='로봇이 정상 속도로 보이도록 같은 움직임을 다시 보여드립니다.';btn('g-watch').textContent='같은 움직임 다시 보기';btn('g-watch').hidden=false;return;}
    if(seen.size===2)showChoice();else{reviewing=false;readyPath(bKey);}
  }catch(e){
    event.interrupted=true;if(!selecting){if((e as Error).name==='AbortError'){if(wasReview){showChoice();return;}$('g-action-hint').textContent='보기를 멈췄습니다. 다시 누르면 출발점에서 시작해요.';}else fail(e);btn('g-watch').textContent=`${label(key)} 다시 보기`;btn('g-watch').hidden=false;}
  }finally{viewTime[key]+=event.shownSeconds;clock.dispose();running=false;btn('g-watch').disabled=false;btn('g-stop').hidden=true;btn('g-enough').hidden=true;updateChoices();}
}
function summary(run:Rollout){const {frames,...metadata}=run;return metadata;}
async function choose(choice:BinaryAnswer){
  if(!isBinaryAnswer(choice)||selecting||state.pending||!eligible()||(phase!=='choice'&&!(phase==='observe'&&reviewing)))return;
  selecting=true;updateChoices();clearError();const clickedAt=performance.now(),duringReplay=running&&reviewing;
  try{
    abort?.abort();await observationTask;
    if(!introduction.manifest||!state.introduction)throw new Error('소개 영상 정보가 없습니다.');
    const payload={schemaVersion:1,consent:true,submissionId:crypto.randomUUID(),participantId:state.participantId,sessionId:state.id,
      experimentId:study.id,studyStatus:study.status,protocolVersion:UX_PROTOCOL,trialId:`block-v7-${query.blockIndex}-${query.trialInBlock}-${scenario.id}`,trialSequence:state.index+1,isPractice:false,
      scenario:{...scenario,lengthMetric:'planned_xy_polyline',crossingType:'platform_ascent_and_descent'},choice,skipReason:choice==='skip'?'insufficient_information':'',
      presentation:{a:aKey,b:bKey},runs:{direct:summary(runs.direct!),detour:summary(runs.detour!)},hashes:bundle!.hashes,
      previewCoverage:{direct:coverage.direct.fraction(runs.direct!.duration),detour:coverage.detour.fraction(runs.detour!.duration)},viewTime:{...viewTime},replays:{...replays},previewEvents:previewEvents.map(e=>({...e})),
      decisionMs:Math.max(0,clickedAt-decisionStart),elapsedTrialMs:clickedAt-trialStart,trialOrder:state.plan.blocks.map(b=>b.heightCm),
      labelConditionVersion:UX_LABEL_CONDITION,observationPolicy:OBSERVATION_POLICY,choiceDuringReplay:duringReplay,queryReason:query.reason,adaptiveVersion:BLOCK_RULE,candidateSetId:CANDIDATE_SET,
      blockIndex:query.blockIndex,trialInBlock:query.trialInBlock,blockOrder:state.plan.blocks.map(b=>b.heightCm),endpointOrder:query.endpointOrder,queryContext:query.context,questionPlan:state.plan,expectedTrials:total,
      repeatIndex:state.repeatIndex??0,previousSessionId:state.previousSessionId??null,cameraProtocol:CAMERA_PROTOCOL,controllerVersion:'cosine-follower-v2',
      tutorialVersion:introRecordVersion(introduction.manifest),tutorialCompleted:true,introAcknowledgement:'self_report_not_full_watch_measurement',introduction:state.introduction,
      consentVersion:'consent-v1',sessionStartedAtUtc:state.startedAt,profileTiming:'before_simulation',profileAnsweredAtUtc:state.profile!.answeredAtUtc,preProfile:state.profile,
      browser:{userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight]},createdAt:new Date().toISOString()};
    state.pending=payload;save();show('saving');await sendPending();
  }catch(e){fail(e);if(state.pending){show('saving');btn('g-save-retry').hidden=false;}}finally{selecting=false;updateChoices();}
}
async function sendPending(){
  if(!state.pending)return;btn('g-save-retry').hidden=true;clearError();$('g-save-status').textContent='저장되면 다음 문항으로 넘어갑니다.';
  try{
    if(!collector)await connect();const p=state.pending,reply=await collector!.request('trial',p,30000);
    if(reply.collectorVersion!==COLLECTOR_VERSION||reply.kind!=='trial'||reply.submissionId!==p.submissionId)throw new Error('저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
    state=acknowledgeAnswer(state,next=>localStorage.setItem(storageKey(),JSON.stringify(next)));$('g-save-status').textContent='답변이 저장되었습니다.';
    if(state.index>=total)await finalize();else{await new Promise(r=>setTimeout(r,350));if(engine&&viewer&&networks)nextTrial();else await prepare();}
  }catch(e){fail(e);$('g-save-status').textContent='답변을 이 기기에 보관했습니다. 아래 버튼으로 다시 저장해 주세요. 같은 답이 두 번 저장되지는 않습니다.';btn('g-save-retry').hidden=false;}
}
async function finalize(){
  if(finalizing)return;finalizing=true;show('saving');btn('g-save-retry').hidden=true;$('g-save-status').textContent='마지막으로 시작 전 질문의 답변을 저장하고 있어요.';
  try{
    if(!collector)await connect();const p=state.profile!;
    const reply=await collector!.request('profile',{experimentId:study.id,studyStatus:study.status,sessionId:state.id,participantId:state.participantId,profileSchemaVersion:'pre-profile-plain-v2',protocolVersion:UX_PROTOCOL,expectedTrials:total,consent:true,
      roboticsRelatedExperience:p.roboticsRelatedExperience,knewRubiBeforeStudy:p.knewRubiBeforeStudy,rubiExposureBeforeStudy:p.rubiExposureBeforeStudy,
      profileCompletedAtUtc:new Date().toISOString(),profileAnsweredAtUtc:p.answeredAtUtc,groupingRuleVersion:'cohort-v1'},30000);
    if(reply.collectorVersion!==COLLECTOR_VERSION||reply.kind!=='profile'||reply.submissionId!==state.id)throw new Error('시작 전 질문의 답변을 저장하지 못했습니다. 다시 시도해 주세요.');const next={...state,complete:true};localStorage.setItem(storageKey(),JSON.stringify(next));state=next;show('complete');
  }catch(e){fail(e);btn('g-save-retry').hidden=false;}finally{finalizing=false;}
}
function freshSession(participantId:string,previous?:Session):Session{
  return {id:createSessionId(isUiCheckStudy(study)),participantId,startedAt:new Date().toISOString(),plan:createBlockPlan(crypto.getRandomValues(new Uint32Array(1))[0],study.heightBlocks!.heightsCm),index:0,consent:false,tutorialCompleted:false,complete:false,responses:[],repeatIndex:previous?(previous.repeatIndex??0)+1:0,previousSessionId:previous?.id};
}
function restart(){
  if(running||selecting||finalizing||state.pending){fail('저장 중이거나 아직 저장하지 못한 답변이 있습니다. 먼저 저장을 마쳐 주세요.');return;}
  if(!confirm('처음부터 다시 해볼까요? 앞서 저장한 답변은 그대로 남고 새 참여 기록이 만들어집니다.'))return;
  try{
    const next=freshSession(state.participantId,state);preserveAndRestart(localStorage,storageKey(),state,next);state=next;runs={};seen.clear();reviewing=false;clearError();introduction.reset();
    $<HTMLInputElement>('g-consent').checked=false;btn('g-start').disabled=true;$<HTMLFormElement>('g-profile-form').reset();$('g-resume').textContent='새 참여로 시작합니다. 앞서 저장한 답변은 그대로 보관됩니다.';
    btn('g-reset-welcome').hidden=true;if(viewer)viewer.robot.visible=false;show('welcome');
  }catch(e){fail(e);}
}
btn('g-restart').onclick=restart;btn('g-reset-welcome').onclick=restart;
btn('g-start').onclick=()=>{
  if(!$<HTMLInputElement>('g-consent').checked)return;state.consent=true;
  try{save();if(state.profile){$<HTMLSelectElement>('g-robotics').value=state.profile.roboticsRelatedExperience;$<HTMLSelectElement>('g-knew').value=state.profile.knewRubiBeforeStudy;$<HTMLSelectElement>('g-exposure').value=state.profile.rubiExposureBeforeStudy;}show('profile');}catch(e){fail(e);}
};
$<HTMLInputElement>('g-consent').onchange=()=>{btn('g-start').disabled=!$<HTMLInputElement>('g-consent').checked;};
$<HTMLFormElement>('g-profile-form').onsubmit=e=>{
  e.preventDefault();const p={roboticsRelatedExperience:selectValue('g-robotics'),knewRubiBeforeStudy:selectValue('g-knew'),rubiExposureBeforeStudy:selectValue('g-exposure'),answeredAtUtc:new Date().toISOString()};
  if(!validProfile(p))return;
  try{
    if(state.profile&&(state.responses.length||state.pending)){
      if(['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy'].some(k=>p[k as keyof ProfileAnswers]!==state.profile![k as keyof ProfileAnswers]))throw new Error('이미 답변을 저장한 참여에서는 시작 전 정보를 바꿀 수 없습니다. 기존 답으로 이어가 주세요.');
      p.answeredAtUtc=state.profile.answeredAtUtc;
    }
    state.profile=p;save();void showIntro();
  }catch(error){fail(error);}
};
btn('g-intro-retry').onclick=()=>void showIntro();
btn('g-begin').onclick=()=>{
  if(!introduction.ready||!introduction.manifest)return;
  state.tutorialCompleted=true;state.introduction={version:introduction.manifest.version,contentId:introduction.manifest.contentId,acknowledgedAtUtc:new Date().toISOString()};
  try{save();void prepare();}catch(e){fail(e);}
};
btn('g-load-retry').onclick=()=>void prepare();btn('g-watch').onclick=()=>startObservation(active);btn('g-stop').onclick=()=>abort?.abort();
btn('g-enough').onclick=()=>{if(!running||btn('g-enough').disabled)return;finishRequested=true;btn('g-enough').disabled=true;$('g-action-hint').textContent='로봇이 도착할 수 있는지 확인하고 있어요. 잠시만 기다려 주세요.';};
btn('g-replay-a').onclick=()=>startObservation(aKey,true);btn('g-replay-b').onclick=()=>startObservation(bKey,true);
btn('g-choose-a').onclick=()=>void choose(aKey);btn('g-choose-b').onclick=()=>void choose(bKey);
btn('g-skip').onclick=()=>{if(confirm('정보가 부족해 이번 문항을 넘길까요? 이 답은 경로 선호로 해석하지 않습니다.'))void choose('skip');};
btn('g-save-retry').onclick=()=>{if(state.pending)void sendPending();else void finalize();};
async function bootstrap(){
  try{
    const res=await fetch(`${import.meta.env.BASE_URL}study.json`,{cache:'no-cache'});if(!res.ok)throw new Error('설문을 불러오지 못했습니다. 새로고침해 주세요.');study=await res.json();scenes=study.guidedScenarios??study.scenarios;
    if(!['draft','released'].includes(study.status)||study.heightBlocks?.version!==BLOCK_RULE||study.heightBlocks.questionsPerHeight!==4||JSON.stringify(study.heightBlocks.detoursMm)!=='[400,600,800,1000,1200,1400,1600]')throw new Error('높이별 설문 설정을 확인해 주세요.');
    const example=createBlockPlan(0,study.heightBlocks.heightsCm);total=questionCount(example);
    scenes=study.heightBlocks.heightsCm.flatMap(h=>study.heightBlocks!.detoursMm.map(d=>({height:h/100,detour:d/1000,speed:.5})));
    scenes.forEach(s=>makeScenario(s.height,s.detour,s.speed));
    $('g-total').textContent=String(total);$('g-pilot-note').hidden=study.status!=='draft';
    let restored:Session|undefined;try{restored=JSON.parse(localStorage.getItem(storageKey())??'null')??undefined;}catch{}
    let valid=false;
    if(restored){
      if(!sessionMatchesPurpose(restored.id,isUiCheckStudy(study))||!validBlockPlan(restored.plan,study.heightBlocks.heightsCm)||!Array.isArray(restored.responses)||restored.index!==restored.responses.length)throw new Error('이 기기의 진행 기록을 확인해야 합니다. 기록을 지우지 말고 연구자에게 알려 주세요.');
      nextBlockQuestion(restored.plan,restored.responses as unknown as BlockAnswer[]);valid=true;
    }
    const participantKey='RUBI_Human_Preference_Path:rubi-hpp-participant';const participantId=localStorage.getItem(participantKey)?JSON.parse(localStorage.getItem(participantKey)!):crypto.randomUUID();localStorage.setItem(participantKey,JSON.stringify(participantId));
    state=valid?restored!:freshSession(participantId);save();if(state.complete){show('complete');return;}if(state.index===total){show('saving');await finalize();return;}
    if(state.index>0)$('g-resume').textContent=`${state.index}개 문항에 답하셨습니다. 이어서 참여할 수 있어요.`;btn('g-reset-welcome').hidden=state.index===0||Boolean(state.pending);show('welcome');
  }catch(e){fail(e);btn('g-start').disabled=true;}
}
if(import.meta.env.DEV){Object.assign(window,{__rubiGuidedTest:()=>({phase,index:state?.index,total,query,plan:state?.plan,sessionId:state?.id,participantId:state?.participantId,repeatIndex:state?.repeatIndex,scenes,scenario,aKey,bKey,seen:[...seen],runs,running,reviewing,selecting,previewEvents,introduction:state?.introduction,introReady:introduction.ready,
  runtimeId:engine?.runtimeId,modelCreateCount,onnxCreateCount,qpos:engine?Array.from(engine.data.qpos):[],qvel:engine?Array.from(engine.data.qvel):[],camera:viewer?.camera.position.toArray(),target:viewer?.controls.target.toArray(),spriteCount:viewer?.world.children.filter(c=>c.type==='Sprite').length,markerNames:viewer?.world.children.map(c=>c.name).filter(Boolean)})});}
void bootstrap();
