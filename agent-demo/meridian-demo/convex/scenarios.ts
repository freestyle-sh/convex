import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
const deployment = "https://adjoining-barracuda-972.convex.cloud";
function assertDemo() {
  if (process.env.CONVEX_CLOUD_URL !== deployment)
    throw new Error("Meridian synthetic demo deployment only.");
}
export const checkoutProbe = internalQuery({
  args: { browser: v.string(), release: v.string() },
  handler: async (_ctx, args) => {
    if (args.browser === "Safari" && args.release === "checkout-2.8.0") {
      console.error("THREE_DS_CALLBACK_TIMEOUT", {
        synthetic: true,
        service: "checkout",
        ...args,
      });
      throw new Error(
        "THREE_DS_CALLBACK_TIMEOUT: synthetic Safari callback regression in checkout-2.8.0",
      );
    }
    console.info("CHECKOUT_HEALTHY", { synthetic: true, ...args });
    return { synthetic: true, status: "healthy" };
  },
});
export const warehouseProbe = internalQuery({
  args: { warehouse: v.string() },
  handler: async (ctx, { warehouse }) => {
    const stock = await ctx.db
      .query("inventory")
      .withIndex("by_sku", (q) => q.eq("sku", "TRAIL-PACK-28"))
      .collect();
    const row = stock.find((r) => r.warehouse === warehouse);
    if (row && row.onHand < row.reserved) {
      console.error("INVENTORY_RESERVATION_DEFICIT", {
        synthetic: true,
        warehouse,
        sku: row.sku,
        onHand: row.onHand,
        reserved: row.reserved,
      });
      throw new Error(
        "INVENTORY_RESERVATION_DEFICIT: Trail Pack reservations exceed on-hand units",
      );
    }
    return { synthetic: true, status: "healthy" };
  },
});
export const generateTraffic = internalAction({
  args: {},
  handler: async (ctx) => {
    assertDemo();
    const receipts = [];
    for (let i = 0; i < 8; i++) {
      try {
        await ctx.runQuery(internal.scenarios.checkoutProbe, {
          browser: i < 3 ? "Safari" : "Chrome",
          release: "checkout-2.8.0",
        });
        receipts.push({ kind: "checkout", ok: true });
      } catch {
        receipts.push({ kind: "checkout", ok: false });
      }
    }
    for (const warehouse of ["Reno", "Columbus"]) {
      try {
        await ctx.runQuery(internal.scenarios.warehouseProbe, { warehouse });
        receipts.push({ kind: warehouse, ok: true });
      } catch {
        receipts.push({ kind: warehouse, ok: false });
      }
    }
    return { synthetic: true, invocations: receipts.length, receipts };
  },
});
export const receiveStock = internalMutation({
  args: { sku: v.string(), warehouse: v.string(), units: v.number() },
  handler: async (ctx, { sku, warehouse, units }) => {
    assertDemo();
    if (!Number.isInteger(units) || units < 1 || units > 2000)
      throw new Error("Use 1–2000 units.");
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_sku", (q) => q.eq("sku", sku))
      .collect();
    const row = rows.find((r) => r.warehouse === warehouse);
    if (!row) throw new Error("Unknown SKU/warehouse");
    await ctx.db.patch(row._id, {
      onHand: row.onHand + units,
      updatedAt: Date.now(),
    });
    return {
      synthetic: true,
      sku,
      warehouse,
      before: row.onHand,
      after: row.onHand + units,
    };
  },
});
