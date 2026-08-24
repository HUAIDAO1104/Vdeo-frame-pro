import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
const css=await readFile(new URL('../public/static/style.css',import.meta.url),'utf8');
const desktopRust=await readFile(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const desktopMain=await readFile(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
const windowsConfig=await readFile(new URL('../src-tauri/tauri.windows.conf.json',import.meta.url),'utf8');
const windowsWorkflow=await readFile(new URL('../.github/workflows/windows-desktop.yml',import.meta.url),'utf8');
const ffmpegScript=await readFile(new URL('../scripts/prepare-windows-ffmpeg.ps1',import.meta.url),'utf8');

const seoParserContext={};
const jsonParserSource=html.slice(html.indexOf('function balancedJsonCandidates'),html.indexOf('async function aiSalesPlan'));
const seoParserSource=html.slice(html.indexOf('function chatCompletionTexts'),html.indexOf('async function requestSeoPayload'));
const detailTitleParserSource=html.slice(html.indexOf('const HERO_TITLE_MAXLEN'),html.indexOf('async function requestDetailHeroTitlePayload'));
vm.runInNewContext(jsonParserSource+'\n'+seoParserSource+'\n'+detailTitleParserSource,seoParserContext);

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
  assert.match(html,/function chatCompletionTexts\(data\)/);
  assert.match(html,/push\(message\.reasoning_content\)/);
  assert.match(html,/function parseFlexibleJson\(raw\)/);
  assert.match(html,/function parseSeoTextPayload\(raw\)/);
  assert.match(html,/Math\.max\(options\.maxTokens\|\|3600,8000\)/);
  assert.match(html,/function seoPayloadIssues\(payload\)/);
  assert.match(html,/let result=await requestSeoPayload\(input,prompt,\{maxTokens:4200,temperature:\.25\}\)/);
  assert.match(html,/上一轮 SEO 文案结果的数据结构不完整/);
  assert.match(html,/JSON格式无法解析/);
  assert.match(html,/连续两次未返回完整结构/);
});

test('DeepSeek reasoning output and markdown SEO copy are recovered',()=>{
  const payload={seoTitle:'主推标题',seoTitleAlts:['备选一','备选二'],seoIntro:'简介',keywords:['词一','词二']};
  const reasoning='<think>先分析内容</think>\n```json\n'+JSON.stringify(payload)+'\n```';
  const texts=seoParserContext.chatCompletionTexts({choices:[{message:{content:'',reasoning_content:reasoning}}]});
  assert.equal(texts.length,1);
  assert.equal(JSON.stringify(seoParserContext.robustParseJSON(texts[0])),JSON.stringify(payload));

  const markdown='## 主推标题：工业科技视觉素材可商用\n## 备选标题\n- 工业自动化视觉背景可商用\n- 智慧工厂生产线素材可商用\n## 作品简介\n呈现工业生产与智能制造画面。\n## 关键词\n工业 科技 智造 工厂';
  const parsed=seoParserContext.parseSeoTextPayload(markdown);
  assert.equal(parsed.seoTitle,'工业科技视觉素材可商用');
  assert.deepEqual([...parsed.seoTitleAlts],['工业自动化视觉背景可商用','智慧工厂生产线素材可商用']);
  assert.deepEqual([...parsed.keywords],['工业','科技','智造','工厂']);
});

