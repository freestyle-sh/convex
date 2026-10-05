"use node";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { normalizeDocumentPatch, unchangedFields } from "./lib/documentPatch";
import { isWrite } from "./lib/operations";
import { validateApproval } from "./lib/policy";
import { executeGrant } from "./lib/sandbox";
import { redact } from "./lib/events";
import { parseArgs } from "./lib/policy";
import type { Grant } from "./lib/sandbox";

export const approvedMutation = internalAction({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, { proposalId }) => {
    let mayWrite = false;
    try {
      const context = await ctx.runMutation(internal.approvals.claimExecution, {
        proposalId,
      });
      if (!context) return;
      const { project, proposal } = context;
      if (proposal.notebook)
        throw new Error("Notebook approvals execute through the chat queue.");
      validateApproval(project, { ...proposal, state: "pending" }, Date.now());
      const kind = proposal.kind ?? "mutation";
      if (kind === "documentPatch") {
        const patch = normalizeDocumentPatch(parseArgs(proposal.argsJson));
        const checked = (await executeGrant(
          ctx,
          project,
          {
            kind: "inlineQuery",
            argsJson: JSON.stringify({
              code: `const id = ctx.db.normalizeId(${JSON.stringify(patch.table)}, ${JSON.stringify(patch.id)}); return id ? await ctx.db.get(id) : null;`,
            }),
          },
          proposal.runId,
        )) as { status?: string; value?: unknown };
        if (
          checked?.status !== "success" ||
          !unchangedFields(patch, checked.value)
        ) {
          await ctx.runMutation(internal.approvals.complete, {
            proposalId,
            state: "uncertain",
            result:
              "No write attempted. The document is missing, changed since your review, or could not be checked. Reload it before editing again.",
          });
          return;
        }
      }
      mayWrite = isWrite(kind);
      const grant: Grant =
        kind === "logs"
          ? { kind, cursor: parseArgs(proposal.argsJson).cursor as number }
          : kind === "functions"
            ? { kind }
            : kind === "inlineQuery" || kind === "documentPatch"
              ? { kind, argsJson: proposal.argsJson }
              : {
                  kind,
                  functionPath: proposal.functionPath,
                  argsJson: proposal.argsJson,
                };
      const result = await executeGrant(
        ctx,
        project,
        grant,
        proposal.runId,
        proposalId,
      );
      if (
        !result ||
        typeof result !== "object" ||
        (kind === "logs"
          ? !Array.isArray((result as { entries?: unknown }).entries)
          : (result as { status?: string }).status !== "success")
      )
        throw new ConvexError(
          "Convex rejected the operation: " +
            redact(
              String(
                (result as { errorMessage?: unknown })?.errorMessage ??
                  "No successful result returned.",
              ),
            ).slice(0, 1500),
        );
      if (
        kind === "documentPatch" &&
        (result as { value?: { success?: boolean } }).value?.success !== true
      )
        throw new ConvexError(
          "Convex rejected the operation: document change was not confirmed.",
        );
      await ctx.runMutation(internal.approvals.complete, {
        proposalId,
        state: "executed",
        result: redact(JSON.stringify(result)),
      });
    } catch (error) {
      const diagnostic =
        error instanceof ConvexError && typeof error.data === "string"
          ? error.data
          : error instanceof Error
            ? error.message
            : "";
      const safeDiagnostic =
        /^(This token lacks permission|Convex rejected|Reconnect this project|The project connection|Permissions changed|Proposal expired|Project access is paused|Sandbox failed while|[a-z]+ sandbox failed\.|The operation differs|This operation has no active user approval)/.test(
          diagnostic,
        )
          ? diagnostic
          : "";
      await ctx.runMutation(internal.approvals.complete, {
        proposalId,
        state: "uncertain",
        result:
          (mayWrite
            ? "The operation did not report success. Verify the target before another attempt; it may have changed data or called external services. No automatic retry was scheduled."
            : "The read did not report success. No automatic retry was scheduled.") +
          (safeDiagnostic ? " " + safeDiagnostic : ""),
      });
    }
  },
});
