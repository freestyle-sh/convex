import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://terrific-stingray-366.convex.cloud");
});
afterEach(() => vi.unstubAllEnvs());

describe("Monitor target fixture", () => {
  it("seeds once with relational data and preserves fixes on a second seed", async () => {
    const t = convexTest(schema, modules);
    const initial = await t.mutation(internal.monitorDemo.seed, {});
    expect(initial.counts).toEqual({
      demoCustomers: 24,
      demoOrders: 120,
      demoInventory: 8,
      demoJobs: 40,
      demoEvents: 120,
    });
    expect(initial.orders.failed).toBe(12);
    expect(initial.failedJobs).toHaveLength(5);
    expect(initial.stuckJobs).toHaveLength(3);
    expect(initial.lowStock).toHaveLength(3);
    await t.run(async (ctx) => {
      for (const order of await ctx.db.query("demoOrders").collect()) {
        expect(await ctx.db.get(order.customerId)).not.toBeNull();
      }
    });
    await t.mutation(internal.monitorDemo.restock, {
      sku: "DOCK",
      quantity: 20,
    });
    await t.mutation(internal.monitorDemo.requeueJob, { jobRef: "JOB-033" });
    const repeated = await t.mutation(internal.monitorDemo.seed, {});
    expect(repeated.alreadySeeded).toBe(true);
    expect(repeated.counts.demoOrders).toBe(120);
    expect(repeated.failedJobs).toHaveLength(4);
    expect(repeated.lowStock).toHaveLength(2);
    expect(
      await t.query(internal.monitorDemo.simulateInventory, { sku: "DOCK" }),
    ).toMatchObject({ stock: 20 });
    await expect(
      t.mutation(internal.monitorDemo.requeueJob, { jobRef: "JOB-033" }),
    ).rejects.toThrow("Only failed or stale");
    await expect(
      t.mutation(internal.monitorDemo.restock, { sku: "DOCK", quantity: 0 }),
    ).rejects.toThrow("quantity");
  });

  it("produces real failures and durable evidence in a bounded traffic burst", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.monitorDemo.seed, {});
    const traffic = await t.action(internal.monitorDemo.generateTraffic, {});
    expect(traffic).toEqual({ synthetic: true, invocations: 12, failures: 8 });
    const events = await t.run((ctx) => ctx.db.query("demoEvents").collect());
    const live = events.filter((e) => e.source === "traffic");
    expect(live).toHaveLength(12);
    expect(live.filter((e) => e.level === "ERROR")).toHaveLength(8);
    expect(new Set(live.map((e) => e.code))).toEqual(
      new Set([
        "CHECK_COMPLETED",
        "PAYMENT_PROVIDER_TIMEOUT",
        "PAYMENT_DECLINED",
        "OUT_OF_STOCK",
        "LOW_STOCK",
        "RETRY_EXHAUSTED",
        "WORKER_HEARTBEAT_STALE",
      ]),
    );
    const summary = await t.query(internal.monitorDemo.summary, {});
    expect(summary.counts.demoOrders).toBe(120);
    expect(summary.orders.failed).toBe(12);
    const buckets = await t.query(internal.monitorDemo.ordersOverTime, {});
    expect(
      buckets.reduce((sum, b) => sum + b.failed + b.pending + b.paid, 0),
    ).toBe(120);
  });

  it("refuses to seed another deployment", async () => {
    vi.stubEnv(
      "CONVEX_CLOUD_URL",
      "https://some-production-deployment.convex.cloud",
    );
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.monitorDemo.seed, {})).rejects.toThrow(
      "development deployment",
    );
    expect(
      await t.run((ctx) => ctx.db.query("demoCustomers").collect()),
    ).toHaveLength(0);
  });
});
