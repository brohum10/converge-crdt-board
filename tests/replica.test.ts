import { describe, expect, it } from "vitest";
import { BoardReplica } from "../src/core/replica";
import type { BoardOperation } from "../src/core/types";

function operation(overrides: Partial<BoardOperation> = {}): BoardOperation {
  return {
    id: "alice:1",
    actor: "alice",
    sequence: 1,
    timestamp: { wallTime: 100, logical: 0, actor: "alice" },
    cardId: "card-1",
    patch: { title: "Initial", column: "backlog", rank: 0, deleted: false },
    ...overrides,
  };
}

describe("board replica", () => {
  it("creates and materializes a card", () => {
    const replica = new BoardReplica("alice");
    replica.createCard("Ship the demo", 100);
    expect(replica.visibleCards()).toMatchObject([{ title: "Ship the demo", column: "backlog" }]);
  });

  it("ignores an operation it has already applied", () => {
    const replica = new BoardReplica("alice");
    const op = operation();
    expect(replica.apply(op)).toBe(true);
    expect(replica.apply(op)).toBe(false);
    expect(replica.history()).toHaveLength(1);
  });

  it("converges regardless of delivery order", () => {
    const first = operation();
    const second = operation({
      id: "bob:1",
      actor: "bob",
      timestamp: { wallTime: 110, logical: 0, actor: "bob" },
      patch: { title: "Concurrent winner" },
    });
    const a = new BoardReplica("replica-a", [first, second]);
    const b = new BoardReplica("replica-b", [second, first]);
    expect(a.visibleCards()).toEqual(b.visibleCards());
    expect(a.visibleCards()[0].title).toBe("Concurrent winner");
  });

  it("merges different fields from concurrent edits", () => {
    const title = operation({ patch: { title: "Polished copy" } });
    const move = operation({
      id: "bob:1",
      actor: "bob",
      timestamp: { wallTime: 100, logical: 0, actor: "bob" },
      patch: { column: "done" },
    });
    const replica = new BoardReplica("reader", [title, move]);
    expect(replica.visibleCards()[0]).toMatchObject({ title: "Polished copy", column: "done" });
  });

  it("breaks exact timestamp ties by actor id", () => {
    const alice = operation({ patch: { title: "Alice" } });
    const zoe = operation({
      id: "zoe:1",
      actor: "zoe",
      timestamp: { wallTime: 100, logical: 0, actor: "zoe" },
      patch: { title: "Zoe" },
    });
    expect(new BoardReplica("reader", [zoe, alice]).visibleCards()[0].title).toBe("Zoe");
  });

  it("uses a tombstone instead of physically deleting state", () => {
    const replica = new BoardReplica("alice", [operation()]);
    const deletion = replica.change("card-1", { deleted: true }, 200);
    expect(replica.visibleCards()).toEqual([]);
    expect(replica.history()).toContainEqual(deletion);
  });

  it("can resurrect a card with a newer operation", () => {
    const replica = new BoardReplica("alice", [operation()]);
    replica.change("card-1", { deleted: true }, 200);
    replica.change("card-1", { deleted: false, title: "Restored" }, 210);
    expect(replica.visibleCards()[0].title).toBe("Restored");
  });

  it("continues its local sequence after restoring history", () => {
    const history = [operation({ id: "alice:7", sequence: 7 })];
    const replica = new BoardReplica("alice", history);
    expect(replica.change("card-1", { title: "Next" }, 300).sequence).toBe(8);
  });

  it("returns a defensive copy of operation history", () => {
    const replica = new BoardReplica("alice", [operation()]);
    const history = replica.history();
    history[0].patch.title = "mutated";
    expect(replica.visibleCards()[0].title).toBe("Initial");
  });
});
