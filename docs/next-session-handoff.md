# PaperWithA — 交接文档

- 版本：`v0.2.0`（2026-10-03 发布，tag 与 GitHub release 已推）
- 状态：本地优先的论文研究工具，一条真实闭环已跑通
- 本文件是接手入口。改架构前先看 `docs/redesign-plan.md` 与 `docs/adr/0006`，
  两者记录了这次重做的诊断与取舍。

## 1. 现在能做什么

导入论文 → 左栏读原文（可缩放、可选中提问）→ 右栏和 agent 对话，流式回答带页码引用，
点页码跳回原文 → 可对单条回答生成图解/动画，对整个会话生成幻灯片/视频。

```text
apps/web             React 19 + Vite 6：论文库、阅读器、Chat
apps/desktop         Tauri 2：加载 web 产物，Rust 侧守护 core 进程
apps/mobile          Expo：论文列表、文本阅读、Chat（无图件 UI）
packages/domain      跨端类型与纯函数
packages/api-client  core 类型化客户端（HTTP + WebSocket）
services/core        Bun 服务：XDG 存储、文本抽取、内嵌 agent、HTTP/WS
```

94 个跟踪文件；`services/core` 是唯一写磁盘的进程。

## 2. 五分钟上手

```bash
corepack pnpm install --frozen-lockfile

corepack pnpm dev:core     # → http://127.0.0.1:4130
corepack pnpm dev:web      # → http://localhost:4173（/api 代理到 core，含 WebSocket）

# 单进程模式（core 同时托管界面，Desktop 走这条）
corepack pnpm build:web && corepack pnpm start:core
```

前置条件：**Bun 1.3+**（core 必须用它跑，理由见第 6 节）、Node 20+、`~/.omp/agent` 里有可用的模型凭证。

自检：

```bash
corepack pnpm typecheck        # 四个 tsconfig
corepack pnpm test             # 47 passed / 6 files
corepack pnpm probe:agent      # 端到端：起 core、上传论文、真实提问、流式回答、引用落盘
```

## 3. 验证证据

都是本机实测，命令可复现。

```text
corepack pnpm install --frozen-lockfile   pass
corepack pnpm typecheck                   pass（packages + core + web + mobile）
corepack pnpm test                        47 passed / 6 files
corepack pnpm build:web                   pass
corepack pnpm probe:agent                 PASS（真实模型：上传→建会话→提问→流式→引用 p.1→落盘）
expo export --platform web（mobile）       pass
cargo fmt --check（desktop）              pass
cargo test（desktop）                     5 passed（见第 7 节的环境说明）
```

真实浏览器（Chromium）验收：

- 窗口契约：1440×900 与 390×844 下 `html/body/#root/.app-shell` 都等于视口，外层不滚动，论文在内部滚动。
- 阅读器：pdf.js canvas + TextLayer，文本与原文一致；选中文字弹出「第 N 页 / 问这段 / 复制引用」。
- Chat：流式回答、`[p.N]` 引用标签点击跳页并高亮、KaTeX 排版公式、「问这段」把带页码的引用填进输入框。
- 长论文路径：113 KB / 20 页超出内联上限，agent 从工作目录 `paper.md` 读到第 8 页的事实并引用 `p.8`。
- 阅读器缩放：150% 时近视野页 canvas 742→1114 CSS px，阅读区出现横向滚动；缩放前后视口停在
  同一页的同一相对位置（page 4，offsetRatio 0.992）；每篇论文各记一份倍数，互不影响。
- 图件：`diagram.svg`（`image/svg+xml`）、`deck.html`（10 页）、`animation.mp4`
  （`video/mp4`，ffprobe 复核 1280×720 h264 17.97s）；帧序列自渲染 19 帧耗时 2.5s；
  超时分支（3 秒）确实 abort 并报「生成超时（3 秒）」。
- 错误路径：坏 PDF、缺模型凭证、core 断开、路径穿越（`../`、`%2e%2e`）都返回明确错误。

CI（`.github/workflows/native-builds.yml`）两次运行都绿：

```text
37098787539  main    → success
37098797839  v0.2.0  → success
```

三个 job：`checks`（typecheck / test / build:web / expo export）、`linux` 与 `windows`（真正的 `tauri build`）。

