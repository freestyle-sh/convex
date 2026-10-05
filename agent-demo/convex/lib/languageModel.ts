"use node";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import type { ModelChoice } from "./models";

export function modelReasoning(id: string) {
  // GLM Flash otherwise defaults to maximum reasoning on every tool step.
  return id === "z-ai/glm-5.3-flash" ? { effort: "low" as const } : undefined;
}

export function languageModel(
  provider: ModelChoice["provider"],
  id: string,
  apiKey?: string,
) {
  if (provider === "convex") return convexGateway(id);
  if (!apiKey) throw new Error("Model API key unavailable.");
  return createOpenRouter({ apiKey }).chat(id, {
    parallelToolCalls: false,
    reasoning: modelReasoning(id),
    // This endpoint returned corrupted tool arguments and empty final answers
    // in the orders investigation. Keep normal price-based routing elsewhere.
    provider:
      id === "z-ai/glm-5.3-flash" ? { ignore: ["open-inference"] } : undefined,
  });
}
