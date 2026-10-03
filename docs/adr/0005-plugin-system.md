# ADR-0005：通用插件机制

- 状态：Superseded（由 ADR-0006 取代；`plugin-core` 与 `plugin-sdk` 已删除）
- 范围：同步、AI 供应商、导入、导出和阅读器适配

## 决策

PaperWithA 提供统一 PluginHost。插件通过声明式 PluginManifest 注册，通过宿主授予的能力接口工作，不能直接访问领域 store、数据库或平台原生 API。

首批插件类型：

- sync：跨设备同步目标；
- ai-provider：AI 供应商和模型适配；
- importer：PDF、网页、DOI 等导入适配；
- exporter：笔记、引用和阅读简报导出；
- reader-adapter：平台或文档格式阅读器适配。

## Provider Manifest

ProviderManifest 是通用的声明式供应商描述，不限定 OpenAI-compatible。它可以描述 HTTP JSON、SSE、WebSocket、本地进程等受支持 transport、认证方案、模型能力、请求响应映射、流式语义、错误语义、限流信息和网络白名单。

OpenAI-compatible 只是一个 transport preset。特殊供应商如果需要非声明式逻辑，必须使用受控的 ai-provider 插件，而不是在 manifest 中执行脚本。

ProviderManifest 的 mapping 只能使用受限声明式表达，不允许任意代码、模板脚本、WASM 或动态导入。

## Manifest 要求

Manifest 必须声明：

- pluginId、版本和兼容的 PaperWithA API 版本；
- 插件类型；
- 所需 capability；
- 网络域名白名单；
- 文件和文档访问范围；
- 是否处理论文原文；
- 数据保留和隐私说明。

## 生命周期

安装 → 校验 → 授权 → 启用 → 暂停 / 禁用 → 卸载。

插件暂停或卸载后，本地核心功能继续工作。插件产生的未完成任务和同步操作必须保留可恢复状态。

## 安全边界

- 内置一方插件可以作为受信任模块运行；
- 第三方插件需要 manifest 校验和隔离运行；
- 默认禁止任意代码执行、任意文件读取和任意网络访问；
- PluginHost 负责 capability 检查；
- 插件不能获得其他插件的密钥；
- 插件只能通过宿主接口访问 Evidence、Storage、SyncPort 和 PlatformPort；
- ProviderManifest 只允许声明式 mapping；需要代码逻辑的供应商必须通过受控 ai-provider 插件提供。

## 同步插件特殊规则

同步插件只能接收宿主产生的 SyncEnvelope 和用户授权的数据范围。每个 Workspace 默认只有一个激活的同步目标；多个插件可以安装，但不能无提示地同时写入同一 Workspace。

## 取舍

插件机制增加了 manifest、版本兼容、授权、沙箱和失败恢复的复杂度，但它使本地模式、云同步、不同 AI 供应商和未来导入适配可以独立演进，避免把单一供应商或同步后端写入核心领域模型。
