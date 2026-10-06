// Storage transaction/recovery hotfix for the released v9 collector.
// Appended by tools/build-storage-hotfix-collector.mjs.
// Keeps the public handshake at no-repeat-collector-v9 so the already-deployed participant UI needs no change.
const STORAGE_HOTFIX = Object.freeze({
  VERSION: 'transactional-sheets-v10',
  LOCK_WAIT_MS: 20000
});

function releaseRequestV10_(request){
  const p=request&&request.payload;
  if(!p||p.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL)return releaseRequestV9_(request);
  if(request.kind==='ping')return {...releaseRequestV9_(request),storageHotfixVersion:STORAGE_HOTFIX.VERSION};
  validateStudy_(p);
  if(p.experimentId!==RELEASE.MAIN_EXPERIMENT||p.studyStatus!=='released'||!['trial','profile'].includes(request.kind))throw new Error('새 질문의 연구 설정이 다릅니다.');
  if(!mainOpen_())throw new Error('지금은 본 조사 응답을 받지 않습니다.');
  if(p.expectedTrials!==16||p.consent!==true)throw new Error('승인된 본 조사 형식이 아닙니다.');
  const result=request.kind==='trial'?saveNoRepeatTrialV10_(p):saveNoRepeatProfileV10_(p);
  return {...result,releaseVersion:NO_REPEAT_RELEASE,datasetTag:'main-v1',storageHotfixVersion:STORAGE_HOTFIX.VERSION};
}

function validateNoRepeatTrialStaticV10_(p){
  validateBlock_(p);
  id_(p.submissionId,'submissionId');id_(p.participantId,'participantId');id_(p.sessionId,'sessionId');id_(p.trialId,'trialId');
  if(p.schemaVersion!==1||p.consent!==true||p.isPractice!==false||p.consentVersion!=='consent-v1')throw new Error('문항 표시 조건이나 동의 상태가 다릅니다.');
  if(p.labelConditionVersion!==noRepeatScheduler_.BLOCK_LABEL_CONDITION)throw new Error('문항 표시 조건이 다릅니다.');
  if(!p.hashes||p.hashes['encoder.onnx']!==RELEASE.ENCODER_SHA||p.hashes['policy.onnx']!==RELEASE.POLICY_SHA||
     typeof p.tutorialVersion!=='string'||!/^same-policy-intro-v1:[a-f0-9]{64}$/.test(p.tutorialVersion))throw new Error('모델·소개 버전을 확인해 주세요.');
  if(p.choice==='skip'?p.skipReason!=='insufficient_information':Boolean(p.skipReason))throw new Error('건너뛰기 사유가 다릅니다.');
  for(const route of ['direct','detour']){
    const run=p.runs&&p.runs[route],length=route==='direct'?6:6+p.scenario.detour;
    if(!run||run.route!==route||run.completed!==true||!run.id||!Number.isFinite(run.plannedLength)||Math.abs(run.plannedLength-length)>1e-6||
       !Number.isFinite(run.duration)||run.duration<=0||run.duration>120)throw new Error('실행 경로 길이가 다릅니다.');
    id_(run.id,'rolloutId');
  }
  if(p.runs.direct.id===p.runs.detour.id)throw new Error('실행 ID를 확인해 주세요.');
}

function acquireStorageLockV10_(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(STORAGE_HOTFIX.LOCK_WAIT_MS))throw new Error('저장소가 사용 중입니다. 잠시 후 같은 응답을 다시 제출해 주세요.');
  return lock;
}

function appendMappedV10_(sheet,record){
  const h=headers_(sheet),key=record[h[0]];
  if(key===undefined||key===null||key==='')throw new Error('저장 행의 ID가 없습니다.');
  sheet.appendRow(h.map(k=>cell_(record[k])));
  SpreadsheetApp.flush();
  const row=findExact_(sheet,1,key);
  if(!row)throw new Error('저장 행을 확인하지 못했습니다. 같은 응답을 다시 제출해 주세요.');
  return row;
}

