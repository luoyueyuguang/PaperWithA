# PaperWithA Agent 接手指南

本文件是 Coding Agent 的仓库入口。改动前先读本文件，再按“必读顺序”读文档。
所有状态结论以源码、测试和 `docs/next-session-handoff.md` 为准。

## 项目定位

PaperWithA 是一个本地优先的论文研究工具。目标体验一句话：你有篇论文，agent 读过了，你问它。

三步闭环：把论文导入本地库 → 左栏读原文、选中文字提问 → 右栏 agent 流式回答并标注页码。

Agent 不自研，直接内嵌 [oh-my-pi](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent) 的
`createAgentSession()`，在同一个进程里跑，不依赖用户额外安装 CLI。

## 必读顺序

1. `AGENTS.md`：本文件，操作约束与命令。
2. `docs/next-session-handoff.md`：最新状态、已验证的证据、下一步。
3. `docs/redesign-plan.md`：2026-10-03 重做的诊断、目标架构与迁移步骤。
4. `docs/01-technical-architecture.md`：当前运行时、数据流、依赖边界。
5. `docs/00-project-overview.md`：产品、模块、成熟度。
6. `docs/domain-model.md`：领域概念与不变量。
7. `docs/adr/`：已接受的架构决策；`0006` 记录本次重做。

## 仓库结构

```text
apps/web             React 19 + Vite 6：论文库、阅读器、Chat
apps/desktop         Tauri 2 壳：加载 web 产物，Rust 侧守护 core 进程
apps/mobile          Expo：论文列表、文本阅读、Chat
packages/domain      跨端类型与纯函数：论文、会话、引用、证据锚点、core 事件
packages/api-client  core 的类型化客户端（HTTP + WebSocket）
services/core        Bun 服务：XDG 存储、文本抽取、内嵌 agent、HTTP/WS
```

## 运行时边界

- **core 必须用 Bun 跑**。内嵌的 oh-my-pi SDK 依赖 Bun 全局对象与 `bun:sqlite`，Node 加载不了。
  入口 `services/core/src/main.ts`，`package.json` 里的 `start` / `dev` 脚本已经用 `bun run`。
- Web 与 Mobile 只通过 `@paperwitha/api-client` 访问 core，不直接读写文件。
- Desktop 复用 web 产物；Rust 侧只做进程守护与健康检查。

## 存储

```text
$XDG_DATA_HOME/paperwitha/          默认 ~/.local/share/paperwitha
  papers/<hash12>-<文件名>           原始文件
  index.json                        论文索引
  text/<hash12>.json                每页文本
  sessions/<sessionId>.json         Chat 会话
  workspaces/<paperId>/paper.md     agent 工作目录里的论文副本
  artifacts/<artifactId>/           生成的图解、动画、幻灯片
```

- 论文 id 是文件内容 sha256 的前 12 位，同样内容只存一份。
- 把文件直接丢进 `papers/` 也会被索引；文本在首次读取时抽取。
- agent 的模型与凭证沿用 `~/.omp/agent`，可用 `PAPERWITHA_AGENT_DIR` 覆盖。
- 助手回答风格由 `services/core/src/agent.ts` 的 `STYLE_RULES` 约束；
  用户可用 `~/.config/paperwitha/style.md` 或 `PAPERWITHA_STYLE_FILE` 追加自己的要求。

## 不变量

- 未进入提问上下文的论文内容，不得出现在回答里。当前实现把整篇论文交给该论文自己的会话，会话之间不共享上下文。
- 引用只认 `[p.N]` 标记，且 N 必须是该论文真实存在的页号；解析失败直接丢弃，不猜测。
- API Key 不写入仓库、不写日志、不进 SyncEnvelope 或测试 fixture。
- 论文页文本与 `PaperText` 是证据锚点的基准；不要让 UI 自己造第二套文本。
- core 是唯一事实源。UI 不把业务状态写进 localStorage。

## 常用命令

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck          # packages + services/core + apps/web + apps/mobile
corepack pnpm test               # vitest：domain、api-client、core 存储与 ingest
corepack pnpm dev:core           # core → http://127.0.0.1:4130
corepack pnpm dev:web            # web → http://localhost:4173（/api 代理到 core）
corepack pnpm build:web
corepack pnpm probe:agent        # 端到端烟测：起 core、上传论文、真实提问（需要 ~/.omp 凭证）

cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
corepack pnpm --filter @paperwitha/mobile exec expo export --platform web --output-dir /tmp/pwa-mobile-web
```

## 修改与验证规则

- 改导出符号前先查调用方；共享类型只在 `packages/domain` 定义一处。
- Web 行为变更必须真实浏览器验收，不能用 TypeScript 编译代替。
- 窗口契约：`html`、`body`、`#root`、`.app-shell` 严格等于可视窗口高度；外层不滚动；
  论文、会话列表、Chat 各自内部滚动。至少在 `1440×900` 与 `390×844` 下验证
  `document.body.scrollHeight === innerHeight` 且 `scrollWidth === innerWidth`。
- Desktop 行为受 Web 影响时先 `build:web`，旧 `dist` 不代表当前源码。
- 不提交 `node_modules`、`dist`、`target`、Expo export 目录。
- 文档必须区分“当前实现”和“目标设计”；无法直接验证的内容标注为未验收。

## 当前缺口

1. agent 会话在内存里。core 重启要重建，且该会话之前的问答不会回灌给模型（Chat 消息已落盘）。
2. Mobile 只做文本阅读，没有 PDF 渲染，也没有图件 UI 和离线缓存。
3. 论文页文本抽取只到「页」粒度，没有段落、图表、公式结构。
4. Desktop 的 core 守护只在开发路径验证，未做打包分发。
5. 删除论文与会话是直接从磁盘移除，没有回收站。
6. 同步、插件系统、docking 布局已从仓库移除，`docs/adr` 里标记为被取代。
