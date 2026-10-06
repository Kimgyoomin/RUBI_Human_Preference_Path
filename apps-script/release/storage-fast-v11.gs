// Fast storage hotfix v11 for released v9 external pilot.
// Builds on v10 recovery guarantees while keeping the global lock critical section short.
// Public protocol/releaseVersion, Sheet ID and /exec endpoint remain unchanged.
const STORAGE_FAST = Object.freeze({
  VERSION: 'fast-session-state-v11',
  LOCK_WAIT_MS: 10000,
  HISTORY_COLUMN: 'committedHistoryJson'
});

function releaseRequestV11_(request){
  const p=request&&request.payload;
  if(!p||p.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL)return releaseRequestV10_(request);
  if(request.kind==='ping'){
    const r=releaseRequestV10_(request);
    return {...r,storageHotfixVersion:STORAGE_FAST.VERSION};
  }
  validateStudy_(p);
  if(p.experimentId!==RELEASE.MAIN_EXPERIMENT||p.studyStatus!=='released'||!['trial','profile'].includes(request.kind))throw new Error('새 질문의 연구 설정이 다릅니다.');
  if(!mainOpen_())throw new Error('지금은 본 조사 응답을 받지 않습니다.');
  if(p.expectedTrials!==16||p.consent!==true)throw new Error('승인된 본 조사 형식이 아닙니다.');
  const ss=openMainFastV11_();
  const result=request.kind==='trial'?saveNoRepeatTrialV11_(ss,p):saveNoRepeatProfileV11_(ss,p);
  return {...result,releaseVersion:NO_REPEAT_RELEASE,datasetTag:'main-v1',storageHotfixVersion:STORAGE_FAST.VERSION};
}

function openMainFastV11_(){
  const ss=SpreadsheetApp.openById(RELEASE.MAIN_SHEET);
  sheet_(ss,'Trials');sheet_(ss,'Runs');sheet_(ss,'Sessions');
  return ss;
}

function acquireStorageLockV11_(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(STORAGE_FAST.LOCK_WAIT_MS))throw new Error('저장소가 사용 중입니다. 잠시 후 같은 응답을 다시 제출해 주세요.');
  return lock;
}

function appendMappedV11_(sheet,record){
  const h=headers_(sheet),key=record[h[0]];
  if(key===undefined||key===null||key==='')throw new Error('저장 행의 ID가 없습니다.');
  sheet.appendRow(h.map(k=>cell_(record[k])));
  return sheet.getLastRow();
}

function ensureHistoryColumnV11_(sessions){
  const h=headers_(sessions);
  if(h.includes(STORAGE_FAST.HISTORY_COLUMN))return;
  ensureColumns_(sessions,[STORAGE_FAST.HISTORY_COLUMN]);
}

function recordsByExactV11_(sheet,columnName,value){
  const h=headers_(sheet),column=h.indexOf(columnName)+1,last=sheet.getLastRow();
  if(column<1)throw new Error(columnName+' 열이 없습니다.');
  if(last<2)return [];
  const finder=sheet.getRange(2,column,last-1,1).createTextFinder(String(value)).matchEntireCell(true);
  const found=typeof finder.findAll==='function'?finder.findAll():[];
  return found.map(x=>record_(sheet,x.getRow()));
}

function historyEntryFromTrialV11_(r){
  return {
    submissionId:String(r.submissionId),
    trialSequence:Number(r.trialSequence),
    choice:String(r.choice),
    scenario:{height:Number(r.heightM),detour:Number(r.detourExtraM)},
    directRolloutId:String(r.directRolloutId),
    detourRolloutId:String(r.detourRolloutId),
    payloadSha256:String(r.payloadSha256||'')
  };
}

function historyEntryFromPayloadV11_(p,digest){
  return {
    submissionId:p.submissionId,
    trialSequence:p.trialSequence,
    choice:p.choice,
    scenario:{height:p.scenario.height,detour:p.scenario.detour},
    directRolloutId:p.runs.direct.id,
    detourRolloutId:p.runs.detour.id,
    payloadSha256:digest
  };
}

function validateHistoryV11_(history){
  if(!Array.isArray(history)||history.length>16)throw new Error('참여 진행 상태가 올바르지 않습니다.');
  const sorted=[...history].sort((a,b)=>Number(a.trialSequence)-Number(b.trialSequence));
  const ids=new Set(),seqs=new Set();
  sorted.forEach((r,i)=>{
    if(!r||Number(r.trialSequence)!==i+1||!['direct','detour','skip'].includes(r.choice)||!r.scenario||
       !Number.isFinite(Number(r.scenario.height))||!Number.isFinite(Number(r.scenario.detour))||
       typeof r.submissionId!=='string'||!r.submissionId)throw new Error('참여 진행 상태가 올바르지 않습니다.');
    if(ids.has(r.submissionId)||seqs.has(Number(r.trialSequence)))throw new Error('참여 진행 상태에 중복 응답이 있습니다.');
    ids.add(r.submissionId);seqs.add(Number(r.trialSequence));
  });
  return sorted;
}

