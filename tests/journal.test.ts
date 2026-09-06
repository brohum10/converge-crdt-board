import { describe, expect, it } from "vitest";
import { OperationJournal } from "../src/server/journal";
import type { BoardOperation } from "../src/core/types";

const op: BoardOperation = {
  id: "a:1",
  actor: "a",
  sequence: 1,
  timestamp: { wallTime: 1, logical: 0, actor: "a" },
  cardId: "card",
  patch: { title: "One" },
};

describe("operation journal", () => {
  it("assigns a monotonically increasing server cursor", async () => {
    const journal = new OperationJournal();
    const first = await journal.append("board", [op]);
    const second = await journal.append("board", [{ ...op, id: "a:2", sequence: 2 }]);
    expect(second[0].cursor).toBeGreaterThan(first[0].cursor);
  });

  it("deduplicates retries in constant-time lookup", async () => {
    const journal = new OperationJournal();
    await journal.append("board", [op]);
    expect(await journal.append("board", [op])).toEqual([]);
  });

  it("returns only entries newer than a reconnect cursor", async () => {
    const journal = new OperationJournal();
    const entries = await journal.append("board", [op, { ...op, id: "a:2", sequence: 2 }]);
    expect(await journal.since("board", entries[0].cursor)).toEqual([entries[1]]);
  });

  it("isolates operation streams by board", async () => {
    const journal = new OperationJournal();
    await journal.append("alpha", [op]);
    await journal.append("beta", [op]);
    expect(await journal.since("alpha", 0)).toHaveLength(1);
    expect(await journal.since("beta", 0)).toHaveLength(1);
  });
});
