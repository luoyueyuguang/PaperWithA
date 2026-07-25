# PaperWithA — Handoff (2026-07-26)

## Verification

```text
typecheck        pass
vitest           18 files / 59 tests pass
build:web        pass  (main: 462 KB, xterm lazy: 284 KB)
Gate 0           48/48 pass
web smoke test   pass  (1440x900 viewport OK, welcome → demo → reader → terminal)
```

## Architecture Direction

PaperWithA is an **agent-driven paper research workbench** that runs locally. The primary workflow is terminal CLI-based, with a web UI for PDF reading and interactive shell access.

```
~/.local/share/paperwitha/papers/   ← drop PDFs here
~/.local/share/paperwitha/results/  ← agent analysis per paper
```

## Current Web UI

- **Left panel**: PDF reader (PDF.js canvas + text layer) for PDFs; plain text rendering for TXT/MD. Supports continuous scrolling, cross-page text selection, selection toolbar (context/annotate/ask), and per-page ink annotations.
- **Right panel**: Terminal CLI via xterm.js (lazy-loaded, 284 KB on demand), connected to a real shell through WebSocket
  - WebSocket backend at `services/pty/` — spawns `/bin/bash` (or `cmd.exe` on Windows) in papers dir
  - Also serves HTTP API on same port: `GET /papers` (list), `DELETE /papers/:filename` (remove file)
  - Start it: `pnpm --filter @paperwitha/pty start` → http://localhost:4121
- Top bar merged into sidebar (compact layout)
- Import paper, sidebar toggle, provider config all functional
- Agent sessions with branch/fork support, context management, evidence anchoring
- Ink annotation (pen, highlighter, eraser) with per-page canvas overlay
- OCR support for image-only PDF pages (tesseract.js)
- Workspace export/import (.paperwitha JSON format)

## Running

```bash
# Terminal
corepack pnpm dev:web                                    # :4173
corepack pnpm --filter @paperwitha/pty start              # ws://:4121

# Watcher (auto-analyzes papers dropped in papers dir)
corepack pnpm --filter @paperwitha/watcher start          # requires `pi` (OMP CLI)

# Or all together
corepack pnpm dev:web &
corepack pnpm --filter @paperwitha/pty start &
corepack pnpm --filter @paperwitha/watcher start &
```

## Package State

| Package | Status |
|---------|--------|
| agent-core | Complete, tested (4 test files) |
| agent-runtime-node | Complete (OMP/Pi/OpenCode adapters). Node.js only — not usable in browser. Desktop integration via Tauri commands is the intended path. |
| ai-core | Complete, tested |
| context | Complete, tested |
| domain | Complete, tested (ink strokes) |
| evidence | Complete, tested |
| reader-core | Complete, tested (graph, selection, paper-view) |
| storage | Complete, tested |
| workspace | Complete, tested |
| sync | Complete, tested (14 tests) |
| plugin-core | Complete, tested |
| platform | Complete, tested |
| paper-store | Complete. Provides XDG-based paper storage (ingest, index, results). Used by pty and watcher services. |
| services/api | Sync HTTP server (:4120) |
| services/pty | Shell terminal + HTTP API on :4121. WebSocket for terminal, HTTP for `GET /papers` and `DELETE /papers/:filename`. Deleting a paper in the web UI also removes the file from `~/.local/share/paperwitha/papers/`. |
| services/watcher | File watcher + Pi subagent. Watches papers dir for new PDFs, auto-ingests and analyzes via `pi` CLI. Falls back to polling if fs.watch unavailable. Gracefully skips analysis if `pi` not installed. |
| apps/desktop | Tauri shell with workspace persistence (save/load), SQLite, Stronghold secret storage |
| apps/mobile | Expo shell with functional agent sessions |
| apps/web | PDF reader + terminal CLI + agent workspace. State extracted to `state.ts` (types, storage, mutation functions). Main bundle 462 KB. |

## Recent Fixes & Optimizations

1. **Paper click handler bug**: Fixed `button.dataset.paperId` → `el.dataset.paperId` (wrong variable reference).
2. **Watcher resilience**: Added `pi` availability check with clear error messages; `Promise.withResolvers()` migration.
3. **Filesystem delete sync**: Web UI deletion removes files from `~/.local/share/paperwitha/papers/` via PTY HTTP API (`DELETE /papers/:filename` and `DELETE /papers` for bulk).
4. **xterm.js lazy loading**: xterm.js (284 KB) now dynamically imported only when terminal tab is active. Main bundle: 729 KB → 462 KB (-37%).
5. **State module extraction**: Extracted types, constants, and state management (~200 lines) from `main.ts` into `apps/web/src/state.ts`. Shared state uses setter functions for ES module compatibility.

## Known Gaps

1. **agent-runtime-node not wired to Desktop**: The Desktop (Tauri) app has basic Rust commands but does not yet expose AgentHost as Tauri commands for agent runtime integration.
2. **Tmux split views**: Would require a ViewTree refactor of the reader panel. Current is single reader + terminal layout.
3. **`pi` CLI dependency**: The watcher requires the OMP `pi` CLI to be installed for automated paper analysis. Without it, papers are ingested but not analyzed.
