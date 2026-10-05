import { v, ConvexError } from "convex/values";

export const modelProvider = v.union(
  v.literal("convex"),
  v.literal("openrouter"),
);
export const modelChoice = v.object({
  provider: modelProvider,
  id: v.string(),
});
export type ModelChoice = {
  provider: "convex" | "openrouter";
  id: string;
};
export const defaultModel: ModelChoice = {
  provider: "convex",
  id: "z-ai/glm-5.3-flash",
};
export type CatalogModel = { id: string; name: string; created?: number };
// Reviewed against OpenRouter's live tool-capable catalog on 2026-09-29.
// Start with GLM Flash, then current low-cost models before premium options.
export const routedModelPresets: CatalogModel[] = [
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { id: "xiaomi/mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna" },
  { id: "qwen/qwen3.8-flash", name: "Qwen3.8 Flash" },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5" },
  { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
];
export function sortCatalog(models: CatalogModel[]): CatalogModel[] {
  const rank = (id: string) => {
    const i = routedModelPresets.findIndex((m) => m.id === id);
    return i < 0 ? routedModelPresets.length : i;
  };
  return [...models].sort(
    (a, b) =>
      rank(a.id) - rank(b.id) ||
      (b.created ?? 0) - (a.created ?? 0) ||
      a.name.localeCompare(b.name),
  );
}
// Read historical runs without re-routing already queued work to a new provider.
export const storedModelProvider = v.union(
  modelProvider,
  v.literal("anthropic"),
);
export const storedModelChoice = v.object({
  provider: storedModelProvider,
  id: v.string(),
});
export type StoredModelChoice = {
  provider: ModelChoice["provider"] | "anthropic";
  id: string;
};
export function supportedModel(
  choice?: StoredModelChoice,
): ModelChoice | undefined {
  return !choice || choice.provider === "anthropic"
    ? undefined
    : { provider: choice.provider, id: choice.id };
}
export function workspaceModel(workspace: {
  modelProvider?: StoredModelChoice["provider"];
  model: string;
}): ModelChoice {
  return (
    supportedModel(
      workspace.modelProvider
        ? { provider: workspace.modelProvider, id: workspace.model }
        : undefined,
    ) ?? defaultModel
  );
}
export function validateModel(choice: ModelChoice): ModelChoice {
  const id = choice.id.trim();
  if (id.length > 160 || !/^~?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/-]+$/.test(id))
    throw new ConvexError(
      `Enter a${choice.provider === "openrouter" ? "n OpenRouter" : " Convex Gateway"} model ID such as z-ai/glm-5.3-flash.`,
    );
  return { provider: choice.provider, id };
}
