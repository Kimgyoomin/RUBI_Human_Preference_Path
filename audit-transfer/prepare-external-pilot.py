from pathlib import Path
import json, hashlib, sys
ROOT=Path(sys.argv[1] if len(sys.argv)>1 else '.')
def read(p):return (ROOT/p).read_text()
def write(p,s):
 (ROOT/p).parent.mkdir(parents=True,exist_ok=True);(ROOT/p).write_text(s)
def replace(p,a,b,count=1):
 s=read(p)
 if s.count(a)!=count:raise RuntimeError(f'{p}: expected {count} matches: {a[:90]}')
 write(p,s.replace(a,b))
frozen=['src/core/height-block-study-v9.ts','src/core/height-block-study.ts','src/core/scenario.ts','src/core/terrain-controller.ts','src/runtime/physics.ts','src/runtime/viewer.ts','apps-script/Code.gs','apps-script/release/guard.gs','tools/build-no-repeat-collector.mjs']
before={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in frozen}
old=json.loads(read('public/study.json'))
assert old['protocolVersion']=='height-blocks-no-repeat-v9' and old['collectionPhase']=='owner-ui-check-v1'
write('public/study.ui-check-v9.json',read('public/study.json'))
old['collectionPhase']='external-pilot-v1'
write('public/study.json',json.dumps(old,ensure_ascii=False,indent=2)+'\n')
write('src/ui-session.ts','''/** Collection-purpose labels never grant admin access or enable server writes. */
export const UI_CHECK_PHASE = 'owner-ui-check-v1';
export const UI_CHECK_PREFIX = 'ui-check-';
export const EXTERNAL_PILOT_PHASE = 'external-pilot-v1';
export const EXTERNAL_PILOT_PREFIX = 'pilot-';
export type CollectionPurpose = typeof UI_CHECK_PHASE | typeof EXTERNAL_PILOT_PHASE | 'survey';
type PurposeInput = boolean | CollectionPurpose;
export function isUiCheckStudy(study:{collectionPhase?:string}):boolean {
  return study.collectionPhase === UI_CHECK_PHASE;
}
export function isExternalPilotStudy(study:{collectionPhase?:string}):boolean {
  return study.collectionPhase === EXTERNAL_PILOT_PHASE;
}
export function collectionPurpose(study:{collectionPhase?:string}):CollectionPurpose {
  if(isUiCheckStudy(study))return UI_CHECK_PHASE;
  if(isExternalPilotStudy(study))return EXTERNAL_PILOT_PHASE;
  if(study.collectionPhase===undefined)return 'survey';
  throw new Error('설문 수집 단계 설정을 확인해 주세요.');
}
function normalize(p:PurposeInput):CollectionPurpose {
  if(p===true)return UI_CHECK_PHASE;
  if(p===false)return 'survey';
  if(p===UI_CHECK_PHASE||p===EXTERNAL_PILOT_PHASE||p==='survey')return p;
  throw new Error('유효하지 않은 수집 단계입니다.');
}
function prefix(p:PurposeInput):string {
  const purpose=normalize(p);
  return purpose===UI_CHECK_PHASE?UI_CHECK_PREFIX:purpose===EXTERNAL_PILOT_PHASE?EXTERNAL_PILOT_PREFIX:'';
}
export function collectionStorageKey(experimentId:string,protocol:string,purpose:PurposeInput):string {
  const p=normalize(purpose);
  return `RUBI_Human_Preference_Path:${experimentId}:${protocol}${p==='survey'?'':':'+p}`;
}
export function createSessionId(purpose:PurposeInput,uuid:string=crypto.randomUUID()):string {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))throw new Error('참여 ID를 만들지 못했습니다.');
  return prefix(purpose)+uuid;
}
export function sessionMatchesPurpose(id:unknown,purpose:PurposeInput):boolean {
  return typeof id==='string' && new RegExp('^'+prefix(purpose)+'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','i').test(id);
}
''')
replace('src/runtime/study-selection.ts','collectionStorageKey,isUiCheckStudy','collectionStorageKey,collectionPurpose')
replace('src/runtime/study-selection.ts','collectionStorageKey(s.id,s.protocolVersion,isUiCheckStudy(s))','collectionStorageKey(s.id,s.protocolVersion,collectionPurpose(s))')
replace('src/runtime/study-selection.ts','  return unfinished(legacy)?legacy:current;','  // Never resume a developer check as an external participant. Explicit legacy link remains available.\n  if(collectionPurpose(current)!==collectionPurpose(legacy))return current;\n  return unfinished(legacy)?legacy:current;')
replace('src/runtime/study-selection.ts',"    const current=await read(new URL('study.json',base));",'''    const query=new URLSearchParams(location.search);
    const collection=query.get('collection');
    if(collection && !['survey','ui-check'].includes(collection))throw new Error('설문 수집 단계 주소를 확인해 주세요.');
    // This selects an excluded test dataset label, not a researcher screen or privileged action.
    const current=await read(new URL(collection==='ui-check'?'study.ui-check-v9.json':'study.json',base));''')
