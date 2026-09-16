import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, extname, sep} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
execFileSync(process.execPath,['scripts/build-desktop-frontend.mjs'],{cwd:root});
const output=await mkdtemp(join(tmpdir(),'vfp-badge-export-'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'desktop-dist','.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(join(root,'desktop-dist')+sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function inspect(bytes){
  return page.evaluate(async bytes=>{
    const img=await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const x=c.getContext('2d');x.drawImage(img,0,0);img.close();
    // The supplied red ribbon occupies the top-right quarter, not the left side.
    const side=Math.floor(c.width*.25),p=x.getImageData(c.width-side,0,side,Math.min(side,c.height)).data;
    let red=0;for(let i=0;i<p.length;i+=4)if(p[i]>120&&p[i+1]<115&&p[i+2]<100)red++;
    return {redRatio:red/(p.length/4),width:c.width,height:c.height,left:[...x.getImageData(0,0,1,1).data]};
  },[...bytes]);
}
async function download(id){
  const pending=page.waitForEvent('download');await page.locator('#dl-'+id).click();
  return readFile(await (await pending).path());
}
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=640;c.height=360;
    c.getContext('2d').fillStyle='#194ea6';c.getContext('2d').fillRect(0,0,640,360);
    const blob=await new Promise(r=>c.toBlob(r));
    await importImageFolder([new File([blob],'蓝色素材.png',{type:'image/png'})]);
    await startImageTasks([PROJECTS.list[0]]);switchTab(1);EXPORT.format='png';
    const detail=S.batches.find(b=>b.isDetailLong);
    detail.detailLayout.rows=[1,3,2].map(cols=>({cols,frames:Array(cols).fill(0)}));
    await generateBatch(detail.id,true);
  });
  const ids=await page.evaluate(()=>S.batches.filter(b=>b.assetKind==='cover'||b.isDetailLong).map(b=>({id:b.id,detail:!!b.isDetailLong})));
  const cover=ids.find(b=>!b.detail),detail=ids.find(b=>b.detail);
  assert.equal((await inspect(await download(cover.id))).redRatio,0);
  await page.locator('#batch-'+cover.id+' label.tog').click();
  await page.waitForFunction(id=>!S.batches.find(b=>b.id===id).rendering,cover.id);
  const first=await download(cover.id);await writeFile(join(output,'cover-badge.png'),first);
  assert.ok((await inspect(first)).redRatio>.2,'downloaded cover must have a clearly visible 4K ribbon at the top right');
  await page.locator('#badge-'+detail.id).check();
  await page.waitForFunction(id=>!S.batches.find(b=>b.id===id).rendering,detail.id);
  for(const format of ['png','jpeg','webp'])for(const scale of [.5,1,2]){
    await page.evaluate(({format,scale})=>Object.assign(EXPORT,{format,scale}),{format,scale});
    for(const asset of [cover,detail]){
      const bytes=await download(asset.id),pixels=await inspect(bytes);
      assert.ok(pixels.redRatio>.2,`${format} ${scale}x ${asset.detail?'detail':'cover'} missing top-right badge`);
      if(asset.detail)assert.ok(pixels.height>pixels.width,'exercise a tall detail image');
      assert.ok(pixels.left[2]>140&&pixels.left[0]<50,'transparent badge margin must preserve source pixels');
      if(format==='png'&&scale===1&&asset.detail)await writeFile(join(output,'detail-badge.png'),bytes);
    }
  }
  await page.evaluate(()=>Object.assign(EXPORT,{format:'png',scale:1}));
  const zipDownload=page.waitForEvent('download');await page.locator('#unifiedDownloadBtn').click();
  const zip=await readFile(await (await zipDownload).path());
  const files=await page.evaluate(bytes=>{
    const files=fflate.unzipSync(new Uint8Array(bytes)),manifest=JSON.parse(fflate.strFromU8(files['图片清单.json']));
    return manifest.assets.map(a=>({id:a.id,bytes:[...files[a.file]]}));
  },[...zip]);
  for(const asset of [cover,detail])assert.ok((await inspect(files.find(f=>f.id===asset.id).bytes)).redRatio>.2,'ZIP must include the same badge');
  const history=await page.evaluate(async()=>{await saveWorkspaceNow();return WORKSPACE_SESSION_ID;});
  await page.reload();await page.evaluate(id=>restoreHistoryRecord(id),history);
  await page.waitForFunction(()=>S.batches.length>0&&S.batches.every(b=>b.canvas&&!b.rendering));
  await page.evaluate(()=>{switchTab(1);EXPORT.format='png';EXPORT.scale=1;});
  for(const asset of [cover,detail])assert.ok((await inspect(await download(asset.id))).redRatio>.2,'history must regenerate the correct badge without rescoring');
  await page.locator('#batch-'+cover.id+' label.tog').click();
  await page.waitForFunction(id=>!S.batches.find(b=>b.id===id).rendering,cover.id);
  assert.equal((await inspect(await download(cover.id))).redRatio,0,'switching off removes the exported badge');
  // A failed badge load must not silently export the previous unbadged canvas.
  const failure=await page.evaluate(async id=>{
    const b=S.batches.find(b=>b.id===id),image=S.badgeImg;S.badgeImg=null;b.hasBadge=true;
    let error;try{await generateBatch(id,true);}catch(e){error=e.message;}finally{S.badgeImg=image;}
    return {error,dirty:b.needsRender,downloadDisabled:document.getElementById('dl-'+id).disabled,zipDisabled:document.getElementById('unifiedDownloadBtn').disabled};
  },cover.id);
  assert.match(failure.error,/角标/);assert.equal(failure.dirty,true);assert.equal(failure.downloadDisabled,true);assert.equal(failure.zipDisabled,true);
  await page.evaluate(id=>generateBatch(id,true),cover.id);
  assert.ok((await inspect(await download(cover.id))).redRatio>.2,'retry restores valid badged output');
  // Single covers share the same real download pipeline, with independent
  // layout drafts so switching back cannot discard the edited four images.
  const singleId=await page.evaluate(async()=>{
    const files=[];
    for(const [i,w,h,color] of [[0,640,360,'#194ea6'],[1,320,640,'#167fca'],[2,800,400,'#208942'],[3,400,400,'#dbc623']]){
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,w,h);
      files.push(new File([await new Promise(r=>c.toBlob(r))],i+'.png',{type:'image/png'}));
    }
    await importImageFolder(files);const project=PROJECTS.list.at(-1);switchProject(project.id);await startImageTasks([project]);switchTab(1);
    const b=S.batches.find(b=>b.assetKind==='cover');b.cells=[0,1,2,3];b.crops={2:{scale:1.25,ox:0,oy:0}};
    await generateBatch(b.id,true);return b.id;
  });
  const card=page.locator('#batch-'+singleId);
  const waitCover=()=>page.waitForFunction(id=>{const b=S.batches.find(b=>b.id===id);return !b.rendering&&!b.needsRender;},singleId);
  await card.locator('[data-cover-layout="single"]').click();await waitCover();
  assert.equal(await card.locator('.cell').count(),1);
  let pixels=await inspect(await download(singleId));assert.equal(pixels.width,640);assert.equal(pixels.height,360);
  await card.locator('label.tog').click();await waitCover();
  assert.ok((await inspect(await download(singleId))).redRatio>.2,'single image includes the badge');
  await card.locator('.cell').click({position:{x:10,y:10}});
  await page.locator('#framePicker [data-frame-index="1"]').click();await waitCover();
  pixels=await inspect(await download(singleId));assert.equal(pixels.width,320);assert.equal(pixels.height,640);assert.ok(pixels.redRatio>.2);
  await card.locator('.cell').hover();await card.locator('.cell-crop-btn').click();
  assert.equal(await page.evaluate(()=>_cropCtx.cellAR),.5);
  await page.locator('#cropZoom').focus();await page.locator('#cropZoom').press('Home');
  for(let i=0;i<30;i++)await page.locator('#cropZoom').press('ArrowRight');
  await page.locator('#cropEditor button', {hasText:'应用'}).click();await waitCover();
  await card.locator('[data-cover-layout="grid"]').click();await waitCover();
  assert.deepEqual(await page.evaluate(id=>S.batches.find(b=>b.id===id).cells,singleId),[0,1,2,3]);
  assert.equal(await page.evaluate(id=>S.batches.find(b=>b.id===id).crops[2].scale,singleId),1.25);
  await page.evaluate(()=>undo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering));
  assert.equal(await card.locator('.cell').count(),1);assert.equal(await card.locator('[data-cover-layout="single"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(id=>S.batches.find(b=>b.id===id).crops[0].scale,singleId),1.3);
  await page.evaluate(()=>redo());await page.waitForFunction(()=>S.batches.every(b=>!b.rendering));assert.equal(await card.locator('.cell').count(),4);
  await card.locator('[data-cover-layout="single"]').click();await waitCover();
  assert.equal(await page.evaluate(id=>S.batches.find(b=>b.id===id).cells[0],singleId),1);
  const singleHistory=await page.evaluate(async()=>{await saveWorkspaceNow();return WORKSPACE_SESSION_ID;});
  await page.reload();await page.evaluate(id=>restoreHistoryRecord(id),singleHistory);
  await page.waitForFunction(id=>S.batches.some(b=>b.id===id)&&S.batches.every(b=>b.canvas&&!b.rendering),singleId);
  await page.evaluate(()=>{switchTab(1);EXPORT.format='png';EXPORT.scale=1;});
  assert.equal(await card.locator('.cell').count(),1);
  pixels=await inspect(await download(singleId));assert.equal(pixels.width,320);assert.equal(pixels.height,640);assert.ok(pixels.redRatio>.2);
  await card.screenshot({path:join(output,'single-cover-card.png')});
  const singleZipPending=page.waitForEvent('download');await page.locator('#unifiedDownloadBtn').click();
  const singleZip=await readFile(await (await singleZipPending).path());
  const singleBytes=await page.evaluate(({bytes,id})=>{const files=fflate.unzipSync(new Uint8Array(bytes)),m=JSON.parse(fflate.strFromU8(files['图片清单.json']));return [...files[m.assets.find(a=>a.id===id).file]];},{bytes:[...singleZip],id:singleId});
  assert.equal((await inspect(singleBytes)).width,320);assert.ok((await inspect(singleBytes)).redRatio>.2);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await card.locator('[data-cover-layout="grid"]').click();await waitCover();
  assert.deepEqual(await page.evaluate(id=>S.batches.find(b=>b.id===id).cells,singleId),[0,1,2,3]);
  console.log('PASS single cover: layout toggle, portrait replacement, correct crop aspect, independent grid/single drafts, undo/redo, badge downloads, ZIP, history and mobile');
  assert.deepEqual(errors,[]);
  console.log('PASS packaged frontend: actual PNG/JPEG/WebP downloads at 0.5x/1x/2x, cover/detail/ZIP top-right badge pixels, toggle off, load failure and retry');
  console.log('Exported images:',output);
}catch(error){console.log('Export evidence:',output);throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
