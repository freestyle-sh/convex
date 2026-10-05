import type { UIMessage } from "@convex-dev/agent/react";

export function openRouterProviders(
  message: Pick<UIMessage, "role" | "parts">,
): string[] | undefined {
  if (message.role !== "assistant") return undefined;
  const providers = new Set<string>();
  let routed = false;
  for (const part of message.parts) {
    const metadata =
      "callProviderMetadata" in part
        ? part.callProviderMetadata
        : "providerMetadata" in part
          ? part.providerMetadata
          : undefined;
    const routing = metadata?.openrouter;
    if (!routing) continue;
    routed = true;
    const provider = routing.provider;
    if (typeof provider === "string" && provider.trim())
      providers.add(provider.trim());
  }
  // A response can include tool steps served by different providers.
  return routed ? [...providers] : undefined;
}
