import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildNoRepeatCollector} from './build-no-repeat-collector.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));

export function buildStorageHotfixCollector(){
  let code=buildNoRepeatCollector();
  const before='const result = releaseRequestV9_(request);';
  if(code.split(before).length-1!==1)throw Error('storage hotfix source drift: '+before);
  code=code.replace(before,'const result = releaseRequestV10_(request);');
  code+='\n'+fs.readFileSync(path.join(ROOT,'apps-script/release/storage-hotfix-v10.gs'),'utf8');
  return '// COMPLETE v9 storage hotfix v10: replace the ENTIRE existing Apps Script Code.gs with this file.\n'
    +'// Keeps the same spreadsheet ID, deployment ID, /exec URL, v9 protocol and public releaseVersion.\n'
    +code;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||'artifacts/RUBI_Collector_v9_storage_hotfix_v10_Code.gs';
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const built=buildStorageHotfixCollector();
  fs.writeFileSync(output,built);
  fs.writeFileSync(output.replace(/\.gs$/,'.txt'),built);
  console.log('STORAGE_HOTFIX_COLLECTOR_BUILT',output);
}
