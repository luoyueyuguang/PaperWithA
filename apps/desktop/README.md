# PaperWithA Desktop (Tauri 2)

Tauri 2 桌面壳：窗口加载 `apps/web` 的构建产物，Rust 侧负责确认本地 core 服务在运行，不在时拉起它。
业务数据全部来自 core（`http://127.0.0.1:4130`），桌面壳本身不存储状态。

## 前置

- 已安装 Rust 工具链与 Tauri 的系统依赖（Linux 下需要 webkit2gtk 等，见 Tauri 官方文档）。
- 已安装 [Bun](https://bun.sh)，用于运行 `services/core`。
- 仓库依赖已安装（`pnpm install` 由根目录统一执行）。

## 启动

### 1. 构建 web 产物

```bash
corepack pnpm --filter @paperwitha/desktop build:web
```

产物输出到 `apps/web/dist`，即 `tauri.conf.json` 里的 `frontendDist`。

### 2. 打包/运行桌面应用

```bash
corepack pnpm --filter @paperwitha/desktop build   # 打包（读取 frontendDist）
```

开发模式（带热更新）由两个终端组成，因为 `tauri dev` 加载的是 `devUrl`：

```bash
# 终端 1：Vite dev server → http://localhost:4173
corepack pnpm --filter @paperwitha/desktop dev:web

# 终端 2：Tauri 窗口
corepack pnpm --filter @paperwitha/desktop dev
```

> `tauri dev` 固定加载 `build.devUrl`（`http://localhost:4173`）。若要基于构建产物调试，
> 先执行 `build:web`，并临时清空 `tauri.conf.json` 中的 `build.devUrl`，再运行 `tauri dev`。

窗口启动时 Rust 侧会探测 core；不在则按下面的配置拉起，失败只打印日志，窗口照常打开。

## core 进程

探测目标是 `GET http://127.0.0.1:4130/api/health`（2 秒超时）。
拉起命令与参数由两个环境变量控制：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PAPERWITHA_CORE_CMD` | `bun` | core 的可执行程序 |
| `PAPERWITHA_CORE_ARGS` | `run <仓库>/services/core/src/main.ts` | 传给命令的参数，按空格拆分 |

拉起后最多轮询 15 秒等待 core 就绪。

示例：

```bash
# 用默认值
corepack pnpm --filter @paperwitha/desktop dev

# 指定其它 Bun 路径
PAPERWITHA_CORE_CMD=/usr/local/bin/bun \
  corepack pnpm --filter @paperwitha/desktop dev

# 完全自定义启动命令（注意参数不能含空格）
PAPERWITHA_CORE_CMD=bun \
PAPERWITHA_CORE_ARGS="run /path/to/services/core/src/main.ts" \
  corepack pnpm --filter @paperwitha/desktop dev
```

core 自身还读取 `PAPERWITHA_DATA_DIR`（数据目录）、`PAPERWITHA_PORT`（端口）等变量；
桌面壳按上面的方式启动进程时会让其继承当前环境。

## 前端可调用的命令

- `core_status()` → `{ running: boolean, url: string }`：只探测，不启动。
- `ensure_core()` → `{ running: boolean, url: string }`：探测失败则拉起并等待就绪，超时返回错误字符串。

## 测试

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

单元测试覆盖端口探测的成功、非 2xx 响应、无监听三种情况，以及状态行解析与默认入口路径。
