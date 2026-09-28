import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {buildReleaseCollector} from './build-release-collector.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export function buildNoRepeatCollector(){
  let code=buildReleaseCollector();
  const replace=(a,b,n=1)=>{if(code.split(a).length-1!==n)throw Error('v9 source drift: '+a);code=code.split(a).join(b);};
  replace('const result = releaseRequest_(request);','const result = releaseRequestV9_(request);');
  replace("const blocked=p.protocolVersion==='height-blocks-binary-v7';", "const blocked=['height-blocks-binary-v7','height-blocks-no-repeat-v9'].includes(p.protocolVersion);");
  replace("if(p.protocolVersion==='height-blocks-binary-v7'||p.experimentId==='rubi-hpp-block-pilot-v7'){", "if(['height-blocks-binary-v7','height-blocks-no-repeat-v9'].includes(p.protocolVersion)||p.experimentId==='rubi-hpp-block-pilot-v7'){");
  replace('function validateBlock_(p){','function validateLegacyBlock_(p){');
  const ts=fs.readFileSync(path.join(ROOT,'src/core/height-block-study-v9.ts'),'utf8');
  const js=stripTypeScriptTypes(ts,{mode:'strip'}).replace(/^export\s+/gm,'');
  code+='\nconst noRepeatScheduler_ = (() => {\n'+js+'\nreturn {createBlockPlan,nextBlockQuestion,DETOURS_MM,BLOCK_PROTOCOL,BLOCK_RULE,CANDIDATE_SET,BLOCK_LABEL_CONDITION};\n})();\n';
  code+=fs.readFileSync(path.join(ROOT,'apps-script/release/no-repeat-v9.gs'),'utf8');
  return '// COMPLETE v9 collector: replace Code.gs in the SAME deployed Apps Script project.\n// Existing v7 sessions, sheet IDs and RUBI_MAIN_COLLECTION_OPEN property are preserved.\n'+code;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2]||'artifacts/RUBI_Collector_no_repeat_v9_Code.gs';
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buildNoRepeatCollector());
  fs.writeFileSync(output.replace(/\.gs$/,'.txt'),buildNoRepeatCollector());
  console.log('NO_REPEAT_COLLECTOR_BUILT',output);
}
