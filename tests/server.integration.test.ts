import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { BoardOperation, ServerMessage } from "../src/core/types";
import { createConvergeServer, type ConvergeServer } from "../src/server/app";
import { OperationJournal } from "../src/server/journal";

let app: ConvergeServer | undefined;

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString()) as ServerMessage));
    socket.once("error", reject);
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("WebSocket sync service", () => {
  it("clamps a stale client cursor after a journal reset", async () => {
    const journal = new OperationJournal();
    app = createConvergeServer(journal);
    const port = await app.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(socket);
    const response = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join", boardId: "reset-board", cursor: 99 }));
    expect(await response).toMatchObject({ type: "sync", cursor: 0, operations: [] });
    socket.close();
  });

  it("does not skip an operation committed during replay", async () => {
    const first: BoardOperation = {
      id: "alice:1", actor: "alice", sequence: 1,
      timestamp: { wallTime: 1, logical: 0, actor: "alice" },
      cardId: "card-1", patch: { title: "First" },
    };
    const second: BoardOperation = {
      ...first, id: "alice:2", sequence: 2,
      timestamp: { wallTime: 2, logical: 0, actor: "alice" },
      patch: { title: "Second" },
    };
    class RacingJournal extends OperationJournal {
      private raced = false;

      override async since(boardId: string, cursor: number) {
        const snapshot = await super.since(boardId, cursor);
        if (!this.raced) {
          this.raced = true;
          await this.append(boardId, [second]);
        }
        return snapshot;
      }
    }
    const journal = new RacingJournal();
    await journal.append("race-board", [first]);
    app = createConvergeServer(journal);
    const port = await app.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(socket);
    const initial = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join", boardId: "race-board", cursor: 0 }));
    const replay = await initial;
    expect(replay).toMatchObject({ type: "sync", cursor: 1, operations: [{ cursor: 1 }] });
    const catchup = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join", boardId: "race-board", cursor: replay.type === "sync" ? replay.cursor : 0 }));
    expect(await catchup).toMatchObject({ type: "sync", cursor: 2, operations: [{ cursor: 2 }] });
    socket.close();
  });

  it("broadcasts accepted operations and replays them from a cursor", async () => {
    const journal = new OperationJournal();
    app = createConvergeServer(journal);
    const port = await app.listen();
    const first = new WebSocket(`ws://127.0.0.1:${port}`);
    const second = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([opened(first), opened(second)]);

    const firstSync = nextMessage(first);
    first.send(JSON.stringify({ type: "join", boardId: "test-board", cursor: 0 }));
    expect(await firstSync).toMatchObject({ type: "sync", operations: [] });

    const secondSync = nextMessage(second);
    second.send(JSON.stringify({ type: "join", boardId: "test-board", cursor: 0 }));
    await secondSync;

    const operation: BoardOperation = {
      id: "alice:1",
      actor: "alice",
      sequence: 1,
      timestamp: { wallTime: 10, logical: 0, actor: "alice" },
      cardId: "card-1",
      patch: { title: "Broadcast safely" },
    };
    const firstBroadcast = nextMessage(first);
    const secondBroadcast = nextMessage(second);
    first.send(JSON.stringify({ type: "operations", boardId: "test-board", operations: [operation] }));
    const [toFirst, toSecond] = await Promise.all([firstBroadcast, secondBroadcast]);
    expect(toFirst).toMatchObject({ type: "operations", operations: [{ operation }] });
    expect(toSecond).toEqual(toFirst);

    const replay = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(replay);
    const replayMessage = nextMessage(replay);
    replay.send(JSON.stringify({ type: "join", boardId: "test-board", cursor: 0 }));
    expect(await replayMessage).toMatchObject({ type: "sync", operations: [{ operation }] });

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`).then((response) => response.text());
    expect(metrics).toContain("converge_operations_accepted_total 1");
    expect(metrics).toContain("converge_operations_replayed_total 1");

    first.close();
    second.close();
    replay.close();
  });
});
