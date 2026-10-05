import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const FIXTURE = "convex-monitor-shop-v1";
const HOUR = 60 * 60 * 1000;
const skus = [
  "KEYBOARD",
  "MOUSE",
  "DOCK",
  "HEADPHONES",
  "WEBCAM",
  "CABLE",
  "STAND",
  "MIC",
];
const fixtureTables = [
  "demoCustomers",
  "demoOrders",
  "demoInventory",
  "demoJobs",
  "demoEvents",
] as const;

function assertDemoDeployment() {
  if (
    process.env.CONVEX_CLOUD_URL !==
    "https://terrific-stingray-366.convex.cloud"
  ) {
    throw new Error(
      "This fixture can only write to the convexstyle development deployment.",
    );
  }
}

async function summaryData(ctx: QueryCtx | MutationCtx) {
  const orders = await ctx.db
    .query("demoOrders")
    .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
    .collect();
  const jobs = await ctx.db
    .query("demoJobs")
    .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
    .collect();
  const inventory = await ctx.db
    .query("demoInventory")
    .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
    .collect();
  const counts = Object.fromEntries(
    await Promise.all(
      fixtureTables.map(async (table) => [
        table,
        (
          await ctx.db
            .query(table)
            .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
            .collect()
        ).length,
      ]),
    ),
  );
  return {
    synthetic: true,
    fixture: FIXTURE,
    counts,
    orders: {
      paid: orders.filter((o) => o.status === "paid").length,
      pending: orders.filter((o) => o.status === "pending").length,
      failed: orders.filter((o) => o.status === "failed").length,
    },
    revenueCents: orders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.totalCents, 0),
    failedJobs: jobs
      .filter((j) => j.status === "failed")
      .map((j) => ({
        jobRef: j.jobRef,
        attempts: j.attempts,
        lastError: j.lastError,
      })),
    stuckJobs: jobs
      .filter((j) => j.status === "running" && j.updatedAt < Date.now() - HOUR)
      .map((j) => j.jobRef),
    lowStock: inventory
      .filter((i) => i.stock <= i.reorderPoint)
      .map((i) => ({
        sku: i.sku,
        stock: i.stock,
        reorderPoint: i.reorderPoint,
      })),
  };
}

