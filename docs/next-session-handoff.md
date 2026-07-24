# PaperWithA Agent 交接说明

- 交接日期：2026-07-24
- 项目目录：`/home/luoyue/project/PaperWithA`
- 根包名：`paperwitha`
- 当前目标：完成正式 Spec 定义的跨端产品
- 当前结论：可运行产品切片与 Gate 0 已建立；正式 Gate 2–4 尚未关闭，不能宣称完整产品完成

## 1. 新 Agent 的第一步

按顺序读取：

1. `AGENTS.md`
2. `docs/00-project-overview.md`
3. `docs/01-technical-architecture.md`
4. 本文
5. `docs/superpowers/specs/2026-07-23-paperwitha-architecture-design.md`
6. `docs/domain-model.md`
7. `docs/adr/0001-cross-platform-stack.md`
8. `docs/adr/0002-workspace-window-model.md`
9. `docs/adr/0003-local-first-sync.md`
10. `docs/adr/0004-multi-paper-chat-context.md`
11. `docs/adr/0005-plugin-system.md`
12. `docs/superpowers/plans/2026-07-23-paperwitha-implementation-plan.md`
13. `docs/gate-0-report.md`

设计文档描述目标；源码和本文描述当前事实。两者冲突时不要猜，先验证，再更新实现或明确回写设计。

## 2. 当前仓库事实

### 2.1 已实现

#### Web Host

- Vite + 原生 TypeScript DOM；当前并非 React Host。
- PDF / TXT / Markdown 导入。
- PDF.js 逐页文本提取和 DocumentGraph 创建。
- 论文库、连续阅读、滚动位置、基础 Zoom 状态。
- 选区工具栏：加入 Context、批注、转到 Chat。
- EvidenceAnchor + Annotation 本地持久化。
- 基础 Chat：本地证据摘录回答或远端 Provider SSE。
- 基础 Reading Brief：从前三页生成字符串摘要。
- BrowserStoragePort + JsonRepository，存储键 `paperwitha.web.v1`。
- HttpSyncPort push / pull 入口。
- Provider endpoint / model / API Key 会话内配置；API Key 不进入 localStorage。

#### 窗口适配

- Web 和 Desktop 共用的页面外壳严格限制为 viewport。
- 外层 `body` 无纵向或横向滚动。
- 论文只在阅读器内部滚动；Chat、Brief、论文库各自内部滚动。
- 小于 980px 时 Assistant 作为工作区覆盖层，不向下撑开页面。
- 已在 1440×900 验证：body / app / shell 高度均为 900；reader 622 client / 1229 scroll。
- 已在 390×844 验证：body / shell 高度均为 844、宽度均为 390；reader 内部滚动；Assistant 可切换。

#### 共享包

- `domain`：DocumentPage、DocumentGraph、DocumentVersion。
- `reader-core`：DocumentGraphCache、visiblePageNumbers、PaperViewState、跨页 EvidenceAnchor。
- `workspace`：LayoutTree、swap / mergeTab / splitPane、LayoutHistory。
- `context`：文档白名单、固定来源、词法排序、预算裁剪和 omitted sources。
- `ai-core`：ProviderManifest 校验、声明式 mapping、HTTP JSON / SSE ProviderClient。
- `evidence`：Annotation 创建与更新。
- `storage`：Memory / Browser StoragePort、JsonRepository。
- `sync`：SyncEnvelope、Outbox、IdempotentInbox、InMemorySyncServer、HttpSyncPort。
- `plugin-contracts` / `plugin-core`：最小 SyncPlugin 与单激活同步目标 PluginHost。
- `platform`：structuredClone 隔离的最小 PlatformShell。

#### 服务与平台壳

- `services/api`：Node HTTP 同步 API；push / pull 已有真实本地 HTTP 测试。
- `apps/desktop`：Tauri 2 壳，production 加载 Web dist。
- `apps/mobile`：Expo / React Native 演示壳，可切换内置 Demo Paper / Brief。
- Linux Tauri 已构建二进制、DEB、RPM，并在用户态 WebKit 环境启动运行超过 20 秒后正常停止。
- Expo Web / Android / iOS bundle 已成功导出。

