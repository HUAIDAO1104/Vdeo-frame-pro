# VideoFrame Pro — 视频截帧 · AI 挑帧 · 拼图出图

## 项目概述
- **名称**: VideoFrame Pro
- **目标**: 在浏览器端从视频按间隔/场景截取关键帧，调用 Vision AI 智能挑选最佳画面，并拼接导出为多宫格成品图。全程本地处理，隐私安全。
- **核心特性**: 视频截帧、AI 智能挑帧（Vision 大模型 + 本地算法降级）、AI 审美记忆、拼图批次填充与导出、4 套主题、撤销/重做、键盘快捷键。

## 技术栈
- Hono + Cloudflare Pages（Vite 构建）
- 单文件前端应用 `public/app.html`（通过 `?raw` 注入 `src/index.tsx`）
- 原生 Canvas 截帧、IndexedDB 审美记忆、Web Crypto/Fetch
- 设计系统：CSS 自定义属性（`[data-theme]` × `[data-mode]`）

## 功能进度

### ✅ Batch 1 — 视觉与版式（已完成）
- 方案 B 版式：左侧浮动图标导航 + 三全屏工作区（截帧 / AI / 拼图）
- 大圆角玻璃面板、4 主题（Aurora / Mint / Sapphire / Amber）× 明暗模式
- 图标系统统一（全部 emoji → SVG），表单字号/控件高度规范化
- 键盘快捷键帮助浮层（`?` 键）

### ✅ Batch 2 — 实用性增强（已完成）
- **撤销 / 重做**：基于拼图格子快照的历史栈（最多 50 步），覆盖填充、清空、拖拽放置、单格增删、AI 智能排版。快捷键 `Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`）。
- **精确进度 + 时间预估（ETA）**：截帧与 AI 评分阶段实时显示「剩余约 Xm Ys」，完成后报告用时与成功/失败帧数。
- **错误处理 + seek 重试**：视频 seek 失败自动退避重试（最多 2 次，带时间抖动绕过卡住关键帧），空白帧检测，友好错误提示。
- **响应式布局**：≤1024px 三栏堆叠为单列；≤760px 导航变顶部吸顶横排；≤640px 导航收缩为纯图标。

### ⏳ 待开发
- **Batch 3**：场景变化检测截帧、单元格裁剪编辑、AI 逐帧评分可视化增强
- **Batch 4**：批量视频（独立项目）、导出选项（PNG / 质量 / 分辨率，不含 ZIP）

## 主要交互入口
- 工作区切换：左侧导航 / 快捷键 `1` `2` `3` / `switchTab(idx)`
- 截帧：截帧参数面板「截取视频帧」，或「一键截帧 · AI挑帧 · 出图」
- AI 挑帧：AI 面板「AI 自动挑帧」/「挑帧并自动填入所有批次」
- 拼图：拼图面板添加批次（2×2 / 3×3 / 自定义）→ 填充 → 一键生成 / 下载

## 数据架构
- **运行时状态** `S`：`frames`（截取帧）、`selected`（已选）、`batches`（拼图批次，`cells` 存帧索引）、`aiScores`、`imgCache`
- **历史栈** `HISTORY`：`stack` / `future`，存储 `batches[].cells` 深拷贝快照
- **持久化**：IndexedDB（AI 审美记忆 good/bad 参考图）、localStorage（API Key、主题）
- **存储服务**：纯前端，无后端数据库；后端仅 Hono 提供静态资源与页面

## 本地开发
```bash
npm install
npm run build
pm2 start ecosystem.config.cjs   # wrangler pages dev dist --port 3000
curl http://localhost:3000
```

## 部署
- **平台**: Cloudflare Pages
- **状态**: 本地开发中（PM2 app "webapp"，端口 3000）
- **最后更新**: 2026-06-02（Batch 2 完成）
