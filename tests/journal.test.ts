import { mkdir, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("does not expose a failed file append and can retry afterward", async () => {
    const directory = await mkdtemp(join(tmpdir(), "converge-journal-"));
    const path = join(directory, "operations.ndjson");
    const journal = new OperationJournal(path);
    try {
      await mkdir(path);
      await expect(journal.append("board", [op])).rejects.toThrow();
      expect(await journal.since("board", 0)).toEqual([]);
      expect(await journal.latestCursor("board")).toBe(0);
      await rmdir(path);
      expect(await journal.append("board", [op])).toHaveLength(1);
      expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent duplicate appends before assigning cursors", async () => {
    const journal = new OperationJournal();
    const [first, retry] = await Promise.all([
      journal.append("board", [op]), journal.append("board", [op]),
    ]);
    expect(first).toHaveLength(1);
    expect(retry).toEqual([]);
    expect(await journal.since("board", 0)).toEqual(first);
  });
});