#### Gate 0

六项探针均为 pass：

1. PDF 连续阅读 / text layer / OCR fallback / 虚拟化；
2. 多 PaperView 共享 DocumentGraph；
3. Docking / LayoutTree 可行性；
4. ProviderManifest / SSE；
5. ContextBuilder；
6. Outbox / Inbox。

机器报告位于 `probes/gate-0/reports/gate0-v1/`，校验器要求 48/48 checks。

### 2.2 明确未完成

以下不能从现有构建或单元测试推断为完成：

- 正式 Web / Desktop docking Host、ghost preview、中央互换、边缘拆分和 detach；
- Tauri 文件命令、系统密钥链、原生多窗口和系统事件；
- ChatSession 标签、排序 / 合并 / 分叉 / 恢复；
- 每条消息的 ContextSnapshot；
- 多论文 ContextSet UI 和按论文分组引用；
- 引用跳回原文与 CitationReferenceChecker 产品链路；
- 结构化、不可变版本 Reading Brief 和用户 overlay；
- 产品 UI 中的 OCR、翻译、解释、分层总结和复制引用；
- 生产级本地事件日志、持久 Outbox / Inbox 和冲突恢复 UI；
- 持久化、鉴权、限流、多 Workspace 隔离的同步服务；
- 完整 PluginManifest / CapabilityGrant、隔离、取消、超时、进度、并发和输出上限；
- Expo 真实文件导入、ReaderAdapter、触摸选区、视图栈、SQLite 和安全存储；
- Windows Tauri 安装包的当前环境直接验证；
- 真实第三方 Provider endpoint 和凭据验收；
- 正式首版 19 个场景的跨端 E2E 套件。

## 3. 最近完成的关键修复

### 3.1 窗口高度

根因是 `.app-shell` / `.shell-body` 仅设置 min-height，`.reader-scroll` 没有占用剩余 flex 高度，论文内容会把整个页面撑高。修复后：

- 根节点固定 width / height 并隐藏外层 overflow；
- topbar 和 workspace toolbar 使用固定 flex basis；
- shell-body / main-area / workspace-grid 允许子级收缩；
- reader-scroll、brief-content、chat-messages、library-list 使用内部 overflow；
- 窄屏 Assistant 使用 absolute overlay。

不要恢复外层 body 滚动。所有窗口布局改动必须重复双 viewport 验收。

### 3.2 选择 Context

- selectionchange 现在只在模块启动时注册一次，避免每次 render 重复绑定；
- 显式选择文本保存到 `contextTexts`，重新 render 后不会只剩 sourceId 丢失正文；
- Context 计数避免把同一 selection 重复计算；
- Clear Context / Clear Library 同时清理 sourceIds 与 contextTexts。

### 3.3 Tauri Linux

- bundle identifier 已从不推荐的 `com.paperwitha.app` 改为 `com.paperwitha.desktop`；
- 当前宿主通过临时用户态 sysroot 解决 WebKitGTK 链接与运行，不应把 `/tmp` 路径写入仓库；
- 可复现方式应使用 `infra/desktop-build.Dockerfile` 或 `.github/workflows/native-builds.yml`。

## 4. 当前直接验证证据

最近一次代码级验证：

```text
corepack pnpm typecheck                                      pass
corepack pnpm exec tsc -p apps/web/tsconfig.json --noEmit      pass
corepack pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit   pass
corepack pnpm exec tsc -p services/api/tsconfig.json --noEmit  pass
corepack pnpm test                                               16 files / 34 tests pass
corepack pnpm build:web                                          pass
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check  pass
```

最近一次平台级验证：

```text
Web viewport 1440x900              no outer scroll
Web viewport 390x844               no vertical/horizontal outer scroll
Tauri Linux release binary         built and launched
Tauri DEB                           built
Tauri RPM                           built
Expo Web bundle                    pass
Expo Android bundle                pass
Expo iOS bundle                    pass
Provider local SSE HTTP E2E        pass
Sync API push/pull HTTP E2E        pass
Gate 0 report validation           48/48 pass
```

