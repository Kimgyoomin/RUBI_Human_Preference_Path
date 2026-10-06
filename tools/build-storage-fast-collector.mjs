import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStorageHotfixCollector} from './build-storage-hotfix-collector.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));

export function buildStorageFastCollector(){
  let code=buildStorageHotfixCollector();
  const before='const result = releaseRequestV10_(request);';
  if(code.split(before).length-1!==1)throw Error('storage fast source drift: '+before);
  code=code.replace(before,'const result = releaseRequestV11_(request);');
  code+='\n'+fs.readFileSync(path.join(ROOT,'apps-script/release/storage-fast-v11.gs'),'utf8');
  return '// COMPLETE v9 storage fast hotfix v11: replace the ENTIRE existing Apps Script Code.gs with this file.\n'
    +'// Same Sheet ID, deployment ID, /exec URL, protocol and public releaseVersion.\n'
    +code;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||'artifacts/RUBI_Collector_v9_storage_fast_v11_Code.gs';
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const built=buildStorageFastCollector();
  fs.writeFileSync(output,built);
  fs.writeFileSync(output.replace(/\.gs$/,'.txt'),built);
  console.log('STORAGE_FAST_COLLECTOR_BUILT',output);
}
