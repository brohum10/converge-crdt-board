import { describe, expect, it } from "vitest";
import { compareTimestamps, observe, tick } from "../src/core/clock";

describe("hybrid logical clock", () => {
  it("advances physical time when the wall clock moves", () => {
    expect(tick({ wallTime: 10, logical: 4, actor: "a" }, "a", 20)).toEqual({ wallTime: 20, logical: 0, actor: "a" });
  });

  it("increments logical time when the wall clock stalls", () => {
    expect(tick({ wallTime: 20, logical: 4, actor: "a" }, "a", 20).logical).toBe(5);
  });

  it("never moves backward with a skewed clock", () => {
    expect(tick({ wallTime: 20, logical: 4, actor: "a" }, "a", 3)).toMatchObject({ wallTime: 20, logical: 5 });
  });

  it("observes a future remote event", () => {
    const result = observe(
      { wallTime: 10, logical: 0, actor: "a" },
      { wallTime: 30, logical: 7, actor: "b" },
      "a",
      20,
    );
    expect(result).toEqual({ wallTime: 30, logical: 8, actor: "a" });
  });

  it("uses actor id as a deterministic final tie-break", () => {
    const a = { wallTime: 20, logical: 2, actor: "a" };
    const b = { wallTime: 20, logical: 2, actor: "b" };
    expect(compareTimestamps(a, b)).toBeLessThan(0);
  });
});
