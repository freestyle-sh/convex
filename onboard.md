# Onboard to Freestyle for Convex

Use this file when an agent is setting up `@freestyle-sh/convex` in a Convex
project.

## 1. Onboard to Freestyle

Fetch and follow the complete Freestyle onboarding guide:

https://www.freestyle.sh/docs/onboard.md

That guide installs the current Freestyle documentation as an agent skill. Use
it for Freestyle API decisions instead of relying on remembered interfaces.

Log in and create an API key if the project does not already have one:

```sh
npx freestyle@latest login
npx freestyle@latest tokens create convex
```

Do not commit the returned key.

## 2. Onboard to Convex

Install Convex's current agent instructions and skills from the project root:

```sh
npx convex ai-files install
```

If this is a new project, scaffold Convex first:

```sh
npm create convex@latest
```

Then start or connect the development deployment:

```sh
npx convex dev
```

See the official
[Convex guide for Codex](https://docs.convex.dev/ai/using-codex) for the current
agent workflow.

## 3. Install and register the component

```sh
npm install @freestyle-sh/convex freestyle@latest
```

Register it in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import freestyle from "@freestyle-sh/convex/convex.config.js";

const app = defineApp();
app.use(freestyle);

export default app;
```

Store the Freestyle key in the Convex deployment:

```sh
npx convex env set FREESTYLE_API_KEY your-api-key
```

Read this repository's [README](./README.md) before exposing VM actions. The
application must derive `ownerId` from trusted authentication, and every VM
creation call must include an explicit firewall policy.
