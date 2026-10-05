import { getServiceToken } from "convex/server";

export const gatewayMessages = {
  unavailable:
    "Convex Gateway is unavailable on this deployment. Host Monitor on Convex Cloud or link its local backend to a project with Gateway access. Anonymous local deployments cannot use Gateway.",
  disabled:
    "Convex Gateway is disabled for Monitor’s hosting team. It requires an eligible paid Convex plan with Gateway access. You can also choose OpenRouter.",
  error:
    "Could not verify Convex Gateway access. Try again, or choose OpenRouter.",
};
export type GatewayStatus = {
  state: "available" | keyof typeof gatewayMessages;
  message: string;
};
export async function gatewayStatus(): Promise<GatewayStatus> {
  try {
    // Discard the credential: only the Convex runtime owns token caching.
    await getServiceToken("ai-gateway");
    return {
      state: "available",
      message: "Deployment authorized. No model API key needed.",
    };
  } catch (error) {
    const detail =
      error instanceof Error ? `${error.name} ${error.message}` : String(error);
    const state =
      detail.includes("AiGatewayUnavailable") ||
      detail.includes("requires an authenticated local deployment")
        ? "unavailable"
        : detail.includes("AiGatewayDisabled")
          ? "disabled"
          : "error";
    return { state, message: gatewayMessages[state] };
  }
}
