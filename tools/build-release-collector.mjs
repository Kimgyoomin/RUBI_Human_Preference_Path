import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export function buildReleaseCollector(){
  let code=fs.readFileSync(path.join(ROOT,'apps-script/Code.gs'),'utf8');
  const replace=(before,after,count=1)=>{
    if(code.split(before).length-1!==count)throw Error('Release collector base drift: '+before);
    code=code.split(before).join(after);
  };
  replace("ALLOWED_EXPERIMENTS: ['rubi-hpp-collector-v3', 'rubi-hpp-block-pilot-v7']", "ALLOWED_EXPERIMENTS: ['rubi-hpp-collector-v3', 'rubi-hpp-block-pilot-v7', 'rubi-hpp-main-v1']");
  replace('const result = handleRequest_(request);','const result = releaseRequest_(request);');
  replace('const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);','const ss=SpreadsheetApp.openById(releaseTarget_(payload));');
  replace('SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),','SpreadsheetApp.openById(releaseTarget_(p)),',2);
  replace("p.experimentId!=='rubi-hpp-block-pilot-v7'||", "!['rubi-hpp-block-pilot-v7','rubi-hpp-main-v1'].includes(p.experimentId)||");
  // The exact deployed browser scheduler is included, not a separately approximated rule.
  const ts=fs.readFileSync(path.join(ROOT,'src/core/height-block-study.ts'),'utf8');
  const js=stripTypeScriptTypes(ts,{mode:'strip'}).replace(/^export\s+/gm,'');
  code+='\nconst releaseScheduler_ = (() => {\n'+js+'\nreturn {createBlockPlan,nextBlockQuestion};\n})();\n';
  code+=fs.readFileSync(path.join(ROOT,'apps-script/release/guard.gs'),'utf8');
  return '// GENERATED: paste this ENTIRE file into the existing Apps Script Code.gs.\n// Main intake is CLOSED until owner runs openMainCollection(). Pilot routing is unchanged.\n'+code;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||'artifacts/RUBI_Collector_release_v8_Code.gs';
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buildReleaseCollector());
  console.log('RELEASE_COLLECTOR_BUILT',output);
}