replace('src/participant.ts','isUiCheckStudy,collectionStorageKey,createSessionId,sessionMatchesPurpose','isUiCheckStudy,isExternalPilotStudy,collectionPurpose,collectionStorageKey,createSessionId,sessionMatchesPurpose')
replace('src/participant.ts','collectionStorageKey(study.id,UX_PROTOCOL,isUiCheckStudy(study))','collectionStorageKey(study.id,UX_PROTOCOL,collectionPurpose(study))')
replace('src/participant.ts','createSessionId(isUiCheckStudy(study))','createSessionId(collectionPurpose(study))')
replace('src/participant.ts','sessionMatchesPurpose(restored.id,isUiCheckStudy(study))','sessionMatchesPurpose(restored.id,collectionPurpose(study))')
replace('src/participant.ts','<nav class="g-steps"','<div id="g-external-pilot-note" class="g-pilot-note" hidden>시제품 경로 선택 설문 · 응답은 시제품 평가와 로봇의 경로 선호 연구에 사용됩니다.</div>\n<nav class="g-steps"')
replace('src/participant.ts','<p class="g-muted">앞서 저장한 답변은 그대로 남고, 새 참여 기록이 만들어집니다.</p>','<p id="g-restart-note" class="g-muted">앞서 저장한 답변은 그대로 남고, 새 참여 기록이 만들어집니다.</p>')
replace('src/participant.ts',"  $('g-ui-check-note').hidden=!isUiCheckStudy(study);",'''  $('g-external-pilot-note').hidden=!isExternalPilotStudy(study);
  btn('g-restart').hidden=isExternalPilotStudy(study);
  $('g-restart-note').textContent=isExternalPilotStudy(study)?'참여해 주셔서 감사합니다. 같은 설문에는 한 번만 참여해 주세요.':'앞서 저장한 답변은 그대로 남고, 새 참여 기록이 만들어집니다.';
  $('g-ui-check-note').hidden=!isUiCheckStudy(study);''')
replace('tests/no-repeat-v9.test.mjs',"const current=JSON.parse(fs.readFileSync('public/study.json')),legacy=","const current=JSON.parse(fs.readFileSync('public/study.ui-check-v9.json')),legacy=")
replace('tools/public-release-smoke.mjs',"import {collectionStorageKey} from '../src/ui-session.ts';","import {collectionStorageKey,EXTERNAL_PILOT_PHASE} from '../src/ui-session.ts';")
replace('tools/public-release-smoke.mjs',"assert.equal(main.collectionPhase,'owner-ui-check-v1');","assert.equal(main.collectionPhase,'external-pilot-v1');")
replace('tools/public-release-smoke.mjs'," assert.equal(await page.locator('#g-ui-check-note').isVisible(),true);\n const uiId=(await page.locator('#g-ui-check-id').textContent()).replace('점검 ID: ','');\n assert.match(uiId,/^ui-check-[0-9a-f-]{36}$/);\n await page.screenshot({path:'artifacts/owner-ui-check-welcome.png',fullPage:true});",''' assert.equal(await page.locator('#g-ui-check-note').isVisible(),false);
 assert.equal(await page.locator('#g-external-pilot-note').isVisible(),true);
 assert.equal(await page.locator('#g-restart').isVisible(),false);
 const pilotKey=collectionStorageKey(main.id,main.protocolVersion,EXTERNAL_PILOT_PHASE);
 const uiId=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).id,pilotKey);
 assert.match(uiId,/^pilot-[0-9a-f-]{36}$/);
 await page.screenshot({path:'artifacts/external-pilot-welcome.png',fullPage:true});''')
