import { listUIMessages, toUIMessages } from "@convex-dev/agent";
import { getToolName, isToolUIPart } from "ai";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { enqueue } from "./projects";
import { modelChoice } from "./lib/models";
import {
  resultSelection,
  resultSelectionValidator,
} from "./lib/resultSelection";
import { notebookResult } from "./lib/notebook";
import { authorizedProject, requireWorkspace } from "./lib/workspaces";
import { resultItems, type Artifact } from "./lib/artifacts";

async function chatArtifacts(
  ctx: QueryCtx,
  chat: { threadId: string; title: string },
  messageId?: string,
): Promise<Artifact[]> {
  const args = {
    threadId: chat.threadId,
    paginationOpts: {
      numItems: 40,
      cursor: null,
      maximumBytesRead: 500_000,
    },
  };
  const messages = messageId
    ? toUIMessages(
        (
          await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
            ...args,
            order: "desc",
            upToAndIncludingMessageId: messageId,
          })
        ).page,
      )
    : (await listUIMessages(ctx, components.agent, args)).page;
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      resultItems(
        message.parts.filter(isToolUIPart).map((part) => ({
          id: part.toolCallId,
          name: getToolName(part),
          state: part.state,
          output: "output" in part ? part.output : undefined,
        })),
      ).map((item) => ({
        threadId: chat.threadId,
        threadTitle: chat.title,
        createdAt: message._creationTime,
        messageId: message.id,
        item,
      })),
    );
}

