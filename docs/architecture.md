# Architecture and engineering decisions

## Consistency model

Converge models each card as four independent last-writer-wins registers: `title`, `column`, `rank`, and `deleted`. An operation can update one or more registers. A register accepts an incoming value when its `(timestamp, operation ID)` tuple is greater than the current tuple.

The timestamp is a hybrid logical clock tuple:

```text
(wall time, logical counter, actor ID)
```

Wall time keeps ordering intuitive. The logical counter preserves causality when the local clock stalls or moves backward. Actor ID orders concurrent clocks, and the immutable operation ID resolves even a duplicated actor timestamp. The result is a total order without requiring synchronized physical clocks or trusting every client to maintain its clock perfectly.

## Invariants

1. **Convergence:** replicas that receive the same operation set materialize the same board, regardless of delivery order.
2. **Idempotency:** an operation ID is applied at most once per replica and accepted at most once by the journal.
3. **Monotonic local time:** observing local or remote events never moves an HLC backward.
4. **No destructive delete:** deletion writes a tombstone so an older delayed update cannot recreate a removed card.
5. **Offline durability:** locally created operations are persisted before they are sent.

The test suite exercises these properties directly instead of testing only happy-path UI behavior.

## Synchronization protocol

The client keeps three pieces of sync metadata:

- its immutable local operation history;
- operations that have not yet been echoed by the server;
- the largest server cursor it has received.

On reconnect, it asks for entries after its cursor and resends its pending operations. Resending is safe because both the journal and replica deduplicate by operation ID. The server gives each newly accepted operation a global cursor, stores it through the selected journal adapter, and broadcasts it to every socket subscribed to that board.

The PostgreSQL adapter wraps each batch in a transaction, uses a unique constraint on `(board_id, operation_id)` for cross-process idempotency, and indexes `(board_id, cursor)` for reconnect replay. The NDJSON adapter preserves the exact same interface for a zero-dependency local path.

The server cursor is a transport optimization, not part of conflict resolution. CRDT timestamps still decide values, which prevents arrival order from silently changing the result.

## Complexity

| Operation | Time | Space |
|---|---:|---:|
| Duplicate check | O(1) average | O(number of operation IDs) |
| Apply one patch | O(number of fields), bounded by 4 | O(number of cards + operations) |
| Materialize board | O(cards log cards) | O(cards) output |
| Replay after cursor, NDJSON | O(board history) | O(missed operations) output |
| Replay after cursor, PostgreSQL | O(log history + missed operations) | O(missed operations) output |

For long-lived production boards, the server would periodically compact acknowledged history into signed snapshots. The existing store abstraction leaves that policy independent of CRDT merge logic.

## Failure behavior

| Failure | Behavior |
|---|---|
| Client loses network | Local edits continue and enter the persistent pending queue |
| Client retries a batch | Duplicate IDs are ignored |
| Messages arrive out of order | Field registers compare timestamps, not delivery order |
| Browser clock moves backward | Logical time advances on the previous wall-time value |
| Server restarts | Accepted operations reload from the NDJSON journal |
| Invalid/oversized message | The protocol rejects it before journal mutation |
| Client floods operations | Per-socket token buckets reject excess work |
| Client cannot drain messages | Backpressure limit closes the socket with a retryable status |
| PostgreSQL write fails | The batch transaction rolls back and no partial acknowledgement is sent |

The file journal is durable enough for local development but does not promise crash-atomic multi-record writes. The PostgreSQL adapter is the production-shaped path when transactional batch durability matters.

## Observability

`GET /metrics` exposes Prometheus text format with active connections, accepted operations, duplicate retries, rejected messages, replay volume, and a persistence-latency histogram. The Compose stack includes a Prometheus scraper, making it possible to answer operational questions without adding instrumentation after an incident.

## Verification strategy

The suite covers three different failure surfaces:

1. focused tests for clocks, registers, validation, journals, rate limiting, and metrics;
2. a multi-client WebSocket integration test that verifies broadcast, cursor replay, and emitted telemetry;
3. 200 generated concurrent histories applied forward, backward, and rotated to check the convergence invariant across thousands of operation schedules.

## Production evolution

I would preserve the core operation contract while replacing infrastructure around it:

1. Authenticate WebSocket upgrades with short-lived session tokens and authorize each `boardId`.
2. Publish accepted PostgreSQL rows through a transactional outbox to a fan-out layer such as Redis Streams or NATS for multi-instance delivery.
3. Compact older logs into versioned snapshots after all active replica cursors pass a watermark.
4. Add per-board storage quotas and reconnect latency SLOs around the existing metrics.
5. Fuzz the wire protocol and run fault-injection tests against containerized PostgreSQL.

For text documents, I would replace the title register with a sequence CRDT so simultaneous character edits preserve both users' intent. For a task title, last-writer-wins is simpler and has a predictable user experience.
