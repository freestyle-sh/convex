import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../convex/lib/sandbox", () => ({ executeGrant: mocks.execute }));
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  const workspaceId = await t.mutation(api.workspaces.open, { token });
  const projectId = await t.mutation(internal.connectionStore.saveVerified, {
    workspaceId,
    name: "Test",
    deploymentUrl: "https://example-test.convex.cloud",
    remoteProjectId: 1,
    teamId: 2,
    deploymentName: "example-test",
    deploymentType: "dev",
    encryptedToken: "unused-by-mocked-sandbox",
    binding: "test",
  });
  return { t, projectId };
}
beforeEach(() => {
  vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "ab".repeat(32));
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({
    entries: [{ secret: "private-log" }],
    newCursor: 1,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("checks through the log sandbox without requiring a model key or returning log contents", async () => {
  const { t, projectId } = await setup();
  await t.action(api.settings.save, {
    token,
    freestyleKey: "test-freestyle-key",
    model: "anthropic/claude-sonnet-4.5",
    snapshot: "freestyle/ubuntu",
  });
  const result = await t.action(api.connectionChecks.logs, {
    token,
    projectId,
  });
  expect(result.entries).toBe(1);
  expect(JSON.stringify(result)).not.toContain("private-log");
  expect(mocks.execute.mock.calls[0][2]).toEqual({ kind: "logs", cursor: 0 });
});
it("enforces workspace ownership and enabled state while allowing previously disabled reads", async () => {
  const { t, projectId } = await setup();
  const other = "b".repeat(64);
  await t.mutation(api.workspaces.open, { token: other });
  await expect(
    t.action(api.connectionChecks.logs, { token: other, projectId }),
  ).rejects.toThrow("this workspace");
  await t.run((ctx) => ctx.db.patch(projectId, { enabled: false }));
  await expect(
    t.action(api.connectionChecks.logs, { token, projectId }),
  ).rejects.toThrow("Enable a connected project");
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(projectId))!;
    await ctx.db.patch(projectId, {
      enabled: true,
      permissions: { ...project.permissions, readLogs: false },
    });
  });
  expect(mocks.execute).not.toHaveBeenCalled();
  await t.action(api.settings.save, {
    token,
    freestyleKey: "test-freestyle-key",
    model: "z-ai/glm-5.3-flash",
    snapshot: "freestyle/ubuntu",
  });
  expect(
    (await t.action(api.connectionChecks.logs, { token, projectId })).entries,
  ).toBe(1);
  expect(mocks.execute).toHaveBeenCalledOnce();
});
it("directs missing-key setup to the UI and hides provider errors", async () => {
  const { t, projectId } = await setup();
  await expect(
    t.action(api.connectionChecks.logs, { token, projectId }),
  ).rejects.toThrow("Agent services first");
  expect(mocks.execute).not.toHaveBeenCalled();
  await t.action(api.settings.save, {
    token,
    freestyleKey: "test-freestyle-key",
    model: "anthropic/claude-sonnet-4.5",
    snapshot: "freestyle/ubuntu",
  });
  mocks.execute.mockRejectedValue(
    new Error("provider error containing secret-value"),
  );
  await expect(
    t.action(api.connectionChecks.logs, { token, projectId }),
  ).rejects.toThrow("The log check failed.");
});
