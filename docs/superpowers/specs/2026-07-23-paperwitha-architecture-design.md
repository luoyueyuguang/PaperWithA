# PaperWithA 跨端 AI 论文阅读工作台设计规格

- 日期：2026-07-23
- 状态：已获用户批准；实现进行中，Gate 0 已通过，Gate 2–4 尚未关闭
- 设计路线：共享领域核心 + 平台壳 + 成熟 docking engine + 可选同步插件
- 本文范围：产品行为、领域模型、跨端架构、插件机制、同步、证据链、性能预算和执行闸门
- 本文不包含：业务代码、依赖安装、接口实现代码、部署脚本

## 1. 产品目标

PaperWithA 是一个以论文原文为中心的跨端 AI 阅读工作台，支持 Web、桌面、平板和手机。

核心体验：

1. 论文采用连续纵向滚动阅读；
2. AI 工作区与论文并列显示，比例和位置可由用户调整；
3. 用户选中文字后可以翻译、解释、总结、追问和批注；
4. 鼠标停留翻译是可选功能，默认不打断阅读；
5. AI 对论文、章节、段落和选区生成分层总结；
6. 导入后生成结构化 Reading Brief；
7. Chat 使用浏览器式标签，支持多开、多模型和多论文上下文；
8. 面板通过影子拖动完成互换、拆分、合并和独立打开；
9. 支持多家 AI 供应商、供应商配置导入和本地模型扩展；
10. 首版支持本地优先运行，并可安装和启用跨设备同步插件，同时提供隐私控制。

## 2. 已确认的产品原则

### 2.1 原文优先

AI 不能覆盖原文。所有强结论都应尽量关联 EvidenceAnchor，并能跳回文档版本、页码、章节和文本范围。

### 2.2 主动布局

默认布局保持简单，但系统不根据屏幕宽度替用户决定是否允许第三个窗口。用户拖动面板影子后，可以主动创建更多工作区窗口。

### 2.3 平台适配而非虚假统一

工作区内的面板语义跨端一致；系统窗口能力按平台差异实现。桌面可以创建原生独立窗口，Web 受浏览器能力限制，手机使用视图栈或全屏面板替代。

### 2.4 多论文上下文显式维护

Chat 可以同时使用多篇论文，但未被用户加入 ContextSet 的论文不得自动进入上下文。

### 2.5 可选同步插件

PaperWithA 核心默认支持本地运行。跨设备同步不是核心存储的强制依赖，而是可安装、可启用和可暂停的插件能力。启用同步插件后，客户端仍然先本地提交，再由插件异步同步；离线时仍可继续阅读和产生操作。

## 3. 用户工作流

### 3.1 导入和初始化

1. 用户从论文库导入 PDF、网页或未来支持的 DOI；
2. 系统生成不可变的 Document 身份和内容 hash；
3. 本地解析标题、作者、页面、文本块和初步章节结构；
4. 用户看到文档可阅读状态；
5. 系统显示解析置信度和潜在结构问题；
6. 用户选择 AI 供应商、模型和隐私模式；
7. 系统生成结构简报或 AI Reading Brief；
8. 系统打开默认工作区：PaperView + AI 工作区。

解析失败不能阻塞原文阅读。系统应退化为页级阅读、搜索和批注，并显示结构不完整状态。

### 3.2 连续阅读

PaperView 使用连续滚动，按页或文本块虚拟化渲染。

阅读位置保存为语义锚点，而不只保存像素：

- DocumentVersion
- SectionId
- BlockId
- relativeOffset
- fallbackPage

同一 Document 可以创建多个 PaperView；每个视图独立保存滚动位置、缩放和选区。

### 3.3 选区操作

选中单词、句子、段落或跨页文本后，显示：

- 翻译
- 解释
- 分层总结
- 追问
- 加批注
- 加入 Chat 上下文
- 复制引用

悬停翻译仅在桌面设备上可用，默认关闭；用户可以设置停留延迟、翻译语言和复杂度。

### 3.4 Reading Brief

Reading Brief 是结构化产物，不埋在 Chat 历史中。

它包含：

- 论文要解决的问题；
- 作者明确主张；
- 方法路线；
- 主要贡献；
- 关键证据；
- 结果和局限；
- 5C 检查；
- 三遍阅读进度；
- 建议重点阅读位置；
- 待用户验证的问题。

