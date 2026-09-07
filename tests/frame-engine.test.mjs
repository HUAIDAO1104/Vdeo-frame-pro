import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../public/static/frame-engine.js';
const {makeAssets,diverse}=globalThis.FrameStudio;
const frames=n=>Array.from({length:n},(_,i)=>({idx:i,w:1920,h:1080,time:i,dataUrl:'frame:'+i}));

test('short videos have compact image-only layouts with valid fallback frames',()=>{
  for(const n of [1,2,4,8]){
    const source=frames(n),assets=makeAssets(source.map(f=>f.idx),source,{variants:3,badge:false},0);
    assert.equal(assets.length,6);
    for(const b of assets){
      const indices=b.isDetailLong?b.detailLayout.gridFrames:b.cells;
      assert.ok(indices.every(i=>Number.isInteger(i)&&i>=0&&i<n));
      if(b.isDetailLong){assert.equal(b.detailLayout.rows.length,0);assert.equal(b.heroShowText,false);}
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
