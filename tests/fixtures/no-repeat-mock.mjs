import {buildNoRepeatCollector} from '../../tools/build-no-repeat-collector.mjs';
import {mockCollector} from './collector-mock.mjs';
import {mainPayload as legacyPayload,MAIN_SHEET} from './release-mock.mjs';
import * as n from '../../src/core/height-block-study-v9.ts';
export function noRepeatMock(options={}){
 return mockCollector({source:buildNoRepeatCollector(),handler:'releaseRequestV9_',targetId:MAIN_SHEET,properties:{RUBI_MAIN_COLLECTION_OPEN:'true'},...options});
}
export function noRepeatPayload(q,plan){
 return {...legacyPayload(q,plan),protocolVersion:n.BLOCK_PROTOCOL,adaptiveVersion:n.BLOCK_RULE,candidateSetId:n.CANDIDATE_SET,labelConditionVersion:n.BLOCK_LABEL_CONDITION,sessionId:'ui-check-test-v9'};
}