function rebuildHistoryV11_(trials,sessionId,protocolVersion){
  const rows=recordsByExactV11_(trials,'sessionId',sessionId)
    .filter(r=>r.protocolVersion===protocolVersion&&r.saveState==='complete')
    .sort((a,b)=>Number(a.trialSequence)-Number(b.trialSequence));
  return validateHistoryV11_(rows.map(historyEntryFromTrialV11_));
}

function parseHistoryV11_(value){
  if(value===''||value===undefined||value===null)return null;
  let parsed;try{parsed=typeof value==='string'?JSON.parse(value):value;}catch{throw new Error('저장된 참여 진행 상태를 읽지 못했습니다.');}
  return validateHistoryV11_(parsed);
}

function sessionStateLockedV11_(sessions,trials,p,now){
  ensureHistoryColumnV11_(sessions);
  let row=findExact_(sessions,1,p.sessionId),old=row?record_(sessions,row):null;
  let history=old?parseHistoryV11_(old[STORAGE_FAST.HISTORY_COLUMN]):null;
  if(history===null)history=rebuildHistoryV11_(trials,p.sessionId,p.protocolVersion);
  if(!row){
    row=appendMappedV11_(sessions,{sessionId:p.sessionId,schemaVersion:1,participantId:p.participantId,experimentId:p.experimentId,
      protocolVersion:p.protocolVersion,tutorialVersion:p.tutorialVersion||'',consentVersion:p.consentVersion||'',consentGranted:true,
      tutorialCompleted:Boolean(p.tutorialCompleted),startedAtUtc:p.sessionStartedAtUtc||p.createdAt||now,endedAtUtc:'',status:'started',
      browserFamily:p.browser&&p.browser.userAgent||'',viewportWidth:p.browser&&p.browser.viewport?p.browser.viewport[0]:'',
      viewportHeight:p.browser&&p.browser.viewport?p.browser.viewport[1]:'',appCommit:p.appCommit||'',
      savedTrials:history.length,questionPlanJson:p.questionPlan||'',committedHistoryJson:history});
    old=record_(sessions,row);
  }else{
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(p.questionPlan))throw new Error('참여 중 질문 계획을 바꿀 수 없습니다.');
    if(!old[STORAGE_FAST.HISTORY_COLUMN]||Number(old.savedTrials)!==history.length)
      updateMapped_(sessions,row,{committedHistoryJson:history,savedTrials:history.length});
  }
  if(p.preProfile){
    const current=record_(sessions,row),profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,now);
    for(const key of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc'])
      if(current[key]!==''&&current[key]!==undefined&&current[key]!==profile[key])throw new Error('같은 참여 회차의 사전 경험 정보가 다릅니다.');
    if(current.profileCompletedAtUtc)profile.profileCompletedAtUtc=current.profileCompletedAtUtc;
    updateMapped_(sessions,row,{...profile,profileSchemaVersion:'pre-profile-plain-v2',expectedTrials:p.expectedTrials,questionPlanJson:p.questionPlan,
      committedHistoryJson:history,savedTrials:history.length});
  }
  return {row,history};
}

function validateQuestionFromHistoryV11_(p,history){
  const same=history.find(r=>r.submissionId===p.submissionId);
  if(same&&Number(same.trialSequence)!==p.trialSequence)throw new Error('같은 응답 ID의 문항 번호가 다릅니다.');
  if(!same&&p.trialSequence!==history.length+1)throw new Error('앞선 문항의 저장을 확인해 주세요.');
  if(same&&p.trialSequence>history.length)throw new Error('참여 진행 상태가 올바르지 않습니다.');
  const earlier=history.filter(r=>Number(r.trialSequence)<p.trialSequence);
  if(earlier.length!==p.trialSequence-1)throw new Error('앞선 문항의 저장을 확인해 주세요.');
  const schedulerHistory=earlier.map(r=>({submissionId:r.submissionId,trialSequence:Number(r.trialSequence),choice:r.choice,
    scenario:{height:Number(r.scenario.height),detour:Number(r.scenario.detour)}}));
  const q=noRepeatScheduler_.nextBlockQuestion(p.questionPlan,schedulerHistory);
  if(!q||q.sequence!==p.trialSequence||q.heightCm/100!==p.scenario.height||q.detourMm/1000!==p.scenario.detour||
     q.aRoute!==p.presentation.a||q.reason!==p.queryReason||q.endpointOrder!==p.endpointOrder||
     JSON.stringify(q.context)!==JSON.stringify(p.queryContext))throw new Error('저장된 이전 응답과 다음 질문이 맞지 않습니다.');
  return same||null;
}