// Seed once; later calls leave fixes and the existing fixture untouched.
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertDemoDeployment();
    if (
      await ctx.db
        .query("demoCustomers")
        .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
        .first()
    ) {
      return { alreadySeeded: true, ...(await summaryData(ctx)) };
    }
    const now = Date.now();
    const customers = [];
    for (let i = 0; i < 24; i++) {
      customers.push(
        await ctx.db.insert("demoCustomers", {
          fixture: FIXTURE,
          customerRef: `CUSTOMER-${String(i + 1).padStart(3, "0")}`,
          name: `Demo customer ${i + 1}`,
          email: `customer${i + 1}@example.invalid`,
          plan: ["starter", "pro", "business"][i % 3],
          createdAt: now - (30 + i) * 24 * HOUR,
        }),
      );
    }
    for (let i = 0; i < skus.length; i++) {
      await ctx.db.insert("demoInventory", {
        fixture: FIXTURE,
        sku: skus[i],
        name: `Demo ${skus[i].toLowerCase()}`,
        stock: [42, 65, 0, 3, 24, 180, 1, 36][i],
        reorderPoint: 5,
        updatedAt: now - HOUR,
      });
    }
    for (let i = 0; i < 120; i++) {
      const recentFailure = i >= 102 && i % 3 !== 0;
      const failureCode = recentFailure
        ? i % 2
          ? "PAYMENT_PROVIDER_TIMEOUT"
          : "PAYMENT_DECLINED"
        : undefined;
      const status = recentFailure
        ? ("failed" as const)
        : i % 11 === 0
          ? ("pending" as const)
          : ("paid" as const);
      const orderRef = `ORDER-${String(i + 1).padStart(3, "0")}`;
      const createdAt = now - (120 - i) * HOUR;
      await ctx.db.insert("demoOrders", {
        fixture: FIXTURE,
        orderRef,
        customerId: customers[i % customers.length],
        sku: skus[i % skus.length],
        quantity: 1 + (i % 3),
        totalCents: 2500 + (i % 12) * 1200,
        status,
        failureCode,
        createdAt,
      });
      await ctx.db.insert("demoEvents", {
        fixture: FIXTURE,
        source: "seed",
        level: recentFailure ? "ERROR" : status === "pending" ? "WARN" : "INFO",
        code:
          failureCode ??
          (status === "pending" ? "CHECKOUT_PENDING" : "CHECKOUT_COMPLETED"),
        message: recentFailure
          ? `Synthetic checkout failure: ${failureCode}`
          : `Synthetic checkout ${status}`,
        entityRef: orderRef,
        timestamp: createdAt,
        durationMs: recentFailure ? 8000 + i * 20 : 80 + (i % 15) * 25,
      });
    }
    for (let i = 0; i < 40; i++) {
      const status =
        i < 28
          ? ("completed" as const)
          : i < 32
            ? ("queued" as const)
            : i < 37
              ? ("failed" as const)
              : ("running" as const);
      await ctx.db.insert("demoJobs", {
        fixture: FIXTURE,
        jobRef: `JOB-${String(i + 1).padStart(3, "0")}`,
        kind: ["send_receipt", "fulfill_order", "sync_inventory"][i % 3],
        orderRef: `ORDER-${String(i + 1).padStart(3, "0")}`,
        status,
        attempts: status === "failed" ? 3 : 1,
        maxAttempts: 3,
        createdAt: now - 24 * HOUR,
        updatedAt: now - (status === "running" ? 4 : 1) * HOUR,
        lastError:
          status === "failed"
            ? "Synthetic upstream timeout; retry limit exhausted"
            : undefined,
      });
    }
    console.info(
      "[MONITOR_DEMO] Seeded synthetic shop: 24 customers, 120 orders, 8 inventory rows, 40 jobs, 120 historical events.",
    );
    console.warn(
      "[MONITOR_DEMO] Expected test issues: payment failures, 3 low-stock products, 5 failed jobs, 3 stuck jobs.",
    );
    return { alreadySeeded: false, ...(await summaryData(ctx)) };
  },
});

export const summary = internalQuery({ args: {}, handler: summaryData });

export const recentErrors = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 30 }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("limit must be 1–100");
    return ctx.db
      .query("demoEvents")
      .withIndex("by_time", (q) => q.eq("fixture", FIXTURE))
      .order("desc")
      .filter((q) => q.eq(q.field("level"), "ERROR"))
      .take(limit);
  },
});

export const ordersOverTime = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db
      .query("demoOrders")
      .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
      .collect();
    const days: Record<
      string,
      {
        date: string;
        paid: number;
        pending: number;
        failed: number;
        revenueCents: number;
      }
    > = {};
    for (const order of orders) {
      const date = new Date(order.createdAt).toISOString().slice(0, 10);
      const bucket = (days[date] ??= {
        date,
        paid: 0,
        pending: 0,
        failed: 0,
        revenueCents: 0,
      });
      bucket[order.status]++;
      if (order.status === "paid") bucket.revenueCents += order.totalCents;
    }
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const inspectJobs = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("demoJobs")
      .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
      .collect(),
});

export const inspectInventory = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("demoInventory")
      .withIndex("by_fixture", (q) => q.eq("fixture", FIXTURE))
      .collect(),
});

