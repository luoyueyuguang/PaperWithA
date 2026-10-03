# PaperWithA

本地优先的论文研究工具。你有篇论文，agent 读过了，你问它。

## 它做什么

1. 把 PDF、TXT 或 Markdown 论文导入本地库（默认 `~/.local/share/paperwitha/papers`）。
2. 左栏读原文，选中文字可以「问这段」。
3. 右栏和 agent 对话：流式回答，引用标注页码，点页码跳回原文。

agent 直接内嵌在 `services/core` 进程里（[oh-my-pi](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent)
的 `createAgentSession`），模型和凭证沿用你已有的 `~/.omp/agent` 配置。

## 环境要求

- Node 20+（跑 pnpm 脚本）
- [Bun](https://bun.sh) 1.3+（跑 core；内嵌 SDK 依赖 Bun 运行时）
- pnpm 9（`corepack pnpm` 即可）
- 已经配置好的 oh-my-pi 凭证（`~/.omp/agent`）

## 快速开始

```bash
corepack pnpm install --frozen-lockfile

# 终端 1：core 服务
corepack pnpm dev:core        # http://127.0.0.1:4130

# 终端 2：Web 界面
corepack pnpm dev:web         # http://localhost:4173
```

打开 http://localhost:4173，导入一篇论文，开始在右栏提问。

单进程模式（core 同时托管 web 产物）：

```bash
corepack pnpm build:web
corepack pnpm start:core      # 打开 http://127.0.0.1:4130
```

## 验证

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm probe:agent     # 端到端：上传论文 + 真实提问，需要 ~/.omp 凭证
```

## 目录

```text
apps/web             React 19 + Vite 6 界面
apps/desktop         Tauri 2 桌面壳
apps/mobile          Expo 移动端
packages/domain      跨端类型与纯函数
packages/api-client  core 客户端
services/core        Bun 服务：存储、文本抽取、内嵌 agent、HTTP/WS
docs/                方案、架构、领域模型、ADR
```

## 调整回答风格

助手默认被约束成「直接回答、两三句、不用标题和加粗、不分点、不写报告腔」。
想改的话，建一个 `~/.config/paperwitha/style.md`，里面写的要求会追加到系统提示词后面：

```markdown
回答只用一句话。涉及数字时给出原文的英文表述。
```

文件不存在就用默认风格；路径也可以用 `PAPERWITHA_STYLE_FILE` 指定。改完不用重启 core，
下一个新建的会话生效（旧会话的提示词在创建时就固定了）。

助手写公式用 LaTeX，Web 界面用 KaTeX 排版（行内 `$S_t$`、独立公式 `$$...$$`）；
移动端不排版，只把定界符去掉按纯文本显示。用户粘贴的原文里的 `$` 不会被误当成公式。

## 阅读器缩放

阅读器标题右侧有 `− 100% ＋`：`−`/`＋` 每次 25%，点百分比回到 100%；按住 Ctrl/⌘ 在论文上滚轮也能缩放。
每篇论文各记各的倍数，切换论文互不影响，缩放不会带动整个界面（那是浏览器自己的缩放）。
PDF 会按新倍率重绘，文字版论文直接改字号；缩放到超过窗口宽度时阅读区横向滚动。

## 生成图解、动画、幻灯片

对某条回答可以点「图解」或「动画」，对整个会话可以点「幻灯片」或「视频」。产物落在
`~/.local/share/paperwitha/artifacts/`，在对话里直接看。

工具链要求（core 启动时会探测，缺哪个就禁用对应按钮）：

```bash
# 图片与视频渲染（SVG → PNG → MP4）
sudo apt install librsvg2-bin ffmpeg

# 可选：装了 manim 就走 manim 渲染动画，否则用 SVG 帧序列
uv tool install manim     # 需要 libcairo2-dev / libpango1.0-dev
```

没有 manim 也能出视频：agent 写 SVG 帧序列，core 用 `rsvg-convert` + `ffmpeg` 拼成 MP4。
幻灯片是一份自包含、无脚本的 `deck.html`，可以直接在浏览器打开或打印成 PDF。

## 数据放哪

```text
~/.local/share/paperwitha/
  papers/      原始文件（也可直接往里丢文件）
  index.json   论文索引
  text/        每页文本
  sessions/    对话记录
```

环境变量：`PAPERWITHA_DATA_DIR`、`PAPERWITHA_AGENT_DIR`、`PAPERWITHA_PORT`、`PAPERWITHA_STYLE_FILE`。
