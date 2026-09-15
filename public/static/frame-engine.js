/* Project-scoped media processing: no access to the editor's global state or DOM. */
(function (root) {
  const check = signal => { if (signal?.aborted) throw new DOMException('操作已中断', 'AbortError'); };
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
  function waitMedia(video, event, signal, action) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = error => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener('error', failed);
        signal?.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const done = () => finish();
      const failed = () => finish(new Error('无法解码视频，请检查文件或使用 Windows 桌面版'));
      const aborted = () => finish(new DOMException('操作已中断', 'AbortError'));
      video.addEventListener(event, done, { once: true });
      video.addEventListener('error', failed, { once: true });
      signal?.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(new Error('读取视频超时')), 15000);
      if (signal?.aborted) return aborted();
      try { action(); } catch (error) { finish(error); }
    });
  }
  async function loadFrame(frame, signal, native) {
    check(signal);
    let src = frame.dataUrl, revoke = false;
    if (frame.filePath && native?.enabled) {
      const bytes = await native.invoke('read_cached_frame', { path: frame.filePath });
      check(signal);
      src = URL.createObjectURL(new Blob([bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes)], { type: 'image/jpeg' }));
      revoke = true;
    }
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        const finish = error => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          img.onload = img.onerror = null;
          if (error) { img.src = ''; reject(error); } else resolve(img);
        };
        const abort = () => finish(new DOMException('操作已中断', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('候选画面加载超时')), 15000);
        img.onload = () => finish();
        img.onerror = () => finish(new Error('候选画面无法读取，请重新提取'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        img.src = src;
      });
    } finally { if (revoke) URL.revokeObjectURL(src); }
  }
  async function capture(project, config, ctx, native) {
    if (project.sourceKind === 'images') {
      const frames = [], skipped = [...(project.importWarnings || [])];
      const sources = project.imageSources || [];
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const frame = await ctx.step('读取图片 ' + (i + 1) + ' / ' + sources.length, async signal => {
          let url;
          try {
            url = source.blob ? URL.createObjectURL(source.blob) : null;
            const image = await loadFrame({ filePath: source.filePath, dataUrl: url }, signal, native);
            check(signal);
            const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
            const out = canvas(image.width * scale, image.height * scale);
            // Flatten transparency consistently for both local scoring and AI.
            const cx = out.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, out.width, out.height);
            cx.drawImage(image, 0, 0, out.width, out.height);
            return { dataUrl: source.filePath ? native.fileUrl(source.filePath) : out.toDataURL('image/jpeg', .92),
              filePath: source.filePath, sourceName: source.name, downloadName: source.filePath ? source.name : source.name.replace(/\.[^.]+$/, '.jpg'), time: 0, idx: frames.length,
              w: image.width, h: image.height };
          } catch (error) {
            check(signal);
            if (error.name === 'AbortError') throw error;
            skipped.push(source.name + '：无法解码或读取'); return null;
          } finally { if (url) URL.revokeObjectURL(url); }
        });
        if (frame) frames.push(frame);
        ctx.progress(Math.round(5 + 40 * (i + 1) / sources.length));
        await new Promise(r => setTimeout(r, 0));
      }
      if (!frames.length) throw new Error('没有可分析的图片，请检查图片是否损坏或重新选择文件夹');
      project.imageWarnings = skipped;
      return frames;
    }
    if (native?.enabled && project.desktopPath) {
      return ctx.step('本机提取画面', async signal => {
        const requestId = 'extract-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        let cancellation;
        const cancel = () => { cancellation = native.invoke('cancel_frame_extraction', { requestId }); cancellation.catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          check(signal);
          const result = await native.invoke('extract_video_frames', { request: {
            requestId, videoPath: project.desktopPath, projectId: config.cacheId,
            mode: config.captureMode, interval: config.interval, startTime: config.start,
            endTime: config.end, maxFrames: config.maxFrames, sceneThreshold: config.sceneThreshold,
            previewWidth: 1920, preferHardware: true
          } });
          check(signal);
          return result.map((f, idx) => ({ dataUrl: native.fileUrl(f.path), filePath: f.path, time: f.time, w: f.width, h: f.height, idx }));
        } finally {
          signal.removeEventListener('abort', cancel);
          if (cancellation) await cancellation;
        }
      }, 360000);
    }
    // This video is private to the job; changing the preview cannot move its playhead.
    const video = document.createElement('video');
    video.muted = true; video.preload = 'auto'; video.playsInline = true;
    try {
      await ctx.step('读取视频', signal => waitMedia(video, 'loadedmetadata', signal, () => { video.src = project.videoUrl; video.load(); }));
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('视频没有有效时长');
      project.sourceMeta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration, fileName: project.fileName };
      const start = Math.max(0, config.start), end = Math.min(config.end ?? video.duration, video.duration);
      if (start >= end) throw new Error('开始时间必须小于结束时间和视频时长');
      const max = Math.max(1, Math.min(600, config.maxFrames));
      const count = Math.min(max, Math.max(1, Math.ceil((end - start) / config.interval)));
      // Even coverage of the entire time range, including when the frame budget is small.
      const times = Array.from({ length: count }, (_, i) => start + (end - start) * (i + .5) / count);
      const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
      const out = canvas(video.videoWidth * scale, video.videoHeight * scale), cx = out.getContext('2d');
      const probe = canvas(32, 18), px = probe.getContext('2d', { willReadFrequently: true });
      const frames = [];
      let previous;
      for (let i = 0; i < times.length; i++) {
        const frame = await ctx.step('提取画面 ' + (i + 1) + ' / ' + count, async signal => {
          await waitMedia(video, 'seeked', signal, () => { video.currentTime = times[i]; });
          check(signal);
          cx.drawImage(video, 0, 0, out.width, out.height);
          px.drawImage(video, 0, 0, 32, 18);
          const pixels = px.getImageData(0, 0, 32, 18).data;
          const diff = previous ? pixels.reduce((sum, x, j) => sum + (j % 4 === 3 ? 0 : Math.abs(x - previous[j])), 0) / (32 * 18 * 3 * 255) : 1;
          previous = pixels;
          if (config.captureMode === 'scene' && diff < config.sceneThreshold && frames.length) return null;
          return { dataUrl: out.toDataURL('image/jpeg', .9), time: times[i], idx: frames.length, w: out.width, h: out.height };
        });
        if (frame) frames.push(frame);
        ctx.progress(Math.round(5 + 40 * (i + 1) / count));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return frames;
    } finally { video.pause(); video.removeAttribute('src'); video.load(); }
  }
  async function inspect(frames, ctx, native) {
    const probe = canvas(32, 18), cx = probe.getContext('2d', { willReadFrequently: true });
    const items = [];
    for (let i = 0; i < frames.length; i++) {
      items.push(await ctx.step('分析清晰度与画面差异', async signal => {
        const image = await loadFrame(frames[i], signal, native);
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, 32, 18);
        cx.drawImage(image, 0, 0, 32, 18);
        const rgba = cx.getImageData(0, 0, 32, 18).data;
        const pixels = Array.from({ length: 576 }, (_, j) => .299 * rgba[j * 4] + .587 * rgba[j * 4 + 1] + .114 * rgba[j * 4 + 2]);
        // Keep spatial RGB too: equal-luminance scenes can have different colors.
        const colors = Uint8Array.from({ length: 576 * 3 }, (_, j) => rgba[Math.floor(j / 3) * 4 + j % 3]);
        const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
        let edge = 0;
        for (let j = 0; j < pixels.length; j++) {
          if (j % 32) edge += Math.abs(pixels[j] - pixels[j - 1]);
          if (j >= 32) edge += Math.abs(pixels[j] - pixels[j - 32]);
        }
        const clarity = Math.min(1, edge / pixels.length / 45);
        const exposure = 1 - Math.abs(mean - 128) / 128;
        return { frameIdx: i, pixels, colors, clarity, overall: .7 * clarity + .3 * exposure, time: frames[i].time, aspect: frames[i].w / frames[i].h };
      }));
      if (i % 12 === 0) { ctx.progress(45 + Math.round(10 * i / frames.length)); await new Promise(r => setTimeout(r, 0)); }
    }
    return items;
  }
  function similarFrames(a, b) {
    const left = a.colors || a.pixels, right = b.colors || b.pixels;
    if (!left?.length || left.length !== right?.length) return false;
    const channels = a.colors && b.colors ? 3 : 1;
    let total = 0, changed = 0;
    for (let i = 0; i < left.length; i += channels) {
      let delta = 0;
      for (let c = 0; c < channels; c++) delta += Math.abs(left[i + c] - right[i + c]) / 255;
      delta /= channels;
      total += delta;
      if (delta > .14) changed++;
    }
    const cells = left.length / channels;
    // Conservative spatial comparison, not a semantic scene classifier.
    return total / cells <= .045 && changed / cells <= .08;
  }
  function sceneRepresentatives(items) {
    const ordered = [...items].sort((a, b) => a.time - b.time || a.frameIdx - b.frameIdx);
    const gaps = ordered.slice(1).map((item, i) => item.time - ordered[i].time).filter(gap => gap > 0).sort((a, b) => a - b);
    // Adapt to the actual sampling interval. A missing stretch starts a new group.
    const nearby = Math.min(10, Math.max(3, (gaps[Math.floor(gaps.length / 2)] || 1) * 2.5));
    const groups = [];
    let group;
    for (const item of ordered) {
      // Compare to a fixed anchor as well as the previous frame: gradual motion
      // must not chain an entire changing shot into a single representative.
      if (!group || item.time - group.last.time > nearby || !similarFrames(item, group.anchor) || !similarFrames(item, group.last)) {
        group = { anchor: item, last: item, best: item, memberIds: [] };
        groups.push(group);
      }
      group.memberIds.push(item.frameIdx);
      group.last = item;
      if (item.overall > group.best.overall) group.best = item;
    }
    return groups.map((group, sceneId) => ({ ...group.best, sceneId, memberIds: group.memberIds,
      startTime: group.anchor.time, endTime: group.last.time }));
  }
  function diverse(items, count) {
    const pool = [...items].sort((a, b) => b.overall - a.overall);
    const picked = [];
    const span = Math.max(1, Math.max(...items.map(x => x.time || 0)) - Math.min(...items.map(x => x.time || 0)));
    const distances = new Map(pool.map(item => [item, { pixels: 1, time: 1 }]));
    while (pool.length && picked.length < count) {
      let best = 0, score = -Infinity;
      pool.forEach((item, i) => {
        const distance = distances.get(item);
        const value = item.overall * .5 + Math.min(1, distance.pixels * 4) * .35 + distance.time * .15;
        if (value > score) { score = value; best = i; }
      });
      const selected = pool.splice(best, 1)[0];
      picked.push(selected);
      for (const item of pool) {
        const distance = distances.get(item);
        distance.pixels = Math.min(distance.pixels, item.pixels.reduce((sum, x, j) => sum + Math.abs(x - selected.pixels[j]), 0) / item.pixels.length / 255);
        distance.time = Math.min(distance.time, Math.abs(item.time - selected.time) / span);
      }
    }
    return picked.map(x => x.frameIdx);
  }
  function imageRepresentatives(items) {
    const groups = [];
    // Independent pictures have no video timeline. Compare across the folder,
    // retaining the clearest anchor; never merge different aspect ratios.
    for (const item of [...items].sort((a, b) => b.overall - a.overall || a.frameIdx - b.frameIdx)) {
      const group = groups.find(g => Math.abs(g.aspect - item.aspect) < .02 && similarFrames(g, item));
      if (group) group.memberIds.push(item.frameIdx);
      else groups.push({ ...item, sceneId: groups.length, memberIds: [item.frameIdx] });
    }
    return groups;
  }
  function makeAssets(order, frames, config, baseId) {
    const fill = (indices, n) => Array.from({ length: n }, (_, i) => indices[i % indices.length]);
    const covers = [], details = [], count = config.variants;
    const buckets = Array.from({ length: count }, (_, offset) => order.filter((_, i) => i % count === offset));
    for (let i = 0; i < count; i++) {
      const picks = buckets[i].length ? buckets[i] : order;
      covers.push({ id: ++baseId, cols: 2, rows: 2, cells: fill(picks, 4), crops: {}, hasBadge: config.badge,
        assetKind: 'cover', title: '封面 ' + String.fromCharCode(65 + i), note: '四宫格 · 点击画面替换', canvas: null });
    }
    const used = new Set(covers.flatMap(x => x.cells));
    const detailOrder = [...order.filter(x => !used.has(x)), ...order.filter(x => used.has(x))];
    // Short/static clips get a compact 3x3; longer clips add intentional 1/3/2 rows.
    const rowPlan = order.length >= 15 ? [1, 3, 2] : order.length >= 10 ? [1] : [];
    for (let i = 0; i < count; i++) {
      const rotated = detailOrder.slice(i * 3).concat(detailOrder.slice(0, i * 3));
      const filled = fill(rotated.length ? rotated : order, 9 + rowPlan.reduce((a, b) => a + b, 0));
      const gridFrames = filled.splice(0, 9);
      details.push({ id: ++baseId, cols: 3, rows: 0, cells: [], crops: {}, hasBadge: false, assetKind: 'detail',
        isDetail: true, isDetailLong: true, heroShowText: false, detailLayout: { gridFrames, rows: rowPlan.map(cols => ({ cols, frames: filled.splice(0, cols) })) },
        title: '详情 ' + String.fromCharCode(65 + i), note: '九宫格' + (rowPlan.length ? ' + ' + rowPlan.length + ' 行' : '') + ' · 纯画面', canvas: null });
    }
    return [...covers, ...details];
  }
  async function renderAsset(asset, frames, signal, native, badgeImage) {
    check(signal);
    const isLong = asset.isDetailLong;
    const rows = isLong ? [0, 1, 2].map(i => ({ cols: 3, frames: asset.detailLayout.gridFrames.slice(i * 3, i * 3 + 3) })).concat(asset.detailLayout.rows) :
      Array.from({ length: asset.rows }, (_, i) => ({ cols: asset.cols, frames: asset.cells.slice(i * asset.cols, (i + 1) * asset.cols) }));
    const first = frames.find(f => f?.w && f?.h), ar = first ? first.w / first.h : 16 / 9;
    let width = isLong ? 1620 : Math.round(540 * ar * asset.cols);
    if (!isLong) width *= Math.min(1, 3840 / Math.max(width, 540 * asset.rows));
    width = Math.round(width);
    const heights = rows.map(row => Math.round(width / row.cols / ar));
    // Tall vertical videos must remain within a safe canvas and memory budget.
    const total = heights.reduce((a, b) => a + b, 0), ratio = Math.min(1, 14000 / total, Math.sqrt(22000000 / (width * total)));
    const out = canvas(width * ratio, total * ratio), cx = out.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'; cx.fillStyle = frames[0]?.sourceName ? '#fff' : '#161a23'; cx.fillRect(0, 0, out.width, out.height);
    let y = 0, index = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r], nextY = r === rows.length - 1 ? out.height : Math.round((heights.slice(0, r + 1).reduce((a, b) => a + b, 0)) * ratio);
      for (let c = 0; c < row.cols; c++, index++) {
        check(signal);
        const frame = frames[row.frames[c]];
        if (!frame) continue;
        const image = await loadFrame(frame, signal, native);
        const x = Math.round(out.width * c / row.cols), w = Math.round(out.width * (c + 1) / row.cols) - x, h = nextY - y;
        const crop = !isLong && asset.crops?.[index], zoom = crop?.scale || 1;
        const scale = Math.max(w / image.width, h / image.height) * zoom, sw = image.width * scale, sh = image.height * scale;
        const dx = x + (w - sw) / 2 + (crop?.ox || 0) * .5 * sw, dy = y + (h - sh) / 2 + (crop?.oy || 0) * .5 * sh;
        cx.save(); cx.beginPath(); cx.rect(x, y, w, h); cx.clip(); cx.drawImage(image, dx, dy, sw, sh); cx.restore();
      }
      y = nextY;
    }
    if (asset.hasBadge && badgeImage) cx.drawImage(badgeImage, 0, 0, badgeImage.naturalWidth, badgeImage.naturalHeight);
    return out;
  }
  function create({ native, scoreBatch, badge }) {
    const cache = new Map();
    return {
      discard(id) { cache.delete(id); },
      async generate(project, ctx) {
        const config = project.runConfig;
        let work = cache.get(project.id);
        const key = JSON.stringify({ ...config, apiKey: undefined });
        if (!work || work.key !== key) { work = { key }; cache.set(project.id, work); }
        if (!work.frames) work.frames = await capture(project, config, ctx, native);
        const frames = work.frames;
        if (!frames.length) throw new Error('没有提取到画面，请调整截取范围或改用均匀采样');
        if (config.captureOnly) return { frames, batches: [], selected: [], aiScores: [], batchIdCnt: 0, finalCoverId: null, finalDetailId: null, salesPlan: null,
          selectionSummary: null, lastPick: null, generationNote: '已提取 ' + frames.length + ' 张候选，开始生成后将归并相邻相似画面。' };
        if (!work.items) work.items = await inspect(frames, ctx, native);
        const items = work.items.map(x => ({ ...x }));
        const representatives = project.sourceKind === 'images' ? imageRepresentatives(items) : sceneRepresentatives(items);
        const byId = new Map(items.map(item => [item.frameIdx, item]));
        for (const representative of representatives) {
          for (const id of representative.memberIds) Object.assign(byId.get(id), {
            representativeId: representative.frameIdx, sceneId: representative.sceneId,
            scoreSource: id === representative.frameIdx ? 'local' : 'merged'
          });
        }
        ctx.progress(55, '已归并为 ' + representatives.length + ' 张代表画面（原 ' + frames.length + ' 张）');
        if (config.apiKey) {
          const sampleIds = representatives.map(item => item.frameIdx);
          const allScores = [];
          for (let offset = 0; offset < sampleIds.length; offset += 8) {
            const scores = await ctx.step('AI 评分 ' + (offset + 1) + '–' + Math.min(offset + 8, sampleIds.length) + ' / ' + sampleIds.length + ' 张代表画面', async signal => {
              const inputs = [];
              for (const id of sampleIds.slice(offset, offset + 8)) {
                const image = await loadFrame(frames[id], signal, native);
                const scale = Math.min(1, 480 / Math.max(image.width, image.height));
                const thumb = canvas(image.width * scale, image.height * scale);
                const cx = thumb.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, thumb.width, thumb.height);
                cx.drawImage(image, 0, 0, thumb.width, thumb.height);
                inputs.push({ frameIdx: id, b64: thumb.toDataURL('image/jpeg', .7).split(',')[1] });
              }
              return scoreBatch(inputs, config.apiKey, config.model, config.hint, signal);
            }, 90000);
            if (scores.length !== Math.min(8, sampleIds.length - offset)) throw new Error('选图模型未返回完整评分，请重试或更换视觉模型');
            allScores.push(...scores);
            ctx.progress(55 + Math.round(20 * allScores.length / sampleIds.length));
          }
          const scoresById = new Map(allScores.map(score => [score.frameIdx, score]));
          if (scoresById.size !== representatives.length || representatives.some(item => !scoresById.has(item.frameIdx))) throw new Error('代表画面评分不完整，请重试');
          for (const item of representatives) {
            const ai = scoresById.get(item.frameIdx), localScore = item.overall;
            Object.assign(item, ai, { localScore, vision: { ...ai }, overall: ai.overall * .8 + localScore * .2, scoreSource: 'vision' });
            Object.assign(byId.get(item.frameIdx), { ...ai, localScore, vision: { ...ai }, overall: item.overall, scoreSource: 'vision' });
          }
        }
        // Only representatives enter automatic layouts. All source candidates
        // remain available for manual replacement; no hidden 32/60-frame cap.
        const order = diverse(representatives, representatives.length);
        const assets = makeAssets(order, frames, config, project.batchIdCnt || 0);
        for (let i = 0; i < assets.length; i++) {
          assets[i].canvas = await ctx.step('合成' + assets[i].title, signal => renderAsset(assets[i], frames, signal, native, badge()));
          ctx.progress(78 + Math.round(22 * (i + 1) / assets.length));
        }
        const selectionSummary = { candidates: frames.length, representatives: representatives.length,
          merged: frames.length - representatives.length, scored: config.apiKey ? representatives.length : 0 };
        return { frames, batches: assets, selected: order, aiScores: items.map(({ pixels, colors, ...x }) => x), selectionSummary,
          batchIdCnt: assets.at(-1).id, finalCoverId: assets[0].id, finalDetailId: assets.find(x => x.assetKind === 'detail').id,
          salesPlan: null, localFrameCache: !!(project.desktopPath || project.imageCacheId), lastPick: { engine: config.apiKey ? 'vision' : 'local', model: config.model, ok: true, count: order.length },
          generationNote: (project.sourceKind === 'images' ? '读取 ' : '提取 ') + frames.length + ' 张候选 · 合并 ' + selectionSummary.merged + (project.sourceKind === 'images' ? ' 张相似图片 · ' : ' 张相邻相似画面 · ') + representatives.length + ' 张代表画面' +
            (project.imageWarnings?.length ? '（跳过 ' + project.imageWarnings.length + ' 张无法读取的图片，可在素材页查看）' : '') +
            (config.apiKey ? '均已 AI 评分。' : '用于本地选图。') + (representatives.length < 9 ? '代表画面较少，部分格子复用；全部候选仍可手动替换。' : '全部候选仍可手动替换。') };
      }
    };
  }
  root.FrameStudio = { create, renderAsset, loadFrame, diverse, makeAssets, sceneRepresentatives, imageRepresentatives, similarFrames };
})(globalThis);
