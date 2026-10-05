const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeDemoSessionId(sessionId: string) {
  const normalized = sessionId.trim().toLowerCase();
  if (!SESSION_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid browser session");
  }
  return normalized;
}

export function demoOwnerId(sessionId: string) {
  return `browser:${normalizeDemoSessionId(sessionId)}`;
}

export function demoVmSlug(sessionId: string) {
  return `convex-demo-${normalizeDemoSessionId(sessionId).replaceAll("-", "")}`;
}

export function demoVmDisplayName(sessionId: string) {
  return `convex-demo-${normalizeDemoSessionId(sessionId).slice(0, 8)}`;
}
