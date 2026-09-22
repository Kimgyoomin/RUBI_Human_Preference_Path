const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1u7mXgUFagYepp1oOxVohs5x7i7bCfnBVZbQKKcwOYQA',
  ALLOWED_EXPERIMENTS: ['rubi-hpp-collector-v3', 'rubi-hpp-block-pilot-v7'],
  ALLOWED_STUDY_STATUS: ['draft', 'released'],
  SHEETS: Object.freeze({ trials:'Trials', runs:'Runs', sessions:'Sessions' }),
  VERSION: 'repairable-block-collector-v7',
  MAX_PAYLOAD_CHARS: 120000
});

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || '');
  if (action === 'health') {
    return HtmlService.createHtmlOutput('RUBI Human Preference collector is running.');
  }
  return HtmlService.createHtmlOutput('RUBI Human Preference collector');
}

function doPost(e) {
  let requestId = '';
  try {
    const raw = e && e.parameter ? e.parameter.payload : '';
    if (!raw || raw.length > CONFIG.MAX_PAYLOAD_CHARS) throw new Error('payload가 비어 있거나 너무 큽니다.');
    const request = JSON.parse(raw);
    requestId = id_(request.requestId, 'requestId');
    const result = handleRequest_(request);
    return reply_({source:'rubi-hpp-apps-script',requestId,ok:true,...result});
  } catch (error) {
    return reply_({source:'rubi-hpp-apps-script',requestId,ok:false,message:String(error && error.message ? error.message : error)});
  }
}

function handleRequest_(request) {
  if (!request || typeof request !== 'object') throw new Error('요청 형식이 올바르지 않습니다.');
  const kind = String(request.kind || '');
  const payload = request.payload || {};
  if (kind === 'ping') {
    validateStudy_(payload);
    const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    Object.values(CONFIG.SHEETS).forEach(name=>sheet_(ss,name));
    return {kind,service:'rubi-hpp',experimentId:payload.experimentId,studyStatus:payload.studyStatus,collectorVersion:CONFIG.VERSION};
  }
  if (kind === 'trial') return saveTrial_(payload);
  if (kind === 'profile') return saveProfile_(payload);
  throw new Error('지원하지 않는 요청 종류입니다.');
}

function validateStudy_(p) {
  if (!p || typeof p !== 'object') throw new Error('연구 설정이 없습니다.');
  if (!CONFIG.ALLOWED_EXPERIMENTS.includes(String(p.experimentId || ''))) throw new Error('허용되지 않은 experimentId입니다.');
  if (!CONFIG.ALLOWED_STUDY_STATUS.includes(String(p.studyStatus || ''))) throw new Error('허용되지 않은 studyStatus입니다.');
}

