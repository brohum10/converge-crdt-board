import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { LIMITS, isValidBoardId, isValidOperation } from "../core/validation.js";
import type { ClientMessage, ServerMessage } from "../core/types.js";
import { MetricsRegistry } from "./metrics.js";
import { TokenBucket } from "./rate-limit.js";
import type { OperationStore } from "./store.js";

const MAX_BUFFERED_BYTES = 1_000_000;
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface ConvergeServerOptions {
  staticDirectory?: string;
}

export interface ConvergeServer {
  server: Server;
  metrics: MetricsRegistry;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createConvergeServer(store: OperationStore, options: ConvergeServerOptions = {}): ConvergeServer {
  const metrics = new MetricsRegistry();
  const staticRoot = resolve(options.staticDirectory ?? "./dist");
  const socketsByBoard = new Map<string, Set<WebSocket>>();

  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/metrics") {
        response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        response.end(metrics.render());
        return;
      }

      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const requested = resolve(staticRoot, pathname === "/" ? "index.html" : `.${pathname}`);
      if (requested !== staticRoot && !requested.startsWith(`${staticRoot}${sep}`)) {
        response.writeHead(400).end();
        return;
      }
      try {
        const body = await readFile(requested);
        response.writeHead(200, { "content-type": MIME_TYPES[extname(requested)] ?? "application/octet-stream" });
        response.end(body);
      } catch {
        if (!extname(pathname)) {
          try {
            const body = await readFile(resolve(staticRoot, "index.html"));
            response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
            response.end(body);
            return;
          } catch {
            // In development Vite serves the web client separately, so a missing build is expected.
          }
        }
        response.writeHead(404).end();
      }
    })().catch(() => response.writeHead(500).end());
  });

  const wss = new WebSocketServer({ server, maxPayload: LIMITS.messageBytes });

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(1013, "Client is not keeping up");
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function fail(socket: WebSocket, message: string): void {
    metrics.rejectedMessages += 1;
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
    metrics.activeConnections += 1;
    const subscriptions = new Set<string>();
    const limiter = new TokenBucket(400, 200);

    socket.on("message", (raw) => {
      void (async () => {
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
          if (!limiter.take(1) || !Number.isSafeInteger(message.cursor) || message.cursor < 0) {
            fail(socket, "Join request is invalid or rate limited.");
            return;
          }
          subscribe(socket, message.boardId);
          subscriptions.add(message.boardId);
          const [operations, cursor] = await Promise.all([
            store.since(message.boardId, message.cursor),
            store.latestCursor(message.boardId),
          ]);
          metrics.replayedOperations += operations.length;
          send(socket, { type: "sync", boardId: message.boardId, cursor, operations });
          return;
        }

        if (message.type !== "operations" || !Array.isArray(message.operations)) {
          fail(socket, "Unknown message type.");
          return;
        }
        if (
          !limiter.take(Math.max(1, message.operations.length)) ||
          message.operations.length > LIMITS.operationsPerMessage ||
          !message.operations.every(isValidOperation)
        ) {
          fail(socket, "Operation batch is invalid, too large, or rate limited.");
          return;
        }

        const started = performance.now();
        const accepted = await store.append(message.boardId, message.operations);
        metrics.observeBatchLatency(performance.now() - started);
        metrics.acceptedOperations += accepted.length;
        metrics.duplicateOperations += message.operations.length - accepted.length;

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
            cursor: await store.latestCursor(message.boardId),
            operations: [],
          });
        }
      })().catch(() => fail(socket, "The sync service could not process this message."));
    });

    socket.on("close", () => {
      metrics.activeConnections -= 1;
      for (const boardId of subscriptions) {
        const sockets = socketsByBoard.get(boardId);
        sockets?.delete(socket);
        if (sockets?.size === 0) socketsByBoard.delete(boardId);
      }
    });
  });

  return {
    server,
    metrics,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolveListen(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close() {
      for (const socket of wss.clients) socket.terminate();
      return new Promise((resolveClose, reject) => {
        wss.close(() => server.close((error) => error ? reject(error) : resolveClose()));
      });
    },
  };
}
