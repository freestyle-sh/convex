import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { requireWorkspace, workspaceTokenHash } from "./lib/workspaces";
import { defaultModel, modelProvider, workspaceModel } from "./lib/models";

// A browser-created 256-bit capability owns only this workspace. No shared admin login.
export const open = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await workspaceTokenHash(token);
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return (
      existing?._id ??
      ctx.db.insert("workspaces", {
        tokenHash,
        modelProvider: defaultModel.provider,
        model: defaultModel.id,
        snapshot: "freestyle/ubuntu",
      })
    );
  },
});
export const authorize = internalQuery({
  args: { token: v.string() },
  handler: (ctx, { token }) => requireWorkspace(ctx, token),
});
export const settings = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const id = await requireWorkspace(ctx, token);
    const workspace = (await ctx.db.get(id))!;
    return {
      hasFreestyleKey: !!workspace.freestyleKey,
      hasOpenRouterKey: !!workspace.openrouterKey,
      modelProvider: workspaceModel(workspace).provider,
      model: workspaceModel(workspace).id,
      snapshot: workspace.snapshot,
    };
  },
});
export const get = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) => ctx.db.get(workspaceId),
});
export const saveSettings = internalMutation({
  args: {
    token: v.string(),
    freestyleKey: v.optional(v.union(v.string(), v.null())),
    openrouterKey: v.optional(v.union(v.string(), v.null())),
    modelProvider: v.optional(modelProvider),
    model: v.string(),
    snapshot: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await requireWorkspace(ctx, args.token);
    await ctx.db.patch(id, {
      model: args.model,
      ...(args.modelProvider !== undefined
        ? { modelProvider: args.modelProvider }
        : {}),
      snapshot: args.snapshot,
      ...(args.freestyleKey !== undefined
        ? { freestyleKey: args.freestyleKey ?? undefined }
        : {}),
      modelKey: undefined,
      ...(args.openrouterKey !== undefined
        ? { openrouterKey: args.openrouterKey ?? undefined }
        : {}),
    });
  },
});
export const saveWebhook = internalMutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    secret: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { token, projectId, secret }) => {
    const { authorizedProject } = await import("./lib/workspaces");
    await authorizedProject(ctx, token, projectId);
    await ctx.db.patch(projectId, { webhookSecret: secret ?? undefined });
  },
});