注意：Vitest 的 Gate 0 validator 负向测试会故意打印 `[FAIL]` 日志，证明坏报告被拒绝；判断整套测试是否成功要看测试退出状态和最终 summary。

## 5. 可复现命令

安装与静态检查：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec tsc -p apps/web/tsconfig.json --noEmit
corepack pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit
corepack pnpm exec tsc -p services/api/tsconfig.json --noEmit
```

测试与 Gate 0：

```bash
corepack pnpm test
corepack pnpm probe:gate0
corepack pnpm probe:gate0:validate
```

Web：

```bash
corepack pnpm dev:web
corepack pnpm build:web
```

同步 API：

```bash
corepack pnpm --filter @paperwitha/api start
```

Mobile bundles：

```bash
corepack pnpm --filter @paperwitha/mobile exec expo export --platform web --output-dir /tmp/paperwitha-mobile-web
corepack pnpm --filter @paperwitha/mobile exec expo export --platform android --output-dir /tmp/paperwitha-mobile-android
corepack pnpm --filter @paperwitha/mobile exec expo export --platform ios --output-dir /tmp/paperwitha-mobile-ios
```

Desktop：

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
docker build -f infra/desktop-build.Dockerfile -t paperwitha-desktop .
```

Docker 不可用时使用 GitHub Actions；不要重新依赖交接会话中的 `/tmp/tauri-sysroot`。

## 6. 推荐下一执行切片

### 切片 A：建立正式完成矩阵

把 Spec 第 12 节 19 个验收场景逐项映射为：

- 已有实现；
- 已有测试；
- 缺失实现；
- 所需平台；
- 可接受的机器证据。

当前文档已指出主要缺口，但尚无仓库内可执行的 Gate 2–4 矩阵。

### 切片 B：拆分 Web Host

先保持行为不变，将 `apps/web/src/main.ts` 拆为：

- state / repository；
- importer；
- reader；
- selection / evidence；
- chat / context；
- provider settings；
- sync coordinator；
- render / bindings。

原因：正式 docking、ChatSession 和 Brief 版本化继续叠加到单文件会放大回归风险。

### 切片 C：关闭 Web / Desktop Workspace 场景

1. 将共享 LayoutTree 接入正式 Dockview Host；
2. 支持 ghost preview、swap、merge、split、undo / redo；
3. 保持 PaperView / Chat 状态不随布局变化；
4. Web detach 降级为内部面板；Desktop 通过 Tauri command 创建原生窗口；
5. 建立可恢复布局 E2E。

### 切片 D：Chat 与证据链

1. 正式 ChatSession / ChatMessage / ContextSnapshot 契约；
2. 多论文显式 ContextSet；
3. CitationReference 与点击跳转；
4. 发送时保存 snapshot，后续 Context 修改不改变历史；
5. 失败不 fallback、固定来源超预算显式失败。

完成 Gate 3 之前不要把主要投入转向 Mobile Gate 4。

## 7. 风险提示

- `apps/web/src/main.ts` 仍是高耦合热点；小改动也要跑真实浏览器。
- localStorage 保存完整 graph 和 chat，论文规模扩大后会触及容量与同步写性能限制。
- Web PDF importer 会串行遍历所有页面，当前不是首屏优先解析。
- Sync API 无鉴权且进程重启丢数据，严禁对公网部署。
- Web Provider API Key 只在内存中，不会持久化；不要为了方便写入 AppState。
- `dockview-core` 是探针依赖，运行会提示应使用公开 `dockview` 包；正式 Host 应重新确认依赖。
- `dist`、`target`、Expo export 和 `/tmp` 只是构建产物或临时环境，不是源码事实。
- 当前目录没有 Git repository；无法提供 commit、branch 或 CI run 证据。

## 8. 文档维护规则

每次完成一个可观察行为后，同时更新：

1. 对应测试或 E2E；
2. `docs/next-session-handoff.md` 的已实现 / 未完成矩阵；
3. 若改变架构决策，更新 Spec 和对应 ADR；
4. 若改变 Gate 0 输入或性能，重新生成机器报告并更新 `docs/gate-0-report.md`；
5. 不要把计划项直接改写成“已完成”，必须附当前命令或平台证据。
