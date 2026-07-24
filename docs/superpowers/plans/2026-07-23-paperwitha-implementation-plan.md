# PaperWithA 实施计划

- 日期：2026-07-23
- 前置状态：新版架构 Spec 已完成评审并获批准
- 实施原则：先验证 Gate 0，再冻结 Gate 1 契约；每个 Gate 必须保留可重复 fixture、原始结果和通过结论；不以未完成的 scaffold 代替验收。
- 当前进度：Gate 0 已通过；共享 Core 和 Host 只有部分实现；Gate 2–4 未关闭。逐项证据和缺口见 `docs/next-session-handoff.md`。
- 当前非目标：不实现自动同行评审、AI 语义真实性证明、任意第三方脚本插件或无限深度布局。

## 1. 交付顺序与硬门槛

```text
Workspace foundation
        ↓
Gate 0 probes (six independent feasibility probes)
        ↓ all pass
Gate 1: domain core + local event log + ports
        ↓ acceptance passes
Gate 2: official plugins
        ↓ acceptance passes
Gate 3: Web / Desktop hosts
        ↓ acceptance passes
Gate 4: Mobile host
```

任何 Gate 出现 `fail`，先回写 Spec / ADR 和探针结论，再继续；`blocked` 不得视为通过。Gate 0 探针不依赖真实用户数据、生产同步服务或真实云端 AI。

## 2. Phase 0：Workspace foundation

### 2.1 根工程与共享脚手架

**目标**：建立可运行、可检查但不包含产品 UI 的 TypeScript monorepo。

**文件范围**：

- `package.json`：统一 `dev`、`build`、`typecheck`、`test`、`probe:gate0`、`lint` 脚本。
- `pnpm-workspace.yaml`：保留 `apps/*`、`packages/*`、`services/*`。
- `tsconfig.base.json`：严格 TypeScript、跨包引用和测试配置。
- 各 package 的 `package.json`、`src/index.ts`、`tests/`。
- `probes/gate-0/`：统一 fixture runner、结果 schema 和报告输出。
- `fixtures/gate-0/`：版本化的 A/B/C 文档、manifest、上下文和同步操作 fixture。

**约束**：

- 共享包不得依赖 React、Tauri、Expo 或具体数据库。
- 测试和探针输出必须可序列化为 JSON；时间和随机 ID 在 fixture 模式下可控。
- 依赖版本固定，禁止在各 package 重复声明冲突版本。

**验收**：空实现仓库能通过 workspace 安装、类型检查和测试 runner；`probe:gate0 --list` 能列出六个探针及其 fixture 版本。

## 3. Gate 0：六个可行性探针

每个探针实现三部分：`runner`、deterministic fixture adapter、JSON report。报告必须含 fixture 版本、构建标识、设备 / 平台、输入大小、P50/P95/P99、错误、`pass | fail | blocked` 结论。

### 3.1 PDF 连续阅读、text layer 与虚拟化

**目标**：确认 PDF.js 能提供连续滚动、跨页选择、页面虚拟化和 EvidenceAnchor 生成。

**实现范围**：

- `packages/reader-core/src/graph/*`：DocumentGraph、页面索引、文本节点和解析 confidence。
- `packages/reader-core/src/selection/*`：单页 / 跨页 selection 到 anchor 的转换。
- `probes/gate-0/pdf/*`：Web PDF.js adapter、连续滚动 fixture、可见页面统计和性能采样。

**验证**：A/B 首个可读页面 P95 ≤ 2 秒；已解析页面选择反馈 P95 ≤ 100ms；只渲染视口和缓冲页；跨页选择得到有效 `EvidenceAnchor`；C 失败时保留页级阅读和明确降级状态。

### 3.2 多 PaperView 共享 DocumentGraph

**目标**：证明解析和索引可共享，视图状态不共享。

**实现范围**：

- `packages/domain/src/document/*`：Document、DocumentVersion、Graph identity。
- `packages/reader-core/src/document-graph-cache.ts`：按 `DocumentVersionId` 共享 Graph。
- `packages/reader-core/src/paper-view.ts`：独立 scrollAnchor、zoom、selection。
- `probes/gate-0/shared-graph/*`：两个视图、解析计数、重启恢复测试。

**验证**：两个视图引用同一 Graph 对象或等价稳定 identity；解析只执行一次；一个视图滚动 / 缩放 / 选区不会改变另一个视图；布局移动不改变内容状态。

### 3.3 Docking、ghost preview 与 LayoutTree

**目标**：验证候选 docking engine 能承载业务层的互换、合并、拆分、detach 和撤销语义。

