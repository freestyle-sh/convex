import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Doc, Id } from "../convex/_generated/dataModel";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  exec: vi.fn(),
  write: vi.fn(),
  grant: vi.fn(),
  update: vi.fn(),
  acquire: vi.fn(),
  remove: vi.fn(),
  take: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("@freestyle-sh/convex", () => ({
  Freestyle: class {
    create = mocks.create;
    delete = mocks.delete;
  },
}));
vi.mock("freestyle", () => ({
  Freestyle: class {
    tls = {
      rules: {
        create: mocks.grant,
        delete: mocks.remove,
        update: mocks.update,
      },
    };
    vms = {
      ref: (id: string) => ({
        id,
        fs: { writeTextFile: (...args: unknown[]) => mocks.write(id, ...args) },
        exec: (args: unknown) => mocks.exec(id, args),
      }),
    };
  },
}));
vi.mock("../convex/lib/toolCredential", () => ({
  acquireCredential: mocks.acquire,
}));
vi.mock("../convex/lib/preparedNetwork", () => ({
  takeReadBundle: mocks.take,
}));
import { openNotebookNetwork } from "../convex/lib/notebookNetwork";
import {
  normalizeRequests,
  hasStandingAccess,
} from "../convex/lib/notebookAccess";
import { operationActions } from "../convex/lib/operations";
const project = {
  _id: "project",
  name: "Test",
  enabled: true,
  cursor: 123,
  deploymentUrl: "https://test-project.convex.cloud",
  keyPrefix: "TARGET_TEST",
  connectionId: "connection",
  policyVersion: 1,
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
  },
  allowedQueries: ["health:read"],
  allowedMutations: ["jobs:retry"],
} as Doc<"projects">;
const ctx = {
  scheduler: { runAfter: mocks.schedule },
  runQuery: vi.fn(),
  runMutation: vi.fn().mockResolvedValue("sandbox"),
  runAction: vi.fn().mockResolvedValue(undefined),
} as unknown as ActionCtx;
const runId = "run" as Id<"runs">;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FREESTYLE_API_KEY", "private-freestyle");
  let sequence = 0;
  mocks.create.mockImplementation(async () => ({
    vm: { id: `vm-${++sequence}` },
  }));
  mocks.exec.mockResolvedValue({ statusCode: 0, stdout: "4\n", stderr: "" });
  mocks.acquire.mockResolvedValue({
    key: "private-convex-key",
    name: "lease-key",
    leaseId: "lease",
  });
  mocks.delete.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.grant.mockImplementation(async ({ domain }) => ({ id: domain }));
  mocks.exec.mockResolvedValue({ statusCode: 0, stdout: "" });
});
afterEach(() => vi.unstubAllEnvs());

