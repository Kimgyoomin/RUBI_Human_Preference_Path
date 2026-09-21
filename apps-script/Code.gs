const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1u7mXgUFagYepp1oOxVohs5x7i7bCfnBVZbQKKcwOYQA',
  ALLOWED_EXPERIMENTS: ['rubi-hpp-collector-v3'],
  ALLOWED_STUDY_STATUS: ['draft', 'released'],
  SHEETS: Object.freeze({ trials:'Trials', runs:'Runs', sessions:'Sessions' }),
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
    return {kind,service:'rubi-hpp',experimentId:payload.experimentId,studyStatus:payload.studyStatus};
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
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('저장소가 사용 중입니다. 잠시 후 같은 응답을 다시 제출해 주세요.');
  try {
    const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID), trials=sheet_(ss,CONFIG.SHEETS.trials);
    const duplicate=findExact_(trials,1,p.submissionId);
    if (duplicate) return {kind:'trial',submissionId:p.submissionId,duplicate:true};

    const now=new Date().toISOString(), sessionId=p.sessionId || p.participantId, digest=sha256_(JSON.stringify(p));
    appendMapped_(trials,{
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
      consentVersion:p.consentVersion || '',consentGranted:true,payloadSha256:digest
    });
    appendRun_(ss,p,'direct',sessionId,now); appendRun_(ss,p,'detour',sessionId,now);
    ensureSession_(ss,p,sessionId,now);
    SpreadsheetApp.flush();
    return {kind:'trial',submissionId:p.submissionId,duplicate:false};
  } finally { lock.releaseLock(); }
}

function appendRun_(ss,p,route,sessionId,now) {
  const s=p.scenario,run=p.runs[route],metric=s.geometry&&s.geometry.metrics?s.geometry.metrics[route]:{};
  appendMapped_(sheet_(ss,CONFIG.SHEETS.runs),{
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
  const sheet=sheet_(ss,CONFIG.SHEETS.sessions),row=findExact_(sheet,1,sessionId);
  if (row) return;
  appendMapped_(sheet,{sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,
    protocolVersion:p.protocolVersion || 'collector-v3',tutorialVersion:p.tutorialVersion || '',consentVersion:p.consentVersion || '',
    consentGranted:true,tutorialCompleted:Boolean(p.tutorialCompleted),startedAtUtc:p.sessionStartedAtUtc || p.createdAt || now,
    endedAtUtc:'',status:'started',browserFamily:p.browser&&p.browser.userAgent || '',viewportWidth:p.browser&&p.browser.viewport?p.browser.viewport[0]:'',
    viewportHeight:p.browser&&p.browser.viewport?p.browser.viewport[1]:'',appCommit:p.appCommit || ''});
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
    if (!row) {
      appendMapped_(sheet,{sessionId:p.sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,status:'started'});
      row=sheet.getLastRow();
    }
    updateMapped_(sheet,row,{
      profileSchemaVersion:p.profileSchemaVersion || 'post-profile-v1',roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,
      rubiExposureBeforeStudy:exposure,profileCompleted:true,profileCompletedAtUtc:p.profileCompletedAtUtc || new Date().toISOString(),
      analysisGroup:analysisGroup_(robot,knew,exposure),groupingRuleVersion:p.groupingRuleVersion || 'cohort-v1',
      endedAtUtc:p.profileCompletedAtUtc || new Date().toISOString(),status:'completed',appCommit:p.appCommit || ''
    });
    SpreadsheetApp.flush();
    return {kind:'profile',submissionId:p.sessionId,duplicate:false};
  } finally { lock.releaseLock(); }
}

function analysisGroup_(robot,knew,exposure) {
  if ([robot,knew,exposure].includes('prefer_not_to_say') || knew==='unsure' || exposure==='unsure') return 'unclassified';
  if ((exposure==='in_person'||exposure==='both')) return robot==='yes'?'G3_robotics_rubi_in_person':'G3_nonrobot_rubi_in_person';
  if (knew==='yes') return robot==='yes'?'G2_robotics_rubi_no_inperson':'G2_nonrobot_rubi_no_inperson';
  if (knew==='no') return robot==='yes'?'G1_robotics_rubi_unaware':'G0_nonrobot_rubi_unaware';
  return 'unclassified';
}

function sheet_(ss,name){const s=ss.getSheetByName(name);if(!s)throw new Error(name+' 시트를 찾을 수 없습니다.');return s;}
function headers_(sheet){return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);}
function appendMapped_(sheet,record){const h=headers_(sheet);sheet.appendRow(h.map(k=>cell_(record[k])));}
function updateMapped_(sheet,row,record){const h=headers_(sheet),range=sheet.getRange(row,1,1,h.length),values=range.getValues()[0];h.forEach((k,i)=>{if(Object.prototype.hasOwnProperty.call(record,k))values[i]=cell_(record[k]);});range.setValues([values]);}
function findExact_(sheet,column,value){if(sheet.getLastRow()<2)return 0;const found=sheet.getRange(2,column,sheet.getLastRow()-1,1).createTextFinder(String(value)).matchEntireCell(true).findNext();return found?found.getRow():0;}
function cell_(v){if(v===undefined||v===null)return '';if(typeof v==='object')return JSON.stringify(v);return v;}
function id_(v,label){if(typeof v!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(v))throw new Error(label+'가 올바르지 않습니다.');return v;}
function enum_(v,allowed,label){if(!allowed.includes(v))throw new Error(label+'가 올바르지 않습니다.');return v;}
function isFiniteNumber_(v){return typeof v==='number'&&isFinite(v);}
function finiteRange_(v,lo,hi){return isFiniteNumber_(v)&&v>=lo&&v<=hi;}
function sha256_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function reply_(payload){
  const json=JSON.stringify(payload).replace(/<\//g,'<\\/');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>parent.postMessage('+json+',"*");<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