function saveTrial_(p) {
  validateStudy_(p);
  id_(p.submissionId,'submissionId'); id_(p.participantId,'participantId'); id_(p.sessionId || p.participantId,'sessionId'); id_(p.trialId,'trialId');
  if (p.schemaVersion !== 1 || p.consent !== true) throw new Error('schemaVersion 또는 동의 상태가 올바르지 않습니다.');
  if (!['direct','detour','tie','skip','unsure'].includes(p.choice)) throw new Error('choice가 올바르지 않습니다.');
  const s=p.scenario;
  if (!s || !finiteRange_(s.height,0,0.12) || !finiteRange_(s.detour,0.4,2.4) || !finiteRange_(s.speed,0.1,0.5)) throw new Error('scenario 값이 올바르지 않습니다.');
  for (const route of ['direct','detour']) {
    const run=p.runs && p.runs[route];
    if (!run || run.route!==route || run.completed!==true || !isFiniteNumber_(run.duration) || run.duration<=0 || !isFiniteNumber_(run.plannedLength)) {
      throw new Error('두 경로의 완료된 rollout metadata가 필요합니다.');
    }
    if (run.frames) throw new Error('관절 trajectory frames는 Sheets에 전송하지 않습니다.');
  }
  if (!p.runs.direct.id || !p.runs.detour.id || p.runs.direct.id===p.runs.detour.id) throw new Error('실행 ID를 확인해 주세요.');
  for (const route of ['direct','detour']) id_(p.runs[route].id,'rolloutId');
  const blocked=p.protocolVersion==='height-blocks-binary-v7';
  if (p.experimentId==='rubi-hpp-block-pilot-v7' && !blocked) throw new Error('질문 규칙 버전이 다릅니다.');
  if (blocked) validateBlock_(p);
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('저장소가 사용 중입니다. 잠시 후 같은 응답을 다시 제출해 주세요.');
  try {
    const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID), trials=sheet_(ss,CONFIG.SHEETS.trials);
    const duplicate=findExact_(trials,1,p.submissionId);
    const now=new Date().toISOString(), sessionId=p.sessionId || p.participantId, digest=sha256_(JSON.stringify(p));
    if (duplicate && record_(trials,duplicate).payloadSha256!==digest) throw new Error('동일 submissionId의 내용이 다릅니다. 기존 답변을 변경하지 않았습니다.');
    const session=sheet_(ss,CONFIG.SHEETS.sessions),existingSession=findExact_(session,1,sessionId);
    if (existingSession) assertIdentity_(record_(session,existingSession),{participantId:p.participantId,experimentId:p.experimentId});
    const rows=records_(trials).filter(r=>r.sessionId===sessionId);
    if(rows.some(r=>r.trialSequence===p.trialSequence&&r.submissionId!==p.submissionId))throw new Error('같은 참여 회차의 문항에 이미 다른 응답 ID가 있습니다.');
    for(const route of ['direct','detour']){
      const rs=sheet_(ss,CONFIG.SHEETS.runs),old=findExact_(rs,1,p.runs[route].id);
      if(old)assertIdentity_(record_(rs,old),{sessionId,participantId:p.participantId,experimentId:p.experimentId,route,scenarioId:p.runs[route].scenarioId});
    }
    // Idempotent staged write, not a cross-sheet transaction. Repair every link
    // even when Trials already contains the submission (old collector failures).
    ensureColumns_(trials,['protocolVersion','blockIndex','trialInBlock','blockOrderJson','endpointOrder','queryContextJson','saveState']);
    ensureColumns_(session,['profileAnsweredAtUtc','expectedTrials','savedTrials','questionPlanJson']);
    if(!duplicate)appendMapped_(trials,{
      submissionId:p.submissionId,schemaVersion:p.schemaVersion,experimentId:p.experimentId,sessionId,participantId:p.participantId,
      trialId:p.trialId,trialSequence:p.trialSequence ?? '',isPractice:Boolean(p.isPractice),heightM:s.height,detourExtraM:s.detour,
      nominalSpeedMps:s.speed,routeGeometryVersion:s.geometry && s.geometry.version || '',choice:p.choice,skipReason:p.skipReason || '',
      pathA:p.presentation && p.presentation.a || '',pathB:p.presentation && p.presentation.b || '',
      firstPreviewRoute:Array.isArray(p.previewEvents)&&p.previewEvents.length?p.previewEvents[0].route:'',
      labelConditionVersion:p.labelConditionVersion || '',directRolloutId:p.runs.direct.id,detourRolloutId:p.runs.detour.id,
      decisionMs:p.decisionMs ?? '',elapsedTrialMs:p.elapsedTrialMs ?? '',directCoverage:p.previewCoverage && p.previewCoverage.direct,
      detourCoverage:p.previewCoverage && p.previewCoverage.detour,adaptiveVersion:p.adaptiveVersion || '',candidateSetId:p.candidateSetId || '',
      queryReason:p.queryReason || 'fixed_pilot',adaptiveStateBeforeRef:p.adaptiveStateBeforeRef || '',adaptiveStateAfterRef:p.adaptiveStateAfterRef || '',
      clientCreatedAtUtc:p.createdAt || '',serverReceivedAtUtc:now,appCommit:p.appCommit || '',tutorialVersion:p.tutorialVersion || '',
      consentVersion:p.consentVersion || '',consentGranted:true,payloadSha256:digest,
      protocolVersion:p.protocolVersion||'',blockIndex:p.blockIndex??'',trialInBlock:p.trialInBlock??'',blockOrderJson:p.blockOrder||'',endpointOrder:p.endpointOrder||'',queryContextJson:p.queryContext||'',saveState:'pending'
    });
    appendRun_(ss,p,'direct',sessionId,now); appendRun_(ss,p,'detour',sessionId,now);
    ensureSession_(ss,p,sessionId,now);
    updateMapped_(trials,findExact_(trials,1,p.submissionId),{saveState:'complete'});
    const saved=records_(trials).filter(r=>r.sessionId===sessionId&&r.saveState==='complete').length;
    updateMapped_(session,findExact_(session,1,sessionId),{savedTrials:saved});
    SpreadsheetApp.flush();
    return {kind:'trial',submissionId:p.submissionId,duplicate:Boolean(duplicate),collectorVersion:CONFIG.VERSION};
  } finally { lock.releaseLock(); }
}