describe("Python notebook network grants", () => {
  it("accepts object arguments without weakening request validation or size limits", () => {
    expect(
      normalizeRequests([
        {
          kind: "query",
          functionPath: "health:read",
          argsJson: { filter: { state: "active" }, limit: 10 },
        },
      ]),
    ).toEqual(
      normalizeRequests([
        {
          kind: "query",
          functionPath: "health:read",
          argsJson: '{"filter":{"state":"active"},"limit":10}',
        },
      ]),
    );
    expect(() =>
      normalizeRequests([
        { kind: "tables", functionPath: "", argsJson: { path: "other:query" } },
      ]),
    ).toThrow();
    expect(() =>
      normalizeRequests([
        {
          kind: "query",
          functionPath: "health:read",
          argsJson: { data: "x".repeat(16000) },
        },
      ]),
    ).toThrow();
  });
  it("lists tables through a pinned read-only request without approval or guest credentials", async () => {
    const requests = normalizeRequests([
      { kind: "tables", functionPath: "", argsJson: "{}" },
    ]);
    expect(
      hasStandingAccess(
        {
          ...project,
          permissions: { ...project.permissions, runQueries: false },
        },
        requests[0],
      ),
    ).toBe(true);
    expect(operationActions.tables).toEqual(["deployment:data:view"]);
    const network = await openNotebookNetwork(
      ctx,
      project,
      "notebook",
      runId,
      requests,
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      project,
      "tables",
      undefined,
      undefined,
    );
    const edge = mocks.grant.mock.calls[0][0];
    expect(edge.match).toEqual({
      method: ["POST"],
      path: { exact: "/api/query" },
    });
    expect(edge.transform[1].jsonPatch[0].value).toEqual({
      path: "_system/cli/tables",
      args: { paginationOpts: { cursor: null, numItems: 1000 } },
      format: "json",
    });
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(
      "private-convex-key",
    );
    mocks.exec.mockResolvedValueOnce({
      stdout: JSON.stringify({
        state: "complete",
        status: 200,
        body: JSON.stringify({
          status: "success",
          value: {
            page: [{ name: "orders" }],
            isDone: true,
            continueCursor: "",
          },
        }),
      }),
    });
    expect(await network.receipts()).toEqual([
      { kind: "tables", state: "complete", successful: true },
    ]);
    await network.close();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  });
  it("pins table pagination and rejects arbitrary arguments before issuing access", async () => {
    for (const argsJson of [
      '{"cursor":2}',
      '{"cursor":"' + "x".repeat(4097) + '"}',
      '{"path":"other:query"}',
      '{"numItems":100000}',
    ]) {
      await expect(
        openNotebookNetwork(ctx, project, "notebook", runId, [
          { kind: "tables", functionPath: "", argsJson },
        ]),
      ).rejects.toThrow("pagination cursor");
    }
    expect(mocks.acquire).not.toHaveBeenCalled();
    const network = await openNotebookNetwork(ctx, project, "notebook", runId, [
      { kind: "tables", functionPath: "", argsJson: '{"cursor":"next-page"}' },
    ]);
    expect(
      mocks.grant.mock.calls[0][0].transform[1].jsonPatch[0].value.args,
    ).toEqual({ paginationOpts: { cursor: "next-page", numItems: 1000 } });
    await network.close();
  });
  const requests = [
    {
      kind: "query" as const,
      functionPath: "health:read",
      argsJson: '{"tenant":"one"}',
    },
  ];
  it("only injects credentials on the isolated relay, pins arguments, and revokes all routes and keys", async () => {
    const network = await openNotebookNetwork(
      ctx,
      project,
      "untrusted-notebook",
      runId,
      requests,
    );
    expect(network.network).toEqual([
      expect.objectContaining({ method: "POST", kind: "query" }),
    ]);
    const edge = mocks.grant.mock.calls[0][0];
    expect(edge.source).toEqual({ vmId: "vm-1" });
    expect(edge.transform[0]).toEqual({
      headers: { Authorization: "Convex private-convex-key" },
    });
    expect(edge.transform[1].jsonPatch[0].value).toEqual({
      path: "health:read",
      args: { tenant: "one" },
      format: "json",
    });
    expect(mocks.grant.mock.calls[1][0]).toMatchObject({
      source: { vmId: "untrusted-notebook" },
      destination: { vmId: "vm-1", port: 8765 },
    });
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(
      "private-convex-key",
    );
    expect(JSON.stringify(network.network)).not.toContain("private-convex-key");
    expect(
      mocks.exec.mock.calls.every(([, args]) => args.timeoutMs <= 10000),
    ).toBe(true);
    await network.close();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  });
  it("rejects unapproved mutations and actions before creating any key", async () => {
    await expect(
      openNotebookNetwork(ctx, project, "notebook", runId, [
        { ...requests[0], kind: "mutation" },
      ]),
    ).rejects.toThrow("approval");
    await expect(
      openNotebookNetwork(ctx, project, "notebook", runId, [
        { ...requests[0], kind: "action" },
      ]),
    ).rejects.toThrow("approval");
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it("checks every approved request against its index and pins inline-query secrets only at the edge", async () => {
    const request = {
      kind: "inlineQuery" as const,
      functionPath: "Read-only data query",
      argsJson: '{"code":"return 1;"}',
    };
    vi.mocked(ctx.runQuery).mockResolvedValue({
      argsJson: request.argsJson,
      functionPath: request.functionPath,
      kind: request.kind,
    });
    const network = await openNotebookNetwork(
      ctx,
      project,
      "notebook",
      runId,
      [request],
      "proposal" as Id<"proposals">,
    );
    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), {
      projectId: "project",
      proposalId: "proposal",
      requestIndex: 0,
    });
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      project,
      "inlineQuery",
      "proposal",
      0,
    );
    expect(
      mocks.grant.mock.calls[0][0].transform[1].jsonPatch[0].value.adminKey,
    ).toBe("private-convex-key");
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(
      "private-convex-key",
    );
    await network.close();
    mocks.acquire.mockClear();
    await expect(
      openNotebookNetwork(
        ctx,
        project,
        "notebook",
        runId,
        requests,
        "proposal" as Id<"proposals">,
      ),
    ).rejects.toThrow("differs");
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it("cleans up partial provisioning even if VM deletion and one route deletion fail", async () => {
    mocks.grant.mockRejectedValueOnce(new Error("route failure"));
    mocks.delete.mockRejectedValueOnce(new Error("delete failure"));
    await expect(
      openNotebookNetwork(ctx, project, "notebook", runId, requests),
    ).rejects.toThrow("route failure");
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  });
});

it.each([
  { kind: "logs" as const, functionPath: "", argsJson: '{"cursor":0}' },
  { kind: "query" as const, functionPath: "any:query", argsJson: "{}" },
  { kind: "functions" as const, functionPath: "", argsJson: "{}" },
  {
    kind: "inlineQuery" as const,
    functionPath: "",
    argsJson: '{"code":"return 1;"}',
  },
])(
  "runs $kind reads with scoped injection without consent or legacy read flags",
  async (request) => {
    const readProject = {
      ...project,
      allowedQueries: [],
      permissions: {
        ...project.permissions,
        readLogs: false,
        runQueries: false,
      },
    };
    const network = await openNotebookNetwork(
      ctx,
      readProject,
      "notebook",
      runId,
      [request],
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      readProject,
      request.kind,
      undefined,
      undefined,
    );
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(mocks.grant).toHaveBeenCalledTimes(2);
    await network.close();
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
    mocks.acquire.mockClear();
    await expect(
      openNotebookNetwork(
        ctx,
        { ...readProject, enabled: false },
        "notebook",
        runId,
        [request],
      ),
    ).rejects.toThrow();
    expect(mocks.acquire).not.toHaveBeenCalled();
  },
);

it("uses an already prepared route without provisioning and seals it before background cleanup", async () => {
  mocks.take.mockResolvedValue({
    _id: "bundle",
    vmId: "prepared-relay",
    sandboxId: "sandbox",
    leaseId: "lease",
    routeIds: ["edge", "inbound"],
    slug: "spare",
    domain: "spare.monitor.internal",
  });
  const network = await openNotebookNetwork(
    ctx,
    project,
    "notebook",
    runId,
    [{ kind: "tables", functionPath: "", argsJson: "{}" }],
    undefined,
    "notebook-row" as Id<"notebooks">,
  );
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledWith(
    "prepared-relay",
    "/tmp/monitor-request-config.json",
    expect.stringContaining('"path":"_system/cli/tables"'),
  );
  expect(network.network[0].url).toBe("https://spare.monitor.internal/request");
  await network.close({ defer: true });
  expect(mocks.write).toHaveBeenLastCalledWith(
    "prepared-relay",
    "/tmp/monitor-request-closed",
    "closed",
  );
  expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
    bundleId: "bundle",
  });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
  expect(ctx.runAction).not.toHaveBeenCalled();
});