从发布 tag 全新克隆也验过一遍：

```text
git clone --branch v0.2.0 → 94 个跟踪文件
pnpm install --frozen-lockfile → up to date
pnpm typecheck → OK        pnpm test → 47 passed
core 启动 → health { ready, papers:0, renderers:{svg:true,video:true,manim:false} }
pnpm probe:agent → PASS
```

## 4. 代码地图

改东西时先看这几个文件，它们承载了主要契约。

| 位置 | 职责 |
|---|---|
| `services/core/src/main.ts` | 组装存储与 agent、探测渲染能力、启动服务、恢复中断的图件 |
| `services/core/src/server.ts` | 全部 HTTP 路由、WebSocket 广播、静态产物托管 |
| `services/core/src/agent.ts` | 内嵌 oh-my-pi：会话创建、流式事件、一次性作图任务、超时 |
| `services/core/src/ingest.ts` | PDF 文本层抽取、纯文本按 45 行分页 |
| `services/core/src/store/*` | 原子 JSON 读写、论文索引、会话、图件 |
| `services/core/src/render.ts` | 渲染能力探测、SVG→PNG、帧序列→MP4、deck.html 生成 |
| `services/core/src/manifests.ts` | `frames.json` / `deck.json` 的校验解析（纯函数，有单测） |
| `packages/domain/src/*` | 跨端类型与纯函数（引用解析、锚点、公式切分、事件校验） |
| `packages/api-client/src/index.ts` | `CoreClient`：HTTP 方法 + 自动重连的事件流 |
| `apps/web/src/App.tsx` | 顶层状态、唯一一次 `subscribe`、按 `sessionId` 分发事件 |
| `apps/web/src/components/ReaderPanel.tsx` | 阅读器、缩放、选区、PDF 页渲染调度 |
| `apps/web/src/pdf.ts` | pdf.js 装载与单页渲染（canvas + TextLayer，含缩放计算） |
| `apps/web/src/components/ChatPanel.tsx` | 会话头、消息、图件按钮、流式草稿 |
| `apps/web/src/components/ArtifactCard.tsx` | 图件卡与渲染能力门禁 |
| `apps/desktop/src-tauri/src/lib.rs` | 探测 / 守护 core 进程 |

## 5. 不变量

1. **core 是唯一事实源**，也是唯一写磁盘的进程。UI 不把业务状态写进 localStorage。
2. **core 必须用 Bun 跑**：内嵌 SDK 的 `exports` 指向 TypeScript 源码，且用到 `bun:sqlite`、
   `Bun.*` 等全局对象（`engines.bun >= 1.3.14`），Node 既加载不了 `.ts` 源也给不了这些 API。
   `store/`、`ingest.ts`、`manifests.ts` 只用 `node:` 模块，所以能在 Node 下跑单测；
   `agent.ts` 是唯一依赖 Bun 的模块。
3. **引用只认 `[p.N]`，且 N 必须命中该论文真实页号**，解析失败直接丢弃，不猜。
4. **论文页文本是证据锚点的唯一基准**，UI 不许自造第二套文本。
5. **窗口契约**：`html`、`body`、`#root`、`.app-shell` 严格等于可视窗口高度；外层不滚动，
   论文、会话列表、Chat 各自内部滚动。至少验 `1440×900` 与 `390×844`。
6. **API Key 不进仓库、不进日志、不进测试 fixture**。凭证沿用 `~/.omp/agent`。

## 6. 容易踩的坑

- **`SessionManager.inMemory(cwd)` 必须传工作目录**。不传就用进程目录，agent 找不到 `paper.md`。
  这个坑踩过一次（长论文时暴露）。
- **命令探测只按 `ENOENT` 判断**。本机 `ffmpeg --version` 退出码是 8，按退出码判断会误报「没装」，
  把界面上的「动画 / 视频」按钮禁掉。
