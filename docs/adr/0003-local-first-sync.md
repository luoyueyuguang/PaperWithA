# ADR-0003：本地优先与可选同步插件

- 状态：Superseded（由 ADR-0006 取代；同步与插件系统已从仓库移除）
- 范围：本地阅读、同步插件、论文状态、批注、Reading Brief、Chat、布局和原始文件

## 决策

跨设备同步不是核心阅读存储的强制依赖，而是可安装、可启用、可暂停和可卸载的插件能力。PaperWithA 核心始终先提交本地事务；启用同步插件后，插件通过 Outbox / Inbox 异步处理跨设备同步。

## 同步插件边界

同步插件接收宿主提供的 SyncEnvelope 和用户明确授权的数据范围，不直接访问数据库、原始论文或 API Key。

插件可以暂停或卸载；未同步的 Outbox 操作保留在本地，重新启用兼容插件后可以继续处理。

每个 Workspace 默认只有一个激活的同步目标；可以安装多个插件和配置多个目标，但不能无提示地同时写入同一工作区。

## 同步协议

同步协议使用平台无关的 SyncEnvelope：

- operationId
- actorId
- deviceId
- entityType
- entityId
- baseRevision
- payload
- createdAt
- serverSequence（服务端分配；客户端离线生成时为空）；
- tombstone（可选）

操作必须幂等，可重试，客户端必须能离线产生操作。

## 本地存储

首版允许各平台使用适合自身的存储：

- Web：IndexedDB / OPFS
- Desktop：SQLite / Tauri
- Mobile：SQLite / Expo

统一的是 StoragePort、Repository 接口和同步操作格式，不强行统一底层数据库。

## 冲突策略

- Chat 消息：追加式，不覆盖历史
- 批注：追加式；删除使用 tombstone
- Reading Brief：不可变版本加 current pointer
- Layout：操作日志；冲突时保留版本并支持恢复
- 阅读位置：按设备保存，并记录全局最近活动位置
- 论文元数据：版本号和最后修改者
- 原始文件：内容寻址；用户明确允许后才上传同步
- API Key：永不同步

## 隐私规则

用户必须能选择：

- 不安装或暂停同步插件，仅使用本地数据；
- 启用同步插件但只同步阅读状态，不同步原文；
- 启用同步插件并同步论文文件；
- 本地存储，不使用云端 AI。

AI 请求的上下文范围、供应商和模型必须在发送前可见。
