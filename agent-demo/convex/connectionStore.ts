import { authorizedProject } from "./lib/workspaces";
import { v, ConvexError } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { deploymentOrigin } from "./lib/policy";
import type { Doc, Id } from "./_generated/dataModel";
import { operationKind, isReadOnly } from "./lib/operations";
import { hasActiveRuns } from "./lib/runs";

export const saveVerified = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    deploymentUrl: v.string(),
    remoteProjectId: v.number(),
    teamId: v.number(),
    deploymentName: v.string(),
    deploymentType: v.string(),
    encryptedToken: v.string(),
    binding: v.string(),
    tokenExpiresAt: v.optional(v.union(v.number(), v.null())),
    tokenExpiryCheckedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const url = deploymentOrigin(args.deploymentUrl);
    let project = await ctx.db
      .query("projects")
      .withIndex("by_workspace_deployment", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deploymentUrl", url),
      )
      .first();
    if (project) {
      const proposals = await ctx.db
        .query("proposals")
        .withIndex("by_project", (q) => q.eq("projectId", project!._id))
        .collect();
      if (proposals.some((p) => p.state === "executing"))
        throw new ConvexError(
          "Wait for the approved change to finish before replacing its connection.",
        );
    }
    if (project && (await hasActiveRuns(ctx, project._id)))
      throw new ConvexError(
        "Wait for the current investigation to finish before replacing its connection.",
      );
    if (project?.connectionId) {
      const leases = await ctx.db
        .query("credentialLeases")
        .withIndex("by_connection", (q) =>
          q.eq("connectionId", project!.connectionId!),
        )
        .collect();
      if (leases.some((l) => l.state !== "revoked" && l.expiresAt > Date.now()))
        throw new ConvexError(
          "A tool credential is still being cleaned up. Try reconnecting in a few minutes.",
        );
    }
    if (!project) {
      if (
        (
          await ctx.db
            .query("projects")
            .withIndex("by_workspace", (q) =>
              q.eq("workspaceId", args.workspaceId),
            )
            .take(20)
        ).length >= 20
      )
        throw new ConvexError("This demo supports up to 20 deployments.");
      const threadId = await createThread(ctx, components.agent, {
        title: args.name,
      });
      const id = await ctx.db.insert("projects", {
        workspaceId: args.workspaceId,
        name: args.name.slice(0, 80),
        deploymentUrl: url,
        keyPrefix: `TARGET_C_${args.binding.replaceAll("-", "").toUpperCase()}`,
        threadId,
        permissions: {
          readLogs: true,
          runQueries: true,
          analyze: true,
          proposeChanges: false,
        },
        allowedQueries: [],
        allowedMutations: [],
        intervalMinutes: 15,
        enabled: true,
        cursor: 0,
        policyVersion: 1,
      });
      await ctx.db.insert("conversations", {
        projectId: id,
        threadId,
        title: "New conversation",
        trigger: "chat",
        updatedAt: Date.now(),
      });
      project = (await ctx.db.get(id))!;
    }
    const fields = {
      projectId: project._id,
      remoteProjectId: args.remoteProjectId,
      teamId: args.teamId,
      deploymentName: args.deploymentName,
      deploymentType: args.deploymentType,
      encryptedToken: args.encryptedToken,
      binding: args.binding,
      tokenExpiresAt: args.tokenExpiresAt,
      tokenExpiryCheckedAt: args.tokenExpiryCheckedAt,
      verifiedAt: Date.now(),
    };
    const connectionId =
      project.connectionId ?? (await ctx.db.insert("connections", fields));
    if (project.connectionId)
      await ctx.db.patch(connectionId, {
        ...fields,
        disconnectedAt: undefined,
      });
    await ctx.db.patch(project._id, {
      connectionId,
      connectionStatus: "connected",
      permissions: {
        readLogs: true,
        runQueries: true,
        analyze: true,
        proposeChanges: false,
      },
      verifiedAt: fields.verifiedAt,
      enabled: true,
      policyVersion: project.policyVersion + 1,
    });
    return project._id;
  },
});
export const get = internalQuery({
  args: { connectionId: v.id("connections") },
  handler: (ctx, { connectionId }) => ctx.db.get(connectionId),
});
export const updateTokenExpiry = internalMutation({
  args: {
    connectionId: v.id("connections"),
    binding: v.string(),
    expiresAt: v.optional(v.union(v.number(), v.null())),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.binding !== args.binding ||
      connection.disconnectedAt
    )
      return;
    if (args.expiresAt === undefined) return;
    await ctx.db.patch(args.connectionId, {
      tokenExpiresAt: args.expiresAt,
      tokenExpiryCheckedAt: args.checkedAt,
    });
  },
});
export const startLease = internalMutation({
  args: {
    projectId: v.id("projects"),
    policyVersion: v.number(),
    name: v.string(),
    kind: operationKind,
    proposalId: v.optional(v.id("proposals")),
    requestIndex: v.optional(v.number()),
    expiresAt: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    leaseId: Id<"credentialLeases">;
    connection: Doc<"connections">;
  }> => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project?.connectionId ||
      !project.enabled ||
      project.connectionStatus !== "connected" ||
      project.policyVersion !== args.policyVersion
    )
      throw new ConvexError(
        "The project connection or permissions changed. Start a new request.",
      );
    if (args.proposalId) {
      const operation = await ctx.runQuery(
        internal.approvals.authorizeExecution,
        {
          proposalId: args.proposalId,
          projectId: project._id,
          requestIndex: args.requestIndex,
        },
      );
      if (operation.kind !== args.kind)
        throw new Error(
          "Credential scope does not match the approved operation.",
        );
      const prior = await ctx.db
        .query("credentialLeases")
        .withIndex("by_proposal", (q) => q.eq("proposalId", args.proposalId))
        .collect();
      if (prior.some((p) => p.requestIndex === args.requestIndex))
        throw new Error("This approval has already provisioned a credential.");
    } else if (!isReadOnly(args.kind)) {
      throw new Error("This operation requires a user approval.");
    }
    const connection = await ctx.db.get(project.connectionId);
    if (!connection?.encryptedToken || connection.disconnectedAt)
      throw new ConvexError("Reconnect this project before running tools.");
    const id = await ctx.db.insert("credentialLeases", {
      connectionId: project.connectionId,
      name: args.name,
      kind: args.kind,
      proposalId: args.proposalId,
      requestIndex: args.requestIndex,
      expiresAt: args.expiresAt,
      state: "pending",
    });
    await ctx.scheduler.runAfter(240_000, internal.connections.cleanupLease, {
      leaseId: id,
    });
    return { leaseId: id, connection };
  },
});
export const lease = internalQuery({
  args: { leaseId: v.id("credentialLeases") },
  handler: async (ctx, { leaseId }) => {
    const lease = await ctx.db.get(leaseId);
    if (!lease) return null;
    return { lease, connection: await ctx.db.get(lease.connectionId) };
  },
});
export const activateLease = internalMutation({
  args: { leaseId: v.id("credentialLeases"), policyVersion: v.number() },
  handler: async (ctx, { leaseId, policyVersion }) => {
    const lease = await ctx.db.get(leaseId);
    const connection = lease && (await ctx.db.get(lease.connectionId));
    const project = connection && (await ctx.db.get(connection.projectId));
    if (
      !lease ||
      lease.state !== "pending" ||
      !connection?.encryptedToken ||
      connection.disconnectedAt ||
      !project?.enabled ||
      project.policyVersion !== policyVersion
    )
      throw new ConvexError(
        "Project access changed while the credential was being created.",
      );
    if (lease.proposalId)
      await ctx.runQuery(internal.approvals.authorizeExecution, {
        proposalId: lease.proposalId,
        requestIndex: lease.requestIndex,
        projectId: project._id,
      });
    await ctx.db.patch(leaseId, { state: "active" });
  },
});
export const finishLease = internalMutation({
  args: { leaseId: v.id("credentialLeases"), revoked: v.boolean() },
  handler: async (ctx, { leaseId, revoked }) => {
    const lease = await ctx.db.get(leaseId);
    if (!lease || lease.state === "revoked") return;
    const expired = lease.expiresAt <= Date.now();
    await ctx.db.patch(leaseId, {
      state: revoked || expired ? "revoked" : "cleanup_pending",
    });
    if (!revoked && !expired)
      await ctx.scheduler.runAfter(60_000, internal.connections.cleanupLease, {
        leaseId,
      });
    const connection = await ctx.db.get(lease.connectionId);
    if (connection?.disconnectedAt) {
      const leases = await ctx.db
        .query("credentialLeases")
        .withIndex("by_connection", (q) =>
          q.eq("connectionId", lease.connectionId),
        )
        .collect();
      if (
        leases.every((l) => l.state === "revoked" || l.expiresAt <= Date.now())
      )
        await ctx.db.patch(connection._id, { encryptedToken: undefined });
    }
  },
});
export const disconnect = mutation({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { token, projectId }) => {
    await authorizedProject(ctx, token, projectId);
    const project = await ctx.db.get(projectId);
    if (!project?.connectionId)
      throw new ConvexError("This project has no managed connection.");
    // Refuse while a tool might be executing; revocation cannot undo an in-flight write.
    if (await hasActiveRuns(ctx, projectId))
      throw new ConvexError(
        "Wait for the current investigation to finish before disconnecting.",
      );
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    if (proposals.some((p) => p.state === "executing"))
      throw new ConvexError(
        "Wait for the approved change to finish before disconnecting.",
      );
    await ctx.db.patch(projectId, {
      enabled: false,
      connectionStatus: "disconnected",
      policyVersion: project.policyVersion + 1,
    });
    const leases = await ctx.db
      .query("credentialLeases")
      .withIndex("by_connection", (q) =>
        q.eq("connectionId", project.connectionId!),
      )
      .collect();
    const pending = leases.filter(
      (l) => l.state !== "revoked" && l.expiresAt > Date.now(),
    );
    await ctx.db.patch(project.connectionId, {
      disconnectedAt: Date.now(),
      ...(pending.length ? {} : { encryptedToken: undefined }),
    });
    for (const lease of pending)
      await ctx.scheduler.runAfter(0, internal.connections.cleanupLease, {
        leaseId: lease._id,
      });
    return { cleanupPending: pending.length > 0 };
  },
});
