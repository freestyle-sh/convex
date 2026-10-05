import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SNAPSHOT = Date.parse("2026-10-04T20:00:00Z");
export const DAY = 86_400_000;
export const DAYS = 120;
const START = Date.parse("2026-06-07T00:00:00Z");
const FIXTURE = "meridian-supply-v1";
export function generate() {
  let seed = 20261004;
  const rand = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const int = (a, b) => Math.floor(a + rand() * (b - a + 1));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const weighted = (pairs) => {
    let x = rand() * pairs.reduce((n, p) => n + p[1], 0);
    for (const [v, w] of pairs) {
      x -= w;
      if (x < 0) return v;
    }
    return pairs.at(-1)[0];
  };
  const date = (ms) => new Date(ms).toISOString().slice(0, 10);
  const tables = Object.fromEntries(
    [
      "customers",
      "products",
      "orders",
      "orderItems",
      "paymentAttempts",
      "shipments",
      "returns",
      "supportTickets",
      "inventory",
      "marketingSpend",
      "dailyRevenue",
      "channelDaily",
      "checkoutDaily",
      "fulfillmentDaily",
      "productDaily",
      "retentionCohorts",
      "deployments",
      "serviceMetrics",
      "datasetInfo",
    ].map((t) => [t, []]),
  );
  const add = (t, row) => {
    const value = { fixture: FIXTURE, ...row };
    tables[t].push(value);
    return value;
  };
  const channels = [
    "Organic search",
    "Paid search",
    "Paid social",
    "Email",
    "Direct",
    "Referral",
  ];
  const catalogs = [
    ["TRAIL-PACK-28", "Trail Pack 28L", "Packs", 12900, 5400],
    ["WEEKENDER-40", "Weekender Duffel 40L", "Packs", 14900, 6300],
    ["CITY-SLING", "City Sling", "Packs", 5900, 2200],
    ["DAYPACK-16", "Daypack 16L", "Packs", 8900, 3700],
    ["SUMMIT-SHELL", "Summit Rain Shell", "Apparel", 18900, 8800],
    ["RIDGE-FLEECE", "Ridge Fleece", "Apparel", 9900, 4300],
    ["MERINO-TEE", "Merino Trail Tee", "Apparel", 6400, 2900],
    ["FIELD-PANT", "Field Utility Pant", "Apparel", 11900, 5200],
    ["CAMP-MUG", "Camp Mug 350ml", "Camp", 2400, 800],
    ["POUR-OVER", "Travel Pour Over", "Camp", 3900, 1400],
    ["LANTERN-MINI", "Mini Lantern", "Camp", 4900, 2100],
    ["PICNIC-BLANKET", "Packable Blanket", "Camp", 7900, 3200],
    ["BOTTLE-750", "Insulated Bottle 750ml", "Accessories", 3400, 1200],
    ["BOTTLE-1000", "Insulated Bottle 1L", "Accessories", 4200, 1700],
    ["TRAIL-SOCKS", "Merino Socks 2-pack", "Accessories", 2800, 900],
    ["FIELD-CAP", "Field Cap", "Accessories", 3200, 1000],
    ["TREK-POLES", "Trek Poles Pair", "Trail", 10900, 4700],
    ["HEADLAMP", "Trail Headlamp", "Trail", 5400, 2300],
    ["DRY-BAG", "Dry Bag 10L", "Trail", 2900, 900],
    ["FIRST-AID", "Trail First Aid Kit", "Trail", 4400, 1800],
    ["CAMP-TOWEL", "Quick Dry Towel", "Travel", 2700, 800],
    ["PACK-CUBES", "Packing Cubes Set", "Travel", 4900, 1700],
    ["PASSPORT", "Passport Wallet", "Travel", 3900, 1300],
    ["TECH-POUCH", "Tech Organizer", "Travel", 4500, 1600],
  ];
  for (const [sku, name, category, priceCents, costCents] of catalogs)
    add("products", {
      sku,
      name,
      category,
      priceCents,
      costCents,
      supplier: category === "Apparel" ? "Alpine Textiles" : "Northline Goods",
      leadTimeDays: category === "Packs" ? 35 : 21,
    });
  const first = [
    "Maya",
    "Oliver",
    "Amelia",
    "Theo",
    "Sofia",
    "Jasper",
    "Aria",
    "Luca",
    "Nora",
    "Elijah",
    "Chloe",
    "Ethan",
    "Zoe",
    "Hugo",
    "Ada",
    "Miles",
    "Leah",
    "Oscar",
    "Iris",
    "Leo",
    "Isla",
    "Finn",
    "Nina",
    "Rowan",
  ];
  const last = [
    "Bennett",
    "Chen",
    "Patel",
    "Morgan",
    "Reed",
    "Park",
    "Hughes",
    "Rivera",
    "Nguyen",
    "Brooks",
    "Hayes",
    "Silva",
    "Clarke",
    "Kim",
    "Ellis",
    "Martin",
    "Turner",
    "Wright",
    "Foster",
    "Lewis",
  ];
  const regions = {
    US: ["Seattle", "Portland", "Denver", "Austin", "Boston", "Chicago"],
    CA: ["Vancouver", "Toronto", "Calgary"],
    GB: ["London", "Bristol", "Manchester"],
    DE: ["Berlin", "Hamburg", "Munich"],
  };
  for (let i = 0; i < 6000; i++) {
    const signupDay = i < 800 ? int(-60, -1) : int(0, 117);
    const country = weighted([
      ["US", 65],
      ["CA", 12],
      ["GB", 14],
      ["DE", 9],
    ]);
    add("customers", {
      customerRef: `CUS-${String(i + 1).padStart(5, "0")}`,
      name: `${pick(first)} ${pick(last)}`,
      email: `customer.${i + 1}@example.invalid`,
      country,
      city: pick(regions[country]),
      acquisitionChannel: weighted(
        channels.map((c, j) => [c, [27, 23, 20, 8, 16, 6][j]]),
      ),
      createdAt: START + signupDay * DAY + int(0, 7) * 3600000,
      loyaltyTier: weighted([
        ["Explorer", 73],
        ["Trail", 22],
        ["Summit", 5],
      ]),
    });
  }
  const eligible = [];
  const sortedCustomers = [...tables.customers].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  let ci = 0;
  const groups = new Map();
  const group = (table, key, init) => {
    const id = table + ":" + key;
    if (!groups.has(id)) groups.set(id, add(table, init));
    return groups.get(id);
  };
  let orderN = 0,
    itemN = 0,
    paymentN = 0,
    shipmentN = 0,
    returnN = 0,
    ticketN = 0;
  const orderCounts = new Map();
  for (let day = 0; day < DAYS; day++) {
    const dayStart = START + day * DAY;
    const d = date(dayStart);
    const dow = new Date(dayStart).getUTCDay();
    while (
      ci < sortedCustomers.length &&
      sortedCustomers[ci].createdAt < dayStart + 8 * 3600000
    )
      eligible.push(sortedCustomers[ci++]);
    const sale = day >= 99;
    const incident = day >= 104 && day <= 108;
    const volume = Math.round(
      (130 + day * 0.92) *
        (dow === 0 || dow === 6 ? 1.22 : 1) *
        (sale ? 1.4 : 1) *
        (0.82 + rand() * 0.36),
    );
    const revenue = add("dailyRevenue", {
      date: d,
      orders: 0,
      paidOrders: 0,
      failedOrders: 0,
      grossSalesCents: 0,
      discountCents: 0,
      netSalesCents: 0,
      cogsCents: 0,
      shippingCostCents: 0,
      paymentFeesCents: 0,
      refundCents: 0,
      adSpendCents: 0,
      contributionCents: 0,
    });
    for (const channel of channels) {
      const spend = ["Paid search", "Paid social"].includes(channel)
        ? Math.round(
            (channel === "Paid social" ? 24000 : 31000) *
              (1 + day * 0.005) *
              (sale ? (channel === "Paid social" ? 3.3 : 1.55) : 1) *
              (0.8 + rand() * 0.4),
          )
        : channel === "Email"
          ? 1800
          : 0;
      add("marketingSpend", {
        date: d,
        channel,
        campaign:
          channel === "Paid social" && sale
            ? "AUTUMN25 Prospecting"
            : `${channel} Always-on`,
        spendCents: spend,
        impressions: Math.round(
          spend / (channel === "Paid social" ? 0.8 : 2.4),
        ),
        clicks: Math.round(spend / (channel === "Paid social" ? 78 : 152)),
      });
      revenue.adSpendCents += spend;
      group("channelDaily", d + channel, {
        date: d,
        channel,
        orders: 0,
        paidOrders: 0,
        newCustomers: 0,
        netSalesCents: 0,
        cogsCents: 0,
        shippingCostCents: 0,
        paymentFeesCents: 0,
        refundCents: 0,
        adSpendCents: spend,
        contributionCents: 0,
      });
    }
    for (let j = 0; j < volume; j++) {
      const customer = pick(eligible);
      const channel = weighted(
        channels.map((c, k) => [
          c,
          (sale ? [20, 22, 34, 12, 9, 3] : [27, 24, 17, 10, 17, 5])[k],
        ]),
      );
      const device = weighted([
        ["mobile", 68],
        ["desktop", 32],
      ]);
      const browser =
        device === "mobile"
          ? weighted([
              ["Safari", 61],
              ["Chrome", 39],
            ])
          : weighted([
              ["Safari", 20],
              ["Chrome", 70],
              ["Firefox", 10],
            ]);
      const createdAt = dayStart + int(8 * 3600, 19 * 3600 + 3599) * 1000;
      const regression =
        incident && device === "mobile" && browser === "Safari";
      const firstFail = rand() < (regression ? 0.29 : 0.045);
      const recovered = firstFail && !regression && rand() < 0.53;
      const paid = !firstFail || recovered;
      const orderRef = `MS-${String(++orderN).padStart(6, "0")}`;
      const discountRate =
        sale && channel === "Paid social"
          ? 0.28
          : sale && rand() < 0.3
            ? 0.18
            : channel === "Email"
              ? 0.1
              : rand() < 0.08
                ? 0.08
                : 0;
      const items = [];
      const count = weighted([
        [1, 44],
        [2, 37],
        [3, 15],
        [4, 4],
      ]);
      const seen = new Set();
      while (items.length < count) {
        const product =
          rand() < 0.19
            ? tables.products[0]
            : rand() < 0.15
              ? tables.products[4]
              : pick(tables.products);
        if (seen.has(product.sku)) continue;
        seen.add(product.sku);
        const quantity = rand() < 0.1 ? 2 : 1;
        const grossCents = quantity * product.priceCents;
        const discountCents = Math.round(grossCents * discountRate);
        const batch =
          product.sku === "SUMMIT-SHELL" && day >= 88 && day <= 105
            ? "SS-0826-B"
            : `${product.sku}-STD`;
        items.push(
          add("orderItems", {
            itemRef: `ITEM-${++itemN}`,
            orderRef,
            customerRef: customer.customerRef,
            sku: product.sku,
            category: product.category,
            quantity,
            unitPriceCents: product.priceCents,
            grossCents,
            discountCents,
            netCents: grossCents - discountCents,
            costCents: quantity * product.costCents,
            batch,
            createdAt,
          }),
        );
      }
      const grossCents = items.reduce((s, r) => s + r.grossCents, 0);
      const discountCents = items.reduce((s, r) => s + r.discountCents, 0);
      const netCents = grossCents - discountCents;
      const cogsCents = items.reduce((s, r) => s + r.costCents, 0);
      const shippingChargedCents = netCents >= 10000 ? 0 : 650;
      const taxCents = Math.round(
        (netCents + shippingChargedCents) *
          { US: 0.075, CA: 0.12, GB: 0.2, DE: 0.19 }[customer.country],
      );
      const totalCents = netCents + shippingChargedCents + taxCents;
      const fee = paid ? Math.round(totalCents * 0.029) + 30 : 0;
      const warehouse =
        customer.country === "US" &&
        ["Seattle", "Portland", "Denver"].includes(customer.city)
          ? "Reno"
          : "Columbus";
      const carrier = weighted([
        ["ParcelNorth", warehouse === "Reno" ? 65 : 25],
        ["SwiftPost", 50],
        ["LocalExpress", 15],
      ]);
      const shippingCostCents = paid
        ? int(
            customer.country === "US" ? 510 : 1290,
            customer.country === "US" ? 1190 : 2490,
          )
        : 0;
      const previousOrders = orderCounts.get(customer.customerRef) || 0;
      const isFirstOrder = paid && previousOrders === 0;
      if (paid) orderCounts.set(customer.customerRef, previousOrders + 1);
      const order = add("orders", {
        orderRef,
        customerRef: customer.customerRef,
        createdAt,
        date: d,
        status: paid ? "paid" : "failed",
        channel,
        campaign: discountRate === 0.28 ? "AUTUMN25" : "Always-on",
        device,
        browser,
        country: customer.country,
        warehouse,
        currency: "USD",
        grossCents,
        discountCents,
        netCents,
        taxCents,
        shippingChargedCents,
        totalCents,
        cogsCents: paid ? cogsCents : 0,
        shippingCostCents,
        paymentFeeCents: fee,
        isFirstOrder,
      });
      const errorCode = firstFail
        ? regression
          ? "THREE_DS_CALLBACK_TIMEOUT"
          : weighted([
              ["CARD_DECLINED", 65],
              ["INSUFFICIENT_FUNDS", 25],
              ["GATEWAY_TIMEOUT", 10],
            ])
        : null;
      for (let attempt = 1; attempt <= (recovered ? 2 : 1); attempt++)
        add("paymentAttempts", {
          paymentRef: `PAY-${++paymentN}`,
          orderRef,
          createdAt: createdAt + attempt * 1400,
          attempt,
          provider: "Boreal Payments",
          method: "card",
          status: firstFail && attempt === 1 ? "failed" : "captured",
          errorCode: firstFail && attempt === 1 ? errorCode : null,
          amountCents: totalCents,
          latencyMs: regression ? int(8300, 15100) : int(220, 1450),
          browser,
          device,
          release:
            day >= 104
              ? day <= 108
                ? "checkout-2.8.0"
                : "checkout-2.8.1"
              : "checkout-2.7.3",
        });
      const check = group("checkoutDaily", d + browser + device, {
        date: d,
        browser,
        device,
        attempts: 0,
        failed: 0,
        callbackTimeouts: 0,
        latencyTotalMs: 0,
      });
      check.attempts++;
      check.failed += paid ? 0 : 1;
      check.callbackTimeouts +=
        errorCode === "THREE_DS_CALLBACK_TIMEOUT" ? 1 : 0;
      check.latencyTotalMs += regression ? int(9000, 15000) : int(300, 1500);
      let returnedCents = 0;
      if (paid) {
        const backlog =
          warehouse === "Reno" &&
          carrier === "ParcelNorth" &&
          day >= 99 &&
          day <= 112;
        const stockout =
          items.some((i) => i.sku === "TRAIL-PACK-28") && day >= 114;
        const dispatchDays = stockout
          ? int(5, 9)
          : int(0, 2) + (backlog ? int(2, 5) : 0);
        const transitDays = customer.country === "US" ? int(1, 4) : int(3, 7);
        const shippedAt = createdAt + dispatchDays * DAY;
        const deliveredAt = shippedAt + transitDays * DAY;
        const promisedAt =
          createdAt + (customer.country === "US" ? 5 : 9) * DAY;
        const delivered = deliveredAt <= SNAPSHOT,
          shipped = shippedAt <= SNAPSHOT;
        const shipment = add("shipments", {
          shipmentRef: `SHP-${++shipmentN}`,
          orderRef,
          customerRef: customer.customerRef,
          createdAt,
          date: d,
          warehouse,
          carrier,
          country: customer.country,
          shippedAt: shipped ? shippedAt : null,
          deliveredAt: delivered ? deliveredAt : null,
          promisedAt,
          status: delivered
            ? "delivered"
            : shipped
              ? "in_transit"
              : "unfulfilled",
          delayReason: stockout
            ? "inventory_backorder"
            : backlog
              ? "carrier_pickup_backlog"
              : null,
          costCents: shippingCostCents,
        });
        const fg = group("fulfillmentDaily", d + warehouse + carrier, {
          date: d,
          warehouse,
          carrier,
          orders: 0,
          delivered: 0,
          deliveredLate: 0,
          overdueOpen: 0,
          unfulfilled: 0,
          totalDeliveryDays: 0,
        });
        fg.orders++;
        fg.delivered += delivered ? 1 : 0;
        fg.deliveredLate += delivered && deliveredAt > promisedAt ? 1 : 0;
        fg.overdueOpen += !delivered && promisedAt < SNAPSHOT ? 1 : 0;
        fg.unfulfilled += !shipped ? 1 : 0;
        fg.totalDeliveryDays += delivered ? (deliveredAt - createdAt) / DAY : 0;
        const faulty = items.find((i) => i.batch === "SS-0826-B");
        const returnProbability = faulty
          ? 0.24
          : channel === "Paid social" && sale
            ? 0.115
            : 0.037;
        if (
          delivered &&
          deliveredAt + 3 * DAY < SNAPSHOT &&
          rand() < returnProbability
        ) {
          const item = faulty || pick(items);
          const requestedAt = deliveredAt + int(2, 12) * DAY;
          if (requestedAt <= SNAPSHOT) {
            const refundedAt = requestedAt + 3 * DAY;
            returnedCents = refundedAt <= SNAPSHOT ? item.netCents : 0;
            add("returns", {
              returnRef: `RET-${++returnN}`,
              orderRef,
              customerRef: customer.customerRef,
              sku: item.sku,
              quantity: item.quantity,
              batch: item.batch,
              requestedAt,
              refundedAt: returnedCents ? refundedAt : null,
              status: returnedCents ? "refunded" : "requested",
              reason: faulty
                ? "zipper_failure"
                : weighted([
                    ["wrong_size", 45],
                    ["changed_mind", 35],
                    ["damaged_in_transit", 20],
                  ]),
              refundCents: returnedCents,
              requestedRefundCents: item.netCents,
            });
          }
        }
        if (
          ((backlog || stockout || faulty) && rand() < 0.38) ||
          rand() < 0.018
        ) {
          const openedAt = createdAt + int(1, 5) * DAY;
          if (openedAt < SNAPSHOT) {
            const category = faulty
              ? "Product defect"
              : stockout
                ? "Stock availability"
                : "Where is my order";
            const resolvedAt = openedAt + int(1, backlog ? 8 : 3) * DAY;
            add("supportTickets", {
              ticketRef: `TKT-${++ticketN}`,
              orderRef,
              customerRef: customer.customerRef,
              createdAt: openedAt,
              category,
              priority: backlog ? "high" : "normal",
              status: resolvedAt <= SNAPSHOT ? "resolved" : "open",
              firstResponseMinutes: backlog ? int(120, 1200) : int(15, 180),
              resolvedAt: resolvedAt <= SNAPSHOT ? resolvedAt : null,
              csat:
                resolvedAt <= SNAPSHOT
                  ? backlog
                    ? int(1, 3)
                    : int(3, 5)
                  : null,
              subject:
                category === "Product defect"
                  ? "Rain shell zipper separated"
                  : category === "Stock availability"
                    ? "Trail Pack shipping date"
                    : "Delivery is later than promised",
            });
          }
        }
        void shipment;
      }
      revenue.orders++;
      revenue.paidOrders += paid ? 1 : 0;
      revenue.failedOrders += paid ? 0 : 1;
      const cg = group("channelDaily", d + channel, {});
      cg.orders++;
      cg.paidOrders += paid ? 1 : 0;
      cg.newCustomers += isFirstOrder ? 1 : 0;
      if (paid) {
        revenue.grossSalesCents += grossCents;
        revenue.discountCents += discountCents;
        for (const g of [revenue, cg]) {
          g.netSalesCents += netCents;
          g.cogsCents += cogsCents;
          g.shippingCostCents += shippingCostCents;
          g.paymentFeesCents += fee;
          g.refundCents += returnedCents;
        }
      }
      for (const item of items) {
        const pg = group("productDaily", d + item.sku, {
          date: d,
          sku: item.sku,
          category: item.category,
          units: 0,
          netSalesCents: 0,
          cogsCents: 0,
          refundCents: 0,
        });
        if (paid) {
          pg.units += item.quantity;
          pg.netSalesCents += item.netCents;
          pg.cogsCents += item.costCents;
        }
      }
      void order;
    }
  }
  for (const c of tables.channelDaily) c.newCustomers = 0;
  const firstPurchase = new Set();
  for (const o of [...tables.orders].sort(
    (a, b) => a.createdAt - b.createdAt,
  )) {
    o.isFirstOrder = o.status === "paid" && !firstPurchase.has(o.customerRef);
    if (o.isFirstOrder) {
      firstPurchase.add(o.customerRef);
      groups.get("channelDaily:" + o.date + o.channel).newCustomers++;
    }
  }
  for (const r of tables.returns)
    if (r.refundCents) {
      const item = tables.orderItems.find(
        (i) => i.orderRef === r.orderRef && i.sku === r.sku,
      );
      groups.get("productDaily:" + date(item.createdAt) + r.sku).refundCents +=
        r.refundCents;
    }
  for (const row of [...tables.dailyRevenue, ...tables.channelDaily])
    row.contributionCents =
      row.netSalesCents -
      row.cogsCents -
      row.shippingCostCents -
      row.paymentFeesCents -
      row.refundCents -
      row.adSpendCents;
  for (const p of tables.products)
    for (const warehouse of ["Reno", "Columbus"]) {
      const recent = tables.orderItems.filter(
        (i) =>
          i.sku === p.sku &&
          i.createdAt >= SNAPSHOT - 14 * DAY &&
          tables.orders[Number(i.orderRef.slice(3)) - 1]?.status === "paid",
      );
      const unitsPerDay = recent.reduce((n, i) => n + i.quantity, 0) / 14 / 2;
      add("inventory", {
        sku: p.sku,
        warehouse,
        onHand:
          p.sku === "TRAIL-PACK-28"
            ? warehouse === "Reno"
              ? 0
              : 17
            : Math.round(unitsPerDay * int(12, 75)),
        reserved: p.sku === "TRAIL-PACK-28" ? int(40, 85) : int(0, 12),
        reorderPoint: Math.ceil(unitsPerDay * p.leadTimeDays),
        inboundUnits: p.sku === "TRAIL-PACK-28" ? 600 : 0,
        expectedArrival:
          p.sku === "TRAIL-PACK-28" ? Date.parse("2026-10-12T09:00:00Z") : null,
        leadTimeDays: p.leadTimeDays,
        updatedAt: SNAPSHOT,
      });
    }
  const weeks = new Map();
  for (const o of tables.orders.filter((o) => o.status === "paid")) {
    const c = tables.customers[Number(o.customerRef.slice(4)) - 1];
    const cohort = date(c.createdAt).slice(0, 7);
    const ageWeek = Math.floor((o.createdAt - c.createdAt) / (7 * DAY));
    const key = cohort + ":" + ageWeek;
    if (!weeks.has(key))
      weeks.set(key, {
        cohort,
        ageWeek,
        customers: new Set(),
        orders: 0,
        netSalesCents: 0,
      });
    const w = weeks.get(key);
    w.customers.add(c.customerRef);
    w.orders++;
    w.netSalesCents += o.netCents;
  }
  for (const w of weeks.values())
    add("retentionCohorts", {
      cohort: w.cohort,
      ageWeek: w.ageWeek,
      activeCustomers: w.customers.size,
      orders: w.orders,
      netSalesCents: w.netSalesCents,
      cohortCustomers: tables.customers.filter(
        (c) => date(c.createdAt).slice(0, 7) === w.cohort,
      ).length,
    });
  for (const [release, offset, service, description] of [
    ["checkout-2.7.3", 0, "checkout", "Baseline card checkout"],
    ["checkout-2.8.0", 104, "checkout", "3DS callback routing refactor"],
    ["checkout-2.8.1", 109, "checkout", "Restore Safari callback handling"],
    [
      "fulfillment-1.12.0",
      99,
      "fulfillment",
      "ParcelNorth Reno pickup schedule change",
    ],
  ])
    add("deployments", {
      release,
      deployedAt: START + offset * DAY,
      service,
      description,
    });
  for (let day = 0; day < DAYS; day++)
    for (let h = 0; h < 24; h++)
      for (const service of ["checkout", "fulfillment", "catalog"]) {
        const regression = service === "checkout" && day >= 104 && day <= 108;
        const backlog = service === "fulfillment" && day >= 99 && day <= 112;
        const requests = int(200, 1800);
        add("serviceMetrics", {
          timestamp: START + day * DAY + h * 3600000,
          service,
          requests,
          errors: Math.round(
            requests *
              (regression ? 0.12 : backlog ? 0.036 : 0.003) *
              (0.7 + rand() * 0.6),
          ),
          p50Ms: regression ? int(1400, 2500) : int(45, 160),
          p95Ms: regression
            ? int(9000, 15500)
            : backlog
              ? int(1200, 2400)
              : int(250, 780),
          queueDepth: backlog ? int(180, 550) : int(0, 35),
          release:
            service === "checkout"
              ? day >= 104
                ? day <= 108
                  ? "checkout-2.8.0"
                  : "checkout-2.8.1"
                : "checkout-2.7.3"
              : service === "fulfillment"
                ? "fulfillment-1.12.0"
                : "catalog-3.1.0",
        });
      }
  // Metric windows stop at the snapshot too, including the final partial day.
  tables.serviceMetrics = tables.serviceMetrics.filter(
    (r) => r.timestamp <= SNAPSHOT,
  );
  const counts = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, v.length]),
  );
  counts.datasetInfo = 1;
  add("datasetInfo", {
    key: "manifest",
    valueJson: JSON.stringify({
      company: "Meridian Supply",
      synthetic: true,
      fixture: FIXTURE,
      currency: "USD",
      timezone: "UTC",
      startDate: date(START),
      endDate: date(SNAPSHOT),
      snapshotAt: SNAPSHOT,
      counts,
      definitions: {
        netSales:
          "Paid merchandise after discounts, before tax and shipping charged. Refunds shown separately and attributed to the original order date.",
        contribution:
          "Net merchandise sales less product cost, fulfillment cost, payment fees, observed refunds and attributed marketing spend. Simplified contribution, not GAAP profit; excludes overhead and shipping charged.",
        fulfillment:
          "Grouped by order date. Delivered-late rate uses delivered orders only. Overdue open counts unreceived orders past their promise as of snapshot.",
        cohorts:
          "Signup-month cohorts; active purchasers by week since signup. Later weeks are right-censored, not zero retention.",
        timestamps:
          "Historical synthetic business events, not backdated Convex execution logs.",
      },
    }),
  });
  return tables;
}

