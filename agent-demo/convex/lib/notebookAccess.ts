import { z } from "zod";
import { v } from "convex/values";
import {
  normalizeOperation,
  operationActions,
  operationKind,
  isReadOnly,
  type OperationKind,
} from "./operations";
import { type Policy } from "./policy";

export const networkInput = z
  .array(
    z.object({
      kind: z.enum([
        "logs",
        "functions",
        "tables",
        "query",
        "inlineQuery",
        "documentPatch",
        "mutation",
        "action",
      ]),
      functionPath: z.string(),
      argsJson: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .transform((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .pipe(z.string().max(16000)),
    }),
  )
  .max(6);
export const notebookCell = v.object({
  updateArtifact: v.optional(v.boolean()),
  code: v.string(),
  timeoutMs: v.number(),
  requests: v.array(
    v.object({
      kind: operationKind,
      functionPath: v.string(),
      argsJson: v.string(),
    }),
  ),
});
export type NetworkOperation = {
  kind: OperationKind;
  functionPath: string;
  argsJson: string;
};
export function normalizeRequests(input: z.input<typeof networkInput>) {
  return networkInput
    .parse(input)
    .map((r) => normalizeOperation(r.kind, r.functionPath, r.argsJson));
}
export function requestActions(requests: NetworkOperation[]) {
  return [...new Set(requests.flatMap((r) => operationActions[r.kind]))].sort();
}
export function hasStandingAccess(project: Policy, request: NetworkOperation) {
  return project.enabled && isReadOnly(request.kind);
}
