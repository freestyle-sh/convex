import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requirePermission } from "./lib/policy";

const logEvent = v.object({
  eventId: v.string(),
  timestamp: v.number(),
  level: v.string(),
  functionPath: v.string(),
  message: v.string(),
  source: v.string(),
});
export const ingest = internalMutation({
  args: {
    projectId: v.id("projects"),
    events: v.array(logEvent),
    cursor: v.optional(v.number()),
    receipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found.");
    requirePermission(project, "readLogs");
    if (args.receipt) {
      if (
        await ctx.db
          .query("receipts")
          .withIndex("by_digest", (q) =>
            q.eq("projectId", project._id).eq("digest", args.receipt!),
          )
          .unique()
      )
        return 0;
      await ctx.db.insert("receipts", {
        projectId: project._id,
        digest: args.receipt,
        receivedAt: Date.now(),
      });
    }
    let count = 0;
    for (const event of args.events) {
      const existing = await ctx.db
        .query("logs")
        .withIndex("by_project_event", (q) =>
          q.eq("projectId", project._id).eq("eventId", event.eventId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("logs", { ...event, projectId: project._id });
        count++;
      }
    }
    if (args.cursor !== undefined)
      await ctx.db.patch(project._id, {
        cursor: Math.max(project.cursor, args.cursor),
      });
    if (args.receipt) {
      await ctx.db.patch(project._id, { lastWebhookAt: Date.now() });
    }
    return count;
  },
});
export const recentLogs = internalQuery({
  args: { projectId: v.id("projects") },
  handler: (ctx, { projectId }) =>
    ctx.db
      .query("logs")
      .withIndex("by_project_time", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(100),
});
export const finding = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("runs"),
    fingerprint: v.string(),
    title: v.string(),
    detail: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    evidence: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run?.state !== "running" || run.projectId !== args.projectId)
      throw new Error("Investigation is no longer active.");
    const existing = await ctx.db
      .query("findings")
      .withIndex("by_fingerprint", (q) =>
        q.eq("projectId", args.projectId).eq("fingerprint", args.fingerprint),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        occurrences: existing.occurrences + 1,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert("findings", {
      ...args,
      occurrences: 1,
      updatedAt: Date.now(),
    });
  },
});
export const createSandbox = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    slug: v.string(),
    purpose: v.string(),
    credentialRef: v.string(),
    endpoint: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    ctx.db.insert("sandboxes", { ...args, state: "provisioning" }),
});
export const sandboxState = internalMutation({
  args: {
    sandboxId: v.id("sandboxes"),
    state: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("cleanup_pending"),
    ),
  },
  handler: (ctx, { sandboxId, state }) => ctx.db.patch(sandboxId, { state }),
});
