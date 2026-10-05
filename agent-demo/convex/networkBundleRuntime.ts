"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { operationKind, isReadOnly } from "./lib/operations";
import { prepareReadBundle, readKinds } from "./lib/preparedNetwork";
import {
  cleanupResources as resourcesValidator,
  deleteNetworkResources,
  type NetworkResources,
} from "./lib/networkCleanup";

export const warm = internalAction({
  args: { runId: v.id("runs"), kinds: v.optional(v.array(operationKind)) },
  handler: async (ctx, { runId, kinds }): Promise<void> => {
    const context = await ctx.runQuery(internal.networkBundles.forRun, {
      runId,
    });
    if (!context) return;
    const results = await Promise.allSettled(
      (kinds ?? readKinds)
        .filter(isReadOnly)
        .map((kind) =>
          prepareReadBundle(ctx, context.project, context.notebook._id, kind),
        ),
    );
    if (results.some((r) => r.status === "rejected"))
      console.warn(
        "NETWORK_WARM_PARTIAL: a read slot was not prepared; on-demand setup remains available.",
      );
  },
});

export const cleanupResources = internalAction({
  args: { resources: resourcesValidator, attempt: v.optional(v.number()) },
  handler: async (ctx, { resources, attempt = 0 }): Promise<void> => {
    let complete = false;
    try {
      complete = await deleteNetworkResources(ctx, resources);
    } catch {
      /* Retry without logging provider credentials. */
    }
    if (!complete)
      await ctx.scheduler.runAfter(
        Math.min(300_000, 5000 * 2 ** Math.min(attempt, 6)),
        internal.networkBundleRuntime.cleanupResources,
        { resources, attempt: attempt + 1 },
      );
  },
});

export const cleanup = internalAction({
  args: { bundleId: v.id("networkBundles"), attempt: v.optional(v.number()) },
  handler: async (ctx, { bundleId, attempt = 0 }): Promise<void> => {
    const bundle = await ctx.runQuery(internal.networkBundles.get, {
      bundleId,
    });
    if (!bundle || bundle.state === "closed") return;
    // Close reservations first so an expiring bundle cannot be claimed while
    // the external deletion requests are in flight.
    await ctx.runMutation(internal.networkBundles.markClosing, { bundleId });
    const resources: NetworkResources = {
      projectId: bundle.projectId,
      routeIds: bundle.routeIds,
      leaseIds: bundle.leaseId ? [bundle.leaseId] : [],
      relays: [
        {
          slug: bundle.slug,
          ...(bundle.sandboxId ? { sandboxId: bundle.sandboxId } : {}),
        },
      ],
    };
    let complete = false;
    try {
      complete = await deleteNetworkResources(ctx, resources);
    } catch {
      /* Retry below. */
    }
    if (complete)
      await ctx.runMutation(internal.networkBundles.closed, { bundleId });
    else
      await ctx.scheduler.runAfter(
        Math.min(300_000, 5000 * 2 ** Math.min(attempt, 6)),
        internal.networkBundleRuntime.cleanup,
        { bundleId, attempt: attempt + 1 },
      );
  },
});
