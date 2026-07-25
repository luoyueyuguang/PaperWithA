# PaperWithA Agent 接手指南

本文件是 Coding Agent 的仓库入口。开始修改前先读本文件，再按“必读顺序”读取文档。所有状态结论以当前源码、测试和 `docs/next-session-handoff.md` 为准，不要沿用旧会话中的完成声明。

## 项目定位

PaperWithA 是 agent-driven 论文研究工具。PDF 放入 XDG 目录，agent（Pi subagent）分析后存结果，用户通过 Web UI 的 Terminal CLI 与 agent 交互。核心体验不是"阅读器"，而是"你有篇论文，agent 读过了，你问它"。

当前处于架构转型期：从 PDF 阅读工作台转向 agent + 论文仓库模式。Web UI 保留 PDF 阅读（左面板），右面板已改为 Terminal CLI。

## 必读顺序

1. `AGENTS.md`：操作约束、现状和命令。
2. `docs/next-session-handoff.md`：最新实现状态、直接证据、阻塞和下一步。
3. `docs/00-project-overview.md`：产品、模块、成熟度和推荐阅读路径。
4. `docs/01-technical-architecture.md`：运行时、数据流、依赖和扩展边界。
5. `docs/superpowers/specs/2026-07-23-paperwitha-architecture-design.md`：目标产品与验收场景。
6. `docs/domain-model.md`：领域概念和不变量。
7. `docs/adr/0001-*.md` 至 `0005-*.md`：已接受的架构决策。
8. `docs/superpowers/plans/2026-07-23-paperwitha-implementation-plan.md`：Gate 顺序；注意它描述目标，不代表全部已实现。
9. `docs/gate-0-report.md`：Gate 0 方法、指标与机器报告位置。

## 仓库结构

- `apps/web`：Web Host。Vite + 原生 TS DOM。左边 PDF 阅读器（PDF.js），右边 Terminal CLI（WebSocket 连 PTY 后端）。入口 `src/main.ts`（约 980 行）。
- `apps/desktop`：Tauri 2 壳，加载 `apps/web/dist`。
- `apps/mobile`：Expo / React Native 演示壳。
- `packages/domain`：DocumentGraph / DocumentVersion / InkStroke / ReadingBrief。
- `packages/reader-core`：Graph 缓存、PaperView、EvidenceAnchor。
- `packages/workspace`：LayoutTree、swap / merge / split 命令和历史。
- `packages/context`：ContextSet、ContextBuilder（词法排序 + 预算）。
- `packages/ai-core`：ProviderManifest、ProviderClient（SSE / JSON）。
- `packages/evidence`：Annotation。
- `packages/storage`：StoragePort、BlobStore、JsonRepository。
- `packages/sync`：SyncPort、SyncEnvelope、Outbox、Inbox、InMemorySyncServer。
- `packages/plugin-contracts` / `plugin-core`：同步插件契约和 PluginHost。
- `packages/platform`：跨端 PlatformShell。
- `packages/agent-core`：Session / Branch / Run / Event、Sandbox、Runtime。
- `packages/agent-runtime-node`：OMP RPC、Pi RPC、OpenCode HTTP 适配器、AgentHost。
- `services/api`：同步 HTTP 服务（port 4120）。
- `services/pty`：Terminal shell 后端，在 papers 目录启 /bin/bash，WebSocket（port 4121）。
- `services/watcher`：文件监听 + Pi subagent 触发（已 revert，需恢复）。
- `services/api`：无鉴权、内存态同步 HTTP 原型；进程重启会丢数据。
- `probes/gate-0`：六项确定性可行性探针和机器报告。
- `.github/workflows/native-builds.yml`、`infra/desktop-build.Dockerfile`：原生构建入口。

## 不变量与安全边界

