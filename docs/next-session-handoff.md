# PaperWithA — Final State

## Verification (2026-07-25)

```text
typecheck               pass
vitest                  18 files / 59 tests pass
build:web               pass
mobile typecheck        pass
Gate 0 validator        48/48 pass
main.ts                 1033 lines
```

## Package Layout

```
packages/
├── agent-core/          Session/Branch/Run/Event, Sandbox, Runtime, Export
├── agent-runtime-node/  OMP RPC, Pi RPC, OpenCode HTTP adapters, AgentHost
├── ai-core/             ProviderManifest, ProviderClient (SSE/JSON)
├── context/             ContextSet, ContextBuilder (lexical+budget)
├── contracts/           Gate 0 probe report types
├── domain/              DocumentGraph, InkStroke, ReadingBrief
├── evidence/            Annotation
├── platform/            PlatformShell (cross-platform state)
├── plugin-contracts/    PluginManifest, PluginLifecycle
├── plugin-core/         PluginHost
├── reader-core/         DocumentGraphCache, PaperView, EvidenceAnchor
├── storage/             StoragePort, BlobStore, JsonRepository
├── sync/                SyncPort, SyncEnvelope, Outbox, Inbox, HttpSyncPort, InMemorySyncServer
└── workspace/           LayoutTree, LayoutHistory

services/
└── api/                 Sync API HTTP server (POST /sync/push, GET /sync/pull, GET /health)

apps/
├── web/                 Complete Web Host (Vite + TS DOM)
├── desktop/             Tauri 2 + Rust native stack + AgentHost integration
└── mobile/              Expo 52 + React Native with functional agent sessions
```

## Capability Summary

| Feature | Status |
|---|---|
| PDF import + canvas render + positioned text layer | Done |
| Handwriting (pen/highlighter/eraser) + PNG export | Done |
| OCR on low-confidence pages | Done |
| Multi-session with independent context/history | Done |
| Session fork/branch switching | Done |
| OMP/Pi/OpenCode agent adapters (packages) | Done |
| OMP/Pi/OpenCode wired — Desktop AgentHost | Done |
| Sandbox experiments (virtual FS, runs, artifacts) | Done |
| .paperwitha workspace export/import | Done |
| Structured Reading Brief (confidence-classified) | Done |
| Citation jump-to-source with flash animation | Done |
| Split-pane layout with draggable divider | Done |
| Desktop Tauri native stack (fs, sqlite, stronghold) | Scaffolded |
| Plugin system | Done |
| Runtime/agent profile selection in Web UI | Done |
| Runtime/agent profile selection in Mobile UI | Done |
| Sync package (SyncPort, Outbox, Inbox, InMemorySyncServer) | Done |
| Sync API service (HTTP, CORS, sensitive payload rejection) | Done |
| Mobile agent sessions (functional chat) | Done |

## Latest Changes (2026-07-25)

1. **Bug fix**: `archiveAgentSession` was used but not imported in `apps/web/src/main.ts` — fixed
2. **Sync package**: Created `packages/sync` with SyncPort, SyncEnvelope, Outbox, Inbox, HttpSyncPort, InMemorySyncServer, envelope guard (sensitive payload rejection), and 14 tests
3. **Sync API**: Created `services/api` — HTTP server at port 4120 with POST /sync/push, GET /sync/pull, GET /health
4. **Web UI**: Added runtime/agent profile selectors in agent workspace toolbar; non-embedded runtimes marked "Desktop"; runtime selection persisted in localStorage
5. **Desktop**: Added `createDesktopAgentHost()`, `getAvailableDesktopRuntimes()` to `apps/desktop/src/index.ts` with AgentHost integration for OMP/Pi/OpenCode adapters
6. **Mobile**: Made `App.tsx` functional — real agent workspace state, chat input/response, runtime/agent profile selection, context-aware evidence responses
