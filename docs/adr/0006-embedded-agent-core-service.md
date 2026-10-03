# ADR-0006：单 core 服务 + 内嵌 agent + React Web

- 状态：Accepted
- 日期：2026-10-03
- 范围：整个仓库

## 背景

2026-07 的实现能编译、59 个测试全过，但产品主路径是断的：

- `renderWorkspace` 只渲染阅读器和终端，`sendAgentPrompt` 与 `renderBrief` 没有调用方；默认回答是模板字符串。
- 导入 PDF 后阅读区被换成 `<iframe>`，页面节点、文本层、ink 画布全部消失。
- `packages/agent-runtime-node`（约 800 行适配器）只被一个无构建、无引用方的文件引用。
- Web 用 localStorage 存整份 AppState，services 用 XDG `paper-store`，两边互不相认。
- 17 个 workspace 包里 6 个对产品零贡献，`design-tokens`、`plugin-sdk`、`services/worker` 只有 `.gitkeep`。

诊断与证据见 `docs/redesign-plan.md` 第 1 节。

## 决策

1. **收敛为单一 core 服务**。`services/core` 用 Bun 运行，独占存储与 agent，
   通过 HTTP 与 WebSocket 服务三端。删除 `services/api`、`services/pty`、`services/watcher`、`services/worker`。
2. **内嵌 oh-my-pi**。core 进程内调用 `@oh-my-pi/pi-coding-agent` 的 `createAgentSession()`，
   不再 fork 外部 CLI，也不再要求用户安装 `pi`。
   实测：Bun 1.3.14 + `18.4.12`，会话创建 376ms，流式 `text_delta` 正常。
3. **共享包收敛为两个**：`packages/domain`（类型与纯函数）与 `packages/api-client`（core 客户端）。
   删除 `agent-core`、`ai-core`、`context`、`contracts`、`design-tokens`、`evidence`、`paper-store`、
   `platform`、`plugin-contracts`、`plugin-core`、`plugin-sdk`、`reader-core`、`storage`、`sync`、`workspace`。
4. **Web 改用 React + Vite**，按功能拆成库、阅读器、Chat 三块；PDF 用 pdf.js 的 canvas + TextLayer 渲染，
   不再用 `<iframe>`。不再保留裸 bash 终端面板，agent 的工具调用在 Chat 里显示为活动行。
5. **删除同步、插件系统、docking 布局、Reading Brief、OCR、Provider 配置界面**。
   这些是旧目标架构的一部分，与当前产品闭环无关。

## 后果

- 正面：一条真实可验证的链路；依赖与目录大幅减少；core 是唯一事实源，三端行为一致。
- 负面：core 必须用 Bun 运行，Node 环境跑不了；内嵌 SDK 会把 oh-my-pi 的 LSP、MCP、扩展
  加载一起带进进程，启动更重；跨设备同步能力归零。
- 被取代的决策：ADR-0002、ADR-0003、ADR-0004、ADR-0005 全部作废；ADR-0001 保留三端技术栈，
  共享边界按本 ADR 修订。
