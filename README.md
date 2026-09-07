# 帧选 · Frame Studio

从视频制作四宫格封面和详情展示图的本地工作台。当前源码版本：**0.2.0**。

## 使用流程

1. 添加或拖入多个视频。
2. 选择生成 1 组或 3 组候选图片，以及本地选图或可选的 AI 选图。
3. 点击开始。每完成一个视频，即可查看、逐格替换、裁剪、交换和导出它的图片。
4. 后台队列可以暂停、继续、停止，也可移除排队中或正在处理的视频。
5. 选择主封面和主详情，下载单图，或导出包含全部图片和 `图片清单.json` 的 ZIP。

本版本已移除文档上传匹配、销售策略、标题、简介和关键词生成。图片不会自动叠加文字。4K 角标默认关闭，仅可用于 4K 源视频。

## Windows 下载与更新

[下载 Windows 0.2.0 x64 安装包](https://github.com/HUAIDAO1104/Vdeo-frame-pro/releases/download/desktop-v0.2.0/SalesKitStudio_0.2.0_x64-setup.exe)（约 60 MB）。2026-09-07 已发布：[发行说明](https://github.com/HUAIDAO1104/Vdeo-frame-pro/releases/tag/desktop-v0.2.0)、[构建与发布验证](docs/releases/0.2.0-verification.md)。0.1.6 及更早版本没有更新模块，需要先关闭旧程序、运行一次 0.2.0 安装包，无需预先卸载。

0.2.0 起，Windows 启动时和运行中每 6 小时自动检查更新；也可打开“设置 → 版本与更新”。收到新版提示后点击“保存并安装”，程序会保存当前任务、下载并验证签名，再启动安装。视频正在运行或暂停时需要先停止；更新失败可继续使用旧版并重试。

Windows 安装名称沿用“光厂上架助手”，以保留旧版安装位置和升级识别；界面、图标与窗口使用“帧选”。应用标识和数据目录保持兼容。

### 队列行为

| 操作 | 行为 |
| --- | --- |
| 暂停 | 中断当前可取消的步骤，保留已完成结果；继续时重试被中断的步骤 |
| 停止 | 结束当前处理并清空待执行队列；保留视频列表、历史和已完成图片 |
| 移除视频 | 中止该视频的任务并从工作台移除；不删除原始视频文件 |
| 查看已完成结果 | 与后台处理独立，后续任务完成不会切换正在查看的视频 |
| 运行时添加视频 | 加入工作台，下一次点击开始时处理 |
| 失败重试 | 队列结束或停止后重试；失败不会覆盖已有结果，也不阻塞后续视频 |
| 重新生成 | 新结果成功后替换旧结果；处理中可导出旧图，暂停编辑以避免覆盖修改 |

暂停不是对 FFmpeg 进程的挂起：桌面版会结束本次提取，继续时重新执行该提取步骤。浏览器版按画面提取步骤恢复。停止后的重新开始会重新处理未完成的视频。

## 运行方式与数据

- **浏览器**：视频解码、选图、Canvas 合成和 ZIP 导出在本机进行，历史保存在 IndexedDB。编码兼容性取决于浏览器。
- **桌面端**：Tauri 2 + Rust + FFmpeg + SQLite。Windows 构建脚本会打包 FFmpeg，默认尝试硬件解码，不支持时回退 CPU。
- **本地选图**是默认模式，无需 API Key；按清晰度、曝光、画面差异与时间分布筛选，不进行语义理解。
- **AI 选图**需主动选择并配置密钥。只向当前接口发送压缩候选帧和选图偏好进行评分，不发送原视频。实际模型可用性取决于接口和账号权限。
- 密钥不写入项目历史。默认保留在当前会话；用户主动勾选后才长期保存到本地存储。
- 每批任务自动保存为独立历史；重新打开保持空白，由用户主动选择历史记录。

## 本地开发与检查

需要 Node.js、npm。桌面开发另需 Rust 和各平台 Tauri 构建工具链。

```bash
npm ci
npm run desktop:dev:frontend  # http://127.0.0.1:1420/app.html
npm test                    # 队列、布局、序列化和产品回归测试
npm run build               # Cloudflare Pages 服务构建
npm run desktop:frontend    # 输出离线桌面前端 desktop-dist/
```

浏览器交互测试需要 FFmpeg，以及 Playwright Chromium 或本机 Google Chrome：

```bash
npm run test:browser
# 保存截图和报告到指定目录：
QA_SCREENSHOTS=docs/review-2026-09-07 npm run test:browser
```

```bash
cd src-tauri
cargo test --lib
cargo fmt --check
```

`npm run dev` 使用 Cloudflare 开发适配器；仅预览工作台时建议使用上面的 `desktop:dev:frontend`。

## 桌面构建

Windows 10/11 x64：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
# 安装环境后重新打开 PowerShell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

安装包输出至 `src-tauri/target/release/bundle/nsis/`。Windows 签名构建需要配置 `TAURI_SIGNING_PRIVATE_KEY`（私钥路径或内容）；GitHub Actions 已通过仓库 Secret 注入。签名私钥必须保存在仓库外并安全备份，不能更换为临时新密钥，否则已安装应用将拒绝后续更新。

发布时同步修改版本、添加 `docs/releases/<版本>.md`，推送对应的 `desktop-v<版本>` 标签。`Windows Desktop` 工作流会测试、打包、进行 Windows 安装与启动检查，并创建包含安装程序、签名和 `latest.json` 的草稿 Release。核对资产后发布该 Release 并标记 Latest，客户端随即可以在下一次检查时发现更新。不要把预览版或缺少更新清单的 Release 标记为 Latest。

macOS 本地测试（需本机 FFmpeg 与 ffprobe）：

```bash
npm exec -- tauri build --debug --bundles app --no-sign
```

输出为 `src-tauri/target/debug/bundle/macos/帧选.app`。这是本机测试构建，未签名或公证，不是公开发行包。公开发行包目前为上面的 Windows x64 版本。

## 主要文件

- `public/app.html`：页面、图片编辑与历史管理
- `public/static/task-queue.js`：暂停、停止、删除与逐项完成的队列
- `public/static/frame-engine.js`：独立视频解码、选图与图片合成
- `public/static/workspace.js`：工作台与后台任务协调
- `public/static/workspace.css`：新版界面、响应式布局与交互状态
- `public/static/app-icon.svg`：可编辑的应用图标源文件
- `src-tauri/src/lib.rs`：本机提取、进程取消、帧缓存与 SQLite
- `docs/review-2026-09-07/product-review.md`：本轮产品审查、整改和验证范围
