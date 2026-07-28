import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
const css=await readFile(new URL('../public/static/style.css',import.meta.url),'utf8');
const desktopRust=await readFile(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const windowsConfig=await readFile(new URL('../src-tauri/tauri.windows.conf.json',import.meta.url),'utf8');
const windowsWorkflow=await readFile(new URL('../.github/workflows/windows-desktop.yml',import.meta.url),'utf8');
const ffmpegScript=await readFile(new URL('../scripts/prepare-windows-ffmpeg.ps1',import.meta.url),'utf8');

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

test('SEO model responses normalize common schemas and retry incomplete JSON once',()=>{
  assert.match(html,/function normalizeSeoPayload\(parsed\)/);
  assert.match(html,/source\.seoTitle\?\?source\.seo_title\?\?source\.mainTitle/);
  assert.match(html,/function seoPayloadIssues\(payload\)/);
  assert.match(html,/let result=await requestSeoPayload\(input,prompt,\{maxTokens:4200,temperature:\.25\}\)/);
  assert.match(html,/上一轮 SEO 文案结果的数据结构不完整/);
  assert.match(html,/连续两次未返回完整结构/);
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

test('each imported document remains independently editable and removable',()=>{
  assert.match(html,/const BATCH_DOCUMENTS = \{ list: \[\]/);
  assert.match(html,/id="documentMatchList"/);
  assert.match(html,/function reassignDocument\(id,value\)/);
  assert.match(html,/async function deleteBatchDocument\(id\)/);
  assert.match(css,/\.document-match-row/);
});

test('automatic document matching is balanced and can use AI',()=>{
  assert.match(html,/async function requestAiDocumentMatches\(documents\)/);
  assert.match(html,/const capacity=Math\.max\(1,Math\.ceil\(BATCH_DOCUMENTS\.list\.length\/PROJECTS\.list\.length\)\)/);
  assert.match(html,/按导入顺序均衡配对/);
  assert.match(html,/doc\.matchMethod=doc\.assignedProjectId==null\?'unassigned':'manual'/);
});

test('long documents are fully imported and fairly sampled for each project',()=>{
  assert.match(html,/function getProjectModelContext\(projectId,limit=48000\)/);
  assert.match(html,/modelContextExcerpt\(item\.text,perItem\)/);
  assert.doesNotMatch(html,/slice\(0,12000\)/);
});

test('the primary action can generate every pending video sequentially',()=>{
  assert.match(html,/async function runBatchSalesKit\(\)/);
  assert.match(html,/function isProjectGenerationComplete\(project\)/);
  assert.match(html,/for\(let i=0;i<tasks\.length;i\+\+\)/);
  assert.match(html,/await runSalesKit\(\{batchMode:true/);
  assert.match(html,/activeProject\.generationStatus='complete'/);
  assert.match(html,/markProjectFailure\(activeProject,e,currentStage\)/);
  assert.match(html,/\+'批量生成 '\+pending\+' 个任务'/);
});

test('generation failures keep a visible reason and remain retryable',()=>{
  assert.match(html,/id="currentProjectFailure"/);
  assert.match(html,/function markProjectFailure\(project,error,stage\)/);
  assert.match(html,/project\.generationError=\{message,stage:String\(stage\|\|'生成流程'\),at:Date\.now\(\)\}/);
  assert.match(html,/function retryCurrentFailedProject\(\)/);
  assert.match(html,/修正设置后可只重试当前任务/);
});

test('batch outcomes always open a switchable result workspace',()=>{
  assert.match(html,/id="resultProjectSwitcher"/);
  assert.match(html,/function switchResultProject\(id\)/);
  assert.match(html,/const target=succeeded\.length\?succeeded\[succeeded\.length-1\]\.project:failed\[0\]\.project/);
  assert.match(html,/setSalesProgress\(succeeded\.length\?-1:-2,summary\);\s*switchTab\(1\)/);
});

test('detail long images repair missing frames and balance extension rows',()=>{
  assert.match(html,/const balanced=\[1,3,2,1,3,2\]/);
  assert.match(html,/function repairDetailLongLayout\(layout\)/);
  assert.match(html,/gridFrames:Array\.from\(\{length:9\}/);
  assert.match(html,/const img=\(await loadImg\(S\.frames\[fi\]\?\.dataUrl\)\)\|\|fallbackImg/);
});

test('detail editing keeps a persistent paged frame dock beside the long image',()=>{
  assert.match(html,/className='frame-picker-mask'/);
  assert.match(html,/id="pmFrameDock"/);
  assert.match(html,/function mountPagedFrameGrid\(grid,cur,onPick,chunkSize=36\)/);
  assert.match(html,/mountPagedFrameGrid\(grid,cur,detailSlotPickDone,32\)/);
  assert.match(html,/new IntersectionObserver/);
  assert.match(css,/#previewModal\.detail-open\{[^}]*grid-template-columns:minmax\(0,1fr\) 390px/);
  assert.match(css,/#pmFrameDock \.frame-picker-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.frame-picker-item\{[^}]*aspect-ratio:16\/9/);
});

test('the replacement gallery uses nearly the full desktop viewport without compressing rows',()=>{
  assert.match(css,/\.frame-picker-dialog\{width:calc\(100vw - 44px\);height:calc\(100vh - 44px\)/);
  assert.match(css,/\.frame-picker-grid\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(230px,1fr\)\)/);
  assert.match(css,/\.frame-picker-grid\{[^}]*grid-auto-rows:max-content/);
  assert.match(css,/\.frame-picker-item\{[^}]*height:auto!important;aspect-ratio:16\/9/);
});

test('workspace persistence is deferred away from active editing',()=>{
  assert.match(html,/function scheduleWorkspaceSave\(delay=3200\)/);
  assert.match(html,/requestIdleCallback\(persist,\{timeout:1800\}\)/);
});

test('wide desktop generation uses available space without a central bottleneck',()=>{
  assert.match(css,/@media\(min-width:1101px\)/);
  assert.match(css,/#tabPane0\.active\.has-projects\{grid-template-columns:minmax\(210px,\.62fr\) minmax\(280px,\.78fr\) minmax\(420px,1\.2fr\)/);
});

test('new cover candidates enable the 4K badge by default and remember manual overrides',()=>{
  assert.match(html,/hasBadge:isCover, badgeTouched:false/);
  assert.match(html,/addBatch\(2,2,false,'cover'\)/);
  assert.match(html,/if\(b\.assetKind==='cover'&&b\.badgeTouched!==true\) b\.hasBadge=true/);
  assert.match(html,/b\.badgeTouched=true/);
  assert.match(html,/onchange="setBatchBadge\('/);
  assert.match(html,/封面默认开启，可随时关闭/);
  assert.match(html,/if\(badgeChk\?\.checked && !S\.badgeImg && S\.badgeReady\) await S\.badgeReady/);
});

test('history is explicit and never auto-restores into a fresh workspace',()=>{
  assert.match(html,/migrateLegacyWorkspaceToHistory\(\);/);
  assert.doesNotMatch(html,/restoreWorkspaceDrafts\(\);/);
  assert.match(html,/async function restoreHistoryRecord\(historyId\)/);
  assert.match(html,/不会自动占用当前工作台/);
});

test('history listing uses a lightweight metadata store instead of loading video payloads',()=>{
  assert.match(html,/const WORKSPACE_DB_VERSION=2/);
  assert.match(html,/const WORKSPACE_META_STORE='history_meta'/);
  assert.match(html,/function historyMetaFromPayload\(payload,fallbackId=''/);
  assert.match(html,/async function readWorkspaceHistoryMeta\(\)/);
  assert.match(html,/tx\.objectStore\(WORKSPACE_META_STORE\)\.getAll\(\)/);
  assert.doesNotMatch(html,/const valueReq=store\.getAll\(\)/);
});

test('legacy history actions use the database key and explicit delegated controls',()=>{
  assert.match(html,/function historyIdFromKey\(key\)/);
  assert.match(html,/req\.onupgradeneeded=event=>/);
  assert.match(html,/if\(event\.oldVersion<2\)/);
  assert.match(html,/if\(key\.startsWith\('history:'\)\)/);
  assert.match(html,/data-history-action="restore"/);
  assert.match(html,/data-history-action="rename"/);
  assert.match(html,/data-history-action="delete"/);
  assert.match(html,/打开编辑/);
});

test('history rename uses an in-app prompt and deletion updates payload and metadata',()=>{
  assert.match(html,/function appPrompt\(/);
  assert.match(html,/await appPrompt\(\{title:'重命名历史记录'/);
  assert.doesNotMatch(html,/prompt\('历史记录名称'/);
  assert.match(html,/tx\.objectStore\(WORKSPACE_STORE\)\.delete\('history:'\+historyId\)/);
  assert.match(html,/tx\.objectStore\(WORKSPACE_META_STORE\)\.delete\(historyId\)/);
});

test('a new batch clears the workbench in one action after saving history',()=>{
  assert.match(html,/id="projectNewBatchBtn"/);
  assert.match(html,/async function startNewBatch\(\)/);
  assert.match(html,/await saveWorkspaceNow\(\)/);
  assert.match(html,/BATCH_DOCUMENTS\.list=\[\]/);
});

test('desktop runtime stores extracted frames as local files instead of base64 payloads',()=>{
  assert.match(html,/const DESKTOP_NATIVE =/);
  assert.match(html,/DESKTOP_NATIVE\.invoke\('extract_video_frames'/);
  assert.match(html,/filePath:frame\.path/);
  assert.match(desktopRust,/join\("frame-cache"\)/);
  assert.match(desktopRust,/frame-%06d\.jpg/);
});

test('desktop frame browsing mounts bounded chunks while preserving 16 by 9 geometry',()=>{
  assert.match(html,/const chunkSize=96/);
  assert.match(html,/mainFrameObserver=new IntersectionObserver/);
  assert.match(html,/iw:1, ih:1, stripStart:0, stripEnd:0/);
  assert.match(css,/\.fitem \{[\s\S]*?aspect-ratio:16\/9/);
});

test('windows desktop processing prefers GPU decoding and falls back to CPU',()=>{
  assert.match(desktopRust,/detect_hardware_accelerations/);
  assert.match(desktopRust,/command\.args\(\["-hwaccel", "auto"\]\)/);
  assert.match(desktopRust,/output = run_capture\(false\)/);
  assert.match(html,/preferHardware:true/);
});

test('windows installer bundles FFmpeg and has a reproducible CI build',()=>{
  assert.match(windowsConfig,/"targets": \["nsis"\]/);
  assert.match(windowsConfig,/"binaries\/ffmpeg"/);
  assert.match(ffmpegScript,/\$TargetTriple = "x86_64-pc-windows-msvc"/);
  assert.match(ffmpegScript,/"ffmpeg-\$TargetTriple\.exe"/);
  assert.match(windowsWorkflow,/runs-on: windows-latest/);
  assert.match(windowsWorkflow,/npm run desktop:build/);
});
