# PaperWithA 技术架构（当前实现）

- 文档日期：2026-10-03
- 描述对象：仓库里现在能跑的代码，不含目标设计

## 1. 进程与端口

| 进程 | 运行时 | 端口 | 入口 |
|---|---|---|---|
| core | Bun 1.3+ | 4130（`PAPERWITHA_PORT` 可改） | `services/core/src/main.ts` |
| web dev | Vite 6 | 4173 | `apps/web/vite.config.ts` |
| desktop | Tauri 2 | 跟随 core | `apps/desktop/src-tauri` |
| mobile | Expo | 跟随 core | `apps/mobile` |

只有 core 会写磁盘。Web、Mobile、Desktop 都通过 `packages/api-client` 说话。

## 2. core 的模块

```text
services/core/src/
  main.ts              组装依赖、启动服务、处理信号
  config.ts            XDG 路径、端口、agent 目录
  ingest.ts            PDF 文本层抽取、纯文本分页
  agent.ts             内嵌 oh-my-pi 会话管理与事件转发
  server.ts            Bun.serve 路由、WebSocket 广播、静态产物托管
  store/
    json-file.ts       原子 JSON 读写
    papers.ts          论文索引、文件、文本缓存、目录对齐
    sessions.ts        Chat 会话落盘
```

### 2.1 为什么必须用 Bun

`@oh-my-pi/pi-coding-agent` 的 `exports` 直接指向 TypeScript 源码，且用到 `bun:sqlite`、
`Bun.hash`、`Bun.env` 等 Bun 全局对象，`engines.bun >= 1.3.14`。Node 既不能加载 `.ts` 源，也不能提供这些 API。
因此 `services/core/package.json` 的 `start` / `dev` 脚本都用 `bun run`。

`store/` 与 `ingest.ts` 只用 `node:` 模块，所以可以在 Vitest（Node 20）里直接测试。
`agent.ts` 是唯一依赖 Bun 的模块，用 `pnpm probe:agent` 做端到端验证。

### 2.2 端口与网络

core 只监听 `127.0.0.1`。CORS 允许所有来源，便于移动端直连；不含鉴权，不要暴露到公网。

## 3. HTTP 与 WebSocket 契约

```text
GET    /api/health                      { ready, papers, agent, renderers }
GET    /api/papers                      PaperSummary[]
POST   /api/papers                      multipart，字段 file → PaperSummary
GET    /api/papers/:id/text             PaperText
GET    /api/papers/:id/file             原始文件字节
DELETE /api/papers/:id                  204（同时删除文本、会话与图件）
GET    /api/sessions?paperId=           ChatSession[]
POST   /api/sessions                    { paperId, title? } → ChatSession
DELETE /api/sessions/:id                204（同时释放 agent 会话并删除图件）
POST   /api/sessions/:id/prompt         { text } → { runId }，202
POST   /api/sessions/:id/abort          204
GET    /api/sessions/:id/artifacts      Artifact[]
POST   /api/sessions/:id/artifacts      { kind, messageId? } → Artifact，202
DELETE /api/artifacts/:id               204
GET    /api/artifacts/:id/file/<path>   产物文件（图片 / 视频 / deck.html）
WS     /api/events                      CoreEvent 单向事件流
```

`renderers` 是 `{ svg, video, manim }`，UI 据此禁用做不到的按钮。

命令走 HTTP，事件只走 WebSocket，两个方向不混用。

## 4. 数据流

### 4.1 导入

`POST /api/papers` → `PaperStore.add()`：

1. sha256 取前 12 位作为 id；已存在同 id 直接返回；
2. 写入 `papers/<id>-<文件名>`；
3. 抽取每页文本写入 `text/<id>.json`；
4. 追加索引并原子写 `index.json`。

启动时 `PaperStore.open()` 会把 `papers/` 目录里多出来的文件补进索引，把文件已丢失的条目删掉。
目录里直接丢的文件页数为 0，首次 `getText()` 时才抽取并回填。

### 4.2 提问

