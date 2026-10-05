import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  activity: defineTable({
    operation: v.string(),
    sessionId: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("error")),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_session_created_at", ["sessionId", "createdAt"]),
  guard: defineTable({
    key: v.string(),
    lastOperationAt: v.number(),
  }).index("by_key", ["key"]),
});