function appendRun_(ss,p,route,sessionId,now) {
  const s=p.scenario,run=p.runs[route],metric=s.geometry&&s.geometry.metrics?s.geometry.metrics[route]:{};
  const rs=sheet_(ss,CONFIG.SHEETS.runs);
  if(findExact_(rs,1,run.id))return;
  appendMapped_(rs,{
    rolloutId:run.id,schemaVersion:1,experimentId:p.experimentId,sessionId,participantId:p.participantId,scenarioId:run.scenarioId,
    route,heightM:s.height,detourExtraM:s.detour,nominalSpeedMps:s.speed,followerMeanVxMps:run.meanFollowerVxMps ?? '',
    policyMeanVxCommand:run.meanPolicyVxCommand ?? '',distanceXyM:run.distanceAtArrivalM ?? run.actualLength ?? '',
    measurementDurationS:run.movingDurationS ?? run.duration ?? '',achievedMeanXyMps:run.achievedMeanXyMps ?? '',
    bodyForwardMeanMps:run.bodyForwardMeanMps ?? '',progressSpeedMeanMps:run.progressSpeedMeanMps ?? '',
    settleDurationS:run.settleDurationS ?? '',completed:Boolean(run.completed),reason:run.reason || '',plannedLengthM:run.plannedLength ?? '',
    maxTrackingErrorM:run.maxError ?? '',actualYawAbsRad:run.actualYawAbsRad ?? '',plannedMaxCurvaturePerM:metric.maxCurvaturePerM ?? '',
    plannedAbsCurvatureRad:metric.integratedAbsCurvatureRad ?? '',actualClearanceM:'',geometryVersion:s.geometry&&s.geometry.version || '',
    policyProfile:run.profile || '',encoderSha256:p.hashes&&p.hashes['encoder.onnx'] || '',policySha256:p.hashes&&p.hashes['policy.onnx'] || '',
    modelManifestSha256:p.modelManifestSha256 || '',simulatorVersion:run.simulator || '',controllerVersion:p.controllerVersion || '',
    cacheHit:Boolean(run.cacheHit),sourceRolloutId:run.sourceRolloutId || '',computeMs:run.computeMs ?? '',trajectoryRef:'',createdAtUtc:now
  });
}