function ensureRunV11_(runs,p,route,now){
  const run=p.runs[route],oldRow=findExact_(runs,1,run.id);
  if(oldRow){
    assertIdentity_(record_(runs,oldRow),{sessionId:p.sessionId,participantId:p.participantId,experimentId:p.experimentId,route,scenarioId:run.scenarioId});
    return oldRow;
  }
  return appendMappedV11_(runs,runRecordV10_(p,route,p.sessionId,now));
}

function ensureTrialV11_(trials,p,now,digest){
  let row=findExact_(trials,1,p.submissionId);
  if(row){
    const old=record_(trials,row);
    if(old.payloadSha256!==digest)throw new Error('동일 submissionId의 내용이 다릅니다. 기존 답변을 변경하지 않았습니다.');
    assertIdentity_(old,{sessionId:p.sessionId,participantId:p.participantId,experimentId:p.experimentId,trialSequence:p.trialSequence});
    return {row,duplicate:true};
  }
  row=appendMappedV11_(trials,trialRecordV10_(p,p.sessionId,now,digest));
  return {row,duplicate:false};
}

function verifyTrialOutsideLockV11_(ss,p,digest){
  const trials=sheet_(ss,'Trials'),runs=sheet_(ss,'Runs'),sessions=sheet_(ss,'Sessions');
  const tr=findExact_(trials,1,p.submissionId);
  if(!tr)throw new Error('응답 행 저장을 확인하지 못했습니다. 같은 응답을 다시 제출해 주세요.');
  const saved=record_(trials,tr);
  if(saved.saveState!=='complete'||saved.payloadSha256!==digest||Number(saved.trialSequence)!==p.trialSequence)
    throw new Error('응답 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
  for(const route of ['direct','detour']){
    const rr=findExact_(runs,1,p.runs[route].id);
    if(!rr)throw new Error('실행 기록 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
    const run=record_(runs,rr);
    assertIdentity_(run,{sessionId:p.sessionId,participantId:p.participantId,experimentId:p.experimentId,route});
    if(run.completed!==true)throw new Error('실행 기록 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
  }
  const sr=findExact_(sessions,1,p.sessionId);
  if(!sr)throw new Error('참여 진행 상태를 확인하지 못했습니다. 같은 응답을 다시 제출해 주세요.');
  const session=record_(sessions,sr),history=parseHistoryV11_(session[STORAGE_FAST.HISTORY_COLUMN])||[];
  const h=history.find(x=>x.submissionId===p.submissionId);
  if(!h||Number(h.trialSequence)!==p.trialSequence||Number(session.savedTrials)!==history.length)
    throw new Error('참여 진행 상태 저장 확인에 실패했습니다. 같은 응답을 다시 제출해 주세요.');
}

function saveNoRepeatTrialV11_(ss,p){
  validateNoRepeatTrialStaticV10_(p);
  const digest=sha256_(JSON.stringify(p)),now=new Date().toISOString();
  let duplicate=false;
  const lock=acquireStorageLockV11_();
  try{
    const trials=sheet_(ss,'Trials'),runs=sheet_(ss,'Runs'),sessions=sheet_(ss,'Sessions');
    const state=sessionStateLockedV11_(sessions,trials,p,now);
    const same=validateQuestionFromHistoryV11_(p,state.history);
    const trial=ensureTrialV11_(trials,p,now,digest);duplicate=trial.duplicate||Boolean(same);
    ensureRunV11_(runs,p,'direct',now);ensureRunV11_(runs,p,'detour',now);
    updateMapped_(trials,trial.row,{saveState:'complete'});
    let nextHistory=state.history;
    if(!same){
      nextHistory=validateHistoryV11_([...state.history,historyEntryFromPayloadV11_(p,digest)]);
    }else if(same.payloadSha256&&same.payloadSha256!==digest){
      throw new Error('동일 submissionId의 내용이 다릅니다. 기존 답변을 변경하지 않았습니다.');
    }
    updateMapped_(sessions,state.row,{committedHistoryJson:nextHistory,savedTrials:nextHistory.length});
    SpreadsheetApp.flush(); // exactly one explicit flush in the normal per-trial path
  }finally{lock.releaseLock();}
  verifyTrialOutsideLockV11_(ss,p,digest);
  return {kind:'trial',submissionId:p.submissionId,duplicate,collectorVersion:CONFIG.VERSION};
}

function loadCompletionHistoryV11_(ss,p){
  let history,row;
  const lock=acquireStorageLockV11_();
  try{
    const sessions=sheet_(ss,'Sessions'),trials=sheet_(ss,'Trials');
    ensureHistoryColumnV11_(sessions);
    row=findExact_(sessions,1,p.sessionId);
    if(!row||p.consent!==true)throw new Error('아직 저장된 참여 기록이 없습니다.');
    const old=record_(sessions,row);
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    history=parseHistoryV11_(old[STORAGE_FAST.HISTORY_COLUMN]);
    if(history===null){
      history=rebuildHistoryV11_(trials,p.sessionId,p.protocolVersion);
      updateMapped_(sessions,row,{committedHistoryJson:history,savedTrials:history.length});
      SpreadsheetApp.flush();
    }
  }finally{lock.releaseLock();}
  return {row,history};
}

function verifyCompletionLinksV11_(ss,p,history){
  if(history.length!==16||history.some((x,i)=>Number(x.trialSequence)!==i+1))
    throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
  const trials=sheet_(ss,'Trials'),runs=sheet_(ss,'Runs');
  for(const h of history){
    const tr=findExact_(trials,1,h.submissionId);
    if(!tr)throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
    const t=record_(trials,tr);
    if(t.sessionId!==p.sessionId||t.protocolVersion!==p.protocolVersion||Number(t.trialSequence)!==Number(h.trialSequence)||t.saveState!=='complete')
      throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
    for(const [key,route] of [['directRolloutId','direct'],['detourRolloutId','detour']]){
      const id=t[key],rr=findExact_(runs,1,id);
      if(!rr)throw new Error('실행 기록이 누락되어 완료할 수 없습니다. 응답 저장을 다시 시도해 주세요.');
      const run=record_(runs,rr);
      if(run.sessionId!==p.sessionId||run.route!==route||run.completed!==true)
        throw new Error('실행 기록이 누락되어 완료할 수 없습니다. 응답 저장을 다시 시도해 주세요.');
    }
  }
}

function saveNoRepeatProfileV11_(ss,p){
  id_(p.sessionId,'sessionId');id_(p.participantId,'participantId');
  const robot=enum_(p.roboticsRelatedExperience,['yes','no','prefer_not_to_say'],'roboticsRelatedExperience');
  const knew=enum_(p.knewRubiBeforeStudy,['yes','no','unsure','prefer_not_to_say'],'knewRubiBeforeStudy');
  const exposure=enum_(p.rubiExposureBeforeStudy,['none','video_only','in_person','both','unsure','prefer_not_to_say'],'rubiExposureBeforeStudy');
  const loaded=loadCompletionHistoryV11_(ss,p);
  verifyCompletionLinksV11_(ss,p,loaded.history); // long verification deliberately runs outside the global write lock
  let duplicate=false;
  const lock=acquireStorageLockV11_();
  try{
    const sessions=sheet_(ss,'Sessions'),row=findExact_(sessions,1,p.sessionId);
    if(!row)throw new Error('아직 저장된 참여 기록이 없습니다.');
    const old=record_(sessions,row),latest=parseHistoryV11_(old[STORAGE_FAST.HISTORY_COLUMN])||[];
    if(JSON.stringify(latest)!==JSON.stringify(loaded.history)||latest.length!==16)
      throw new Error('완료 확인 중 참여 상태가 변경되었습니다. 다시 시도해 주세요.');
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion,
      roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,rubiExposureBeforeStudy:exposure});
    duplicate=old.status==='completed';const now=new Date().toISOString();
    updateMapped_(sessions,row,{profileSchemaVersion:p.profileSchemaVersion||'pre-profile-plain-v2',roboticsRelatedExperience:robot,knewRubiBeforeStudy:knew,
      rubiExposureBeforeStudy:exposure,profileCompleted:true,profileCompletedAtUtc:old.profileCompletedAtUtc||p.profileCompletedAtUtc||now,
      analysisGroup:analysisGroup_(robot,knew,exposure),groupingRuleVersion:p.groupingRuleVersion||'cohort-v1',
      endedAtUtc:p.profileCompletedAtUtc||now,status:'completed',savedTrials:16,committedHistoryJson:latest,appCommit:p.appCommit||''});
    SpreadsheetApp.flush();
  }finally{lock.releaseLock();}
  const sessions=sheet_(ss,'Sessions'),verifyRow=findExact_(sessions,1,p.sessionId),verify=verifyRow?record_(sessions,verifyRow):null;
  if(!verify||verify.status!=='completed'||Number(verify.savedTrials)!==16)throw new Error('완료 상태 저장을 확인하지 못했습니다. 다시 시도해 주세요.');
  return {kind:'profile',submissionId:p.sessionId,duplicate,collectorVersion:CONFIG.VERSION};
}
