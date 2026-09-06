import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { LIMITS, isValidBoardId, isValidOperation } from "../core/validation.js";
import type { ClientMessage, ServerMessage } from "../core/types.js";
import { OperationJournal } from "./journal.js";

const port = Number(process.env.PORT ?? 8787);
const dataDirectory = process.env.DATA_DIR ?? "./data";
const journal = new OperationJournal(join(dataDirectory, "operations.ndjson"));
await journal.load();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(404).end();
});

const socketsByBoard = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ server, maxPayload: LIMITS.messageBytes });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function fail(socket: WebSocket, message: string): void {
  send(socket, { type: "error", message });
}

function subscribe(socket: WebSocket, boardId: string): void {
  const current = socketsByBoard.get(boardId) ?? new Set<WebSocket>();
  current.add(socket);
  socketsByBoard.set(boardId, current);
}

function broadcast(boardId: string, message: ServerMessage): void {
  for (const socket of socketsByBoard.get(boardId) ?? []) send(socket, message);
}

wss.on("connection", (socket) => {
  const subscriptions = new Set<string>();

  socket.on("message", async (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      fail(socket, "Message must be valid JSON.");
      return;
    }

    if (!isValidBoardId(message.boardId)) {
      fail(socket, "Invalid board identifier.");
      return;
    }

    if (message.type === "join") {
      if (!Number.isSafeInteger(message.cursor) || message.cursor < 0) {
        fail(socket, "Cursor must be a non-negative integer.");
        return;
      }
      subscribe(socket, message.boardId);
      subscriptions.add(message.boardId);
      send(socket, {
        type: "sync",
        boardId: message.boardId,
        cursor: journal.latestCursor(message.boardId),
        operations: journal.since(message.boardId, message.cursor),
      });
      return;
    }

    if (message.type !== "operations" || !Array.isArray(message.operations)) {
      fail(socket, "Unknown message type.");
      return;
    }
    if (message.operations.length > LIMITS.operationsPerMessage || !message.operations.every(isValidOperation)) {
      fail(socket, "Operation batch is invalid or too large.");
      return;
    }

    const accepted = await journal.append(message.boardId, message.operations);
    if (accepted.length > 0) {
      broadcast(message.boardId, {
        type: "operations",
        boardId: message.boardId,
        cursor: accepted.at(-1)!.cursor,
        operations: accepted,
      });
    } else {
      send(socket, {
        type: "operations",
        boardId: message.boardId,
        cursor: journal.latestCursor(message.boardId),
        operations: [],
      });
    }
  });

  socket.on("close", () => {
    for (const boardId of subscriptions) {
      const sockets = socketsByBoard.get(boardId);
      sockets?.delete(socket);
      if (sockets?.size === 0) socketsByBoard.delete(boardId);
    }
  });
});

server.listen(port, () => {
  console.log(`Converge sync server listening on http://localhost:${port}`);
});
