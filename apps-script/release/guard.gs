/** Appended to the tested v7 collector by tools/build-release-collector.mjs.
 * Main dataset is pinned by the deployer, never selected by a client file ID.
 * Owner-only helpers end in underscore: neither doPost routes nor google.script.run RPC targets.
 */
const RELEASE = Object.freeze({
  VERSION: 'isolated-main-collector-v8',
  MAIN_EXPERIMENT: 'rubi-hpp-main-v1',
  MAIN_SHEET: '1Az6wHrRmSTjS6PeUjm2dzwI406Hnd0fyYj_JzkYdg-4',
  OPEN_PROPERTY: 'RUBI_MAIN_COLLECTION_OPEN',
  LABEL_VERSION: 'same-policy-intro-blocks-explicit-binary-v2',
  ENCODER_SHA: '8d04fa39832111a7c52dc012cc919afb387e17301799a863830c4fa83ab9d1ed',
  POLICY_SHA: 'bb7c45952e7471975c024127f8c8814f997ef1194e56f6c271f3834343939732'
});
function releaseTarget_(p) {
  return p.experimentId === RELEASE.MAIN_EXPERIMENT ? RELEASE.MAIN_SHEET : CONFIG.SPREADSHEET_ID;
}
function mainOpen_() {
  return PropertiesService.getScriptProperties().getProperty(RELEASE.OPEN_PROPERTY) === 'true';
}
function mainSchema_() {
  const ss = SpreadsheetApp.openById(RELEASE.MAIN_SHEET);
  const required = {
    Trials:['submissionId','sessionId','participantId','trialSequence','choice','heightM','detourExtraM','directRolloutId','detourRolloutId','protocolVersion','blockIndex','trialInBlock','queryContextJson','saveState'],
    Runs:['rolloutId','sessionId','participantId','route','completed','plannedLengthM'],
    Sessions:['sessionId','participantId','experimentId','protocolVersion','status','expectedTrials','savedTrials','questionPlanJson','profileAnsweredAtUtc']
  };
  Object.keys(required).forEach(name => {
    const h=headers_(sheet_(ss,name));
    if(new Set(h).size!==h.length || required[name].some(k=>!h.includes(k))) throw new Error('본 조사 시트의 열 구성이 맞지 않습니다.');
  });
  return ss;
}
function releaseRequest_(request) {
  const p=request && request.payload;
  if (!request || !p || !['ping','trial','profile'].includes(request.kind)) throw new Error('지원하지 않는 요청입니다.');
  const main=p.experimentId===RELEASE.MAIN_EXPERIMENT;
  validateStudy_(p);
  if ((main && p.studyStatus!=='released') || (!main && p.studyStatus!=='draft')) throw new Error('본 조사와 파일럿 저장 조건이 다릅니다.');
  if (request.kind==='ping') {
    if(main)mainSchema_();
    const result=handleRequest_(request);
    return {...result,releaseVersion:RELEASE.VERSION,datasetTag:main?'main-v1':'pilot',schemaReady:true,collectionOpen:main?mainOpen_():true};
  }
  if(main){
    if(!mainOpen_())throw new Error('지금은 본 조사 응답을 받지 않습니다.');
    if(p.protocolVersion!=='height-blocks-binary-v7'||p.expectedTrials!==16||p.consent!==true)throw new Error('승인된 본 조사 형식이 아닙니다.');
    if(request.kind==='trial')validateMainTrial_(p);
  }
  return {...handleRequest_(request),releaseVersion:RELEASE.VERSION,datasetTag:main?'main-v1':'pilot'};
}
function validateMainTrial_(p){
  validateBlock_(p);
  const plan=p.questionPlan;
  if(plan.blocks.length!==4||!Number.isInteger(plan.seed)||plan.seed<0||plan.seed>0xffffffff||
     JSON.stringify(plan)!==JSON.stringify(releaseScheduler_.createBlockPlan(plan.seed)))throw new Error('본 조사 질문 계획이 맞지 않습니다.');
  if(p.labelConditionVersion!==RELEASE.LABEL_VERSION||p.isPractice!==false||p.consentVersion!=='consent-v1')throw new Error('문항 표시 조건이나 동의 버전이 다릅니다.');
  if(!p.hashes||p.hashes['encoder.onnx']!==RELEASE.ENCODER_SHA||p.hashes['policy.onnx']!==RELEASE.POLICY_SHA||
     typeof p.tutorialVersion!=='string'||!/^same-policy-intro-v1:[a-f0-9]{64}$/.test(p.tutorialVersion))throw new Error('모델·소개 영상 버전을 확인해 주세요.');
  if(p.choice==='skip' ? p.skipReason!=='insufficient_information' : Boolean(p.skipReason))throw new Error('문항 건너뛰기 사유가 다릅니다.');
  if(!p.scenario||!Number.isFinite(p.scenario.height)||!Number.isFinite(p.scenario.detour))throw new Error('지형 값이 올바르지 않습니다.');
  for(const route of ['direct','detour']){
    const run=p.runs && p.runs[route],expected=route==='direct'?6:6+p.scenario.detour;
    if(!run||!Number.isFinite(run.plannedLength)||Math.abs(run.plannedLength-expected)>1e-6||
       !Number.isFinite(run.duration)||run.duration<=0||run.duration>120)throw new Error('경로 길이 또는 실행 정보가 올바르지 않습니다.');
  }
  const ss=mainSchema_(),trials=sheet_(ss,'Trials'),sessions=sheet_(ss,'Sessions');
  const own=records_(trials).filter(r=>r.sessionId===p.sessionId);
  const earlier=own.filter(r=>r.trialSequence<p.trialSequence).sort((a,b)=>a.trialSequence-b.trialSequence);
  if(earlier.length!==p.trialSequence-1||earlier.some(r=>r.saveState!=='complete'))throw new Error('앞선 문항의 저장 확인이 필요합니다.');
  const history=earlier.map(r=>({submissionId:r.submissionId,trialSequence:r.trialSequence,choice:r.choice,scenario:{height:r.heightM,detour:r.detourExtraM}}));
  const q=releaseScheduler_.nextBlockQuestion(plan,history);
  if(!q||q.sequence!==p.trialSequence||q.heightCm/100!==p.scenario.height||q.detourMm/1000!==p.scenario.detour||
     q.aRoute!==p.presentation.a||q.reason!==p.queryReason||q.endpointOrder!==p.endpointOrder||
     JSON.stringify(q.context)!==JSON.stringify(p.queryContext))throw new Error('이전 응답과 다음 질문 조건이 맞지 않습니다.');
  const row=findExact_(sessions,1,p.sessionId);
  if(row){
    const old=record_(sessions,row);
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId});
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(plan))throw new Error('참여 도중 질문 계획을 바꿀 수 없습니다.');
    const profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,new Date().toISOString());
    for(const k of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc'])
      if(old[k]!==''&&old[k]!==undefined&&old[k]!==profile[k])throw new Error('사전 경험 응답을 변경할 수 없습니다.');
    if(old.status==='completed'&&!own.some(r=>r.submissionId===p.submissionId))throw new Error('이미 완료된 참여입니다.');
  }
}
// Trailing underscore prevents google.script.run exposure. Run from the owner's editor only.
function inspectMainCollection_(){
  const ss=mainSchema_();
  const result={experimentId:RELEASE.MAIN_EXPERIMENT,sheetId:RELEASE.MAIN_SHEET,open:mainOpen_(),
    trialRows:records_(sheet_(ss,'Trials')).length,runRows:records_(sheet_(ss,'Runs')).length,sessionRows:records_(sheet_(ss,'Sessions')).length};
  console.log(JSON.stringify(result));return result;
}
function openMainCollection_(){
  const ss=mainSchema_();
  if(RELEASE.MAIN_SHEET===CONFIG.SPREADSHEET_ID)throw new Error('본 조사와 파일럿 저장소가 같습니다.');
  for(const name of ['Trials','Runs','Sessions'])if(records_(sheet_(ss,name)).some(r=>r.experimentId!==RELEASE.MAIN_EXPERIMENT))throw new Error('본 조사 외의 기록이 있습니다.');
  PropertiesService.getScriptProperties().setProperty(RELEASE.OPEN_PROPERTY,'true');
  return inspectMainCollection_();
}
function pauseMainCollection_(){
  PropertiesService.getScriptProperties().setProperty(RELEASE.OPEN_PROPERTY,'false');
  return inspectMainCollection_();
}