replace('tools/public-release-smoke.mjs'," assert.equal((await page.locator('#g-ui-check-id').textContent()).replace('점검 ID: ',''),uiId);"," assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).id,pilotKey),uiId);\n assert.equal(await page.locator('#g-ui-check-note').isVisible(),false);")
replace('tools/public-release-smoke.mjs'," await legacyPage.goto(base,{waitUntil:'networkidle'});"," await legacyPage.goto(base+'?protocol=legacy-v7',{waitUntil:'networkidle'});")
replace('tools/public-release-smoke.mjs','uiCheckSessionTagged:true','externalPilotSessionTagged:true')
replace('tools/public-release-smoke.mjs',' await legacyPage.close();\n await writeFile',''' await legacyPage.close();
 const switchPage=await browser.newPage();instrument(switchPage,'purpose separation');
 const switchWrites=[];await routeCollector(switchPage,releaseMock(),switchWrites);
 await switchPage.goto(base+'?collection=ui-check&protocol=current',{waitUntil:'networkidle'});
 await switchPage.locator('#g-welcome').waitFor({state:'visible'});
 const checkId=(await switchPage.locator('#g-ui-check-id').textContent()).replace('점검 ID: ','');
 assert.match(checkId,/^ui-check-/);
 const checkKey=collectionStorageKey(main.id,main.protocolVersion,true);
 const beforeCheck=await switchPage.evaluate(k=>localStorage.getItem(k),checkKey);
 await switchPage.goto(base,{waitUntil:'networkidle'});await switchPage.locator('#g-welcome').waitFor({state:'visible'});
 assert.equal(await switchPage.locator('#g-ui-check-note').isVisible(),false);
 assert.equal(await switchPage.locator('#g-external-pilot-note').isVisible(),true);
 assert.equal(await switchPage.evaluate(k=>localStorage.getItem(k),checkKey),beforeCheck);
 const pilotId=await switchPage.evaluate(k=>JSON.parse(localStorage.getItem(k)).id,collectionStorageKey(main.id,main.protocolVersion,EXTERNAL_PILOT_PHASE));
 assert.match(pilotId,/^pilot-/);assert.notEqual(pilotId,checkId);
 await switchPage.setViewportSize({width:390,height:844});
 await switchPage.screenshot({path:'artifacts/external-pilot-welcome-mobile.png',fullPage:true});
 assert.equal(switchWrites.length,0);await switchPage.close();
 await writeFile''')
