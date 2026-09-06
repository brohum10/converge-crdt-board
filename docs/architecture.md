# Architecture and engineering decisions

## Consistency model

Converge models each card as four independent last-writer-wins registers: `title`, `column`, `rank`, and `deleted`. An operation can update one or more registers. A register accepts an incoming value when its timestamp is greater than or equal to the current timestamp.

The timestamp is a hybrid logical clock tuple:

```text
(wall time, logical counter, actor ID)
```

Wall time keeps ordering intuitive. The logical counter preserves causality when the local clock stalls or moves backward. Actor ID breaks the final tie deterministically. The result is a total order without requiring synchronized physical clocks.

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

On reconnect, it asks for entries after its cursor and resends its pending operations. Resending is safe because both the journal and replica deduplicate by operation ID. The server gives each newly accepted operation a global cursor, stores it in an append-only journal, and broadcasts it to every socket subscribed to that board.

The server cursor is a transport optimization, not part of conflict resolution. CRDT timestamps still decide values, which prevents arrival order from silently changing the result.

## Complexity

| Operation | Time | Space |
|---|---:|---:|
| Duplicate check | O(1) average | O(number of operation IDs) |
| Apply one patch | O(number of fields), bounded by 4 | O(number of cards + operations) |
| Materialize board | O(cards log cards) | O(cards) output |
| Replay after cursor | O(board history) in this demo | O(missed operations) output |

For a production-scale board, the journal would index `(board_id, cursor)` in a database, and the server would periodically compact acknowledged history into signed snapshots.

## Failure behavior

| Failure | Behavior |
|---|---|
| Client loses network | Local edits continue and enter the persistent pending queue |
| Client retries a batch | Duplicate IDs are ignored |
| Messages arrive out of order | Field registers compare timestamps, not delivery order |
| Browser clock moves backward | Logical time advances on the previous wall-time value |
| Server restarts | Accepted operations reload from the NDJSON journal |
| Invalid/oversized message | The protocol rejects it before journal mutation |

The current file journal is durable enough for a local demonstration but does not promise crash-atomic multi-record writes. A transactional database would be the next operational step.

## Production evolution

I would preserve the core operation contract while replacing infrastructure around it:

1. Authenticate WebSocket upgrades with short-lived session tokens and authorize each `boardId`.
2. Persist operations in PostgreSQL with unique constraints on operation ID and an index on `(board_id, cursor)`.
3. Publish accepted rows through a transactional outbox to a fan-out layer such as Redis Streams or NATS.
4. Compact older logs into versioned snapshots after all active replica cursors pass a watermark.
5. Add per-board quotas, structured telemetry, reconnect latency SLOs, and property-based fuzz tests.

For text documents, I would replace the title register with a sequence CRDT so simultaneous character edits preserve both users' intent. For a task title, last-writer-wins is simpler and has a predictable user experience.
