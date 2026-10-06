import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStorageFastCollector} from './build-storage-fast-collector.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));

export function buildStorageFinalizeCollector(){
  let code=buildStorageFastCollector();
  const before='const result = releaseRequestV11_(request);';
  if(code.split(before).length-1!==1)throw Error('storage finalize source drift: '+before);
  code=code.replace(before,'const result = releaseRequestV12_(request);');
  code+='\n'+fs.readFileSync(path.join(ROOT,'apps-script/release/storage-finalize-v12.gs'),'utf8');
  return '// COMPLETE v9 storage finalize hotfix v12: replace the ENTIRE existing Apps Script Code.gs with this file.\n'
    +'// Same Sheet ID, deployment ID, /exec URL, protocol and public releaseVersion.\n'
    +code;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||'artifacts/RUBI_Collector_v9_storage_finalize_v12_Code.gs';
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const built=buildStorageFinalizeCollector();
  fs.writeFileSync(output,built);
  fs.writeFileSync(output.replace(/\.gs$/,'.txt'),built);
  console.log('STORAGE_FINALIZE_COLLECTOR_BUILT',output);
}
