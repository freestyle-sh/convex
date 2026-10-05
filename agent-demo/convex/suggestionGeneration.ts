"use node";
import { Agent } from "@convex-dev/agent";
import { Output } from "ai";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { runtimeSettings } from "./lib/runtimeSettings";
import { languageModel, modelReasoning } from "./lib/languageModel";
import {
  materializeSuggestions,
  suggestedOutput,
  suggestionInstructions,
  type SuggestionContext,
} from "./lib/suggestions";

export const generate = internalAction({
  args: {
    cacheId: v.id("suggestions"),
    requestId: v.string(),
    context: v.string(),
  },
  handler: async (ctx, { cacheId, requestId, context }) => {
    let stage = "settings";
    try {
      const generation = await ctx.runQuery(internal.suggestions.generation, {
        cacheId,
        requestId,
      });
      if (!generation) return;
      const settings = await runtimeSettings(
        ctx,
        generation.project,
        generation.row.choice,
      );
      const agent = new Agent(components.agent, {
        name: "Project suggestions",
        languageModel: languageModel(
          settings.provider,
          settings.model,
          settings.modelKey,
        ),
        instructions: suggestionInstructions,
        storageOptions: { saveMessages: "none" },
        contextOptions: { recentMessages: 0, searchOtherThreads: false },
      });
      stage = "inference";
      const result = await agent.generateText(
        ctx,
        { userId: `project-suggestions:${generation.project._id}` },
        {
          prompt: JSON.stringify({
            now: new Date().toISOString(),
            context: JSON.parse(context),
            previousSuggestions: generation.row.prompts.map((p) => p.text),
          }),
          output: Output.object({ schema: suggestedOutput }),
          maxOutputTokens: 2000,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(45_000),
          ...(settings.provider === "convex"
            ? {
                providerOptions: {
                  convexGateway: { reasoning: modelReasoning(settings.model) },
                },
              }
            : {}),
        },
      );
      stage = "validation";
      const prompts = materializeSuggestions(
        result.output,
        JSON.parse(context) as SuggestionContext,
      );
      stage = "save";
      await ctx.runMutation(internal.suggestions.finish, {
        cacheId,
        requestId,
        prompts,
      });
    } catch (error) {
      console.warn(
        "SUGGESTIONS_FAILED",
        stage,
        error instanceof Error ? error.name : "UnknownError",
        error instanceof Error &&
          [
            "Unknown suggestion evidence.",
            "Duplicate suggestions.",
            "Model API key unavailable.",
          ].includes(error.message)
          ? error.message
          : "",
      );
      // Provider errors can contain request bodies and credentials. Keep them out of public state and logs.
      await ctx.runMutation(internal.suggestions.finish, {
        cacheId,
        requestId,
      });
    }
  },
});
