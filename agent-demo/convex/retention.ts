import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
export const clean = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    let more = false;
    const logs = await ctx.db
      .query("logs")
      .withIndex("by_time", (q) => q.lt("timestamp", cutoff))
      .take(200);
    for (const row of logs) await ctx.db.delete(row._id);
    more ||= logs.length === 200;
    const receipts = await ctx.db
      .query("receipts")
      .withIndex("by_time", (q) =>
        q.lt("receivedAt", Date.now() - 2 * 24 * 3600_000),
      )
      .take(200);
    for (const row of receipts) await ctx.db.delete(row._id);
    if (more || receipts.length === 200)
      await ctx.scheduler.runAfter(1000, internal.retention.clean, {});
  },
});