AI 内容必须区分：

- 论文明确陈述；
- 基于论文归纳；
- 通用知识或外部知识；
- 证据不足。

Reading Brief 采用不可变 AI 版本；用户编辑和用户批注保存为独立层，不覆盖 AI 原始版本。

### 3.5 Chat

ChatSession 是浏览器式标签：

- 点击切换；
- 拖动排序；
- 拖到标签栏合并；
- 拖到面板边缘拆分；
- 从消息分叉；
- 固定、重命名、关闭和恢复。

每个 ChatSession 拥有 ContextSet，可以包含多个 DocumentRef、EvidenceAnchor、章节、选区和用户笔记。

每条消息保存发送时的 ContextSnapshot，后续修改上下文不改变历史回答的来源。

上下文模式：

- 单论文；
- 多论文比较；
- 研究空间。

系统不自动把所有打开的论文加入上下文。跨论文回答必须按文档分组显示引用。

## 4. 工作区和窗口模型

### 4.1 核心概念

- PanelInstance：PaperView、ReadingBrief、ChatSession、TranslationView 或 AnnotationView；
- StackNode：一个标签集合；
- SplitNode：左右或上下拆分；
- LayoutTree：可序列化的工作区布局；
- WorkspaceWindow：应用内部窗口；
- NativeWindow：桌面系统窗口；
- WindowRegistry：NativeWindow 和 PanelInstance 的登记及事件同步。

### 4.2 影子拖动

拖动面板标题栏或 Chat 标签时：

1. 生成显示少量真实内容的缩小影子；
2. 影子跟随指针或手指；
3. 目标区域显示释放后布局预览；
4. 松开后执行可撤销的布局命令。

落点语义：

- 顶层面板中央：预览互换位置；
- 标签栏中央：合并为标签；
- 面板边缘：创建 SplitNode；
- 工作区外：桌面端创建 NativeWindow；
- 语义不明确：显示“互换位置 / 合并为标签”。

面板位置变化不能改变被移动内容的状态。

### 4.3 布局操作

布局操作采用领域命令：

- MovePanel
- SwapPanels
- SplitPane
- MergeTab
- DetachWindow
- RestoreWindow
- UndoLayoutChange
- RedoLayoutChange

布局操作必须可序列化、可恢复、可撤销；启用同步插件后可以通过同步协议传播。

底层 docking engine 优先使用成熟的 React 方案，例如 Dockview；PaperWithA 自己负责面板类型、影子预览、中央互换语义、同步和命令层。

## 5. 文档和阅读器模型

### 5.1 DocumentGraph

DocumentGraph 是平台无关的文档中间模型：

```text
Document
└─ DocumentVersion
   └─ DocumentGraph
      ├─ Page
      ├─ Section
      ├─ Paragraph
      ├─ Sentence
      ├─ TextSpan
      ├─ Figure
      ├─ Table
      ├─ Formula
      └─ EvidenceAnchor
```

每个结构节点包含解析 confidence。解析器无法可靠判断时必须保留不确定状态，不得伪装成确定结构。

### 5.2 EvidenceAnchor

EvidenceAnchor 至少关联：

- DocumentVersion；
- PageId；
- 结构节点 ID；
- 字符范围；
- 坐标范围；
- 解析置信度。

文档版本变化后，旧锚点必须显示为有效、可能过期或失效，不能静默指向新文本。

### 5.3 ReaderAdapter

`reader-core` 只定义 DocumentGraph、选区、锚点、滚动语义和阅读命令；渲染由平台适配器完成：

- WebPdfAdapter：PDF.js；
- DesktopPdfAdapter：PDF.js + Tauri 文件能力；
- MobilePdfAdapter：WebView 或原生 PDF 渲染器，由原型和性能验证决定。

移动端渲染器可延后选择，但 DocumentGraph 和 ReaderAdapter 边界必须先冻结。

## 6. AI 和证据链

AI 请求链路：

```text
Selection / ContextSet
        ↓
EvidenceResolver
        ↓
ContextBuilder
        ↓
ProviderAdapter
        ↓
Structured Claims
        ↓
CitationReferenceChecker
        ↓
Chat / Brief UI
```

首版的引用校验只做机械检查：

