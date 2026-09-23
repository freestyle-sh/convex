import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import schema from "./schema.js";
import { vmSummaryValidator } from "./model.js";

const vmRecordValidator = schema.tables.vms.validator.extend({
  _creationTime: v.number(),
  _id: v.id("vms"),
});

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

export const get = query({
  args: { ownerId: v.string(), slug: v.string() },
  returns: v.union(vmRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vms")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();
  },
});

export const list = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(vmRecordValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 500));
    return await ctx.db
      .query("vms")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(limit);
  },
});

export const reserve = mutation({
  args: {
    managementToken: v.string(),
    ownerId: v.string(),
    slug: v.string(),
  },
  returns: vmRecordValidator,
  handler: async (ctx, args) => {
    requireText(args.ownerId, "ownerId");
    requireText(args.slug, "slug");

    const existing = await ctx.db
      .query("vms")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();
    if (existing) return existing;

    const recordId = await ctx.db.insert("vms", {
      managementToken: args.managementToken,
      ownerId: args.ownerId,
      phase: "provisioning",
      slug: args.slug,
      updatedAt: Date.now(),
    });
    const record = await ctx.db.get("vms", recordId);
    if (!record) throw new Error("Failed to reserve VM record");
    return record;
  },
});

export const completeCreate = mutation({
  args: {
    managementToken: v.string(),
    recordId: v.id("vms"),
    remote: vmSummaryValidator,
  },
  returns: vmRecordValidator,
  handler: async (ctx, args) => {
    const record = await ctx.db.get("vms", args.recordId);
    if (!record || record.managementToken !== args.managementToken) {
      throw new Error("The VM reservation is no longer current");
    }
    if (record.vmId && record.vmId !== args.remote.id) {
      throw new Error("The VM reservation is already linked to another VM");
    }

    await ctx.db.patch("vms", record._id, {
      lastError: undefined,
      phase: "ready",
      remote: args.remote,
      updatedAt: Date.now(),
      vmId: args.remote.id,
    });
    const updated = await ctx.db.get("vms", record._id);
    if (!updated) throw new Error("VM record disappeared while linking it");
    return updated;
  },
});

export const sync = mutation({
  args: {
    recordId: v.id("vms"),
    remote: vmSummaryValidator,
    vmId: v.string(),
  },
  returns: vmRecordValidator,
  handler: async (ctx, args) => {
    const record = await ctx.db.get("vms", args.recordId);
    if (!record || record.vmId !== args.vmId || args.remote.id !== args.vmId) {
      throw new Error("The managed VM link is no longer current");
    }
    await ctx.db.patch("vms", record._id, {
      lastError: undefined,
      phase: "ready",
      remote: args.remote,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("vms", record._id);
    if (!updated) throw new Error("VM record disappeared while syncing it");
    return updated;
  },
});

export const recordFailure = mutation({
  args: {
    error: v.string(),
    recordId: v.id("vms"),
    vmId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get("vms", args.recordId);
    if (!record) return null;
    if (args.vmId !== undefined && record.vmId !== args.vmId) return null;
    await ctx.db.patch("vms", record._id, {
      lastError: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { recordId: v.id("vms"), vmId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get("vms", args.recordId);
    if (!record) return null;
    if (record.vmId !== args.vmId) {
      throw new Error("The managed VM link is no longer current");
    }
    await ctx.db.delete("vms", record._id);
    return null;
  },
});
