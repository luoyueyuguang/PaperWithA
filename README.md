# PaperWithA

Local-first, multi-agent research workspace for academic papers. Read PDFs with proper text layer positioning, handwrite annotations with pen/highlighter/eraser, run multi-session agent conversations with independent context, and execute sandboxed experiments — all stored locally on your device.

## Features

- **PDF Document Surface** — canvas rendering with positioned text layer, zoom, continuous scroll
- **Handwriting & Ink** — pen, highlighter, eraser with pressure support; normalized page coordinates survive zoom/resize
- **Annotated Export** — flatten ink strokes to PDF canvas, download as PNG
- **OCR** — tesseract.js integration for scanned/image-only PDF pages
- **Multi-Session Agents** — create independent sessions with isolated context, history, and run state
- **Session Fork & Branch** — fork from any assistant message, switch between branches
- **Multi-Runtime** — local evidence agent + OMP RPC + Pi RPC + OpenCode HTTP adapters
- **Sandbox Experiments** — virtual filesystem, runs, published artifacts with policy enforcement
- **Export/Import** — `.paperwitha` workspace package for backup and migration
- **Structured Reading Brief** — confidence-classified sections (stated/inferred/general-knowledge/insufficient-evidence)
- **Citation References** — clickable source tags jump to evidence with flash animation
- **Split-Pane Layout** — draggable divider with persistent ratio

## Quick Start

```bash
# Install dependencies
corepack pnpm install --frozen-lockfile

# Type check
corepack pnpm typecheck

# Run tests
corepack pnpm test

# Start Web dev server
corepack pnpm dev:web

# Build Web
corepack pnpm build:web

# Run Gate 0 probes
corepack pnpm probe:gate0
corepack pnpm probe:gate0:validate
```

## Architecture

```
packages/
├── agent-core/          Session/Branch/Run/Event, Sandbox, Runtime, Export
├── agent-runtime-node/  OMP RPC, Pi RPC, OpenCode HTTP adapters, AgentHost
├── ai-core/             ProviderManifest, ProviderClient (SSE/JSON)
├── context/             ContextSet, ContextBuilder (lexical + budget)
├── domain/              DocumentGraph, InkStroke, ReadingBrief
├── evidence/            Annotation
├── platform/            PlatformShell (cross-platform state)
├── plugin-contracts/    PluginManifest, PluginLifecycle
├── plugin-core/         PluginHost
├── reader-core/         DocumentGraphCache, PaperView, EvidenceAnchor
├── storage/             StoragePort, BlobStore, JsonRepository
└── workspace/           LayoutTree, LayoutHistory

apps/
├── web/                 Vite + TypeScript DOM (complete)
├── desktop/             Tauri 2 + Rust (native stack scaffolded)
└── mobile/              Expo 52 + React Native (shell)
```

## Storage

### Web (current)
- `localStorage` with JSON serialization
- `StoragePortBlobStore` for PDF blobs (base64, SHA-256 addressed)

### Desktop (scaffolded)
- `tauri-plugin-sql` → SQLite
- `tauri-plugin-stronghold` → encrypted secret store
- `tauri-plugin-fs` → file system access

### Planned
- IndexedDB / OPFS for Web
- Expo SQLite for Mobile

## Gate 0 Validation

```text
probes:        6 (pdf, shared-graph, docking, provider, context, local-sessions)
validator:     48/48 checks pass
```

## License

MIT
