import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Doc, Id } from "../convex/_generated/dataModel";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  exec: vi.fn(),
  delete: vi.fn(),
  grant: vi.fn(),
  acquire: vi.fn(),
  ref: vi.fn(),
}));
vi.mock("@freestyle-sh/convex", () => ({
  Freestyle: class {
    create = mocks.create;
    exec = mocks.exec;
    delete = mocks.delete;
  },
}));
vi.mock("freestyle", () => ({
  Freestyle: class {
    tls = { rules: { create: mocks.grant } };
    vms = { ref: mocks.ref };
  },
}));
vi.mock("../convex/lib/toolCredential", () => ({
  acquireCredential: mocks.acquire,
}));
import { executeGrant } from "../convex/lib/sandbox";
const project = {
  _id: "test-project",
  enabled: true,
  deploymentUrl: "https://safe-app.convex.cloud",
  keyPrefix: "TARGET_TEST",
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
  runQuery: vi.fn(),
  runMutation: vi.fn().mockResolvedValue("sandbox-id"),
  runAction: vi.fn().mockResolvedValue(undefined),
} as unknown as ActionCtx;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ctx.runQuery).mockResolvedValue({
    kind: "mutation",
    functionPath: "jobs:retry",
    argsJson: '{"jobId":"one"}',
  });
  mocks.acquire.mockResolvedValue({
    key: "fresh-scoped-key",
    name: "tool-key-name",
    leaseId: "lease-id",
  });
  vi.stubEnv("TARGET_TEST_LOGS_KEY", "private-logs-credential");
  vi.stubEnv("TARGET_TEST_QUERY_KEY", "private-query-credential");
  vi.stubEnv("TARGET_TEST_WRITE_KEY", "private-write-credential");
  mocks.create.mockResolvedValue({ vm: { id: "specific-vm-id" } });
  mocks.ref.mockReturnValue({ exec: mocks.exec });
  mocks.grant.mockResolvedValue({ id: "rule-id" });
  mocks.exec.mockResolvedValue({
    statusCode: 0,
    stdout: '{"status":"success","value":null}',
  });
  mocks.delete.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("sandbox credential grants", () => {
  it("requires approval for document edits and pins one document with a scoped key", async () => {
    const argsJson = JSON.stringify({
      table: "orders",
      id: "j1234567890123456789012345678901",
      changes: [
        {
          field: "status",
          before: { exists: true, value: "pending" },
          after: { exists: true, value: "paid" },
        },
      ],
    });
    const connected = {
      ...project,
      connectionId: "connection-id",
    } as Doc<"projects">;
    await expect(
      executeGrant(ctx, connected, { kind: "documentPatch", argsJson }),
    ).rejects.toThrow("requires a user approval");
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    vi.mocked(ctx.runQuery).mockResolvedValue({
      kind: "documentPatch",
      functionPath: "orders / j1234567890123456789012345678901",
      argsJson,
    });
    await executeGrant(
      ctx,
      connected,
      { kind: "documentPatch", argsJson },
      undefined,
      "approved" as Id<"proposals">,
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      connected,
      "documentPatch",
      "approved",
    );
    const rule = mocks.grant.mock.calls[0][0];
    expect(rule.match).toEqual({
      method: ["POST"],
      path: { exact: "/api/mutation" },
    });
    expect(rule.transform).toEqual([
      { headers: { Authorization: "Convex fresh-scoped-key" } },
      {
        jsonPatch: [
          {
            op: "replace",
            path: "",
            value: {
              path: "_system/frontend/patchDocumentsFields",
              args: {
                table: "orders",
                ids: ["j1234567890123456789012345678901"],
                fields: { status: "paid" },
                componentId: null,
              },
              format: "json",
            },
          },
        ],
      },
    ]);
    expect(JSON.stringify(mocks.exec.mock.calls)).not.toContain(
      "fresh-scoped-key",
    );
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
  it("injects only the selected credential and pins the write payload outside the guest", async () => {
    await executeGrant(
      ctx,
      project,
      {
        kind: "mutation",
        functionPath: "jobs:retry",
        argsJson: '{"jobId":"one"}',
      },
      undefined,
      "approved" as Id<"proposals">,
    );
    const config = mocks.create.mock.calls[0][1];
    expect(config.firewall).toEqual({ rules: [] });
    expect(config.ttlSeconds).toBe(180);
    const rule = mocks.grant.mock.calls[0][0];
    expect(rule.domain).toBe("safe-app.convex.cloud");
    expect(rule.source).toEqual({ vmId: "specific-vm-id" });
    expect(rule.match).toEqual({
      method: ["POST"],
      path: { exact: "/api/mutation" },
    });
    expect(rule.transform).toEqual([
      { headers: { Authorization: "Convex private-write-credential" } },
      {
        jsonPatch: [
          {
            op: "replace",
            path: "",
            value: {
              path: "jobs:retry",
              args: { jobId: "one" },
              format: "json",
            },
          },
        ],
      },
    ]);
    expect(JSON.stringify(mocks.exec.mock.calls)).not.toContain(
      "private-write-credential",
    );
    expect(JSON.stringify(config)).not.toContain("private-query-credential");
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.ref).toHaveBeenCalledWith("specific-vm-id");
  });
  it("injects the freshly minted key for a connected project and revokes it after execution", async () => {
    await executeGrant(
      ctx,
      { ...project, connectionId: "connection-id" } as Doc<"projects">,
      { kind: "logs", cursor: 0 },
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ connectionId: "connection-id" }),
      "logs",
      undefined,
    );
    expect(
      mocks.grant.mock.calls[0][0].transform[0].headers.Authorization,
    ).toBe("Convex fresh-scoped-key");
    expect(JSON.stringify(mocks.exec.mock.calls)).not.toContain(
      "fresh-scoped-key",
    );
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(
      "fresh-scoped-key",
    );
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease-id",
    });
  });
  it("accepts serialized approval field order but rejects altered arguments before provisioning", async () => {
    vi.mocked(ctx.runQuery).mockResolvedValue({
      argsJson: '{"jobId":"one"}',
      functionPath: "jobs:retry",
      kind: "mutation",
    });
    await expect(
      executeGrant(
        ctx,
        project,
        {
          kind: "mutation",
          functionPath: "jobs:retry",
          argsJson: '{"jobId":"two"}',
        },
        undefined,
        "approved" as Id<"proposals">,
      ),
    ).rejects.toThrow("differs");
    expect(mocks.create).not.toHaveBeenCalled();
    await executeGrant(
      ctx,
      project,
      {
        kind: "mutation",
        functionPath: "jobs:retry",
        argsJson: '{"jobId":"one"}',
      },
      undefined,
      "approved" as Id<"proposals">,
    );
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("pins approved inline query code and injects the API body credential only at the edge", async () => {
    const argsJson = JSON.stringify({
      code: 'return await ctx.db.query("jobs").take(3);',
    });
    vi.mocked(ctx.runQuery).mockResolvedValue({
      argsJson,
      functionPath: "Read-only data query",
      kind: "inlineQuery",
    });
    await executeGrant(
      ctx,
      { ...project, connectionId: "connection-id" } as Doc<"projects">,
      { kind: "inlineQuery", argsJson },
      undefined,
      "approved" as Id<"proposals">,
    );
    expect(mocks.acquire).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      "inlineQuery",
      "approved",
    );
    const rule = mocks.grant.mock.calls[0][0];
    expect(rule.match.path.exact).toBe("/api/run_test_function");
    const body = rule.transform[1].jsonPatch[0].value;
    expect(body.adminKey).toBe("fresh-scoped-key");
    expect(body.bundle.source).toContain(
      'return await ctx.db.query("jobs").take(3);',
    );
    expect(body.bundle.source).toContain("convex:/_system/repl/wrappers.js");
    expect(JSON.stringify(mocks.exec.mock.calls)).not.toContain(
      "fresh-scoped-key",
    );
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
  it("revokes a minted key even when VM creation fails", async () => {
    mocks.create.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      executeGrant(
        ctx,
        { ...project, connectionId: "connection-id" } as Doc<"projects">,
        { kind: "logs", cursor: 0 },
      ),
    ).rejects.toThrow("starting the VM");
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease-id",
    });
  });
  it("never gives arbitrary analysis code any network or credential grant", async () => {
    mocks.exec.mockResolvedValue({ statusCode: 0, stdout: "result" });
    await executeGrant(ctx, project, {
      kind: "analysis",
      code: "print(len(data))",
      data: [],
    });
    const config = mocks.create.mock.calls[0][1];
    expect(config.tls).toBeUndefined();
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(config.firewall).toEqual({ rules: [] });
    expect(JSON.stringify(config)).not.toContain("credential");
  });
  it("blocks unauthorized functions before provisioning and deletes after a failed command", async () => {
    await expect(
      executeGrant(ctx, project, {
        kind: "mutation",
        functionPath: "data:deleteEverything",
        argsJson: "{}",
      }),
    ).rejects.toThrow("requires a user approval");
    expect(mocks.create).not.toHaveBeenCalled();
    vi.mocked(ctx.runQuery).mockResolvedValue({
      kind: "mutation",
      functionPath: "jobs:retry",
      argsJson: "{}",
    });
    mocks.exec.mockResolvedValue({
      statusCode: 1,
      stderr: "private-write-credential",
    });
    await expect(
      executeGrant(
        ctx,
        project,
        {
          kind: "mutation",
          functionPath: "jobs:retry",
          argsJson: "{}",
        },
        undefined,
        "approved" as Id<"proposals">,
      ),
    ).rejects.toThrow("sandbox failed");
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
});
