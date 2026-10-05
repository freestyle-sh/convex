export type Permissions = {
  readLogs: boolean;
  runQueries: boolean;
  analyze: boolean;
  proposeChanges: boolean;
};
export type Policy = {
  enabled: boolean;
  permissions: Permissions;
  allowedQueries: string[];
  allowedMutations: string[];
  policyVersion: number;
};

export function deploymentOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)?\.convex\.cloud$/.test(
      url.hostname,
    ) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Use a deployment's https://name.convex.cloud URL.");
  }
  return url.origin;
}
export function keyPrefix(input: string): string {
  if (!/^TARGET_[A-Z][A-Z0-9_]{0,48}$/.test(input))
    throw new Error("Use a key prefix like TARGET_MY_APP.");
  return input;
}
export function functionPath(input: string): string {
  if (
    !/^[a-zA-Z0-9_/-]+:[a-zA-Z0-9_]+$/.test(input) ||
    input.includes("..") ||
    input.startsWith("_system/") ||
    input.startsWith("/")
  ) {
    throw new Error("Use an explicit function path like diagnostics:health.");
  }
  return input;
}
export function requirePermission(
  policy: Policy,
  permission: keyof Permissions,
) {
  // Read access is included for every enabled connection. Legacy read flags
  // remain in stored documents for compatibility, but no longer gate reads.
  if (
    !policy.enabled ||
    (permission !== "readLogs" &&
      permission !== "runQueries" &&
      !policy.permissions[permission])
  )
    throw new Error(`Permission denied: ${permission}`);
}
export function requireFunction(
  policy: Policy,
  kind: "query" | "mutation",
  path: string,
) {
  requirePermission(policy, kind === "query" ? "runQueries" : "proposeChanges");
  functionPath(path);
  if (kind === "mutation" && !policy.allowedMutations.includes(path))
    throw new Error("Function is not allowlisted.");
}
export function parseArgs(input: string): Record<string, unknown> {
  if (input.length > 16_000) throw new Error("Arguments are too large.");
  const value: unknown = JSON.parse(input);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Arguments must be a JSON object.");
  return value as Record<string, unknown>;
}
export function validateApproval(
  policy: Policy,
  proposal: {
    state: string;
    policyVersion: number;
    expiresAt: number;
    functionPath: string;
    oneTime?: boolean;
  },
  now: number,
) {
  if (proposal.state !== "pending")
    throw new Error("Proposal is no longer pending.");
  if (proposal.expiresAt <= now)
    throw new Error("Proposal expired. Ask for a new proposal.");
  if (policy.policyVersion !== proposal.policyVersion)
    throw new Error("Permissions changed. Ask for a new proposal.");
  if (!policy.enabled) throw new Error("Project access is paused.");
  if (!proposal.oneTime)
    requireFunction(policy, "mutation", proposal.functionPath);
}
