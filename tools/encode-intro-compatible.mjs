import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Re-encode the same complete frame sequence, never another rollout.
const dir='public/media/rubi-intro-v1';
const m=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',`${dir}/${m.video}`,'-an','-c:v','libvpx-vp9','-crf','33','-b:v','0','-deadline','realtime','-cpu-used','6','-row-mt','1','-pix_fmt','yuv420p',`${dir}/rubi-intro.webm`]);
const data=await readFile(`${dir}/rubi-intro.webm`);
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',`${dir}/rubi-intro.webm`],{encoding:'utf8'}));
const video=probe.streams.find(s=>s.codec_type==='video');
assert.equal(video.width,m.width);assert.equal(video.height,m.height);assert.equal(video.codec_name,'vp9');
assert.ok(Math.abs(Number(probe.format.duration)-m.durationSeconds)<.15);
m.webm={file:'rubi-intro.webm',sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,codec:'vp9',durationSeconds:Number(probe.format.duration)};
await writeFile(`${dir}/manifest.json`,JSON.stringify(m,null,2)+'\n');
await mkdir('artifacts/intro-build',{recursive:true});
await copyFile(`${dir}/rubi-intro.webm`,'artifacts/rubi-intro.webm');
await copyFile(`${dir}/manifest.json`,'artifacts/intro-build/report.json');
console.log('INTRO_VP9_PASS',JSON.stringify(m.webm));
