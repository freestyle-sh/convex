import test from "node:test";
import assert from "node:assert/strict";
import { generate, SNAPSHOT } from "./generate.mjs";
import { compact, summarizeReturns } from "../convex/compact.ts";
const t = generate();
const orders = new Map(t.orders.map((o) => [o.orderRef, o]));
const customers = new Map(t.customers.map((c) => [c.customerRef, c]));
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
test("complete analytics payloads fit the notebook gateway and preserve return totals", () => {
  const returns = summarizeReturns(t.returns);
  assert.equal(sum(returns, "returnedUnits"), sum(t.returns, "quantity"));
  assert.equal(sum(returns, "refundCents"), sum(t.returns, "refundCents"));
  assert.equal(
    sum(returns, "requestedRefundCents"),
    sum(t.returns, "requestedRefundCents"),
  );
  const payloads = [
    { daily: compact(t.channelDaily), spend: compact(t.marketingSpend) },
    {
      daily: compact(t.productDaily),
      catalog: t.products,
      returns: compact(returns),
    },
  ];
  for (const payload of payloads)
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 240_000);
  assert.equal(payloads[0].daily.rows.length, 720);
  assert.equal(payloads[1].daily.rows.length, t.productDaily.length);
  assert.deepEqual(
    JSON.parse(t.datasetInfo[0].valueJson).counts,
    Object.fromEntries(
      Object.entries(t).map(([name, rows]) => [name, rows.length]),
    ),
  );
});
test("large fixture has valid references, timestamps and exact monetary identities", () => {
  assert.ok(Object.values(t).reduce((n, a) => n + a.length, 0) > 140000);
  const items = new Map();
  for (const i of t.orderItems) {
    assert.ok(orders.has(i.orderRef));
    if (!items.has(i.orderRef)) items.set(i.orderRef, []);
    items.get(i.orderRef).push(i);
    assert.equal(i.netCents, i.grossCents - i.discountCents);
  }
  for (const o of t.orders) {
    assert.ok(customers.get(o.customerRef).createdAt <= o.createdAt);
    assert.ok(o.createdAt <= SNAPSHOT);
    assert.equal(sum(items.get(o.orderRef), "netCents"), o.netCents);
    assert.equal(
      o.totalCents,
      o.netCents + o.taxCents + o.shippingChargedCents,
    );
  }
  for (const s of t.shipments) {
    assert.equal(orders.get(s.orderRef).status, "paid");
    if (s.deliveredAt !== null)
      assert.ok(s.deliveredAt <= SNAPSHOT && s.deliveredAt >= s.shippedAt);
  }
  for (const r of t.returns) {
    assert.equal(orders.get(r.orderRef).status, "paid");
    assert.ok(r.requestedAt <= SNAPSHOT);
    assert.equal(r.status === "refunded", r.refundedAt !== null);
    const item = items.get(r.orderRef).find((i) => i.sku === r.sku);
    assert.equal(r.quantity, item.quantity);
    assert.equal(r.requestedRefundCents, item.netCents);
  }
});
test("paid captures and raw transactions reconcile to all rollups", () => {
  const paid = t.orders.filter((o) => o.status === "paid");
  assert.equal(
    t.paymentAttempts.filter((p) => p.status === "captured").length,
    paid.length,
  );
  assert.equal(sum(t.dailyRevenue, "paidOrders"), paid.length);
  assert.equal(sum(t.dailyRevenue, "netSalesCents"), sum(paid, "netCents"));
  assert.equal(
    sum(t.dailyRevenue, "refundCents"),
    sum(t.returns, "refundCents"),
  );
  assert.equal(
    sum(t.dailyRevenue, "adSpendCents"),
    sum(t.marketingSpend, "spendCents"),
  );
  assert.equal(sum(t.productDaily, "netSalesCents"), sum(paid, "netCents"));
  assert.equal(
    sum(t.productDaily, "refundCents"),
    sum(t.returns, "refundCents"),
  );
  for (const key of [
    "netSalesCents",
    "refundCents",
    "contributionCents",
    "adSpendCents",
    "paidOrders",
  ])
    assert.equal(sum(t.dailyRevenue, key), sum(t.channelDaily, key));
  assert.equal(
    sum(t.channelDaily, "newCustomers"),
    new Set(paid.map((o) => o.customerRef)).size,
  );
});
test("incidents have measurable signals and fulfilled cohorts are not double-counted", () => {
  const affected = t.checkoutDaily.filter(
    (r) =>
      r.date >= "2026-09-19" &&
      r.date <= "2026-09-23" &&
      r.browser === "Safari" &&
      r.device === "mobile",
  );
  const baseline = t.checkoutDaily.filter(
    (r) =>
      r.date < "2026-09-19" && r.browser === "Safari" && r.device === "mobile",
  );
  assert.ok(
    sum(affected, "failed") / sum(affected, "attempts") >
      (sum(baseline, "failed") / sum(baseline, "attempts")) * 5,
  );
  assert.equal(sum(t.fulfillmentDaily, "orders"), t.shipments.length);
  assert.equal(
    sum(t.fulfillmentDaily, "deliveredLate"),
    t.shipments.filter(
      (s) => s.deliveredAt !== null && s.deliveredAt > s.promisedAt,
    ).length,
  );
  assert.equal(
    sum(t.fulfillmentDaily, "overdueOpen"),
    t.shipments.filter((s) => s.deliveredAt === null && s.promisedAt < SNAPSHOT)
      .length,
  );
  assert.ok(
    t.returns.some(
      (r) => r.batch === "SS-0826-B" && r.reason === "zipper_failure",
    ),
  );
  assert.ok(t.serviceMetrics.every((m) => m.timestamp <= SNAPSHOT));
});
test("fixture is deterministic and all contact addresses are synthetic", () => {
  assert.deepEqual(generate().dailyRevenue, t.dailyRevenue);
  assert.ok(t.customers.every((c) => c.email.endsWith("@example.invalid")));
  const social = t.channelDaily.filter((r) => r.channel === "Paid social");
  const pre = social.filter((r) => r.date < "2026-09-14"),
    post = social.filter((r) => r.date >= "2026-09-14");
  assert.ok(
    sum(post, "contributionCents") / sum(post, "netSalesCents") <
      sum(pre, "contributionCents") / sum(pre, "netSalesCents") - 0.1,
  );
});
