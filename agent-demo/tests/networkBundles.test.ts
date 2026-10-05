import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import type { ActionCtx } from "../convex/_generated/server";
import type { OperationKind } from "../convex/lib/operations";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  exec: vi.fn(),
  write: vi.fn(),
  grant: vi.fn(),
  deleteRule: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("@freestyle-sh/convex", () => ({
  Freestyle: class {
    create = mocks.create;
    delete = mocks.remove;
  },
}));
vi.mock("freestyle", () => ({
  Freestyle: class {
    vms = {
      ref: (id: string) => ({
        id,
        exec: mocks.exec,
        fs: { writeTextFile: mocks.write },
      }),
    };
    tls = { rules: { create: mocks.grant, delete: mocks.deleteRule } };
  },
}));
vi.mock("../convex/lib/toolCredential", () => ({
  acquireCredential: mocks.acquire,
}));
import {
  prepareReadBundle,
  takeReadBundle,
} from "../convex/lib/preparedNetwork";
const modules = import.meta.glob("../convex/**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubEnv("FREESTYLE_API_KEY", "private-freestyle");
  mocks.create.mockResolvedValue({ vm: { id: "relay" } });
  mocks.exec.mockResolvedValue({ statusCode: 0 });
  let route = 0;
  mocks.grant.mockImplementation(async () => ({ id: `route-${++route}` }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test",
      deploymentUrl: "https://test.convex.cloud",
      keyPrefix: "TEST",
      threadId: "thread",
      intervalMinutes: 15,
      permissions: {
        analyze: true,
        readLogs: true,
        runQueries: false,
        proposeChanges: true,
      },
      allowedQueries: [],
      allowedMutations: [],
      enabled: true,
      cursor: 0,
      policyVersion: 1,
    });
    const connectionId = await ctx.db.insert("connections", {
      projectId,
      remoteProjectId: 1,
      teamId: 1,
      deploymentName: "test",
      deploymentType: "dev",
      binding: "binding",
      verifiedAt: Date.now(),
    });
    const leaseId = await ctx.db.insert("credentialLeases", {
      connectionId,
      name: "lease",
      kind: "tables",
      expiresAt: Date.now() + 1000000,
      state: "active",
    });
    const notebookId = await ctx.db.insert("notebooks", {
      projectId,
      threadId: "thread",
      policyVersion: 1,
      slug: "notebook",
      vmId: "notebook-vm",
      state: "ready",
      lockedUntil: 0,
    });
    const runId = await ctx.db.insert("runs", {
      projectId,
      threadId: "thread",
      trigger: "chat",
      prompt: "read",
      state: "running",
      startedAt: Date.now(),
    });
    return { projectId, notebookId, runId, leaseId };
  });
  const project = (await t.run((ctx) => ctx.db.get(ids.projectId)))!;
  mocks.acquire.mockResolvedValue({
    key: "secret-native-key",
    name: "lease",
    leaseId: ids.leaseId,
  });
  const schedule = vi.fn().mockResolvedValue("scheduled");
  const ctx = {
    runMutation: t.mutation.bind(t),
    runQuery: t.query.bind(t),
    runAction: vi.fn(),
    scheduler: { runAfter: schedule },
  } as unknown as ActionCtx;
  return { t, ctx, schedule, project, ...ids };
}

it("coalesces concurrent reservations and never prepares write credentials", async () => {
  const { t, notebookId } = await setup();
  const rows = await Promise.all(
    [1, 2, 3].map(() =>
      t.mutation(internal.networkBundles.reserve, {
        notebookId,
        kind: "tables",
      }),
    ),
  );
  expect(rows.filter((r) => r.create)).toHaveLength(1);
  expect(new Set(rows.map((r) => r.bundle._id)).size).toBe(1);
  for (const kind of ["mutation", "action"] as OperationKind[])
    await expect(
      t.mutation(internal.networkBundles.reserve, { notebookId, kind }),
    ).rejects.toThrow("not authorized");
});

