"use node";
import { v, type Infer } from "convex/values";
import { Freestyle } from "@freestyle-sh/convex";
import { Freestyle as FreestyleSdk } from "freestyle";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { runtimeSettings } from "./runtimeSettings";

export const cleanupResources = v.object({
  projectId: v.id("projects"),
  routeIds: v.array(v.string()),
  leaseIds: v.array(v.id("credentialLeases")),
  relays: v.array(
    v.object({
      slug: v.string(),
      sandboxId: v.optional(v.id("sandboxes")),
    }),
  ),
});
export type NetworkResources = Infer<typeof cleanupResources>;

function alreadyDeleted(error: unknown) {
  const e = error as { status?: number; statusCode?: number };
  return e?.status === 404 || e?.statusCode === 404;
}

// Each job contains immutable resource IDs, never a pointer to the next spare.
// Lease revocation has its own durable retries and native expiration fallback.
export async function deleteNetworkResources(
  ctx: ActionCtx,
  resources: NetworkResources,
) {
  const project = await ctx.runQuery(internal.projects.getInternal, {
    projectId: resources.projectId,
  });
  if (!project) throw new Error("Network cleanup project unavailable.");
  const settings = await runtimeSettings(ctx, project);
  const sdk = new FreestyleSdk({ apiKey: settings.freestyleKey });
  const managed = new Freestyle(components.freestyle, {
    apiKey: settings.freestyleKey,
  });
  const results = await Promise.allSettled([
    ...resources.routeIds.map(async (id) => {
      try {
        await sdk.tls.rules.delete(id);
      } catch (e) {
        if (!alreadyDeleted(e)) throw e;
      }
    }),
    ...resources.relays.map(async (relay) => {
      let state: "revoked" | "cleanup_pending" = "cleanup_pending";
      try {
        try {
          await managed.delete(ctx, {
            ownerId: resources.projectId,
            slug: relay.slug,
          });
        } catch (e) {
          if (!alreadyDeleted(e)) throw e;
        }
        state = "revoked";
      } finally {
        if (relay.sandboxId)
          await ctx.runMutation(internal.records.sandboxState, {
            sandboxId: relay.sandboxId,
            state,
          });
      }
    }),
    ...resources.leaseIds.map((leaseId) =>
      ctx.runAction(internal.connections.cleanupLease, { leaseId }),
    ),
  ]);
  return results.every((result) => result.status === "fulfilled");
}
