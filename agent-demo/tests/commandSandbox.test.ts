import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Doc, Id } from "../convex/_generated/dataModel";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  exec: vi.fn(),
  write: vi.fn(),
  grant: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("@freestyle-sh/convex", () => ({
  Freestyle: class {
    create = mocks.create;
    delete = mocks.delete;
  },
}));
vi.mock("freestyle", () => ({
  Freestyle: class {
    tls = { rules: { create: mocks.grant } };
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
import { executeCommand } from "../convex/lib/commandSandbox";
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
  runMutation: vi.fn().mockResolvedValue("sandbox"),
  runAction: vi.fn().mockResolvedValue(undefined),
} as unknown as ActionCtx;
const runId = "run" as Id<"runs">;
const command = {
  command: "python3 -c 'print(2 + 2)'",
  timeoutMs: 5000,
  access: "none" as const,
};
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
});
afterEach(() => vi.unstubAllEnvs());
describe("agent shell execution", () => {
  it("runs arbitrary commands with a bounded timeout and no network by default", async () => {
    const result = await executeCommand(ctx, project, command, [], runId);
    expect(result).toMatchObject({
      stdout: "4\n",
      exitCode: 0,
      timedOut: false,
      timeoutMs: 5000,
    });
    expect(mocks.create.mock.calls[0][1]).toMatchObject({
      firewall: { rules: [] },
      ttlSeconds: 180,
    });
    expect(mocks.exec).toHaveBeenCalledWith(
      "vm-1",
      expect.objectContaining({ command: command.command, timeoutMs: 5000 }),
    );
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith(
      "vm-1",
      "/tmp/convex-monitor-evidence.json",
      "[]",
    );
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
  it("only exposes a fixed read proxy to the shell and keeps credentials on the proxy edge", async () => {
    await executeCommand(
      ctx,
      project,
      {
        ...command,
        access: "query",
        functionPath: "health:read",
        argsJson: '{"tenant":"one"}',
      },
      [],
      runId,
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.acquire).toHaveBeenCalledWith(ctx, project, "query");
    expect(mocks.grant.mock.calls[0][0]).toMatchObject({
      domain: "test-project.convex.cloud",
      source: { vmId: "vm-2" },
      match: { method: ["POST"], path: { exact: "/api/query" } },
      transform: [
        { headers: { Authorization: "Convex private-convex-key" } },
        {
          jsonPatch: [
            {
              op: "replace",
              path: "",
              value: {
                path: "health:read",
                args: { tenant: "one" },
                format: "json",
              },
            },
          ],
        },
      ],
    });
    expect(mocks.grant.mock.calls[1][0]).toEqual({
      action: "allow",
      domain: "convex-project.internal",
      source: { vmId: "vm-1" },
      destination: { vmId: "vm-2", port: 8765 },
    });
    expect(
      JSON.stringify([
        ...mocks.write.mock.calls,
        ...mocks.exec.mock.calls,
        ...mocks.create.mock.calls,
      ]),
    ).not.toContain("private-convex-key");
    expect(mocks.delete).toHaveBeenCalledTimes(2);
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  });
  it("rejects invalid paths, paused reads, writes and invalid timeouts before creating resources", async () => {
    await expect(
      executeCommand(
        ctx,
        project,
        { ...command, access: "query", functionPath: "../data:dump" },
        [],
        runId,
      ),
    ).rejects.toThrow("explicit function path");
    await expect(
      executeCommand(
        ctx,
        {
          ...project,
          enabled: false,
        },
        { ...command, access: "logs" },
        [],
        runId,
      ),
    ).rejects.toThrow("Permission denied");
    await expect(
      executeCommand(
        ctx,
        project,
        { ...command, access: "mutation" as "none" },
        [],
        runId,
      ),
    ).rejects.toThrow();
    await expect(
      executeCommand(ctx, project, { ...command, timeoutMs: 90001 }, [], runId),
    ).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it("returns failures and timeouts as visible command results, bounds output and always cleans up", async () => {
    mocks.exec.mockResolvedValueOnce({
      statusCode: 7,
      stdout: "x".repeat(5000),
      stderr: "command failed",
    });
    const failed = await executeCommand(ctx, project, command, [], runId);
    expect(failed).toMatchObject({
      exitCode: 7,
      stderr: "command failed",
      outputTruncated: true,
      timedOut: false,
    });
    expect(failed.stdout).toHaveLength(4000);
    mocks.exec.mockResolvedValueOnce({ statusCode: null, stdout: "partial" });
    expect(
      await executeCommand(ctx, project, command, [], runId),
    ).toMatchObject({ exitCode: null, timedOut: true, stdout: "partial" });
    expect(mocks.delete).toHaveBeenCalledTimes(2);
  });
  it("revokes resources when proxy startup fails without revealing provider errors", async () => {
    mocks.exec.mockRejectedValueOnce(
      new Error("private-convex-key provider failure"),
    );
    await expect(
      executeCommand(ctx, project, { ...command, access: "logs" }, [], runId),
    ).rejects.toThrow("preparing the granted project request");
    expect(mocks.delete).toHaveBeenCalledTimes(2);
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), {
      leaseId: "lease",
    });
  });
});
