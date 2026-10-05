import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, components, internal } from "../convex/_generated/api";
import { openCredential } from "../convex/lib/credentials";
import { runtimeSettings } from "../convex/lib/runtimeSettings";
import type { ActionCtx } from "../convex/_generated/server";
const modules = import.meta.glob("../convex/**/*.ts");
const alice = "a".repeat(64),
  bob = "b".repeat(64);
const configuration = {
  name: "Private project",
  deploymentUrl: "https://test-123.convex.cloud",
  keyPrefix: "TARGET_TEST",
  permissions: {
    readLogs: true,
    runQueries: false,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: [],
  allowedMutations: ["jobs:retry"],
  intervalMinutes: 15,
  enabled: true,
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  const aliceId = await t.mutation(api.workspaces.open, { token: alice });
  const bobId = await t.mutation(api.workspaces.open, { token: bob });
  const projectId = await t.mutation(api.projects.save, {
    token: alice,
    ...configuration,
  });
  return { t, aliceId, bobId, projectId };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "cd".repeat(32));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("web-managed workspaces", () => {
  it("renames chats without reordering them and preserves custom names on the first prompt", async () => {
    const { t, projectId } = await setup();
    const threadId = await t.mutation(api.projects.newChat, {
      token: alice,
      projectId,
    });
    const before = await t.query(api.projects.chat, { token: alice, threadId });
    vi.setSystemTime(Date.now() + 60_000);
    await t.mutation(api.projects.renameChat, {
      token: alice,
      projectId,
      threadId,
      title: "  Orders investigation  ",
    });
    expect(
      await t.query(api.projects.chat, { token: alice, threadId }),
    ).toMatchObject({
      title: "Orders investigation",
      updatedAt: before!.updatedAt,
    });
    expect(
      (
        await t.query(api.projects.conversations, { token: alice, projectId })
      ).find((c) => c.threadId === threadId)?.title,
    ).toBe("Orders investigation");
    expect(
      await t.query(components.agent.threads.getThread, { threadId }),
    ).toMatchObject({ title: "Orders investigation" });
    await t.mutation(api.projects.ask, {
      token: alice,
      projectId,
      threadId,
      prompt: "What happened to orders?",
    });
    expect(
      await t.query(api.projects.chat, { token: alice, threadId }),
    ).toMatchObject({ title: "Orders investigation" });
  });
  it("restricts chat renaming to its project and workspace and validates the name", async () => {
    const { t, projectId } = await setup();
    const threadId = await t.mutation(api.projects.newChat, {
      token: alice,
      projectId,
    });
    const args = { token: alice, projectId, threadId, title: "Renamed" };
    await expect(
      t.mutation(api.projects.renameChat, { ...args, token: bob }),
    ).rejects.toThrow("this workspace");
    const otherProject = await t.mutation(api.projects.save, {
      token: alice,
      ...configuration,
      name: "Other project",
      deploymentUrl: "https://other-123.convex.cloud",
      keyPrefix: "TARGET_OTHER",
    });
    await expect(
      t.mutation(api.projects.renameChat, { ...args, projectId: otherProject }),
    ).rejects.toThrow("Project thread not found");
    await expect(
      t.mutation(api.projects.renameChat, { ...args, threadId: "missing" }),
    ).rejects.toThrow("Project thread not found");
    for (const title of ["   ", "x".repeat(121)])
      await expect(
        t.mutation(api.projects.renameChat, { ...args, title }),
      ).rejects.toThrow("1 and 120");
    expect(
      await t.query(api.projects.chat, { token: alice, threadId }),
    ).toMatchObject({ title: "New conversation" });
  });
  it("can rename a legacy project thread without a conversation row", async () => {
    const { t, projectId } = await setup();
    const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("conversations")
        .withIndex("by_thread", (q) => q.eq("threadId", project.threadId))
        .unique();
      if (row) await ctx.db.delete(row._id);
    });
    await t.mutation(api.projects.renameChat, {
      token: alice,
      projectId,
      threadId: project.threadId,
      title: "Project history",
    });
    expect(
      await t.query(api.projects.chat, {
        token: alice,
        threadId: project.threadId,
      }),
    ).toMatchObject({
      title: "Project history",
      updatedAt: project._creationTime,
    });
  });
  it("resolves direct chat links only in their owning workspace, including old chats", async () => {
    const { t, projectId } = await setup();
    const old = await t.mutation(api.projects.newChat, {
      token: alice,
      projectId,
    });
    await t.run((ctx) =>
      ctx.db.patch(projectId, { webhookSecret: "private-hook-secret" }),
    );
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++)
        await ctx.db.insert("conversations", {
          projectId,
          threadId: `newer-${i}`,
          title: "Newer chat",
          trigger: "chat",
          updatedAt: Date.now() + i,
        });
    });
    expect(
      (
        await t.query(api.projects.conversations, { token: alice, projectId })
      ).some((c) => c.threadId === old),
    ).toBe(false);
    expect(
      await t.query(api.projects.chat, { token: alice, threadId: old }),
    ).toMatchObject({ projectId, threadId: old });
    const resolved = await t.query(api.projects.chat, {
      token: alice,
      threadId: old,
    });
    expect(resolved?.project._id).toBe(projectId);
    expect(JSON.stringify(resolved)).not.toContain("private-hook-secret");
    expect(
      await t.query(api.projects.chat, { token: bob, threadId: old }),
    ).toBeNull();
    expect(
      await t.query(api.projects.chat, { token: alice, threadId: "missing" }),
    ).toBeNull();
    const project = (await t.query(api.projects.list, { token: alice }))[0];
    expect(
      await t.query(api.projects.chat, {
        token: alice,
        threadId: project.threadId,
      }),
    ).toMatchObject({ projectId, threadId: project.threadId });
    expect(
      await t.query(api.projects.chat, {
        token: bob,
        threadId: project.threadId,
      }),
    ).toBeNull();
  });
  it("opens idempotently without a shared operator token and stores only a hash", async () => {
    vi.stubEnv("OPERATOR_TOKEN", "");
    const { t, aliceId, bobId } = await setup();
    expect(aliceId).not.toBe(bobId);
    expect(await t.mutation(api.workspaces.open, { token: alice })).toBe(
      aliceId,
    );
    const row = await t.run((ctx) => ctx.db.get(aliceId));
    expect(row?.tokenHash).not.toBe(alice);
    expect(JSON.stringify(row)).not.toContain(alice);
    await expect(
      t.query(api.projects.list, { token: "c".repeat(64) }),
    ).rejects.toThrow("Workspace unavailable");
    await expect(
      t.mutation(api.workspaces.open, { token: "short" }),
    ).rejects.toThrow("Workspace unavailable");
  });
  it("isolates project lists, policy writes, threads, evidence, disconnect, and approvals", async () => {
    const { t, projectId } = await setup();
    const project = (await t.query(api.projects.list, { token: alice }))[0];
    expect(await t.query(api.projects.list, { token: bob })).toEqual([]);
    await expect(
      t.mutation(api.projects.save, {
        token: bob,
        projectId,
        ...configuration,
      }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.query(api.projects.inspect, { token: bob, projectId }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.query(api.projects.conversations, { token: bob, projectId }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.projects.newChat, { token: bob, projectId }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.projects.ask, {
        token: bob,
        projectId,
        prompt: "read secrets",
      }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.query(api.projects.messages, {
        token: bob,
        projectId,
        threadId: project.threadId,
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list" },
      }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.connectionStore.disconnect, { token: bob, projectId }),
    ).rejects.toThrow("this workspace");
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
        argsJson: "{}",
        reason: "test",
        policyVersion: 1,
        expiresAt: Date.now() + 60_000,
        state: "pending",
      });
    });
    for (const approve of [true, false])
      await expect(
        t.mutation(api.approvals.decide, { token: bob, proposalId, approve }),
      ).rejects.toThrow("this workspace");
  });
  it("does not attach another workspace's project when connecting the same deployment", async () => {
    const { t, aliceId, bobId, projectId } = await setup();
    const config = {
      name: "Connection",
      deploymentUrl: configuration.deploymentUrl,
      remoteProjectId: 7,
      teamId: 4,
      deploymentName: "test-123",
      deploymentType: "dev",
      encryptedToken: "encrypted",
      binding: "binding",
    };
    expect(
      await t.mutation(internal.connectionStore.saveVerified, {
        ...config,
        workspaceId: aliceId,
      }),
    ).toBe(projectId);
    const other = await t.mutation(internal.connectionStore.saveVerified, {
      ...config,
      workspaceId: bobId,
    });
    expect(other).not.toBe(projectId);
    expect(
      (await t.query(api.projects.list, { token: bob })).map((p) => p._id),
    ).toEqual([other]);
  });
  it("saves and uses encrypted service credentials without returning them to the browser", async () => {
    const { t, aliceId, projectId } = await setup();
    await t.action(api.settings.save, {
      token: alice,
      freestyleKey: "private-freestyle-key",
      openrouterKey: "private-openrouter-key",
      modelProvider: "openrouter",
      model: "openai/test",
      snapshot: "freestyle/ubuntu",
    });
    const settings = await t.query(api.workspaces.settings, { token: alice });
    expect(settings).toEqual({
      hasFreestyleKey: true,
      hasOpenRouterKey: true,
      modelProvider: "openrouter",
      model: "openai/test",
      snapshot: "freestyle/ubuntu",
    });
    expect(
      (await t.query(api.workspaces.settings, { token: bob })).hasFreestyleKey,
    ).toBe(false);
    const row = (await t.run((ctx) => ctx.db.get(aliceId)))!;
    expect(JSON.stringify(row)).not.toContain("private-freestyle-key");
    expect(openCredential(row.freestyleKey!, `${aliceId}:freestyle`)).toBe(
      "private-freestyle-key",
    );
    const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
    const loaded = await runtimeSettings(
      { runQuery: t.query.bind(t) } as unknown as ActionCtx,
      project,
    );
    expect(loaded.freestyleKey).toBe("private-freestyle-key");
    expect(loaded.modelKey).toBe("private-openrouter-key");
    await t.action(api.settings.save, {
      token: alice,
      model: "openai/updated",
      snapshot: "freestyle/ubuntu",
    });
    expect(
      (await t.query(api.workspaces.settings, { token: alice }))
        .hasOpenRouterKey,
    ).toBe(true);
    await t.action(api.settings.save, {
      token: alice,
      freestyleKey: null,
      openrouterKey: null,
      model: "openai/updated",
      snapshot: "freestyle/ubuntu",
    });
    const after = await runtimeSettings(
      { runQuery: t.query.bind(t) } as unknown as ActionCtx,
      project,
    );
    expect(after.freestyleKey).toBeUndefined();
    expect(after.modelKey).toBeUndefined();
  });
  it("configures webhook signing in the web flow without disclosing the saved secret", async () => {
    const { t, projectId } = await setup();
    await expect(
      t.action(api.settings.webhook, {
        token: bob,
        projectId,
        secret: "some-signing-secret",
      }),
    ).rejects.toThrow("this workspace");
    await t.action(api.settings.webhook, {
      token: alice,
      projectId,
      secret: "some-signing-secret",
    });
    const project = (await t.query(api.projects.list, { token: alice }))[0];
    expect(project.hasWebhookSecret).toBe(true);
    expect("webhookSecret" in project).toBe(false);
    expect(await t.action(internal.settings.webhookSecret, { projectId })).toBe(
      "some-signing-secret",
    );
    await t.action(api.settings.webhook, {
      token: alice,
      projectId,
      secret: null,
    });
    expect(
      await t.action(internal.settings.webhookSecret, { projectId }),
    ).toBeNull();
  });
});
