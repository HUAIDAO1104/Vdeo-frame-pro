import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),folder=await mkdtemp(join(tmpdir(),'vfp-image-folder-'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 const path=resolve(root,'public','.'+new URL(req.url,'http://local').pathname);
 if(!path.startsWith(join(root,'public')+'/'))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const url='http://127.0.0.1:'+server.address().port+'/app.html';
try{
 await page.goto(url);
 const fixtures=await page.evaluate(()=>Array.from({length:70},(_,i)=>{
   const c=document.createElement('canvas');c.width=i===69?120:200;c.height=i===69?200:120;
   const x=c.getContext('2d');
   for(let n=0;n<24;n++){x.fillStyle=`hsl(${(i*79+n*47)%360} 75% ${30+(i*n)%45}%)`;x.fillRect(n%6*c.width/6,Math.floor(n/6)*c.height/4,c.width/6,c.height/4);}
   return c.toDataURL('image/png').split(',')[1];
 }));
 const source=join(folder,'图片素材');await mkdir(join(source,'子目录'),{recursive:true});
 for(let i=0;i<fixtures.length;i++)await writeFile(join(source,i===69?'子目录/竖图.png':`图片${i+1}.png`),Buffer.from(fixtures[i],'base64'));
 await writeFile(join(source,'重复.png'),Buffer.from(fixtures[0],'base64'));
 await writeFile(join(source,'损坏.png'),'broken-image');
 await writeFile(join(source,'说明.txt'),'ignored');
 await page.locator('#imageFolderInput').setInputFiles(source);
 await page.waitForFunction(()=>PROJECTS.list.length===1);
 assert.equal(await page.locator('#imageFolderPreview').isVisible(),true);
 assert.equal(await page.locator('#videoCaptureSettings').isVisible(),false);
 assert.equal(await page.locator('#vCon').isVisible(),false);
 assert.equal(await page.evaluate(()=>PROJECTS.list[0].imageSources.length),72);
 await page.locator('#imageFolderInput').setInputFiles(source);
 assert.equal(await page.evaluate(()=>PROJECTS.list.length),1);
 await page.evaluate(()=>{document.getElementById('mxf').value='1';document.getElementById('stt').value='999';});
 await page.locator('#salesKitBtn').click();
 await page.locator('#taskPauseBtn').click();
 await page.waitForFunction(()=>__vfpQueue.state==='paused');
 await page.locator('#taskStopBtn').click();await page.waitForFunction(()=>!__vfpQueue.active);
 assert.equal(await page.evaluate(()=>PROJECTS.list[0].generationStatus),'stopped');
 await page.locator('#salesKitBtn').click();
 await page.waitForFunction(()=>!__vfpQueue.active,null,{timeout:90000});
 const generated=await page.evaluate(()=>{const p=PROJECTS.list[0];return {status:p.generationStatus,error:p.generationError,count:p.frames.length,summary:p.selectionSummary,warnings:p.imageWarnings,portrait:p.frames.at(-1),batches:p.batches.length};});
 assert.equal(generated.status,'complete',JSON.stringify(generated.error));
 assert.equal(generated.count,71);assert.equal(generated.summary.representatives,70);
 assert.equal(generated.warnings.length,1);assert.equal(generated.batches,6);
 await page.screenshot({path:join(folder,'01-folder-complete.png'),fullPage:true});
 await page.locator('#taskResultsBtn').click();
 assert.equal(await page.locator('#unifiedDownloadBtn').isEnabled(),true);
 const downloadPromise=page.waitForEvent('download');await page.locator('#unifiedDownloadBtn').click();
 const zip=await readFile(await (await downloadPromise).path());
 const manifest=await page.evaluate(bytes=>JSON.parse(fflate.strFromU8(fflate.unzipSync(new Uint8Array(bytes))['图片清单.json'])),[...zip]);
 assert.equal(manifest.source.kind,'images');assert.equal(manifest.source.count,72);
 const scored=await page.evaluate(async()=>{
   const ids=[];
   const engine=FrameStudio.create({native:{enabled:false},badge:()=>null,scoreBatch:async frames=>{ids.push(...frames.map(f=>f.frameIdx));return frames.map(f=>({frameIdx:f.frameIdx,overall:.8}));}});
   const result=await engine.generate({...PROJECTS.list[0],id:999,runConfig:{apiKey:'mock-only',variants:1,maxFrames:1}}, {step:async(label,work)=>work(new AbortController().signal),progress:()=>{}});
   return {ids,summary:result.selectionSummary};
 });
 assert.equal(scored.ids.length,70);assert.equal(new Set(scored.ids).size,70);assert.equal(scored.summary.scored,70);
 await page.evaluate(async()=>{
   await importImageFolder([new File(['invalid'],'全部损坏.png',{type:'image/png'})]);
   const p=PROJECTS.list.at(-1);await startImageTasks([p]);
   if(p.generationStatus!=='failed'||p.batches.length)throw new Error('All-invalid folder must fail without assets');
   deleteProjectNoConfirm(p.id);
 });
 const history=await page.evaluate(async()=>{await saveWorkspaceNow();return WORKSPACE_SESSION_ID;});
 await page.reload();
 await page.evaluate(id=>restoreHistoryRecord(id),history);
 await page.waitForFunction(()=>PROJECTS.list.length===1&&S.frames.length===71);
 assert.equal(await page.evaluate(()=>PROJECTS.list[0].imageSources[0].blob instanceof Blob),true);
 await page.evaluate(()=>switchTab(0));
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(folder,'02-folder-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 const videoPath=join(folder,'混合队列.mp4');
 execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=12:d=2','-c:v','libx264','-pix_fmt','yuv420p',videoPath]);
 await page.locator('#vInput').setInputFiles(videoPath);
 await page.evaluate(()=>{switchProject(PROJECTS.list.at(-1).id);document.getElementById('stt').value='0';document.getElementById('mxf').value='3';});
 assert.equal(await page.locator('#vCon').isVisible(),true);
 assert.equal(await page.locator('#videoCaptureSettings').isHidden(),false);
 await page.locator('#salesKitBtn').click();
 await page.evaluate(()=>switchProject(PROJECTS.list[0].id));
 await page.waitForFunction(()=>!__vfpQueue.active,null,{timeout:90000});
 assert.equal(await page.evaluate(()=>PROJECTS.list.every(p=>p.generationStatus==='complete')),true);
 assert.equal(await page.locator('#vCon').isVisible(),false);
 assert.equal(await page.evaluate(()=>getSourceMeta().kind),'images');
 // Native command integration with real image bytes: no FFmpeg/video path involved.
 await page.evaluate(async bytes=>{
  const original=DESKTOP_NATIVE.invoke;globalThis.savedNativeInvoke=original;
  DESKTOP_NATIVE.enabled=true;DESKTOP_NATIVE.fileUrl=path=>'asset://localhost/'+path;
  DESKTOP_NATIVE.invoke=async(command,args)=>{
   if(command==='plugin:dialog|open')return 'C:/Pictures/素材';
   if(command==='import_image_folder')return {name:'桌面图片',folderPath:'C:/Pictures/素材',images:[{name:'照片.png',filePath:'C:/cache/photo.png',size:bytes.length}],skipped:[]};
   if(command==='read_cached_frame')return new Uint8Array(bytes);
   if(command==='save_workspace')return;
   throw new Error('Unexpected native command '+command);
  };
  await chooseImageFolder();
  const p=PROJECTS.list.at(-1);switchProject(p.id);
  await startImageTasks([p]);
 },[...Buffer.from(fixtures[0],'base64')]);
 assert.equal(await page.evaluate(()=>PROJECTS.list.at(-1).generationStatus),'complete');
 assert.equal(await page.evaluate(()=>PROJECTS.list.at(-1).localFrameCache),true);
 await page.evaluate(()=>{DESKTOP_NATIVE.enabled=false;DESKTOP_NATIVE.invoke=savedNativeInvoke;});
 assert.deepEqual(errors,[]);
 console.log('PASS image folders: nested import, duplicate guard, 71 candidates despite maxFrames=1, 70 representatives, pause/stop/restart, corrupt-image warning, ZIP, Blob history, mobile, native IPC');
 console.log('Screenshots:',folder);
}finally{await browser.close();await new Promise(r=>server.close(r));}
