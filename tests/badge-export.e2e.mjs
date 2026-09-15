import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, extname} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
execFileSync(process.execPath,['scripts/build-desktop-frontend.mjs'],{cwd:root});
const output=await mkdtemp(join(tmpdir(),'vfp-badge-export-'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const path=resolve(root,'desktop-dist','.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(join(root,'desktop-dist')+'/'))return res.writeHead(403).end();
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
  assert.deepEqual(errors,[]);
  console.log('PASS packaged frontend: actual PNG/JPEG/WebP downloads at 0.5x/1x/2x, cover/detail/ZIP top-right badge pixels, toggle off, load failure and retry');
  console.log('Exported images:',output);
}catch(error){console.log('Export evidence:',output);throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