- 文档版本存在；
- 页码存在；
- 文本块存在；
- 字符范围有效；
- 可以跳转到原文。

不宣称完成 AI 论断的语义真实性验证。

AI 主张没有有效 EvidenceAnchor 时，必须显示为未关联原文或通用知识，不得显示为论文明确结论。

## 7. 供应商和模型

`ProviderProfile` 是用户安装或配置后的供应商实例，包含：

- providerId；
- ProviderManifest 引用；
- authentication reference；
- 用户可见的 endpoint 或区域覆盖；
- enabled state；
- 用户隐私和数据发送设置。

`ProviderManifest` 是通用的声明式供应商描述，不限定 OpenAI-compatible。OpenAI-compatible 只是其中一种 transport preset。

ProviderManifest 可以声明：

- manifestVersion 和兼容的 PaperWithA Provider API 版本；
- transport：HTTP JSON、SSE、WebSocket、本地进程或其他受支持传输；
- endpoint 与区域；
- authentication scheme：API key、OAuth、环境引用或本地模型；
- model catalog；
- capabilities：文本、视觉、工具调用、长上下文、流式输出等；
- request / response schema mapping；
- streaming、错误和限流语义；
- 隐私、数据保留和网络域名白名单。

Manifest 中的 mapping 只能使用受限声明式表达，不能执行任意代码、模板脚本、WASM 或动态导入。

支持方向：

- 内置供应商；
- 任意符合 ProviderManifest 的供应商；
- OpenAI-compatible transport preset；
- Anthropic、Gemini 等官方 manifest；
- Ollama / LM Studio 等本地供应商；
- 需要代码逻辑的特殊供应商插件。

首版支持手动配置和 ProviderManifest 导入、校验和测试连接。Codex 配置若需要导入，必须先转换为 ProviderManifest；导入过程只读取声明式配置，不执行 Codex 脚本。
- ProviderManifest 只允许声明式 mapping，不执行任意脚本、模板表达式、WASM 或动态导入；

API Key：

- Desktop 使用系统密钥链；
- Mobile 使用系统安全存储；
- Web 使用加密存储或服务端密钥引用；
- 永不进入同步实体。

## 8. 插件机制

### 8.1 插件边界

插件由 PluginManifest、PluginInstance、CapabilityGrant 和 PluginHost 管理。插件不能直接访问领域 store、数据库或平台 API，只能通过宿主授予的能力接口工作。

首批插件类别：

- sync：跨设备同步、WebDAV 或其他同步目标；
- ai-provider：AI 供应商和模型适配；
- importer：PDF、网页、DOI 或其他文档导入；
- exporter：笔记、引用和阅读简报导出；
- reader-adapter：平台或文档格式阅读器适配。

内置一方插件可以作为受信任模块运行；用户安装的第三方插件必须经过 manifest 校验并运行在隔离环境中。插件默认不能执行任意代码、读取任意文件或访问任意网络。

Manifest 必须声明：

- 插件 ID、版本和兼容的 PaperWithA API 版本；
- 插件类型；
- 所需能力；
- 网络域名白名单；
- 文件和文档访问范围；
- 是否处理论文原文；
- 数据保留和隐私说明。

插件生命周期：安装 → 校验 → 授权 → 启用 → 暂停 / 禁用 → 卸载。禁用插件不能阻塞核心阅读功能。

### 8.2 同步插件

同步插件只接收宿主提供的同步操作和用户明确授权的数据范围。它不能直接读取数据库，也不能默认读取原始论文文件或 API Key。

同步插件可以被暂停或卸载；卸载后本地数据保持可读，未同步的 Outbox 操作保留在本地，重新启用兼容插件后可以继续处理。

每个 Workspace 默认只有一个激活的同步目标，用户可以安装多个插件和配置多个目标，但不能让多个目标无提示地同时写入同一个工作区。

### 8.3 插件安全

- PluginHost 执行 capability 检查；
- 插件不能绕过 Evidence、Storage 或 SyncPort；
- 插件网络请求受 manifest 白名单限制；
- 插件不能获得其他插件的密钥；
- 插件错误只能使自身进入失败状态，不能破坏本地阅读数据；
- Codex 配置只作为声明式 manifest 解析，不执行任意脚本。

## 9. 可选同步插件
### 9.1 本地优先原则

