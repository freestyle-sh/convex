import { z } from "zod";
import { ConvexError } from "convex/values";
import { operationActions } from "./operations";
import { deploymentOrigin } from "./policy";

const numberId = z.number().int().nonnegative();
const projectSchema = z.object({
  id: numberId,
  teamId: numberId,
  name: z.string(),
  slug: z.string(),
  teamSlug: z.string(),
});
const deploymentSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  projectId: numberId,
  deploymentType: z.string(),
  deploymentUrl: z.string(),
  kind: z.literal("cloud"),
});
export type RemoteProject = z.infer<typeof projectSchema>;
export type RemoteDeployment = z.infer<typeof deploymentSchema>;
export const keyActions = operationActions;
export type CredentialKind = keyof typeof keyActions;
export const fail = (message: string): never => {
  throw new ConvexError(message);
};

// Never expose provider response bodies, request headers, or fetch errors: any can contain credentials.
export async function platformRequest(
  secret: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://api.convex.dev/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return fail("Convex could not be reached. Please try again.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      return fail(
        "Convex rejected this token. Create a team access token in Team Settings → Access Tokens.",
      );
    if (response.status === 403)
      return fail(
        "This token lacks permission. Connecting requires project and deployment access plus permission to create, view, and delete deployment keys. Production may require a Project Admin.",
      );
    if (response.status === 429)
      return fail(
        "Convex is rate limiting requests. Wait a moment and try again.",
      );
    return fail(
      `Convex returned HTTP ${response.status}. Check that the deployment still exists and try again.`,
    );
  }
  if (body !== undefined && path.endsWith("/delete_deploy_key")) {
    await response.body?.cancel();
    return null;
  }
  try {
    return await response.json();
  } catch {
    return fail("Convex returned an invalid response. Please try again.");
  }
}
export async function tokenTeam(secret: string) {
  if (secret.length < 20 || secret.length > 8192 || /\s/.test(secret))
    return fail("Enter a valid Convex team access token.");
  const result = z
    .object({ type: z.string(), teamId: numberId.optional() })
    .safeParse(await platformRequest(secret, "/token_details"));
  if (
    !result.success ||
    result.data.type !== "teamToken" ||
    result.data.teamId === undefined
  )
    return fail(
      "Use a team access token from Team Settings → Access Tokens. A deployment key cannot discover projects or provision new keys.",
    );
  return result.data.teamId;
}
export type TokenExpiry = { expiresAt?: number | null; checkedAt: number };
export async function readTokenExpiry(secret: string): Promise<TokenExpiry> {
  const checkedAt = Date.now();
  try {
    const details = z
      .object({ type: z.literal("teamToken"), id: numberId, teamId: numberId })
      .parse(await platformRequest(secret, "/token_details"));
    let cursor: string | undefined;
    const visited = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const result = z
        .object({
          items: z.array(
            z.object({
              id: numberId,
              expiresAt: z.number().int().nonnegative().nullable().optional(),
            }),
          ),
          pagination: z.object({
            hasMore: z.boolean(),
            nextCursor: z.string().nullable().optional(),
          }),
        })
        .parse(
          await platformRequest(
            secret,
            `/teams/${details.teamId}/list_access_tokens?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          ),
        );
      const current = result.items.find((item) => item.id === details.id);
      if (current)
        return {
          ...(current.expiresAt !== undefined
            ? { expiresAt: current.expiresAt }
            : {}),
          checkedAt,
        };
      if (
        !result.pagination.hasMore ||
        !result.pagination.nextCursor ||
        visited.has(result.pagination.nextCursor)
      )
        break;
      cursor = result.pagination.nextCursor;
      visited.add(cursor);
    }
  } catch {
    // Token-list permission can be unavailable even when project access works.
    // Unknown expiry must never be presented as "does not expire".
  }
  return { checkedAt };
}
export async function listProjects(secret: string, cursor?: string) {
  const teamId = await tokenTeam(secret);
  const result = z
    .object({
      items: z.array(projectSchema),
      pagination: z.object({
        hasMore: z.boolean(),
        nextCursor: z.string().nullable().optional(),
      }),
    })
    .safeParse(
      await platformRequest(
        secret,
        `/teams/${teamId}/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    );
  if (!result.success || result.data.items.some((p) => p.teamId !== teamId))
    return fail("Convex returned an unexpected project list.");
  return {
    projects: result.data.items,
    nextCursor: result.data.pagination.hasMore
      ? (result.data.pagination.nextCursor ?? null)
      : null,
  };
}
export async function getDeployments(secret: string, projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId < 0)
    return fail("Choose a valid project.");
  const teamId = await tokenTeam(secret);
  const project = projectSchema.safeParse(
    await platformRequest(secret, `/projects/${projectId}`),
  );
  if (
    !project.success ||
    project.data.id !== projectId ||
    project.data.teamId !== teamId
  )
    return fail("This project does not belong to the connected team.");
  const rows = z
    .array(z.unknown())
    .safeParse(
      await platformRequest(
        secret,
        `/projects/${projectId}/list_deployments?includeLocal=false`,
      ),
    );
  if (!rows.success)
    return fail("Convex returned an unexpected deployment list.");
  const deployments: RemoteDeployment[] = [];
  for (const row of rows.data) {
    if ((row as { kind?: string })?.kind === "local") continue;
    const parsed = deploymentSchema.safeParse(row);
    if (!parsed.success || parsed.data.projectId !== projectId)
      return fail("Convex returned an unexpected deployment.");
    const deployment = parsed.data;
    deployment.deploymentUrl = deploymentOrigin(deployment.deploymentUrl);
    if (
      new URL(deployment.deploymentUrl).hostname.split(".")[0] !==
      deployment.name
    )
      return fail("Deployment address does not match its name.");
    deployments.push(deployment);
  }
  return { project: project.data, deployments };
}
export async function revokeKey(
  secret: string,
  deployment: string,
  name: string,
) {
  await platformRequest(
    secret,
    `/deployments/${encodeURIComponent(deployment)}/delete_deploy_key`,
    { id: name },
  );
}
export async function createScopedKey(
  secret: string,
  deployment: string,
  name: string,
  kind: CredentialKind,
  expiresAt: number,
) {
  const response = z
    .object({ deployKey: z.string().min(1) })
    .safeParse(
      await platformRequest(
        secret,
        `/deployments/${encodeURIComponent(deployment)}/create_deploy_key`,
        { name, allowedActions: [...keyActions[kind]], expiresAt },
      ),
    );
  if (!response.success) return fail("Convex did not return a deployment key.");
  const key = response.data.deployKey;
  // OAuth can return its existing authority instead of minting a new scoped key.
  if (key.split("|").at(-1) === secret.split("|").at(-1))
    return fail(
      "Convex reused the connection token instead of creating a scoped key. Use a team access token from Team Settings → Access Tokens.",
    );
  const keys = z
    .array(
      z.object({
        name: z.string(),
        allowedActions: z.array(z.string()),
        expiresAt: z.number().nullable().optional(),
      }),
    )
    .safeParse(
      await platformRequest(
        secret,
        `/deployments/${encodeURIComponent(deployment)}/list_deploy_keys`,
      ),
    );
  const created = keys.success ? keys.data.find((k) => k.name === name) : null;
  if (
    !created ||
    created.allowedActions.length !== keyActions[kind].length ||
    !keyActions[kind].every((a) => created.allowedActions.includes(a)) ||
    !created.expiresAt ||
    created.expiresAt > expiresAt + 1000 ||
    created.expiresAt <= Date.now()
  )
    return fail(
      "Convex did not confirm the requested key permissions and expiry. The connection was not saved.",
    );
  return key;
}
export async function verifyLogs(origin: string, key: string) {
  let response: Response;
  try {
    response = await fetch(
      `${deploymentOrigin(origin)}/api/stream_function_logs?cursor=0`,
      {
        headers: { Authorization: `Convex ${key}` },
        redirect: "error",
        // Convex holds an empty log poll for 60 seconds before returning 200.
        signal: AbortSignal.timeout(75_000),
      },
    );
  } catch {
    return fail(
      "The deployment did not respond to the log access check. Try again.",
    );
  }
  const ok = response.ok;
  await response.body?.cancel();
  if (!ok)
    return fail(
      `The deployment denied log access (HTTP ${response.status}). Check its permissions and try again.`,
    );
}
