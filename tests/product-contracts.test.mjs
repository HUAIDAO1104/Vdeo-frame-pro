import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
const workspace=await readFile(new URL('../public/static/workspace.js',import.meta.url),'utf8');
const engine=await readFile(new URL('../public/static/frame-engine.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/static/style.css',import.meta.url),'utf8');
const desktopRust=await readFile(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const desktopMain=await readFile(new URL('../src-tauri/src/main.rs',import.meta.url),'utf8');
const windowsConfig=await readFile(new URL('../src-tauri/tauri.windows.conf.json',import.meta.url),'utf8');
const windowsWorkflow=await readFile(new URL('../.github/workflows/windows-desktop.yml',import.meta.url),'utf8');
const ffmpegScript=await readFile(new URL('../scripts/prepare-windows-ffmpeg.ps1',import.meta.url),'utf8');


test('inline application scripts parse',()=>{
  const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for(const [,source] of scripts) assert.doesNotThrow(()=>new Function(source));
});

test('detail thumbnail editor covers the complete scaled long canvas',()=>{
  assert.match(html,/const overlayHeight=pcanvas\?\.height/);
  assert.match(html,/height:'\+overlayHeight\+'px/);
  assert.match(html,/点击画面替换 · 拖到另一格交换/);
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
  assert.ok(workspace.includes("startsWith(cacheRoot + '/')"));
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
  assert.ok(/preferHardware:\s*true/.test(engine));
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
  assert.deepEqual(JSON.parse(windowsConfig).bundle.targets,['nsis']);
  assert.equal(JSON.parse(windowsConfig).productName,'光厂上架助手');
  assert.equal(JSON.parse(windowsConfig).bundle.createUpdaterArtifacts,true);
  assert.match(windowsConfig,/"binaries\/ffmpeg"/);
  assert.match(ffmpegScript,/\$TargetTriple = "x86_64-pc-windows-msvc"/);
  assert.match(ffmpegScript,/"ffmpeg-\$TargetTriple\.exe"/);
  assert.match(windowsWorkflow,/runs-on: windows-latest/);
  assert.match(windowsWorkflow,/npm run desktop:build/);
  assert.match(windowsWorkflow,/node scripts\/prepare-release\.mjs/);
  assert.match(windowsWorkflow,/TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(windowsWorkflow,/softprops\/action-gh-release@v2/);
});
