import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import { saveMessage } from "@convex-dev/agent";
import schema from "../convex/schema";
import { api, components, internal } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64),
  otherToken = "b".repeat(64);
const configuration = {
  name: "Delete test",
  deploymentUrl: "https://test-123.convex.cloud",
  keyPrefix: "TARGET_TEST",
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: [],
  allowedMutations: [],
  intervalMinutes: 15,
  enabled: true,
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  await t.mutation(api.workspaces.open, { token: otherToken });
  const projectId = await t.mutation(api.projects.save, {
    token,
    ...configuration,
  });
  const threadId = await t.mutation(api.projects.newChat, { token, projectId });
  return { t, projectId, threadId, args: { token, projectId, threadId } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("chat deletion", () => {
  it("removes messages and investigation data, revokes pending approvals, and preserves other chats and project logs", async () => {
    const { t, projectId, threadId, args } = await setup();
    const otherThread = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    const ids = await t.run(async (ctx) => {
      await saveMessage(ctx, components.agent, {
        threadId,
        prompt: "Delete this message",
      });
      const runId = await ctx.db.insert("runs", {
        projectId,
        threadId,
        trigger: "chat",
        prompt: "Private prompt",
        state: "complete",
        startedAt: Date.now(),
      });
      const findingId = await ctx.db.insert("findings", {
        projectId,
        runId,
        fingerprint: "test",
        title: "Finding",
        detail: "Detail",
        severity: "info",
        evidence: [],
        occurrences: 1,
        updatedAt: Date.now(),
      });
      const proposalId = await ctx.db.insert("proposals", {
        projectId,
        runId,
        functionPath: "jobs:retry",
        argsJson: "{}",
        reason: "Retry",
        policyVersion: 1,
        expiresAt: Date.now() + 60_000,
        state: "pending",
      });
      const logId = await ctx.db.insert("logs", {
        projectId,
        eventId: "shared",
        timestamp: Date.now(),
        level: "info",
        functionPath: "test",
        message: "Project log",
        source: "test",
      });
      const cacheId = await ctx.db.insert("suggestions", {
        projectId,
        modelKey: "openrouter:test",
        choice: { provider: "openrouter", id: "test" },
        fingerprint: "old",
        state: "ready",
        requestId: "old",
        requestedAt: Date.now(),
        updatedAt: Date.now(),
        prompts: [],
      });
      return { runId, findingId, proposalId, logId, cacheId };
    });
    expect(await t.mutation(api.projects.deleteChat, args)).toEqual({
      deleted: true,
    });
    expect(
      await t.query(components.agent.threads.getThread, { threadId }),
    ).toBeNull();
    expect(await t.query(api.projects.chat, { token, threadId })).toBeNull();
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).map(
        (c) => c.threadId,
      ),
    ).toContain(otherThread);
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).map(
        (c) => c.threadId,
      ),
    ).not.toContain(threadId);
    const remaining = await t.run(async (ctx) => ({
      run: await ctx.db.get(ids.runId),
      finding: await ctx.db.get(ids.findingId),
      proposal: await ctx.db.get(ids.proposalId),
      cache: await ctx.db.get(ids.cacheId),
      log: await ctx.db.get(ids.logId),
      project: await ctx.db.get(projectId),
    }));
    expect(remaining).toMatchObject({
      run: null,
      finding: null,
      proposal: null,
      cache: null,
    });
    expect(remaining.log).not.toBeNull();
    expect(remaining.project).not.toBeNull();
    await expect(
      t.mutation(api.approvals.decide, {
        token,
        proposalId: ids.proposalId,
        approve: true,
      }),
    ).rejects.toThrow("Proposal not found");
    await expect(
      t.mutation(api.projects.ask, { ...args, prompt: "Revive it" }),
    ).rejects.toThrow("Chat not found");
    await expect(
      t.mutation(api.projects.renameChat, { ...args, title: "Revive it" }),
    ).rejects.toThrow("Chat not found");
    expect(
      await t.query(api.projects.messages, {
        ...args,
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list" },
      }),
    ).toMatchObject({ page: [], isDone: true });
    expect(await t.query(api.projects.inspect, args)).toEqual({
      runs: [],
      logs: [],
      findings: [],
      proposals: [],
      sandboxes: [],
    });
    expect(await t.mutation(api.projects.deleteChat, args)).toEqual({
      deleted: true,
    });
  });

  it("does not resurrect the default legacy chat and removes its older runs", async () => {
    const { t, projectId } = await setup();
    const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
    const runId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("conversations")
        .withIndex("by_thread", (q) => q.eq("threadId", project.threadId))
        .unique();
      if (row) await ctx.db.delete(row._id);
      return ctx.db.insert("runs", {
        projectId,
        trigger: "chat",
        prompt: "Legacy",
        state: "complete",
        startedAt: Date.now(),
      });
    });
    await t.mutation(api.projects.deleteChat, {
      token,
      projectId,
      threadId: project.threadId,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toBeNull();
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).some(
        (c) => c.threadId === project.threadId,
      ),
    ).toBe(false);
    expect(
      await t.query(api.projects.chat, { token, threadId: project.threadId }),
    ).toBeNull();
    expect(
      await t.mutation(api.projects.newChat, { token, projectId }),
    ).toBeTruthy();
  });

  it("rejects deletion from another workspace or project", async () => {
    const { t, threadId, args } = await setup();
    await expect(
      t.mutation(api.projects.deleteChat, { ...args, token: otherToken }),
    ).rejects.toThrow("this workspace");
    const projectId = await t.mutation(api.projects.save, {
      token,
      ...configuration,
      name: "Other",
      deploymentUrl: "https://other-123.convex.cloud",
      keyPrefix: "TARGET_OTHER",
    });
    await expect(
      t.mutation(api.projects.deleteChat, { ...args, projectId }),
    ).rejects.toThrow("Project thread not found");
    expect(
      await t.query(api.projects.chat, { token, threadId }),
    ).not.toBeNull();
  });

  it.each(["queued", "running", "executing"] as const)(
    "deletes immediately while work is %s and ignores late callbacks",
    async (state) => {
      const { t, args, projectId, threadId } = await setup();
      const { runId, proposalId } = await t.run(async (ctx) => {
        const runId = await ctx.db.insert("runs", {
          projectId,
          threadId,
          trigger: "chat",
          prompt: "Busy",
          state: state === "executing" ? "complete" : state,
          startedAt: Date.now(),
        });
        const proposalId =
          state === "executing"
            ? await ctx.db.insert("proposals", {
                projectId,
                runId,
                functionPath: "jobs:retry",
                argsJson: "{}",
                reason: "Retry",
                policyVersion: 1,
                expiresAt: Date.now() + 60_000,
                state,
              })
            : undefined;
        return { runId, proposalId };
      });
      expect(await t.mutation(api.projects.deleteChat, args)).toMatchObject({
        deleted: true,
      });
      expect(await t.query(api.projects.chat, { token, threadId })).toBeNull();
      expect(
        await t.query(components.agent.threads.getThread, { threadId }),
      ).toBeNull();
      expect(
        await t.mutation(internal.projects.claimRun, { runId }),
      ).toBeNull();
      await expect(
        t.query(internal.projects.authorizeRun, { runId }),
      ).rejects.toThrow("Investigation no longer active");
      await t.mutation(internal.projects.finishRun, {
        runId,
        summary: "Late result",
        saveReply: true,
      });
      await t.mutation(internal.projects.expireRun, { runId });
      if (proposalId) {
        await t.mutation(internal.approvals.complete, {
          proposalId,
          state: "executed",
          result: "Late write result",
        });
        expect(await t.run((ctx) => ctx.db.get(proposalId))).toBeNull();
      }
      await expect(
        t.mutation(internal.records.finding, {
          projectId,
          runId,
          fingerprint: "late",
          title: "Late finding",
          detail: "Deleted chat",
          severity: "info",
          evidence: [],
        }),
      ).rejects.toThrow("Investigation is no longer active");
      expect(await t.run((ctx) => ctx.db.get(runId))).toBeNull();
      expect(await t.query(api.projects.chat, { token, threadId })).toBeNull();
    },
  );

  it("closes the notebook and its network grants and schedules external cleanup", async () => {
    const { t, args, projectId, threadId } = await setup();
    const ids = await t.run(async (ctx) => {
      const notebookId = await ctx.db.insert("notebooks", {
        projectId,
        threadId,
        policyVersion: 1,
        slug: "test-notebook",
        state: "ready",
        vmId: "vm-test",
        lock: "active-cell",
        lockedUntil: Date.now() + 60_000,
      });
      const bundleId = await ctx.db.insert("networkBundles", {
        projectId,
        notebookId,
        notebookVmId: "vm-test",
        policyVersion: 1,
        kind: "tables",
        state: "claimed",
        slug: "test-network",
        domain: "test.monitor.internal",
        routeIds: [],
        expiresAt: Date.now() + 180_000,
      });
      return { notebookId, bundleId };
    });
    await t.mutation(api.projects.deleteChat, args);
    expect(
      await t.query(internal.notebooks.get, { notebookId: ids.notebookId }),
    ).toMatchObject({ state: "closed", lockedUntil: 0 });
    await t.mutation(internal.notebooks.release, {
      notebookId: ids.notebookId,
      lock: "active-cell",
      close: false,
    });
    expect(
      await t.query(internal.notebooks.get, { notebookId: ids.notebookId }),
    ).toMatchObject({ state: "closed", lockedUntil: 0 });
    expect(
      await t.query(internal.networkBundles.get, { bundleId: ids.bundleId }),
    ).toMatchObject({ state: "closing" });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.some(
        (job) =>
          job.name.includes("notebookRuntime:cleanup") &&
          job.args[0].notebookId === ids.notebookId &&
          job.args[0].force,
      ),
    ).toBe(true);
    expect(
      jobs.some(
        (job) =>
          job.name.includes("networkBundleRuntime:cleanup") &&
          job.args[0].bundleId === ids.bundleId,
      ),
    ).toBe(true);
  });
});
