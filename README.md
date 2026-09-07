# Converge

[![CI](https://github.com/brohum10/converge-crdt-board/actions/workflows/ci.yml/badge.svg)](https://github.com/brohum10/converge-crdt-board/actions/workflows/ci.yml)
[![CodeQL](https://github.com/brohum10/converge-crdt-board/actions/workflows/codeql.yml/badge.svg)](https://github.com/brohum10/converge-crdt-board/actions/workflows/codeql.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Converge is a local-first collaborative board that stays usable through slow networks, dropped connections, and concurrent edits. Changes are written to the browser immediately, queued while offline, and synchronized over WebSockets when connectivity returns. A field-level CRDT makes every replica resolve conflicts to the same state without a central lock.

> Open the app in two tabs, take one offline, edit the same card in both, then reconnect. Both tabs converge while preserving unrelated field changes.

## Why I built it

Most collaborative demos assume a perfect connection and let the server decide every conflict. I wanted to explore the harder boundary: preserving a responsive product experience while guaranteeing deterministic results after replicas diverge. The result combines distributed-systems reasoning with an interface people can actually use.

## What is inside

- **Local-first React client** — applies edits before the network responds and persists an offline operation queue
- **Deterministic CRDT core** — field-level last-writer-wins registers backed by hybrid logical clocks and operation-ID tie-breaking
- **WebSocket sync service** — replays missed operations from a cursor and broadcasts accepted updates in real time
- **Dual storage adapters** — runs instantly with an NDJSON journal or transactionally with PostgreSQL and indexed cursor replay
- **Operational safeguards** — enforces token-bucket rate limits, bounded socket backpressure, payload caps, and strict validation
- **Prometheus telemetry** — exposes connection gauges, accepted/duplicate/replayed counters, rejections, and persistence latency
- **Correctness suite** — combines deterministic cases, a real multi-socket integration test, and 200-run property-based convergence fuzzing

## Architecture

```text
┌──────────────────┐  queued operations   ┌────────────────────┐
│ React replica A  │ ───── WebSocket ───▶ │ Rate-limited sync  │
│ localStorage log │ ◀──── cursor replay ─ │ service            │
└──────────────────┘                       └─────┬────────┬─────┘
                                               │        │
                                      PostgreSQL/NDJSON │ Prometheus
                                                   │ broadcast
┌──────────────────┐                               │
│ React replica B  │ ◀─────────────────────────────┘
│ localStorage log │
└──────────────────┘

Each replica: operation log → HLC ordering → field-level LWW registers → board view
```

The server orders delivery with a monotonically increasing cursor, but it does **not** decide application state. Every client independently folds the same immutable operations into its CRDT. This separation lets the transport retry freely: operation IDs make delivery idempotent, a PostgreSQL uniqueness constraint protects that invariant across processes, and CRDT ordering makes delivery order irrelevant.

See [docs/architecture.md](docs/architecture.md) for invariants, failure behavior, tradeoffs, and production extensions.

## Run locally

Requires a supported Node.js release (`22.22.2+`, `24.15.0+`, or `26+`).

```bash
npm install
```

Start the sync service in one terminal:

```bash
npm run dev:server
```

Start the web client in another:

```bash
npm run dev
```

Visit `http://localhost:5173`. The sync server exposes `GET /health` at `http://localhost:8787/health`.

### Run the production-shaped stack

With Docker installed, one command builds the client and server, starts PostgreSQL-backed persistence, and configures Prometheus scraping:

```bash
docker compose up --build
```

- Application: `http://localhost:8787`
- Health: `http://localhost:8787/health`
- Prometheus metrics: `http://localhost:8787/metrics`
- Prometheus UI: `http://localhost:9090`

If `DATABASE_URL` is absent, the same server automatically falls back to the local NDJSON journal for a zero-setup development path.

## Verify it

```bash
npm test
npm run typecheck
npm run build
npm run benchmark
```

The benchmark applies 100,000 operations across 2,000 cards and 20 simulated actors. Five local runs produced **2.229 million operations/second median**; exact results depend on the machine. The checked-in code reports the full input size and measured throughput so the result is reproducible rather than a hand-picked claim. See [docs/benchmark.md](docs/benchmark.md) for the workload, environment, and all five samples.

## Conflict example

Suppose two offline collaborators start from the same card:

1. A renames it while B moves it to **Done**. Because those edits update different field registers, the merged card keeps both changes.
2. A and B both rename it. The greater hybrid timestamp wins.
3. Their timestamps are identical. The immutable operation ID is the final deterministic tie-break, so all replicas still choose the same title—even if a malformed client reuses an actor timestamp.

This is deliberate last-writer-wins behavior, not intent-preserving rich-text merging. The distinction and possible extensions are documented in the architecture notes.

## Technology

TypeScript · React · Vite · Node.js · WebSockets · PostgreSQL · Prometheus · Docker Compose · Vitest · fast-check · Hybrid logical clocks · CRDTs

## Status and scope

Converge is an engineering demonstration, not a hosted multi-tenant product. It intentionally keeps authentication, authorization, snapshot compaction, and multi-region database replication outside the current scope; [docs/architecture.md](docs/architecture.md) explains how I would add each without weakening the consistency model.

## License

[MIT](LICENSE)
