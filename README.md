# Freestyle for Convex

Manage long-lived [Freestyle VMs](https://www.freestyle.sh/docs/vms) from Convex
actions while keeping a reactive record of each VM in Convex.

The component provides:

- idempotent VM creation with retry recovery;
- cached VM lifecycle and resource state for reactive queries;
- create, refresh, start, pause, resize, update, exec, snapshot, and delete
  helpers;
- explicit tenant isolation through an app-supplied `ownerId`; and
- protection against adopting an unrelated Freestyle VM with the same slug.

## Install

```sh
npm install @freestyle-sh/convex
```

Register the component in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import freestyle from "@freestyle-sh/convex/convex.config.js";

const app = defineApp();
app.use(freestyle);

export default app;
```

Set a Freestyle account API key on the Convex deployment:

```sh
npx convex env set FREESTYLE_API_KEY your-api-key
```

Create an API key from the [Freestyle dashboard](https://dash.freestyle.sh) or
with the CLI:

```sh
npx freestyle@latest login
npx freestyle@latest tokens create convex
```

## Create an authenticated API

Instantiate the component client in your app's `convex/` directory. Convex
components cannot authenticate your app's users, so the wrapper must derive
`ownerId` from trusted auth state. Do not accept `ownerId` as a client argument.

```ts
import { v } from "convex/values";
import { Freestyle } from "@freestyle-sh/convex";
import { components } from "./_generated/api.js";
import { action, query } from "./_generated/server.js";

const freestyle = new Freestyle(components.freestyle);

async function ownerId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const createWorkspace = action({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await freestyle.create(ctx, {
      ownerId: await ownerId(ctx),
      slug,
      snapshotId: "freestyle/ubuntu",
      idleTimeoutSeconds: 600,
      firewall: {
        rules: [{ action: "allow", source: {}, destination: { public: true } }],
      },
    });
  },
});

export const listWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    return await freestyle.list(ctx, { ownerId: await ownerId(ctx) });
  },
});
```

Freestyle has a default-deny network model, so `firewall` is required. Use
`{ rules: [] }` for an isolated VM, or declare only the traffic the workload
needs. See the [Freestyle quickstart](https://www.freestyle.sh/docs/quickstart)
for firewall examples.

## Lifecycle and commands

Mutating operations make external requests and must run in Convex actions:

```ts
await freestyle.start(ctx, { ownerId, slug });
await freestyle.pause(ctx, { ownerId, slug });

const result = await freestyle.exec(ctx, {
  ownerId,
  slug,
  options: { command: "git status --short", timeoutMs: 300_000 },
});

await freestyle.resize(ctx, {
  ownerId,
  slug,
  options: { cpu: 8, memory: 16 * 1024, storage: 80 * 1024 },
});

const snapshot = await freestyle.snapshot(ctx, {
  ownerId,
  slug,
  options: { slug: `${slug}-configured` },
});

await freestyle.delete(ctx, { ownerId, slug });
```

`get` and `list` read cached records and can run in reactive Convex queries.
Call `refresh` from an action when the application needs the current remote
state:

```ts
const cached = await freestyle.get(ctx, { ownerId, slug });
const current = await freestyle.refresh(ctx, { ownerId, slug });
```

## Creation and retries

`create` requires a stable Freestyle `slug`. The component reserves a Convex
record first and adds a random ownership marker to the VM's Freestyle metadata.
If the action is retried after the remote VM was created but before the Convex
record was linked, the client finds the VM by slug and verifies that marker
before linking it. A VM with the same slug and a different marker is rejected.
The component reserves the `convex_component_id` metadata key and one of
Freestyle's 64 VM metadata entries.

Freestyle slugs are account-wide. Two owners may use the same logical name in
Convex, but their remote VM slugs still need to be unique within the Freestyle
account. Prefix or hash tenant identifiers when generating slugs for a
multi-tenant app.

## Configuration

The constructor reads `FREESTYLE_API_KEY` from the consuming Convex app by
default. Explicit options support multiple Freestyle accounts and local API
testing:

```ts
const freestyle = new Freestyle(components.freestyle, {
  apiKey: process.env.SECONDARY_FREESTYLE_API_KEY,
  baseUrl: "https://api.freestyle.sh",
});
```

Each separately registered Convex component instance has its own tables. Each
`Freestyle` client may also use a different API key.

## Development

```sh
npm install
CONVEX_AGENT_MODE=anonymous npx convex init
npm run build:codegen
npx convex codegen --typecheck disable
npm test
npm run typecheck
npm run lint
npm run format:check
```

The full backend-only example is in [`example/convex`](./example/convex).