function ensureSession_(ss,p,sessionId,now) {
  const sheet=sheet_(ss,CONFIG.SHEETS.sessions);let row=findExact_(sheet,1,sessionId);
  if (!row) row=appendMapped_(sheet,{sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,
    protocolVersion:p.protocolVersion || 'collector-v3',tutorialVersion:p.tutorialVersion || '',consentVersion:p.consentVersion || '',
    consentGranted:true,tutorialCompleted:Boolean(p.tutorialCompleted),startedAtUtc:p.sessionStartedAtUtc || p.createdAt || now,
    endedAtUtc:'',status:'started',browserFamily:p.browser&&p.browser.userAgent || '',viewportWidth:p.browser&&p.browser.viewport?p.browser.viewport[0]:'',
    viewportHeight:p.browser&&p.browser.viewport?p.browser.viewport[1]:'',appCommit:p.appCommit || ''});
  if(p.preProfile){
    const old=record_(sheet,row),profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,now);
    for(const key of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc']){
      if(old[key]!==''&&old[key]!==undefined&&old[key]!==profile[key])throw new Error('같은 참여 회차의 사전 경험 정보가 다릅니다.');
    }
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(p.questionPlan))throw new Error('참여 중 질문 계획이 바뀌었습니다.');
    if(old.profileCompletedAtUtc)profile.profileCompletedAtUtc=old.profileCompletedAtUtc;
    updateMapped_(sheet,row,{...profile,profileSchemaVersion:'pre-profile-plain-v2',expectedTrials:p.expectedTrials??'',questionPlanJson:p.questionPlan||''});
    // Profile persisted != survey completed. A resumed/duplicate trial must never
    // change completed status back to started, or invent an end time.
  }
}

function saveProfile_(p) {
  validateStudy_(p); id_(p.sessionId,'sessionId'); id_(p.participantId,'participantId');
  const robot=enum_(p.roboticsRelatedExperience,['yes','no','prefer_not_to_say'],'roboticsRelatedExperience');
  const knew=enum_(p.knewRubiBeforeStudy,['yes','no','unsure','prefer_not_to_say'],'knewRubiBeforeStudy');
  const exposure=enum_(p.rubiExposureBeforeStudy,['none','video_only','in_person','both','unsure','not_asked','prefer_not_to_say'],'rubiExposureBeforeStudy');
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('저장소가 사용 중입니다. 잠시 후 같은 배경 설문을 다시 제출해 주세요.');
  try {
    const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),sheet=sheet_(ss,CONFIG.SHEETS.sessions);
    let row=findExact_(sheet,1,p.sessionId);
    if(row)assertIdentity_(record_(sheet,row),{participantId:p.participantId,experimentId:p.experimentId});
    if(p.protocolVersion==='height-blocks-binary-v7'||p.experimentId==='rubi-hpp-block-pilot-v7'){
      if(!row||p.consent!==true)throw new Error('아직 저장된 참여 기록이 없습니다.');
      const old=record_(sheet,row),rows=records_(sheet_(ss,CONFIG.SHEETS.trials)).filter(r=>r.sessionId===p.sessionId);
      const n=old.expectedTrials;
      if(!Number.isInteger(n)||n!==p.expectedTrials||rows.length!==n||new Set(rows.map(r=>r.trialSequence)).size!==n||rows.some(r=>r.trialSequence<1||r.trialSequence>n||r.saveState!=='complete'))throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
      const runs=sheet_(ss,CONFIG.SHEETS.runs);
      for(const t of rows)for(const key of ['directRolloutId','detourRolloutId'])if(!findExact_(runs,1,t[key]))throw new Error('실행 기록이 누락되어 완료할 수 없습니다. 응답 저장을 다시 시도해 주세요.');
      assertIdentity_(old,{roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,rubiExposureBeforeStudy:exposure});
      if(old.status==='completed')return {kind:'profile',submissionId:p.sessionId,duplicate:true,collectorVersion:CONFIG.VERSION};
    }
    if (!row) {
      appendMapped_(sheet,{sessionId:p.sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,status:'started'});
      row=findExact_(sheet,1,p.sessionId);
    }
    updateMapped_(sheet,row,{
      profileSchemaVersion:p.profileSchemaVersion || 'post-profile-v1',roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,
      rubiExposureBeforeStudy:exposure,profileCompleted:true,profileCompletedAtUtc:record_(sheet,row).profileCompletedAtUtc || p.profileCompletedAtUtc || new Date().toISOString(),
      analysisGroup:analysisGroup_(robot,knew,exposure),groupingRuleVersion:p.groupingRuleVersion || 'cohort-v1',
      endedAtUtc:p.profileCompletedAtUtc || new Date().toISOString(),status:'completed',appCommit:p.appCommit || ''
    });
    SpreadsheetApp.flush();
    return {kind:'profile',submissionId:p.sessionId,duplicate:false,collectorVersion:CONFIG.VERSION};
  } finally { lock.releaseLock(); }
}

