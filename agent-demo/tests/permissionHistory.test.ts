import { describe, expect, it } from "vitest";
import {
  permissionHistoryOutcome,
  permissionOperationTitle,
} from "../src/permissionHistory";
import type { Proposal } from "../src/types";

const proposal: Proposal = {
  _id: "history-test",
  functionPath: "Read-only data query",
  kind: "inlineQuery",
  argsJson: '{"code":"return 1;"}',
  reason: "Check query access",
  state: "executed",
  expiresAt: 0,
  policyVersion: 1,
};

describe("permission history outcomes", () => {
  it("shows scalar results including zero and false without losing them", () => {
    for (const value of [1, 0, false]) {
      expect(
        permissionHistoryOutcome({
          ...proposal,
          result: JSON.stringify({ status: "success", value }),
        }),
      ).toBe(`Returned ${value}`);
    }
  });

  it("describes returned discovery evidence without claiming the project is empty", () => {
    expect(
      permissionHistoryOutcome({
        ...proposal,
        kind: "functions",
        result: '{"status":"success","value":[]}',
      }),
    ).toBe("No functions returned");
    expect(
      permissionHistoryOutcome({
        ...proposal,
        kind: "tables",
        result: '{"status":"success","value":["orders"]}',
      }),
    ).toBe("1 table returned");
  });

  it("never presents declined or uncertain writes as successful from their result", () => {
    const result = '{"status":"success","value":{"success":true}}';
    expect(
      permissionHistoryOutcome({
        ...proposal,
        kind: "documentPatch",
        state: "uncertain",
        result,
      }),
    ).toBe("Completion was not confirmed");
    expect(
      permissionHistoryOutcome({
        ...proposal,
        kind: "documentPatch",
        state: "rejected",
        result,
      }),
    ).toBe("Request declined");
  });

  it("handles truncated legacy responses without making up a result", () => {
    expect(
      permissionHistoryOutcome({
        ...proposal,
        result: '{"status":"success","value": [Result truncated]',
      }),
    ).toBe("Operation completed");
  });

  it("only confirms document fields when the returned value confirms the edit", () => {
    const edit: Proposal = {
      ...proposal,
      kind: "documentPatch",
      argsJson: '{"table":"orders","changes":[{},{}]}',
    };
    expect(
      permissionOperationTitle({
        kind: "documentPatch",
        functionPath: "orders / id",
        argsJson: edit.argsJson,
      }),
    ).toBe("Edit orders");
    expect(
      permissionHistoryOutcome({
        ...edit,
        result: '{"status":"success","value":{"success":true}}',
      }),
    ).toBe("Updated 2 fields");
    expect(
      permissionHistoryOutcome({
        ...edit,
        state: "uncertain",
        result: "No write attempted. The document changed.",
      }),
    ).toBe("Completion was not confirmed");
  });

  it("does not treat arbitrary notebook output as a direct Convex response", () => {
    const notebook = { requests: [], code: "print(1)", timeoutMs: 30000 };
    expect(
      permissionHistoryOutcome({
        ...proposal,
        notebook,
        result: '{"status":"ok","stdout":"1"}',
      }),
    ).toBe("Python cell finished");
    expect(
      permissionHistoryOutcome({ ...proposal, notebook, state: "uncertain" }),
    ).toBe("Completion was not confirmed");
  });
});
