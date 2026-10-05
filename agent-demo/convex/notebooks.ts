import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const claim = internalMutation({
  args: { projectId: v.id("projects"), runId: v.id("runs"), lock: v.string() },
  handler: async (ctx, { projectId, runId, lock }) => {
    const project = await ctx.db.get(projectId);
    const run = await ctx.db.get(runId);
    if (
      !project?.enabled ||
      !project.permissions.analyze ||
      run?.projectId !== projectId ||
      run.state !== "running"
    )
      throw new Error("Notebook execution is not authorized.");
    const threadId = run.threadId ?? project.threadId;
    const rows = await ctx.db
      .query("notebooks")
      .withIndex("by_thread", (q) =>
        q.eq("projectId", projectId).eq("threadId", threadId),
      )
      .order("desc")
      .take(20);
    const current = rows.find((row) => row.state !== "closed");
    if (current?.lock && current.lockedUntil > Date.now())
      throw new Error("Another notebook cell is running. Wait for its result.");
    if (
      current &&
      current.state === "ready" &&
      current.policyVersion === project.policyVersion &&
      (current.expiresAt === undefined ||
        current.expiresAt > Date.now() + 180000) &&
      current.lockedUntil === 0
    ) {
      await ctx.db.patch(current._id, {
        lock,
        lockedUntil: Date.now() + 420000,
      });
      return { ...current, lock, reused: true };
    }
    if (current) {
      await ctx.db.patch(current._id, { state: "closed" });
      await ctx.scheduler.runAfter(0, internal.notebookRuntime.cleanup, {
        notebookId: current._id,
      });
    }
    const id = await ctx.db.insert("notebooks", {
      projectId,
      threadId,
      policyVersion: project.policyVersion,
      slug: `convex-notebook-${lock}`,
      state: "starting",
      // Bound abandoned setup; successful kernel startup clears this deadline.
      expiresAt: Date.now() + 420000,
      lock,
      lockedUntil: Date.now() + 420000,
    });
    await ctx.scheduler.runAfter(420000, internal.notebookRuntime.cleanup, {
      notebookId: id,
    });
    return { ...(await ctx.db.get(id))!, reused: false };
  },
});

export const get = internalQuery({
  args: { notebookId: v.id("notebooks") },
  handler: (ctx, { notebookId }) => ctx.db.get(notebookId),
});

export const activate = internalMutation({
  args: {
    notebookId: v.id("notebooks"),
    lock: v.string(),
    vmId: v.string(),
    sandboxId: v.id("sandboxes"),
  },
  handler: async (ctx, { notebookId, lock, vmId, sandboxId }) => {
    const notebook = await ctx.db.get(notebookId);
    if (!notebook || notebook.state !== "starting" || notebook.lock !== lock)
      throw new Error("Notebook session changed.");
    await ctx.db.patch(notebookId, { vmId, sandboxId, state: "ready" });
  },
});

export const authorize = internalQuery({
  args: {
    notebookId: v.id("notebooks"),
    lock: v.string(),
    runId: v.id("runs"),
  },
  handler: async (ctx, { notebookId, lock, runId }) => {
    const notebook = await ctx.db.get(notebookId);
    if (
      !notebook ||
      notebook.state !== "ready" ||
      notebook.lock !== lock ||
      notebook.lockedUntil <= Date.now() ||
      (notebook.expiresAt !== undefined &&
        notebook.expiresAt <= Date.now() + 120000)
    )
      throw new Error("Notebook session expired.");
    const project = await ctx.db.get(notebook.projectId);
    const run = await ctx.db.get(runId);
    if (
      !project?.enabled ||
      !project.permissions.analyze ||
      project.policyVersion !== notebook.policyVersion ||
      run?.state !== "running" ||
      run.projectId !== project._id ||
      (run.threadId ?? project.threadId) !== notebook.threadId
    )
      throw new Error("Notebook execution is no longer authorized.");
    return notebook;
  },
});

export const release = internalMutation({
  args: { notebookId: v.id("notebooks"), lock: v.string(), close: v.boolean() },
  handler: async (ctx, { notebookId, lock, close }) => {
    const notebook = await ctx.db.get(notebookId);
    if (notebook?.lock !== lock) return;
    await ctx.db.patch(notebookId, {
      lock: undefined,
      lockedUntil: 0,
      ...(close ? { state: "closed" as const } : {}),
    });
  },
});

export const close = internalMutation({
  args: {
    notebookId: v.id("notebooks"),
    onlyIfExpired: v.optional(v.boolean()),
  },
  handler: async (ctx, { notebookId, onlyIfExpired }) => {
    const notebook = await ctx.db.get(notebookId);
    // Old deployments scheduled an unconditional delete after 30 minutes.
    // Those jobs must leave upgraded, persistent sessions alone.
    if (
      onlyIfExpired &&
      notebook?.state !== "closed" &&
      (notebook?.expiresAt === undefined || notebook.expiresAt > Date.now())
    )
      return null;
    if (notebook)
      await ctx.db.patch(notebookId, {
        state: "closed",
        lock: undefined,
        lockedUntil: 0,
      });
    return notebook;
  },
});

export const preserve = internalMutation({
  args: { notebookId: v.id("notebooks"), lock: v.string() },
  handler: async (ctx, { notebookId, lock }) => {
    const notebook = await ctx.db.get(notebookId);
    if (!notebook || notebook.state !== "ready" || notebook.lock !== lock)
      throw new Error("Notebook session changed.");
    await ctx.db.patch(notebookId, { expiresAt: undefined });
    if (notebook.sandboxId)
      await ctx.db.patch(notebook.sandboxId, { expiresAt: undefined });
  },
});

export const markPreloaded = internalMutation({
  args: {
    notebookId: v.id("notebooks"),
    lock: v.string(),
    version: v.number(),
  },
  handler: async (ctx, { notebookId, lock, version }) => {
    const notebook = await ctx.db.get(notebookId);
    if (
      !notebook ||
      notebook.state !== "ready" ||
      notebook.lock !== lock ||
      notebook.lockedUntil <= Date.now()
    )
      throw new Error("Notebook session changed.");
    await ctx.db.patch(notebookId, { preloadVersion: version });
  },
});
