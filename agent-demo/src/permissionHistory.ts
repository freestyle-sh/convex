import type { NetworkOperation } from "../convex/lib/notebookAccess";
import type { Proposal } from "./types";

function parsedJson(text?: string): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function permissionOperations(proposal: Proposal): NetworkOperation[] {
  return (
    proposal.notebook?.requests ?? [
      {
        kind: proposal.kind ?? "mutation",
        functionPath: proposal.functionPath,
        argsJson: proposal.argsJson,
      },
    ]
  );
}

export function permissionOperationTitle(operation: NetworkOperation): string {
  switch (operation.kind) {
    case "functions":
      return "Function discovery";
    case "tables":
      return "Table discovery";
    case "logs":
      return "Deployment logs";
    case "inlineQuery":
      return "Read-only query";
    case "query":
      return `Query · ${operation.functionPath}`;
    case "mutation":
      return `Mutation · ${operation.functionPath}`;
    case "action":
      return `Action · ${operation.functionPath}`;
    case "documentPatch": {
      const args = record(parsedJson(operation.argsJson));
      return typeof args?.table === "string"
        ? `Edit ${args.table}`
        : "Document edit";
    }
  }
}

export function permissionHistoryOutcome(proposal: Proposal): string {
  if (proposal.state === "rejected") return "Request declined";
  if (proposal.state !== "executed") return "Completion was not confirmed";
  if (proposal.notebook) return "Python cell finished";

  const result = record(parsedJson(proposal.result));
  // A stored execution status alone does not describe an arbitrary raw result.
  if (!result) return "Operation completed";
  if (proposal.kind === "logs" && Array.isArray(result.entries)) {
    const count = result.entries.length;
    return count === 0
      ? "No log entries returned"
      : `${count} log ${count === 1 ? "entry" : "entries"} returned`;
  }
  if (result.status !== "success") return "Operation completed";
  const value = result.value;
  if (proposal.kind === "documentPatch" && record(value)?.success === true) {
    const args = record(parsedJson(proposal.argsJson));
    const count = Array.isArray(args?.changes) ? args.changes.length : 0;
    return count
      ? `Updated ${count} ${count === 1 ? "field" : "fields"}`
      : "Document updated";
  }
  if (Array.isArray(value)) {
    const noun =
      proposal.kind === "functions"
        ? "function"
        : proposal.kind === "tables"
          ? "table"
          : "item";
    return value.length === 0
      ? `No ${noun}s returned`
      : `${value.length} ${noun}${value.length === 1 ? "" : "s"} returned`;
  }
  if (value === null) return "Completed without a return value";
  if (typeof value === "number" || typeof value === "boolean")
    return `Returned ${value}`;
  if (typeof value === "string")
    return value
      ? `Returned “${value.length > 100 ? `${value.slice(0, 100)}…` : value}”`
      : "Returned an empty string";
  const objectValue = record(value);
  if (objectValue) {
    const count = Object.keys(objectValue).length;
    return `Returned an object with ${count} ${count === 1 ? "field" : "fields"}`;
  }
  return "Operation completed";
}

export function permissionQueryCode(
  operation: NetworkOperation,
): string | undefined {
  if (operation.kind !== "inlineQuery") return undefined;
  const code = record(parsedJson(operation.argsJson))?.code;
  return typeof code === "string" ? code : undefined;
}
