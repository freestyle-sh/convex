"use node";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireWorkspace } from "./lib/workspaces";
import { executeGrant } from "./lib/sandbox";
import { runtimeSettings } from "./lib/runtimeSettings";

export const logs = action({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx, args.token);
    const project = await ctx.runQuery(internal.projects.getInternal, {
      projectId: args.projectId,
    });
    if (!project || project.workspaceId !== workspaceId)
      throw new ConvexError("Project not found in this workspace.");
    if (!project.enabled || project.connectionStatus !== "connected")
      throw new ConvexError(
        "Enable a connected project before testing access.",
      );
    const settings = await runtimeSettings(ctx, project);
    if (!settings.freestyleKey)
      throw new ConvexError(
        "Add your Freestyle API key in Agent services first.",
      );
    try {
      const result = z
        .object({ entries: z.array(z.unknown()), newCursor: z.number() })
        .parse(await executeGrant(ctx, project, { kind: "logs", cursor: 0 }));
      // The check returns metadata only, without storing logs or calling a model.
      return { entries: result.entries.length, checkedAt: Date.now() };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(
        "The log check failed. Check your Freestyle key and snapshot in Agent services, or reconnect this project to refresh Convex access.",
      );
    }
  },
});
