import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../public/static/frame-engine.js';
const {makeAssets,diverse}=globalThis.FrameStudio;
test('enabled badge fails explicitly when the overlay is missing or undecoded',async()=>{
  for(const badge of [null,{naturalWidth:0,naturalHeight:0}]){
    await assert.rejects(globalThis.FrameStudio.renderAsset({hasBadge:true},[],null,null,badge),/4K 角标未加载/);
  }
});
const frames=n=>Array.from({length:n},(_,i)=>({idx:i,w:1920,h:1080,time:i,dataUrl:'frame:'+i}));
const candidate=(frameIdx,time,gray=100,overall=.7)=>({frameIdx,time,overall,pixels:Array(576).fill(gray)});
test('21:9 4K and portrait covers produce exact 16:9 output in either layout',()=>{
  for(const [w,h] of [[4032,1728],[1080,1920],[333,500]])for(const n of [1,2]){
    const g=FrameStudio.assetGeometry({assetKind:'cover',cols:n,rows:n,cells:Array(n*n).fill(0),coverAspect:'16:9'},[{w,h}]);
    assert.equal(g.width*9,g.height*16);assert.equal(g.slots.length,n*n);
    assert.ok(g.slots.every(s=>s.w*9===s.h*16));
  }
});
test('crop at 100% can pan the clipped dimension, clamps edges and matches the output geometry',()=>{
  const left=FrameStudio.cropPlacement(4032,1728,1920,1080,{scale:1,ox:1,oy:1});
  assert.ok(Math.abs(left.x)<1e-9);assert.equal(left.y,0);assert.ok(left.ox>0);assert.equal(left.oy,0);
  const right=FrameStudio.cropPlacement(4032,1728,1920,1080,{scale:1,ox:-1});
  assert.ok(Math.abs(right.x+right.width-1920)<1e-9);
  const portrait=FrameStudio.cropPlacement(1080,1920,1920,1080,{scale:1,oy:-1});
  assert.ok(portrait.oy<0);assert.ok(Math.abs(portrait.y+portrait.height-1080)<1e-9);
});
test('single cover follows the chosen image proportions without upscaling small images',()=>{
  for(const [w,h] of [[640,360],[320,640],[400,400],[8000,6000],[6000,8000]]){
    const source=[{w:1920,h:1080},{w,h}];
    const g=FrameStudio.assetGeometry({assetKind:'cover',cols:1,rows:1,cells:[1]},source);
    assert.equal(g.slots.length,1);assert.equal(g.slots[0].fi,1);
    assert.equal(g.width/g.height,w/h);assert.ok(g.width<=w&&g.height<=h);
    assert.ok(Math.max(g.width,g.height)<=3840);
  }
});
const {sceneRepresentatives,similarFrames}=globalThis.FrameStudio;

test('adjacent similar frames keep the better representative and every candidate belongs to one group',()=>{
  const items=[candidate(0,0,100,.4),candidate(1,1,103,.9),candidate(2,2,101,.6),candidate(3,3,220,.8)];
  const result=sceneRepresentatives(items);
  assert.deepEqual(result.map(x=>x.frameIdx),[1,3]);
  assert.deepEqual(result.map(x=>x.memberIds),[[0,1,2],[3]]);
  assert.deepEqual(result.map(x=>[x.startTime,x.endTime]),[[0,2],[3,3]]);
  assert.equal(items[0].sceneId,undefined);
});
test('scene changes close in time are all retained beyond the old 32 and 60 caps',()=>{
  const items=Array.from({length:90},(_,i)=>candidate(i,i*.1,i%2?220:20));
  assert.equal(sceneRepresentatives(items).length,90);
});
test('a long static shot needs one representative, with no artificial minimum or time-slice quota',()=>{
  assert.equal(sceneRepresentatives(Array.from({length:120},(_,i)=>candidate(i,i*5))).length,1);
  assert.deepEqual(sceneRepresentatives([]),[]);
});
test('returning to an earlier scene and gaps in time start new groups',()=>{
  assert.equal(sceneRepresentatives([candidate(0,0,20),candidate(1,1,220),candidate(2,2,20)]).length,3);
  const separated=[candidate(0,0),candidate(1,1),candidate(2,2),candidate(3,30),candidate(4,31)];
  assert.deepEqual(sceneRepresentatives(separated).map(x=>x.memberIds),[[0,1,2],[3,4]]);
  assert.equal(sceneRepresentatives([candidate(0,0),candidate(1,100)]).length,2);
});
test('gradual motion cannot chain frames far from the original composition into one group',()=>{
  const result=sceneRepresentatives(Array.from({length:12},(_,i)=>candidate(i,i,40+i*5)));
  assert.ok(result.length>=4);
  assert.ok(result.every(group=>group.memberIds.length<=3));
});
test('similarity retains different colors with equal luminance and localized visual changes',()=>{
  const a={...candidate(0,0),colors:Uint8Array.from({length:1728},(_,i)=>i%3===0?180:0)};
  const b={...candidate(1,1),colors:Uint8Array.from({length:1728},(_,i)=>i%3===1?92:0)};
  assert.equal(similarFrames(a,b),false);
  const changed=candidate(1,1);changed.pixels.fill(220,200,260);
  assert.equal(similarFrames(candidate(0,0),changed),false);
});
test('automatic layouts use only representatives and stay compact after duplicate reduction',()=>{
  const source=frames(120),order=[2,48,92];
  const assets=makeAssets(order,source,{variants:3,badge:false},0);
  for(const asset of assets){
    const indices=asset.isDetailLong?[...asset.detailLayout.gridFrames,...asset.detailLayout.rows.flatMap(r=>r.frames)]:asset.cells;
    assert.ok(indices.every(i=>order.includes(i)));
    if(asset.isDetailLong) assert.equal(asset.detailLayout.rows.length,0);
  }
});