PaperWithA 核心在没有同步插件时也必须完整可用。启用同步插件后，客户端仍然先提交本地事务，再由插件异步处理同步；插件暂停或卸载不会阻塞本地阅读和数据访问。

### 9.2 操作流

```text
Domain Command
    ↓
Local Transaction
    ↓
OutboxEntry
    ↓
Sync Push
    ↓
Server Operation Log
    ↓
Sync Pull
    ↓
InboxEntry
    ↓
Local Projection
```

SyncEnvelope 至少包含：

- operationId；
- actorId；
- deviceId；
- entityType；
- entityId；
- baseRevision；
- payload；
- serverSequence（服务端分配；客户端离线生成时为空）；
- tombstone（可选）。

操作必须幂等、可重试、可离线产生。

### 9.3 同步实体策略

- ChatMessage：追加式；
- Annotation：追加式，删除使用 tombstone；
- ReadingBriefVersion：不可变版本 + current pointer；
- Layout：操作日志 + 版本恢复；
- 阅读位置：按设备保存，同时记录全局最近位置；
- Document metadata：版本号 + 最后修改者；
- 原始 PDF：用户明确允许后才同步；
- API Key：禁止同步。

## 10. 跨端项目结构

```text
apps/
├─ web/
├─ desktop/
│  └─ src-tauri/
└─ mobile/

packages/
├─ domain/
├─ workspace/
├─ reader-core/
├─ context/
├─ ai-core/
├─ evidence/
├─ storage/
├─ sync/
├─ platform/
├─ plugin-core/
├─ plugin-contracts/
├─ plugin-sdk/
├─ contracts/
└─ design-tokens/

services/
├─ api/
└─ worker/

infra/
```

依赖规则：

- `domain` 不依赖 UI、React、Tauri 或具体数据库；
- `workspace` 只依赖 domain 和 contracts；
- `reader-core` 不依赖具体渲染器；
- `ai-core` 只负责 AI 请求、流式结果和 ProviderPort，不直接管理本地数据库；
- `context` 负责 ContextSet、ContextSnapshot、词法检索和上下文预算；
- `evidence` 负责引用和机械校验；
- `storage` 负责本地仓储端口和适配器；
- `sync` 负责同步操作协议，不直接依赖数据库引擎；
- `plugin-core` 负责插件生命周期、能力授权和隔离边界；
- `plugin-contracts` 负责插件 manifest 和宿主接口契约；
- `plugin-sdk` 只提供受支持的插件开发接口，不暴露内部 store；
- `platform` 是文件、窗口、密钥和剪贴板等系统能力的唯一边界。

### 10.1 Gate 1 前必须冻结的最小契约

以下契约是跨端实现的输入，不是具体数据库 schema。ID 使用不可猜测的 opaque string；时间统一使用 UTC ISO 8601；所有集合的顺序只有在契约明确要求时才有语义。

#### EvidenceAnchor

```ts
type EvidenceAnchor = {
  anchorId: string;
  documentId: string;
  documentVersionId: string;
  pageId: string;
  nodeId: string;
  range: { start: number; end: number };
  bbox?: { x: number; y: number; width: number; height: number };
  validity: "valid" | "stale" | "invalid";
  confidence: number;
};
```

`start < end` 且范围必须落在 `nodeId` 的文本长度内；`confidence` 取 `[0, 1]`。解析新版本时不得复用旧 `anchorId` 指向新文本。解析或校验失败只能把锚点标为 `stale` / `invalid`，不能静默重定位。

#### ContextSet / ContextSnapshot

```ts
type ContextSet = {
  contextSetId: string;
  documents: Array<{ documentId: string; documentVersionId: string }>;
  fixedEvidence: EvidenceAnchor[];
  fixedSections: Array<{ documentVersionId: string; sectionId: string }>;
  userNotes: Array<{ noteId: string; text: string }>;
  retrieval: { strategy: "lexical"; version: string };
};

type ContextSnapshot = {
  snapshotId: string;
  contextSet: ContextSet;
  resolvedSources: EvidenceAnchor[];
  omittedSources: Array<{ sourceId: string; reason: "budget" | "invalid" }>;
  modelBudget: { inputTokens: number; reservedTokens: number };
};
```

