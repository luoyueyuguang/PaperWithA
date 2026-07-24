# PaperWithA 领域模型

本文件只定义业务概念、关系和不变量，不包含实现代码。

## 核心实体

### Document

论文或其他研究文档的身份和元数据。原始文件通过 content hash 关联，解析结果生成 DocumentGraph。

### DocumentGraph

平台无关的语义文档中间模型，包含 Page、Section、Paragraph、Sentence、TextSpan、Figure、Table、Formula 和 EvidenceAnchor。

每个结构节点包含 confidence，用于表示解析可靠性。

### PaperView

某个 Document 在工作区中的一次阅读视图，独立拥有 scrollAnchor、zoom、selectedSpan 和当前章节。

同一个 Document 可以有多个 PaperView。

### ReadingBrief

某个 Document 的结构化阅读产物，包含 Pass 阶段、论文主张、贡献、证据、局限、问题和用户确认状态。

AI 生成的简报使用不可变版本；用户修改通过用户层内容保存，不覆盖 AI 原始版本。

### ChatSession

一个带有消息历史、模型选择、供应商引用和 ContextSet 的聊天会话。

### ContextSet

ChatSession 当前允许使用的 DocumentRef、EvidenceAnchor、章节、选区和用户笔记集合。

### ContextSnapshot

发送某条 ChatMessage 时的 ContextSet 快照。历史消息只引用自己的快照。

### EvidenceAnchor

指向 DocumentGraph 中具体文档、页码、结构节点和文本范围的稳定引用。

### Annotation

用户创建的高亮、笔记、标签和状态，关联 Document 或 EvidenceAnchor。

### PanelInstance

工作区中的内容实例，例如 PaperView、ReadingBrief、ChatSession 或 TranslationView。

### LayoutTree

由 SplitNode、StackNode 和 PanelInstance 组成的可序列化布局结构。

### SyncEnvelope

由领域命令产生的跨设备同步操作。必须幂等，可重试，可追踪来源设备。

### PluginManifest

插件身份、版本、类型、兼容的 PaperWithA API 版本、所需能力、网络白名单和隐私声明。

### PluginInstance

某个已安装插件的运行状态、启用状态、配置引用和授权范围。

### CapabilityGrant

用户授予插件的最小能力集合，例如同步操作访问、文档元数据访问、原文 blob 访问或外部网络访问。

### ProviderManifest

通用声明式 AI 供应商描述，包含 transport、认证方案、模型能力、请求响应映射、流式语义、错误语义和网络白名单。

### ProviderProfile

用户配置后的供应商实例，引用 ProviderManifest，并保存用户选择、endpoint 覆盖、启用状态和不透明的 CredentialRef。

### CredentialRef

由平台 Secret Broker 管理的凭据引用。领域模型只能保存引用，不能保存 API Key 明文。

## 关键关系

```text
Document 1 ── N PaperView
Document 1 ── N ReadingBriefVersion
Document 1 ── N EvidenceAnchor
Document 1 ── N Annotation
ChatSession 1 ── 1 ContextSet
ChatSession 1 ── N ContextSnapshot
ContextSnapshot N ── N Document
ContextSnapshot N ── N EvidenceAnchor
PanelInstance 1 ── 1 content reference
LayoutTree 1 ── N PanelInstance
SyncEnvelope N ── 1 entity revision
PluginInstance 1 ── 1 PluginManifest
PluginInstance 1 ── N CapabilityGrant
SyncPlugin N ── 1 Workspace
SyncEnvelope N ── 1 SyncPlugin
```

## 不变量

1. PanelInstance 的移动不改变它引用的内容状态。
2. PaperView 的滚动位置属于 PaperView，不属于 Document。
3. ChatMessage 必须保存发送时的 ContextSnapshot。
4. AI claim 没有有效 EvidenceAnchor 时不能显示为论文明确结论。
5. EvidenceAnchor 必须能定位到文档版本；版本变化后失效引用必须显式标记。
6. ReadingBrief 的新版本不能删除旧版本。
7. SyncEnvelope 必须具备唯一 operationId，并且重复提交不会重复产生业务效果。
8. API Key 不能成为可同步实体。
9. 用户未显式加入的 Document 不得进入 Chat 的研究上下文。
10. 布局操作必须可序列化、可恢复，并支持撤销。
11. 插件不能绕过宿主的 Evidence、Storage 或 SyncPort；
12. 同一个 Workspace 默认只有一个激活的同步目标；
13. 禁用或卸载插件不能使本地论文、批注、Chat 或 Reading Brief 不可访问。
14. ProviderManifest 的 mapping 只能使用受限声明式表达；需要代码逻辑的供应商必须通过受控插件提供。
15. ProviderProfile 不能把 CredentialRef 解析为明文凭据或进入同步实体。
16. ContextSnapshot 必须保存发送时的固定证据、检索版本、模型预算和被裁剪来源；固定证据超预算时必须显式失败，不能静默丢弃。
17. EvidenceAnchor 的有效性是显式状态（valid / stale / invalid）；文档版本变化不得静默复用旧锚点。
18. SyncEnvelope.serverSequence 在离线客户端生成时为空，仅由服务端分配；operationId 是幂等键。
19. 插件长任务的取消、超时、输出超限和失败不能回滚宿主已提交的本地事务。
