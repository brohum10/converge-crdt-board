import { performance } from "node:perf_hooks";
import { BoardReplica } from "../src/core/replica.js";
import type { BoardOperation } from "../src/core/types.js";

const operationCount = Number(process.argv[2] ?? 100_000);
const actorCount = 20;
const cardCount = 2_000;
const operations: BoardOperation[] = [];

for (let index = 0; index < operationCount; index += 1) {
  const actor = `actor-${index % actorCount}`;
  operations.push({
    id: `${actor}:${Math.floor(index / actorCount) + 1}`,
    actor,
    sequence: Math.floor(index / actorCount) + 1,
    timestamp: { wallTime: 1_700_000_000_000 + index, logical: 0, actor },
    cardId: `card-${index % cardCount}`,
    patch: index < cardCount ? { title: `Card ${index}`, column: "backlog", deleted: false } : { rank: index },
  });
}

const replica = new BoardReplica("benchmark");
const started = performance.now();
const applied = replica.applyMany(operations);
const elapsed = performance.now() - started;
const throughput = applied / (elapsed / 1_000);

console.log(JSON.stringify({
  operations: applied,
  cards: replica.visibleCards().length,
  elapsedMs: Number(elapsed.toFixed(2)),
  operationsPerSecond: Math.round(throughput),
}, null, 2));
