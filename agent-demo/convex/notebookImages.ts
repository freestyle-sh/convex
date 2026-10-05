import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("notebookImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.state === "ready" ? row.snapshotId : null;
  },
});

export const reserve = internalMutation({
  args: { key: v.string(), lock: v.string() },
  handler: async (ctx, { key, lock }) => {
    const row = await ctx.db
      .query("notebookImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      row?.state === "ready" ||
      (row?.state === "building" && row.lockedUntil > Date.now())
    )
      return false;
    const fields = {
      key,
      lock,
      state: "building" as const,
      lockedUntil: Date.now() + 10 * 60_000,
      snapshotId: undefined,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("notebookImages", fields);
    return true;
  },
});

export const publish = internalMutation({
  args: { key: v.string(), lock: v.string(), snapshotId: v.string() },
  handler: async (ctx, { key, lock, snapshotId }) => {
    const row = await ctx.db
      .query("notebookImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (
      !row ||
      row.state !== "building" ||
      row.lock !== lock ||
      row.lockedUntil <= Date.now()
    )
      return false;
    await ctx.db.patch(row._id, { state: "ready", lockedUntil: 0, snapshotId });
    return true;
  },
});

export const abandon = internalMutation({
  args: { key: v.string(), lock: v.string() },
  handler: async (ctx, { key, lock }) => {
    const row = await ctx.db
      .query("notebookImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row?.state === "building" && row.lock === lock)
      await ctx.db.patch(row._id, { state: "failed", lockedUntil: 0 });
  },
});

export const invalidate = internalMutation({
  args: { key: v.string(), snapshotId: v.string() },
  handler: async (ctx, { key, snapshotId }) => {
    const row = await ctx.db
      .query("notebookImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row?.snapshotId === snapshotId)
      await ctx.db.patch(row._id, {
        state: "failed",
        lockedUntil: 0,
        snapshotId: undefined,
      });
  },
});
