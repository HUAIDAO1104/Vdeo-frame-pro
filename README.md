# 光厂素材包上架助手

把一个视频素材包整理成可直接复核和导出的上架结果：封面候选、详情长图、SEO 标题、作品简介和关键词集中在同一条工作流中完成。

## 核心流程

1. 一次选择或拖入多个视频和多个 TXT、Markdown、CSV、JSON、RTF、DOC 或 DOCX 分镜文档。
2. 系统通过 AI 或文件名将文档自动对应到视频；每份文档都可手动改配对或单独删除。
3. 一次启动整批任务，系统会逐个视频生成销售策略、封面、详情长图与 SEO 文案。
4. 在统一结果页比较封面、逐格换图、修改详情标题并选择主推版本。
5. 导出 ZIP 上架包，包含封面、详情、`listing.txt` 和 `listing.json`。

## 两种运行方式

- 网页版：适合快速试用与线上部署，使用浏览器 Canvas 和 IndexedDB。
- Windows 桌面版：适合批量处理。FFmpeg 在本机把高清工作帧写入磁盘缓存，项目历史保存在 SQLite；页面只加载当前可见画面，显著降低内存和解码压力。

桌面版不会在本机运行大模型，AI 选图和 SEO 仍使用已配置的云端接口。Windows 版会默认尝试 FFmpeg 硬件解码，可使用 NVIDIA、Intel 或 AMD 显卡提供的可用加速能力；不兼容时自动回退 CPU。CPU、显卡、内存和 SSD 都会影响视频截帧与导出速度。

## 数据与隐私

- 网页版的视频解码、候选帧提取、拼图合成和 ZIP 导出在浏览器本地完成。
- Windows 桌面版通过随安装包提供的 FFmpeg 在本机提取画面，高清帧缓存与项目数据库位于应用本地数据目录。
- 启用 AI 时，压缩后的抽样画面、分镜文档和补充要求会发送到当前配置的 AI 接口。
- API Key 默认仅保存在当前浏览器会话；只有主动勾选后才长期保存在此浏览器。
- 当前批次会保存到独立的本机历史记录，但新打开页面保持空白；只有用户主动选择历史记录时才恢复到工作台。

## 技术栈

- Hono + Vite + Cloudflare Pages
- 原生 Canvas 视频截帧与图片合成
- IndexedDB 草稿与偏好存储
- Mammoth 浏览器版解析 DOCX
- Fflate 生成上架 ZIP
- Tauri 2 + Rust + FFmpeg + SQLite（Windows 桌面版）

## 本地开发

```bash
npm install
npm run dev
npm run test
npm run build
```

默认开发地址为 `http://localhost:5173/`。

## Windows 桌面版

首次在 Windows 10/11 x64 上准备环境：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

重新打开 PowerShell 后构建安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

生成的安装程序位于：

```text
src-tauri\target\release\bundle\nsis\
```

也可以在 GitHub Actions 中手动运行 `Windows Desktop` 工作流。工作流会自动准备 FFmpeg 并上传 Windows x64 安装包。

## 主要文件

- `public/app.html`：页面结构和当前业务逻辑
- `public/static/style.css`：产品视觉与响应式样式
- `src/index.tsx`：Hono 服务入口
- `src-tauri/src/lib.rs`：桌面端 FFmpeg、硬件解码、帧缓存与 SQLite 后端
- `scripts/build-windows.ps1`：Windows 本地构建入口
- `docs/product-review.md`：本轮产品审查与整改依据
