# Convex Monitor test target

A synthetic shop deployed to **convexstyle · dev**, `terrific-stingray-366`.
This is separate from Monitor's local backend and the sibling Freestyle VM demo.
All functions are internal: Monitor needs its normal scoped-key approval path
to inspect functions, query data, or execute a repair. No standing permissions
are changed. All customer addresses use `example.invalid`.

## Data and deliberately broken scenarios

- `demoCustomers`: 24 synthetic customers.
- `demoOrders`: 120 orders over five days, including 12 recent payment failures.
- `demoInventory`: 8 products, including an out-of-stock DOCK and low HEADPHONES/STAND stock.
- `demoJobs`: 40 jobs, including 5 exhausted retries and 3 stale worker heartbeats.
- `demoEvents`: 120 synthetic historical events, plus real test-run and repair records.

The historical timestamps are fixture data, not backdated Convex execution logs.
`monitorDemo:generateTraffic` produces **12 real Convex function invocations**
per call: initially 8 expected failures, 1 warning, and 3 successful checks.
It calls no payment, email, fulfillment, or other external services, and starts
no cron or recurring work. A separate mutation saves evidence of each outcome,
including failed mutations whose own writes would otherwise roll back.

## Try these prompts in Monitor

- “How is my project doing? Investigate the recent errors.”
- “Discover the functions and inspect monitorDemo:summary.”
- “Plot paid, pending, and failed orders over time using monitorDemo:ordersOverTime.”
- “Inspect the failed jobs and propose requeuing JOB-033.”
- “Restock DOCK by 20 units, ask me for approval, then verify the result.”

Read functions: `summary`, `recentErrors` (`limit` optional, max 100),
`ordersOverTime`, `inspectJobs`, and `inspectInventory`, all in `monitorDemo`.
Repairs: `monitorDemo:requeueJob` with `{ "jobRef": "JOB-033" }`, and
`monitorDemo:restock` with `{ "sku": "DOCK", "quantity": 20 }`.
These only change synthetic fixture records. Requeuing does not start a real worker.
After repairs, the traffic generator reflects the changed state, so it may produce
fewer errors. Payment failures remain deliberate fixture cases.

## Developer commands

From this directory, with existing Convex CLI authentication:

```sh
npm install
npm run deploy:dev
npm run seed
npm run traffic
npm run summary
```

`target.env` contains only the explicit development deployment selector, no secrets.
The write functions also verify the deployment URL at runtime. Seeding is
idempotent: it never resets existing fixtures or reverses repairs. Traffic is
bounded per invocation but appends 12 event rows each time it is run.

To regenerate fresh log evidence from Monitor, request the action
`monitorDemo:generateTraffic` with `{}` and approve its exact action card.