1. `startRun()` 检查会话是否已有 run，有就返回 409；
2. 用户消息与空助手消息立刻落盘，广播 `run-started`；
3. 异步调 `EmbeddedAgent.prompt()`；
4. `text-delta` 实时广播；`tool_execution_start/end` 转成 `tool-start` / `tool-end`；
5. 结束后解析引用、去掉 `[p.N]` 标记、落盘、广播 `message-completed` 与 `run-completed`；
6. 异常路径广播 `run-failed`，错误文本原样给用户。

### 4.3 agent 会话

- 每个 Chat 会话对应一个进程内的 `AgentSession`，`sessionManager: SessionManager.inMemory()`。
- 工作目录 `workspaces/<paperId>/`，里面写一份 `paper.md`，每页以 `## Page N` 开头。
- 第一轮提问把全文塞进消息（正文 ≤ 24000 字符时），否则让 agent 自己读 `paper.md`。
- 系统提示要求：用提问语言回答；引用标注 `[p.N]`；不许编造页码。
- 模型与凭证沿用 `~/.omp/agent/agent.db`。
- 回答风格由 `agent.ts` 里的 `STYLE_RULES` 约束：直接回答、默认两三句、不用标题和加粗、
  不分点、禁用报告腔词句。另有 `MATH_RULES` 要求公式写成 LaTeX（`$S_t$`、`$$...$$`），
  不要用拍平写法。用户可以用 `~/.config/paperwitha/style.md`
  （或 `PAPERWITHA_STYLE_FILE` 指向的文件）追加自己的要求，内容会追加到系统提示词后面。
- 会话切换论文时销毁旧 `AgentSession` 并重建。

## 5. 存储布局

```text
$XDG_DATA_HOME/paperwitha/
  papers/<hash12>-<文件名>
  index.json
  text/<hash12>.json
  sessions/<sessionId>.json
  workspaces/<paperId>/paper.md
  artifacts/<artifactId>/meta.json + 产物文件
```

写 JSON 一律走「临时文件 + rename」，避免半截文件。

## 6. 图件生成

三种产物，作者都是 agent，格式由 core 固定并校验。

| 类型 | agent 写什么 | core 做什么 |
|---|---|---|
| `diagram` | `diagram.svg`（1280×720，自包含） | 直接作为 `entry` 展示 |
| `animation` | `frames/*.svg` + `frames.json`；若 `manim` 可用则直接产出 `animation.mp4` | 帧序列走 `rsvg-convert` 转 PNG，再 `ffmpeg` 拼 MP4（1280×720 h264） |
| `slides` | `slides/*.svg` + `deck.json` | 校验文件存在，合成无脚本的 `deck.html` |

- 每个图件一个一次性 `AgentSession`，工作目录是产物目录，里面先放 `paper.md` 与 `context.md`，
  提示词与聊天会话共用同一套风格约束（`artifacts/prompt.ts`）。
- 清单解析在 `manifests.ts`，纯函数、有单测；字段非法或帧数越界直接判失败，
  不静默产出空视频。路径只接受相对路径且禁止 `..`。
- 渲染能力由 `detectRenderers()` 启动时探测，结果进 `/api/health`。
  缺工具时按钮置灰，不假装能生成。
- `GET /api/artifacts/:id/file/*` 一律加 `nosniff`；`.html` 额外加
  `Content-Security-Policy: sandbox; default-src 'none'`，避免 agent 写的页面碰到 core 接口。

## 7. 错误处理

- 存储层返回 `null` 而不是抛异常表示「没有」；真实 IO 错误继续上抛。
- HTTP 层统一 `{ error: string }`，前端直接展示。
- agent 失败不会破坏会话：助手消息保留已流出的内容，错误另发 `run-failed`。
- 引用页码不在论文页范围内时丢弃，不猜测。

## 8. 扩展边界

- 想换 agent 后端：改 `agent.ts`，HTTP 与存储契约不变。
- 想加新的论文来源：`PaperStore.add()` 是唯一入口。
- Web 与 Mobile 不共享组件，只共享 `packages/domain` 的类型与纯函数、以及 `packages/api-client`。
- 回答里的公式由 `packages/domain` 的 `splitMath()` 切分：Web 交给 KaTeX 排版
  （`apps/web/src/components/MessageText.tsx`），Mobile 不做排版，用 `stripMathDelimiters()`
  去掉定界符后按纯文本显示。
