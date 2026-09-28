// v9 extension. Legacy requests keep their v8 release handshake and exact rules.
const NO_REPEAT_RELEASE = 'no-repeat-collector-v9';
function releaseRequestV9_(request){
  const p=request&&request.payload;
  if(!p||p.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL){
    // Unknown versions may not fall through to the less restrictive profile route.
    if(p&&p.experimentId===RELEASE.MAIN_EXPERIMENT&&p.protocolVersion&&p.protocolVersion!=='height-blocks-binary-v7')throw new Error('지원하지 않는 질문 버전입니다.');
    if(p&&p.experimentId===RELEASE.MAIN_EXPERIMENT&&request.kind!=='ping'){
      const ss=mainSchema_(),sessions=sheet_(ss,'Sessions'),row=findExact_(sessions,1,p.sessionId);
      if(row&&record_(sessions,row).protocolVersion!==p.protocolVersion)throw new Error('참여 중 질문 버전을 바꿀 수 없습니다.');
    }
    return releaseRequest_(request);
  }
  validateStudy_(p);
  if(p.experimentId!==RELEASE.MAIN_EXPERIMENT||p.studyStatus!=='released'||!['ping','trial','profile'].includes(request.kind))throw new Error('새 질문의 연구 설정이 다릅니다.');
  if(request.kind==='ping'){
    mainSchema_();
    return {...handleRequest_(request),releaseVersion:NO_REPEAT_RELEASE,datasetTag:'main-v1',schemaReady:true,collectionOpen:mainOpen_(),supportedProtocols:['height-blocks-binary-v7',noRepeatScheduler_.BLOCK_PROTOCOL]};
  }
  if(!mainOpen_())throw new Error('지금은 본 조사 응답을 받지 않습니다.');
  if(p.expectedTrials!==16||p.consent!==true)throw new Error('승인된 본 조사 형식이 아닙니다.');
  if(request.kind==='trial')validateNoRepeatTrial_(p);
  else {
    const ss=mainSchema_(),sessions=sheet_(ss,'Sessions'),row=findExact_(sessions,1,p.sessionId);
    if(!row||record_(sessions,row).protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL)throw new Error('참여 중 질문 버전을 바꿀 수 없습니다.');
  }
  return {...handleRequest_(request),releaseVersion:NO_REPEAT_RELEASE,datasetTag:'main-v1'};
}
function validateBlock_(p){
  if(p.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL)return validateLegacyBlock_(p);
  const n=noRepeatScheduler_,plan=p.questionPlan;
  if(p.experimentId!==RELEASE.MAIN_EXPERIMENT||!['direct','detour','skip'].includes(p.choice)||p.adaptiveVersion!==n.BLOCK_RULE||p.candidateSetId!==n.CANDIDATE_SET)throw new Error('새 질문의 응답 형식이 다릅니다.');
  if(!plan||!Number.isInteger(plan.seed)||plan.seed<0||plan.seed>0xffffffff||JSON.stringify(plan)!==JSON.stringify(n.createBlockPlan(plan.seed))||p.expectedTrials!==16)throw new Error('새 질문 계획이 맞지 않습니다.');
  if(!Number.isInteger(p.trialSequence)||p.trialSequence<1||p.trialSequence>16||p.blockIndex!==Math.floor((p.trialSequence-1)/4)+1||p.trialInBlock!==(p.trialSequence-1)%4+1)throw new Error('문항 순서가 다릅니다.');
  const b=plan.blocks[p.blockIndex-1],s=p.scenario;
  if(!s||!Number.isFinite(s.height)||!Number.isFinite(s.detour)||s.height!==b.heightCm/100||s.speed!==.5||!n.DETOURS_MM.some(d=>Math.abs(d/1000-s.detour)<1e-9)||JSON.stringify(p.blockOrder)!==JSON.stringify(plan.blocks.map(x=>x.heightCm)))throw new Error('높이 또는 거리 설정이 다릅니다.');
  if(!p.presentation||p.presentation.a!==b.aRoutes[p.trialInBlock-1]||p.presentation.b!==(p.presentation.a==='direct'?'detour':'direct'))throw new Error('A/B 배정이 다릅니다.');
  if(!p.preProfile)throw new Error('사전 경험 응답이 없습니다.');
  profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,new Date().toISOString());
}
function validateNoRepeatTrial_(p){
  validateBlock_(p);
  if(p.labelConditionVersion!==noRepeatScheduler_.BLOCK_LABEL_CONDITION||p.isPractice!==false||p.consentVersion!=='consent-v1')throw new Error('문항 표시 조건이 다릅니다.');
  if(!p.hashes||p.hashes['encoder.onnx']!==RELEASE.ENCODER_SHA||p.hashes['policy.onnx']!==RELEASE.POLICY_SHA||typeof p.tutorialVersion!=='string'||!/^same-policy-intro-v1:[a-f0-9]{64}$/.test(p.tutorialVersion))throw new Error('모델·소개 버전을 확인해 주세요.');
  if(p.choice==='skip'?p.skipReason!=='insufficient_information':Boolean(p.skipReason))throw new Error('건너뛰기 사유가 다릅니다.');
  for(const route of ['direct','detour']){
    const run=p.runs&&p.runs[route],length=route==='direct'?6:6+p.scenario.detour;
    if(!run||!Number.isFinite(run.plannedLength)||Math.abs(run.plannedLength-length)>1e-6||!Number.isFinite(run.duration)||run.duration<=0||run.duration>120)throw new Error('실행 경로 길이가 다릅니다.');
  }
  const ss=mainSchema_(),trials=sheet_(ss,'Trials'),sessions=sheet_(ss,'Sessions');
  const own=records_(trials).filter(r=>r.sessionId===p.sessionId);
  if(own.some(r=>r.protocolVersion!==noRepeatScheduler_.BLOCK_PROTOCOL))throw new Error('참여 중 질문 버전을 바꿀 수 없습니다.');
  const earlier=own.filter(r=>r.trialSequence<p.trialSequence).sort((a,b)=>a.trialSequence-b.trialSequence);
  if(earlier.length!==p.trialSequence-1||earlier.some(r=>r.saveState!=='complete'))throw new Error('앞선 문항의 저장을 확인해 주세요.');
  const history=earlier.map(r=>({submissionId:r.submissionId,trialSequence:r.trialSequence,choice:r.choice,scenario:{height:r.heightM,detour:r.detourExtraM}}));
  const q=noRepeatScheduler_.nextBlockQuestion(p.questionPlan,history);
  if(!q||q.sequence!==p.trialSequence||q.heightCm/100!==p.scenario.height||q.detourMm/1000!==p.scenario.detour||q.aRoute!==p.presentation.a||q.reason!==p.queryReason||q.endpointOrder!==p.endpointOrder||JSON.stringify(q.context)!==JSON.stringify(p.queryContext))throw new Error('저장된 이전 응답과 다음 질문이 맞지 않습니다.');
  const row=findExact_(sessions,1,p.sessionId);
  if(row){
    const old=record_(sessions,row);assertIdentity_(old,{participantId:p.participantId,experimentId:p.experimentId,protocolVersion:p.protocolVersion});
    if(old.questionPlanJson&&old.questionPlanJson!==JSON.stringify(p.questionPlan))throw new Error('참여 중 질문 계획을 바꿀 수 없습니다.');
    const profile=profileRecord_(p.preProfile,p.profileAnsweredAtUtc||p.preProfile.answeredAtUtc,new Date().toISOString());
    for(const k of ['roboticsRelatedExperience','knewRubiBeforeStudy','rubiExposureBeforeStudy','profileAnsweredAtUtc'])if(old[k]!==''&&old[k]!==undefined&&old[k]!==profile[k])throw new Error('사전 경험 응답을 바꿀 수 없습니다.');
    if(old.status==='completed'&&!own.some(r=>r.submissionId===p.submissionId))throw new Error('이미 완료한 참여입니다.');
  }
}
