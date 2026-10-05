import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
const config = {
  token,
  name: "Concurrent project",
  deploymentUrl: "https://test.convex.cloud",
  keyPrefix: "TARGET_TEST",
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: ["health:read"],
  allowedMutations: [],
  intervalMinutes: 15,
  enabled: true,
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  const projectId = await t.mutation(api.projects.save, config);
  const first = await t.mutation(api.projects.newChat, { token, projectId });
  const second = await t.mutation(api.projects.newChat, { token, projectId });
  const send = (threadId: string, prompt: string) =>
    t.mutation(api.projects.ask, { token, projectId, threadId, prompt });
  return { t, projectId, first, second, send };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("concurrent chats and follow-up handoff", () => {
  it("runs two chats at once, preserves tool access and isolates notebook locks", async () => {
    const { t, projectId, first, second, send } = await setup();
    const a = (await send(first, "Investigate payments"))!;
    const b = (await send(second, "Investigate inventory"))!;
    expect(
      await t.mutation(internal.projects.claimRun, { runId: a }),
    ).toBeTruthy();
    expect(
      await t.mutation(internal.projects.claimRun, { runId: b }),
    ).toBeTruthy();
    expect(
      await t.mutation(internal.projects.claimRun, { runId: a }),
    ).toBeNull();
    for (const runId of [a, b]) {
      expect(
        (await t.query(internal.projects.authorizeRun, { runId }))._id,
      ).toBe(projectId);
      await t.mutation(internal.approvals.propose, {
        projectId,
        runId,
        kind: "query",
        functionPath: "health:read",
        argsJson: "{}",
        reason: "Read this chat's evidence.",
      });
    }
    const left = await t.mutation(internal.notebooks.claim, {
      projectId,
      runId: a,
      lock: "left",
    });
    const right = await t.mutation(internal.notebooks.claim, {
      projectId,
      runId: b,
      lock: "right",
    });
    expect(left._id).not.toBe(right._id);
    await expect(
      t.mutation(internal.notebooks.claim, {
        projectId,
        runId: a,
        lock: "duplicate",
      }),
    ).rejects.toThrow("Another notebook cell");
    await t.mutation(internal.projects.finishRun, { runId: a });
    expect(
      (await t.query(internal.projects.authorizeRun, { runId: b }))._id,
    ).toBe(projectId);
    await expect(
      t.query(internal.projects.authorizeRun, { runId: a }),
    ).rejects.toThrow("no longer active");
    const chats = await t.query(api.projects.conversations, {
      token,
      projectId,
    });
    expect(chats.find((c) => c.threadId === second)?.state).toBe("running");
  });

  it("persists follow-ups immediately, hands them off in order and starts timeouts on execution", async () => {
    const { t, projectId, first, send } = await setup();
    const a = (await send(first, "Investigate"))!;
    await t.mutation(internal.projects.claimRun, { runId: a });
    const b = (await send(first, "Focus on payments"))!;
    const c = (await send(first, "Also compare yesterday"))!;
    expect(await t.query(internal.projects.hasFollowup, { runId: a })).toBe(
      true,
    );
    expect(
      await t.mutation(internal.projects.claimRun, { runId: b }),
    ).toBeNull();
    const messages = await t.query(api.projects.messages, {
      token,
      projectId,
      threadId: first,
      paginationOpts: { numItems: 20, cursor: null },
      streamArgs: { kind: "list" },
    });
    expect(messages.page.map((m) => m.text)).toEqual(
      expect.arrayContaining([
        "Investigate",
        "Focus on payments",
        "Also compare yesterday",
      ]),
    );
    expect(
      (await t.query(api.projects.conversations, { token, projectId })).find(
        (c) => c.threadId === first,
      )?.state,
    ).toBe("running");
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await t.mutation(internal.projects.expireRun, { runId: b });
    expect((await t.run((ctx) => ctx.db.get(b)))?.state).toBe("queued");
    await t.mutation(internal.projects.expireRun, { runId: a });
    expect((await t.run((ctx) => ctx.db.get(a)))?.state).toBe("failed");
    expect(
      await t.mutation(internal.projects.claimRun, { runId: c }),
    ).toBeNull();
    expect(
      await t.mutation(internal.projects.claimRun, { runId: b }),
    ).toBeTruthy();
    await t.mutation(internal.projects.expireRun, { runId: b });
    expect((await t.run((ctx) => ctx.db.get(b)))?.state).toBe("running");
    await t.mutation(internal.projects.finishRun, { runId: b });
    expect(
      await t.mutation(internal.projects.claimRun, { runId: c }),
    ).toBeTruthy();
  });

  it("keeps connection replacement and disconnect blocked until every chat is idle", async () => {
    const { t, projectId, first, second, send } = await setup();
    const workspaceId = (await t.run((ctx) => ctx.db.get(projectId)))!
      .workspaceId!;
    const connection = {
      workspaceId,
      name: "Concurrent project",
      deploymentUrl: config.deploymentUrl,
      remoteProjectId: 1,
      teamId: 1,
      deploymentName: "test",
      deploymentType: "dev",
      encryptedToken: "encrypted",
      binding: "test",
    };
    await t.mutation(internal.connectionStore.saveVerified, connection);
    const a = (await send(first, "First"))!;
    const b = (await send(second, "Second"))!;
    await t.mutation(internal.projects.claimRun, { runId: a });
    await t.mutation(internal.projects.finishRun, { runId: a });
    await expect(
      t.mutation(api.connectionStore.disconnect, { token, projectId }),
    ).rejects.toThrow("investigation");
    await expect(
      t.mutation(internal.connectionStore.saveVerified, connection),
    ).rejects.toThrow("investigation");
    await t.mutation(internal.projects.finishRun, { runId: b });
    await t.mutation(api.connectionStore.disconnect, { token, projectId });
    expect(
      (await t.run((ctx) => ctx.db.get(projectId)))?.connectionStatus,
    ).toBe("disconnected");
  });
});