test('short videos have compact image-only layouts with valid fallback frames',()=>{
  for(const n of [1,2,4,8]){
    const source=frames(n),assets=makeAssets(source.map(f=>f.idx),source,{variants:3,badge:false},0);
    assert.equal(assets.length,6);
    for(const b of assets){
      const indices=b.isDetailLong?b.detailLayout.gridFrames:b.cells;
      assert.ok(indices.every(i=>Number.isInteger(i)&&i>=0&&i<n));
      if(b.isDetailLong){assert.equal(b.detailLayout.rows.length,0);assert.equal(b.heroShowText,true);}
      assert.equal(b.hasBadge,false);assert.ok(!b.heroTitle);
    }
  }
});
test('long-video detail rows use 1, 3, 2 images, and IDs remain project-local',()=>{
  const source=frames(40),assets=makeAssets(source.map(f=>f.idx),source,{variants:3,badge:false},12);
  assert.deepEqual(assets.map(b=>b.id),[13,14,15,16,17,18]);
  for(const b of assets.filter(b=>b.isDetailLong)){
    assert.equal(b.detailLayout.gridFrames.length,9);
    assert.deepEqual(b.detailLayout.rows.map(r=>r.cols),[1,3,2]);
    assert.ok(b.detailLayout.rows.every(r=>r.frames.length===r.cols));
  }
});
test('single-version setting produces exactly one cover and one detail',()=>{
  const source=frames(12);assert.equal(makeAssets(source.map(f=>f.idx),source,{variants:1,badge:false},0).length,2);
});
test('diverse selection balances quality with visual difference and does not mutate input',()=>{
  const items=[{frameIdx:0,overall:.9,time:0,pixels:Array(576).fill(100)},{frameIdx:1,overall:.89,time:1,pixels:Array(576).fill(100)},{frameIdx:2,overall:.85,time:9,pixels:Array(576).fill(200)}];
  assert.deepEqual(diverse(items,2),[0,2]);assert.deepEqual(items.map(x=>x.frameIdx),[0,1,2]);
});
test('all browser script files parse independently',()=>{
  for(const file of ['task-queue.js','frame-engine.js','workspace.js'])assert.doesNotThrow(()=>new Function(fs.readFileSync(new URL('../public/static/'+file,import.meta.url),'utf8')));
});
test('removed features have no upload, generation, or native document entry points',()=>{
  const html=fs.readFileSync(new URL('../public/app.html',import.meta.url),'utf8');
  const native=fs.readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="(?:storyFileInput|storyDropzone|seoTitle|seoIntro|seoKeywords|aiSeoModel)"/);
  assert.doesNotMatch(html,/function (?:aiSeoOptimize|aiSalesPlan|autoMatchDocuments|aiDetailHeroTitles)/);
  assert.doesNotMatch(native,/read_document_files|DocumentDescriptor/);
});
test('project serialization excludes API keys and retired document/copy data',()=>{
  const source=fs.readFileSync(new URL('../public/static/workspace.js',import.meta.url),'utf8');
  const context={serializeBatchDraft:b=>({...b,canvas:null})};
  vm.createContext(context);vm.runInContext(source,context);
  const value=context.serializeProjectDraft({id:1,runConfig:{apiKey:'secret'},manualStoryDoc:'old',storyDoc:'old',salesPlan:{keywords:['old']},batches:[],generationStatus:'paused'});
  assert.equal(JSON.stringify(value).includes('secret'),false);assert.equal(value.storyDoc,undefined);assert.equal(value.generationStatus,'stopped');assert.equal(value.salesPlan,null);
});

