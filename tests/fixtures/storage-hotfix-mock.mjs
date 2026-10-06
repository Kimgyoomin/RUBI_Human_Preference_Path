import {buildStorageHotfixCollector} from '../../tools/build-storage-hotfix-collector.mjs';
import {mockCollector} from './collector-mock.mjs';
import {MAIN_SHEET} from './release-mock.mjs';
export function storageHotfixMock(options={}){
  return mockCollector({
    source:buildStorageHotfixCollector(),
    handler:'releaseRequestV10_',
    targetId:MAIN_SHEET,
    properties:{RUBI_MAIN_COLLECTION_OPEN:'true'},
    ...options
  });
}