// Real failed Convex invocations, deliberately isolated from all external services.
export const simulateCheckout = internalMutation({
  args: { orderRef: v.string() },
  handler: async (ctx, { orderRef }) => {
    assertDemoDeployment();
    const order = await ctx.db
      .query("demoOrders")
      .withIndex("by_order", (q) => q.eq("orderRef", orderRef))
      .unique();
    if (!order || order.fixture !== FIXTURE)
      throw new Error("Demo order not found");
    if (order.failureCode) {
      console.error(
        `[MONITOR_DEMO] ${order.failureCode}: ${orderRef}; synthetic payment attempt, no payment provider contacted.`,
      );
      throw new ConvexError({
        code: order.failureCode,
        orderRef,
        synthetic: true,
      });
    }
    console.info(
      `[MONITOR_DEMO] Checkout inspected: ${orderRef}, status=${order.status}`,
    );
    return { orderRef, status: order.status, synthetic: true };
  },
});

export const simulateInventory = internalQuery({
  args: { sku: v.string() },
  handler: async (ctx, { sku }) => {
    const item = await ctx.db
      .query("demoInventory")
      .withIndex("by_sku", (q) => q.eq("sku", sku))
      .unique();
    if (!item || item.fixture !== FIXTURE)
      throw new Error("Demo SKU not found");
    if (item.stock === 0) {
      console.error(
        `[MONITOR_DEMO] OUT_OF_STOCK: ${sku}; fulfillment blocked.`,
      );
      throw new ConvexError({ code: "OUT_OF_STOCK", sku, synthetic: true });
    }
    if (item.stock <= item.reorderPoint)
      console.warn(
        `[MONITOR_DEMO] LOW_STOCK: ${sku} has ${item.stock} remaining.`,
      );
    else
      console.info(
        `[MONITOR_DEMO] Inventory healthy: ${sku} has ${item.stock} remaining.`,
      );
    return { sku, stock: item.stock, synthetic: true };
  },
});

export const simulateJob = internalMutation({
  args: { jobRef: v.string() },
  handler: async (ctx, { jobRef }) => {
    assertDemoDeployment();
    const job = await ctx.db
      .query("demoJobs")
      .withIndex("by_job", (q) => q.eq("jobRef", jobRef))
      .unique();
    if (!job || job.fixture !== FIXTURE) throw new Error("Demo job not found");
    const code =
      job.status === "failed"
        ? "RETRY_EXHAUSTED"
        : job.status === "running" && job.updatedAt < Date.now() - HOUR
          ? "WORKER_HEARTBEAT_STALE"
          : undefined;
    if (code) {
      console.error(
        `[MONITOR_DEMO] ${code}: ${jobRef}, kind=${job.kind}, attempts=${job.attempts}/${job.maxAttempts}`,
      );
      throw new ConvexError({ code, jobRef, synthetic: true });
    }
    console.info(
      `[MONITOR_DEMO] Job inspected: ${jobRef}, status=${job.status}`,
    );
    return { jobRef, status: job.status, synthetic: true };
  },
});

