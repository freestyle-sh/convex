import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vmSummaryValidator } from "./model.js";

export default defineSchema({
  vms: defineTable({
    ownerId: v.string(),
    slug: v.string(),
    managementToken: v.string(),
    phase: v.union(v.literal("provisioning"), v.literal("ready")),
    vmId: v.optional(v.string()),
    remote: v.optional(vmSummaryValidator),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_slug", ["ownerId", "slug"])
    .index("by_vm_id", ["vmId"]),
});
