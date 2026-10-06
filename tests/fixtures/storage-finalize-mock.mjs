import {buildStorageFinalizeCollector} from '../../tools/build-storage-finalize-collector.mjs';
import {mockCollector} from './collector-mock.mjs';
import {MAIN_SHEET} from './release-mock.mjs';

export function storageFinalizeMock(options={}){
  return mockCollector({
    source:buildStorageFinalizeCollector(),
    handler:'releaseRequestV12_',
    targetId:MAIN_SHEET,
    properties:{RUBI_MAIN_COLLECTION_OPEN:'true'},
    ...options
  });
}
