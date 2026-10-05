import { Freestyle } from "@freestyle-sh/convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server.js";
import type { ActionCtx } from "./_generated/server.js";
import {
  demoOwnerId,
  demoVmDisplayName,
  demoVmSlug,
  normalizeDemoSessionId,
} from "./session.js";

const freestyle = new Freestyle(components.freestyle);
const DEMO_SNAPSHOT_ID = "freestyle/busybox";
const DEMO_TTL_MS = 5 * 60 * 1_000;
const OPERATION_COOLDOWN_MS = 3_000;

const operationValidator = v.union(
  v.literal("create"),
  v.literal("start"),
  v.literal("pause"),
  v.literal("refresh"),
  v.literal("diagnostics"),
);

export const status = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await freestyle.get(ctx, {
      ownerId: demoOwnerId(sessionId),
      slug: demoVmSlug(sessionId),
    });
  },
});

export const activity = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const normalizedSessionId = normalizeDemoSessionId(sessionId);
    return await ctx.db
      .query("activity")
      .withIndex("by_session_created_at", (q) =>
        q.eq("sessionId", normalizedSessionId),
      )
      .order("desc")
      .take(8);
  },
});

export const beginOperation = internalMutation({
  args: { key: v.string(), operation: operationValidator },
  handler: async (ctx, { key, operation }) => {
    const now = Date.now();
    const guard = await ctx.db
      .query("guard")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (guard && now - guard.lastOperationAt < OPERATION_COOLDOWN_MS) {
      throw new Error("The live demo is busy. Try again in a few seconds.");
    }

    if (guard) {
      await ctx.db.patch(guard._id, { lastOperationAt: now });
    } else {
      await ctx.db.insert("guard", { key, lastOperationAt: now });
    }

    return operation;
  },
});

export const recordActivity = internalMutation({
  args: {
    operation: operationValidator,
    sessionId: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("activity", {
      ...args,
      sessionId: normalizeDemoSessionId(args.sessionId),
      summary: args.summary.slice(0, 500),
      createdAt: Date.now(),
    });
  },
});

async function logFailure(
  ctx: ActionCtx,
  operation: "create" | "start" | "pause" | "refresh" | "diagnostics",
  sessionId: string,
  error: unknown,
) {
  const summary = error instanceof Error ? error.message : String(error);
  await ctx.runMutation(internal.demo.recordActivity, {
    operation,
    sessionId,
    status: "error",
    summary,
  });
}

export const create = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const operation = "create" as const;
    const normalizedSessionId = normalizeDemoSessionId(sessionId);
    await ctx.runMutation(internal.demo.beginOperation, {
      key: "create:global",
      operation,
    });
    try {
      const args = {
        ownerId: demoOwnerId(normalizedSessionId),
        slug: demoVmSlug(normalizedSessionId),
      };
      let existing = await freestyle.get(ctx, args);
      const replacedSnapshot = Boolean(
        existing?.vmId && existing.remote?.snapshotId !== DEMO_SNAPSHOT_ID,
      );

      if (replacedSnapshot) {
        await freestyle.delete(ctx, args);
        existing = null;
      }

      const result = await freestyle.create(ctx, {
        ...args,
        displayName: demoVmDisplayName(normalizedSessionId),
        snapshotId: DEMO_SNAPSHOT_ID,
        ttlSeconds: 300,
        automaticRestart: false,
        firewall: { rules: [] },
        metadata: { project: "convex-component-demo", role: "demo" },
      });
      await ctx.scheduler.runAfter(DEMO_TTL_MS, internal.demo.expire, {
        sessionId: normalizedSessionId,
        vmId: result.vm.id,
      });
      await ctx.runMutation(internal.demo.recordActivity, {
        operation,
        sessionId: normalizedSessionId,
        status: "ok",
        summary: replacedSnapshot
          ? "Recreated the demo VM from freestyle/busybox."
          : existing
            ? "Reconciled the Convex record with the Freestyle API."
            : "Created and linked a BusyBox Freestyle VM.",
      });
      return result;
    } catch (error) {
      await logFailure(ctx, operation, normalizedSessionId, error);
      throw error;
    }
  },
});

export const expire = internalAction({
  args: { sessionId: v.string(), vmId: v.string() },
  handler: async (ctx, { sessionId, vmId }) => {
    const normalizedSessionId = normalizeDemoSessionId(sessionId);
    const args = {
      ownerId: demoOwnerId(normalizedSessionId),
      slug: demoVmSlug(normalizedSessionId),
    };
    const current = await freestyle.get(ctx, args);
    if (current?.vmId !== vmId) return;
    await freestyle.delete(ctx, args);
  },
});

export const control = action({
  args: {
    operation: v.union(
      v.literal("start"),
      v.literal("pause"),
      v.literal("refresh"),
    ),
    sessionId: v.string(),
  },
  handler: async (ctx, { operation, sessionId }) => {
    const normalizedSessionId = normalizeDemoSessionId(sessionId);
    await ctx.runMutation(internal.demo.beginOperation, {
      key: `session:${normalizedSessionId}`,
      operation,
    });
    try {
      const args = {
        ownerId: demoOwnerId(normalizedSessionId),
        slug: demoVmSlug(normalizedSessionId),
      };
      const result =
        operation === "start"
          ? await freestyle.start(ctx, args)
          : operation === "pause"
            ? await freestyle.pause(ctx, args)
            : await freestyle.refresh(ctx, args);
      await ctx.runMutation(internal.demo.recordActivity, {
        operation,
        sessionId: normalizedSessionId,
        status: "ok",
        summary:
          operation === "refresh"
            ? "Synced current VM state into Convex."
            : `${operation === "start" ? "Started" : "Paused"} the VM through the component.`,
      });
      return result;
    } catch (error) {
      await logFailure(ctx, operation, normalizedSessionId, error);
      throw error;
    }
  },
});

export const diagnostics = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const operation = "diagnostics" as const;
    const normalizedSessionId = normalizeDemoSessionId(sessionId);
    await ctx.runMutation(internal.demo.beginOperation, {
      key: `session:${normalizedSessionId}`,
      operation,
    });
    try {
      const args = {
        ownerId: demoOwnerId(normalizedSessionId),
        slug: demoVmSlug(normalizedSessionId),
      };
      const current = await freestyle.get(ctx, args);
      if (!current) throw new Error("Create the demo VM first.");
      if (current.remote?.state !== "running") {
        await freestyle.start(ctx, args);
      }
      const result = await freestyle.exec(ctx, {
        ...args,
        options: {
          command:
            "printf 'FREESTYLE VM / LIVE\\n\\n'; uname -srmo; printf '\\n'; id; printf '\\n'; sed -n '1,4p' /etc/os-release; printf '\\nUTC  '; date -u '+%Y-%m-%d %H:%M:%S'",
          timeoutMs: 30_000,
        },
      });
      await freestyle.refresh(ctx, args);
      await ctx.runMutation(internal.demo.recordActivity, {
        operation,
        sessionId: normalizedSessionId,
        status: "ok",
        summary: "Ran a fixed, read-only Linux diagnostic inside the VM.",
      });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        statusCode: result.statusCode ?? null,
      };
    } catch (error) {
      await logFailure(ctx, operation, normalizedSessionId, error);
      throw error;
    }
  },
});