function analysisGroup_(robot,knew,exposure) {
  if ([robot,knew,exposure].includes('prefer_not_to_say') || knew==='unsure' || exposure==='unsure') return 'unclassified';
  if ((exposure==='in_person'||exposure==='both')) return robot==='yes'?'G3_robotics_rubi_in_person':'G3_nonrobot_rubi_in_person';
  if (knew==='yes') return robot==='yes'?'G2_robotics_rubi_no_inperson':'G2_nonrobot_rubi_no_inperson';
  if (knew==='no') return robot==='yes'?'G1_robotics_rubi_unaware':'G0_nonrobot_rubi_unaware';
  return 'unclassified';
}

function ensureColumns_(sheet,names){
  const h=headers_(sheet),missing=names.filter(k=>!h.includes(k));if(!missing.length)return;
  const end=h.length+missing.length;if(end>sheet.getMaxColumns())sheet.insertColumnsAfter(sheet.getMaxColumns(),end-sheet.getMaxColumns());
  sheet.getRange(1,h.length+1,1,missing.length).setValues([missing]);
}
function record_(sheet,row){const h=headers_(sheet),v=sheet.getRange(row,1,1,h.length).getValues()[0];return Object.fromEntries(h.map((k,i)=>[k,v[i]]));}
function records_(sheet){const h=headers_(sheet),n=sheet.getLastRow();return n<2?[]:sheet.getRange(2,1,n-1,h.length).getValues().filter(v=>v[0]!=='').map(v=>Object.fromEntries(h.map((k,i)=>[k,v[i]])));}
function assertIdentity_(a,b){for(const k of Object.keys(b))if(a[k]!==b[k])throw new Error('기존 기록의 '+k+' 값이 다릅니다. 기존 데이터는 덮어쓰지 않습니다.');}
function profileRecord_(p,answeredAt,now){
  const robot=enum_(p.roboticsRelatedExperience,['yes','no','prefer_not_to_say'],'roboticsRelatedExperience');
  const knew=enum_(p.knewRubiBeforeStudy,['yes','no','unsure','prefer_not_to_say'],'knewRubiBeforeStudy');
  const exposure=enum_(p.rubiExposureBeforeStudy,['none','video_only','in_person','both','unsure','prefer_not_to_say'],'rubiExposureBeforeStudy');
  if(typeof answeredAt!=='string'||!isFinite(Date.parse(answeredAt)))throw new Error('사전 질문 응답 시각을 확인해 주세요.');
  return {roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,rubiExposureBeforeStudy:exposure,profileAnsweredAtUtc:answeredAt,
    profileCompleted:true,profileCompletedAtUtc:now,analysisGroup:analysisGroup_(robot,knew,exposure),groupingRuleVersion:'cohort-v1'};
}
function validateBlock_(p){
  const plan=p.questionPlan;
  if(p.experimentId!=='rubi-hpp-block-pilot-v7'||!['direct','detour','skip'].includes(p.choice)||p.adaptiveVersion!=='endpoint-midpoint-recheck-v1'||p.candidateSetId!=='detour-400-1600-step200-v1')throw new Error('높이별 질문의 응답 형식이 다릅니다.');
  if(!plan||plan.version!==p.adaptiveVersion||!Array.isArray(plan.blocks)||plan.blocks.length<1||plan.blocks.length>4||p.expectedTrials!==plan.blocks.length*4)throw new Error('질문 계획이 없습니다.');
  if(!Number.isInteger(p.trialSequence)||p.trialSequence<1||p.trialSequence>p.expectedTrials||p.blockIndex!==Math.floor((p.trialSequence-1)/4)+1||p.trialInBlock!==(p.trialSequence-1)%4+1)throw new Error('문항 순서가 다릅니다.');
  const heights=plan.blocks.map(b=>b.heightCm),block=plan.blocks[p.blockIndex-1];
  if(new Set(heights).size!==heights.length||heights.some(h=>![5,7,9,11].includes(h))||JSON.stringify(heights)!==JSON.stringify(p.blockOrder)||Math.abs(block.heightCm/100-p.scenario.height)>1e-9||p.scenario.speed!==.5)throw new Error('높이 또는 속도 설정이 다릅니다.');
  if(![400,600,800,1000,1200,1400,1600].some(d=>Math.abs(d/1000-p.scenario.detour)<1e-9)||!p.queryContext||!Array.isArray(p.queryContext.prior)||p.queryContext.prior.length!==p.trialInBlock-1)throw new Error('거리 후보 또는 질문 이력이 다릅니다.');
  if(!p.presentation||!['direct','detour'].includes(p.presentation.a)||p.presentation.b!==(p.presentation.a==='direct'?'detour':'direct')||p.presentation.a!==block.aRoutes[p.trialInBlock-1])throw new Error('A/B 경로 배정이 다릅니다.');
  if(!p.preProfile)throw new Error('사전 경험 응답이 없습니다.');profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,new Date().toISOString());
}