export const recent = query({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { token, projectId }) => {
    await authorizedProject(ctx, token, projectId);
    const chats = await ctx.db
      .query("conversations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(12);
    const documents = await ctx.db
      .query("artifactDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
    const current = (
      await Promise.all(
        documents.map((document) => currentArtifact(ctx, document)),
      )
    ).filter((a): a is Artifact => a !== null);
    const managedSources = new Set(
      documents.flatMap((document) =>
        [document.sourceId, ...document.outputSourceIds].map(
          (sourceId) => `${document.threadId}:${sourceId}`,
        ),
      ),
    );
    const groups = await Promise.all(
      chats.map(async (chat) => {
        return chatArtifacts(ctx, chat);
      }),
    );
    const artifacts: Artifact[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    // Return only validated figure/table data, never notebook code or credentials.
    // Bound the gallery independently of the number/size of previous tool calls.
    for (const artifact of [
      ...current,
      ...groups
        .flat()
        .filter((a) => !managedSources.has(`${a.threadId}:${a.item.sourceId}`)),
    ].sort((a, b) => b.createdAt - a.createdAt)) {
      const key = `${artifact.threadId}:${artifact.rootSourceId ?? artifact.item.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const size = new TextEncoder().encode(JSON.stringify(artifact)).length;
      if (bytes + size > 800_000) continue;
      artifacts.push(artifact);
      bytes += size;
      if (artifacts.length === 12) break;
    }
    return artifacts;
  },
});

export const pinned = query({
  args: { token: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { token, projectId }) => {
    await authorizedProject(ctx, token, projectId);
    const pins = await ctx.db
      .query("artifactPins")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return Promise.all(
      pins.map(async (pin) => {
        const document = await findDocument(
          ctx,
          projectId,
          pin.threadId,
          pin.sourceId,
        );
        return document
          ? ((await currentArtifact(ctx, document)) ??
              (JSON.parse(pin.artifactJson) as Artifact))
          : (JSON.parse(pin.artifactJson) as Artifact);
      }),
    );
  },
});

export const setPinned = mutation({
  args: {
    token: v.string(),
    projectId: v.id("projects"),
    threadId: v.string(),
    sourceId: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    await authorizedProject(ctx, args.token, args.projectId);
    const pins = await ctx.db
      .query("artifactPins")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const existing = pins.find(
      (pin) => pin.threadId === args.threadId && pin.sourceId === args.sourceId,
    );
    if (!args.pinned) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) return;
    const chat = await ctx.db
      .query("conversations")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !chat ||
      chat.projectId !== args.projectId ||
      chat.deletedAt !== undefined
    )
      throw new ConvexError("The source chat is no longer available.");
    const document = await findDocument(
      ctx,
      args.projectId,
      args.threadId,
      args.sourceId,
    );
    const artifact = document
      ? await currentArtifact(ctx, document)
      : (await chatArtifacts(ctx, chat)).find(
          (a) => a.item.sourceId === args.sourceId,
        );
    if (!artifact)
      throw new ConvexError(
        "This result is no longer in the recent list. Reopen the chat to find it.",
      );
    const artifactJson = JSON.stringify(artifact);
    if (
      pins.length >= 12 ||
      new TextEncoder().encode(
        artifactJson + pins.map((pin) => pin.artifactJson).join(""),
      ).length > 800_000
    )
      throw new ConvexError(
        "Your pinned collection is full. Unpin an artifact first.",
      );
    await ctx.db.insert("artifactPins", {
      projectId: args.projectId,
      threadId: args.threadId,
      sourceId: args.sourceId,
      artifactJson,
    });
  },
});

const sourceArgs = {
  token: v.string(),
  projectId: v.id("projects"),
  threadId: v.string(),
  sourceId: v.string(),
};
async function findDocument(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  threadId: string,
  sourceId: string,
) {
  const exact = await ctx.db
    .query("artifactDocuments")
    .withIndex("by_source", (q) =>
      q
        .eq("projectId", projectId)
        .eq("threadId", threadId)
        .eq("sourceId", sourceId),
    )
    .unique();
  if (exact) return exact;
  // Opening a later version from chat must return to the same artifact.
  return (
    (
      await ctx.db
        .query("artifactDocuments")
        .withIndex("by_source", (q) =>
          q.eq("projectId", projectId).eq("threadId", threadId),
        )
        .collect()
    ).find((document) => document.outputSourceIds.includes(sourceId)) ?? null
  );
}
async function currentArtifact(
  ctx: QueryCtx,
  document: Doc<"artifactDocuments">,
): Promise<Artifact | null> {
  const version = document.currentVersionId
    ? await ctx.db.get(document.currentVersionId)
    : null;
  if (!version) return null;
  return {
    ...(JSON.parse(version.artifactJson) as Artifact),
    rootSourceId: document.sourceId,
  };
}
async function ownedDocument(
  ctx: QueryCtx,
  token: string,
  artifactId: Id<"artifactDocuments">,
) {
  const document = await ctx.db.get(artifactId);
  if (!document) throw new ConvexError("Artifact no longer available.");
  await authorizedProject(ctx, token, document.projectId);
  return document;
}
async function ensureDocument(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    threadId: string;
    sourceId: string;
    messageId?: string;
  },
) {
  const existing = await findDocument(
    ctx,
    args.projectId,
    args.threadId,
    args.sourceId,
  );
  if (existing) return existing;
  const chat = await ctx.db
    .query("conversations")
    .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
    .unique();
  if (
    !chat ||
    chat.projectId !== args.projectId ||
    chat.deletedAt !== undefined
  )
    throw new ConvexError("The source chat is no longer available.");
  const pin = (
    await ctx.db
      .query("artifactPins")
      .withIndex("by_thread", (q) =>
        q.eq("projectId", args.projectId).eq("threadId", args.threadId),
      )
      .collect()
  ).find((pin) => pin.sourceId === args.sourceId);
  const original = pin
    ? (JSON.parse(pin.artifactJson) as Artifact)
    : (await chatArtifacts(ctx, chat, args.messageId)).find(
        (a) => a.item.sourceId === args.sourceId,
      );
  if (!original)
    throw new ConvexError(
      "This artifact is no longer available. Reopen it from the gallery.",
    );
  const id = await ctx.db.insert("artifactDocuments", {
    projectId: args.projectId,
    threadId: args.threadId,
    sourceId: args.sourceId,
    nextVersion: 2,
    selectionRevision: 0,
    outputSourceIds: [],
    updatedAt: original.createdAt,
  });
  const versionId = await ctx.db.insert("artifactVersions", {
    artifactId: id,
    number: 1,
    artifactJson: JSON.stringify(original),
    label: "Original",
  });
  await ctx.db.patch(id, { currentVersionId: versionId });
  return (await ctx.db.get(id))!;
}

export const open = mutation({
  args: { ...sourceArgs, messageId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await authorizedProject(ctx, args.token, args.projectId);
    const document = await ensureDocument(ctx, args);
    return document._id;
  },
});

export const get = query({
  args: { token: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx, args.token);
    const id = ctx.db.normalizeId("artifactDocuments", args.artifactId);
    const document = id ? await ctx.db.get(id) : null;
    if (!document) return null;
    const project = await ctx.db.get(document.projectId);
    if (project?.workspaceId !== workspaceId) return null;
    const chat = await ctx.db
      .query("conversations")
      .withIndex("by_thread", (q) => q.eq("threadId", document.threadId))
      .unique();
    if (!chat || chat.deletedAt !== undefined || chat.projectId !== project._id)
      return null;
    return currentArtifact(ctx, document);
  },
});
export const history = query({
  args: sourceArgs,
  handler: async (ctx, args) => {
    await authorizedProject(ctx, args.token, args.projectId);
    const document = await findDocument(
      ctx,
      args.projectId,
      args.threadId,
      args.sourceId,
    );
    if (!document) return null;
    const versions = await ctx.db
      .query("artifactVersions")
      .withIndex("by_artifact", (q) => q.eq("artifactId", document._id))
      .order("desc")
      .take(50);
    return {
      artifactId: document._id,
      currentVersionId: document.currentVersionId,
      artifact: await currentArtifact(ctx, document),
      versions: versions.map((version) => ({
        id: version._id,
        number: version.number,
        label: version.label,
        createdAt: version._creationTime,
        baseVersionId: version.baseVersionId,
      })),
    };
  },
});
export const selectVersion = mutation({
  args: {
    token: v.string(),
    artifactId: v.id("artifactDocuments"),
    versionId: v.id("artifactVersions"),
  },
  handler: async (ctx, args) => {
    const document = await ownedDocument(ctx, args.token, args.artifactId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.artifactId !== document._id)
      throw new ConvexError("Version not found for this artifact.");
    if (document.currentVersionId === version._id) return;
    await ctx.db.patch(document._id, {
      currentVersionId: version._id,
      selectionRevision: document.selectionRevision + 1,
    });
  },
});
export const ask = mutation({
  args: {
    ...sourceArgs,
    prompt: v.string(),
    modelChoice: v.optional(modelChoice),
    selection: v.optional(resultSelectionValidator),
    baseVersionId: v.optional(v.id("artifactVersions")),
  },
  handler: async (ctx, args): Promise<Id<"runs"> | null> => {
    const project = await authorizedProject(ctx, args.token, args.projectId);
    if (!args.prompt.trim() || args.prompt.length > 8000)
      throw new ConvexError("Enter a message of 1–8000 characters.");
    const existing = await findDocument(
      ctx,
      args.projectId,
      args.threadId,
      args.sourceId,
    );
    if (existing && existing.currentVersionId !== args.baseVersionId)
      throw new ConvexError(
        "This artifact changed. Review the displayed version and send again.",
      );
    if (!existing && args.baseVersionId)
      throw new ConvexError("Version not found for this artifact.");
    const document =
      existing ??
      (await ensureDocument(ctx, {
        projectId: args.projectId,
        threadId: args.threadId,
        sourceId: args.sourceId,
      }));
    const selection = args.selection
      ? resultSelection.parse({
          ...args.selection,
          sourceId: document.sourceId,
        })
      : undefined;
    return enqueue(
      ctx,
      project,
      args.prompt,
      args.threadId,
      args.modelChoice,
      undefined,
      selection,
      {
        artifactId: document._id,
        baseVersionId: document.currentVersionId!,
        selectionRevision: document.selectionRevision,
      },
    );
  },
});
export const forRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run?.artifactEdit) return null;
    const document = await ctx.db.get(run.artifactEdit.artifactId);
    const version = await ctx.db.get(run.artifactEdit.baseVersionId);
    if (
      !document ||
      !version ||
      document.projectId !== run.projectId ||
      document.threadId !== run.threadId ||
      version.artifactId !== document._id
    )
      return null;
    return {
      item: (JSON.parse(version.artifactJson) as Artifact).item,
      number: version.number,
    };
  },
});
export const commit = internalMutation({
  args: { runId: v.id("runs"), toolCallId: v.string(), output: v.any() },
  handler: async (ctx, { runId, toolCallId, output }) => {
    const run = await ctx.db.get(runId);
    if (!run?.artifactEdit || run.state !== "running")
      return {
        state: "unchanged" as const,
        message: "No active artifact edit.",
      };
    const document = await ctx.db.get(run.artifactEdit.artifactId);
    const base = await ctx.db.get(run.artifactEdit.baseVersionId);
    if (
      !document ||
      !base ||
      base.artifactId !== document._id ||
      document.projectId !== run.projectId ||
      document.threadId !== run.threadId
    )
      return {
        state: "unchanged" as const,
        message: "Artifact no longer available.",
      };
    const duplicate = await ctx.db
      .query("artifactVersions")
      .withIndex("by_run_tool", (q) =>
        q.eq("runId", runId).eq("toolCallId", toolCallId),
      )
      .unique();
    if (duplicate)
      return {
        state: "saved" as const,
        versionId: duplicate._id,
        displayed: document.currentVersionId === duplicate._id,
      };
    const parsed = notebookResult.safeParse(output);
    if (
      !parsed.success ||
      parsed.data.status !== "ok" ||
      parsed.data.chartWarnings.length ||
      parsed.data.outputTruncated ||
      parsed.data.charts.length + parsed.data.tables.length !== 1
    )
      return {
        state: "unchanged" as const,
        message:
          "The main artifact was kept. Return exactly one complete chart or table from a successful cell to update it.",
      };
    if (document.nextVersion > 50)
      return {
        state: "unchanged" as const,
        message:
          "This artifact's 50 saved versions are full. The cell result remains in chat.",
      };
    const [item] = resultItems([
      {
        id: toolCallId,
        name: "notebook",
        state: "output-available",
        output: parsed.data,
      },
    ]);
    const original = JSON.parse(base.artifactJson) as Artifact;
    const artifact: Artifact = {
      ...original,
      rootSourceId: document.sourceId,
      createdAt: Date.now(),
      item,
    };
    const versionId = await ctx.db.insert("artifactVersions", {
      artifactId: document._id,
      number: document.nextVersion,
      artifactJson: JSON.stringify(artifact),
      label: run.prompt.slice(0, 160),
      runId,
      toolCallId,
      baseVersionId: base._id,
    });
    const current = document.currentVersionId
      ? await ctx.db.get(document.currentVersionId)
      : null;
    // A late cell cannot override an explicit version choice or another edit.
    const displayed =
      document.selectionRevision === run.artifactEdit.selectionRevision &&
      (document.currentVersionId === base._id || current?.runId === runId);
    await ctx.db.patch(document._id, {
      nextVersion: document.nextVersion + 1,
      outputSourceIds: [...document.outputSourceIds, item.sourceId],
      updatedAt: Date.now(),
      ...(displayed ? { currentVersionId: versionId } : {}),
    });
    return {
      state: "saved" as const,
      versionId,
      displayed,
      message: displayed
        ? "Updated the main artifact. Refer to it as updated here, not as a chart below the chat."
        : "Saved a new version without replacing the user's current view. It is available in version history.",
    };
  },
});
