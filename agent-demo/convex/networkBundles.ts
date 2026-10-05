import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { operationKind, isReadOnly } from "./lib/operations";

export const forRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    const project = run && (await ctx.db.get(run.projectId));
    if (
      !run ||
      run.state !== "running" ||
      !project?.enabled ||
      !project.permissions.analyze
    )
      return null;
    const notebook = await ctx.db
      .query("notebooks")
      .withIndex("by_thread", (q) =>
        q
          .eq("projectId", project._id)
          .eq("threadId", run.threadId ?? project.threadId),
      )
      .order("desc")
      .first();
    if (
      !notebook ||
      notebook.state !== "ready" ||
      !notebook.vmId ||
      notebook.policyVersion !== project.policyVersion
    )
      return null;
    return { project, notebook };
  },
});

export const reserve = internalMutation({
  args: { notebookId: v.id("notebooks"), kind: operationKind },
  handler: async (ctx, { notebookId, kind }) => {
    const notebook = await ctx.db.get(notebookId);
    const project = notebook && (await ctx.db.get(notebook.projectId));
    if (
      !isReadOnly(kind) ||
      !notebook?.vmId ||
      notebook.state !== "ready" ||
      !project?.enabled ||
      !project.permissions.analyze ||
      project.policyVersion !== notebook.policyVersion
    )
      throw new Error("Network preparation is not authorized.");
    const rows = await ctx.db
      .query("networkBundles")
      .withIndex("by_notebook_kind", (q) =>
        q.eq("notebookId", notebookId).eq("kind", kind),
      )
      .order("desc")
      .take(20);
    const existing = rows.find(
      (r) =>
        ["preparing", "ready"].includes(r.state) &&
        r.expiresAt > Date.now() + 100_000 &&
        r.notebookVmId === notebook.vmId &&
        r.policyVersion === notebook.policyVersion,
    );
    if (existing) return { bundle: existing, create: false };
    const nonce = crypto.randomUUID();
    const id = await ctx.db.insert("networkBundles", {
      projectId: project._id,
      notebookId,
      notebookVmId: notebook.vmId,
      policyVersion: notebook.policyVersion,
      kind,
      state: "preparing",
      slug: `convex-network-${nonce}`,
      domain: `request-${nonce}.monitor.internal`,
      routeIds: [],
      expiresAt: Date.now() + 180_000,
    });
    await ctx.scheduler.runAfter(
      180_000,
      internal.networkBundleRuntime.cleanup,
      { bundleId: id },
    );
    return { bundle: (await ctx.db.get(id))!, create: true };
  },
});

export const get = internalQuery({
  args: { bundleId: v.id("networkBundles") },
  handler: (ctx, { bundleId }) => ctx.db.get(bundleId),
});

export const prepared = internalMutation({
  args: {
    bundleId: v.id("networkBundles"),
    vmId: v.optional(v.string()),
    sandboxId: v.optional(v.id("sandboxes")),
    leaseId: v.optional(v.id("credentialLeases")),
    routeId: v.optional(v.string()),
    ready: v.optional(v.boolean()),
  },
  handler: async (ctx, { bundleId, routeId, ready, ...fields }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle || bundle.state !== "preparing")
      throw new Error("Network preparation expired.");
    const notebook = await ctx.db.get(bundle.notebookId);
    const project = await ctx.db.get(bundle.projectId);
    if (
      ready &&
      (!project?.enabled ||
        !project.permissions.analyze ||
        project.policyVersion !== bundle.policyVersion ||
        notebook?.state !== "ready" ||
        notebook.vmId !== bundle.notebookVmId ||
        bundle.expiresAt <= Date.now() + 100_000)
    )
      throw new Error("Project access changed during network preparation.");
    const supplied = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (
      ready &&
      (!bundle.vmId ||
        !bundle.sandboxId ||
        !bundle.leaseId ||
        bundle.routeIds.length !== 2)
    )
      throw new Error("Network preparation is incomplete.");
    await ctx.db.patch(bundleId, {
      ...supplied,
      ...(routeId ? { routeIds: [...bundle.routeIds, routeId] } : {}),
      ...(ready ? { state: "ready" as const } : {}),
    });
  },
});

export const claim = internalMutation({
  args: {
    bundleId: v.id("networkBundles"),
    runId: v.id("runs"),
    notebookVmId: v.string(),
  },
  handler: async (ctx, { bundleId, runId, notebookVmId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (
      !bundle ||
      bundle.state !== "ready" ||
      bundle.expiresAt <= Date.now() + 100_000 ||
      bundle.notebookVmId !== notebookVmId
    )
      return null;
    const notebook = await ctx.db.get(bundle.notebookId);
    const project = await ctx.db.get(bundle.projectId);
    const run = await ctx.db.get(runId);
    if (
      !project?.enabled ||
      !project.permissions.analyze ||
      project.policyVersion !== bundle.policyVersion ||
      notebook?.state !== "ready" ||
      notebook.vmId !== notebookVmId ||
      !run ||
      run.state !== "running" ||
      run.projectId !== project._id ||
      (run.threadId ?? project.threadId) !== notebook.threadId
    )
      throw new Error("Prepared network access is no longer authorized.");
    await ctx.db.patch(bundleId, { state: "claimed" });
    return bundle;
  },
});

export const retire = internalMutation({
  args: { bundleId: v.id("networkBundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle || bundle.state === "closed") return;
    await ctx.db.patch(bundleId, { state: "closing" });
    await ctx.scheduler.runAfter(0, internal.networkBundleRuntime.cleanup, {
      bundleId,
    });
  },
});

export const closed = internalMutation({
  args: { bundleId: v.id("networkBundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (bundle) await ctx.db.patch(bundleId, { state: "closed" });
  },
});

export const markClosing = internalMutation({
  args: { bundleId: v.id("networkBundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (bundle && bundle.state !== "closed")
      await ctx.db.patch(bundleId, { state: "closing" });
  },
});
