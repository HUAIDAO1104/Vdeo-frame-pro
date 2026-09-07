/* Application orchestration. Processing and viewing are intentionally independent. */
let taskQueue = null;
let frameEngine = null;
let taskRenderKey = '';
let assetViewRevision = 0;
let generationStarting = false;
const taskStatusLabels = { pending: '待生成', queued: '排队中', running: '生成中', paused: '已暂停', stopping: '停止中', stopped: '已停止', complete: '已完成', failed: '失败' };

function initializeTaskWorkspace() {
  frameEngine = FrameStudio.create({
    native: DESKTOP_NATIVE,
    badge: () => S.badgeImg,
    scoreBatch: (frames, key, model, hint, signal) => visionScoreBatch(frames, key, model, hint, [], [], null, 75000, signal)
  });
  taskQueue = new VideoTaskQueue({
    process: (project, ctx) => frameEngine.generate(project, ctx),
    onChange: () => {
      updateQueueControls();
      const signature = PROJECTS.list.map(p => p.id + ':' + p.generationStatus).join('|');
      if (signature !== taskRenderKey) { taskRenderKey = signature; renderProjectTabs(); }
      if (!taskQueue?.active) scheduleWorkspaceSave();
    },
    onComplete: project => {
      if (project.id === PROJECTS.activeId) restoreProject(project);
      renderProjectTabs(); updateResultNavigationState();
      scheduleWorkspaceSave(600);
      toast('「' + project.name + '」已完成，可立即查看结果');
    }
  });
  globalThis.__vfpQueue = taskQueue;
  document.getElementById('view1').classList.add('has-results');
  document.getElementById('taskPauseBtn').onclick = () => taskQueue.state === 'paused' ? taskQueue.resume() : taskQueue.pause();
  document.getElementById('taskStopBtn').onclick = () => taskQueue.stop();
  document.getElementById('taskResultsBtn').onclick = openCompletedResults;
  document.getElementById('selectionMode').addEventListener('change', updateAiConnectionUI);
  document.getElementById('salesKitBtn').addEventListener('click', runPrimarySalesAction);
  document.getElementById('salesCurrentBtn').addEventListener('click', () => runSalesKit());
  document.querySelector('.advanced-settings-card:has(#itvl)') && document.getElementById('settingsLegacySlot').appendChild(document.querySelector('.advanced-settings-card:has(#itvl)'));
  updateQueueControls(); updateAiConnectionUI();
}
function hasResultContent() {
  return typeof S !== 'undefined' && S.batches.some(b => b.canvas || b.wasGenerated);
}
function hasProjectOutcome() {
  return (globalThis.__vfpProjects?.list || []).some(p => p.batches?.some(b => b.canvas || b.wasGenerated));
}
function updateResultNavigationState() {
  const list = globalThis.__vfpProjects?.list || [];
  const ready = hasProjectOutcome() || hasResultContent();
  const count = list.filter(p => p.batches?.some(b => b.canvas || b.wasGenerated)).length;
  const button = document.getElementById('railBtn1');
  if (button) {
    button.disabled = !ready; button.setAttribute('aria-disabled', String(!ready));
    button.title = ready ? '查看已生成结果，后台任务继续运行' : '完成一个视频后即可查看';
    button.querySelector('.rail-lbl').textContent = '结果' + (count ? ' ' + count : '');
  }
  return ready;
}
function updateTaskFlowState() {
  const list = globalThis.__vfpProjects?.list || [];
  const running = !!taskQueue?.active;
  document.getElementById('taskStepSource')?.classList.toggle('is-done', list.length > 0);
  document.getElementById('taskStepGenerate')?.classList.toggle('is-active', running);
  document.getElementById('taskStepResult')?.classList.toggle('is-done', hasProjectOutcome());
  const label = document.getElementById('salesKitBtnLabel');
  const pending = list.filter(p => !isProjectGenerationComplete(p)).length;
  document.getElementById('taskStepSource')?.classList.toggle('is-active', !list.length);
  document.getElementById('taskStepGenerate')?.classList.toggle('is-done', !!list.length && !pending && !running);
  if (label) label.textContent = running ? (taskQueue.state === 'paused' ? '队列已暂停' : taskQueue.state === 'stopping' ? '正在停止…' : '正在生成…') : !list.length ? '添加视频后开始' : pending ? '开始生成' + (pending > 1 ? ' · ' + pending + ' 个视频' : '') : '重新生成当前视频';
  updateResultNavigationState();
}
function updateSalesPrimaryState() {
  const list = globalThis.__vfpProjects?.list || [];
  const button = document.getElementById('salesKitBtn');
  const busy = !!taskQueue?.active || generationStarting;
  if (button) { button.disabled = !list.length || busy; button.title = list.length ? '生成封面与详情图片' : '先添加视频'; }
  const current = document.getElementById('salesCurrentBtn');
  if (current) { current.hidden = list.length < 2; current.disabled = busy; }
  const cap = document.getElementById('capBtn');
  if (cap) cap.disabled = !list.length || busy;
  updateTaskFlowState();
}
function updateQueueControls() {
  if (!taskQueue) return;
  const active = taskQueue.active, paused = taskQueue.state === 'paused', stopping = taskQueue.state === 'stopping';
  const done = PROJECTS.list.filter(isProjectGenerationComplete).length;
  const failed = PROJECTS.list.filter(p => p.generationStatus === 'failed').length;
  const current = taskQueue.current;
  document.getElementById('taskControlBar').hidden = !PROJECTS.list.length;
  document.getElementById('taskControlBar').classList.toggle('is-idle', !active);
  document.getElementById('taskQueueTitle').textContent = stopping ? '正在停止任务' : paused ? '队列已暂停' : active ? '正在生成图片' : done ? '结果已就绪' : '视频已就绪';
  document.getElementById('taskQueueSummary').textContent = done + ' / ' + PROJECTS.list.length + ' 个完成' + (failed ? ' · ' + failed + ' 个失败，可重试' : '') + (current && !current.deleted ? ' · ' + current.name + '：' + (current.generationStage || '准备中') : '');
  document.getElementById('taskQueueHint').textContent = paused ? '进度已保留。继续后会重试被中断的步骤。' : stopping ? '正在结束当前处理，已完成图片会保留。' : active ? '可以查看已完成结果，也可以移除不需要的视频。' : '每完成一个视频，结果立即可用。';
  const pause = document.getElementById('taskPauseBtn'); pause.hidden = !active; pause.disabled = stopping; pause.textContent = paused ? '继续生成' : '暂停';
  const stop = document.getElementById('taskStopBtn'); stop.hidden = !active; stop.disabled = stopping;
  document.getElementById('taskResultsBtn').disabled = !hasProjectOutcome();
  document.getElementById('taskResultsBtn').textContent = '查看结果' + (done ? ' · ' + done : '');
  const progress = active ? (done + Number(current?.generationProgress || 0) / 100) / Math.max(1, PROJECTS.list.length) * 100 : done / Math.max(1, PROJECTS.list.length) * 100;
  document.getElementById('taskQueueFill').style.width = Math.min(100, progress) + '%';
  document.getElementById('taskQueueTrack').setAttribute('aria-valuenow', String(Math.round(progress)));
  updateSalesPrimaryState();
}
function updateAiConnectionUI() {
  const mode = document.getElementById('selectionMode')?.value || 'local';
  const key = document.getElementById('aiApiKey')?.value?.trim();
  const title = document.getElementById('aiConnectionTitle'), meta = document.getElementById('aiConnectionMeta');
  if (title) title.textContent = mode === 'ai' ? key ? 'AI 选图 · 已配置密钥' : 'AI 选图 · 需要配置' : '本地选图 · 无需联网';
  if (meta) meta.textContent = mode === 'ai' ? '仅发送压缩候选画面，连接状态以实际请求为准' : '按清晰度、曝光与画面差异挑选';
  document.getElementById('aiConnectionBar')?.classList.toggle('is-connected', mode === 'local' || !!key);
  updateTaskFlowState();
}
function setModelPreset(preset) {
  const model = document.getElementById('aiModel');
  model.value = preset === 'quality' ? 'qwen3-vl-plus-2025-12-19' : 'qwen3-vl-flash-2026-01-22';
  syncModelPresetUI(); scheduleUserDefaultsAutoSave();
}
function updateModelPresetMeta(preset) {
  const el = document.getElementById('modelPresetMeta');
  if (el) el.textContent = preset === 'quality' ? '精细选图，响应时间可能更长。' : '用于候选画面评分；实际可用性取决于接口与账号权限。';
}
function syncModelPresetUI() {
  const preset = document.getElementById('aiModel')?.value.includes('plus') ? 'quality' : 'recommended';
  document.querySelectorAll('[data-model-preset]').forEach(el => el.classList.toggle('is-active', el.dataset.modelPreset === preset));
  updateModelPresetMeta(preset);
}
function isProjectGenerationComplete(project) { return project?.generationStatus === 'complete'; }
function saveActiveProject() {
  const p = PROJECTS.list.find(x => x.id === PROJECTS.activeId);
  if (!p) return;
  Object.assign(p, { frames: S.frames, selected: S.selected, batches: S.batches, aiScores: S.aiScores, imgCache: S.imgCache,
    captureMode: S.captureMode, batchIdCnt, finalCoverId: S.finalCoverId, finalDetailId: S.finalDetailId,
    lastPick: S.lastPick, salesPlan: null, sourceMeta: getSourceMeta() });
}
function switchProject(id) {
  if (id === PROJECTS.activeId) return;
  const p = PROJECTS.list.find(x => x.id === id); if (!p) return;
  closePreviewModal(); closeFramePicker(); closeLightbox();
  saveActiveProject(); PROJECTS.activeId = id; restoreProject(p); renderProjectTabs();
  const title = document.getElementById('resultVideoName'); if (title) title.textContent = p.name;
  scheduleWorkspaceSave();
}
function switchResultProject(id) {
  switchProject(id); relocateUnifiedPanels(1); renderResultProjectSwitcher(); updateListingChecklist();
}
function openCompletedResults() {
  const current = PROJECTS.list.find(p => p.id === PROJECTS.activeId);
  const target = current?.batches?.length ? current : PROJECTS.list.find(p => p.batches?.some(b => b.canvas || b.wasGenerated));
  if (!target) return;
  switchProject(target.id); switchTab(1);
}
async function deleteProject(id) {
  const p = PROJECTS.list.find(x => x.id === id); if (!p) return;
  if (p.batches?.some(b => b.canvas || b.wasGenerated)) {
    if (!await appConfirm({ title: '移除视频和结果', message: '移除「' + p.name + '」及其图片结果？不会删除原始视频文件。', okText: '移除', cancelText: '保留' })) return;
  }
  deleteProjectNoConfirm(id);
  toast('已移除「' + p.name + '」');
}
async function closeCurrentVideo() { return deleteProject(PROJECTS.activeId); }
function deleteProjectNoConfirm(id) {
  const p = PROJECTS.list.find(x => x.id === id); if (!p) return;
  const done = taskQueue?.remove(p) || Promise.resolve();
  const index = PROJECTS.list.indexOf(p), selected = id === PROJECTS.activeId;
  PROJECTS.list.splice(index, 1);
  if (selected) {
    closePreviewModal(); closeFramePicker(); closeLightbox();
    const next = PROJECTS.list[Math.min(index, PROJECTS.list.length - 1)];
    PROJECTS.activeId = next?.id ?? null;
    if (next) restoreProject(next);
    else {
      assetViewRevision++;
      Object.assign(S, { frames: [], selected: [], batches: [], aiScores: [], imgCache: new Map(), finalCoverId: null, finalDetailId: null, lastPick: null });
      SALES.plan = null; batchIdCnt = 0;
      vPrev.removeAttribute('src'); vPrev.load(); document.getElementById('vCon').style.display = 'none';
      renderAllFrames(); renderAllBatches(); updateSelBadge(); updateDlBtns();
      document.getElementById('totalN').textContent = '0'; switchTab(0);
    }
  }
  // Wait for native cancellation before removing files; never race a live FFmpeg writer.
  done.finally(async () => {
    frameEngine?.discard(id);
    if (p.videoUrl && !p.desktopPath) URL.revokeObjectURL(p.videoUrl);
    // History may still refer to an older cache. Remove only this job's new cache.
    if (p.runConfig?.cacheId && p.desktopPath) await DESKTOP_NATIVE.invoke('clear_project_cache', { projectId: p.runConfig.cacheId }).catch(console.warn);
  });
  renderProjectTabs(); updateQueueControls(); updateFinalAssetUI(); scheduleWorkspaceSave(600);
}
async function renameProject(id) {
  const p = PROJECTS.list.find(x => x.id === id); if (!p) return;
  const name = await appPrompt({ title: '重命名视频任务', value: p.name, maxLength: 80 });
  if (name?.trim()) { p.name = name.trim(); renderProjectTabs(); scheduleWorkspaceSave(); }
}
function renderProjectTabs() {
  const list = PROJECTS.list, tabs = document.getElementById('projTabs'); if (!tabs) return;
  document.getElementById('projectsCard').style.display = list.length ? '' : 'none';
  document.querySelector('.upload-compact-card')?.classList.toggle('has-projects', !!list.length);
  document.getElementById('tabPane0')?.classList.toggle('has-projects', !!list.length);
  document.getElementById('projCount').textContent = list.length + ' 个';
  tabs.innerHTML = list.map((p, i) => '<div class="proj-tab' + (p.id === PROJECTS.activeId ? ' active' : '') + (p.generationStatus === 'complete' ? ' is-complete' : '') + (p.generationStatus === 'failed' ? ' is-failed' : '') + '">' +
    '<button type="button" class="project-select" onclick="switchProject(' + p.id + ')" aria-current="' + (p.id === PROJECTS.activeId) + '">' +
    '<span class="proj-index">' + String(i + 1).padStart(2, '0') + '</span><span class="proj-tab-main"><strong class="proj-tab-name" title="' + escapeHtml(p.fileName || p.name) + '">' + escapeHtml(p.name) + '</strong>' +
    '<span class="proj-tab-meta"><span class="proj-state">' + (taskStatusLabels[p.generationStatus] || '待生成') + '</span><span>' + escapeHtml(projectGenerationError(p)?.message || p.fileSize || '') + '</span></span></span></button>' +
    (p.batches?.length ? '<button class="btn-sm project-result" onclick="switchProject(' + p.id + ');switchTab(1)">查看结果</button>' : '') +
    (p.generationStatus === 'failed' ? '<button class="btn-sm" onclick="retryProject(' + p.id + ')">重试</button>' : '') +
    '<button class="project-rename" onclick="renameProject(' + p.id + ')" aria-label="重命名 ' + escapeHtml(p.name) + '">···</button>' +
    '<button type="button" class="proj-tab-del" onclick="deleteProject(' + p.id + ')" aria-label="移除 ' + escapeHtml(p.name) + '">×</button></div>').join('');
  renderCurrentProjectFailure(); renderResultProjectSwitcher(); updateSalesPrimaryState(); updateQueueControls();
}
function renderResultProjectSwitcher() {
  const wrap = document.getElementById('resultProjectSwitcher'), tabs = document.getElementById('resultProjectTabs'); if (!wrap || !tabs) return;
  wrap.style.display = PROJECTS.list.length ? '' : 'none';
  document.getElementById('resultProjectSummary').textContent = PROJECTS.list.filter(p => p.batches?.length).length + ' 个视频已有图片';
  tabs.innerHTML = PROJECTS.list.map(p => '<button class="result-project-tab' + (p.id === PROJECTS.activeId ? ' is-active' : '') + '" onclick="switchResultProject(' + p.id + ')"><span class="result-project-copy"><strong>' + escapeHtml(p.name) + '</strong><small>' + (taskStatusLabels[p.generationStatus] || '待生成') + '</small></span></button>').join('');
  const p = PROJECTS.list.find(x => x.id === PROJECTS.activeId);
  document.getElementById('resultVideoName').textContent = p?.name || '图片结果';
  const error = projectGenerationError(p), box = document.getElementById('resultProjectFailure');
  box.style.display = error ? '' : 'none';
  if (error) { document.getElementById('resultProjectFailureTitle').textContent = '生成失败'; document.getElementById('resultProjectFailureReason').textContent = error.stage + '：' + error.message; document.getElementById('resultProjectFailureMeta').textContent = '可修正设置后重试，已有图片会保留。'; }
  const empty = document.getElementById('resultEmptyState');
  if (empty) { empty.hidden = !!S.batches.length; empty.querySelector('strong').textContent = p?.generationStatus === 'running' ? '这个视频正在生成' : p?.generationStatus === 'paused' ? '这个视频已暂停' : '这个视频还没有图片结果'; }
  const replacing = !!p?.batches?.length && ['queued','running','paused'].includes(p.generationStatus);
  document.getElementById('batchList').inert = replacing;
  document.getElementById('batchList').classList.toggle('is-rebuilding', replacing);
  document.getElementById('generationNote').textContent = replacing ? '正在生成新版本，完成后会替换这些图片；此时可以导出现有图片，停止后可继续编辑。' : p?.generationNote || '';
}
async function retryProject(id) {
  if (taskQueue?.active) { toast('请在本次队列结束后重试，或先停止队列', 'warn'); return; }
  return startImageTasks(PROJECTS.list.filter(p => p.id === id));
}
async function retryCurrentFailedProject() { return retryProject(PROJECTS.activeId); }
async function importDesktopDroppedPaths(paths) {
  if (INTERNAL_MEDIA_DRAG.blocksFileImport()) return;
  const cacheRoot = String(DESKTOP_NATIVE.environment?.frameCacheDir || '').replace(/\\/g, '/').toLowerCase();
  const unique = [...new Set(paths)].filter(path => !cacheRoot || !String(path).replace(/\\/g, '/').toLowerCase().startsWith(cacheRoot + '/'));
  const videos = unique.filter(path => /\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg)$/i.test(path));
  if (videos.length) await importVideoFiles(await DESKTOP_NATIVE.invoke('inspect_video_files', { paths: videos }));
  if (videos.length < unique.length) toast('仅支持视频，其他文件已忽略', 'warn');
}
async function importVideoFiles(fileList) {
  if (typeof appUpdateInstalling !== 'undefined' && appUpdateInstalling) return;
  const files = Array.from(fileList || []), valid = files.filter(isVideoFile);
  if (!valid.length) { toast('请选择支持的视频文件', 'warn'); return; }
  saveActiveProject();
  const existing = new Set(PROJECTS.list.map(p => p.fileKey)), created = [];
  for (const file of valid) {
    const key = videoFileKey(file); if (existing.has(key)) continue;
    existing.add(key); created.push(createProject(file));
  }
  if (!created.length) { toast('这些视频已在列表中', 'warn'); return; }
  if (!PROJECTS.activeId) { PROJECTS.activeId = created[0].id; restoreProject(created[0]); }
  renderProjectTabs(); updateQueueControls(); scheduleWorkspaceSave();
  toast('已添加 ' + created.length + ' 个视频' + (taskQueue?.active ? '，将在下次开始时生成' : ''));
}
function taskConfig(project, extra = {}) {
  const value = id => document.getElementById(id)?.value;
  return {
    apiKey: value('selectionMode') === 'ai' ? value('aiApiKey')?.trim() : '', mode: value('selectionMode'),
    model: value('aiModel'), hint: value('aiPromptHint') || '', variants: Number(value('variantCount')) || 3,
    badge: !!document.getElementById('coverBadge')?.checked && getResolutionInfo(project.sourceMeta || project.nativeMeta || {}).is4K,
    captureMode: S.captureMode, interval: Math.max(.1, Number(value('itvl')) || 1), start: Math.max(0, Number(value('stt')) || 0),
    end: value('edt') ? Number(value('edt')) : null, maxFrames: Math.max(1, Math.min(600, Number(value('mxf')) || 120)),
    sceneThreshold: Math.max(.03, .18 - (Number(value('sceneSens')) - 10) / 50 * .15),
    cacheId: WORKSPACE_SESSION_ID + '-' + project.id + '-' + Date.now().toString(36), ...extra
  };
}
async function startImageTasks(projects, extra = {}) {
  if (typeof appUpdateInstalling !== 'undefined' && appUpdateInstalling) return;
  if (!projects.length || taskQueue?.active || generationStarting) return;
  generationStarting = true; updateSalesPrimaryState();
  try {
    saveActiveProject();
    if (!extra.captureOnly && document.getElementById('selectionMode').value === 'ai') {
      if (!document.getElementById('aiApiKey').value.trim()) { openSettingsDrawer(); toast('先配置 API Key，再使用 AI 选图', 'warn'); return; }
      if (!await ensureAiDataConsent()) return;
    }
    projects = projects.filter(p => PROJECTS.list.includes(p) && !p.deleted);
    projects.forEach(p => { p.runConfig = taskConfig(p, extra); p.generationProgress = 0; });
    await taskQueue.start(projects);
    // Credentials are kept in memory only for the running batch, never in history.
    projects.forEach(p => { if (p.runConfig) delete p.runConfig.apiKey; });
    scheduleWorkspaceSave(600);
  } finally { generationStarting = false; updateSalesPrimaryState(); }
}
async function runPrimarySalesAction() {
  const pending = PROJECTS.list.filter(p => !isProjectGenerationComplete(p));
  return startImageTasks(pending.length ? pending : PROJECTS.list.filter(p => p.id === PROJECTS.activeId));
}
async function runSalesKit() { return startImageTasks(PROJECTS.list.filter(p => p.id === PROJECTS.activeId)); }
async function runBatchSalesKit() { return runPrimarySalesAction(); }
async function doCapture() { return startImageTasks(PROJECTS.list.filter(p => p.id === PROJECTS.activeId), { captureOnly: true }); }
async function runSmartFlow() { return runSalesKit(); }
async function runSuperFlow() { return runSalesKit(); }
function cancelSalesRun() { return taskQueue?.stop(); }
function prepareRegenerate() { switchTab(0); }
function relocateUnifiedPanels(idx) {
  const pane = document.getElementById('tabPane1'), settings = document.getElementById('settingsLegacySlot');
  if (pane && settings && pane.parentElement !== settings) settings.appendChild(pane);
  const asset = document.getElementById('assetPanel'), slot = idx === 2 ? document.querySelector('#view2 .split-collage') : document.getElementById('unifiedAssetSlot');
  if (asset && slot && asset.parentElement !== slot) slot.appendChild(asset);
  updateListingChecklist();
}
function updateListingChecklist() {
  if (typeof S === 'undefined') return;
  const covers = S.batches.filter(b => b.assetKind === 'cover' && b.canvas), details = S.batches.filter(b => b.assetKind === 'detail' && b.canvas);
  const ready = !!(covers.length || details.length) && !S.batches.some(b => b.rendering);
  const final = covers.some(b => b.id === S.finalCoverId) && details.some(b => b.id === S.finalDetailId);
  setListingCheck('checkCover', !!covers.length, covers.length + ' 版封面');
  setListingCheck('checkDetail', !!details.length, details.length + ' 版详情');
  setListingCheck('checkFinal', final, final ? '主版本已选，可随时更换' : '可下载单图或导出已有图片');
  const summary = document.getElementById('listingSummary'); if (summary) summary.textContent = ready ? '默认选择 A 版，点击其他版本可更换。导出包含全部图片。' : '完成一个视频后即可查看、编辑和导出。';
  const button = document.getElementById('unifiedDownloadBtn'); if (button) { button.disabled = !ready; button.title = ready ? '打包当前视频的全部图片' : '等待图片生成'; }
  updateResultNavigationState();
}
function showAssetPreview(b) {
  if (!S.batches.includes(b) || !b.canvas) return;
  const wrap = document.getElementById('prev-' + b.id), target = document.getElementById('pcanvas-' + b.id);
  if (!wrap || !target) return;
  wrap.style.display = 'block';
  const width = Math.max(240, wrap.clientWidth || 400);
  target.width = width; target.height = Math.round(width * b.canvas.height / b.canvas.width);
  target.getContext('2d').drawImage(b.canvas, 0, 0, target.width, target.height);
  ['dl-', 'dl2-'].forEach(prefix => { const button = document.getElementById(prefix + b.id); if (button) button.disabled = false; });
  if (b.isDetailLong) buildDetailThumbDragOverlay(b, wrap);
}
function renderAllBatches() {
  const list = document.getElementById('batchList'); if (!list) return;
  list.innerHTML = '';
  S.batches.forEach(b => {
    if (b.isDetailLong) renderDetailBatchCard(b);
    else { renderBatch(b); b.cells.forEach((_, ci) => renderCell(b, ci)); }
    if (b.canvas) showAssetPreview(b);
    else if (b.wasGenerated) generateBatch(b.id, true).catch(console.warn);
  });
  updateListingChecklist();
}
async function generateBatch(id, silent = false) {
  const b = S.batches.find(x => x.id === id); if (!b) return;
  const project = PROJECTS.list.find(x => x.id === PROJECTS.activeId), frames = S.frames;
  const revision = (b.renderRevision || 0) + 1; b.renderRevision = revision;
  b.rendering = true;
  ['dl-', 'dl2-'].forEach(prefix => { const el = document.getElementById(prefix + id); if (el) el.disabled = true; });
  updateListingChecklist();
  const button = document.getElementById('gen-' + id); if (button) { button.disabled = true; button.textContent = '更新中…'; }
  try {
    const image = await FrameStudio.renderAsset(b, frames, null, DESKTOP_NATIVE, S.badgeImg);
    if (project?.deleted || b.renderRevision !== revision) return;
    b.canvas = image; b.wasGenerated = true;
    if (S.batches.includes(b)) { showAssetPreview(b); updateFinalAssetUI(); }
    scheduleWorkspaceSave();
    if (!silent) toast('图片已更新');
  } catch (error) { toast('图片更新失败：' + error.message, 'err'); throw error; }
  finally {
    if (b.renderRevision === revision) b.rendering = false;
    if (S.batches.includes(b)) updateListingChecklist();
    if (button?.isConnected) { button.disabled = false; button.textContent = '更新图片'; }
  }
}
async function regenDetailLong(b) { if (b) return generateBatch(b.id, true); }
async function renderDetailLongCanvas(b) { return FrameStudio.renderAsset(b, S.frames, null, DESKTOP_NATIVE, null); }
function renderBatchTitle(b) {
  const el = document.getElementById('batch-' + b.id); if (!el) return;
  el.querySelector('.batch-tag').textContent = b.title || '自定义拼图';
}
function listingPayload() {
  const project = PROJECTS.list.find(p => p.id === PROJECTS.activeId);
  return { project: project?.name || '视频图片', exportedAt: new Date().toISOString(), source: getSourceMeta(),
    finalCoverId: S.finalCoverId, finalDetailId: S.finalDetailId,
    assets: S.batches.filter(b => b.canvas).map(b => ({ id: b.id, kind: b.assetKind, width: b.canvas.width, height: b.canvas.height })) };
}
async function exportListingPackage() {
  if (S.batches.some(b => b.rendering)) { toast('图片正在更新，请稍后导出'); return; }
  const ready = S.batches.filter(b => b.canvas).map(b => ({ id: b.id, assetKind: b.assetKind, canvas: b.canvas })); if (!ready.length) return;
  const snapshot = listingPayload();
  const format = { ...EXPORT };
  const coverId = S.finalCoverId, detailId = S.finalDetailId;
  const button = document.getElementById('unifiedDownloadBtn'); button.disabled = true; button.textContent = '正在打包…';
  try {
    const files = {}, ext = format.format === 'jpeg' ? 'jpg' : format.format;
    for (const b of ready) {
      const prefix = b.assetKind === 'cover' ? '封面' : b.assetKind === 'detail' ? '详情' : '拼图';
      const name = prefix + '/' + (b.id === coverId || b.id === detailId ? '主版本_' : '') + b.id + '.' + ext;
      const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(b.canvas.width * format.scale)); out.height = Math.max(1, Math.round(b.canvas.height * format.scale));
      out.getContext('2d').drawImage(b.canvas, 0, 0, out.width, out.height);
      const blob = await new Promise(resolve => out.toBlob(resolve, 'image/' + format.format, format.quality));
      if (!blob) throw new Error('图片编码失败，请调低导出尺寸');
      files[name] = new Uint8Array(await blob.arrayBuffer());
      const info = snapshot.assets.find(a => a.id === b.id); Object.assign(info, { file: name, width: out.width, height: out.height });
      out.width = out.height = 1;
    }
    files['图片清单.json'] = fflate.strToU8(JSON.stringify(snapshot, null, 2));
    const zip = await new Promise((resolve, reject) => fflate.zip(files, { level: 0 }, (error, value) => error ? reject(error) : resolve(value)));
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    link.download = snapshot.project.replace(/[\\/:*?"<>|]/g, '_') + '_图片包.zip'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000); toast('图片包已导出');
  } catch (error) { toast('导出失败：' + error.message, 'err'); }
  finally { button.textContent = '导出图片包'; updateListingChecklist(); }
}
function serializeProjectDraft(p) {
  const { runConfig, imgCache, storyDoc, manualStoryDoc, salesFeedback, salesPlan, deleted, ...rest } = p;
  return { ...rest, videoUrl: '', videoBlob: p.desktopPath ? null : p.videoBlob, imgCache: null,
    generationStatus: ['running', 'queued', 'paused'].includes(p.generationStatus) ? 'stopped' : p.generationStatus,
    batches: (p.batches || []).map(serializeBatchDraft), salesPlan: null };
}