write('tests/external-pilot.test.mjs','''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectionPurpose,collectionStorageKey,createSessionId,sessionMatchesPurpose,EXTERNAL_PILOT_PHASE,isExternalPilotStudy} from '../src/ui-session.ts';
import {chooseStudy} from '../src/runtime/study-selection.ts';
import * as v9 from '../src/core/height-block-study-v9.ts';
import {noRepeatMock,noRepeatPayload} from './fixtures/no-repeat-mock.mjs';
const current=JSON.parse(fs.readFileSync('public/study.json'));
const check=JSON.parse(fs.readFileSync('public/study.ui-check-v9.json'));
const legacy=JSON.parse(fs.readFileSync('public/study.legacy-v7.json'));
const uuid='00000000-0000-4000-8000-000000000012';
test('external launch changes purpose, never questions, API, policies or collector requirements',()=>{
 const {collectionPhase:cp,...c}=current,{collectionPhase:dp,...d}=check;
 assert.equal(cp,EXTERNAL_PILOT_PHASE);assert.equal(dp,'owner-ui-check-v1');assert.deepEqual(c,d);
 assert.equal(collectionPurpose(current),EXTERNAL_PILOT_PHASE);assert.ok(isExternalPilotStudy(current));
 assert.notEqual(collectionStorageKey(current.id,current.protocolVersion,EXTERNAL_PILOT_PHASE),collectionStorageKey(check.id,check.protocolVersion,true));
 assert.equal(createSessionId(EXTERNAL_PILOT_PHASE,uuid),'pilot-'+uuid);
 assert.ok(sessionMatchesPurpose('pilot-'+uuid,EXTERNAL_PILOT_PHASE));
 assert.ok(!sessionMatchesPurpose('ui-check-'+uuid,EXTERNAL_PILOT_PHASE));
 assert.ok(!sessionMatchesPurpose('pilot-'+uuid,true));
 assert.throws(()=>collectionPurpose({collectionPhase:'typo'}));
});
test('no automatic migration of old developer sessions; explicit test route still resumes',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null};
 const oldRaw=JSON.stringify({id:'ui-check-'+uuid,consent:true,complete:false,responses:[{}]});
 for(const s of [check,legacy])map.set(collectionStorageKey(s.id,s.protocolVersion,true),oldRaw);
 assert.equal(chooseStudy(current,legacy,store,null),current);
 assert.equal(chooseStudy(current,legacy,store,'legacy-v7'),legacy);
 assert.equal(chooseStudy(check,legacy,store,'current'),check);
 assert.equal(map.get(collectionStorageKey(check.id,check.protocolVersion,true)),oldRaw);
});
test('unchanged deployed v9 collector accepts pilot-labelled 16/32 completion and rejects closed intake',()=>{
 const m=noRepeatMock(),plan=v9.createBlockPlan(45),history=[];
 for(let i=0;i<16;i++){
  const p={...noRepeatPayload(v9.nextBlockQuestion(plan,history),plan),sessionId:createSessionId(EXTERNAL_PILOT_PHASE,uuid)};
  m.call('trial',p);m.call('trial',p);history.push(p);
 }
 const p=history.at(-1);
 m.call('profile',{experimentId:p.experimentId,studyStatus:'released',protocolVersion:p.protocolVersion,sessionId:p.sessionId,participantId:p.participantId,consent:true,expectedTrials:16,...p.preProfile});
 assert.equal(m.rows('Trials').length,16);assert.equal(m.rows('Runs').length,32);assert.equal(m.rows('Sessions')[0].status,'completed');
 for(const t of ['Trials','Runs','Sessions'])assert.ok(m.rows(t).every(r=>r.sessionId==='pilot-'+uuid));
 const closed=noRepeatMock({properties:{}});assert.throws(()=>closed.call('trial',history[0]));assert.equal(closed.writes,0);
});
''')
write('docs/EXTERNAL_PILOT_V9_KO.md','''# 시제품 경로 선택 설문 — 외부 파일럿 v9

## 범위 고정
질문 프로토콜은 height-blocks-no-repeat-v9 그대로다. 5·7·9·11 cm, 높이당 4문항, 0.4–2.4 m 후보, 0.2 m 간격, 같은 높이 내 거리 재질문 없음. 로봇·ONNX·카메라·제어기·소개 제작 조건·문항 안내는 바꾸지 않았다. 최종 검증된 모집이나 비용 정확도를 보장하는 단계가 아니라 시제품 외부 파일럿이다.

## 참가자 링크
https://kimgyoomin.github.io/RUBI_Human_Preference_Path/

기본 주소는 external-pilot-v1로 열리고 참가자에게 개발자 점검 ID/제외 안내/연구자 화면을 표시하지 않는다. 초기 참가자에게 기존 v7 또는 개발자 v9 진행을 자동 연결하지 않는다. 참가자는 같은 브라우저에서 같은 참여를 재개한다. 완료 후 반복참여 버튼은 숨기며, 인증을 추가한 것은 아니므로 여러 기기 참여를 완전히 막지는 않는다.

## 점검과 외부 응답 분리
- 외부 파일럿: sessionId = pilot-<UUID>, 별도 localStorage key suffix :external-pilot-v1.
- 개발자 점검: ui-check-<UUID>, 기존 localStorage 및 응답 보존. 분석에 합치지 않는다.
- 추가 점검 주소: https://kimgyoomin.github.io/RUBI_Human_Preference_Path/?collection=ui-check&protocol=current
- v7 점검 복구: ?protocol=legacy-v7. 이는 연구자 권한 부여가 아니라 기록 구분용 설문이다.
- ID 접두사로 구분하는 것은 실제 사람/진위 인증이 아니다. 외부 파일럿에는 v9이며 pilot-로 시작하는 세션만 포함 후보로 삼는다. 완료 여부/건너뛰기/집단별 제외 기준은 분석 계획에서 별도로 정한다.

## 저장소·배포
기존 비공개 Google Sheets 파일 ID 1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4를 그대로 사용한다. 외부 파일럿 용도로 파일명/README/수집현황만 갱신하며 Trials/Runs/Sessions/Estimates 원본은 변경하지 않는다.
내부 experimentId=rubi-hpp-main-v1, datasetTag=main-v1, v9 수집기, /exec 주소를 그대로 사용한다. 내부 이름 main은 통계적 본 조사 확정이라는 뜻이 아니다.
Code.gs 변경·재배포 불필요. RUBI_MAIN_COLLECTION_OPEN=true를 유지한다. 중지하려면 소유자가 같은 Apps Script 속성을 false로 바꾸면 된다.

## 공유 안내 예시
두 다리로 걷는 로봇 RUBI의 경로 선택 설문입니다. 소개 영상을 본 뒤, 같은 목적지로 가는 두 길 중 로봇에게 지정할 길을 선택해 주세요. 로봇 관련 지식 없이 참여할 수 있으며 총 16문항입니다. PC의 Chrome 사용을 권장합니다. 이름·이메일은 묻지 않으며 참여 안내를 읽고 동의한 뒤 진행해 주세요. 같은 설문에는 한 번만 참여해 주세요.

## 운영 원칙
한 파일럿 배치 동안 질문·소개·거리 범위를 고정한다. v7/v9/개발자 점검을 섞어서 비용을 계산하지 않는다. 비용 추정은 수집 후 별도로 한다. 시트는 공개하지 말고 참가자에게 웹페이지 링크만 전달한다. 연구윤리/모집 절차의 승인 여부는 이 코드 변경으로 결정하거나 보장하지 않는다.

## 검증
배포 전 단위검사와 공개 빌드의 실제 WASM 보행/첫 묶음/저장 복구/목적 전환 검사를 수행한다. 자동검사의 Google 쓰기는 메모리 모형으로 대체하며 실제 응답을 만들지 않는다. 배포 후에는 공개 첫 화면과 읽기 전용 ping만 검사하고 실제 참가자의 완료 성공을 대신 주장하지 않는다. 실패는 모집 전 해결한다.
''')
assert before=={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in frozen}
print('EXTERNAL_PILOT_PATCH_APPLIED; immutable scientific/runtime/collector files unchanged')