test('detail hero titles recover DeepSeek fields and never fail the whole detail image',()=>{
  const reasoning='<think>分析主题</think>\n{"hero_titles":["智慧港口·自动化装卸","远洋货轮·全球物流链","数字航运·港航协同"]}';
  assert.deepEqual([...seoParserContext.parseDetailHeroTitles(reasoning)],['智慧港口·自动化装卸','远洋货轮·全球物流链','数字航运·港航协同']);
  const markdown='## 卖点标题\n1. 智慧港口·自动化装卸\n2. 远洋货轮·全球物流链\n3. 数字航运·港航协同';
  assert.deepEqual([...seoParserContext.parseDetailHeroTitles(markdown)],['智慧港口·自动化装卸','远洋货轮·全球物流链','数字航运·港航协同']);
  assert.deepEqual([...seoParserContext.parseDetailHeroTitles('<think>尚未输出正文')],[]);
  assert.match(html,/Math\.max\(requested,2400\)/);
  assert.match(html,/详情标题模型异常，已使用销售策略中的主题与卖点继续生成/);
  assert.match(html,/return localFallback\(\)/);
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

test('detail editing keeps a persistent virtual frame dock beside the long image',()=>{
  assert.match(html,/className='frame-picker-mask'/);
  assert.match(html,/id="pmFrameDock"/);
  assert.match(html,/function mountVirtualFrameGrid\(grid,cur,onPick\)/);
  assert.match(html,/mountVirtualFrameGrid\(grid,cur,detailSlotPickDone\)/);
  assert.match(html,/const overscanRows=3/);
  assert.match(html,/surface\.replaceChildren\(\)/);
  assert.match(html,/grid\?\._frameVirtualCleanup\?\.\(\)/);
  assert.match(css,/#previewModal\.detail-open\{[^}]*grid-template-columns:minmax\(0,1fr\) 390px/);
  assert.match(css,/\.frame-picker-grid\.is-virtualized/);
  assert.match(css,/\.frame-picker-item\{[^}]*aspect-ratio:16\/9/);
});

test('the replacement gallery uses nearly the full desktop viewport without compressing rows',()=>{
  assert.match(css,/\.frame-picker-dialog\{width:calc\(100vw - 44px\);height:calc\(100vh - 44px\)/);
  assert.match(html,/const minCell=compact\?150:230/);
  assert.match(html,/const nextCellHeight=nextCellWidth\*9\/16/);
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

test('desktop canvas reads cached frames through raw IPC instead of the cross-origin asset protocol',()=>{
  assert.match(desktopRust,/fn read_cached_frame\(/);
  assert.match(desktopRust,/tauri::ipc::Response::new\(bytes\)/);
  assert.match(desktopRust,/只能读取应用生成的本地帧缓存/);
  assert.match(html,/async function canvasSafeFrameSource\(src\)/);
  assert.match(html,/DESKTOP_NATIVE\.invoke\('read_cached_frame'/);
  assert.match(html,/URL\.createObjectURL\(new Blob\(\[bytes\]/);
  assert.match(html,/const DESKTOP_CANVAS_SOURCE_LIMIT=96/);
  assert.match(html,/async function compressForMemory\(dataUrl\)\{[\s\S]*?loadImageElement\(dataUrl,10000\)/);
  assert.match(html,/所有帧压缩失败'\+\(LAST_FRAME_LOAD_ERROR/);
});

test('desktop frame browsing mounts bounded chunks while preserving 16 by 9 geometry',()=>{
  assert.match(html,/const chunkSize=96/);
  assert.match(html,/mainFrameObserver=new IntersectionObserver/);
  assert.match(html,/iw:1, ih:1, stripStart:0, stripEnd:0/);
  assert.match(css,/\.fitem \{[\s\S]*?aspect-ratio:16\/9/);
});

test('internal image dragging cannot fall through to desktop file upload',()=>{
  assert.match(html,/const INTERNAL_MEDIA_DRAG = \{/);
  assert.match(html,/blocksFileImport\(\)/);
  assert.match(html,/if\(INTERNAL_MEDIA_DRAG\.blocksFileImport\(\)\)\{[\s\S]*?return;/);
  assert.match(html,/INTERNAL_MEDIA_DRAG\.begin\('candidate-frame'\)/);
  assert.match(html,/INTERNAL_MEDIA_DRAG\.begin\('asset-cell'\)/);
  assert.match(html,/INTERNAL_MEDIA_DRAG\.begin\('detail-cell'\)/);
  assert.match(html,/frameCacheRoot[\s\S]*?startsWith\(frameCacheRoot\+'\/'\)/);
  assert.match(html,/!isExternalFileDrag\(e\.dataTransfer\)/);
});

test('cover cells use pointer dragging so Windows WebView cannot turn swaps into picker clicks',()=>{
  assert.match(html,/const CELL_POINTER_DRAG=\{/);
  assert.match(html,/document\.addEventListener\('pointermove'/);
  assert.match(html,/distance<8/);
  assert.match(html,/document\.addEventListener\('pointerup'/);
  assert.match(html,/performCrossSwap\(source\.bid,source\.slotKey,dstBid,dstKey\)/);
  assert.match(html,/CELL_POINTER_DRAG\.suppressClickUntil=Date\.now\(\)\+700/);
  assert.match(html,/e\.stopImmediatePropagation\(\)/);
  assert.match(html,/el\.setAttribute\('draggable','false'\)/);
  assert.match(html,/\\u62d6\\u62fd\\u4ea4\\u6362 \\u00b7 \\u70b9\\u51fb\\u66ff\\u6362/);
});

test('windows desktop processing prefers GPU decoding and falls back to CPU',()=>{
  assert.match(desktopRust,/detect_hardware_accelerations/);
  assert.match(desktopRust,/command\.args\(\["-hwaccel", "auto"\]\)/);
  assert.match(desktopRust,/output = run_capture\(false,/);
  assert.match(html,/preferHardware:true/);
});

test('desktop generation has bounded extraction and AI deadlines',()=>{
  assert.match(html,/id="mxf"[^>]*value="300"[^>]*max="600"/);
  assert.match(html,/const SALES_RUN_LIMIT_MS=8\*60\*1000/);
  assert.match(html,/async function fetchWithDeadline\(/);
  assert.match(html,/const body=await response\.arrayBuffer\(\)/);
  assert.match(html,/function loadImageElement\(src,timeoutMs=10000\)/);
  assert.match(html,/Promise\.all\(sampleIdx\.map/);
  assert.match(html,/正在等待销售策略模型响应/);
  assert.match(html,/正在校验销售策略模型结果/);
  assert.match(html,/getProjectModelContext\(PROJECTS\.activeId,24000\)/);
  assert.match(html,/const MAX_SEND = 40/);
  assert.match(html,/const BATCH = 10/);
  assert.match(desktopRust,/run_command_with_timeout/);
  assert.match(desktopRust,/\.clamp\(1, 600\)/);
  assert.match(desktopRust,/requested_interval\.max\(segment_duration \/ max_frames as f64\)/);
});

test('windows release and media tools never open console windows',()=>{
  assert.match(desktopMain,/windows_subsystem = "windows"/);
  assert.match(desktopRust,/CREATE_NO_WINDOW/);
  assert.match(desktopRust,/background_command\(ffmpeg\)/);
  assert.match(desktopRust,/background_command\(ffprobe\)/);
});

test('user workflow parameters can be saved and restored across restarts',()=>{
  assert.match(html,/const USER_DEFAULTS_STORAGE='vfp_user_defaults_v1'/);
  assert.match(html,/function saveUserDefaults\(\)/);
  assert.match(html,/function resetUserDefaults\(\)/);
  assert.match(html,/applyUserDefaults\(\{silent:true\}\)/);
  assert.match(html,/captureMode:defaults\.captureMode/);
  assert.match(html,/export:\{format:EXPORT\.format,quality:EXPORT\.quality,scale:EXPORT\.scale\}/);
  assert.match(html,/function scheduleUserDefaultsAutoSave\(delay=400\)/);
  assert.match(html,/controls\.aiN=String\(Math\.max\(1,Math\.min\(100,/);
  assert.match(html,/USER_DEFAULT_CONTROL_IDS\.includes\(e\.target\?\.id\)\) scheduleUserDefaultsAutoSave/);
  assert.match(html,/flushUserDefaultsAutoSave\(\)/);
  assert.match(html,/id="aiN" value="30"/);
  assert.match(html,/const USER_DEFAULTS_SCHEMA_VERSION=2/);
  assert.match(html,/stored\.controls=\{\.\.\.\(stored\.controls\|\|\{\}\),aiN:'30'\}/);
  assert.match(html,/aiN:'30'/);
});

test('windows installer bundles FFmpeg and has a reproducible CI build',()=>{
  assert.match(windowsConfig,/"targets": \["nsis"\]/);
  assert.match(windowsConfig,/"binaries\/ffmpeg"/);
  assert.match(ffmpegScript,/\$TargetTriple = "x86_64-pc-windows-msvc"/);
  assert.match(ffmpegScript,/"ffmpeg-\$TargetTriple\.exe"/);
  assert.match(windowsWorkflow,/runs-on: windows-latest/);
  assert.match(windowsWorkflow,/npm run desktop:build/);
  assert.match(windowsWorkflow,/SalesKitStudio_\$\{version\}_x64-setup\.exe/);
  assert.match(windowsWorkflow,/softprops\/action-gh-release@v2/);
});
