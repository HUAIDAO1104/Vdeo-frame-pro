import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, extname, sep} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
execFileSync(process.execPath,['scripts/build-desktop-frontend.mjs'],{cwd:root});
const output=await mkdtemp(join(tmpdir(),'vfp-collage-export-'));
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
  assert.equal(await page.locator('#coverMode').inputValue(),'grid');assert.equal(await page.locator('#includeDetail').isChecked(),true);assert.equal(await page.locator('#coverAspect').inputValue(),'16:9');
  await page.locator('#coverMode').selectOption('collage');
  assert.equal(await page.locator('#includeDetail').isChecked(),false);
  assert.equal(await page.locator('#coverAspect').inputValue(),'8:9');
  await page.evaluate(async()=>{
    const colors=['#164a99','#298447','#bd8422','#772f99','#25888c','#99382f'],files=[];
    for(let i=0;i<6;i++){
      const c=document.createElement('canvas');c.width=360;c.height=640;const x=c.getContext('2d');
      x.fillStyle=colors[i];x.fillRect(0,0,360,640);x.fillStyle='#fff';x.font='bold 110px sans-serif';x.fillText(String(i+1),145,340);
      x.fillStyle='#ded8b6';x.fillRect(0,0,40,640);x.fillStyle='#10141a';x.fillRect(320,0,40,640);
      files.push(new File([await new Promise(r=>c.toBlob(r))],i+'.png',{type:'image/png'}));
    }
    await importImageFolder(files);await startImageTasks([PROJECTS.list[0]]);switchTab(1);EXPORT.format='png';
  });
  const data=await page.evaluate(()=>({status:PROJECTS.list[0].generationStatus,detail:S.finalDetailId,assets:S.batches.map(b=>({id:b.id,kind:b.assetKind,cells:b.cells}))}));
  assert.equal(data.status,'complete');assert.equal(data.detail,null);assert.equal(data.assets.length,3);
  for(const asset of data.assets){assert.equal(asset.kind,'cover');assert.equal(new Set(asset.cells).size,6);}
  const id=data.assets[0].id,card=page.locator('#batch-'+id);
  const wait=()=>page.waitForFunction(id=>{const b=S.batches.find(b=>b.id===id);return !b.rendering&&!b.needsRender;},id);
  const state=()=>page.evaluate(id=>{const b=S.batches.find(b=>b.id===id);return {cells:b.cells,cols:b.cols,rows:b.rows,aspect:b.coverAspect,crops:b.crops,mode:b.coverMode};},id);
  assert.equal(await card.locator('.cell').count(),6);assert.equal(await page.locator('#unifiedDownloadBtn').isEnabled(),true);
  let pixels=await inspect(await download(id));assert.equal(pixels.width,1600);assert.equal(pixels.height,1800);
  const gradient=await page.evaluate(async id=>{
    const b=S.batches.find(b=>b.id===id);b.cells=[0,1,2,3,4,5];await generateBatch(id,true);
    const original=b.cells.slice(),g=FrameStudio.assetGeometry(b,S.frames),ctx=b.canvas.getContext('2d');
    const p=(x,y)=>[...ctx.getImageData(x,y,1,1).data].slice(0,3);
    const top=p(10,10),bottom=p(1590,1790),palette=b.canvas.coverBackground;
    const gapX=Math.round((g.slots[0].x+g.slots[0].w+g.slots[1].x)/2),gapY=Math.round(g.slots[0].y+g.slots[0].h*.5);
    const gap=p(gapX,gapY),style=document.getElementById('cgrid-'+id).style.backgroundImage;
    const c=document.createElement('canvas');c.width=360;c.height=640;const x=c.getContext('2d');x.fillStyle='#ec12ca';x.fillRect(0,0,360,640);
    S.frames.push({w:360,h:640,idx:S.frames.length,dataUrl:c.toDataURL(),time:0});
    await generateBatch(id,true);const unchanged=JSON.stringify(palette)===JSON.stringify(b.canvas.coverBackground);
    pushHistory();b.cells=Array(6).fill(S.frames.length-1);refreshCoverCard(b);await generateBatch(id,true);
    const changed=[...b.canvas.getContext('2d').getImageData(10,10,1,1).data].slice(0,3);
    undo();await new Promise(resolve=>{const poll=()=>b.rendering?setTimeout(poll,20):resolve();poll();});
    return {top,bottom,palette,gap,style,unchanged,changed,restored:JSON.stringify(original)===JSON.stringify(b.cells),restoredPalette:b.canvas.coverBackground};
  },id);
  assert.notDeepEqual(gradient.top,gradient.bottom);assert.equal(gradient.unchanged,true,'unselected source must not change the palette');
  assert.ok(gradient.changed[0]>220&&gradient.changed[1]<30&&gradient.changed[2]>180,'selected magenta picture changes gap background');
  assert.equal(gradient.restored,true);assert.deepEqual(gradient.restoredPalette,gradient.palette);
  assert.match(gradient.style,/url\("data:image\/png;base64,/);
  const gradientBytes=await download(id);await writeFile(join(output,'six-portrait-gradient.png'),gradientBytes);
  const gapCheck=await page.evaluate(async({bytes,id})=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)])),c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    c.getContext('2d').drawImage(image,0,0);image.close();const b=S.batches.find(b=>b.id===id),g=FrameStudio.assetGeometry(b,S.frames);
    const x=Math.round((g.slots[0].x+g.slots[0].w+g.slots[1].x)/2),y=Math.round(g.slots[0].y+g.slots[0].h*.5);
    return [...c.getContext('2d').getImageData(x,y,1,1).data].slice(0,3);
  },{bytes:[...gradientBytes],id});assert.deepEqual(gapCheck,gradient.gap,'downloaded gutters match the rendered gradient');
  // All six shadows share the same controls; preview backdrop and exported gaps agree.
  const shadowSample=()=>page.evaluate(async id=>{
    const b=S.batches.find(b=>b.id===id),g=FrameStudio.assetGeometry(b,S.frames),ctx=b.canvas.getContext('2d');
    const backdrop=new Image();backdrop.src=b.canvas.coverBackdrop;await backdrop.decode();
    const c=document.createElement('canvas');c.width=g.width;c.height=g.height;const x=c.getContext('2d');x.drawImage(backdrop,0,0);
    const probes=g.slots.map(s=>[Math.min(g.width-1,s.x+s.w+8),Math.round(s.y+s.h*.5)]);
    return {settings:b.coverShadow,palette:b.canvas.coverBackground,probes,
      output:probes.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]),preview:probes.map(([a,b])=>[...x.getImageData(a,b,1,1).data])};
  },id);
  const defaults=await shadowSample();assert.deepEqual(defaults.settings,{size:24,distance:12});assert.deepEqual(defaults.preview,defaults.output);
  await card.screenshot({path:join(output,'six-portrait-default-shadow.png')});
  await card.locator('#shadow-size-'+id).focus();await card.locator('#shadow-size-'+id).press('Home');await wait();
  await card.locator('#shadow-distance-'+id).focus();await card.locator('#shadow-distance-'+id).press('Home');await wait();
  const off=await shadowSample();assert.deepEqual(off.settings,{size:0,distance:0});
  for(let i=0;i<6;i++)assert.ok(defaults.output[i].slice(0,3).reduce((n,v)=>n+v,0)<off.output[i].slice(0,3).reduce((n,v)=>n+v,0),'each selected image casts a shadow');
  await card.locator('#shadow-size-'+id).press('End');await wait();
  await card.locator('#shadow-distance-'+id).press('End');await wait();
  const adjusted=await shadowSample();assert.deepEqual(adjusted.settings,{size:60,distance:40});assert.deepEqual(adjusted.palette,defaults.palette);assert.deepEqual(adjusted.preview,adjusted.output);
  await page.evaluate(()=>undo());await wait();assert.equal(await card.locator('#shadow-distance-'+id).inputValue(),'0');
  await page.evaluate(()=>redo());await wait();assert.equal(await card.locator('#shadow-distance-'+id).inputValue(),'40');assert.deepEqual((await shadowSample()).output,adjusted.output);
  const shadowBytes=await download(id);
  const exportedShadows=await page.evaluate(async({bytes,probes})=>{
    const img=await createImageBitmap(new Blob([new Uint8Array(bytes)])),c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);img.close();
    return probes.map(([a,b])=>[...x.getImageData(a,b,1,1).data]);
  },{bytes:[...shadowBytes],probes:adjusted.probes});assert.deepEqual(exportedShadows,adjusted.output);
  // Editing happens through actual card controls and pointer actions.
  await card.locator('.cell').first().click({position:{x:10,y:20}});
  await page.locator('#framePicker [data-frame-index="5"]').click();await wait();assert.equal((await state()).cells[0],5);
  const before=(await state()).cells;
  await card.locator('.collage-grid').scrollIntoViewIfNeeded();
  const a=await card.locator('.cell').nth(0).boundingBox(),b=await card.locator('.cell').nth(5).boundingBox();
  await page.mouse.move(a.x+a.width*.5,a.y+a.height*.55);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.5,b.y+b.height*.55,{steps:15});await page.mouse.up();await wait();
  const after=(await state()).cells;assert.equal(after[0],before[5]);assert.equal(after[5],before[0]);
  assert.equal(await card.locator('[data-cover-aspect-select]').count(),0);
  assert.equal(await page.locator('#coverAspect').isDisabled(),true);
  pixels=await inspect(await download(id));assert.equal(pixels.width*9,pixels.height*8);
  await card.locator('[data-cover-crop]').click();
  assert.ok(Math.abs(await page.evaluate(()=>_cropCtx.cellAR)-9/16)<.002);
  await page.locator('#cropZoom').focus();await page.locator('#cropZoom').press('Home');
  for(let i=0;i<25;i++)await page.locator('#cropZoom').press('ArrowRight');
  await page.locator('#cropEditor button',{hasText:'应用'}).click();await wait();
  assert.equal((await state()).crops[0].scale,1.25);
  const six=(await state()).cells;
  await card.locator('[data-cover-count]').selectOption('5');await wait();
  assert.equal(await card.locator('.cell').count(),5);
  const boxes=await card.locator('.cell').evaluateAll(cells=>cells.map(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left})));
  assert.ok(Math.abs(boxes[3].width-boxes[0].width)<1,'last row keeps portrait cells and centers them');assert.ok(boxes[3].left>boxes[0].left);
  await card.locator('[data-cover-count]').selectOption('6');await wait();
  assert.deepEqual((await state()).cells,six);assert.equal((await state()).crops[0].scale,1.25);
  await card.locator('[data-cover-cols]').selectOption('2');await wait();assert.equal((await state()).rows,3);
  await page.evaluate(()=>undo());await wait();assert.equal((await state()).cols,3);
  await page.evaluate(()=>redo());await wait();assert.equal((await state()).cols,2);
  await card.locator('[data-cover-cols]').selectOption('3');await wait();
  await card.locator('[data-cover-layout="single"]').click();await wait();assert.equal(await card.locator('.cell').count(),1);
  await card.locator('[data-cover-layout="collage"]').click();await wait();assert.deepEqual((await state()).cells,six);assert.equal((await state()).aspect,'8:9');
  // Fullscreen hit targets follow the same geometry, including an incomplete row.
  await card.locator('[data-cover-count]').selectOption('5');await wait();
  await card.getByRole('button',{name:'放大',exact:true}).click();assert.equal(await page.locator('#pmCellOverlay .pm-cell').count(),5);
  await page.locator('#pmCellOverlay .pm-cell').nth(4).hover();
  await page.locator('#pmCellOverlay .pm-cell').nth(4).locator('[data-act="replace"]').click();
  await page.locator('#framePicker [data-frame-index="2"]').click();await wait();assert.equal((await state()).cells[4],2);
  await page.evaluate(()=>closePreviewModal());await card.locator('[data-cover-count]').selectOption('6');await wait();
  const noBadge=await download(id);await card.locator('label.tog').click();await wait();
  const withBadge=await download(id);assert.notDeepEqual(withBadge,noBadge);
  const delta=await page.evaluate(async({a,b})=>{
    const values=[];for(const bytes of [a,b]){const img=await createImageBitmap(new Blob([new Uint8Array(bytes)]));const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);values.push(x.getImageData(c.width*.75,0,c.width*.25,c.width*.25).data);img.close();}
    let changed=0;for(let i=0;i<values[0].length;i+=4)if(Math.abs(values[0][i]-values[1][i])+Math.abs(values[0][i+1]-values[1][i+1])>40)changed++;return changed/(values[0].length/4);
  },{a:[...noBadge],b:[...withBadge]});assert.ok(delta>.2);
  await writeFile(join(output,'six-portrait-cover.png'),withBadge);
  await card.screenshot({path:join(output,'six-portrait-card.png')});
  const beforeHistory=await shadowSample();
  const history=await page.evaluate(async()=>{saveUserDefaults({silent:true});await saveWorkspaceNow();return WORKSPACE_SESSION_ID;});
  await page.reload();assert.equal(await page.locator('#coverMode').inputValue(),'grid');assert.equal(await page.locator('#includeDetail').isChecked(),true);assert.equal(await page.locator('#coverAspect').inputValue(),'16:9');
  await page.evaluate(id=>restoreHistoryRecord(id),history);await page.waitForFunction(()=>S.batches.length===3&&S.batches.every(b=>b.canvas&&!b.rendering));
  await page.evaluate(()=>{switchTab(1);EXPORT.format='png';EXPORT.scale=1;});
  assert.equal(await card.locator('.cell').count(),6);pixels=await inspect(await download(id));assert.equal(pixels.width*9,pixels.height*8);assert.deepEqual(pixels.left,(await inspect(withBadge)).left,'history restores gradient pixels');
  const restoredShadow=await shadowSample();assert.deepEqual(restoredShadow.settings,beforeHistory.settings);assert.deepEqual(restoredShadow.output,beforeHistory.output);assert.equal(await card.locator('#shadow-size-'+id).inputValue(),'60');
  const zipPending=page.waitForEvent('download');await page.locator('#unifiedDownloadBtn').click();const zip=await readFile(await (await zipPending).path());
  const zipInfo=await page.evaluate(bytes=>{const files=fflate.unzipSync(new Uint8Array(bytes));const m=JSON.parse(fflate.strFromU8(files['图片清单.json']));return {manifest:m,cover:[...files[m.assets[0].file]]};},[...zip]);
  const manifest=zipInfo.manifest;assert.deepEqual((await inspect(zipInfo.cover)).left,pixels.left,'ZIP includes the same gradient');
  assert.equal(manifest.assets.length,3);assert.ok(manifest.assets.every(a=>a.kind==='cover'));assert.equal(manifest.finalDetailId,null);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await card.locator('[data-cover-count]').selectOption('12');await wait();assert.equal(await card.locator('.cell').count(),12);
  await card.screenshot({path:join(output,'mobile-twelve-card.png')});
  // The opt-in is honored; returning to a standard layout restores its normal default.
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>switchTab(0));
  await page.locator('#coverMode').selectOption('collage');await page.locator('#includeDetail').check();await page.locator('#variantCount').selectOption('1');
  await page.evaluate(()=>startImageTasks([PROJECTS.list[0]]));
  assert.equal(await page.evaluate(()=>S.batches.filter(b=>b.isDetailLong).length),1);
  await page.locator('#coverMode').selectOption('grid');assert.equal(await page.locator('#includeDetail').isChecked(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS configurable portrait collage: 6 unique pictures, 8:9 output, gutters, extracted gradient, unified shadow controls/pixels/history, 1–12 count, columns, crop, pointer swap, fullscreen replacement, drafts, undo/redo, history, badge, cover-only ZIP, detail opt-in, mobile');
  console.log('Collage evidence:',output);
}catch(error){await page.screenshot({path:join(output,'failure.png')});console.log('Collage evidence:',output);throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
