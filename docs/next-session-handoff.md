# PaperWithA — Handoff（2026-10-03）

本次是重做，不是增量修补。诊断、目标架构与取舍见 `docs/redesign-plan.md` 与 `docs/adr/0006-embedded-agent-core-service.md`。

## 验证结果

全部在本机实测，命令可复现。

```text
corepack pnpm install --frozen-lockfile   pass
corepack pnpm typecheck                   pass（packages + core + web + mobile，四个 tsconfig 全干净）
corepack pnpm test                        28 passed / 4 files
corepack pnpm build:web                   pass（index 611.67 kB、pdf.worker 1.38 MB、css 9.04 kB）
corepack pnpm probe:agent                 PASS（真实 agent：上传→建会话→提问→流式回答→引用 p.1→落盘）
cargo fmt --check（desktop）              pass
cargo test（desktop）                     5 passed（见下方环境说明）
expo export --platform web（mobile）       pass
```

真实浏览器验收（core 托管 `apps/web/dist`，`http://127.0.0.1:4130`）：

- 窗口契约：1440×900 与 390×844 下 `body/html` 的 `scrollWidth/scrollHeight` 都等于视口；论文在 `.reader-scroll` 内部滚动（scrollHeight 1080 > clientHeight 788）。
- PDF 阅读：canvas + pdf.js TextLayer 渲染，文本与原文一致；选中文字弹出「第 N 页 / 问这段 / 复制引用」工具条。
- Chat：「问这段」把带页码的引用填进输入框；提问后 14s 内流式完成，回答真实、带 `p.1` 引用标签，点击标签会滚动并高亮对应页。
- 长论文路径：113 KB、20 页的论文超出内联上限，agent 从工作目录 `paper.md` 读到第 8 页的事实并正确引用 `p.8`。
- 删除论文：文件、文本缓存、会话、agent 工作目录一并清除，HTTP 204。

## 架构

```text
apps/web             React 19 + Vite 6：论文库、阅读器、Chat
apps/desktop         Tauri 2：Rust 侧探测/守护 core 进程
apps/mobile          Expo：论文列表、文本阅读、Chat
packages/domain      类型与纯函数（论文、会话、引用、锚点、core 事件）
packages/api-client  core 客户端（HTTP + WebSocket）
services/core        Bun 服务：XDG 存储、文本抽取、内嵌 agent、HTTP/WS
```

删除的旧代码：`packages` 里 16 个包（含 agent-core、agent-runtime-node、ai-core、context、contracts、
design-tokens、evidence、paper-store、platform、plugin-*、reader-core、storage、sync、workspace）、
`services/{api,pty,watcher,worker}`、`probes/`、`fixtures/`、旧 Web 入口与 Desktop 死 TS 层。

## 内嵌 agent

`services/core/src/agent.ts` 进程内调用 `@oh-my-pi/pi-coding-agent@18.4.12` 的 `createAgentSession()`：

- 必须 Bun 运行（SDK 用 `bun:sqlite` 等 Bun 全局对象，`engines.bun >= 1.3.14`）。
- **`SessionManager.inMemory(cwd)` 必须传工作目录**；不传就用进程目录，agent 找不到 `paper.md`（本次修掉的真缺陷）。
- 一次会话一个 `AgentSession`，工作目录 `workspaces/<paperId>/paper.md`，每页 `## Page N`。
- 正文 ≤ 24000 字符时整篇内联进第一轮提问，否则让 agent 自己读文件。
- 模型与凭证沿用 `~/.omp/agent`。
- 回答风格：`STYLE_RULES` 禁止报告腔（标题、加粗、分点、“结论：”、破折号、总结套话），
  `MATH_RULES` 要求公式写成 LaTeX；用户可用 `~/.config/paperwitha/style.md` 覆盖或追加；
  落的文本还会过一遍 `tidyAssistantText()` 收掉中文标点前的多余空格。
- 公式渲染：`packages/domain` 的 `splitMath()` 切片段，Web 用 KaTeX（新增 `katex` 依赖），
  Mobile 用 `stripMathDelimiters()` 退化成纯文本。

## 阅读器缩放

