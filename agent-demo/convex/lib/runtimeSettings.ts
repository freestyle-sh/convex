"use node";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { openCredential } from "./credentials";
import { defaultModel, workspaceModel, type StoredModelChoice } from "./models";

export async function runtimeSettings(
  ctx: ActionCtx,
  project: Doc<"projects">,
  choice?: StoredModelChoice,
) {
  if (choice?.provider === "anthropic")
    throw new Error(
      "Direct Anthropic support was removed. Choose Convex Gateway or OpenRouter and send a new message.",
    );
  if (!project.workspaceId)
    return {
      freestyleKey: process.env.FREESTYLE_API_KEY,
      modelKey:
        choice?.provider === "openrouter"
          ? process.env.OPENROUTER_API_KEY
          : undefined,
      provider: choice?.provider ?? defaultModel.provider,
      model: choice?.id ?? defaultModel.id,
      snapshot: process.env.FREESTYLE_SNAPSHOT ?? "freestyle/ubuntu",
    };
  const workspace = await ctx.runQuery(internal.workspaces.get, {
    workspaceId: project.workspaceId,
  });
  if (!workspace) throw new Error("Workspace unavailable.");
  const selected = choice
    ? { provider: choice.provider, id: choice.id }
    : workspaceModel(workspace);
  const provider = selected.provider;
  const encrypted =
    provider === "openrouter" ? workspace.openrouterKey : undefined;
  return {
    freestyleKey: workspace.freestyleKey
      ? openCredential(workspace.freestyleKey, `${workspace._id}:freestyle`)
      : undefined,
    modelKey: encrypted
      ? openCredential(encrypted, `${workspace._id}:openrouter`)
      : undefined,
    provider,
    model: selected.id,
    snapshot: workspace.snapshot,
  };
}
