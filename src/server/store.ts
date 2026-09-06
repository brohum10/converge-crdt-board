import type { BoardOperation, SequencedOperation } from "../core/types.js";

export interface OperationStore {
  load(): Promise<void>;
  append(boardId: string, operations: BoardOperation[]): Promise<SequencedOperation[]>;
  since(boardId: string, cursor: number): Promise<SequencedOperation[]>;
  latestCursor(boardId: string): Promise<number>;
  close?(): Promise<void>;
}
