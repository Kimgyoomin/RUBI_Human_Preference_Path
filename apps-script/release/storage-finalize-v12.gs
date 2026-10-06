// Finalize batch/read-retry hotfix v12.
// Keeps v11 fast per-trial writes, but replaces the expensive final completion lookup loop
// with two bulk reads (Trials + Runs) and adds short retry only around read-only Spreadsheet calls.
const STORAGE_FINALIZE = Object.freeze({
  VERSION: 'fast-batch-finalize-v12',
  READ_RETRIES: 3,
  READ_RETRY_BASE_MS: 180
});

function transientSpreadsheetErrorV12_(e){
  const m=String(e&&e.message?e.message:e);
  return /Service Spreadsheets failed|Service error|Internal error|temporarily unavailable|Try again later/i.test(m);
}

function readRetryV12_(fn){
  let last;
  for(let attempt=0;attempt<STORAGE_FINALIZE.READ_RETRIES;attempt++){
    try{return fn();}
    catch(e){
      last=e;
      if(!transientSpreadsheetErrorV12_(e)||attempt===STORAGE_FINALIZE.READ_RETRIES-1)throw e;
      if(typeof Utilities.sleep==='function')Utilities.sleep(STORAGE_FINALIZE.READ_RETRY_BASE_MS*(attempt+1));
    }
  }
  throw last;
}

function releaseRequestV12_(request){
  const p=request&&request.payload;
  if(!p||p.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL)return releaseRequestV11_(request);
  if(request.kind==='ping'){
    const r=releaseRequestV11_(request);
    return {...r,storageHotfixVersion:STORAGE_FINALIZE.VERSION};
  }
  validateStudy_(p);
  if(p.experimentId!==RELEASE.MAIN_EXPERIMENT||p.studyStatus!=='released'||!['trial','profile'].includes(request.kind))throw new Error('새 질문의 연구 설정이 다릅니다.');
  if(!mainOpen_())throw new Error('지금은 본 조사 응답을 받지 않습니다.');
  if(p.expectedTrials!==16||p.consent!==true)throw new Error('승인된 본 조사 형식이 아닙니다.');
  const ss=openMainFastV12_();
  const result=request.kind==='trial'?saveNoRepeatTrialV11_(ss,p):saveNoRepeatProfileV12_(ss,p);
  return {...result,releaseVersion:NO_REPEAT_RELEASE,datasetTag:'main-v1',storageHotfixVersion:STORAGE_FINALIZE.VERSION};
}

function openMainFastV12_(){
  return readRetryV12_(()=>{
    const ss=SpreadsheetApp.openById(RELEASE.MAIN_SHEET);
    sheet_(ss,'Trials');sheet_(ss,'Runs');sheet_(ss,'Sessions');
    return ss;
  });
}

function bulkRecordsV12_(sheet){
  const h=readRetryV12_(()=>headers_(sheet)),last=sheet.getLastRow();
  if(last<2)return [];
  const values=readRetryV12_(()=>sheet.getRange(2,1,last-1,h.length).getValues());
  return values.filter(v=>v[0]!=='').map(v=>Object.fromEntries(h.map((k,i)=>[k,v[i]])));
}

function rebuildHistoryV12_(trials,sessionId,protocolVersion){
  const rows=bulkRecordsV12_(trials)
    .filter(r=>r.sessionId===sessionId&&r.protocolVersion===protocolVersion&&r.saveState==='complete')
    .sort((a,b)=>Number(a.trialSequence)-Number(b.trialSequence));
  return validateHistoryV11_(rows.map(historyEntryFromTrialV11_));
}

function loadCompletionHistoryV12_(ss,p){
  let history,row;
  const lock=acquireStorageLockV11_();
  try{
    const sessions=sheet_(ss,'Sessions'),trials=sheet_(ss,'Trials');
    ensureHistoryColumnV11_(sessions);
    row=readRetryV12_(()=>findExact_(sessions,1,p.sessionId));
    if(!row||p.consent!==true)throw new Error('아직 저장된 참여 기록이 없습니다.');
    const old=readRetryV12_(()=>record_(sessions,row));
    assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    history=parseHistoryV11_(old[STORAGE_FAST.HISTORY_COLUMN]);
    if(history===null){
      history=rebuildHistoryV12_(trials,p.sessionId,p.protocolVersion);
      updateMapped_(sessions,row,{committedHistoryJson:history,savedTrials:history.length});
      SpreadsheetApp.flush();
    }
  }finally{lock.releaseLock();}
  return {row,history};
}

function verifyCompletionLinksV12_(ss,p,history){
  if(history.length!==16||history.some((x,i)=>Number(x.trialSequence)!==i+1))
    throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');

  // Exactly one bulk table read per source. Filtering/link checks happen in memory.
  const trials=bulkRecordsV12_(sheet_(ss,'Trials')).filter(r=>r.sessionId===p.sessionId&&r.protocolVersion===p.protocolVersion);
  const runs=bulkRecordsV12_(sheet_(ss,'Runs')).filter(r=>r.sessionId===p.sessionId);

  const trialById=new Map(trials.map(r=>[String(r.submissionId),r]));
  const runById=new Map(runs.map(r=>[String(r.rolloutId),r]));

  if(trials.length!==16||new Set(trials.map(r=>Number(r.trialSequence))).size!==16)
    throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');

  for(const h of history){
    const t=trialById.get(String(h.submissionId));
    if(!t||Number(t.trialSequence)!==Number(h.trialSequence)||t.saveState!=='complete')
      throw new Error('아직 저장되지 않은 문항이 있습니다. 완료 처리하지 않았습니다.');
    for(const [key,route] of [['directRolloutId','direct'],['detourRolloutId','detour']]){
      const rr=runById.get(String(t[key]));
      if(!rr||rr.route!==route||rr.completed!==true)
        throw new Error('실행 기록이 누락되어 완료할 수 없습니다. 응답 저장을 다시 시도해 주세요.');
    }
  }
}

function saveNoRepeatProfileV12_(ss,p){
  id_(p.sessionId,'sessionId');id_(p.participantId,'participantId');
  const robot=enum_(p.roboticsRelatedExperience,['yes','no','prefer_not_to_say'],'roboticsRelatedExperience');
  const knew=enum_(p.knewRubiBeforeStudy,['yes','no','unsure','prefer_not_to_say'],'knewRubiBeforeStudy');
  const exposure=enum_(p.rubiExposureBeforeStudy,['none','video_only','in_person','both','unsure','prefer_not_to_say'],'rubiExposureBeforeStudy');

  const loaded=loadCompletionHistoryV12_(ss,p);
  verifyCompletionLinksV12_(ss,p,loaded.history);

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

  const sessions=sheet_(ss,'Sessions');
  const verifyRow=readRetryV12_(()=>findExact_(sessions,1,p.sessionId));
  const verify=verifyRow?readRetryV12_(()=>record_(sessions,verifyRow)):null;
  if(!verify||verify.status!=='completed'||Number(verify.savedTrials)!==16)
    throw new Error('완료 상태 저장을 확인하지 못했습니다. 다시 시도해 주세요.');
  return {kind:'profile',submissionId:p.sessionId,duplicate,collectorVersion:CONFIG.VERSION};
}
