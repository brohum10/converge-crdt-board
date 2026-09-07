export type ActorId = string;
export type CardId = string;
export type ColumnId = "backlog" | "progress" | "done";

export interface HybridTimestamp {
  wallTime: number;
  logical: number;
  actor: ActorId;
}

export interface CardValue {
  title: string;
  column: ColumnId;
  rank: number;
  deleted: boolean;
}

export type CardPatch = Partial<CardValue>;

export interface BoardOperation {
  id: string;
  actor: ActorId;
  sequence: number;
  timestamp: HybridTimestamp;
  cardId: CardId;
  patch: CardPatch;
}

export interface LwwRegister<T> {
  value: T;
  timestamp: HybridTimestamp;
  operationId: string;
}

export interface MaterializedCard extends CardValue {
  id: CardId;
}

export interface SequencedOperation {
  cursor: number;
  operation: BoardOperation;
}

export type ClientMessage =
  | { type: "join"; boardId: string; cursor: number }
  | { type: "operations"; boardId: string; operations: BoardOperation[] };

export type ServerMessage =
  | { type: "sync"; boardId: string; cursor: number; operations: SequencedOperation[] }
  | { type: "operations"; boardId: string; cursor: number; operations: SequencedOperation[] }
  | { type: "error"; message: string };
