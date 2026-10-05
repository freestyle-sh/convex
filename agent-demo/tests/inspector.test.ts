import { describe, expect, it } from "vitest";
import { inspectorCells } from "../src/inspector";
import type { Message, ToolStep } from "../src/types";

const cell = (id: string, status = "ok"): ToolStep => ({
  id,
  name: "notebook",
  state: "output-available",
  output: {
    status,
    executionCount: 1,
    stdout: "",
    stderr: "",
    text: "",
    charts: [],
    tables: [{ title: id, columns: ["Count"], rows: [[1]] }],
    chartWarnings: [],
    outputTruncated: false,
    kernelReset: false,
    durationMs: 10,
  },
});
const answer = (key: string, tools: ToolStep[]): Message => ({
  key,
  role: "assistant",
  text: "Result",
  tools,
});

describe("investigation inspector", () => {
  it("counts unique executed cells, excluding duplicate and waiting-for-approval receipts", () => {
    const cells = inspectorCells([
      answer("a1", [
        cell("same"),
        cell("bad", "error"),
        cell("timeout", "timeout"),
        cell("approval", "awaiting_approval"),
        cell("duplicate", "duplicate"),
      ]),
      answer("a2", [
        cell("same"),
        { ...cell("transport"), state: "output-error", output: undefined },
        {
          id: "permission",
          name: "requestPermissions",
          state: "output-available",
        },
      ]),
    ]);
    expect(cells).toEqual({ total: 4, failed: 3 });
  });
});