it("repairs only the claimed private route before arming a prepared request", async () => {
  mocks.take.mockResolvedValue({
    _id: "bundle",
    vmId: "prepared-relay",
    sandboxId: "sandbox",
    leaseId: "lease",
    routeIds: ["edge", "inbound"],
    slug: "spare",
    domain: "spare.monitor.internal",
  });
  mocks.exec
    .mockResolvedValueOnce({ statusCode: 1 })
    .mockResolvedValueOnce({ statusCode: 0 });
  const network = await openNotebookNetwork(
    ctx,
    project,
    "notebook",
    runId,
    [{ kind: "tables", functionPath: "", argsJson: "{}" }],
    undefined,
    "notebook-row" as Id<"notebooks">,
  );
  expect(mocks.update).toHaveBeenCalledWith("inbound", {
    action: "allow",
    domain: "spare.monitor.internal",
    source: { vmId: "notebook" },
    destination: { vmId: "prepared-relay", port: 8765 },
  });
  expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.write.mock.invocationCallOrder[0],
  );
  expect(mocks.grant).not.toHaveBeenCalled();
  expect(mocks.acquire).not.toHaveBeenCalled();
  await network.close({ defer: true });
});

it("revokes a route that never becomes ready without arming or running the notebook", async () => {
  mocks.take.mockResolvedValue({
    _id: "bundle",
    vmId: "prepared-relay",
    sandboxId: "sandbox",
    leaseId: "lease",
    routeIds: ["edge", "inbound"],
    slug: "spare",
    domain: "spare.monitor.internal",
  });
  mocks.exec.mockResolvedValue({ statusCode: 1 });
  await expect(
    openNotebookNetwork(
      ctx,
      project,
      "notebook",
      runId,
      [{ kind: "tables", functionPath: "", argsJson: "{}" }],
      undefined,
      "notebook-row" as Id<"notebooks">,
    ),
  ).rejects.toThrow("cell was not executed");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(mocks.delete).toHaveBeenCalledOnce();
});

it.each(["seal", "schedule"])(
  "falls back to synchronous revocation when %s fails",
  async (failure) => {
    const network = await openNotebookNetwork(ctx, project, "notebook", runId, [
      { kind: "tables", functionPath: "", argsJson: "{}" },
    ]);
    if (failure === "seal")
      mocks.write.mockRejectedValueOnce(new Error("filesystem down"));
    else
      mocks.schedule.mockRejectedValueOnce(new Error("scheduler unavailable"));
    await network.close({ defer: true });
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  },
);

it("returns after durable cleanup scheduling without waiting for provider deletion", async () => {
  const network = await openNotebookNetwork(ctx, project, "notebook", runId, [
    { kind: "tables", functionPath: "", argsJson: "{}" },
  ]);
  await network.close({ defer: true });
  expect(mocks.schedule).toHaveBeenCalledWith(0, expect.anything(), {
    resources: {
      projectId: "project",
      routeIds: expect.arrayContaining(["test-project.convex.cloud"]),
      leaseIds: ["lease"],
      relays: [expect.objectContaining({ sandboxId: "sandbox" })],
    },
  });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
});
