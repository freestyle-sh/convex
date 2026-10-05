import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { authorizedProject } from "./lib/workspaces";
import { modelChoice, validateModel } from "./lib/models";
import { digest, redact } from "./lib/events";
import { suggestion, type SuggestionContext } from "./lib/suggestions";

const args = {
  token: v.string(),
  projectId: v.id("projects"),
  model: modelChoice,
};
const modelKey = (model: { provider: string; id: string }) =>
  `${model.provider}:${model.id}`;
const cacheMs = 30 * 60_000;
const lockMs = 75_000;
async function contextFor(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<SuggestionContext> {
  const [chats, runs, logs, findings] = await Promise.all([
    ctx.db
      .query("conversations")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(8),
    ctx.db
      .query("runs")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(16),
    ctx.db
      .query("logs")
      .withIndex("by_project_time", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(80),
    ctx.db
      .query("findings")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(4),
  ]);
  const relevantLogs = [
    ...logs
      .filter((l) => /^(error|critical|fatal|warn|warning)$/i.test(l.level))
      .slice(0, 6),
    ...logs.slice(0, 3),
  ];
  return {
    project: redact(project.name, 160),
    chats: chats
      .filter((c) => c.trigger === "chat" && c.title !== "New conversation")
      .slice(0, 6)
      .map((c) => redact(c.title, 160)),
    sources: [
      ...runs
        .filter((r) => r.state === "complete" && r.summary)
        .slice(0, 4)
        .map((r) => ({
          id: String(r._id),
          kind: "investigation",
          at: r.finishedAt ?? r.startedAt,
          text: redact(
            `Question: ${r.prompt.slice(0, 300)}\nAnswer: ${r.summary}`,
            1400,
          ),
        })),
      ...findings.map((f) => ({
        id: String(f._id),
        kind: "finding",
        at: f.updatedAt,
        text: redact(`${f.title}: ${f.detail}`, 1200),
      })),
      ...[...new Map(relevantLogs.map((l) => [l._id, l])).values()].map(
        (l) => ({
          id: String(l._id),
          kind: "log",
          at: l.timestamp,
          text: redact(`${l.level} ${l.functionPath}: ${l.message}`, 900),
        }),
      ),
    ],
  };
}
export const get = query({
  args,
  handler: async (ctx, { token, projectId, model }) => {
    await authorizedProject(ctx, token, projectId);
    const row = await ctx.db
      .query("suggestions")
      .withIndex("by_project_model", (q) =>
        q
          .eq("projectId", projectId)
          .eq("modelKey", modelKey(validateModel(model))),
      )
      .unique();
    return row
      ? { prompts: row.prompts, state: row.state, requestedAt: row.requestedAt }
      : null;
  },
});
export const request = mutation({
  args: { ...args, refresh: v.optional(v.boolean()) },
  handler: async (ctx, { token, projectId, model, refresh }) => {
    const project = await authorizedProject(ctx, token, projectId);
    if (!project.enabled) return;
    const choice = validateModel(model);
    const key = modelKey(choice);
    const row = await ctx.db
      .query("suggestions")
      .withIndex("by_project_model", (q) =>
        q.eq("projectId", projectId).eq("modelKey", key),
      )
      .unique();
    const now = Date.now();
    if (row && row.state === "generating" && now - row.requestedAt < lockMs)
      return;
    const context = await contextFor(ctx, project);
    const workspace = project.workspaceId
      ? await ctx.db.get(project.workspaceId)
      : null;
    const fingerprint = await digest(
      JSON.stringify({
        version: 1,
        context,
        credential:
          choice.provider === "openrouter"
            ? workspace?.openrouterKey
            : undefined,
      }),
    );
    if (
      !refresh &&
      row?.state !== "generating" &&
      row?.fingerprint === fingerprint &&
      now - row.updatedAt < (row.state === "error" ? 60_000 : cacheMs)
    )
      return;
    const requestId = crypto.randomUUID();
    const fields = {
      projectId,
      modelKey: key,
      choice,
      fingerprint,
      requestId,
      requestedAt: now,
      updatedAt: row?.updatedAt ?? 0,
      state: "generating" as const,
      prompts: row?.prompts ?? [],
    };
    const cacheId = row?._id ?? (await ctx.db.insert("suggestions", fields));
    if (row) await ctx.db.patch(cacheId, fields);
    await ctx.scheduler.runAfter(0, internal.suggestionGeneration.generate, {
      cacheId,
      requestId,
      context: JSON.stringify(context),
    });
    await ctx.scheduler.runAfter(lockMs, internal.suggestions.expire, {
      cacheId,
      requestId,
    });
  },
});
export const generation = internalQuery({
  args: { cacheId: v.id("suggestions"), requestId: v.string() },
  handler: async (ctx, { cacheId, requestId }) => {
    const row = await ctx.db.get(cacheId);
    if (!row || row.requestId !== requestId || row.state !== "generating")
      return null;
    const project = await ctx.db.get(row.projectId);
    return project?.enabled ? { row, project } : null;
  },
});
export const finish = internalMutation({
  args: {
    cacheId: v.id("suggestions"),
    requestId: v.string(),
    prompts: v.optional(v.array(suggestion)),
  },
  handler: async (ctx, { cacheId, requestId, prompts }) => {
    const row = await ctx.db.get(cacheId);
    if (!row || row.requestId !== requestId || row.state !== "generating")
      return;
    await ctx.db.patch(cacheId, {
      state: prompts ? "ready" : "error",
      updatedAt: Date.now(),
      ...(prompts ? { prompts } : {}),
    });
  },
});
export const expire = internalMutation({
  args: { cacheId: v.id("suggestions"), requestId: v.string() },
  handler: async (ctx, { cacheId, requestId }) => {
    const row = await ctx.db.get(cacheId);
    if (row?.requestId === requestId && row.state === "generating")
      await ctx.db.patch(cacheId, { state: "error", updatedAt: Date.now() });
  },
});
