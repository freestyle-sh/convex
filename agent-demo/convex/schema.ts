import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { notebookCell } from "./lib/notebookAccess";
import { operationKind } from "./lib/operations";
import { suggestion } from "./lib/suggestions";
import { storedModelProvider, storedModelChoice } from "./lib/models";

export const permissions = v.object({
  readLogs: v.boolean(),
  runQueries: v.boolean(),
  analyze: v.boolean(),
  proposeChanges: v.boolean(),
});
export const trigger = v.union(
  v.literal("chat"),
  v.literal("cron"),
  v.literal("webhook"),
);
export default defineSchema({
  workspaces: defineTable({
    tokenHash: v.string(),
    freestyleKey: v.optional(v.string()),
    modelKey: v.optional(v.string()), // Legacy encrypted field; never used, removed on settings save.
    openrouterKey: v.optional(v.string()),
    modelProvider: v.optional(storedModelProvider),
    model: v.string(),
    snapshot: v.string(),
  }).index("by_token", ["tokenHash"]),
  projects: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    webhookSecret: v.optional(v.string()),
    name: v.string(),
    deploymentUrl: v.string(),
    keyPrefix: v.string(),
    connectionId: v.optional(v.id("connections")),
    connectionStatus: v.optional(
      v.union(v.literal("connected"), v.literal("disconnected")),
    ),
    verifiedAt: v.optional(v.number()),
    permissions,
    allowedQueries: v.array(v.string()),
    allowedMutations: v.array(v.string()),
    threadId: v.string(),
    intervalMinutes: v.number(),
    enabled: v.boolean(),
    cursor: v.number(),
    policyVersion: v.number(),
    activeRunId: v.optional(v.id("runs")), // Legacy field; new runs are scheduled per chat.
    lastRunAt: v.optional(v.number()),
    lastWebhookAt: v.optional(v.number()),
  })
    .index("by_deployment", ["deploymentUrl"])
    .index("by_thread", ["threadId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_deployment", ["workspaceId", "deploymentUrl"]),
  artifactPins: defineTable({
    projectId: v.id("projects"),
    threadId: v.string(),
    sourceId: v.string(),
    // Only server-validated notebook figures/tables are saved here.
    artifactJson: v.string(),
  })
    .index("by_project", ["projectId"])
    .index("by_thread", ["projectId", "threadId"]),
  artifactDocuments: defineTable({
    projectId: v.id("projects"),
    threadId: v.string(),
    sourceId: v.string(),
    currentVersionId: v.optional(v.id("artifactVersions")),
    nextVersion: v.number(),
    selectionRevision: v.number(),
    outputSourceIds: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId", "updatedAt"])
    .index("by_source", ["projectId", "threadId", "sourceId"]),
  artifactVersions: defineTable({
    artifactId: v.id("artifactDocuments"),
    number: v.number(),
    artifactJson: v.string(),
    label: v.string(),
    runId: v.optional(v.id("runs")),
    toolCallId: v.optional(v.string()),
    baseVersionId: v.optional(v.id("artifactVersions")),
  })
    .index("by_artifact", ["artifactId", "number"])
    .index("by_run_tool", ["runId", "toolCallId"]),
  suggestions: defineTable({
    projectId: v.id("projects"),
    modelKey: v.string(),
    choice: storedModelChoice,
    fingerprint: v.string(),
    state: v.union(
      v.literal("generating"),
      v.literal("ready"),
      v.literal("error"),
    ),
    requestId: v.string(),
    requestedAt: v.number(),
    updatedAt: v.number(),
    prompts: v.array(suggestion),
  }).index("by_project_model", ["projectId", "modelKey"]),
  connections: defineTable({
    projectId: v.id("projects"),
    remoteProjectId: v.number(),
    teamId: v.number(),
    deploymentName: v.string(),
    deploymentType: v.string(),
    encryptedToken: v.optional(v.string()),
    binding: v.string(),
    verifiedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
    tokenExpiresAt: v.optional(v.union(v.number(), v.null())),
    tokenExpiryCheckedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),
  credentialLeases: defineTable({
    connectionId: v.id("connections"),
    name: v.string(),
    kind: operationKind,
    proposalId: v.optional(v.id("proposals")),
    requestIndex: v.optional(v.number()),
    expiresAt: v.number(),
    state: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
      v.literal("cleanup_pending"),
    ),
  })
    .index("by_connection", ["connectionId"])
    .index("by_proposal", ["proposalId"]),
  conversations: defineTable({
    deletedAt: v.optional(v.number()),
    customTitle: v.optional(v.boolean()),
    modelChoice: v.optional(storedModelChoice),
    projectId: v.id("projects"),
    threadId: v.string(),
    title: v.string(),
    trigger,
    updatedAt: v.number(),
    lastRunId: v.optional(v.id("runs")),
  })
    .index("by_project", ["projectId", "updatedAt"])
    .index("by_thread", ["threadId"]),
  notebookImages: defineTable({
    key: v.string(),
    state: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    lock: v.string(),
    lockedUntil: v.number(),
    snapshotId: v.optional(v.string()),
  }).index("by_key", ["key"]),
  notebooks: defineTable({
    projectId: v.id("projects"),
    threadId: v.string(),
    policyVersion: v.number(),
    slug: v.string(),
    vmId: v.optional(v.string()),
    sandboxId: v.optional(v.id("sandboxes")),
    preloadVersion: v.optional(v.number()),
    state: v.union(
      v.literal("starting"),
      v.literal("ready"),
      v.literal("closed"),
    ),
    expiresAt: v.optional(v.number()),
    lock: v.optional(v.string()),
    lockedUntil: v.number(),
  }).index("by_thread", ["projectId", "threadId"]),
  networkBundles: defineTable({
    projectId: v.id("projects"),
    notebookId: v.id("notebooks"),
    notebookVmId: v.string(),
    policyVersion: v.number(),
    kind: operationKind,
    state: v.union(
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("claimed"),
      v.literal("closing"),
      v.literal("closed"),
    ),
    slug: v.string(),
    domain: v.string(),
    vmId: v.optional(v.string()),
    sandboxId: v.optional(v.id("sandboxes")),
    leaseId: v.optional(v.id("credentialLeases")),
    routeIds: v.array(v.string()),
    expiresAt: v.number(),
  }).index("by_notebook_kind", ["notebookId", "kind"]),
  runs: defineTable({
    artifactEdit: v.optional(
      v.object({
        artifactId: v.id("artifactDocuments"),
        baseVersionId: v.id("artifactVersions"),
        selectionRevision: v.number(),
      }),
    ),
    modelChoice: v.optional(storedModelChoice),
    projectId: v.id("projects"),
    conversationId: v.optional(v.id("conversations")),
    threadId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    approvalId: v.optional(v.id("proposals")),
    continuesRunId: v.optional(v.id("runs")),
    trigger,
    prompt: v.string(),
    state: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_thread", ["projectId", "threadId"])
    .index("by_project_state", ["projectId", "state"])
    .index("by_thread_state", ["projectId", "threadId", "state"]),
  logs: defineTable({
    projectId: v.id("projects"),
    eventId: v.string(),
    timestamp: v.number(),
    level: v.string(),
    functionPath: v.string(),
    message: v.string(),
    source: v.string(),
  })
    .index("by_project_time", ["projectId", "timestamp"])
    .index("by_time", ["timestamp"])
    .index("by_project_event", ["projectId", "eventId"]),
  findings: defineTable({
    projectId: v.id("projects"),
    runId: v.id("runs"),
    fingerprint: v.string(),
    title: v.string(),
    detail: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    evidence: v.array(v.string()),
    occurrences: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_run", ["runId"])
    .index("by_fingerprint", ["projectId", "fingerprint"]),
  proposals: defineTable({
    notebook: v.optional(notebookCell),
    notebookOutput: v.optional(v.any()),
    kind: v.optional(operationKind),
    oneTime: v.optional(v.boolean()),
    allowedActions: v.optional(v.array(v.string())),
    continuedAt: v.optional(v.number()),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    functionPath: v.string(),
    argsJson: v.string(),
    reason: v.string(),
    policyVersion: v.number(),
    expiresAt: v.number(),
    state: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("executed"),
      v.literal("rejected"),
      v.literal("uncertain"),
    ),
    result: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    executionStartedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_run", ["runId"]),
  receipts: defineTable({
    projectId: v.id("projects"),
    digest: v.string(),
    receivedAt: v.number(),
  })
    .index("by_digest", ["projectId", "digest"])
    .index("by_time", ["receivedAt"]),
  sandboxes: defineTable({
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    slug: v.string(),
    purpose: v.string(),
    credentialRef: v.string(),
    endpoint: v.string(),
    expiresAt: v.optional(v.number()),
    state: v.union(
      v.literal("provisioning"),
      v.literal("active"),
      v.literal("revoked"),
      v.literal("cleanup_pending"),
    ),
  })
    .index("by_project", ["projectId"])
    .index("by_run", ["runId"]),
});
