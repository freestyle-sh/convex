"use node";
import { v, ConvexError } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/workspaces";
import {
  listProjects,
  getDeployments,
  createScopedKey,
  revokeKey,
  verifyLogs,
  fail,
  readTokenExpiry,
} from "./lib/platform";
import { openCredential, sealCredential } from "./lib/credentials";

const authorityArgs = {
  token: v.string(),
  accessToken: v.optional(v.string()),
  sourceProjectId: v.optional(v.id("projects")),
};
async function authority(
  ctx: ActionCtx,
  args: {
    token: string;
    accessToken?: string;
    sourceProjectId?: Id<"projects">;
  },
): Promise<{
  workspaceId: Id<"workspaces">;
  secret: string;
  connection?: Doc<"connections">;
}> {
  const workspaceId = await requireWorkspace(ctx, args.token);
  if (args.sourceProjectId) {
    if (args.accessToken !== undefined)
      return fail("Choose saved access or a new token, not both.");
    const project = await ctx.runQuery(internal.projects.getInternal, {
      projectId: args.sourceProjectId,
    });
    if (!project || project.workspaceId !== workspaceId)
      return fail("Project not found in this workspace.");
    if (
      !project.enabled ||
      project.connectionStatus !== "connected" ||
      !project.connectionId
    )
      return fail("Use an active connection or enter a new team token.");
    const connection = await ctx.runQuery(internal.connectionStore.get, {
      connectionId: project.connectionId,
    });
    if (!connection?.encryptedToken || connection.disconnectedAt)
      return fail("Reconnect this project before using its saved access.");
    return {
      workspaceId,
      secret: openCredential(connection.encryptedToken, connection.binding),
      connection,
    };
  }
  if (!args.accessToken?.trim())
    return fail("Enter a Convex team access token or choose saved access.");
  return {
    workspaceId,
    secret: args.accessToken.trim(),
    connection: undefined,
  };
}

async function sanitized<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    return fail(
      "Could not complete the connection. Check your credentials and try again.",
    );
  }
}
export const discover = action({
  args: {
    ...authorityArgs,
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return sanitized(async () => {
      const { secret } = await authority(ctx, args);
      // Validate storage before asking the customer to continue through discovery.
      sealCredential("configuration-check", "configuration-check");
      if ((args.cursor?.length ?? 0) > 2048)
        return fail("Invalid project cursor.");
      return listProjects(secret, args.cursor);
    });
  },
});
export const deployments = action({
  args: {
    ...authorityArgs,
    remoteProjectId: v.number(),
  },
  handler: async (ctx, args) => {
    return sanitized(async () => {
      const { secret } = await authority(ctx, args);
      return getDeployments(secret, args.remoteProjectId);
    });
  },
});
export const connect = action({
  args: {
    ...authorityArgs,
    remoteProjectId: v.number(),
    deploymentName: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"projects">> => {
    return sanitized(async () => {
      const { workspaceId, secret } = await authority(ctx, args);
      const binding = crypto.randomUUID();
      const encryptedToken = sealCredential(secret, binding);
      // Re-fetch all metadata. Browser-provided URLs or project labels are never trusted.
      const { project, deployments } = await getDeployments(
        secret,
        args.remoteProjectId,
      );
      const deployment = deployments.find(
        (d) => d.name === args.deploymentName,
      );
      if (!deployment)
        return fail("Choose a cloud deployment belonging to this project.");
      const name = `convex-monitor-check-${crypto.randomUUID()}`;
      const expiresAt = Date.now() + 31 * 60_000;
      let verificationFailure: unknown;
      try {
        const key = await createScopedKey(
          secret,
          deployment.name,
          name,
          "logs",
          expiresAt,
        );
        await verifyLogs(deployment.deploymentUrl, key);
      } catch (error) {
        verificationFailure = error;
      }
      // A unique key name avoids ever deleting the supplied team/OAuth credential.
      // Expiry bounds leaked authority if this action is interrupted before cleanup.
      try {
        await revokeKey(secret, deployment.name, name);
      } catch {
        const detail =
          verificationFailure instanceof ConvexError &&
          typeof verificationFailure.data === "string"
            ? `${verificationFailure.data} `
            : "";
        return fail(
          detail +
            "Could not confirm removal of the temporary verification key. Connection was not saved. Check deployment keys for a convex-monitor-check key; any newly created key expires within 31 minutes.",
        );
      }
      if (verificationFailure) throw verificationFailure;
      const expiry = await readTokenExpiry(secret);
      return ctx.runMutation(internal.connectionStore.saveVerified, {
        workspaceId,
        name: `${project.name} · ${deployment.deploymentType}`,
        deploymentUrl: deployment.deploymentUrl,
        remoteProjectId: project.id,
        teamId: project.teamId,
        deploymentName: deployment.name,
        deploymentType: deployment.deploymentType,
        encryptedToken,
        binding,
        tokenExpiresAt: expiry.expiresAt,
        tokenExpiryCheckedAt: expiry.checkedAt,
      });
    });
  },
});
export const refreshTokenExpiry = action({
  args: { token: v.string(), sourceProjectId: v.id("projects") },
  handler: (ctx, args) =>
    sanitized(async () => {
      const { secret, connection } = await authority(ctx, args);
      const expiry = await readTokenExpiry(secret);
      await ctx.runMutation(internal.connectionStore.updateTokenExpiry, {
        connectionId: connection!._id,
        binding: connection!.binding,
        ...expiry,
      });
      return expiry;
    }),
});
export const cleanupLease = internalAction({
  args: { leaseId: v.id("credentialLeases") },
  handler: async (ctx, { leaseId }) => {
    const context = await ctx.runQuery(internal.connectionStore.lease, {
      leaseId,
    });
    if (!context || context.lease.state === "revoked") return;
    let revoked = context.lease.expiresAt <= Date.now();
    if (!revoked && context.connection?.encryptedToken) {
      try {
        const secret = openCredential(
          context.connection.encryptedToken,
          context.connection.binding,
        );
        await revokeKey(
          secret,
          context.connection.deploymentName,
          context.lease.name,
        );
        revoked = true;
      } catch {
        /* Bounded retry until the native key expires. No secrets in logs. */
      }
    }
    await ctx.runMutation(internal.connectionStore.finishLease, {
      leaseId,
      revoked,
    });
  },
});