it("prepares a dormant relay with keys only in edge transforms and claims it once", async () => {
  const { t, ctx, project, notebookId, runId, schedule } = await setup();
  const bundle = await prepareReadBundle(
    ctx,
    project,
    notebookId,
    "inlineQuery",
  );
  expect(bundle.state).toBe("ready");
  expect(bundle.routeIds).toHaveLength(2);
  expect(mocks.grant.mock.calls[0][0]).toMatchObject({
    source: { vmId: "relay" },
    transform: [
      { headers: { Authorization: "Convex secret-native-key" } },
      {
        jsonPatch: [
          { op: "add", path: "/adminKey", value: "secret-native-key" },
        ],
      },
    ],
  });
  expect(mocks.grant.mock.calls[1][0]).toMatchObject({
    source: { vmId: "notebook-vm" },
    destination: { vmId: "relay", port: 8765 },
  });
  expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(
    "secret-native-key",
  );
  expect(mocks.write.mock.calls[0][1]).toContain('json.loads("null")');
  const claims = await Promise.all(
    [1, 2].map(() =>
      takeReadBundle(
        ctx,
        project,
        notebookId,
        "notebook-vm",
        runId,
        "inlineQuery",
      ),
    ),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(schedule).toHaveBeenCalledOnce();
  await t.mutation(internal.networkBundles.retire, { bundleId: bundle._id });
  expect(
    (await t.query(internal.networkBundles.get, { bundleId: bundle._id }))
      ?.state,
  ).toBe("closing");
});

it.each(["thread", "policy", "paused", "closed", "expired"])(
  "rejects a prepared grant after %s changes",
  async (change) => {
    const { t, ctx, project, notebookId, runId } = await setup();
    const bundle = await prepareReadBundle(ctx, project, notebookId, "tables");
    await t.run(async (ctx) => {
      if (change === "thread")
        await ctx.db.patch(runId, { threadId: "different" });
      if (change === "policy")
        await ctx.db.patch(project._id, { policyVersion: 2 });
      if (change === "paused")
        await ctx.db.patch(project._id, { enabled: false });
      if (change === "closed")
        await ctx.db.patch(notebookId, { state: "closed" });
      if (change === "expired")
        await ctx.db.patch(bundle._id, { expiresAt: Date.now() + 99_000 });
    });
    const claim = t.mutation(internal.networkBundles.claim, {
      bundleId: bundle._id,
      runId,
      notebookVmId: "notebook-vm",
    });
    if (change === "expired") expect(await claim).toBeNull();
    else await expect(claim).rejects.toThrow("no longer authorized");
  },
);

it("retries cleanup failures and never targets the replacement bundle", async () => {
  const { t, ctx, project, notebookId, runId } = await setup();
  const old = await prepareReadBundle(ctx, project, notebookId, "tables");
  await t.mutation(internal.networkBundles.claim, {
    bundleId: old._id,
    runId,
    notebookVmId: "notebook-vm",
  });
  const replacement = await prepareReadBundle(
    ctx,
    project,
    notebookId,
    "tables",
  );
  mocks.deleteRule.mockRejectedValueOnce(
    new Error("provider temporarily unavailable"),
  );
  await t.action(internal.networkBundleRuntime.cleanup, { bundleId: old._id });
  expect(
    (await t.query(internal.networkBundles.get, { bundleId: old._id }))?.state,
  ).toBe("closing");
  expect(mocks.deleteRule.mock.calls.flat()).toEqual(old.routeIds);
  await t.action(internal.networkBundleRuntime.cleanup, {
    bundleId: old._id,
    attempt: 1,
  });
  expect(
    (await t.query(internal.networkBundles.get, { bundleId: old._id }))?.state,
  ).toBe("closed");
  expect(
    (await t.query(internal.networkBundles.get, { bundleId: replacement._id }))
      ?.state,
  ).toBe("ready");
});
