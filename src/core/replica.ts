import { compareTimestamps, observe, tick, ZERO_TIMESTAMP } from "./clock.js";
import type {
  ActorId,
  BoardOperation,
  CardId,
  CardPatch,
  CardValue,
  HybridTimestamp,
  LwwRegister,
  MaterializedCard,
} from "./types.js";

type CardRegisters = { [K in keyof CardValue]: LwwRegister<CardValue[K]> };

const DEFAULT_CARD: CardValue = {
  title: "Untitled",
  column: "backlog",
  rank: 0,
  deleted: false,
};

function register<T>(value: T): LwwRegister<T> {
  return { value, timestamp: ZERO_TIMESTAMP, operationId: "" };
}

function shouldReplace(
  current: Pick<LwwRegister<unknown>, "timestamp" | "operationId">,
  operation: BoardOperation,
): boolean {
  const timestampOrder = compareTimestamps(operation.timestamp, current.timestamp);
  return timestampOrder > 0 || (timestampOrder === 0 && operation.id > current.operationId);
}

function blankCard(): CardRegisters {
  return {
    title: register(DEFAULT_CARD.title),
    column: register(DEFAULT_CARD.column),
    rank: register(DEFAULT_CARD.rank),
    deleted: register(DEFAULT_CARD.deleted),
  };
}

export class BoardReplica {
  private readonly cards = new Map<CardId, CardRegisters>();
  private readonly seen = new Set<string>();
  private readonly operationLog: BoardOperation[] = [];
  private sequence = 0;
  private clock: HybridTimestamp;

  constructor(readonly actor: ActorId, operations: BoardOperation[] = []) {
    this.clock = { ...ZERO_TIMESTAMP, actor };
    this.applyMany(operations);
    this.sequence = Math.max(
      0,
      ...operations.filter((op) => op.actor === actor).map((op) => op.sequence),
    );
  }

  createCard(title: string, now = Date.now()): BoardOperation {
    const cardId = crypto.randomUUID();
    const rank = this.visibleCards().filter((card) => card.column === "backlog").length;
    return this.change(cardId, { title: title.trim(), column: "backlog", rank, deleted: false }, now);
  }

  change(cardId: CardId, patch: CardPatch, now = Date.now()): BoardOperation {
    this.sequence += 1;
    this.clock = tick(this.clock, this.actor, now);
    const operation: BoardOperation = {
      id: `${this.actor}:${this.sequence}`,
      actor: this.actor,
      sequence: this.sequence,
      timestamp: this.clock,
      cardId,
      patch,
    };
    this.apply(operation);
    return operation;
  }

  apply(operation: BoardOperation): boolean {
    if (this.seen.has(operation.id)) return false;

    this.seen.add(operation.id);
    this.operationLog.push(operation);
    this.clock = observe(this.clock, operation.timestamp, this.actor);
    const card = this.cards.get(operation.cardId) ?? blankCard();

    for (const key of Object.keys(operation.patch) as (keyof CardValue)[]) {
      const value = operation.patch[key];
      if (value === undefined) continue;
      const current = card[key];
      if (shouldReplace(current, operation)) {
        // The assignment is safe because key and value originate from the same CardPatch field.
        (card[key] as LwwRegister<typeof value>).value = value;
        card[key].timestamp = operation.timestamp;
        card[key].operationId = operation.id;
      }
    }

    this.cards.set(operation.cardId, card);
    return true;
  }

  applyMany(operations: BoardOperation[]): number {
    return operations.reduce((applied, operation) => applied + Number(this.apply(operation)), 0);
  }

  visibleCards(): MaterializedCard[] {
    return [...this.cards.entries()]
      .map(([id, card]) => ({
        id,
        title: card.title.value,
        column: card.column.value,
        rank: card.rank.value,
        deleted: card.deleted.value,
      }))
      .filter((card) => !card.deleted)
      .sort((a, b) => a.column.localeCompare(b.column) || a.rank - b.rank || a.id.localeCompare(b.id));
  }

  history(): BoardOperation[] {
    return structuredClone(this.operationLog);
  }

  hasSeen(operationId: string): boolean {
    return this.seen.has(operationId);
  }
}
