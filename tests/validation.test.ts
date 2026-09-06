import { describe, expect, it } from "vitest";
import { isValidBoardId, isValidOperation } from "../src/core/validation";

const valid = {
  id: "actor:1",
  actor: "actor",
  sequence: 1,
  timestamp: { wallTime: 100, logical: 0, actor: "actor" },
  cardId: "card-1",
  patch: { title: "Safe input" },
};

describe("protocol validation", () => {
  it("allows URL-safe board identifiers", () => expect(isValidBoardId("team_board-7")).toBe(true));
  it("rejects path-like board identifiers", () => expect(isValidBoardId("../../data")).toBe(false));
  it("accepts a well-formed operation", () => expect(isValidOperation(valid)).toBe(true));
  it("rejects a timestamp whose actor is forged", () => expect(isValidOperation({ ...valid, timestamp: { ...valid.timestamp, actor: "other" } })).toBe(false));
  it("rejects an operation ID that does not match its actor sequence", () => expect(isValidOperation({ ...valid, id: "someone-else:9" })).toBe(false));
  it("rejects unknown patch keys", () => expect(isValidOperation({ ...valid, patch: { ownerPassword: "secret" } })).toBe(false));
  it("rejects unbounded titles", () => expect(isValidOperation({ ...valid, patch: { title: "x".repeat(241) } })).toBe(false));
});
