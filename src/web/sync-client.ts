import { BoardReplica } from "../core/replica";
import type { BoardOperation, CardPatch, MaterializedCard, ServerMessage } from "../core/types";

export type ConnectionState = "connecting" | "online" | "offline";

interface StoredBoard {
  cursor: number;
  operations: BoardOperation[];
  pending: BoardOperation[];
}

export class SyncClient {
  readonly replica: BoardReplica;
  private cursor = 0;
  private pending = new Map<string, BoardOperation>();
  private socket?: WebSocket;
  private intentionallyOffline = false;
  private reconnectTimer?: number;
  private readonly storageKey: string;

  constructor(
    readonly boardId: string,
    readonly actorId: string,
    private readonly onChange: () => void,
    private readonly onStatus: (status: ConnectionState) => void,
  ) {
    this.storageKey = `converge:board:v1:${boardId}:${actorId}`;
    const stored = this.restore();
    this.cursor = stored.cursor;
    this.pending = new Map(stored.pending.map((operation) => [operation.id, operation]));
    this.replica = new BoardReplica(actorId, stored.operations);
  }

  connect(): void {
    this.intentionallyOffline = false;
    this.onStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = import.meta.env.VITE_SYNC_HOST ?? `${window.location.hostname}:8787`;
    this.socket = new WebSocket(`${protocol}://${host}`);
    this.socket.addEventListener("open", () => {
      this.onStatus("online");
      this.send({ type: "join", boardId: this.boardId, cursor: this.cursor });
      this.flush();
    });
    this.socket.addEventListener("message", (event) => this.receive(event.data));
    this.socket.addEventListener("close", () => {
      this.onStatus("offline");
      if (!this.intentionallyOffline) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
      }
    });
  }

  disconnect(): void {
    this.intentionallyOffline = true;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.onStatus("offline");
  }

  reconnect(): void {
    this.disconnect();
    this.intentionallyOffline = false;
    this.connect();
  }

  cards(): MaterializedCard[] {
    return this.replica.visibleCards();
  }

  create(title: string): void {
    if (!title.trim()) return;
    this.commit(this.replica.createCard(title));
  }

  change(cardId: string, patch: CardPatch): void {
    this.commit(this.replica.change(cardId, patch));
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private commit(operation: BoardOperation): void {
    this.pending.set(operation.id, operation);
    this.persist();
    this.onChange();
    this.flush();
  }

  private flush(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.pending.size === 0) return;
    this.send({ type: "operations", boardId: this.boardId, operations: [...this.pending.values()] });
  }

  private receive(raw: string): void {
    const message = JSON.parse(raw) as ServerMessage;
    if (message.type === "error") return;
    for (const entry of message.operations) {
      this.replica.apply(entry.operation);
      this.pending.delete(entry.operation.id);
      this.cursor = Math.max(this.cursor, entry.cursor);
    }
    this.cursor = Math.max(this.cursor, message.cursor);
    this.persist();
    this.onChange();
  }

  private send(message: object): void {
    this.socket?.send(JSON.stringify(message));
  }

  private restore(): StoredBoard {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) ?? "null") as StoredBoard | null;
      return stored ?? { cursor: 0, operations: [], pending: [] };
    } catch {
      return { cursor: 0, operations: [], pending: [] };
    }
  }

  private persist(): void {
    localStorage.setItem(
      this.storageKey,
      JSON.stringify({ cursor: this.cursor, operations: this.replica.history(), pending: [...this.pending.values()] }),
    );
  }
}
