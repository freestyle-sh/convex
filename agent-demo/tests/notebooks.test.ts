import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import type { ActionCtx } from "../convex/_generated/server";
import { parseNotebookResult } from "../convex/lib/notebook";
import { RouteNotReadyError } from "../convex/lib/routeReadiness";
import {
  kernelPreloads,
  kernelPreloadVersion,
} from "../convex/lib/jupyterKernel";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  start: vi.fn(),
  snapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  exec: vi.fn(),
  write: vi.fn(),
  grant: vi.fn(),
  removeGrant: vi.fn(),
  network: vi.fn(),
}));
vi.mock("../convex/lib/notebookNetwork", () => ({
  openNotebookNetwork: mocks.network,
}));
vi.mock("@freestyle-sh/convex", () => ({
  Freestyle: class {
    create = mocks.create;
    delete = mocks.delete;
    update = mocks.update;
    refresh = mocks.refresh;
    start = mocks.start;
    snapshot = mocks.snapshot;
  },
}));
vi.mock("freestyle", () => ({
  Freestyle: class {
    vms = {
      snapshots: { delete: mocks.deleteSnapshot },
      ref: (id: string) => ({
        id,
        exec: (args: unknown) => mocks.exec(id, args),
        fs: {
          writeTextFile: (path: string, body: string) =>
            mocks.write(id, path, body),
        },
      }),
    };
    tls = { rules: { create: mocks.grant, delete: mocks.removeGrant } };
  },
}));
import { executeNotebook } from "../convex/notebookRuntime";
import { notebookImageKey } from "../convex/lib/notebookImage";
const modules = import.meta.glob("../convex/**/*.ts");
const output = {
  status: "ok",
  executionCount: 1,
  stdout: "4\n",
  stderr: "",
  text: "",
  charts: [
    {
      data: [{ type: "bar", x: ["A"], y: [4] }],
      layout: { title: { text: "Result" } },
    },
  ],
  chartWarnings: [],
  kernelReset: false,
  durationMs: 5,
  outputTruncated: false,
};
const cell = { code: "print(2 + 2)", timeoutMs: 5000 };
async function setup() {
  const t = convexTest(schema, modules);
  const { projectId, runId } = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test",
      deploymentUrl: "https://test.convex.cloud",
      keyPrefix: "TEST",
      threadId: "chat-one",
      intervalMinutes: 15,
      permissions: {
        readLogs: true,
        analyze: true,
        runQueries: false,
        proposeChanges: false,
      },
      allowedQueries: [],
      allowedMutations: [],
      enabled: true,
      cursor: 0,
      policyVersion: 1,
    });
    const runId = await ctx.db.insert("runs", {
      projectId,
      threadId: "chat-one",
      trigger: "chat",
      prompt: "Analyze",
      state: "running",
      startedAt: Date.now(),
    });
    await ctx.db.patch(projectId, { activeRunId: runId });
    return { projectId, runId };
  });
  const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
  const ctx = {
    runMutation: t.mutation.bind(t),
    runQuery: t.query.bind(t),
    runAction: t.action.bind(t),
  } as unknown as ActionCtx;
  return { t, ctx, project, projectId, runId };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("FREESTYLE_API_KEY", "private-freestyle-key");
  let sequence = 0;
  mocks.create.mockImplementation(async () => ({
    vm: { id: `vm-${++sequence}` },
  }));
  mocks.delete.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({ vm: { state: "running" } });
  mocks.refresh.mockResolvedValue({ vm: { state: "running" } });
  mocks.start.mockResolvedValue({ vm: { state: "running" } });
  mocks.snapshot.mockResolvedValue({ snapshotId: "clean-image" });
  mocks.deleteSnapshot.mockResolvedValue(undefined);
  mocks.grant.mockImplementation(async ({ domain }) => ({ id: domain }));
  mocks.exec.mockImplementation(async (_id, { command }) =>
    command.includes("/execute")
      ? { statusCode: 0, stdout: JSON.stringify(output) }
      : { statusCode: 0, stdout: "" },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Jupyter chat sessions", () => {
  it("preserves a healthy kernel if a route never becomes ready, without running the cell", async () => {
    const { t, ctx, project, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    mocks.exec.mockClear();
    mocks.delete.mockClear();
    mocks.network.mockRejectedValueOnce(new RouteNotReadyError());
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId, {
        requests: [{ kind: "tables", functionPath: "", argsJson: "{}" }],
      }),
    ).rejects.toThrow("existing notebook is preserved");
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(first.sessionId)))?.state).toBe(
      "ready",
    );
    const next = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(next.sessionReused).toBe(true);
    expect(next.sessionId).toBe(first.sessionId);
  });
  it("snapshots only the clean kernel and restores separate chats without reinstalling it", async () => {
    const { t, ctx, project, runId } = await setup();
    mocks.exec.mockResolvedValueOnce({ statusCode: 1 });
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [{ private: "first-chat" }], results: [] },
      runId,
    );
    const snapshotOrder = mocks.snapshot.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeGreaterThan(
      Math.max(...mocks.removeGrant.mock.invocationCallOrder),
    );
    const firstCellIndex = mocks.write.mock.calls.findIndex(([, path]) =>
      path.includes("monitor-cell-"),
    );
    expect(snapshotOrder).toBeLessThan(
      mocks.write.mock.invocationCallOrder[firstCellIndex],
    );
    expect(
      mocks.exec.mock.invocationCallOrder.find((_, i) =>
        mocks.exec.mock.calls[i][1].command.includes("nohup"),
      ),
    ).toBeLessThan(snapshotOrder);
    await t.run((db) => db.db.patch(runId, { threadId: "chat-two" }));
    mocks.exec.mockClear();
    mocks.write.mockClear();
    const second = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(mocks.create.mock.calls[1][1]).toMatchObject({
      snapshotId: "clean-image",
      firewall: { rules: [] },
    });
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(
      mocks.exec.mock.calls.map(([, args]) => args.command).join("\n"),
    ).not.toMatch(/pip install|nohup|test -x/);
    expect(mocks.exec.mock.calls[0][1].command).toContain("/health");
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toBe("vm-2");
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain("first-chat");
  });

  it("falls back only when the cached image is missing, without retrying user code", async () => {
    const { t, ctx, project, runId } = await setup();
    await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    await t.run((db) => db.db.patch(runId, { threadId: "chat-two" }));
    mocks.create.mockRejectedValueOnce({ status: 404 });
    mocks.exec.mockClear();
    await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(
      mocks.create.mock.calls.slice(-2).map(([, args]) => args.snapshotId),
    ).toEqual(["clean-image", "freestyle/ubuntu"]);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(
      mocks.exec.mock.calls.filter(([, args]) =>
        args.command.includes("/execute"),
      ),
    ).toHaveLength(1);
    await t.run((db) => db.db.patch(runId, { threadId: "chat-three" }));
    mocks.create.mockRejectedValueOnce({ status: 503 });
    mocks.exec.mockClear();
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("session has been closed");
    expect(mocks.create).toHaveBeenCalledTimes(4);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("continues without a snapshot if caching fails and allows a later clean rebuild", async () => {
    const { t, ctx, project, runId } = await setup();
    mocks.snapshot.mockRejectedValueOnce(
      new Error("Snapshot service unavailable"),
    );
    const result = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(result.status).toBe("ok");
    expect(
      (await t.run((db) => db.db.query("notebookImages").unique()))?.state,
    ).toBe("failed");
    await t.run((db) => db.db.patch(runId, { threadId: "chat-two" }));
    await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(mocks.create.mock.calls[1][1].snapshotId).toBe("freestyle/ubuntu");
    expect(
      (await t.run((db) => db.db.query("notebookImages").unique()))?.state,
    ).toBe("ready");
  });

  it("reports wall time separately from guest Python time, including session release", async () => {
    const { ctx, project, runId } = await setup();
    const runMutation = ctx.runMutation;
    ctx.runMutation = (async (ref, args) => {
      await vi.advanceTimersByTimeAsync(100);
      return runMutation(ref, args);
    }) as typeof ctx.runMutation;
    const result = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(result.durationMs).toBe(5);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(700);
  });

  it("preloads existing kernels once before user code without replacing the VM", async () => {
    const { t, ctx, project, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    await t.run((db) =>
      db.db.patch(first.sessionId, { preloadVersion: undefined }),
    );
    mocks.write.mockClear();
    const next = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    const payloads = mocks.write.mock.calls.map(([, path, body]) => ({
      path,
      data: JSON.parse(body),
    }));
    expect(payloads.map((p) => p.data.code)).toEqual([
      kernelPreloads,
      cell.code,
    ]);
    expect(payloads[0].data.context).toEqual({});
    expect(next.sessionReused).toBe(true);
    expect(next.sessionId).toBe(first.sessionId);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(
      (await t.run((db) => db.db.get(first.sessionId)))?.preloadVersion,
    ).toBe(kernelPreloadVersion);
    mocks.write.mockClear();
    await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(
      mocks.write.mock.calls.map(([, , body]) => JSON.parse(body).code),
    ).toEqual([cell.code]);
  });

  it("does not execute user code when a legacy kernel's imports fail", async () => {
    const { t, ctx, project, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    await t.run((db) =>
      db.db.patch(first.sessionId, { preloadVersion: undefined }),
    );
    mocks.write.mockClear();
    mocks.exec.mockResolvedValueOnce({
      statusCode: 0,
      stdout: JSON.stringify({
        ...output,
        status: "error",
        stderr: "ImportError",
      }),
    });
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("preloading notebook libraries");
    expect(
      mocks.write.mock.calls.map(([, , body]) => JSON.parse(body).code),
    ).toEqual([kernelPreloads]);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(
      (await t.run((db) => db.db.get(first.sessionId)))?.preloadVersion,
    ).toBeUndefined();
  });

  it("reuses a credential-free VM across cells and turns in the same chat", async () => {
    const { t, ctx, project, projectId, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(first.sessionReused).toBe(false);
    expect(first.expiresAt).toBeNull();
    vi.setSystemTime(Date.now() + 2 * 86400000);
    await t.action(internal.notebookRuntime.cleanup, {
      notebookId: first.sessionId,
    });
    mocks.refresh.mockResolvedValueOnce({ vm: { state: "paused" } });
    const nextRun = await t.run(async (db) => {
      const id = await db.db.insert("runs", {
        projectId,
        threadId: "chat-one",
        trigger: "chat",
        prompt: "Continue",
        state: "running",
        startedAt: Date.now(),
      });
      await db.db.patch(projectId, { activeRunId: id });
      return id;
    });
    const second = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [{ value: 4 }] },
      nextRun,
    );
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.sessionReused).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][1]).toMatchObject({
      firewall: { rules: [] },
      ttlSeconds: -1,
      autoDeleteSeconds: -1,
      idleTimeoutSeconds: 600,
    });
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(
      "private-freestyle-key",
    );
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder.at(-1)!,
    );
  });
  it("upgrades an existing VM and makes its old scheduled deletion harmless", async () => {
    const { t, ctx, project, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    await t.run((db) =>
      db.db.patch(first.sessionId, { expiresAt: Date.now() + 1800000 }),
    );
    const second = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(second.sessionId).toBe(first.sessionId);
    expect(mocks.update).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        options: {
          ttlSeconds: -1,
          autoDeleteSeconds: -1,
          idleTimeoutSeconds: 600,
        },
      }),
    );
    vi.setSystemTime(Date.now() + 3600000);
    await t.action(internal.notebookRuntime.cleanup, {
      notebookId: first.sessionId,
    });
    expect(
      (await t.query(internal.notebooks.get, { notebookId: first.sessionId }))
        ?.state,
    ).toBe("ready");
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("cleans up abandoned startup and retries a failed VM deletion", async () => {
    const { t, projectId, runId } = await setup();
    const notebook = await t.mutation(internal.notebooks.claim, {
      projectId,
      runId,
      lock: "abandoned",
    });
    vi.setSystemTime(Date.now() + 8 * 60000);
    mocks.delete.mockRejectedValueOnce(new Error("temporary provider error"));
    await t.action(internal.notebookRuntime.cleanup, {
      notebookId: notebook._id,
    });
    expect(
      (await t.query(internal.notebooks.get, { notebookId: notebook._id }))
        ?.state,
    ).toBe("closed");
    await t.action(internal.notebookRuntime.cleanup, {
      notebookId: notebook._id,
      force: true,
      attempt: 1,
    });
    expect(mocks.delete).toHaveBeenCalledTimes(2);
  });
  it("isolates chats and replaces a session after a policy change or expiry", async () => {
    const { t, ctx, project, projectId, runId } = await setup();
    const first = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    await t.run((db) => db.db.patch(runId, { threadId: "chat-two" }));
    const second = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(second.sessionId).not.toBe(first.sessionId);
    await t.run((db) => db.db.patch(projectId, { policyVersion: 2 }));
    const third = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(third.sessionId).not.toBe(second.sessionId);
    await t.run(async (db) => {
      const rows = await db.db.query("notebooks").collect();
      for (const row of rows)
        await db.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    const fourth = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(fourth.sessionId).not.toBe(third.sessionId);
  });
  it("rejects concurrent cells and revoked authorization before code execution", async () => {
    const { t, ctx, project, projectId, runId } = await setup();
    const claimed = await t.mutation(internal.notebooks.claim, {
      projectId,
      runId,
      lock: "lock-one",
    });
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("Another notebook cell");
    await t.mutation(internal.notebooks.release, {
      notebookId: claimed._id,
      lock: "lock-one",
      close: true,
    });
    await t.run((db) => db.db.patch(projectId, { enabled: false }));
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("not authorized");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("removes package routes before starting Jupyter or executing user code", async () => {
    const { ctx, project, runId } = await setup();
    mocks.exec.mockResolvedValueOnce({ statusCode: 1 });
    await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(mocks.grant).toHaveBeenCalledTimes(2);
    expect(mocks.removeGrant).toHaveBeenCalledTimes(2);
    const lastRemoval = Math.max(...mocks.removeGrant.mock.invocationCallOrder);
    const startIndex = mocks.exec.mock.calls.findIndex(([, args]) =>
      args.command.includes("nohup"),
    );
    expect(mocks.exec.mock.invocationCallOrder[startIndex]).toBeGreaterThan(
      lastRemoval,
    );
  });
  it("closes the VM after a timeout or invalid guest response without retrying the cell", async () => {
    const { t, ctx, project, runId } = await setup();
    mocks.exec.mockImplementation(async (_id, { command }) =>
      command.includes("/execute")
        ? {
            statusCode: 0,
            stdout: JSON.stringify({
              ...output,
              status: "timeout",
              kernelReset: true,
            }),
          }
        : { statusCode: 0, stdout: "" },
    );
    const result = await executeNotebook(
      ctx,
      project,
      cell,
      { events: [], results: [] },
      runId,
    );
    expect(result.status).toBe("timeout");
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect((await t.run((db) => db.db.query("notebooks").first()))?.state).toBe(
      "closed",
    );
    mocks.exec.mockImplementation(async (_id, { command }) =>
      command.includes("/execute")
        ? { statusCode: 0, stdout: "not json" }
        : { statusCode: 0, stdout: "" },
    );
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("session has been closed");
    expect(
      mocks.exec.mock.calls.filter(([, args]) =>
        args.command.includes("/execute"),
      ),
    ).toHaveLength(2);
    expect(mocks.delete).toHaveBeenCalledTimes(2);
  });
  it("fails closed if a package route cannot be removed", async () => {
    const { ctx, project, runId } = await setup();
    mocks.exec.mockResolvedValueOnce({ statusCode: 1 });
    mocks.removeGrant.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      executeNotebook(ctx, project, cell, { events: [], results: [] }, runId),
    ).rejects.toThrow("session has been closed");
    expect(
      mocks.exec.mock.calls.some(([, args]) =>
        args.command.includes("/execute"),
      ),
    ).toBe(false);
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
});

describe("clean notebook image cache", () => {
  it("keeps workspace, credential and base snapshot changes in separate caches", () => {
    const keys = [
      notebookImageKey("workspace-a", "key-a", "base-a"),
      notebookImageKey("workspace-b", "key-a", "base-a"),
      notebookImageKey("workspace-a", "key-b", "base-a"),
      notebookImageKey("workspace-a", "key-a", "base-b"),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe(notebookImageKey("workspace-a", "key-a", "base-a"));
  });

  it("reserves one builder and rejects expired, superseded and stale cache updates", async () => {
    const { t } = await setup();
    const key = "test-image";
    expect(
      await t.mutation(internal.notebookImages.reserve, { key, lock: "first" }),
    ).toBe(true);
    expect(
      await t.mutation(internal.notebookImages.reserve, {
        key,
        lock: "second",
      }),
    ).toBe(false);
    vi.setSystemTime(Date.now() + 11 * 60000);
    expect(
      await t.mutation(internal.notebookImages.publish, {
        key,
        lock: "first",
        snapshotId: "stale",
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.notebookImages.reserve, {
        key,
        lock: "second",
      }),
    ).toBe(true);
    await t.mutation(internal.notebookImages.abandon, { key, lock: "first" });
    expect(
      await t.mutation(internal.notebookImages.publish, {
        key,
        lock: "first",
        snapshotId: "stale",
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.notebookImages.publish, {
        key,
        lock: "second",
        snapshotId: "current",
      }),
    ).toBe(true);
    expect(await t.query(internal.notebookImages.get, { key })).toBe("current");
    await t.mutation(internal.notebookImages.invalidate, {
      key,
      snapshotId: "stale",
    });
    expect(await t.query(internal.notebookImages.get, { key })).toBe("current");
    expect(
      await t.mutation(internal.notebookImages.reserve, { key, lock: "third" }),
    ).toBe(false);
    await t.mutation(internal.notebookImages.invalidate, {
      key,
      snapshotId: "current",
    });
    expect(await t.query(internal.notebookImages.get, { key })).toBe(null);
    expect(
      await t.mutation(internal.notebookImages.reserve, { key, lock: "third" }),
    ).toBe(true);
  });
});

describe("notebook display boundary", () => {
  it("preserves subplot axes, positions and titles without admitting remote content", () => {
    const figure = {
      data: [
        { type: "bar", x: ["paid"], y: [98], xaxis: "x", yaxis: "y" },
        {
          type: "scatter",
          x: ["2026-09-30"],
          y: [860600],
          xaxis: "x2",
          yaxis: "y2",
          showlegend: false,
        },
      ],
      layout: {
        xaxis: { domain: [0, 0.45], anchor: "y" },
        yaxis: { domain: [0.55, 1], anchor: "x" },
        xaxis2: { domain: [0.55, 1], anchor: "y2", title: { text: "Day" } },
        yaxis2: {
          domain: [0.55, 1],
          anchor: "x2",
          title: { text: "Paid cents" },
        },
        annotations: [
          {
            text: "Paid revenue",
            x: 0.75,
            y: 1,
            xref: "paper",
            yref: "paper",
            showarrow: false,
            clicktoshow: "onoff",
          },
        ],
        images: [{ source: "https://example.com/track" }],
      },
    };
    const parsed = parseNotebookResult(
      JSON.stringify({ ...output, charts: [figure] }),
    );
    expect(parsed.charts).toHaveLength(1);
    expect(parsed.charts[0].data[1]).toMatchObject({
      xaxis: "x2",
      yaxis: "y2",
      showlegend: false,
    });
    expect(parsed.charts[0].layout?.xaxis2).toEqual(figure.layout.xaxis2);
    expect(parsed.charts[0].layout?.yaxis2).toEqual(figure.layout.yaxis2);
    expect(parsed.charts[0].layout?.annotations?.[0].text).toBe("Paid revenue");
    expect(JSON.stringify(parsed)).not.toMatch(/https:|clicktoshow|images/);
  });
  it("rejects unsupported axes rather than silently flattening the figure", () => {
    const parsed = parseNotebookResult(
      JSON.stringify({
        ...output,
        charts: [
          { data: [{ type: "bar", xaxis: "x5", yaxis: "y5", x: [1], y: [2] }] },
          {
            data: [{ type: "bar", x: [1], y: [2] }],
            layout: { xaxis5: { domain: [0, 0.5] } },
          },
        ],
      }),
    );
    expect(parsed.charts).toHaveLength(0);
    expect(parsed.chartWarnings).toHaveLength(2);
  });
  it("preserves supported chart data and drops executable or remote-loading fields", () => {
    const parsed = parseNotebookResult(
      JSON.stringify({
        ...output,
        charts: [
          {
            data: [
              {
                type: "bar",
                x: ["A"],
                y: [4],
                hovertemplate: '<a href="https://example.com">click</a>',
                xsrc: "remote",
              },
            ],
            layout: {
              title: { text: "<b>Title</b>" },
              images: [{ source: "https://example.com/track" }],
              updatemenus: [{ buttons: [] }],
            },
            config: { plotlyServerURL: "https://example.com" },
          },
        ],
      }),
    );
    expect(parsed.charts[0].data[0].y).toEqual([4]);
    expect(JSON.stringify(parsed)).not.toMatch(
      /https:|hovertemplate|updatemenus|<b>/,
    );
  });
  it("keeps textual results while warning about unsupported or oversized charts", () => {
    const parsed = parseNotebookResult(
      JSON.stringify({
        ...output,
        charts: [
          { data: [{ type: "scattermapbox" }] },
          { data: [{ type: "scatter", x: Array(5001).fill(1) }] },
        ],
      }),
    );
    expect(parsed.stdout).toBe("4\n");
    expect(parsed.charts).toHaveLength(0);
    expect(parsed.chartWarnings).toHaveLength(2);
    expect(() => parseNotebookResult("x".repeat(300001))).toThrow(
      "exceeds limit",
    );
  });
});
