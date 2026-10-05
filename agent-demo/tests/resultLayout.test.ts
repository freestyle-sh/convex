import { describe, expect, it } from "vitest";
import {
  defaultResultLayout,
  moveResult,
  orderedResults,
  readResultLayout,
  toggleResult,
} from "../src/resultLayout";

describe("personal result layout", () => {
  it("retains the user's order as new streamed results arrive and old results are replaced", () => {
    expect(orderedResults(["b", "a", "old"], ["a", "b", "new"])).toEqual([
      "b",
      "a",
      "new",
    ]);
    expect(orderedResults(["a", "a"], ["a", "b"])).toEqual(["a", "b"]);
  });
  it("moves an individual panel in either direction without dropping siblings", () => {
    expect(moveResult(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveResult(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveResult(["a", "b"], "missing", "a")).toEqual(["a", "b"]);
    expect(moveResult(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
  it("round-trips layout preferences without storing chart or project data", () => {
    const layout = {
      mode: "stack",
      order: ["b", "a"],
      collapsed: ["a"],
      wide: ["b"],
    } as const;
    expect(readResultLayout(JSON.stringify(layout))).toEqual(layout);
    expect(
      readResultLayout(
        JSON.stringify({
          ...layout,
          records: [{ secret: "not a preference" }],
        }),
      ),
    ).toEqual(layout);
    expect(toggleResult(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleResult(["a", "b"], "a")).toEqual(["b"]);
  });
  it("recovers from malformed or oversized stored preferences", () => {
    expect(readResultLayout("broken")).toEqual(defaultResultLayout);
    expect(readResultLayout(null)).toEqual(defaultResultLayout);
    expect(
      readResultLayout(
        JSON.stringify({
          mode: "bad",
          order: [null, 4, "a", "a", "x".repeat(300)],
        }),
      ),
    ).toEqual({ ...defaultResultLayout, order: ["a"] });
    expect(
      readResultLayout(
        JSON.stringify({
          order: Array.from({ length: 200 }, (_, i) => String(i)),
        }),
      ).order,
    ).toHaveLength(100);
  });
});
