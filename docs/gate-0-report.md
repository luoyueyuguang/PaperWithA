# Gate 0 可行性探针报告

- Fixture 版本：`gate0-v1`
- 运行环境：Node `20.19.0`、Linux `x64`
- 运行命令：`corepack pnpm typecheck && corepack pnpm test && corepack pnpm probe:gate0 && corepack pnpm probe:gate0:validate`
- 测试结果：8 个测试文件、21 个测试全部通过；六个探针当前 fixture 全部返回 `pass`；报告校验 48/48 通过。

## 探针结果

| 探针 | 当前 fixture | P95 | 结果 | 关键证据 |
|---|---:|---:|---|---|
| PDF 连续阅读 | A 20 页 / B 200 页双栏文本+图形 / C 500 页 image-only PDF（真实前三页 + 497 页空白压力页） | 341.46 ms | `pass` | PDF.js 解析 A/B/C；B 检出 2 columns、figure、formula；A/B 生成包含 document/page/node/range 的 anchor；C 为无 text layer 的 image-only PDF，真实扫描图来自 arXiv 1706.03762《Attention Is All You Need》前三页 raster，tesseract.js 三页均识别出非空文本，confidence 为 89 / 92 / 90，首面匹配 `Attention Is All You Need`（OCR 合计 6031.97 ms） |
| 共享 DocumentGraph | 20 页 graph | 0.12 ms | `pass` | 两个 PaperView 共享同一 graph identity；解析次数为 1；滚动页 8 / 2、缩放 1.2 / 0.9 独立 |
| Docking / LayoutTree | dockview-core jsdom：swap → merge → split；Gate 3 browser host pointer drag / popout / dual viewport | 45.12 ms | `pass` | 真实 dockview-core API 完成中央互换、标签合并、边缘拆分和 JSON round-trip；browser host 真实 pointer drag 在桌面 1024×700 与移动 390×844 均 5/5 drop-applied；ghost latency P95 为 15.40 / 15.56 ms，drop latency P95 为 102.00 / 101.78 ms；popout 观测 `popout-opened`；完整应用 docking integration 仍待验证 |
| ProviderManifest / SSE | 合法、认证缺失、脚本 mapping、未声明域名、mock SSE | 0.08 ms | `pass` | 认证缺失、非法 mapping 和未声明域名请求前拒绝；malformed SSE 分类为 stream error；流事件顺序为 delta、delta、done；无 fallback |
| ContextBuilder | 两篇论文、非成员文档、固定证据、小预算 | 0.21 ms | `pass` | 固定来源优先；非成员排除；普通来源裁剪可解释；固定证据超预算显式失败；结果可重复 |
| Outbox / Inbox | 离线、重复、乱序 cursor、冲突、凭据 payload | 0.09 ms | `pass` | 本地先提交；重复 operation 只投影一次；冲突可见；accepted pull cursor 恢复；API Key 入队前拒绝 |

## 证据文件

机器可读原始结果位于：

- `probes/gate-0/reports/gate0-v1/gate0.pdf.json`
- `probes/gate-0/reports/gate0-v1/gate0.shared-graph.json`
- `probes/gate-0/reports/gate0-v1/gate0.docking.json`
- `probes/gate-0/reports/gate0-v1/gate0.provider.json`
- `probes/gate-0/reports/gate0-v1/gate0.context.json`
- `probes/gate-0/reports/gate0-v1/gate0.sync.json`

## 当前结论

`gate0-v1` 的确定性核心探针 harness 和最小模型均可运行。但 Gate 0 **尚未最终关闭**：

1. PDF B 已升级为 200 页双栏文本、公式和图形压力 fixture；C 已替换为 500 页 image-only PDF，前三页使用真实论文 raster，后 497 页为空白压力页；三页 OCR 均有非空文本且 confidence 可用；
2. Dockview-core 已在 jsdom 中验证真实布局 API；独立 Gate 3 browser host 已验证 ghost DOM、pointer gesture、popout 和桌面 / 移动双视口回归，但完整应用集成与跨设备行为仍待验证；
3. 当前 P95 仅代表独立 browser host，不代表 Web / Desktop / Mobile 产品应用的首个可读页面、选区和布局切换基准；
4. Provider、Context 和 Sync 当前使用 deterministic mock，尚未接入真实平台 transport、存储或浏览器 Host。

因此当前状态是：**Gate 0 探针基础设施、500 页 image-only PDF、多页真实 OCR、Node/jsdom docking 和独立 Gate 3 browser host 双视口验证完成，Gate 0 设计闭合仍为 `blocked`，不能冻结 Gate 1 为跨端稳定接口**。下一步优先完成真实应用 Host 集成和产品级跨设备基准。