const indexes = {
  customers: { by_ref: ["customerRef"] },
  products: { by_sku: ["sku"] },
  orders: {
    by_ref: ["orderRef"],
    by_created: ["createdAt"],
    by_customer: ["customerRef", "createdAt"],
  },
  orderItems: { by_order: ["orderRef"], by_sku: ["sku", "createdAt"] },
  paymentAttempts: { by_order: ["orderRef"], by_created: ["createdAt"] },
  shipments: { by_order: ["orderRef"], by_status: ["status", "createdAt"] },
  returns: { by_sku: ["sku", "requestedAt"] },
  supportTickets: { by_status: ["status", "createdAt"] },
  inventory: { by_sku: ["sku"] },
  marketingSpend: { by_date: ["date"] },
  dailyRevenue: { by_date: ["date"] },
  channelDaily: { by_date: ["date"] },
  checkoutDaily: { by_date: ["date"] },
  fulfillmentDaily: { by_date: ["date"] },
  productDaily: { by_sku: ["sku", "date"] },
  retentionCohorts: { by_cohort: ["cohort", "ageWeek"] },
  deployments: { by_time: ["deployedAt"] },
  serviceMetrics: { by_service: ["service", "timestamp"] },
  datasetInfo: { by_key: ["key"] },
};
export function schemaFor(tables) {
  const definitions = Object.entries(tables).map(([name, rows]) => {
    const fields = Object.fromEntries(
      [...new Set(rows.flatMap((r) => Object.keys(r)))].map((key) => {
        const types = [
          ...new Set(
            rows.map((r) => (r[key] === null ? "null" : typeof r[key])),
          ),
        ];
        const values = types
          .filter((t) => t !== "undefined")
          .map((t) => `v.${t}()`);
        let value =
          values.length === 1 ? values[0] : `v.union(${values.join(", ")})`;
        if (types.includes("undefined")) value = `v.optional(${value})`;
        return [key, value];
      }),
    );
    return `  ${name}: defineTable({\n${Object.entries(fields)
      .map(([k, v]) => `    ${k}: ${v},`)
      .join("\n")}\n  })${Object.entries(indexes[name] || {})
      .map(
        ([i, fields]) =>
          `.index(${JSON.stringify(i)}, ${JSON.stringify(fields)})`,
      )
      .join("")}`;
  });
  return (
    '// Generated from the deterministic fixture shapes by scripts/generate.mjs.\nimport { defineSchema, defineTable } from "convex/server";\nimport { v } from "convex/values";\n\nexport default defineSchema({\n' +
    definitions.join(",\n") +
    "\n});\n"
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tables = generate();
  await mkdir("data", { recursive: true });
  for (const [name, rows] of Object.entries(tables)) {
    await mkdir(`data/${name}`, { recursive: true });
    await writeFile(
      `data/${name}/documents.jsonl`,
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  }
  await writeFile("convex/schema.ts", schemaFor(tables));
  const counts = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, v.length]),
  );
  await writeFile("data/counts.json", JSON.stringify(counts, null, 2));
  console.log(
    JSON.stringify(
      { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) },
      null,
      2,
    ),
  );
}