function trialRecordV10_(p,sessionId,now,digest){
  const s=p.scenario;
  return {
    submissionId:p.submissionId,schemaVersion:p.schemaVersion,experimentId:p.experimentId,sessionId,participantId:p.participantId,
    trialId:p.trialId,trialSequence:p.trialSequence,isPractice:false,heightM:s.height,detourExtraM:s.detour,nominalSpeedMps:s.speed,
    routeGeometryVersion:s.geometry&&s.geometry.version||'',choice:p.choice,skipReason:p.skipReason||'',
    pathA:p.presentation&&p.presentation.a||'',pathB:p.presentation&&p.presentation.b||'',
    firstPreviewRoute:Array.isArray(p.previewEvents)&&p.previewEvents.length?p.previewEvents[0].route:'',
    labelConditionVersion:p.labelConditionVersion||'',directRolloutId:p.runs.direct.id,detourRolloutId:p.runs.detour.id,
    decisionMs:p.decisionMs??'',elapsedTrialMs:p.elapsedTrialMs??'',directCoverage:p.previewCoverage&&p.previewCoverage.direct,
    detourCoverage:p.previewCoverage&&p.previewCoverage.detour,adaptiveVersion:p.adaptiveVersion||'',candidateSetId:p.candidateSetId||'',
    queryReason:p.queryReason||'',adaptiveStateBeforeRef:p.adaptiveStateBeforeRef||'',adaptiveStateAfterRef:p.adaptiveStateAfterRef||'',
    clientCreatedAtUtc:p.createdAt||'',serverReceivedAtUtc:now,appCommit:p.appCommit||'',tutorialVersion:p.tutorialVersion||'',
    consentVersion:p.consentVersion||'',consentGranted:true,payloadSha256:digest,protocolVersion:p.protocolVersion||'',
    blockIndex:p.blockIndex??'',trialInBlock:p.trialInBlock??'',blockOrderJson:p.blockOrder||'',endpointOrder:p.endpointOrder||'',
    queryContextJson:p.queryContext||'',saveState:'pending'
  };
}

function runRecordV10_(p,route,sessionId,now){
  const s=p.scenario,run=p.runs[route],metric=s.geometry&&s.geometry.metrics?s.geometry.metrics[route]:{};
  return {
    rolloutId:run.id,schemaVersion:1,experimentId:p.experimentId,sessionId,participantId:p.participantId,scenarioId:run.scenarioId,
    route,heightM:s.height,detourExtraM:s.detour,nominalSpeedMps:s.speed,followerMeanVxMps:run.meanFollowerVxMps??'',
    policyMeanVxCommand:run.meanPolicyVxCommand??'',distanceXyM:run.distanceAtArrivalM??run.actualLength??'',
    measurementDurationS:run.movingDurationS??run.duration??'',achievedMeanXyMps:run.achievedMeanXyMps??'',
    bodyForwardMeanMps:run.bodyForwardMeanMps??'',progressSpeedMeanMps:run.progressSpeedMeanMps??'',
    settleDurationS:run.settleDurationS??'',completed:Boolean(run.completed),reason:run.reason||'',plannedLengthM:run.plannedLength??'',
    maxTrackingErrorM:run.maxError??'',actualYawAbsRad:run.actualYawAbsRad??'',plannedMaxCurvaturePerM:metric.maxCurvaturePerM??'',
    plannedAbsCurvatureRad:metric.integratedAbsCurvatureRad??'',actualClearanceM:'',geometryVersion:s.geometry&&s.geometry.version||'',
    policyProfile:run.profile||'',encoderSha256:p.hashes&&p.hashes['encoder.onnx']||'',policySha256:p.hashes&&p.hashes['policy.onnx']||'',
    modelManifestSha256:p.modelManifestSha256||'',simulatorVersion:run.simulator||'',controllerVersion:p.controllerVersion||'',
    cacheHit:Boolean(run.cacheHit),sourceRolloutId:run.sourceRolloutId||'',computeMs:run.computeMs??'',trajectoryRef:'',createdAtUtc:now
  };
}

function ensureRunV10_(runs,p,route,sessionId,now){
  const run=p.runs[route],oldRow=findExact_(runs,1,run.id);
  if(oldRow){
    assertIdentity_(record_(runs,oldRow),{sessionId,participantId:p.participantId,experimentId:p.experimentId,route,scenarioId:run.scenarioId});
    return oldRow;
  }
  return appendMappedV10_(runs,runRecordV10_(p,route,sessionId,now));
}

function ensureSessionV10_(sessions,p,sessionId,now){
  let row=findExact_(sessions,1,sessionId);
  if(!row)row=appendMappedV10_(sessions,{sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,
    protocolVersion:p.protocolVersion,tutorialVersion:p.tutorialVersion||'',consentVersion:p.consentVersion||'',consentGranted:true,
    tutorialCompleted:Boolean(p.tutorialCompleted),startedAtUtc:p.sessionStartedAtUtc||p.createdAt||now,endedAtUtc:'',status:'started',
    browserFamily:p.browser&&p.browser.userAgent||'',viewportWidth:p.browser&&p.browser.viewport?p.browser.viewport[0]:'',
    viewportHeight:p.browser&&p.browser.viewport?p.browser.viewport[1]:'',appCommit:p.appCommit||''});
  const old=record_(sessions,row);
  assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
  if(p.preProfile){
    const profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,now);
    for(const key of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc'])
      if(old[key]!==''&&old[key]!==undefined&&old[key]!==profile[key])throw new Error('같은 참여 회차의 사전 경험 정보가 다릅니다.');
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(p.questionPlan))throw new Error('참여 중 질문 계획이 바뀌었습니다.');
    if(old.profileCompletedAtUtc)profile.profileCompletedAtUtc=old.profileCompletedAtUtc;
    updateMapped_(sessions,row,{...profile,profileSchemaVersion:'pre-profile-plain-v2',expectedTrials:p.expectedTrials,questionPlanJson:p.questionPlan});
  }
  return row;
}

