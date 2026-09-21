import { readFile, rm } from 'node:fs/promises';
const study=JSON.parse(await readFile('dist/study.json','utf8'));
if(study.bundleBaseUrl==='./models/rubi-web/') { await readFile('dist/models/rubi-web/bundle.json'); await rm('dist/models/rubi',{recursive:true,force:true}); }
