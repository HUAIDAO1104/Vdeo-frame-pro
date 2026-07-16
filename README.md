# 光厂素材包上架助手

把一个视频素材包整理成可直接复核和导出的上架结果：封面候选、详情长图、SEO 标题、作品简介和关键词集中在同一条工作流中完成。

## 核心流程

1. 一次选择或拖入多个视频和多个 TXT、Markdown、CSV、JSON、RTF、DOC 或 DOCX 分镜文档。
2. 系统通过 AI 或文件名将文档自动对应到视频；每份文档都可手动改配对或单独删除。
3. 一次启动整批任务，系统会逐个视频生成销售策略、封面、详情长图与 SEO 文案。
4. 在统一结果页比较封面、逐格换图、修改详情标题并选择主推版本。
5. 导出 ZIP 上架包，包含封面、详情、`listing.txt` 和 `listing.json`。

## 数据与隐私

- 视频解码、候选帧提取、拼图合成和 ZIP 导出在浏览器本地完成。
- 启用 AI 时，压缩后的抽样画面、分镜文档和补充要求会发送到当前配置的 AI 接口。
- API Key 默认仅保存在当前浏览器会话；只有主动勾选后才长期保存在此浏览器。
- 当前批次会保存到独立的本机历史记录，但新打开页面保持空白；只有用户主动选择历史记录时才恢复到工作台。

## 技术栈

- Hono + Vite + Cloudflare Pages
- 原生 Canvas 视频截帧与图片合成
- IndexedDB 草稿与偏好存储
- Mammoth 浏览器版解析 DOCX
- Fflate 生成上架 ZIP

## 本地开发

```bash
npm install
npm run dev
npm run test
npm run build
```

默认开发地址为 `http://localhost:5173/`。

## 主要文件

- `public/app.html`：页面结构和当前业务逻辑
- `public/static/style.css`：产品视觉与响应式样式
- `src/index.tsx`：Hono 服务入口
- `docs/product-review.md`：本轮产品审查与整改依据
