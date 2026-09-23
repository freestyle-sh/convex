import { v } from "convex/values";

export const vmStateValidator = v.union(
  v.literal("starting"),
  v.literal("running"),
  v.literal("pausing"),
  v.literal("paused"),
  v.literal("stopped"),
);

export const vmSummaryValidator = v.object({
  id: v.string(),
  state: vmStateValidator,
  slug: v.optional(v.union(v.string(), v.null())),
  displayName: v.optional(v.union(v.string(), v.null())),
  resources: v.object({
    cpu: v.number(),
    memory: v.number(),
    storage: v.number(),
  }),
  snapshotId: v.optional(v.union(v.string(), v.null())),
  idleTimeoutSeconds: v.optional(v.union(v.number(), v.null())),
  createdAt: v.string(),
  updatedAt: v.string(),
});