**实现范围**：

- `packages/workspace/src/layout-tree/*`：SplitNode、StackNode、PanelInstance、WorkspaceWindow。
- `packages/workspace/src/commands/*`：MovePanel、SwapPanels、SplitPane、MergeTab、DetachWindow、Undo / Redo。
- `probes/gate-0/docking/*`：候选 engine adapter、ghost preview、四类落点和序列化恢复。

**验证**：中央互换、标签合并、边缘拆分和工作区外 detach 均产生正确领域命令；每步可撤销；序列化恢复后树等价；面板内容状态不变；面板切换 P95 ≤ 100ms。若 engine 无法表达语义，记录失败并回写选型，不在业务层偷偷绕过。

### 3.4 ProviderManifest、流式请求与错误映射

**目标**：验证声明式 manifest 足够表达首批供应商，不执行动态逻辑。

**实现范围**：

- `packages/plugin-contracts/src/provider-manifest.ts`：manifest schema。
- `packages/ai-core/src/manifest-validator.ts`：版本、transport、mapping、域名和认证校验。
- `packages/ai-core/src/mapping/*`：只实现 `json-pointer`、`literal`、`list`。
- `packages/ai-core/src/streaming/*`：统一流事件和结构化错误。
- `probes/gate-0/provider/*`：合法 / 非法 manifest、mock SSE、错误和审计 fixture。

**验证**：脚本、模板、WASM、动态导入、未声明域名在请求前拒绝；流事件顺序稳定；错误映射可分类；失败不自动切换供应商；manifest、日志和 envelope 不含凭据。

### 3.5 ContextSet 词法检索、排序与裁剪

**目标**：验证多论文上下文显式维护、固定来源优先和预算裁剪可解释。

**实现范围**：

- `packages/context/src/context-set.ts`：ContextSet、ContextSnapshot、成员边界。
- `packages/context/src/lexical-retriever.ts`：确定性词法检索和版本化排序。
- `packages/context/src/context-builder.ts`：固定证据、固定章节、检索结果和 token budget。
- `probes/gate-0/context/*`：两篇文档、非成员文档、固定证据和小预算 fixture。

**验证**：非成员永不进入结果；固定选区 / 章节优先于普通检索；普通来源被裁剪时给出原因；固定内容超预算时返回 `budget_exceeded` 并阻止发送；同一输入结果可重复。

### 3.6 Outbox / Inbox、离线操作与幂等重放

**目标**：验证本地优先事务、断线重试、乱序 pull 和重复 operation 的语义。

**实现范围**：

- `packages/sync/src/sync-envelope.ts`：SyncEnvelope、operationId、serverSequence optional。
- `packages/sync/src/outbox.ts`、`inbox.ts`：状态机、cursor、批量 push / pull。
- `packages/sync/src/idempotency.ts`：重复操作去重。
- `probes/gate-0/sync/*`：离线、重复、乱序、重连和冲突 fixture。

**验证**：领域状态和 Outbox 同一事务先提交；重复 envelope 只产生一次效果；push 可重试；pull cursor 可恢复；conflict 可见且可恢复；API Key、CredentialRef 明文和未授权原文永不进入同步数据。

### 3.7 Gate 0 评审产物

- `probes/gate-0/reports/<fixture-version>/*.json`：原始机器结果。
- `docs/gate-0-report.md`：每项探针的方法、设备、指标、失败状态和结论。
- 更新 `docs/superpowers/specs/2026-07-23-paperwitha-architecture-design.md` 与对应 ADR：记录实测结论、修改的预算或被否决的假设。

只有六项均为 `pass`，才冻结 Gate 1 接口。

## 4. Gate 1：精简 Core

### 4.1 领域与证据

- `packages/domain`：Document、DocumentVersion、DocumentGraph identity、PaperView、ChatSession、ReadingBrief、Annotation、ProviderProfile、CredentialRef。
- `packages/evidence`：EvidenceAnchor resolver、版本有效性和机械校验。
- `packages/contracts`：opaque IDs、Result / Error、事件 envelope、时间和序列化规则。

**验收**：所有领域命令经过 reducer / transaction；旧 Reading Brief 不可删除；失效 anchor 显式标记；AI claim 无有效 anchor 时不能作为论文明确结论。

### 4.2 Workspace / LayoutTree

- `packages/workspace`：布局树、命令、撤销栈、可序列化恢复。
- `packages/storage`：StoragePort、Repository、Local Event Log adapter；先提供内存测试 adapter，再提供平台 adapter。

