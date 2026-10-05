import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../convex/lib/sandbox", () => ({ executeGrant: mocks.execute }));
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
const doc = {
  _id: "j1234567890123456789012345678901",
  _creationTime: 1,
  status: "pending",
  count: 4,
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  const projectId = await t.mutation(api.projects.save, {
    token,
    name: "Demo",
    deploymentUrl: "https://demo-test.convex.cloud",
    keyPrefix: "TARGET_DEMO",
    permissions: {
      readLogs: true,
      runQueries: true,
      analyze: true,
      proposeChanges: false,
    },
    allowedQueries: [],
    allowedMutations: [],
    intervalMinutes: 15,
    enabled: true,
  });
  await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("connections", {
      projectId,
      remoteProjectId: 1,
      teamId: 2,
      deploymentName: "demo-test",
      deploymentType: "dev",
      binding: "test",
      encryptedToken: "not-a-real-token",
      verifiedAt: Date.now(),
    });
    await ctx.db.patch(projectId, {
      connectionId,
      connectionStatus: "connected",
    });
  });
  const runId = await t.run((ctx) =>
    ctx.db.insert("runs", {
      projectId,
      trigger: "chat",
      prompt: "Update one order.",
      state: "running",
      startedAt: Date.now(),
    }),
  );
  const proposalId = await t.mutation(internal.approvals.propose, {
    projectId,
    runId,
    kind: "documentPatch",
    functionPath: "",
    argsJson: JSON.stringify({
      table: "orders",
      id: doc._id,
      changes: [
        {
          field: "status",
          before: { exists: true, value: "pending" },
          after: { exists: true, value: "paid" },
        },
      ],
    }),
    reason: "Update this order's status.",
  });
  await t.mutation(api.approvals.decide, { token, proposalId, approve: true });
  return { t, projectId, proposalId };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());
describe("approved document execution", () => {
  it("checks the current fields, executes the approved patch once, and records success", async () => {
    const { t, proposalId } = await setup();
    mocks.execute.mockImplementation(async (_ctx, _project, grant) =>
      grant.kind === "inlineQuery"
        ? { status: "success", value: doc }
        : { status: "success", value: { success: true } },
    );
    await Promise.all([
      t.action(internal.execute.approvedMutation, { proposalId }),
      t.action(internal.execute.approvedMutation, { proposalId }),
    ]);
    expect(mocks.execute.mock.calls.map((call) => call[2].kind)).toEqual([
      "inlineQuery",
      "documentPatch",
    ]);
    expect(mocks.execute.mock.calls[1][4]).toBe(proposalId);
    expect((await t.run((ctx) => ctx.db.get(proposalId)))!.state).toBe(
      "executed",
    );
  });
  it("does not write after a conflicting edit or a missing document", async () => {
    for (const current of [null, { ...doc, status: "cancelled" }]) {
      const { t, proposalId } = await setup();
      mocks.execute.mockClear();
      mocks.execute.mockResolvedValue({ status: "success", value: current });
      await t.action(internal.execute.approvedMutation, { proposalId });
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.execute.mock.calls[0][2].kind).toBe("inlineQuery");
      const result = await t.run((ctx) => ctx.db.get(proposalId));
      expect(result!.state).toBe("uncertain");
      expect(result!.result).toContain("No write attempted");
    }
  });
  it("does not retry a write that fails to report success", async () => {
    const { t, proposalId } = await setup();
    mocks.execute
      .mockResolvedValueOnce({ status: "success", value: doc })
      .mockRejectedValueOnce(new Error("lost response"));
    await t.action(internal.execute.approvedMutation, { proposalId });
    await t.action(internal.execute.approvedMutation, { proposalId });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect((await t.run((ctx) => ctx.db.get(proposalId)))!.state).toBe(
      "uncertain",
    );
  });
  it("does not treat an unsuccessful native mutation response as saved", async () => {
    const { t, proposalId } = await setup();
    mocks.execute
      .mockResolvedValueOnce({ status: "success", value: doc })
      .mockResolvedValueOnce({ status: "success", value: { success: false } });
    await t.action(internal.execute.approvedMutation, { proposalId });
    expect((await t.run((ctx) => ctx.db.get(proposalId)))!.state).toBe(
      "uncertain",
    );
  });
  it("issues no request if permissions change after approval", async () => {
    const { t, proposalId, projectId } = await setup();
    await t.run((ctx) => ctx.db.patch(projectId, { policyVersion: 2 }));
    await t.action(internal.execute.approvedMutation, { proposalId });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