function sheet_(ss,name){const s=ss.getSheetByName(name);if(!s)throw new Error(name+' 시트를 찾을 수 없습니다.');return s;}
function headers_(sheet){return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);}
function appendMapped_(sheet,record){
  const h=headers_(sheet),last=sheet.getLastRow();let row=2;
  if(last>=2){const keys=sheet.getRange(2,1,last-1,1).getValues();for(let i=keys.length-1;i>=0;i--)if(keys[i][0]!==''){row=i+3;break;}}
  if(row>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),row-sheet.getMaxRows());
  const previous=sheet.getRange(row,1,1,h.length).getValues()[0];
  if(previous.some(v=>v!==''&&v!==false))throw new Error('ID가 없는 데이터 행이 있습니다. 기존 행을 덮어쓰지 않았습니다.');
  sheet.getRange(row,1,1,h.length).setValues([h.map(k=>cell_(record[k]))]);return row;
}
function updateMapped_(sheet,row,record){const h=headers_(sheet),range=sheet.getRange(row,1,1,h.length),values=range.getValues()[0];h.forEach((k,i)=>{if(Object.prototype.hasOwnProperty.call(record,k))values[i]=cell_(record[k]);});range.setValues([values]);}
function findExact_(sheet,column,value){if(sheet.getLastRow()<2)return 0;const found=sheet.getRange(2,column,sheet.getLastRow()-1,1).createTextFinder(String(value)).matchEntireCell(true).findNext();return found?found.getRow():0;}
function cell_(v){if(v===undefined||v===null)return '';if(typeof v==='object')v=JSON.stringify(v);if(typeof v==='string'&&/^[=+@-]/.test(v))return "'"+v;return v;}
function id_(v,label){if(typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(v))throw new Error(label+'가 올바르지 않습니다.');return v;}
function enum_(v,allowed,label){if(!allowed.includes(v))throw new Error(label+'가 올바르지 않습니다.');return v;}
function isFiniteNumber_(v){return typeof v==='number'&&isFinite(v);}
function finiteRange_(v,lo,hi){return isFiniteNumber_(v)&&v>=lo&&v<=hi;}
function sha256_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function reply_(payload){
  const json=JSON.stringify(payload).replace(/<\//g,'<\\/');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>top.postMessage('+json+',"*");<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
