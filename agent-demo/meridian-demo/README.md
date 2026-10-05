# Meridian Supply

A fictional outdoor/travel retailer for testing Convexstyle with realistic, connected data. All people, purchases, payments, shipments, incidents and metrics are synthetic. Email addresses use `example.invalid`; no messages are sent and no payment providers are called.

- Cloud project: [Meridian Supply](https://dashboard.convex.dev/t/ben-eaae2/meridian-supply).
- Development deployment: `adjoining-barracuda-972` (`ben-eaae2:meridian-supply:dev/demo`).
- Dataset: `meridian-supply-v1`, deterministic seed `20261004`.
- Business window: June 7–October 4, 2026; snapshot **October 4 at 20:00 UTC**.
- Connected to the local Workbench app at http://127.0.0.1:5178/chats.

## Data

**146,233 documents across 19 tables.** There are 6,000 customers, 24 products, 25,721 orders, 46,380 order lines, 26,328 payment attempts, 24,977 shipments, 1,050 returns, 1,219 support tickets, 48 inventory positions, 720 marketing spend records, four releases, 8,631 service metrics, plus daily and cohort aggregates and a dataset manifest.

The 24,977 paid orders reconcile to **$4,305,142.92** net merchandise sales, **$117,010.58** observed refunds, and **$1,695,679.68** simplified contribution. Money is stored as integer USD cents. Foreign references such as `orderRef`, `customerRef` and `sku` have matching indexes; bulk import does not require generated Convex IDs.

Metric definitions:

- Net sales: paid merchandise after discounts, before taxes and shipping charged. Refunds are reported separately.
- Contribution: net sales less product cost, fulfillment cost, payment fees, observed refunds and attributed marketing spend. This is not GAAP profit; it excludes overhead and shipping charged.
- Refunds are attributed to original order dates. Recent orders have less return exposure.
- Delivered-late rates use delivered shipments as the denominator. Open-overdue shipments are separate; recent unreceived orders are right-censored.
- Retention means purchasing activity by signup cohort and week since signup; unavailable future weeks are not zeros.
- Historical business events are synthetic records. Actual Convex execution logs reflect calls made now.

## Discoverable stories

1. **Checkout regression:** Safari mobile fails disproportionately September 19–23 after `checkout-2.8.0`; `checkout-2.8.1` lands September 24. The incident is 195 failed checkouts out of 709 attempts (27.50%), versus 37/1,526 (2.42%) in the August 15–31 baseline.
2. **Growth without equivalent margin:** the AUTUMN25 paid-social campaign starts September 14. Discounting and acquisition spend drive revenue while compressing contribution margins.
3. **Delivery backlog:** Reno / ParcelNorth deteriorates from September 14, with late deliveries and support tickets. Use mature cohorts when comparing delivery rates.
4. **Stockout:** Trail Pack 28L has zero on-hand stock in Reno and reservations exceed stock in both warehouses. Inbound stock arrives October 12.
5. **Quality issue:** Summit Shell batch `SS-0826-B` has concentrated zipper failures. Compare batch counts and reasons without inventing an unobserved manufacturing cause.

## Query entry points

These are internal queries, accessed by the connected agent through scoped project credentials. All take `{}` except `analytics:order`, which takes `{ "orderRef": "MS-000001" }`.

| Function                | Complete coverage                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `analytics:overview`    | Manifest, exact counts, definitions and query guide                                                               |
| `analytics:revenue`     | 120 daily revenue/cost records                                                                                    |
| `analytics:channels`    | 720 channel-day records and 720 marketing records                                                                 |
| `analytics:checkout`    | 600 browser/device/day cohorts and four releases                                                                  |
| `analytics:fulfillment` | 720 warehouse/carrier/day cohorts, 48 stock positions, catalog; open-ticket examples are explicitly limited to 80 |
| `analytics:products`    | 2,879 product-day records and all 1,050 returns aggregated by SKU/batch/reason/status                             |
| `analytics:retention`   | 91 cohort/week records                                                                                            |
| `analytics:order`       | One order and its related items, payments and shipment                                                            |

The channels and products responses use compact `{columns, rows}` tables to fit the sandbox gateway's 256 KiB response cap. They do not sample the daily data. Convert each table in Jupyter with `pd.DataFrame(table['rows'], columns=table['columns'])`. In the returns aggregation, sum `returnedUnits`; counting grouped rows is not the number of returns. Customer/order-level return details remain in the raw `returns` table.

The 1,050 return records represent **1,181 returned units**. Each record carries the returned order-line quantity; dollar totals cover that full quantity. Live reads of all seven analytics queries were verified against the deployed data, with every response below the gateway limit.

## Demo conversations

- [Growth vs. margin](http://127.0.0.1:5178/chats/m971qs1bp9ppapvjxgx1gjjh298fq88j): weekly sales/contribution, campaign channel margins and comparison tables.
- [The September checkout incident](http://127.0.0.1:5178/chats/m975djeve8y675yamy93pvjybd8fpgkg): browser/device failure rates, releases and baseline/incident/recovery.
- [Delivery bottlenecks and stockout risks](http://127.0.0.1:5178/chats/m973xz0makzb5d4en0g6x8wyr18fp1jw): delivery trends, carrier/warehouse heatmap and stock shortlist.
- [Returns and the Summit Shell defect](http://127.0.0.1:5178/chats/m975q6r3yyjr8fsteyhgby8b5h8fp737): refund rates, reason breakdown and product shortlist.

These were generated through the real agent, notebook and credential-injection flow. Initial trials exposed an oversized-response issue in the fixture queries, now fixed with compact responses. The early attempts remain visible in chat history. Sonnet completed the checkout charts after GLM emitted tool markup without executing it.

The final review also corrected weighted margins, used equal 21-day campaign windows, and refreshed return quantities. Corrected artifact versions supersede initial model calculations; earlier chat answers remain as an execution history.

Pinned charts open with their own chat sidebar:

- [The Safari checkout incident](http://127.0.0.1:5178/artifacts/m575x56mqq3fytbtb7w5hvzx9s8fpj52)
- [Weekly sales and contribution](http://127.0.0.1:5178/artifacts/m571kaavgpf7ndhpksnnn7hdex8fq18x)
- [Why products come back](http://127.0.0.1:5178/artifacts/m574jec7vnvg09tdbrq4w98kxh8fp29v)
- [Where deliveries run late](http://127.0.0.1:5178/artifacts/m5702n9rt2wgydacktr5p8r9gh8fpegp)

Also see [The cost of AUTUMN25](http://127.0.0.1:5178/artifacts/m57755y644r056gxfbrwfdcc458fq9s1) and the [Product quality shortlist](http://127.0.0.1:5178/artifacts/m5759vs67ae21j0j48mqbzc0zs8fqbjw).

Good follow-ups: “Show only paid-social economics since September 14,” “Compare Safari mobile with all other devices,” “Which overdue shipments also have an open ticket?”, or “What would receiving 600 Trail Packs change?” The last can demonstrate an approval-backed write via `scenarios:receiveStock`.

## Reproduce

Requires Node 24 (native TypeScript stripping for the test helper), npm, Python 3 for ZIP packaging, and an authenticated Convex CLI. Credentials and generated data are gitignored.

```sh
npm ci
npm run generate
npm test
npm run typecheck
npm run bundle
npm run deploy:dev
```

Initial import into an **empty** selected development deployment:

```sh
npx convex import data/meridian-supply.zip --deployment adjoining-barracuda-972
npx convex run analytics:overview '{}' --deployment adjoining-barracuda-972
```

Do not repeat an append import on an already seeded deployment: it would duplicate business references and break reconciliation. Deliberately resetting this disposable fixture requires Convex's `--replace` mode against the exact intended development deployment.

Generate a bounded batch of genuine execution logs:

```sh
npx convex run scenarios:generateTraffic '{}' --deployment adjoining-barracuda-972
```

This makes 10 internal calls: three expected Safari callback errors, five healthy Chrome checks and two stock-reservation deficits. No recurring jobs are installed. `scenarios:receiveStock` only changes inventory in this exact demo deployment and accepts 1–2,000 units per call; it is intended for explicit user-approved mutation demonstrations.

Tests check referential/temporal integrity, exact monetary reconciliation, rollup totals, deterministic generation, incident signals, synthetic addresses, manifest counts and complete-query payload budgets.