`ReaderPanel` 里按论文各存一份倍数（`zoomByPaper`），默认 100%，范围 25%–400%。
`pdf.ts` 的 `renderPdfPage` 接收 `zoom`，在「适应宽度」之上再乘一次（绝对上下限 0.1–8）。
缩放后按锚点页 + 页内相对位置校正滚动，避免画面跳走。

实测：150% 时近视野页 canvas 742→1114 CSS px、阅读区出现横向滚动；缩放前后视口停留在同一页的
同一相对位置（page 4，offsetRatio 0.992）；切到另一篇论文再切回来，各自的倍数保持不变。
文本论文走 `--reader-zoom` 变量改字号（14px → 28px）。

## 图件生成

对单条回答生成图解 / 动画，对整个会话生成幻灯片 / 视频。

- 产物作者是 agent，格式由 core 固定并校验：`diagram.svg`、`frames.json`+`frames/*.svg`、`deck.json`+`slides/*.svg`。
- 视频两条路：有 `manim` 就让 agent 直接渲染 `animation.mp4`；否则 core 用
  `rsvg-convert` 转 PNG、`ffmpeg` 拼 MP4（本机走的是这条）。
- 能力探测 `detectRenderers()` 进 `/api/health` 的 `renderers`，缺工具的按钮在 UI 上禁用。
- 每次生成一个一次性 `AgentSession`（cwd = 产物目录），并且有 10 分钟超时，
  超时会 `abort()` 并把卡片置为 failed，不会永久占住会话的作图名额。
- 产物按文件类型加 `nosniff`；`deck.html` 额外加 CSP `sandbox`，关掉脚本。

实测（本机，`rsvg-convert` + `ffmpeg`，无 manim）：

```text
diagram   ready  entry=diagram.svg   HTTP 200 image/svg+xml   8 412 B
slides    ready  entry=deck.html     HTTP 200 text/html       49 646 B，10 页
animation ready  entry=animation.mp4 HTTP 200 video/mp4      276 572 B，1280x720 h264 17.97s
帧序列自渲染：19 帧 → 17.9s MP4，耗时 2.5s（ffprobe 校验通过）
超时分支：3 秒超时触发 abort，报「生成超时（3 秒）」，正常路径 1.8s 未受影响
Web UI：图解/幻灯片/动画卡都能出现并渲染（img naturalWidth=1280、video 可播）；
        1440×900 与 390×844 窗口契约在带图件卡时仍成立
```

已修的两个真问题：

1. `ffmpeg --version` 在本机退出码是 8，原先按退出码判断，导致 `/api/health` 报 `video:false`，
   UI 把「动画 / 视频」按钮禁掉了。现在只按 `ENOENT` 判断命令是否存在，实测 `video:true`。
2. core 重启会把进行中的生成留在 `running`，UI 一直转圈。启动时 `ArtifactStore.failInterrupted()`
   把它们标成 failed（「core 重启，生成中断」），有单测。

## 运行

```bash
corepack pnpm dev:core     # http://127.0.0.1:4130
corepack pnpm dev:web      # http://localhost:4173，/api 代理到 core
corepack pnpm build:web && corepack pnpm start:core   # 单进程模式，4130 同时托管界面
```

## 环境说明（未验收项）

- 本机没有 GTK/WebKit 开发包，`cargo check` 会在 `glib-sys` 的 build script 处因缺少 `pkg-config` 失败。
  桌面端 Rust 单元测试是用「stub pkg-config + 空 stub .so + `--unresolved-symbols=ignore-all`」跑通的，
  测的是 `TcpStream` 探测与状态码解析，不涉及 GUI。装了标准 Tauri 依赖的机器上可原样跑。
- Tauri 窗口本身没有启动过（无显示环境）。
- Mobile 只做了 `expo export` 与浏览器里的导出产物验证，没有真机验证。
- `apps/mobile/app.json` 的 `web.output` 用 `single`：SDK 52 的 `static` 只支持 expo-router 工程。

## 当前缺口

1. agent 会话在内存里，core 重启后需重建；只有 Chat 消息落盘。
2. 论文结构只到「页」，没有段落、图表、公式。
3. Mobile 无 PDF 渲染、无离线缓存；需要用户填对 `EXPO_PUBLIC_CORE_URL`。
4. Desktop 的 core 进程守护只在开发路径验证，未做打包分发。
5. core 无鉴权，只监听 127.0.0.1，不要暴露到公网。
