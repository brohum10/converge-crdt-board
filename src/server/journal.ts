import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BoardOperation, SequencedOperation } from "../core/types.js";
import type { OperationStore } from "./store.js";

interface PersistedEntry extends SequencedOperation {
  boardId: string;
}

export class OperationJournal implements OperationStore {
  private readonly boards = new Map<string, SequencedOperation[]>();
  private readonly seen = new Set<string>();
  private cursor = 0;
  private writeChain = Promise.resolve();

  constructor(private readonly path?: string) {}

  async load(): Promise<void> {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    let content = "";
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as PersistedEntry;
      this.restore(entry);
    }
  }

  async append(boardId: string, operations: BoardOperation[]): Promise<SequencedOperation[]> {
    // Serialize calculation and persistence, then publish to readers. A failed
    // file write must never expose an operation as accepted in memory.
    const attempt = this.writeChain.then(async () => {
      const accepted: SequencedOperation[] = [];
      const persisted: PersistedEntry[] = [];
      const batchSeen = new Set<string>();
      let nextCursor = this.cursor;

      for (const operation of operations) {
        const operationKey = `${boardId}:${operation.id}`;
        if (this.seen.has(operationKey) || batchSeen.has(operationKey)) continue;
        batchSeen.add(operationKey);
        const entry = { cursor: ++nextCursor, operation };
        accepted.push(entry);
        persisted.push({ ...entry, boardId });
      }

      if (this.path && persisted.length > 0) {
        const lines = `${persisted.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
        await appendFile(this.path, lines, "utf8");
      }
      this.cursor = nextCursor;
      for (const entry of persisted) {
        this.seen.add(`${boardId}:${entry.operation.id}`);
        const board = this.boards.get(boardId) ?? [];
        board.push({ cursor: entry.cursor, operation: entry.operation });
        this.boards.set(boardId, board);
      }
      return accepted;
    });
    this.writeChain = attempt.then(() => undefined, () => undefined);
    return attempt;
  }

  async since(boardId: string, cursor: number): Promise<SequencedOperation[]> {
    return (this.boards.get(boardId) ?? []).filter((entry) => entry.cursor > cursor);
  }

  async latestCursor(boardId: string): Promise<number> {
    return this.boards.get(boardId)?.at(-1)?.cursor ?? 0;
  }

  private restore(entry: PersistedEntry): void {
    const operationKey = `${entry.boardId}:${entry.operation.id}`;
    if (this.seen.has(operationKey)) return;
    this.cursor = Math.max(this.cursor, entry.cursor);
    this.seen.add(operationKey);
    const board = this.boards.get(entry.boardId) ?? [];
    board.push({ cursor: entry.cursor, operation: entry.operation });
    this.boards.set(entry.boardId, board);
  }
}