`fixedEvidence` 和 `fixedSections` 的内容优先级高于检索结果。若固定内容本身超出模型预算，ContextBuilder 必须返回可见的 `budget_exceeded` 结果并阻止发送；不得静默丢弃固定证据。非 `documents` 中的文档不能出现在 `resolvedSources`。每条 ChatMessage 保存不可变的 `ContextSnapshot`。

#### ProviderManifest mapping

首版 mapping 只允许以下可静态校验的表达式：`json-pointer`（从请求或响应 JSON 读取字段）、`literal`（固定标量）和 `list`（有限表达式列表）。表达式不得读取文件、环境变量或凭据，不得执行脚本、模板、正则替换、动态导入或网络调用；凭据只能由 PlatformHost 根据 `CredentialRef` 注入 transport 层。

Manifest 校验输出必须区分：结构错误、版本不兼容、mapping 不受支持、网络域名未声明和认证方案不完整。测试连接只允许使用 mock transport 或用户明确启用的 endpoint，失败时返回结构化错误，不得自动切换其他供应商。

#### PluginHost

PluginHost 是唯一的插件调用入口。每次调用都携带 `pluginId`、operation、输入大小和 `AbortSignal`，并按 `CapabilityGrant`、manifest 白名单、并发上限、超时和输出大小上限依次检查。拒绝返回可分类错误，不执行插件代码；运行中取消、超时或输出超限只改变该插件任务状态，不回滚宿主本地事务，也不阻塞阅读、布局或选区。

插件只能通过宿主暴露的 EvidencePort、StoragePort、SyncPort、ProviderPort 和 PlatformPort 访问数据。PluginHost 必须记录可追踪的调用状态（accepted / running / cancelled / timed_out / failed / completed），但日志不得包含凭据或未授权原文。

#### SyncPort

```ts
type SyncEnvelope = {
  operationId: string;
  actorId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  baseRevision: string | null;
  payload: unknown;
  createdAt: string;
  serverSequence?: number;
  tombstone?: boolean;
};

interface SyncPort {
  push(entries: SyncEnvelope[]): Promise<Array<{
    operationId: string;
    status: "accepted" | "duplicate" | "conflict" | "rejected";
  }>>;
  pull(cursor: number | null, limit: number): Promise<{
    entries: SyncEnvelope[];
    nextCursor: number | null;
  }>;
}
```

本地事务必须先写领域状态和 Outbox，再调用 `push`；离线生成的 envelope 不含 `serverSequence`，由服务端接受后分配。服务端按 `operationId` 幂等；客户端重复收到相同 operation 不得重复投影。`conflict` 必须进入可恢复状态，不能被当作成功吞掉；API Key、CredentialRef 对应的明文和未授权原文不得出现在 envelope。

## 11. 隐私和错误处理

### 隐私

用户可以选择：

- 启用同步插件后只同步阅读状态；
- 启用同步插件后同步原始论文文件；
- 使用云端 AI；
- 使用本地模型；
- 只发送选区或相关段落；
- 禁止整篇论文发送给供应商。

### 错误降级

- PDF 解析失败：仍允许页级阅读、搜索和批注；
- 结构识别不确定：显示 confidence 和页级 fallback；
- AI 请求失败：保留论文和本地数据，不静默换供应商；
- 插件失败：插件进入失败或暂停状态，本地阅读和数据访问继续；
- 启用同步插件时同步失败：保留 Outbox，显示待同步状态；
- 引用失效：显示失效，不静默跳到新文本；
- 独立窗口不可用：回退到工作区内面板或视图栈。

## 12. 首版验收场景

1. 拖动论文影子到 Chat 中央，完成互换，滚动位置和 Chat 历史不变；
2. 拖动 Reading Brief 到边缘，产生新工作区窗口；
3. 拖动 Chat 标签到另一个标签栏，完成合并；
4. 同一论文开启两个 PaperView，独立滚动；
5. 多论文 Chat 显式添加两篇论文，并按论文分组显示引用；
6. 选中文本后回答能跳转到正确 DocumentVersion 和 EvidenceAnchor；
7. AI 请求失败时不静默转发到其他供应商；
8. 设备离线时仍能阅读、批注、聊天并产生本地操作；
9. 启用同步插件后恢复联网，操作幂等同步且不产生重复消息；
10. API Key 不出现在同步数据；
11. 论文文件只在用户允许并授予插件权限时上传；
12. 重启后恢复布局、阅读位置、Chat 标签和插件状态；
13. 禁用或卸载同步插件后，本地论文、批注、Chat 和阅读简报仍可访问。
14. A / B 基准文档首个可读页面 P95 不超过 2 秒；
15. 已解析页面本地选区反馈 P95 不超过 100 毫秒；
16. 滚动时只保留视口和缓冲页面，多个 PaperView 不重复解析同一 DocumentGraph；
17. ContextBuilder 在超出模型预算时显示被裁剪来源，不静默丢弃用户固定证据；
18. 插件长任务可以取消、超时、报告进度，且不能阻塞阅读、选区和布局；
19. Gate 0 六个可行性探针均有可重复输入、性能结果和通过结论后，才能进入 Core 实现。

