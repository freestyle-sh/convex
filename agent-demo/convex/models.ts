import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { requireWorkspace } from "./lib/workspaces";
import { getServiceToken } from "convex/server";
import { modelProvider, routedModelPresets } from "./lib/models";
import { gatewayStatus } from "./lib/gateway";
import { internal } from "./_generated/api";

export const access = action({
  args: { token: v.string(), provider: modelProvider },
  handler: async (
    ctx,
    { token, provider },
  ): Promise<{ ready: boolean; message: string }> => {
    const workspaceId = await requireWorkspace(ctx, token);
    const workspace = await ctx.runQuery(internal.workspaces.get, {
      workspaceId,
    });
    if (provider === "convex") {
      const gateway = await gatewayStatus();
      if (gateway.state !== "available")
        return { ready: false, message: gateway.message };
    } else if (!workspace?.openrouterKey) {
      return {
        ready: false,
        message: "Add your OpenRouter API key to send this message.",
      };
    }
    if (!workspace?.freestyleKey)
      return {
        ready: false,
        message: "Add your Freestyle API key to send this message.",
      };
    return { ready: true, message: "Ready to send." };
  },
});

export const gatewayAccess = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireWorkspace(ctx, token);
    return gatewayStatus();
  },
});

export const catalog = action({
  args: {
    token: v.string(),
    provider: v.optional(v.union(v.literal("openrouter"), v.literal("convex"))),
  },
  handler: async (ctx, { token, provider = "openrouter" }) => {
    await requireWorkspace(ctx, token);
    if (provider === "convex") {
      const access = await gatewayStatus();
      if (access.state !== "available") throw new ConvexError(access.message);
      try {
        const credential = await getServiceToken("ai-gateway");
        const response = await fetch(
          "https://ai-gateway.convex.dev/v1/models",
          {
            headers: { Authorization: `Bearer ${credential}` },
            signal: AbortSignal.timeout(15_000),
            redirect: "error",
          },
        );
        if (!response.ok) throw new Error("Unavailable");
        const result = z
          .object({ data: z.array(z.object({ id: z.string() })).max(5000) })
          .parse(await response.json());
        const available = new Set(result.data.map((m) => m.id));
        // Gateway's catalog has no tool/modality metadata. Offer known chat
        // presets present in that catalog; other tool-capable IDs can be entered.
        return routedModelPresets.filter((m) => available.has(m.id));
      } catch {
        throw new ConvexError(
          "Could not load Convex Gateway models. Try again, or enter a model ID.",
        );
      }
    }
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Unavailable");
      const result = z
        .object({
          data: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                created: z.number().finite().nonnegative().optional(),
                supported_parameters: z.array(z.string()).optional(),
                architecture: z
                  .object({ output_modalities: z.array(z.string()) })
                  .optional(),
              }),
            )
            .max(5000),
        })
        .parse(await response.json());
      return result.data
        .filter(
          (m) =>
            !m.id.endsWith(":batch") &&
            m.supported_parameters?.includes("tools") &&
            m.architecture?.output_modalities.includes("text"),
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          ...(m.created !== undefined ? { created: m.created } : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      throw new ConvexError(
        "Could not load OpenRouter models. Try again, or enter a model ID.",
      );
    }
  },
});
