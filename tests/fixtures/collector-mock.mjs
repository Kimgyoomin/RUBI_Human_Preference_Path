// In-memory Apps Script services for failure-injection tests. Never contacts Google.
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const HEADERS={
 Trials:'submissionId schemaVersion experimentId sessionId participantId trialId trialSequence isPractice heightM detourExtraM nominalSpeedMps routeGeometryVersion choice skipReason pathA pathB firstPreviewRoute labelConditionVersion directRolloutId detourRolloutId decisionMs elapsedTrialMs directCoverage detourCoverage adaptiveVersion candidateSetId queryReason adaptiveStateBeforeRef adaptiveStateAfterRef clientCreatedAtUtc serverReceivedAtUtc appCommit tutorialVersion consentVersion consentGranted payloadSha256'.split(' '),
 Runs:'rolloutId schemaVersion experimentId sessionId participantId scenarioId route heightM detourExtraM nominalSpeedMps followerMeanVxMps policyMeanVxCommand distanceXyM measurementDurationS achievedMeanXyMps bodyForwardMeanMps progressSpeedMeanMps settleDurationS completed reason plannedLengthM maxTrackingErrorM actualYawAbsRad plannedMaxCurvaturePerM plannedAbsCurvatureRad actualClearanceM geometryVersion policyProfile encoderSha256 policySha256 modelManifestSha256 simulatorVersion controllerVersion cacheHit sourceRolloutId computeMs trajectoryRef createdAtUtc'.split(' '),
 Sessions:'sessionId schemaVersion participantId experimentId protocolVersion tutorialVersion consentVersion consentGranted tutorialCompleted startedAtUtc endedAtUtc status browserFamily viewportWidth viewportHeight appCommit profileSchemaVersion roboticsRelatedExperience knewRubiBeforeStudy rubiExposureBeforeStudy profileCompleted profileCompletedAtUtc analysisGroup groupingRuleVersion'.split(' ')
};
export function mockCollector(options={}){
 let writes=0,failed=false,held=false;const sheets={};
 function write(fn){writes++;if(!failed&&options.failAt===writes&&options.when!=='after'){failed=true;throw Error('injected write failure');}fn();if(!failed&&options.failAt===writes&&options.when==='after'){failed=true;throw Error('injected write failure after commit');}}
 class Sheet{
  constructor(name){this.name=name;this.data=[[...HEADERS[name]]];this.maxRows=1000;this.maxCols=HEADERS[name].length;}
  getName(){return this.name;}getLastRow(){for(let i=this.data.length-1;i>=0;i--)if(this.data[i]?.some(v=>v!==''&&v!==undefined))return i+1;return 0;}
  getLastColumn(){return this.data[0].length;}getMaxRows(){return this.maxRows;}getMaxColumns(){return this.maxCols;}
  insertRowsAfter(_,n){this.maxRows+=n;}insertColumnsAfter(_,n){this.maxCols+=n;}
  getRange(row,col,nr=1,nc=1){const self=this;return {
   getValues:()=>Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>self.data[row+r-1]?.[col+c-1]??'')),
   setValues(values){write(()=>values.forEach((v,r)=>{self.data[row+r-1]??=[];v.forEach((x,c)=>self.data[row+r-1][col+c-1]=x);}));return this;},
   createTextFinder(value){return {matchEntireCell(){return this;},findNext(){for(let i=0;i<nr;i++)if(String(self.data[row+i-1]?.[col-1]??'')===String(value))return {getRow:()=>row+i};return null;}};}
  };}
 }
 for(const name of Object.keys(HEADERS))sheets[name]=new Sheet(name);
 if(options.checkboxDefaults)for(let i=1;i<1000;i++){sheets.Sessions.data[i]??=[];sheets.Sessions.data[i][20]=false;}
 const context=vm.createContext({console,SpreadsheetApp:{openById:()=>({getSheetByName:n=>sheets[n]}),flush:()=>write(()=>{})},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(held)return false;held=true;return true;},releaseLock:()=>{held=false;}})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]}});
 vm.runInContext(fs.readFileSync(new URL('../../apps-script/Code.gs',import.meta.url),'utf8'),context);
 const call=(kind,payload)=>{context.__request={kind,payload};return JSON.parse(JSON.stringify(vm.runInContext('handleRequest_(__request)',context)));};
 const rows=name=>sheets[name].data.slice(1).filter(r=>r?.[0]).map(r=>Object.fromEntries(sheets[name].data[0].map((k,i)=>[k,r[i]??''])));
 return {call,rows,sheets,context,get writes(){return writes;},get held(){return held;}};
}