function validateNoRepeatStateLockedV10_(p,trials,sessions){
  const own=records_(trials).filter(r=>r.sessionId===p.sessionId);
  if(own.some(r=>r.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL))throw new Error('참여 중 질문 버전을 바꿀 수 없습니다.');
  const same=own.filter(r=>Number(r.trialSequence)===p.trialSequence);
  if(same.some(r=>r.submissionId!==p.submissionId))throw new Error('같은 참여 회차의 문항에 이미 다른 응답 ID가 있습니다.');
  const earlier=own.filter(r=>Number(r.trialSequence)<p.trialSequence).sort((a,b)=>Number(a.trialSequence)-Number(b.trialSequence));
  if(earlier.length!==p.trialSequence-1||new Set(earlier.map(r=>Number(r.trialSequence))).size!==p.trialSequence-1||
     earlier.some((r,i)=>Number(r.trialSequence)!==i+1||r.saveState!=='complete'))throw new Error('앞선 문항의 저장을 확인해 주세요.');
  const history=earlier.map(r=>({submissionId:r.submissionId,trialSequence:Number(r.trialSequence),choice:r.choice,scenario:{height:Number(r.heightM),detour:Number(r.detourExtraM)}}));
  const q=noRepeatScheduler_.nextBlockQuestion(p.questionPlan,history);
  if(!q||q.sequence!==p.trialSequence||q.heightCm/100!==p.scenario.height||q.detourMm/1000!==p.scenario.detour||
     q.aRoute!==p.presentation.a||q.reason!==p.queryReason||q.endpointOrder!==p.endpointOrder||
     JSON.stringify(q.context)!==JSON.stringify(p.queryContext))throw new Error('저장된 이전 응답과 다음 질문이 맞지 않습니다.');
  const row=findExact_(sessions,1,p.sessionId);
  if(row){
    const old=record_(sessions,row);
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(p.questionPlan))throw new Error('참여 중 질문 계획을 바꿀 수 없습니다.');
    const profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,new Date().toISOString());
    for(const k of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc'])
      if(old[k]!==''&&old[k]!==undefined&&old[k]!==profile[k])throw new Error('사전 경험 응답을 바꿀 수 없습니다.');
    if(old.status==='completed'&&!same.some(r=>r.submissionId===p.submissionId))throw new Error('이미 완료한 참여입니다.');
  }
}

