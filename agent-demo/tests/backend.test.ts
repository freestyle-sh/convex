import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { readSelectedPrompt } from "../convex/lib/resultSelection";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
const configuration = {
  name: "Test",
  deploymentUrl: "https://test-123.convex.cloud",
  keyPrefix: "TARGET_TEST",
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: ["health:read"],
  allowedMutations: ["jobs:retry"],
  intervalMinutes: 15,
  enabled: true,
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  return t;
}
beforeEach(() => {
  vi.stubEnv("OPERATOR_TOKEN", token);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("persisted authorization and scheduling", () => {
  it("persists selected evidence in Agent history without changing permissions or the visible run prompt", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const threadId = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    const selection = {
      kind: "table" as const,
      label: "Failed orders · 1 row",
      sourceId: "cell-1:table:0",
      contextJson: JSON.stringify({
        columns: ["id", "status"],
        rows: [{ row: 2, values: ["order-17", "failed"] }],
      }),
    };
    const runId = await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId,
      prompt: "Investigate this",
      selection,
    });
    const messages = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(readSelectedPrompt(messages.page[0].text)).toEqual({
      text: "Investigate this",
      selection,
    });
    expect((await t.run((ctx) => ctx.db.get(runId!)))?.prompt).toBe(
      "Investigate this",
    );
    const detail = await t.query(api.projects.inspect, {
      token,
      projectId,
      threadId,
    });
    expect(detail.proposals).toHaveLength(0);
    expect(
      (await t.query(api.projects.list, { token }))[0].permissions,
    ).toEqual(configuration.permissions);
    for (const contextJson of [
      "not-json",
      "null",
      JSON.stringify({ data: "x".repeat(6000) }),
    ]) {
      await expect(
        t.mutation(api.projects.ask, {
          token,
          projectId,
          threadId,
          prompt: "Investigate this",
          selection: { ...selection, contextJson },
        }),
      ).rejects.toThrow();
    }
    await expect(
      t.mutation(api.projects.ask, {
        token: "wrong",
        projectId,
        threadId,
        prompt: "Investigate this",
        selection,
      }),
    ).rejects.toThrow("Workspace unavailable");
    await expect(
      t.mutation(api.projects.ask, {
        token,
        projectId,
        threadId: "unrelated-thread",
        prompt: "Investigate this",
        selection,
      }),
    ).rejects.toThrow("Project thread not found");
  });
  it("rejects unauthenticated configuration and reads", async () => {
    const t = await setup();
    await expect(
      t.mutation(api.projects.save, { ...configuration, token: "wrong" }),
    ).rejects.toThrow("Workspace unavailable");
    await expect(
      t.query(api.projects.list, { token: "wrong" }),
    ).rejects.toThrow("Workspace unavailable");
  });
  it("never registers monitoring schedules and removes a legacy schedule on save", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const { Crons } = await import("@convex-dev/crons");
    const { components } = await import("../convex/_generated/api");
    const schedules = new Crons(components.crons);
    expect(await t.run((ctx) => schedules.list(ctx))).toHaveLength(0);
    await t.run((ctx) =>
      schedules.register(
        ctx,
        { kind: "interval", ms: 900_000 },
        internal.projects.scheduled,
        { projectId },
        `monitor-${projectId}`,
      ),
    );
    expect(await t.run((ctx) => schedules.list(ctx))).toHaveLength(1);
    await t.mutation(api.projects.save, { ...configuration, token, projectId });
    expect(await t.run((ctx) => schedules.list(ctx))).toHaveLength(0);
    await t.mutation(internal.projects.scheduled, { projectId });
    expect(
      (await t.query(api.projects.inspect, { token, projectId })).runs,
    ).toHaveLength(0);
    await t.mutation(api.projects.save, {
      ...configuration,
      token,
      projectId,
      enabled: false,
    });
    await expect(
      t.mutation(api.projects.ask, { token, projectId, prompt: "inspect" }),
    ).rejects.toThrow("paused");
  });
  it("cancels existing automatic schedules and running investigations idempotently", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const { Crons } = await import("@convex-dev/crons");
    const { components } = await import("../convex/_generated/api");
    const schedules = new Crons(components.crons);
    const runId = await t.run(async (ctx) => {
      await schedules.register(
        ctx,
        { kind: "interval", ms: 900_000 },
        internal.projects.scheduled,
        { projectId },
        `monitor-${projectId}`,
      );
      const id = await ctx.db.insert("runs", {
        projectId,
        trigger: "cron",
        prompt: "Legacy scheduled check",
        state: "running",
        startedAt: Date.now(),
      });
      await ctx.db.patch(projectId, { activeRunId: id });
      return id;
    });
    expect(await t.mutation(internal.projects.disableAutonomous, {})).toEqual({
      schedulesRemoved: 1,
      runsStopped: 1,
    });
    expect(await t.mutation(internal.projects.disableAutonomous, {})).toEqual({
      schedulesRemoved: 0,
      runsStopped: 0,
    });
    expect(await t.run((ctx) => schedules.list(ctx))).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe("failed");
    expect(
      (await t.query(api.projects.list, { token }))[0].activeRunId,
    ).toBeUndefined();
    await expect(
      t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Check on demand",
      }),
    ).resolves.toBeTruthy();
  });
  it("refuses to start a queued automatic run left over from an earlier deployment", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const runId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("runs", {
        projectId,
        trigger: "webhook",
        prompt: "Legacy webhook investigation",
        state: "queued",
        startedAt: Date.now(),
      });
      await ctx.db.patch(projectId, { activeRunId: id });
      return id;
    });
    expect(await t.mutation(internal.projects.claimRun, { runId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe("failed");
    expect(
      (await t.query(api.projects.list, { token }))[0].activeRunId,
    ).toBeUndefined();
  });
  it("binds thread reads to their project", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    await expect(
      t.query(api.projects.messages, {
        token,
        projectId,
        threadId: "another-project-thread",
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list" },
      }),
    ).rejects.toThrow();
  });
  it("creates separate user-requested threads and keeps follow-ups in their conversation", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const original = (await t.query(api.projects.list, { token }))[0];
    const firstThread = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId: firstThread,
      prompt: "Review my logs",
    });
    const first = (await t.query(api.projects.inspect, { token, projectId }))
      .runs[0];
    expect(first.threadId).toBeTruthy();
    expect(first.threadId).not.toBe(original.threadId);
    expect(first.promptMessageId).toBeTruthy();
    await t.mutation(internal.projects.finishRun, {
      runId: first._id,
      summary: "No new errors.",
      saveReply: true,
    });
    const before = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId: first.threadId!,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(before.page).toHaveLength(2);
    await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId: first.threadId!,
      prompt: "Can you explain the evidence?",
    });
    const followup = (
      await t.query(api.projects.inspect, {
        token,
        projectId,
        threadId: first.threadId,
      })
    ).runs[0];
    expect(followup.trigger).toBe("chat");
    expect(followup.conversationId).toBe(first.conversationId);
    await t.mutation(internal.projects.finishRun, {
      runId: followup._id,
      error: "Synthetic provider failure",
    });
    const secondThread = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId: secondThread,
      prompt: "Check the queue",
    });
    const second = (await t.query(api.projects.inspect, { token, projectId }))
      .runs[0];
    expect(second.threadId).not.toBe(first.threadId);
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).filter(
        (c) => c.trigger === "chat",
      ),
    ).toHaveLength(3);
    const originalMessages = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId: original.threadId,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(originalMessages.page).toHaveLength(0);
  });
  it("rejects cross-project chat, evidence, and message access", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const otherId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
      name: "Other",
      deploymentUrl: "https://other.convex.cloud",
      keyPrefix: "TARGET_OTHER",
    });
    const threadId = await t.mutation(api.projects.newChat, {
      token,
      projectId: otherId,
    });
    await expect(
      t.mutation(api.projects.ask, {
        token,
        projectId,
        threadId,
        prompt: "hello",
      }),
    ).rejects.toThrow("Project thread not found");
    await expect(
      t.query(api.projects.inspect, { token, projectId, threadId }),
    ).rejects.toThrow("Project thread not found");
    await expect(
      t.query(api.projects.messages, {
        token,
        projectId,
        threadId,
        paginationOpts: { numItems: 20, cursor: null },
        streamArgs: { kind: "list" },
      }),
    ).rejects.toThrow("Project thread not found");
    expect(
      (await t.query(api.projects.inspect, { token, projectId })).runs,
    ).toHaveLength(0);
  });
  it("persists manual prompts immediately and scopes approvals to the selected chat", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const threadId = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    const runId = await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId,
      prompt: "Inspect the failed job",
    });
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).find(
        (c) => c.threadId === threadId,
      )?.title,
    ).toBe("Inspect the failed job");
    const messages = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(messages.page).toHaveLength(1);
    await t.mutation(internal.projects.claimRun, { runId: runId! });
    const proposalId = await t.mutation(internal.approvals.propose, {
      projectId,
      runId: runId!,
      functionPath: "jobs:retry",
      argsJson: '{"jobId":"one"}',
      reason: "A single retry",
    });
    const otherThread = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    expect(
      (
        await t.query(api.projects.inspect, { token, projectId, threadId })
      ).proposals.map((p) => p._id),
    ).toEqual([proposalId]);
    expect(
      (
        await t.query(api.projects.inspect, {
          token,
          projectId,
          threadId: otherThread,
        })
      ).proposals,
    ).toHaveLength(0);
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    await t.mutation(internal.approvals.complete, {
      proposalId,
      state: "executed",
      result: "Synthetic success",
    });
    const history = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(JSON.stringify(history.page)).toContain("Approved operation");
    expect(JSON.stringify(history.page)).toContain("Synthetic success");
    const unrelated = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId: otherThread,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(unrelated.page).toHaveLength(0);
  });
  it("stores and deduplicates webhook logs without starting work, and rejects overlapping prompts", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const event = {
      eventId: "event",
      timestamp: Date.now(),
      level: "error",
      functionPath: "jobs:dispatch",
      message: "failed",
      source: "webhook",
    };
    expect(
      await t.mutation(internal.records.ingest, {
        projectId,
        events: [event],
        receipt: "same-batch",
      }),
    ).toBe(1);
    expect(
      await t.mutation(internal.records.ingest, {
        projectId,
        events: [event],
        receipt: "same-batch",
      }),
    ).toBe(0);
    expect(
      await t.mutation(internal.records.ingest, {
        projectId,
        events: [event],
        receipt: "different-batch",
      }),
    ).toBe(0);
    const detail = await t.query(api.projects.inspect, { token, projectId });
    expect(detail.runs).toHaveLength(0);
    expect(detail.logs).toHaveLength(1);
    expect(
      await t.query(api.projects.conversations, { token, projectId }),
    ).toHaveLength(1);
    await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Investigate these logs",
    });
    await expect(
      t.mutation(api.projects.ask, { token, projectId, prompt: "overlap" }),
    ).resolves.toBeTruthy();
  });
  it("cannot replay an approval or approve after a permission revision", async () => {
    const t = await setup();
    const projectId = await t.mutation(api.projects.save, {
      ...configuration,
      token,
    });
    const proposalId = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("runs", {
        projectId,
        trigger: "chat",
        prompt: "retry",
        state: "complete",
        startedAt: Date.now(),
      });
      return ctx.db.insert("proposals", {
        projectId,
        runId,
        functionPath: "jobs:retry",
        argsJson: '{"jobId":"one"}',
        reason: "Retry one job",
        policyVersion: 1,
        expiresAt: Date.now() + 60_000,
        state: "pending",
      });
    });
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    expect(
      await t.mutation(internal.approvals.claimExecution, { proposalId }),
    ).not.toBeNull();
    expect(
      await t.mutation(internal.approvals.claimExecution, { proposalId }),
    ).toBeNull();
    await expect(
      t.mutation(api.approvals.decide, { token, proposalId, approve: true }),
    ).rejects.toThrow("no longer pending");
    const second = await t.run(async (ctx) => {
      const proposal = (await ctx.db.get(proposalId))!;
      const { _id, _creationTime, ...fields } = proposal;
      return ctx.db.insert("proposals", { ...fields, state: "pending" });
    });
    await t.mutation(api.projects.save, { ...configuration, projectId, token });
    await expect(
      t.mutation(api.approvals.decide, {
        token,
        proposalId: second,
        approve: true,
      }),
    ).rejects.toThrow("Permissions changed");
  });
});
