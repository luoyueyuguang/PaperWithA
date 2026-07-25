# PaperWithA — Handoff (2026-07-25)

## Verification

```text
typecheck        pass
vitest           18 files / 59 tests pass
build:web        pass  (~476 KB)
Gate 0           48/48 pass
```

## Architecture Direction (NEW)

PaperWithA is pivoting from "PDF reader with chat" to **agent-driven paper research via terminal CLI**.

```
~/.local/share/paperwitha/papers/   ← drop PDFs here
~/.local/share/paperwitha/results/  ← agent analysis per paper
```

## Current Web UI

- **Left panel**: PDF reader (PDF.js canvas + text layer, working)
- **Right panel**: Terminal CLI connected to a real shell via WebSocket
  - WebSocket backend at `services/pty/` — spawns `/bin/bash` in papers dir
  - Start it: `pnpm --filter @paperwitha/pty start` → ws://localhost:4121
  - Cross-platform: bash on Linux/macOS, cmd.exe on Windows
- Top bar merged into sidebar (compact layout)
- Import paper, sidebar toggle, provider config all functional

## Running

```bash
# Terminal
corepack pnpm dev:web                                    # :5173
corepack pnpm --filter @paperwitha/pty exec tsx src/index.ts  # ws://:4121

# Or all together
corepack pnpm dev:web &
corepack pnpm --filter @paperwitha/pty start &
```

## Known Issues

1. **Terminal**: Simple textarea + WebSocket works. xterm.js was attempted but CSS import failed (v5 doesn't ship separate CSS).
2. **Tmux split views**: Requested but needs ViewTree refactor. Current is single reader panel.
3. **Library delete**: Paper items show × on hover but delete button handler not yet wired.
4. **paper-store package**: Was created then reverted. XDG paths are hardcoded in PTY server. Should be restored as a proper package.

## Package State

| Package | Status |
|---------|--------|
| agent-core | Complete, tested |
| agent-runtime-node | Complete (OMP/Pi/OpenCode adapters), not wired to web |
| ai-core | Complete |
| domain, reader-core, evidence, context, storage, workspace | Complete |
| sync | New, complete (14 tests) |
| services/api | Sync HTTP server (/:4120) |
| services/pty | Shell terminal backend (ws://:4121) |
| services/watcher | File watcher + Pi subagent (was reverted, needs restore) |
| apps/desktop | Tauri shell, AgentHost integrated |
| apps/mobile | Expo shell with functional agent sessions |
| apps/web | PDF reader + terminal CLI |
