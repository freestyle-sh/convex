"use node";
import { v, ConvexError } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspace } from "./lib/workspaces";
import { sealCredential, openCredential } from "./lib/credentials";
import {
  modelProvider,
  validateModel,
  workspaceModel,
  defaultModel,
} from "./lib/models";

function key(value: string | null | undefined, binding: string) {
  if (value == null) return value;
  const trimmed = value.trim();
  if (trimmed.length < 12 || trimmed.length > 8192 || /\s/.test(trimmed))
    throw new ConvexError(
      "Enter a valid API key, or leave the field empty to keep the saved key.",
    );
  return sealCredential(trimmed, binding);
}
export const save = action({
  args: {
    token: v.string(),
    freestyleKey: v.optional(v.union(v.string(), v.null())),
    openrouterKey: v.optional(v.union(v.string(), v.null())),
    modelProvider: v.optional(modelProvider),
    model: v.string(),
    snapshot: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx, args.token);
    const model = args.model.trim(),
      snapshot = args.snapshot.trim();
    const workspace = await ctx.runQuery(internal.workspaces.get, {
      workspaceId,
    });
    const provider =
      args.modelProvider ??
      (workspace ? workspaceModel(workspace).provider : defaultModel.provider);
    validateModel({ provider, id: model });
    if (!/^[a-zA-Z0-9_./:-]{1,180}$/.test(snapshot))
      throw new ConvexError("Enter a valid Freestyle snapshot ID.");
    await ctx.runMutation(internal.workspaces.saveSettings, {
      token: args.token,
      freestyleKey: key(args.freestyleKey, `${workspaceId}:freestyle`),
      openrouterKey: key(args.openrouterKey, `${workspaceId}:openrouter`),
      modelProvider: provider,
      model,
      snapshot,
    });
  },
});
export const webhook = action({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    secret: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx, args.token);
    const project = await ctx.runQuery(internal.projects.getInternal, {
      projectId: args.projectId,
    });
    if (!project || project.workspaceId !== workspaceId)
      throw new ConvexError("Project not found in this workspace.");
    await ctx.runMutation(internal.workspaces.saveWebhook, {
      ...args,
      secret: key(args.secret, `${project._id}:webhook`)!,
    });
  },
});

export const webhookSecret = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<string | null> => {
    const project = await ctx.runQuery(internal.projects.getInternal, {
      projectId,
    });
    if (!project) return null;
    if (project.workspaceId)
      return project.webhookSecret
        ? openCredential(project.webhookSecret, `${project._id}:webhook`)
        : null;
    return process.env[project.keyPrefix + "_WEBHOOK_SECRET"] ?? null;
  },
});