function saveNoRepeatTrialV10_(p){
  validateNoRepeatTrialStaticV10_(p);
  const lock=acquireStorageLockV10_();
  try{
    const ss=mainSchema_(),trials=sheet_(ss,'Trials'),runs=sheet_(ss,'Runs'),sessions=sheet_(ss,'Sessions');
    validateNoRepeatStateLockedV10_(p,trials,sessions);
    const digest=sha256_(JSON.stringify(p)),now=new Date().toISOString();
    let trialRow=findExact_(trials,1,p.submissionId),duplicate=Boolean(trialRow);
    if(trialRow){
      const old=record_(trials,trialRow);
      if(old.payloadSha256!==digest)throw new Error('동일 submissionId의 내용이 다릅니다. 기존 답변을 변경하지 않았습니다.');
      assertIdentity_(old,{sessionId:p.sessionId,participantId:p.participantId,experimentId:p.experimentId,trialSequence:p.trialSequence});
    }else{
      trialRow=appendMappedV10_(trials,trialRecordV10_(p,p.sessionId,now,digest));
    }
    // A retry can arrive after an old partial write where Runs exist but Trial/Session linkage is incomplete.
    ensureRunV10_(runs,p,'direct',p.sessionId,now);
    ensureRunV10_(runs,p,'detour',p.sessionId,now);
    const sessionRow=ensureSessionV10_(sessions,p,p.sessionId,now);
    SpreadsheetApp.flush();

    trialRow=findExact_(trials,1,p.submissionId);
    if(!trialRow)throw new Error('응답 행 저장을 확인하지 못했습니다. 같은 응답을 다시 제출해 주세요.');
    updateMapped_(trials,trialRow,{saveState:'complete'});
    SpreadsheetApp.flush();

    const savedTrial=record_(trials,findExact_(trials,1,p.submissionId));
    if(savedTrial.saveState!=='complete'||savedTrial.payloadSha256!==digest||Number(savedTrial.trialSequence)!==p.trialSequence)throw new Error('응답 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
    for(const route of ['direct','detour']){
      const rr=findExact_(runs,1,p.runs[route].id);
      if(!rr)throw new Error('실행 기록 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
      assertIdentity_(record_(runs,rr),{sessionId:p.sessionId,participantId:p.participantId,experimentId:p.experimentId,route});
    }
    const completeRows=records_(trials).filter(r=>r.sessionId===p.sessionId&&r.protocolVersion===p.protocolVersion&&r.saveState==='complete');
    const seq=new Set(completeRows.map(r=>Number(r.trialSequence)));
    if(seq.size!==completeRows.length)throw new Error('같은 참여 회차에 중복 문항 번호가 있습니다.');
    updateMapped_(sessions,sessionRow,{savedTrials:completeRows.length});
    SpreadsheetApp.flush();
    const session=record_(sessions,findExact_(sessions,1,p.sessionId));
    if(Number(session.savedTrials)!==completeRows.length)throw new Error('참여 진행 상태 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
    return {kind:'trial',submissionId:p.submissionId,duplicate,collectorVersion:CONFIG.VERSION};
  }finally{lock.releaseLock();}
}

function saveNoRepeatProfileV10_(p){
  id_(p.sessionId,'sessionId');id_(p.participantId,'participantId');
  const robot=enum_(p.roboticsRelatedExperience,['yes','no','prefer_not_to_say'],'roboticsRelatedExperience');
  const knew=enum_(p.knewRubiBeforeStudy,['yes','no','unsure','prefer_not_to_say'],'knewRubiBeforeStudy');
  const exposure=enum_(p.rubiExposureBeforeStudy,['none','video_only','in_person','both','unsure','prefer_not_to_say'],'rubiExposureBeforeStudy');
  const lock=acquireStorageLockV10_();
  try{
    const ss=mainSchema_(),trials=sheet_(ss,'Trials'),runs=sheet_(ss,'Runs'),sessions=sheet_(ss,'Sessions');
    const row=findExact_(sessions,1,p.sessionId);
    if(!row||p.consent!==true)throw new Error('아직 저장된 참여 기록이 없습니다.');
    const old=record_(sessions,row);
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    const rows=records_(trials).filter(r=>r.sessionId===p.sessionId&&r.protocolVersion===p.protocolVersion);
    const expected=Number(old.expectedTrials);
    const seq=rows.map(r=>Number(r.trialSequence)).sort((a,b)=>a-b);
    if(expected!==16||p.expectedTrials!==16||rows.length!==16||new Set(seq).size!==16||seq.some((n,i)=>n!==i+1)||rows.some(r=>r.saveState!=='complete'))
      throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
    const runRows=records_(runs).filter(r=>r.sessionId===p.sessionId),byId=new Map(runRows.map(r=>[r.rolloutId,r]));
    for(const t of rows)for(const [key,route] of [['directRolloutId','direct'],['detourRolloutId','detour']]){
      const rr=byId.get(t[key]);
      if(!rr||rr.route!==route||rr.completed!==true)throw new Error('실행 기록이 누락되어 완료할 수 없습니다. 응답 저장을 다시 시도해 주세요.');
    }
    assertIdentity_(old,{roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,rubiExposureBeforeStudy:exposure});
    const duplicate=old.status==='completed',now=new Date().toISOString();
    updateMapped_(sessions,row,{profileSchemaVersion:p.profileSchemaVersion||'pre-profile-plain-v2',roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,
      rubiExposureBeforeStudy:exposure,profileCompleted:true,profileCompletedAtUtc:old.profileCompletedAtUtc||p.profileCompletedAtUtc||now,
      analysisGroup:analysisGroup_(robot,knew,exposure),groupingRuleVersion:p.groupingRuleVersion||'cohort-v1',
      endedAtUtc:p.profileCompletedAtUtc||now,status:'completed',savedTrials:16,appCommit:p.appCommit||''});
    SpreadsheetApp.flush();
    const verify=record_(sessions,findExact_(sessions,1,p.sessionId));
    if(verify.status!=='completed'||Number(verify.savedTrials)!==16)throw new Error('완료 상태 저장을 확인하지 못했습니다. 다시 시도해 주세요.');
    return {kind:'profile',submissionId:p.sessionId,duplicate,collectorVersion:CONFIG.VERSION};
  }finally{lock.releaseLock();}
}