## 13. 性能与跨端可行性

### 13.1 基准文档档位

Gate 0 使用三类可重复样本：

- A：20 页、单栏、可提取文本；
- B：200 页、双栏、图表和公式混合；
- C：500 页、扫描页或复杂图表，需部分 OCR。

基准记录设备、浏览器、平台、文件大小、解析状态和是否启用 AI，不能只报告平均值。

### 13.2 初始性能预算

以下是首版初始预算，若基准证明不可行，必须在 Spec 评审中修改，不能在实现中静默放宽：

- A / B 本地文件选定后，首个可读页面 P95 ≤ 2 秒；
- 已解析页面的本地选区反馈 P95 ≤ 100 毫秒；
- 工作区面板切换 P95 ≤ 100 毫秒，不等待网络；
- 桌面连续滚动目标 60 FPS，移动端目标 45 FPS；
- 连续滚动期间不得渲染整篇文档 DOM，只保留视口和缓冲页面；
- 每个 PaperView 默认只保留有限数量的活动 text layer；
- 同一 Document 的多个 PaperView 共享 DocumentGraph 和索引；
- AI、OCR、图表识别和同步不得阻塞滚动、选区和布局操作。

### 13.3 多论文上下文性能

ContextBuilder 不得把所有论文全文直接拼入 prompt。检索顺序为：用户固定选区 → 用户固定章节 → 当前问题的词法检索 → 可选向量检索插件。

上下文超出模型预算时，必须显示被裁剪的来源。系统不能静默丢弃用户固定的证据范围。

首版至少提供确定性的词法检索基线；向量索引作为可替换插件能力，不成为 Core 的强制依赖。

### 13.4 插件运行时约束

耗时插件 API 必须支持取消、进度、超时、并发上限和输出大小上限。插件只能订阅语义事件，不能默认订阅高频鼠标、滚动或 DOM 事件。

插件失败只能使插件进入失败或暂停状态，不能阻塞阅读、布局和本地数据访问。

第三方插件首版只支持 ProviderManifest 和其他声明式贡献。官方代码插件可受控地随应用发布；Web Worker、iframe、WASM 或原生 sidecar 等代码沙箱不在首版稳定承诺内。

### 13.5 跨端可行性规则

- Web / Desktop 支持完整连续阅读、影子拖动和 docking；
- Mobile 使用触摸选区、视图栈和抽屉表达同一语义；
- Mobile 不依赖悬停、右键或系统独立窗口；
- ProviderManifest 的 UI 贡献必须是跨端声明式描述；
- 官方平台插件可以使用平台组件，但不能把平台组件暴露为第三方稳定 API。

## 14. 执行阶段与闸门

### Gate 0：可行性探针

在实现产品前，分别验证：

1. PDF.js 连续滚动、text layer、跨页选区和页面虚拟化；
2. 多 PaperView 共享 DocumentGraph；
3. docking engine、影子预览、中央互换和边缘拆分；
4. ProviderManifest 校验、流式请求和错误映射；
5. ContextSet 词法检索、来源排序和上下文裁剪；
6. Outbox / Inbox 离线操作、批量同步和幂等重放。

每个探针必须有可重复输入、性能结果、失败状态和结论。未通过的探针必须回到设计，不得带着未验证假设进入 Core 实现。

### Gate 0 探针协议

六个探针使用版本化 fixture 和单一命令入口运行。每次结果必须保存：fixture 版本、代码版本、设备 / 浏览器 / 平台、输入文件大小、解析状态、原始指标、失败日志和 `pass | fail | blocked` 结论；性能不得只报告平均值，至少报告 P50 / P95 / P99。探针不依赖真实用户数据、云端 AI 或生产同步服务。

