import { v } from "convex/values";
import { Freestyle } from "@freestyle-sh/convex";
import { components } from "./_generated/api.js";
import { action, query } from "./_generated/server.js";

const freestyle = new Freestyle(components.freestyle);

async function requireOwnerId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const createWorkspace = action({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    return await freestyle.create(ctx, {
      ownerId,
      slug: args.slug,
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
    return await freestyle.list(ctx, { ownerId: await requireOwnerId(ctx) });
  },
});

export const runCommand = action({
  args: { command: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    return await freestyle.exec(ctx, {
      ownerId: await requireOwnerId(ctx),
      options: { command: args.command, timeoutMs: 300_000 },
      slug: args.slug,
    });
  },
});

export const pauseWorkspace = action({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await freestyle.pause(ctx, {
      ownerId: await requireOwnerId(ctx),
      slug: args.slug,
    });
  },
});

export const startWorkspace = action({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await freestyle.start(ctx, {
      ownerId: await requireOwnerId(ctx),
      slug: args.slug,
    });
  },
});

export const deleteWorkspace = action({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await freestyle.delete(ctx, {
      ownerId: await requireOwnerId(ctx),
      slug: args.slug,
    });
    return null;
  },
});
