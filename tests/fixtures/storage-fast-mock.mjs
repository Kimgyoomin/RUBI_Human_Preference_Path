import {buildStorageFastCollector} from '../../tools/build-storage-fast-collector.mjs';
import {mockCollector} from './collector-mock.mjs';
import {MAIN_SHEET} from './release-mock.mjs';

export function storageFastMock(options={}){
  return mockCollector({
    source:buildStorageFastCollector(),
    handler:'releaseRequestV11_',
    targetId:MAIN_SHEET,
    properties:{RUBI_MAIN_COLLECTION_OPEN:'true'},
    ...options
  });
}
