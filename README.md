# PaperWithA

Local-first agent-driven research workspace. Drop PDFs into a directory, the agent reads them, and you interact through a terminal CLI — like a co-pilot for your papers.

## How It Works

```
~/papers/                     ← drop PDFs here
    ├── attention.pdf
    └── transformer-xl.pdf

~/.local/share/paperwitha/    ← XDG data store
    ├── papers/               ← ingested PDFs (SHA-256 addressed)
    ├── results/              ← agent analysis per paper
    └── index.json            ← global index
```

1. Put a PDF in `~/.local/share/paperwitha/papers/` (or `papers` CLI `ingest`)
2. The watcher detects it, spawns a Pi subagent to analyze it
3. Results are stored in `results/<hash>.json`
4. Open the Web UI — read papers in the left panel, talk to the agent in the terminal panel

## Quick Start

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:web
corepack pnpm dev:web
```

## CLI

```bash
# List indexed papers
npx tsx packages/paper-store/cli.ts list

# Ingest a PDF
npx tsx packages/paper-store/cli.ts ingest ~/Downloads/paper.pdf

# Show agent analysis result
npx tsx packages/paper-store/cli.ts result <hash>

# Start the file watcher (auto-analyzes new PDFs via Pi)
pnpm --filter @paperwitha/watcher start
```

## Architecture

```
packages/
├── agent-core/          Session/Branch/Run/Event, Sandbox, Runtime
├── agent-runtime-node/  OMP RPC, Pi RPC, OpenCode HTTP adapters
├── ai-core/             ProviderManifest, ProviderClient (SSE/JSON)
├── context/             ContextSet, ContextBuilder
├── domain/              DocumentGraph, InkStroke, ReadingBrief
├── evidence/            Annotation
├── paper-store/         XDG path resolution, paper index, ingest, results
├── platform/            PlatformShell
├── plugin-contracts/    PluginManifest
├── plugin-core/         PluginHost
├── reader-core/         DocumentGraphCache, PaperView, EvidenceAnchor
├── storage/             StoragePort, BlobStore, JsonRepository
├── sync/                SyncPort, Outbox, Inbox, InMemorySyncServer
└── workspace/           LayoutTree, LayoutHistory

services/
├── api/                 Sync API HTTP server
└── watcher/             File watcher + Pi subagent trigger

apps/
├── web/                 PDF reader + terminal CLI
├── desktop/             Tauri 2 + Rust
└── mobile/              Expo 52 + React Native
```

## Storage

- **XDG data**: `~/.local/share/paperwitha/` — papers, results, index
- **XDG cache**: `~/.cache/paperwitha/` — subagent artifacts
- **XDG config**: `~/.config/paperwitha/` — agent config
- **Web**: `localStorage` for session state; blob store with in-memory fallback

## License

MIT
