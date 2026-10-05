import { requireWorkspace, authorizedProject } from "./lib/workspaces";
import { Crons } from "@convex-dev/crons";
import {
  createThread,
  updateThreadMetadata,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { threadRun } from "./lib/runs";
import {
  resultSelection,
  resultSelectionValidator,
  promptWithSelection,
  type ResultSelection,
} from "./lib/resultSelection";
import { permissions } from "./schema";
import { deploymentOrigin, functionPath, keyPrefix } from "./lib/policy";
import {
  modelChoice,
  validateModel,
  defaultModel,
  workspaceModel,
  supportedModel,
  type ModelChoice,
} from "./lib/models";

const crons = new Crons(components.crons);
const configuration = {
  name: v.string(),
  deploymentUrl: v.string(),
  keyPrefix: v.string(),
  permissions,
  allowedQueries: v.array(v.string()),
  allowedMutations: v.array(v.string()),
  intervalMinutes: v.number(),
  enabled: v.boolean(),
};

async function authorizeThread(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  threadId: string,
  allowDeleted = false,
) {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found.");
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (
    conversation
      ? conversation.projectId !== projectId
      : project.threadId !== threadId
  )
    throw new Error("Project thread not found.");
  if (conversation?.deletedAt !== undefined && !allowDeleted)
    throw new Error("Chat not found.");
  return { project, conversation };
}

async function newConversation(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  title: string,
  trigger: "chat" | "cron" | "webhook",
  existingThreadId?: string,
) {
  const threadId =
    existingThreadId ?? (await createThread(ctx, components.agent, { title }));
  const conversationId = await ctx.db.insert("conversations", {
    projectId,
    threadId,
    title,
    trigger,
    updatedAt: Date.now(),
  });
  return { threadId, conversationId };
}

export async function enqueue(
  ctx: MutationCtx,
  project: Doc<"projects">,
  prompt: string,
  requestedThreadId?: string,
  requestedModel?: ModelChoice,
  approvalId?: Id<"proposals">,
  selection?: ResultSelection,
  artifactEdit?: Doc<"runs">["artifactEdit"],
): Promise<Id<"runs"> | null> {
  if (!project.enabled) throw new Error("Project is paused.");
  const threadId = requestedThreadId ?? project.threadId;
  const { conversation } = await authorizeThread(ctx, project._id, threadId);
  const running = await threadRun(ctx, project._id, threadId, "running");
  const workspace = project.workspaceId
    ? await ctx.db.get(project.workspaceId)
    : null;
  const selectedModel = validateModel(
    requestedModel ??
      supportedModel(conversation?.modelChoice) ??
      (workspace ? workspaceModel(workspace) : defaultModel),
  );
  const conversationId =
    conversation?._id ??
    (
      await newConversation(
        ctx,
        project._id,
        "New conversation",
        "chat",
        threadId,
      )
    ).conversationId;
  if (!conversation?.lastRunId && !conversation?.customTitle)
    await ctx.db.patch(conversationId, { title: prompt.trim().slice(0, 72) });
  // Persist the visible prompt immediately; evidence is added only to model context.
  const { messageId: promptMessageId } = await saveMessage(
    ctx,
    components.agent,
    {
      threadId,
      ...(approvalId ? { order: "next" as const } : {}),
      ...(approvalId
        ? {
            agentName: "Convex Monitor",
            message: {
              role: "assistant" as const,
              content: "Continuing with the approved result.",
            },
          }
        : { prompt: promptWithSelection(prompt.slice(0, 8000), selection) }),
    },
  );
  const runId = await ctx.db.insert("runs", {
    artifactEdit,
    approvalId,
    continuesRunId: running?._id,
    modelChoice: selectedModel,
    projectId: project._id,
    threadId,
    conversationId,
    promptMessageId,
    trigger: "chat",
    prompt: prompt.slice(0, 8000),
    state: "queued",
    startedAt: Date.now(),
  });
  await ctx.db.patch(conversationId, {
    modelChoice: selectedModel,
    lastRunId: runId,
    updatedAt: Date.now(),
  });
  await ctx.db.patch(project._id, {
    lastRunAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.investigate.run, { runId });
  return runId;
}

export const save = mutation({
  args: {
    token: v.string(),
    projectId: v.optional(v.id("projects")),
    ...configuration,
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx, args.token);
    if (!args.name.trim() || args.name.length > 80)
      throw new Error("Choose a project name of 1–80 characters.");
    if (
      !Number.isInteger(args.intervalMinutes) ||
      args.intervalMinutes < 5 ||
      args.intervalMinutes > 1440
    )
      throw new Error("Choose an interval between 5 and 1440 minutes.");
    if (args.allowedQueries.length > 30 || args.allowedMutations.length > 30)
      throw new Error("At most 30 functions per allowlist.");
    const config = {
      name: args.name.trim(),
      deploymentUrl: deploymentOrigin(args.deploymentUrl),
      keyPrefix: keyPrefix(args.keyPrefix),
      permissions: args.permissions,
      allowedQueries: args.allowedQueries.map(functionPath),
      allowedMutations: args.allowedMutations.map(functionPath),
      intervalMinutes: args.intervalMinutes,
      enabled: args.enabled,
    };
    let id = args.projectId;
    if (id) {
      const prior = await ctx.db.get(id);
      if (!prior || prior.workspaceId !== workspaceId)
        throw new Error("Project not found in this workspace.");
      if (prior.connectionStatus === "disconnected" && config.enabled)
        throw new Error("Reconnect this project before enabling access.");
      // A project record is a stable security boundary: changing the target requires a new connection.
      if (
        prior.deploymentUrl !== config.deploymentUrl ||
        prior.keyPrefix !== config.keyPrefix
      )
        throw new Error(
          "Create a new connection to change the target or key prefix.",
        );
      await ctx.db.patch(id, {
        ...config,
        policyVersion: prior.policyVersion + 1,
      });
    } else {
      if (
        (
          await ctx.db
            .query("projects")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .take(21)
        ).length >= 20
      )
        throw new Error("This demo supports up to 20 connected deployments.");
      const threadId = await createThread(ctx, components.agent, {
        title: config.name,
      });
      id = await ctx.db.insert("projects", {
        ...config,
        workspaceId,
        threadId,
        cursor: 0,
        policyVersion: 1,
      });
      await newConversation(ctx, id, "New conversation", "chat", threadId);
    }
    const name = `monitor-${id}`;
    if (await crons.get(ctx, { name })) await crons.delete(ctx, { name });
    return id;
  },
});
async function publicProject(
  ctx: QueryCtx,
  { webhookSecret, ...project }: Doc<"projects">,
) {
  const connection = project.connectionId
    ? await ctx.db.get(project.connectionId)
    : null;
  return {
    ...project,
    hasWebhookSecret: !!webhookSecret,
    tokenExpiresAt: connection?.tokenExpiresAt,
    tokenExpiryCheckedAt: connection?.tokenExpiryCheckedAt,
  };
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const workspaceId = await requireWorkspace(ctx, token);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(20);
    return Promise.all(projects.map((project) => publicProject(ctx, project)));
  },
});
export const conversations = query({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { token, projectId }) => {
    await authorizedProject(ctx, token, projectId);
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Project not found.");
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(100);
    const result = await Promise.all(
      rows.map(async (row) => ({
        modelChoice: supportedModel(row.modelChoice),
        projectId,
        threadId: row.threadId,
        title: row.title,
        trigger: row.trigger,
        updatedAt: row.updatedAt,
        lastRunId: row.lastRunId,
        state: (await threadRun(ctx, projectId, row.threadId, "running"))
          ? "running"
          : row.lastRunId
            ? ((await ctx.db.get(row.lastRunId))?.state ?? "complete")
            : "idle",
      })),
    );
    const defaultConversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread", (q) => q.eq("threadId", project.threadId))
      .unique();
    if (
      defaultConversation?.deletedAt === undefined &&
      !rows.some((row) => row.threadId === project.threadId)
    )
      result.push({
        modelChoice: undefined,
        lastRunId: undefined,
        projectId,
        threadId: project.threadId,
        title: "Project conversation",
        trigger: "chat",
        updatedAt: project._creationTime,
        state: "idle",
      });
    return result;
  },
});
export const newChat = mutation({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { token, projectId }) => {
    await authorizedProject(ctx, token, projectId);
    if (!(await ctx.db.get(projectId))) throw new Error("Project not found.");
    return (await newConversation(ctx, projectId, "New conversation", "chat"))
      .threadId;
  },
});
export const renameChat = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, { token, projectId, threadId, title }) => {
    await authorizedProject(ctx, token, projectId);
    const { project, conversation } = await authorizeThread(
      ctx,
      projectId,
      threadId,
    );
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 120)
      throw new Error("Use a name between 1 and 120 characters.");
    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: { title: trimmed },
    });
    if (conversation) {
      await ctx.db.patch(conversation._id, {
        title: trimmed,
        customTitle: true,
      });
    } else {
      await ctx.db.insert("conversations", {
        projectId,
        threadId,
        title: trimmed,
        customTitle: true,
        trigger: "chat",
        updatedAt: project._creationTime,
      });
    }
  },
});
export const deleteChat = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.string(),
  },
  handler: async (ctx, { token, projectId, threadId }) => {
    await authorizedProject(ctx, token, projectId);
    const { project, conversation } = await authorizeThread(
      ctx,
      projectId,
      threadId,
      true,
    );
    if (conversation?.deletedAt !== undefined)
      return { deleted: true as const };
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) =>
        q.eq("projectId", projectId).eq("threadId", threadId),
      )
      .collect();
    if (project.threadId === threadId) {
      runs.push(
        ...(await ctx.db
          .query("runs")
          .withIndex("by_thread", (q) =>
            q.eq("projectId", projectId).eq("threadId", undefined),
          )
          .collect()),
      );
    }
    const proposals = (
      await Promise.all(
        runs.map((run) =>
          ctx.db
            .query("proposals")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect(),
        ),
      )
    ).flat();
    // A small tombstone prevents legacy fallback and stale clients from
    // recreating this chat. Removing its runs revokes further execution and
    // makes queued jobs and late completion callbacks no-ops. Notebook cleanup
    // runs in the background so deletion does not wait for the current cell.
    const tombstone = {
      projectId,
      threadId,
      title: "",
      trigger: conversation?.trigger ?? ("chat" as const),
      updatedAt: conversation?.updatedAt ?? project._creationTime,
      deletedAt: Date.now(),
    };
    if (conversation) await ctx.db.replace(conversation._id, tombstone);
    else await ctx.db.insert("conversations", tombstone);
    for (const proposal of proposals) await ctx.db.delete(proposal._id);
    const pins = await ctx.db
      .query("artifactPins")
      .withIndex("by_thread", (q) =>
        q.eq("projectId", projectId).eq("threadId", threadId),
      )
      .collect();
    for (const pin of pins) await ctx.db.delete(pin._id);
    const documents = await ctx.db
      .query("artifactDocuments")
      .withIndex("by_source", (q) =>
        q.eq("projectId", projectId).eq("threadId", threadId),
      )
      .collect();
    for (const document of documents) {
      const versions = await ctx.db
        .query("artifactVersions")
        .withIndex("by_artifact", (q) => q.eq("artifactId", document._id))
        .collect();
      for (const version of versions) await ctx.db.delete(version._id);
      await ctx.db.delete(document._id);
    }
    for (const run of runs) {
      const findings = await ctx.db
        .query("findings")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      for (const finding of findings) await ctx.db.delete(finding._id);
      await ctx.db.delete(run._id);
    }
    if (runs.some((run) => run._id === project.activeRunId))
      await ctx.db.patch(projectId, { activeRunId: undefined });
    const notebooks = await ctx.db
      .query("notebooks")
      .withIndex("by_thread", (q) =>
        q.eq("projectId", projectId).eq("threadId", threadId),
      )
      .collect();
    for (const notebook of notebooks) {
      await ctx.runMutation(internal.notebooks.close, {
        notebookId: notebook._id,
      });
      await ctx.scheduler.runAfter(0, internal.notebookRuntime.cleanup, {
        notebookId: notebook._id,
        force: true,
      });
      const bundles = await ctx.db
        .query("networkBundles")
        .withIndex("by_notebook_kind", (q) => q.eq("notebookId", notebook._id))
        .collect();
      for (const bundle of bundles) {
        if (bundle.state === "closed") continue;
        await ctx.runMutation(internal.networkBundles.markClosing, {
          bundleId: bundle._id,
        });
        await ctx.scheduler.runAfter(0, internal.networkBundleRuntime.cleanup, {
          bundleId: bundle._id,
        });
      }
    }
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_project_model", (q) => q.eq("projectId", projectId))
      .collect();
    for (const suggestion of suggestions) await ctx.db.delete(suggestion._id);
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId,
    });
    return { deleted: true as const };
  },
});
export const chat = query({
  args: { token: v.string(), threadId: v.string() },
  handler: async (ctx, { token, threadId }) => {
    const workspaceId = await requireWorkspace(ctx, token);
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    if (conversation?.deletedAt !== undefined) return null;
    const project = conversation
      ? await ctx.db.get(conversation.projectId)
      : await ctx.db
          .query("projects")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId))
          .unique();
    // Unknown IDs and another workspace's chats have the same response.
    if (!project || project.workspaceId !== workspaceId) return null;
    return {
      project: await publicProject(ctx, project),
      projectId: project._id,
      threadId,
      title: conversation?.title ?? "Project conversation",
      trigger: conversation?.trigger ?? ("chat" as const),
      updatedAt: conversation?.updatedAt ?? project._creationTime,
      modelChoice: supportedModel(conversation?.modelChoice),
      lastRunId: conversation?.lastRunId,
      state: (await threadRun(ctx, project._id, threadId, "running"))
        ? "running"
        : conversation?.lastRunId
          ? ((await ctx.db.get(conversation.lastRunId))?.state ?? "complete")
          : "idle",
    };
  },
});
export const inspect = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { token, projectId, threadId }) => {
    await authorizedProject(ctx, token, projectId);
    if (
      threadId &&
      (await authorizeThread(ctx, projectId, threadId, true)).conversation
        ?.deletedAt !== undefined
    )
      return { runs: [], logs: [], findings: [], proposals: [], sandboxes: [] };
    const runs = await (
      threadId
        ? ctx.db
            .query("runs")
            .withIndex("by_thread", (q) =>
              q.eq("projectId", projectId).eq("threadId", threadId),
            )
        : ctx.db
            .query("runs")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
    )
      .order("desc")
      .take(30);
    // Include pre-conversation runs only in the legacy project's original thread.
    if (threadId && (await ctx.db.get(projectId))?.threadId === threadId) {
      const legacy = await ctx.db
        .query("runs")
        .withIndex("by_thread", (q) =>
          q.eq("projectId", projectId).eq("threadId", undefined),
        )
        .order("desc")
        .take(20);
      runs.push(...legacy);
    }
    const related = async <T>(
      byRun: (runId: Id<"runs">) => Promise<T[]>,
      byProject: () => Promise<T[]>,
    ) =>
      threadId
        ? (await Promise.all(runs.map((run) => byRun(run._id)))).flat()
        : byProject();
    return {
      runs,
      logs: await ctx.db
        .query("logs")
        .withIndex("by_project_time", (q) => q.eq("projectId", projectId))
        .order("desc")
        .take(80),
      findings: await related(
        (runId) =>
          ctx.db
            .query("findings")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(30),
        () =>
          ctx.db
            .query("findings")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .order("desc")
            .take(30),
      ),
      proposals: await related(
        (runId) =>
          ctx.db
            .query("proposals")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(30),
        () =>
          ctx.db
            .query("proposals")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .order("desc")
            .take(30),
      ),
      sandboxes: await related(
        (runId) =>
          ctx.db
            .query("sandboxes")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .take(30),
        () =>
          ctx.db
            .query("sandboxes")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .order("desc")
            .take(30),
      ),
    };
  },
});
export const messages = query({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await authorizedProject(ctx, args.token, args.projectId);
    if (
      (await authorizeThread(ctx, args.projectId, args.threadId, true))
        .conversation?.deletedAt !== undefined
    )
      return { page: [], isDone: true, continueCursor: "", streams: undefined };
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});
export const ask = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.optional(v.string()),
    prompt: v.string(),
    modelChoice: v.optional(modelChoice),
    selection: v.optional(resultSelectionValidator),
  },
  handler: async (ctx, args) => {
    await authorizedProject(ctx, args.token, args.projectId);
    if (!args.prompt.trim() || args.prompt.length > 8000)
      throw new Error("Enter a message of 1–8000 characters.");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found.");
    const selection = args.selection
      ? resultSelection.parse(args.selection)
      : undefined;
    return enqueue(
      ctx,
      project,
      args.prompt,
      args.threadId,
      args.modelChoice,
      undefined,
      selection,
    );
  },
});
// Keep the old callback safe while previously registered schedules are removed.
export const scheduled = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async () => null,
});
export const disableAutonomous = internalMutation({
  args: {},
  handler: async (ctx) => {
    let schedulesRemoved = 0,
      runsStopped = 0;
    for (const project of await ctx.db.query("projects").take(20)) {
      const name = `monitor-${project._id}`;
      if (await crons.get(ctx, { name })) {
        await crons.delete(ctx, { name });
        schedulesRemoved++;
      }
      const active = (
        await Promise.all(
          (["queued", "running"] as const).map((state) =>
            ctx.db
              .query("runs")
              .withIndex("by_project_state", (q) =>
                q.eq("projectId", project._id).eq("state", state),
              )
              .collect(),
          ),
        )
      ).flat();
      for (const run of active.filter((run) => run.trigger !== "chat")) {
        await ctx.runMutation(internal.projects.finishRun, {
          runId: run._id,
          error:
            "Automatic investigations are disabled. Send a message to continue.",
        });
        runsStopped++;
      }
    }
    return { schedulesRemoved, runsStopped };
  },
});
export const getInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: (ctx, { projectId }) => ctx.db.get(projectId),
});
export const claimRun = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.state !== "queued") return null;
    if (run.trigger !== "chat") {
      await ctx.runMutation(internal.projects.finishRun, {
        runId,
        error:
          "Automatic investigations are disabled. Send a message to continue.",
      });
      return null;
    }
    const project = await ctx.db.get(run.projectId);
    if (!project?.enabled) {
      await ctx.runMutation(internal.projects.finishRun, {
        runId,
        error: "Project is paused.",
      });
      return null;
    }
    const threadId = run.threadId ?? project.threadId;
    if (await threadRun(ctx, project._id, threadId, "running")) return null;
    const next = await threadRun(ctx, project._id, threadId, "queued");
    if (next?._id !== runId) return null;
    const startedAt = Date.now();
    await ctx.db.patch(runId, { state: "running", startedAt });
    await ctx.scheduler.runAfter(0, internal.networkBundleRuntime.warm, {
      runId,
    });
    await ctx.scheduler.runAfter(9 * 60_000, internal.projects.expireRun, {
      runId,
    });
    return { run: { ...run, state: "running" as const, startedAt }, project };
  },
});
export const finishRun = internalMutation({
  args: {
    runId: v.id("runs"),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    saveReply: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !["running", "queued"].includes(run.state)) return;
    await ctx.db.patch(run._id, {
      state: args.error ? "failed" : "complete",
      finishedAt: Date.now(),
      summary: args.summary?.slice(0, 6000),
      error: args.error,
    });
    if (run.conversationId)
      await ctx.db.patch(run.conversationId, { updatedAt: Date.now() });
    if (run.threadId && (args.error || args.saveReply)) {
      await saveMessage(ctx, components.agent, {
        threadId: run.threadId,
        promptMessageId: run.promptMessageId,
        agentName: "Convex Monitor",
        message: {
          role: "assistant",
          content: args.error ?? args.summary ?? "Check complete.",
        },
      });
    }
    const project = await ctx.db.get(run.projectId);
    if (project?.activeRunId === run._id)
      await ctx.db.patch(project._id, { activeRunId: undefined });
    if (project) {
      const next = await threadRun(
        ctx,
        project._id,
        run.threadId ?? project.threadId,
        "queued",
      );
      if (next) {
        if (!next.continuesRunId && !next.approvalId)
          await ctx.db.patch(next._id, { continuesRunId: run._id });
        await ctx.scheduler.runAfter(0, internal.investigate.run, {
          runId: next._id,
        });
      }
    }
  },
});
export const expireRun = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run?.state === "running" && run.startedAt <= Date.now() - 9 * 60_000)
      await ctx.runMutation(internal.projects.finishRun, {
        runId,
        error:
          "Investigation timed out. Completed notebook results remain in this chat. Ask to continue from them or choose another model.",
      });
  },
});

export const authorizeRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run?.state !== "running")
      throw new Error("Investigation no longer active.");
    const project = await ctx.db.get(run.projectId);
    if (!project?.enabled)
      throw new Error("Investigation no longer authorized.");
    return project;
  },
});

export const hasFollowup = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.state !== "running") return true;
    const project = await ctx.db.get(run.projectId);
    if (!project?.enabled) return true;
    return !!(await threadRun(
      ctx,
      project._id,
      run.threadId ?? project.threadId,
      "queued",
    ));
  },
});