**验收**：面板移动不改变 PaperView、Chat 或 Reading Brief 状态；重启恢复布局、标签、滚动锚点；Undo / Redo 可重放。

### 4.3 Context / AI / PluginHost

- `packages/context`：正式化 Gate 0 通过的 ContextBuilder。
- `packages/ai-core`：ProviderPort、manifest 校验、流事件、结构化错误。
- `packages/plugin-contracts`：PluginManifest、PluginInstance、CapabilityGrant、宿主 API schema。
- `packages/plugin-core`：生命周期、能力检查、并发 / 超时 / 取消 / 输出上限、任务状态和审计。
- `packages/plugin-sdk`：仅暴露 EvidencePort、StoragePort、SyncPort、ProviderPort、PlatformPort。

**验收**：插件不能直接访问 store / DB / 平台 API；拒绝发生在插件执行前；插件失败不影响阅读和本地事务；日志无凭据和未授权原文。

### 4.4 Gate 1 关闭条件

- 领域、workspace、context、evidence、plugin、provider 的 contract tests 通过；
- 本地 event log 可恢复；
- Gate 0 报告已归档；
- 不依赖真实云端 AI、完整 OCR 或具体同步后端；
- 六个首版验收场景中的离线、引用、布局、上下文和凭据边界可在本地测试复现。

## 5. Gate 2：官方插件

按顺序实现，插件只能使用 SDK：

1. `plugins/pdf-importer`：PDF 导入、content hash、解析降级。
2. `plugins/provider-manifest`：声明式供应商、测试连接和流式适配。
3. `plugins/analysis`：翻译、解释、总结，所有 claim 经过 evidence checker。
4. `plugins/reading-brief`：不可变 AI 版本和用户层编辑。
5. `plugins/sync`：Outbox / Inbox、单一激活同步目标、冲突恢复。
6. `plugins/exporter`：Markdown、BibTeX 和 Reading Brief 导出。

每个插件必须有 manifest 校验、capability denial、取消 / 超时、失败恢复和卸载后本地可读测试。

## 6. Gate 3：Web / Desktop Host

- `apps/web`：React + Vite、PDF.js Web adapter、docking UI、Web storage、浏览器窗口能力降级。
- `apps/desktop`：复用 Web UI；`src-tauri` 只实现文件、系统密钥链、原生窗口和系统事件边界。
- `packages/design-tokens`：跨端 token，不把桌面 DOM 组件暴露给 Mobile。

**验收**：连续滚动、跨页选区、ghost preview、中央互换、边缘拆分、独立窗口、重启恢复和凭据隔离均按 Spec 场景完成；Web 不可用的原生窗口回退到工作区面板。

## 7. Gate 4：Mobile Host

- `apps/mobile`：Expo + React Native，独立触摸 UI、抽屉、视图栈和操作菜单。
- `MobileReaderAdapter`：先用 Gate 0 结果确定 WebView 或原生 renderer，不提前锁定。
- PlatformPort：系统安全存储、文件选择和剪贴板。

**验收**：触摸选区、同一文档多视图语义、视图栈恢复、移动本地存储、45 FPS 滚动目标和无悬停 / 右键 / 系统窗口依赖。

## 8. 全局质量与安全检查

- 类型：所有 package 使用 strict TypeScript；跨包 API 只从 `src/index.ts` 导出。
- 测试：领域不变量、边界校验、序列化 round-trip、幂等重放、取消 / 超时、权限拒绝和错误降级必须有行为测试。
- 隐私：凭据仅存 CredentialRef；网络域名白名单在请求前校验；日志脱敏；原文上传必须有明确 capability 和用户授权。
- 性能：所有 P95 以定义好的起止事件测量；报告设备、浏览器、平台、输入大小和是否启用 AI；禁止用平均值替代预算。
- 回归：每个 Gate 关闭前运行对应探针和验收场景；跨 Gate 不共享未验证的实现假设。

## 9. 第一执行切片

获批准后首先只做以下切片，不创建产品页面：

1. 根 workspace / TypeScript / test runner 配置；
2. 版本化 Gate 0 fixture schema 和报告 schema；
3. `contracts`、`domain`、`reader-core` 的最小类型骨架；
4. PDF 探针和共享 Graph 探针；
5. 输出第一份 Gate 0 报告后再决定 docking、provider、context、sync 探针的实现顺序调整。

第一切片的完成标准是：能运行确定性 fixture、生成结构化报告，并对 PDF / Graph 两项给出 `pass | fail | blocked`，而不是“项目能编译”本身。
