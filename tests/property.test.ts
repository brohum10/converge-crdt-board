import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BoardReplica } from "../src/core/replica";
import type { BoardOperation, CardPatch, ColumnId } from "../src/core/types";

const generatedEdit = fc.record({
  actorIndex: fc.integer({ min: 0, max: 4 }),
  cardIndex: fc.integer({ min: 0, max: 8 }),
  wallTime: fc.integer({ min: 1, max: 50 }),
  logical: fc.integer({ min: 0, max: 4 }),
  field: fc.constantFrom("title", "column", "deleted"),
  value: fc.integer({ min: 0, max: 100 }),
});

describe("CRDT convergence property", () => {
  it("converges for generated concurrent histories and delivery orders", () => {
    fc.assert(
      fc.property(fc.array(generatedEdit, { minLength: 1, maxLength: 80 }), (edits) => {
        const sequences = new Map<string, number>();
        const operations: BoardOperation[] = edits.map((edit) => {
          const actor = `actor-${edit.actorIndex}`;
          const sequence = (sequences.get(actor) ?? 0) + 1;
          sequences.set(actor, sequence);
          let patch: CardPatch;
          if (edit.field === "title") patch = { title: `Title ${edit.value}` };
          else if (edit.field === "column") patch = { column: (["backlog", "progress", "done"] as ColumnId[])[edit.value % 3] };
          else patch = { deleted: edit.value % 2 === 0 };
          return {
            id: `${actor}:${sequence}`,
            actor,
            sequence,
            timestamp: { wallTime: edit.wallTime, logical: edit.logical, actor },
            cardId: `card-${edit.cardIndex}`,
            patch,
          };
        });

        const forward = new BoardReplica("forward", operations);
        const reverse = new BoardReplica("reverse", [...operations].reverse());
        const midpoint = Math.floor(operations.length / 2);
        const rotated = new BoardReplica("rotated", [...operations.slice(midpoint), ...operations.slice(0, midpoint)]);

        expect(reverse.visibleCards()).toEqual(forward.visibleCards());
        expect(rotated.visibleCards()).toEqual(forward.visibleCards());
      }),
      { numRuns: 200 },
    );
  });
});