export const recordTraffic = internalMutation({
  args: {
    level: v.union(v.literal("INFO"), v.literal("WARN"), v.literal("ERROR")),
    code: v.string(),
    entityRef: v.string(),
    message: v.string(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    assertDemoDeployment();
    return ctx.db.insert("demoEvents", {
      ...args,
      fixture: FIXTURE,
      source: "traffic",
      timestamp: Date.now(),
    });
  },
});

export const generateTraffic = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ synthetic: true; invocations: number; failures: number }> => {
    assertDemoDeployment();
    let failures = 0;
    const scenarios = [
      { kind: "checkout", ref: "ORDER-001" },
      { kind: "checkout", ref: "ORDER-104" },
      { kind: "checkout", ref: "ORDER-105" },
      { kind: "checkout", ref: "ORDER-107" },
      { kind: "checkout", ref: "ORDER-108" },
      { kind: "inventory", ref: "KEYBOARD" },
      { kind: "inventory", ref: "DOCK" },
      { kind: "inventory", ref: "HEADPHONES" },
      { kind: "job", ref: "JOB-001" },
      { kind: "job", ref: "JOB-033" },
      { kind: "job", ref: "JOB-034" },
      { kind: "job", ref: "JOB-038" },
    ];
    for (const scenario of scenarios) {
      const startedAt = Date.now();
      let level: "INFO" | "WARN" | "ERROR" = "INFO";
      let code = "CHECK_COMPLETED";
      let message = "Synthetic check completed";
      try {
        if (scenario.kind === "checkout")
          await ctx.runMutation(internal.monitorDemo.simulateCheckout, {
            orderRef: scenario.ref,
          });
        else if (scenario.kind === "inventory") {
          const result = await ctx.runQuery(
            internal.monitorDemo.simulateInventory,
            { sku: scenario.ref },
          );
          if (result.stock <= 5) {
            level = "WARN";
            code = "LOW_STOCK";
            message = `Synthetic low stock: ${result.stock} remaining`;
          }
        } else
          await ctx.runMutation(internal.monitorDemo.simulateJob, {
            jobRef: scenario.ref,
          });
      } catch (error) {
        failures++;
        level = "ERROR";
        message = String(error).slice(0, 1500);
        code =
          [
            "PAYMENT_PROVIDER_TIMEOUT",
            "PAYMENT_DECLINED",
            "OUT_OF_STOCK",
            "RETRY_EXHAUSTED",
            "WORKER_HEARTBEAT_STALE",
          ].find((c) => message.includes(c)) ?? "DEMO_FAILURE";
      }
      // A separate mutation persists evidence even when the simulated mutation rolls back.
      await ctx.runMutation(internal.monitorDemo.recordTraffic, {
        level,
        code,
        entityRef: scenario.ref,
        message,
        durationMs: Date.now() - startedAt,
      });
    }
    console.info(
      `[MONITOR_DEMO] Completed bounded traffic burst: ${scenarios.length} invocations, ${failures} expected failures.`,
    );
    return { synthetic: true, invocations: scenarios.length, failures };
  },
});

export const requeueJob = internalMutation({
  args: { jobRef: v.string() },
  handler: async (ctx, { jobRef }) => {
    assertDemoDeployment();
    const job = await ctx.db
      .query("demoJobs")
      .withIndex("by_job", (q) => q.eq("jobRef", jobRef))
      .unique();
    if (!job || job.fixture !== FIXTURE) throw new Error("Demo job not found");
    if (
      job.status !== "failed" &&
      !(job.status === "running" && job.updatedAt < Date.now() - HOUR)
    )
      throw new Error("Only failed or stale demo jobs can be requeued");
    await ctx.db.patch(job._id, {
      status: "queued",
      attempts: 0,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("demoEvents", {
      fixture: FIXTURE,
      source: "repair",
      level: "INFO",
      code: "JOB_REQUEUED",
      message: "Synthetic job requeued; no worker or email is triggered",
      entityRef: jobRef,
      timestamp: Date.now(),
      durationMs: 0,
    });
    console.info(`[MONITOR_DEMO] JOB_REQUEUED: ${jobRef}`);
    return { jobRef, status: "queued", synthetic: true };
  },
});

export const restock = internalMutation({
  args: { sku: v.string(), quantity: v.number() },
  handler: async (ctx, { sku, quantity }) => {
    assertDemoDeployment();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      throw new Error("quantity must be an integer from 1–100");
    const item = await ctx.db
      .query("demoInventory")
      .withIndex("by_sku", (q) => q.eq("sku", sku))
      .unique();
    if (!item || item.fixture !== FIXTURE)
      throw new Error("Demo SKU not found");
    await ctx.db.patch(item._id, {
      stock: item.stock + quantity,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("demoEvents", {
      fixture: FIXTURE,
      source: "repair",
      level: "INFO",
      code: "INVENTORY_RESTOCKED",
      message: `Synthetic stock increased by ${quantity}; no purchase is placed`,
      entityRef: sku,
      timestamp: Date.now(),
      durationMs: 0,
    });
    console.info(
      `[MONITOR_DEMO] INVENTORY_RESTOCKED: ${sku}, stock=${item.stock + quantity}`,
    );
    return { sku, stock: item.stock + quantity, synthetic: true };
  },
});
