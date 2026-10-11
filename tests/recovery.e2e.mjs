import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root=resolve(import.meta.dirname,'..'),folder=await mkdtemp(join(tmpdir(),'frame-recovery-'));
const shots=process.env.QA_SCREENSHOTS||folder;await mkdir(shots,{recursive:true});
const video=join(folder,'城市素材.mp4');
execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=12:d=3','-c:v','libx264','-pix_fmt','yuv420p',video]);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'public','.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(join(root,'public')+sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const idle=()=>page.waitForFunction(()=>!__vfpQueue.active&&!generationStarting);
try{
  const response=await page.goto('http://127.0.0.1:'+server.address().port+'/app.html');
  assert.equal(response.status(),200,'test server must serve the app on this platform');
  await page.locator('#vInput').setInputFiles(video);
  await page.waitForFunction(()=>PROJECTS.list.length===1);
  await page.evaluate(()=>{
    const p=PROJECTS.list[0];PROJECTS.list.push({...p,id:2,name:'第二个任务',batches:[],frames:[],imgCache:new Map()});renderProjectTabs();
    window.realProcess=__vfpQueue.process;
    __vfpQueue.process=(p,ctx)=>ctx.step('AI 评分 1-8 / 16',async()=>{throw new Error('测试服务暂时不可用');});
  });
  await page.locator('#salesKitBtn').click();await idle();
  await page.waitForFunction(()=>document.getElementById('view1').classList.contains('active'));
  assert.ok(await page.locator('#resultProjectFailureReason').textContent().then(t=>t.includes('测试服务暂时不可用')));
  assert.equal(await page.locator('#taskRetryFailedBtn').isEnabled(),true);
  console.log('PASS all-failed batch opens results and exposes retry-all with error reasons');
  await page.evaluate(()=>{
    window.calls=[];
    __vfpQueue.process=(p,ctx)=>ctx.step('AI 评分 1-8 / 16',signal=>new Promise((resolve,reject)=>{
      calls.push(p.id);ctx.progress(65,'AI 评分 1-8 / 16');
      window.finishTask=()=>resolve({});signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true});
    }));
  });
  await page.locator('#resultProjectFailure').getByRole('button',{name:'重试当前项目'}).click();
  await page.waitForFunction(()=>__vfpQueue.current?.id===1);
  await page.waitForTimeout(1200);
  assert.notEqual(await page.locator('#taskCurrentTime').textContent(),'00:00');
  assert.match(await page.locator('#taskQueueStep').textContent(),/AI 评分 1-8/);
  await page.locator('#taskRetryFailedBtn').click();
  await page.waitForFunction(()=>__vfpQueue.pending.length===1);
  assert.deepEqual(await page.evaluate(()=>__vfpQueue.pending.map(p=>p.id)),[2]);
  for(const width of [1280,1440,1920]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:join(shots,'progress-'+width+'.png')});
  }
  await page.locator('#taskPauseBtn').click();
  const paused=await page.locator('#taskBatchTime').textContent();await page.waitForTimeout(1200);
  assert.equal(await page.locator('#taskBatchTime').textContent(),paused);
  await page.locator('#taskStopBtn').click();await idle();
  assert.deepEqual(await page.evaluate(()=>PROJECTS.list.map(p=>p.generationStatus)),['stopped','stopped']);
  assert.equal(await page.locator('#taskResumeAllBtn').isEnabled(),true);
  console.log('PASS retry appends without locks, live clocks advance, pause freezes, stop exposes resume-all');
  await page.evaluate(()=>{__vfpQueue.process=realProcess;});
  await page.locator('#taskResumeAllBtn').click();await idle();
  assert.deepEqual(await page.evaluate(()=>PROJECTS.list.map(p=>p.generationStatus)),['complete','complete']);
  await page.evaluate(()=>switchResultProject(1));
  const id=await page.evaluate(()=>S.batches.find(b=>b.isDetailLong).id);
  await page.locator('#herotitle-'+id).fill('中华文明 · 古今穿梭与时代变迁');
  await page.locator('#hero-height-'+id).evaluate(el=>el.closest('details').open=true);
  await page.locator('#hero-height-'+id).fill('20');
  await page.locator('#hero-size-'+id).fill('6');
  await page.locator('#hero-fit-'+id).selectOption('single');
  await page.locator('#hero-align-'+id).selectOption('left');
  await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  const geometry=await page.evaluate(id=>{
    const b=S.batches.find(b=>b.id===id),cx=b.canvas.getContext('2d');
    const sample=y=>[...cx.getImageData(1,y,1,1).data];
    return {style:b.heroStyle,top:sample(Math.floor(b.canvas.width*.19)),bottom:sample(Math.floor(b.canvas.width*.21)),width:b.canvas.width};
  },id);
  assert.equal(geometry.style.autoHeight,false);assert.equal(geometry.style.bandHeight,20);
  assert.equal(geometry.style.fontSize,6);assert.equal(geometry.style.align,'left');
  assert.ok(geometry.top[0]>geometry.top[1]*1.5);assert.notDeepEqual(geometry.top,geometry.bottom);
  await page.locator('#hero-auto-'+id).check();
  await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  await page.evaluate(()=>undo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  assert.equal(await page.locator('#hero-auto-'+id).isChecked(),false);
  await page.evaluate(()=>redo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  assert.equal(await page.locator('#hero-auto-'+id).isChecked(),true);
  await page.locator('#hero-auto-'+id).uncheck();await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  const stylePanel=page.locator('#hero-height-'+id).locator('..').locator('..').locator('..');
  await stylePanel.getByRole('button',{name:'保存为默认',exact:true}).click();
  await stylePanel.getByRole('button',{name:'应用到本项目全部详情',exact:true}).click();
  await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  assert.equal(await page.evaluate(()=>S.batches.filter(b=>b.isDetailLong).every(b=>b.heroStyle.bandHeight===20)),true);
  assert.equal(await page.evaluate(()=>S.batches.filter(b=>b.isDetailLong&&b.heroTitle).length),1);
  await page.evaluate(()=>undo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  assert.equal(await page.evaluate(()=>S.batches.filter(b=>b.isDetailLong).at(-1).heroStyle.bandHeight),12);
  await page.evaluate(()=>redo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering&&!b.needsRender));
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#herotitle-'+id).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(shots,'title-controls.png')});
  const history=await page.evaluate(async()=>{await saveWorkspaceNow();return {id:WORKSPACE_SESSION_ID,timing:PROJECTS.list[0].generationTiming.elapsedMs};});
  await page.reload();await page.evaluate(id=>restoreHistoryRecord(id),history.id);
  await page.evaluate(()=>switchResultProject(1));await page.waitForFunction(()=>S.batches.every(b=>b.canvas));
  assert.equal(await page.evaluate(id=>S.batches.find(b=>b.id===id).heroStyle.bandHeight,id),20);
  assert.equal(await page.evaluate(()=>PROJECTS.list[0].generationTiming.elapsedMs),history.timing);
  console.log('PASS unfinished batch resumes; title styling changes actual pixels, undo/redo and history retain settings and timing');
  assert.equal(await page.evaluate(()=>readUserDefaults().detailTitleStyle.bandHeight),20);
  await page.evaluate(()=>persistUserDefaults());
  assert.equal(await page.evaluate(()=>readUserDefaults().detailTitleStyle.fontSize),6);
  await page.locator('#railBtn0').click();
  await page.locator('#vInput').setInputFiles({name:'重启后的新素材.mp4',mimeType:'video/mp4',buffer:await readFile(video)});
  await page.waitForFunction(()=>PROJECTS.list.length===3);
  await page.evaluate(()=>startImageTasks([PROJECTS.list.at(-1)]));
  assert.equal(await page.evaluate(()=>PROJECTS.list.at(-1).batches.filter(b=>b.isDetailLong).every(b=>b.heroStyle.bandHeight===20&&b.heroStyle.fontSize===6&&b.heroStyle.fit==='single'&&b.heroStyle.align==='left'&&!b.heroStyle.autoHeight&&!b.heroTitle)),true);
  await page.evaluate(()=>resetUserDefaults());
  assert.equal(await page.evaluate(()=>readUserDefaults().detailTitleStyle.bandHeight),12);
  console.log('PASS saved title defaults survive reload and other setting saves, apply to every new detail, preserve text, support bulk undo and explicit reset');
  assert.deepEqual(errors,[]);
  console.log('Screenshots:',shots);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
