import { normalizeDocumentPatch } from "./documentPatch";
import { v } from "convex/values";
import { functionPath, parseArgs } from "./policy";

export const operationKind = v.union(
  v.literal("logs"),
  v.literal("query"),
  v.literal("mutation"),
  v.literal("action"),
  v.literal("functions"),
  v.literal("tables"),
  v.literal("inlineQuery"),
  v.literal("documentPatch"),
);
export type OperationKind =
  | "logs"
  | "query"
  | "mutation"
  | "action"
  | "functions"
  | "tables"
  | "inlineQuery"
  | "documentPatch";
export const operationActions: Record<OperationKind, string[]> = {
  documentPatch: ["deployment:data:write"],
  logs: ["deployment:logs:view"],
  query: ["deployment:functions:runInternalQueries"],
  mutation: ["deployment:functions:runInternalMutations"],
  action: ["deployment:functions:runInternalActions"],
  functions: ["deployment:data:view"],
  tables: ["deployment:data:view"],
  inlineQuery: ["deployment:functions:runTestQuery"],
};
export const operationLabels: Record<OperationKind, string> = {
  documentPatch: "Edit document fields",
  logs: "Read deployment logs",
  query: "Run query",
  mutation: "Run mutation",
  action: "Run action",
  functions: "Inspect available functions",
  tables: "List database tables",
  inlineQuery: "Run read-only data query",
};
export function normalizeOperation(
  kind: OperationKind,
  path: string,
  argsJson: string,
) {
  const args = parseArgs(argsJson);
  if (kind === "documentPatch") {
    const patch = normalizeDocumentPatch(args);
    return {
      kind,
      functionPath: `${patch.table} / ${patch.id}`,
      argsJson: JSON.stringify(patch),
    };
  }
  if (kind === "tables") {
    if (
      Object.keys(args).some((key) => key !== "cursor") ||
      (args.cursor !== undefined &&
        args.cursor !== null &&
        (typeof args.cursor !== "string" || args.cursor.length > 4096))
    )
      throw new Error(
        "Table discovery accepts only an optional pagination cursor.",
      );
    return {
      kind,
      functionPath: "Database tables",
      argsJson: JSON.stringify({ cursor: args.cursor ?? null }),
    };
  }
  if (kind === "inlineQuery") {
    if (
      Object.keys(args).length !== 1 ||
      typeof args.code !== "string" ||
      !args.code.trim() ||
      args.code.length > 12000
    )
      throw new Error(
        "Provide a read-only query body in code, up to 12,000 characters.",
      );
    return {
      kind,
      functionPath: "Read-only data query",
      argsJson: JSON.stringify({ code: args.code }),
    };
  }
  if (kind === "logs") {
    if (
      Object.keys(args).some((k) => k !== "cursor") ||
      typeof args.cursor !== "number" ||
      !Number.isFinite(args.cursor) ||
      args.cursor < 0
    )
      throw new Error("Log access needs a valid cursor.");
    return {
      kind,
      functionPath: "Deployment logs",
      argsJson: JSON.stringify(args),
    };
  }
  if (kind === "functions") {
    if (Object.keys(args).length)
      throw new Error("Function inspection takes no arguments.");
    return { kind, functionPath: "Function definitions", argsJson: "{}" };
  }
  return {
    kind,
    functionPath: functionPath(path),
    argsJson: JSON.stringify(args),
  };
}
export function isWrite(kind: OperationKind) {
  return kind === "mutation" || kind === "action" || kind === "documentPatch";
}

export function isReadOnly(kind: OperationKind) {
  return (
    kind === "logs" ||
    kind === "functions" ||
    kind === "tables" ||
    kind === "query" ||
    kind === "inlineQuery"
  );
}
