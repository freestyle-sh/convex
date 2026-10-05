"use node";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { openCredential } from "./credentials";
import { createScopedKey, type CredentialKind } from "./platform";

export async function acquireCredential(
  ctx: ActionCtx,
  project: Doc<"projects">,
  kind: CredentialKind,
  proposalId?: Id<"proposals">,
  requestIndex?: number,
) {
  const name = `convex-monitor-tool-${crypto.randomUUID()}`;
  const expiresAt = Date.now() + 31 * 60_000;
  const { leaseId, connection } = await ctx.runMutation(
    internal.connectionStore.startLease,
    {
      projectId: project._id,
      policyVersion: project.policyVersion,
      name,
      kind,
      expiresAt,
      proposalId,
      requestIndex,
    },
  );
  try {
    const secret = openCredential(
      connection.encryptedToken!,
      connection.binding,
    );
    const key = await createScopedKey(
      secret,
      connection.deploymentName,
      name,
      kind,
      expiresAt,
    );
    await ctx.runMutation(internal.connectionStore.activateLease, {
      leaseId,
      policyVersion: project.policyVersion,
    });
    return { key, leaseId, name };
  } catch (error) {
    await ctx.runAction(internal.connections.cleanupLease, { leaseId });
    throw error;
  }
}
