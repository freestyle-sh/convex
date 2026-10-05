import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  demoCustomers: defineTable({
    fixture: v.string(),
    customerRef: v.string(),
    name: v.string(),
    email: v.string(),
    plan: v.string(),
    createdAt: v.number(),
  }).index("by_fixture", ["fixture"]),
  demoOrders: defineTable({
    fixture: v.string(),
    orderRef: v.string(),
    customerId: v.id("demoCustomers"),
    sku: v.string(),
    quantity: v.number(),
    totalCents: v.number(),
    status: v.union(
      v.literal("paid"),
      v.literal("pending"),
      v.literal("failed"),
    ),
    failureCode: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_fixture", ["fixture"])
    .index("by_order", ["orderRef"])
    .index("by_status", ["fixture", "status"]),
  demoInventory: defineTable({
    fixture: v.string(),
    sku: v.string(),
    name: v.string(),
    stock: v.number(),
    reorderPoint: v.number(),
    updatedAt: v.number(),
  })
    .index("by_fixture", ["fixture"])
    .index("by_sku", ["sku"]),
  demoJobs: defineTable({
    fixture: v.string(),
    jobRef: v.string(),
    kind: v.string(),
    orderRef: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("queued"),
      v.literal("failed"),
      v.literal("running"),
    ),
    attempts: v.number(),
    maxAttempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastError: v.optional(v.string()),
  })
    .index("by_fixture", ["fixture"])
    .index("by_job", ["jobRef"]),
  demoEvents: defineTable({
    fixture: v.string(),
    source: v.union(
      v.literal("seed"),
      v.literal("traffic"),
      v.literal("repair"),
    ),
    level: v.union(v.literal("INFO"), v.literal("WARN"), v.literal("ERROR")),
    code: v.string(),
    message: v.string(),
    entityRef: v.string(),
    timestamp: v.number(),
    durationMs: v.number(),
  })
    .index("by_fixture", ["fixture"])
    .index("by_time", ["fixture", "timestamp"]),
});
