import type { BoardOperation, CardPatch, ColumnId } from "./types.js";

export const LIMITS = {
  boardIdLength: 80,
  actorIdLength: 80,
  cardIdLength: 100,
  titleLength: 240,
  operationsPerMessage: 200,
  messageBytes: 256_000,
} as const;

const COLUMNS = new Set<ColumnId>(["backlog", "progress", "done"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validPatch(patch: unknown): patch is CardPatch {
  if (!isRecord(patch) || Object.keys(patch).length === 0) return false;
  const allowed = new Set(["title", "column", "rank", "deleted"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) return false;
  if (patch.title !== undefined && (typeof patch.title !== "string" || patch.title.length > LIMITS.titleLength)) return false;
  if (patch.column !== undefined && (!isSafeText(patch.column, 20) || !COLUMNS.has(patch.column as ColumnId))) return false;
  if (patch.rank !== undefined && (!Number.isSafeInteger(patch.rank) || Math.abs(patch.rank as number) > 1_000_000)) return false;
  if (patch.deleted !== undefined && typeof patch.deleted !== "boolean") return false;
  return true;
}

export function isValidBoardId(value: unknown): value is string {
  return isSafeText(value, LIMITS.boardIdLength) && /^[a-zA-Z0-9_-]+$/.test(value);
}

export function isValidOperation(value: unknown): value is BoardOperation {
  if (!isRecord(value) || !isRecord(value.timestamp)) return false;
  return (
    isSafeText(value.id, 170) &&
    isSafeText(value.actor, LIMITS.actorIdLength) &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    isSafeText(value.cardId, LIMITS.cardIdLength) &&
    value.id === `${value.actor}:${value.sequence}` &&
    Number.isSafeInteger(value.timestamp.wallTime) &&
    (value.timestamp.wallTime as number) >= 0 &&
    Number.isSafeInteger(value.timestamp.logical) &&
    (value.timestamp.logical as number) >= 0 &&
    value.timestamp.actor === value.actor &&
    validPatch(value.patch)
  );
}