- 未显式加入 `ContextSet` 的文档不得进入 AI 上下文。
- 每条未来的持久化 Chat 消息必须关联发送时的 `ContextSnapshot`；当前 Web UI 尚未完整实现该模型。
- EvidenceAnchor 必须携带 DocumentVersion、页面、节点、字符范围和有效性。
- PaperView 的滚动、缩放、选区属于视图实例，不属于 Document。
- 布局移动不得改变论文滚动位置、Chat 历史或内容状态。
- 本地事务先于同步；重复 operation 不得重复产生业务效果。
- API Key、password、secret 不得进入 localStorage、SyncEnvelope、日志或测试 fixture。
- Provider 请求不得静默切换供应商。
- 插件只能通过宿主能力接口工作；不能绕过 Evidence、Storage、Sync 或平台边界。

## 当前 UI 窗口契约

Web 与 Desktop 共用 `apps/web/src/styles.css`：

- `html`、`body`、`#app` 和 `.app-shell` 必须严格等于可视窗口高度；
- 外层页面禁止纵向和横向滚动；
- 论文只在 `.reader-scroll` 内滚动；
- Chat、Brief 和论文库各自内部滚动；
- 小于 980px 时 Assistant 使用工作区内覆盖层，不得把页面向下撑开。

任何布局修改后，至少在 `1440×900` 和 `390×844` 两个 viewport 验证 `document.body.scrollHeight === innerHeight` 且 `scrollWidth === innerWidth`。

## 常用命令

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec tsc -p apps/web/tsconfig.json --noEmit
corepack pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit
corepack pnpm exec tsc -p services/api/tsconfig.json --noEmit
corepack pnpm test
corepack pnpm build:web
corepack pnpm probe:gate0
corepack pnpm probe:gate0:validate
corepack pnpm --filter @paperwitha/mobile exec expo export --platform web --output-dir /tmp/paperwitha-mobile-web
corepack pnpm --filter @paperwitha/mobile exec expo export --platform android --output-dir /tmp/paperwitha-mobile-android
corepack pnpm --filter @paperwitha/mobile exec expo export --platform ios --output-dir /tmp/paperwitha-mobile-ios
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
```

开发服务：

```bash
corepack pnpm dev:web
corepack pnpm --filter @paperwitha/api start
```

原生 Desktop 构建优先使用 CI 或：

```bash
docker build -f infra/desktop-build.Dockerfile -t paperwitha-desktop .
```

## 修改与验证规则

- 先定位共享包是否已有契约；禁止在应用层创建第二套同义类型或状态语义。
- 修改导出符号前检查所有调用方。
- Web 行为变更必须真实浏览器验收；不要用只通过 TypeScript 编译替代 UI 证据。
- Desktop 行为由 Web 改动影响时，先 `build:web`，再构建 / 启动 Tauri；旧 `dist` 不代表当前源码。
- 同步和 Provider 边界必须覆盖成功、拒绝、错误和凭据泄露路径。
- Gate 0 测试会故意打印 `[FAIL]`，用于验证报告校验器能拒绝坏 fixture；最终以 Vitest 退出状态和 48/48 校验结果判断。
- 不编辑或提交 `node_modules`、`dist`、`target`、Expo export 目录和 `/tmp` 依赖环境。
- 文档中的“目标设计”和“当前实现”必须分开描述；无法直接验证的内容标记为未验收。

## 当前最重要的缺口

1. Web / Desktop 尚未接入正式 docking Host、ghost preview、detach 和原生多窗口。
2. Web Chat 尚无完整 ChatSession 标签、ContextSnapshot、多论文分组引用和消息分叉。
3. Reading Brief 目前是首三页文本摘要，不是结构化、不可变版本模型。
4. 扫描 PDF 在产品 UI 中仅显示 page-only fallback；Gate 0 OCR 尚未接入产品流程。
5. Sync API 是无鉴权内存原型，不是持久化生产服务。
6. Tauri 尚无系统文件、密钥链和原生窗口能力实现。
7. Expo 仍是演示壳，缺少真实导入、ReaderAdapter、触摸选区、本地 SQLite 和安全存储。
8. Provider UI 只有会话内 endpoint / model / API Key 提示框，尚无 manifest 导入、测试连接、取消 UI、系统凭据存储。
9. 缺少覆盖正式首版 19 个场景的端到端验收套件。

优先修复源头和正式契约，不要为了宣称完成而增加 shim、假实现或跳过验收。
