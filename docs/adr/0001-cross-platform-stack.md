# ADR-0001：跨端技术栈与共享边界

- 状态：Accepted
- 范围：Web、桌面、平板、手机
- 本决策不包含业务功能实现

## 决策

采用 TypeScript monorepo，使用 pnpm Workspaces 管理应用、共享包和服务。

- Web：React + Vite
- Desktop：Tauri 2，复用 Web 前端；Rust 仅位于原生能力边界
- Mobile：Expo + React Native；共享领域模型、数据契约和 AI 业务，不强行共享桌面 DOM UI
- Web/Desktop 阅读器第一阶段使用 PDF.js
- 移动阅读器通过 ReaderAdapter 接入，具体采用 WebView 或原生渲染器由原型验证决定

## 共享原则

共享以下内容：

- domain entities
- workspace commands
- document intermediate model
- evidence anchors
- provider contracts
- sync envelopes
- design tokens

不强制共享以下内容：

- 桌面 docking UI
- 移动触摸 UI
- 系统窗口实现
- 文件系统和密钥存储实现
- PDF 平台渲染器

## 原因

桌面和网页需要高密度文档阅读、影子拖动、面板拆分和键盘操作；手机和平板需要原生触摸、抽屉、视图栈和系统能力。共享领域和协议比强制共享所有 UI 更稳定。

## 后果

- apps/web 是主要 Web UI
- apps/desktop/src-tauri 只承载桌面原生边界
- apps/mobile 使用独立 React Native UI
- packages/domain、workspace、reader-core、contracts、evidence、storage、sync 是跨端边界
- 不允许应用层绕过共享领域命令直接修改持久化状态