| 探针 | 可重复输入 | 必须输出 | 通过条件 |
|---|---|---|---|
| PDF 连续阅读 | A / B / C 三档 PDF fixture | 首个可读页面时间、可见页集合、text layer 选择范围、跨页 anchor、活动页面数 | A / B 首个可读页面 P95 ≤ 2 秒；选择反馈 P95 ≤ 100ms；不渲染整篇 DOM；跨页选择能生成有效 anchor；C 允许降级但必须明确状态 |
| 共享 DocumentGraph | 一份 B fixture、两个 PaperView、不同初始 scrollAnchor | Graph 身份 / 解析次数、两个视图状态、重启恢复结果 | 两个视图引用同一 Graph；解析只发生一次；滚动、缩放、选区互不覆盖；布局变化不改变视图状态 |
| Docking 与布局 | 三个 PanelInstance、中央 / 标签栏 / 边缘 / 工作区外落点序列 | ghost preview、序列化 LayoutTree、命令日志、undo / redo 结果、切换延迟 | 中央互换、标签合并、边缘拆分语义正确；每步可撤销；恢复后树等价；面板内容状态不变；切换 P95 ≤ 100ms |
| ProviderManifest | 合法 manifest、版本错误、脚本 mapping、未声明域名、mock SSE 和错误响应 fixture | 校验诊断、规范化流事件、结构化错误、网络请求审计 | 非法表达式和未声明域名在请求前拒绝；流事件顺序稳定；错误不触发供应商 fallback；日志不含凭据 |
| ContextBuilder | 两篇文档、固定选区 / 章节、非成员文档、可重复问题、受限 token budget | 来源排序、resolvedSources、omittedSources、裁剪原因、最终 token 计数 | 非成员永不进入上下文；固定来源优先；固定内容超预算时显式失败；普通来源裁剪可解释；结果可重复 |
| Outbox / Inbox | 离线命令、重复 envelope、乱序 pull、断线重连、冲突 fixture | 本地投影、Outbox / Inbox 状态、push 回执、cursor、重放计数 | 本地先提交；重复 operation 只产生一次业务效果；重试安全；cursor 可恢复；conflict 可见且可恢复；API Key 不进入同步数据 |

探针必须同时覆盖成功、拒绝、取消 / 超时和恢复路径。六项均为 `pass` 才能冻结对应 Gate 1 接口；任一项 `fail` 必须回写设计约束，`blocked` 不得被解释为通过。

### Gate 1：精简 Core

冻结并验证：

- DocumentGraph；
- EvidenceAnchor；
- PaperView 语义和滚动锚点；
- Workspace / LayoutTree；
- ContextSet / ContextSnapshot；
- Local Event Log；
- PluginHost；
- ProviderManifest 校验。

此阶段不要求真实云端 AI、完整 OCR 或具体同步后端。

### Gate 2：官方插件

按顺序接入：

1. PDF Importer / ReaderAdapter；
2. ProviderManifest provider；
3. Analysis plugin：翻译、解释、总结；
4. Reading Brief plugin；
5. 官方 Sync plugin；
6. Exporter。

### Gate 3：Web / Desktop Host

验证 Web Host、Tauri Host、文件和密钥能力、桌面独立窗口以及完整 docking 行为。

### Gate 4：Mobile Host

验证 Expo Host、触摸选区、Mobile ReaderAdapter、抽屉和视图栈、移动本地存储和系统安全存储。

只有对应 Gate 的性能、错误降级、数据恢复和跨端验收通过后，才能进入下一 Gate。

## 15. 非目标

当前设计不承诺：

- AI 自动完成同行评审；
- AI 语义层面证明所有结论真实；
- 手机拥有与桌面完全相同的系统窗口；
- 任意第三方脚本可直接执行；
- 第一阶段自动完成完整文献综述；
- 无限深度、无约束的布局嵌套。

## 16. 后续流程

本 Spec 已完成评审并进入实现。当前实现状态、验证证据和剩余缺口以 `docs/next-session-handoff.md` 为准；任何 Gate 只能在对应行为和跨端验收具有直接证据后关闭。
