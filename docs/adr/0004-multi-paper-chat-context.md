# ADR-0004：多论文 Chat 上下文

- 状态：Superseded（由 ADR-0006 取代；当前会话只绑定单篇论文）
- 范围：单论文解释、多论文比较和研究空间

## 决策

ChatSession 不绑定单一论文，而是绑定可显式维护的 ContextSet。

ContextSet 可以包含：

- 一个或多个 DocumentRef
- 若干 EvidenceAnchor
- 用户笔记
- 用户明确固定的章节或选区
- 当前检索策略和版本

界面始终显示当前上下文，例如：

`[Paper A] [Paper B] [Paper A · p.3] [+ 添加论文]`

系统不默认把所有打开的论文发送给模型。用户必须显式添加论文，或主动选择研究空间模式。

## 消息快照

每条 ChatMessage 保存发送时的 ContextSnapshot，包含当时使用的文档、证据范围、用户笔记和检索版本。之后修改 ChatSession 的上下文不能改变历史消息的来源。

## 模式

- 单论文：解释、翻译、段落和章节总结
- 多论文比较：比较方法、结论、数据和限制
- 研究空间：用户明确加入的一组论文

## 引用

跨论文回答必须按文档标注来源。回答中的 claim 只能引用有效 EvidenceAnchor；没有有效锚点时必须标记为未关联原文或通用知识。

## 约束

模型和供应商可以按 ChatSession 选择，但不能改变该会话已有消息的 ContextSnapshot。
