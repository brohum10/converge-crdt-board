# Reproducible benchmark

## Question

How quickly can one replica fold a large, mixed-actor operation stream into materialized card state?

## Workload

- 100,000 operations
- 2,000 distinct cards
- 20 simulated actors
- Initial card creation followed by single-field rank updates
- Five independent process runs

## Environment

- Apple silicon (`arm64`)
- macOS 26.6.2
- Node.js 24.12.0
- Warm local machine; no claim of isolated production hardware

## Result

| Run | Elapsed | Throughput |
|---:|---:|---:|
| 1 | 46.70 ms | 2,141,205 ops/s |
| 2 | 44.79 ms | 2,232,402 ops/s |
| 3 | 45.47 ms | 2,199,149 ops/s |
| 4 | 44.15 ms | 2,265,004 ops/s |
| 5 | 44.86 ms | 2,229,267 ops/s |
| **Median** | **44.86 ms** | **2,229,267 ops/s** |

This measures in-memory CRDT application, not WebSocket throughput, persistence latency, browser rendering, or production traffic. It is useful as a repeatable regression baseline for the core merge path.

## Reproduce

```bash
npm install
npm run benchmark -- 100000
```

The command emits machine-readable JSON containing operation count, materialized card count, elapsed milliseconds, and operations per second.
