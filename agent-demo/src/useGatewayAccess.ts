import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import type { GatewayStatus } from "../convex/lib/gateway";

export function useGatewayAccess(token: string, refreshKey?: boolean) {
  const check = useAction(api.models.gatewayAccess);
  const [status, setStatus] = useState<GatewayStatus>();
  const [checking, setChecking] = useState(true);
  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await check({ token }));
    } catch {
      setStatus({
        state: "error",
        message: "Could not check Gateway access. Try again.",
      });
    } finally {
      setChecking(false);
    }
  }, [check, token]);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);
  return { status, checking, refresh };
}