- **不要用 `<iframe>` 渲染 PDF**。旧实现这么干，把文本层、批注、选区全都挡掉了。
- **PDF 页面容器用 `margin: 0 auto` 而不是 flex 居中**。页面宽于容器时 flex 居中会把左侧裁掉且滚不到。
- **图件任务必须带超时**。模型调用卡住会永久占住该会话的作图名额（有 10 分钟上限）。
- **core 重启后要把 `running` 的图件标成失败**，否则 UI 一直转圈（`ArtifactStore.failInterrupted()`）。
- **agent 写的 `deck.html` 要加 CSP `sandbox`**，并且只按 `text/html` 加；给视频响应加 CSP 会影响播放。
- **Vite 有时不失效模块缓存**：改完 Web 代码如果行为没变，先重启 dev server 再判断。
- 写 JSON 一律走「临时文件 + rename」，不要直接覆盖。

## 7. 环境依赖

| 依赖 | 用途 | 缺失时的表现 |
|---|---|---|
| Bun 1.3+ | 跑 core | core 起不来 |
| `~/.omp/agent` 凭证 | 模型与鉴权 | 提问返回「No model selected」 |
| `rsvg-convert`（`librsvg2-bin`） | SVG → PNG | 「动画 / 视频」按钮禁用 |
| `ffmpeg` | 拼 MP4 | 同上 |
| `manim`（可选） | 动画优先用它渲染 | 缺失时自动走 SVG 帧序列 |
| GTK / WebKit 开发包 | Desktop 构建 | `cargo check` 在 `glib-sys` 处失败 |

本机（WSL2）没有 GTK/WebKit 开发包，也没有可用的 `pkg-config`，所以：

- 桌面端 Rust 单测是用「stub `pkg-config` + 空 stub `.so` + `--unresolved-symbols=ignore-all`」
  跑通的，测的是 `TcpStream` 探测与状态码解析，不涉及 GUI。
- **Tauri 的真实构建已在 CI 的 linux 与 windows 两个 job 里验证通过**；没验的是启动 GUI
  和运行时的 core 拉起行为（本机无显示环境）。
- Mobile 只做了 `expo export` 与浏览器里的导出产物验证，没有真机验证。

## 8. 已知缺口

1. **agent 会话在内存里**。core 重启要重建会话，且该会话之前的问答不会回灌给模型
   （Chat 消息本身已落盘，界面上还在）。这是目前最影响体感的缺口。
2. 论文结构只到「页」：没有段落、图表、公式结构，因此锚点和引用只能精确到页。
3. Mobile：无 PDF 渲染、无图件 UI、无离线缓存；需要用户填对 `EXPO_PUBLIC_CORE_URL`。
4. Desktop：core 守护只在开发路径验证，未做打包分发；CI 只构建不上传产物。
5. core 无鉴权，只监听 `127.0.0.1`；要跨机访问得先加 token。
6. 图件：同一会话同时只允许一个任务（409），没有取消按钮，删除会话会连带删图件但没有回收站。
7. 删除论文是直接从磁盘移除，没有回收站。
8. CI 有个 annotation：`actions/checkout@v4`、`actions/setup-node@v4` 跑的 Node 20 已废弃，建议升 v5。

## 9. 建议的下一步（按价值排序）

1. **会话持久化 / 历史回灌**：把 `sessions/<id>.json` 的消息在重建 `AgentSession` 时喂回去，
   或在 SDK 里用持久化的 `SessionManager`。用户感知最强。
2. **Desktop 分发**：把 core 作为 sidecar 打包，给 workflow 接 `tauri-action` 产出安装包。
3. **移动端补齐**：PDF 渲染（或至少图件查看）。
4. **图件体验**：取消按钮、每个会话一个小队列、删除进回收目录。
5. **段落级结构**：如果要做「引用到段落」而不是「引用到页」，需要先扩 `PaperPage` 的数据模型。
6. **回收站**：论文与会话的删除改成移动到回收目录。

## 10. 为什么是这样

- `docs/redesign-plan.md`：旧实现的问题清单（带证据）、目标架构、迁移步骤。
- `docs/adr/0006-embedded-agent-core-service.md`：本次重做的决策记录。
- `docs/adr/0001..0005`：ADR-0002/0003/0004/0005 已标记为被取代（同步、插件、docking、多论文上下文），
  ADR-0001 保留但共享边界按 0006 修订。
- `docs/00-project-overview.md`、`01-technical-architecture.md`、`domain-model.md`：当前实现的事实描述。

历史包袱已清空：旧架构里的 16 个包、3 个服务、`probes/`、`fixtures/` 都已删除，
git 历史里能找到。
