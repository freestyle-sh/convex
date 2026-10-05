import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { compact, summarizeReturns } from "./compact";

export const overview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const info = await ctx.db
      .query("datasetInfo")
      .withIndex("by_key", (q) => q.eq("key", "manifest"))
      .unique();
    return {
      ...JSON.parse(info?.valueJson ?? "{}"),
      analytics: {
        revenue:
          "analytics:revenue — complete daily revenue, costs, refunds and contribution for all 120 days",
        channels:
          "analytics:channels — complete daily channel economics and marketing spend; columnar tables with columns and rows",
        checkout:
          "analytics:checkout — daily checkout success by browser/device plus releases; failure denominator is orders/first checkout, not retries",
        fulfillment:
          "analytics:fulfillment — daily warehouse/carrier cohorts, open overdue shipments and current stock",
        products:
          "analytics:products — complete daily SKU economics and all returns grouped by SKU, batch, reason and status; columnar tables with columns and rows",
        retention:
          "analytics:retention — signup cohort weekly purchasing activity (later weeks right-censored)",
      },
    };
  },
});
export const revenue = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("dailyRevenue").withIndex("by_date").collect(),
});
export const channels = internalQuery({
  args: {},
  handler: async (ctx) => ({
    daily: compact(
      await ctx.db.query("channelDaily").withIndex("by_date").collect(),
    ),
    spend: compact(
      await ctx.db.query("marketingSpend").withIndex("by_date").collect(),
    ),
    format:
      "Each table has columns and rows. Python: pd.DataFrame(table['rows'], columns=table['columns']). No rows omitted.",
  }),
});
export const checkout = internalQuery({
  args: {},
  handler: async (ctx) => ({
    daily: await ctx.db.query("checkoutDaily").withIndex("by_date").collect(),
    deployments: await ctx.db
      .query("deployments")
      .withIndex("by_time")
      .collect(),
    definition:
      "attempts = checkout orders; failed = final unsuccessful orders; callbackTimeouts = first attempt callback timeouts. A recovered retry is not another checkout.",
  }),
});
export const fulfillment = internalQuery({
  args: {},
  handler: async (ctx) => ({
    daily: await ctx.db
      .query("fulfillmentDaily")
      .withIndex("by_date")
      .collect(),
    inventory: await ctx.db.query("inventory").collect(),
    products: await ctx.db.query("products").collect(),
    openTickets: await ctx.db
      .query("supportTickets")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(80),
    definition:
      "Delivered-late rate denominator is delivered shipments. Open orders are right-censored; report overdueOpen separately. All dates UTC.",
  }),
});
export const products = internalQuery({
  args: {},
  handler: async (ctx) => ({
    daily: compact(await ctx.db.query("productDaily").collect()),
    catalog: await ctx.db.query("products").collect(),
    returns: compact(summarizeReturns(await ctx.db.query("returns").collect())),
    format:
      "daily and returns have columns and rows: pd.DataFrame(table['rows'], columns=table['columns']). Returns include all records aggregated by sku/batch/reason/status. returnedUnits counts returned items; refundCents is money actually refunded.",
  }),
});
export const retention = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db.query("retentionCohorts").withIndex("by_cohort").collect(),
});
export const order = internalQuery({
  args: { orderRef: v.string() },
  handler: async (ctx, { orderRef }) => ({
    order: await ctx.db
      .query("orders")
      .withIndex("by_ref", (q) => q.eq("orderRef", orderRef))
      .unique(),
    items: await ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderRef", orderRef))
      .collect(),
    payments: await ctx.db
      .query("paymentAttempts")
      .withIndex("by_order", (q) => q.eq("orderRef", orderRef))
      .collect(),
    shipment: await ctx.db
      .query("shipments")
      .withIndex("by_order", (q) => q.eq("orderRef", orderRef))
      .unique(),
  }),
});