test('folder pictures merge nonadjacent duplicates but retain distinct proportions and all unique pictures',()=>{
  const images=[{...candidate(0,0,100,.4),aspect:1.5},{...candidate(1,0,220,.8),aspect:1.5},{...candidate(2,0,102,.9),aspect:1.5},{...candidate(3,0,102,.9),aspect:.667}];
  const reps=FrameStudio.imageRepresentatives(images);
  assert.equal(reps.length,3);
  assert.deepEqual(reps.find(g=>g.frameIdx===2).memberIds,[2,0]);
  assert.equal(images[0].memberIds,undefined);
  const many=Array.from({length:70},(_,i)=>({...candidate(i,0),aspect:1+i*.1}));
  assert.equal(FrameStudio.imageRepresentatives(many).length,70);
});


test('detail render geometry covers every pixel and slot for mixed dimensions and tall layouts',()=>{
  for(const size of [[1920,1080],[1080,1920],[100,4000]]){
    const source=frames(25).map((f,i)=>({...f,w:i?900:size[0],h:i?600:size[1]}));
    const detail=makeAssets(source.map(f=>f.idx),source,{variants:1,badge:false},0).find(b=>b.isDetailLong);
    const g=FrameStudio.assetGeometry(detail,source);
    assert.equal(g.slots.length,15);assert.equal(new Set(g.slots.map(s=>s.key)).size,15);
    assert.equal(g.slots.reduce((n,s)=>n+s.w*s.h,0),g.width*g.height);
    for(const s of g.slots){assert.ok(s.x>=0&&s.y>=0&&s.x+s.w<=g.width&&s.y+s.h<=g.height);}
    assert.equal(g.slots[9].key,'row:0:0');assert.equal(g.slots.at(-1).key,'row:2:1');
    assert.ok(g.height<=14000);
  }
});

test('six portrait covers are 3 by 2, keep six unique pictures per variant and omit detail by default',()=>{
  const source=frames(6).map(f=>({...f,w:1080,h:1920}));
  const assets=makeAssets(source.map(f=>f.idx),source,{variants:3,coverMode:'collage'},0);
  assert.equal(assets.length,3);
  for(const asset of assets){
    assert.equal(asset.assetKind,'cover');assert.equal(asset.cols,3);assert.equal(asset.rows,2);assert.equal(asset.cells.length,6);assert.equal(new Set(asset.cells).size,6);
    const g=FrameStudio.assetGeometry(asset,source);assert.equal(g.width,1620);assert.equal(g.height,1920);
    assert.ok(g.slots.every(s=>s.w*16===s.h*9));
  }
  assert.equal(makeAssets([0,1],source,{variants:1,coverMode:'collage',includeDetail:true},0).length,2);
  assert.equal(makeAssets([0,1],source,{variants:1,includeDetail:false},0).length,1);
});
test('all 1–12 picture layouts and 1–6 columns cover every pixel at the requested overall ratio',()=>{
  const source=frames(12);
  for(let count=1;count<=12;count++)for(let cols=1;cols<=6;cols++)for(const aspect of ['3:4','27:32','16:9','2:3','source']){
    const b=makeAssets(source.map(f=>f.idx),source,{variants:1,coverMode:'collage',coverCount:count,coverCols:cols,coverAspect:aspect},0)[0];
    const g=FrameStudio.assetGeometry(b,source),ratio=FrameStudio.parseCoverAspect(aspect);
    assert.equal(g.slots.length,count);assert.equal(new Set(b.cells).size,count);
    assert.equal(g.slots.reduce((sum,s)=>sum+s.w*s.h,0),g.width*g.height);
    assert.ok(Math.max(g.width,g.height)<=3840);
    for(const slot of g.slots)assert.ok(slot.x>=0&&slot.y>=0&&slot.x+slot.w<=g.width&&slot.y+slot.h<=g.height);
    if(ratio)assert.equal(g.width*ratio.h,g.height*ratio.w);
  }
});
test('cover settings normalize bounded counts and custom ratios while legacy assets remain supported',()=>{
  assert.deepEqual(FrameStudio.parseCoverAspect('6:8'),{w:3,h:4,value:'3:4'});
  for(const value of ['0:4','100:1','1:100','101:100','1.5:2','invalid'])assert.equal(FrameStudio.parseCoverAspect(value),null);
  assert.equal(FrameStudio.coverSpec({coverMode:'collage',coverCount:100,coverCols:20}).count,12);
  assert.equal(FrameStudio.coverSpec({coverMode:'collage',coverCount:2,coverCols:6}).cols,2);
  assert.equal(FrameStudio.coverMode({cols:1,rows:1}),'single');assert.equal(FrameStudio.coverMode({cols:2,rows:2}),'grid');
  assert.equal(FrameStudio.coverMode({cols:3,rows:2}),'collage');
});
