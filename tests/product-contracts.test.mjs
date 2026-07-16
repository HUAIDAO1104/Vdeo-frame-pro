import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
const css=await readFile(new URL('../public/static/style.css',import.meta.url),'utf8');

test('inline application scripts parse',()=>{
  const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for(const [,source] of scripts) assert.doesNotThrow(()=>new Function(source));
});

test('detail layout enforces one to three images after the 3x3 grid',()=>{
  assert.match(html,/slice\(3,9\)/);
  assert.match(html,/Math\.min\(3,parseInt\(r\.count\)/);
  assert.doesNotMatch(html,/rowPlanCycle=\[[^\]]*4/);
});

test('claims are gated by real source metadata',()=>{
  assert.match(html,/function getResolutionInfo/);
  assert.match(html,/if\(!res\.is4K\).*replace/);
  assert.match(html,/if\(!input\?\.isAiGenerated\).*replace/);
});

test('complete package export includes copy and structured metadata',()=>{
  assert.match(html,/async function exportListingPackage/);
  assert.match(html,/files\['listing\.txt'\]/);
  assert.match(html,/files\['listing\.json'\]/);
  assert.match(html,/fflate\.zip/);
});

test('document imports use a real docx parser and explicit legacy doc handling',()=>{
  assert.match(html,/mammoth\.extractRawText/);
  assert.match(html,/utf-16le/);
});

test('privacy copy describes the AI upload boundary',()=>{
  assert.match(html,/AI 会上传压缩画面/);
  assert.match(readme,/启用 AI 时/);
  assert.doesNotMatch(readme,/全程本地处理/);
});

test('result navigation is locked until real output exists',()=>{
  assert.match(html,/id="railBtn1"[^>]*disabled[^>]*aria-disabled="true"/);
  assert.match(html,/if\(idx===1 && !updateResultNavigationState\(\)\)/);
});

test('AI consent never silently falls back to local generation',()=>{
  assert.match(html,/async function resolveSalesGenerationMode/);
  assert.doesNotMatch(html,/input\.apiKey\s*=\s*''/);
  assert.match(html,/本地基础结果/);
});

test('final cover and detail require an explicit user choice',()=>{
  assert.match(html,/S\.finalCoverId=null;\s*S\.finalDetailId=null;/);
  assert.doesNotMatch(html,/S\.finalCoverId=S\.batches\.find/);
  assert.doesNotMatch(html,/S\.finalDetailId=S\.batches\.find/);
});

test('detail thumbnail editor covers the complete scaled long canvas',()=>{
  assert.match(html,/const overlayHeight=pcanvas\?\.height/);
  assert.match(html,/height:'\+overlayHeight\+'px/);
  assert.match(html,/点击画面替换 · 拖到另一格交换/);
});

test('copy cover and detail can retry independently',()=>{
  assert.match(html,/async function retrySalesPart\(kind,button\)/);
  assert.match(html,/retrySalesPart\('copy'/);
  assert.match(html,/retrySalesPart\('cover'/);
  assert.match(html,/retrySalesPart\('detail'/);
});

test('listing validation requires exactly fifty unique keywords',()=>{
  assert.match(html,/const keywordsOk=keywords\.length===50/);
  assert.match(html,/keywordCount!==50/);
});

test('video intake imports every selected or dropped video as a project',()=>{
  assert.match(html,/id="vInput"[^>]*multiple/);
  assert.match(html,/async function importVideoFiles\(fileList\)/);
  assert.match(html,/const files=Array\.from\(fileList\|\|\[\]\)/);
  assert.match(html,/for\(const file of valid\)/);
  assert.match(html,/importVideoFiles\(e\.dataTransfer\.files\)/);
  assert.doesNotMatch(html,/e\.dataTransfer\.files\[0\]/);
});

test('batch project queue is surfaced before the editing columns',()=>{
  assert.match(html,/id="projectsCard"/);
  assert.match(html,/当前 '\+\(activeIndex\+1\)\+' \/ '\+PROJECTS\.list\.length/);
  assert.match(css,/grid-template-areas:"projects projects" "upload kit"/);
  assert.match(css,/\.upload-compact-card\.has-projects \.upzone/);
});

test('story documents support multi-select and drag-drop import',()=>{
  assert.match(html,/id="storyFileInput"[^>]*multiple/);
  assert.match(html,/id="storyDropzone"/);
  assert.match(html,/async function importStoryFiles\(fileList\)/);
  assert.match(html,/storyDropzone\?\.addEventListener\('drop'/);
  assert.match(html,/importStoryFiles\(e\.dataTransfer\.files\)/);
});
