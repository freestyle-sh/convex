import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { executeGrant } from "../convex/lib/sandbox";
import type { OperationKind } from "../convex/lib/operations";
vi.mock("../convex/lib/sandbox", () => ({ executeGrant: vi.fn() }));
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
async function setup(kind: OperationKind = "query") {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  const projectId = await t.mutation(api.projects.save, {
    token,
    name: "Access test",
    deploymentUrl: "https://test-123.convex.cloud",
    keyPrefix: "TARGET_TEST",
    enabled: true,
    intervalMinutes: 15,
    permissions: {
      readLogs: false,
      runQueries: false,
      proposeChanges: false,
      analyze: true,
    },
    allowedQueries: [],
    allowedMutations: [],
  });
  await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("connections", {
      projectId,
      remoteProjectId: 1,
      teamId: 1,
      deploymentName: "test-123",
      deploymentType: "dev",
      encryptedToken: "never-exposed",
      binding: "test",
      verifiedAt: Date.now(),
    });
    await ctx.db.patch(projectId, {
      connectionId,
      connectionStatus: "connected",
    });
  });
  const runId = (await t.mutation(api.projects.ask, {
    token,
    projectId,
    prompt: "Investigate with consent",
  }))!;
  await t.mutation(internal.projects.claimRun, { runId });
  const proposalId = await t.mutation(internal.approvals.propose, {
    projectId,
    runId,
    kind,
    functionPath: "diagnostics:check",
    argsJson:
      kind === "logs"
        ? '{"cursor":0}'
        : kind === "inlineQuery"
          ? JSON.stringify({ code: "return 1;" })
          : kind === "functions" || kind === "tables"
            ? "{}"
            : '{"id":"one"}',
    reason: "Needed to answer the user; run exactly once.",
  });
  return { t, projectId, runId, proposalId };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("one-time consent and credential provisioning", () => {
  it.each([
    "query",
    "mutation",
    "action",
    "functions",
    "logs",
    "inlineQuery",
  ] as const)(
    "can propose %s without standing access but cannot mint a key before user consent",
    async (kind) => {
      const { t, projectId, runId, proposalId } = await setup(kind);
      const proposal = (await t.run((ctx) => ctx.db.get(proposalId)))!;
      expect(proposal).toMatchObject({ state: "pending", oneTime: true, kind });
      expect(executeGrant).not.toHaveBeenCalled();
      await expect(
        t.query(internal.approvals.authorizeExecution, {
          proposalId,
          projectId,
        }),
      ).rejects.toThrow("no active user approval");
      await expect(
        t.mutation(internal.connectionStore.startLease, {
          projectId,
          policyVersion: 1,
          name: "premature",
          kind,
          expiresAt: Date.now() + 31 * 60_000,
          proposalId,
        }),
      ).rejects.toThrow("no active user approval");
      await expect(
        t.mutation(internal.approvals.propose, {
          projectId,
          runId,
          kind,
          functionPath: "other:call",
          argsJson:
            kind === "logs"
              ? '{"cursor":0}'
              : kind === "inlineQuery"
                ? JSON.stringify({ code: "return 1;" })
                : "{}",
          reason: "duplicate",
        }),
      ).rejects.toThrow("already awaiting");
      await t.mutation(api.approvals.decide, {
        token,
        proposalId,
        approve: true,
      });
      const claim = await t.mutation(internal.approvals.claimExecution, {
        proposalId,
      });
      expect(claim).not.toBeNull();
      expect(
        await t.mutation(internal.approvals.claimExecution, { proposalId }),
      ).toBeNull();
      const operation = await t.query(internal.approvals.authorizeExecution, {
        proposalId,
        projectId,
      });
      expect(operation.kind).toBe(kind);
      const lease = await t.mutation(internal.connectionStore.startLease, {
        projectId,
        policyVersion: 1,
        name: "exact-operation",
        kind,
        expiresAt: Date.now() + 31 * 60_000,
        proposalId,
      });
      expect(
        (await t.run((ctx) => ctx.db.get(lease.leaseId)))?.proposalId,
      ).toBe(proposalId);
      await expect(
        t.mutation(internal.connectionStore.startLease, {
          projectId,
          policyVersion: 1,
          name: "replay",
          kind,
          expiresAt: Date.now() + 31 * 60_000,
          proposalId,
        }),
      ).rejects.toThrow("already provisioned");
      const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
      expect(project.permissions.runQueries).toBe(false);
      expect(project.permissions.proposeChanges).toBe(false);
      expect(project.allowedQueries).toEqual([]);
      expect(project.policyVersion).toBe(1);
    },
  );
  it("rejects cross-workspace decisions, wrong project and wrong key scope", async () => {
    const { t, projectId, proposalId } = await setup();
    const otherToken = "b".repeat(64);
    await t.mutation(api.workspaces.open, { token: otherToken });
    await expect(
      t.mutation(api.approvals.decide, {
        token: otherToken,
        proposalId,
        approve: true,
      }),
    ).rejects.toThrow();
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    await t.mutation(internal.approvals.claimExecution, { proposalId });
    await expect(
      t.mutation(internal.connectionStore.startLease, {
        projectId,
        policyVersion: 1,
        name: "wrong-scope",
        kind: "mutation",
        expiresAt: Date.now() + 31 * 60_000,
        proposalId,
      }),
    ).rejects.toThrow("scope does not match");
    expect(
      await t.run((ctx) => ctx.db.query("credentialLeases").collect()),
    ).toHaveLength(0);
  });
  it.each(["decline", "expiry", "policy", "paused"])(
    "blocks %s before execution and key creation",
    async (change) => {
      const { t, projectId, proposalId } = await setup("mutation");
      if (change === "decline")
        await t.mutation(api.approvals.decide, {
          token,
          proposalId,
          approve: false,
        });
      if (change === "expiry")
        await t.run((ctx) =>
          ctx.db.patch(proposalId, { expiresAt: Date.now() - 1 }),
        );
      if (change === "policy")
        await t.run((ctx) => ctx.db.patch(projectId, { policyVersion: 2 }));
      if (change === "paused")
        await t.run((ctx) => ctx.db.patch(projectId, { enabled: false }));
      await expect(
        t.mutation(api.approvals.decide, { token, proposalId, approve: true }),
      ).rejects.toThrow();
      expect(executeGrant).not.toHaveBeenCalled();
      expect(
        await t.run((ctx) => ctx.db.query("credentialLeases").collect()),
      ).toHaveLength(0);
    },
  );
  it("invalidates a pending request if the native scope changes", async () => {
    const { t, proposalId } = await setup("functions");
    await t.run((ctx) =>
      ctx.db.patch(proposalId, { allowedActions: ["deployment:deploy"] }),
    );
    await expect(
      t.mutation(api.approvals.decide, { token, proposalId, approve: true }),
    ).rejects.toThrow("Credential scope changed");
    expect(executeGrant).not.toHaveBeenCalled();
  });
  it("rechecks approval after a key is provisioned and before activating it", async () => {
    const { t, projectId, proposalId } = await setup();
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    await t.mutation(internal.approvals.claimExecution, { proposalId });
    const { leaseId } = await t.mutation(internal.connectionStore.startLease, {
      projectId,
      policyVersion: 1,
      name: "test",
      kind: "query",
      expiresAt: Date.now() + 31 * 60_000,
      proposalId,
    });
    await t.run((ctx) =>
      ctx.db.patch(proposalId, { expiresAt: Date.now() - 1 }),
    );
    await expect(
      t.mutation(internal.connectionStore.activateLease, {
        leaseId,
        policyVersion: 1,
      }),
    ).rejects.toThrow("expired");
    expect((await t.run((ctx) => ctx.db.get(leaseId)))?.state).toBe("pending");
  });
  it("executes exact approved arguments once and resumes the same chat without changing standing permissions", async () => {
    const { t, projectId, runId, proposalId } = await setup("mutation");
    await t.mutation(internal.projects.finishRun, {
      runId,
      summary: "Waiting for approval.",
    });
    vi.mocked(executeGrant).mockResolvedValue({
      status: "success",
      value: { done: true },
    });
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    await t.action(internal.execute.approvedMutation, { proposalId });
    await t.action(internal.execute.approvedMutation, { proposalId });
    expect(executeGrant).toHaveBeenCalledOnce();
    expect(executeGrant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: projectId }),
      {
        kind: "mutation",
        functionPath: "diagnostics:check",
        argsJson: '{"id":"one"}',
      },
      runId,
      proposalId,
    );
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe(
      "executed",
    );
    await t.mutation(internal.approvals.resume, { proposalId });
    await t.mutation(internal.approvals.resume, { proposalId });
    const runs = await t.run((ctx) => ctx.db.query("runs").collect());
    expect(runs).toHaveLength(2);
    const continuation = runs.find((r) => r.approvalId === proposalId)!;
    expect(continuation.threadId).toBe(
      runs.find((r) => r._id === runId)!.threadId,
    );
    expect(
      (await t.run((ctx) => ctx.db.get(projectId)))?.allowedMutations,
    ).toEqual([]);
  });
  it("records uncertain results without retrying and ignores stale continuations after a newer user message", async () => {
    const { t, projectId, runId, proposalId } = await setup("action");
    await t.mutation(internal.projects.finishRun, {
      runId,
      summary: "Waiting.",
    });
    vi.mocked(executeGrant).mockRejectedValue(new Error("private diagnostic"));
    await t.mutation(api.approvals.decide, {
      token,
      proposalId,
      approve: true,
    });
    await t.action(internal.execute.approvedMutation, { proposalId });
    await t.action(internal.execute.approvedMutation, { proposalId });
    expect(executeGrant).toHaveBeenCalledOnce();
    const proposal = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(proposal.state).toBe("uncertain");
    expect(proposal.result).not.toContain("private diagnostic");
    const next = await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "A newer message",
    });
    await t.mutation(internal.approvals.resume, { proposalId });
    expect((await t.run((ctx) => ctx.db.get(next!)))?.state).toBe("queued");
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toHaveLength(
      2,
    );
  });
});

it("groups exact cells, queues them per chat, and provisions each approved request only once", async () => {
  const { t, projectId, runId, proposalId: old } = await setup();
  await t.mutation(api.approvals.decide, {
    token,
    proposalId: old,
    approve: false,
  });
  const notebook = {
    code: "print(network)",
    timeoutMs: 5000,
    requests: [
      {
        kind: "query" as const,
        functionPath: "diagnostics:check",
        argsJson: '{"id":"one"}',
      },
      {
        kind: "mutation" as const,
        functionPath: "jobs:retry",
        argsJson: '{"id":"two"}',
      },
    ],
  };
  const proposalId = await t.mutation(internal.approvals.propose, {
    projectId,
    runId,
    ...notebook.requests[0],
    reason: "Inspect and repair the demo",
    notebook,
  });
  await expect(
    t.query(internal.approvals.authorizeExecution, {
      proposalId,
      projectId,
      requestIndex: 0,
    }),
  ).rejects.toThrow("no active");
  await t.mutation(api.approvals.decide, { token, proposalId, approve: true });
  const queued = (await t.run((ctx) => ctx.db.query("runs").collect())).find(
    (r) => r.approvalId === proposalId,
  )!;
  expect(queued.state).toBe("queued");
  expect(
    await t.mutation(internal.projects.claimRun, { runId: queued._id }),
  ).toBeNull();
  await t.mutation(internal.projects.finishRun, {
    runId,
    summary: "Waiting for approval",
  });
  expect(
    await t.mutation(internal.projects.claimRun, { runId: queued._id }),
  ).toBeTruthy();
  const claimed = await t.mutation(internal.approvals.claimExecution, {
    proposalId,
  });
  expect(claimed?.proposal.notebook).toEqual(notebook);
  expect(
    await t.mutation(internal.approvals.claimExecution, { proposalId }),
  ).toBeNull();
  await expect(
    t.query(internal.approvals.authorizeExecution, { proposalId, projectId }),
  ).rejects.toThrow("not found");
  await expect(
    t.query(internal.approvals.authorizeExecution, {
      proposalId,
      projectId,
      requestIndex: 2,
    }),
  ).rejects.toThrow("not found");
  for (const [requestIndex, operation] of notebook.requests.entries()) {
    expect(
      await t.query(internal.approvals.authorizeExecution, {
        proposalId,
        projectId,
        requestIndex,
      }),
    ).toEqual(operation);
    const args = {
      projectId,
      policyVersion: claimed!.project.policyVersion,
      proposalId,
      requestIndex,
      kind: operation.kind,
      name: "key-" + requestIndex,
      expiresAt: Date.now() + 31 * 60000,
    };
    await expect(
      t.mutation(internal.connectionStore.startLease, {
        ...args,
        kind: "action",
      }),
    ).rejects.toThrow("scope");
    await t.mutation(internal.connectionStore.startLease, args);
    await expect(
      t.mutation(internal.connectionStore.startLease, args),
    ).rejects.toThrow("already provisioned");
  }
  await t.run((ctx) => ctx.db.patch(projectId, { policyVersion: 2 }));
  await expect(
    t.query(internal.approvals.authorizeExecution, {
      proposalId,
      projectId,
      requestIndex: 1,
    }),
  ).rejects.toThrow("Permissions changed");
});

it("preserves validated notebook charts and strips executable MIME fields from approval results", async () => {
  const { t, proposalId } = await setup();
  await t.mutation(api.approvals.decide, { token, proposalId, approve: true });
  const notebookOutput = {
    status: "ok",
    stdout: "counts",
    stderr: "",
    text: "",
    executionCount: 1,
    durationMs: 5,
    kernelReset: false,
    outputTruncated: false,
    chartWarnings: [],
    charts: [
      {
        data: [{ type: "bar", x: ["items"], y: [8] }],
        layout: { title: { text: "Inventory" } },
        config: { plotlyServerURL: "https://attacker.invalid" },
      },
    ],
  };
  await t.mutation(internal.approvals.complete, {
    proposalId,
    state: "executed",
    result: "counts",
    notebookOutput,
  });
  const stored = await t.run((ctx) => ctx.db.get(proposalId));
  expect(stored?.notebookOutput.charts[0].data[0].y).toEqual([8]);
  expect(JSON.stringify(stored?.notebookOutput)).not.toContain("attacker");
});

it.each(["logs", "functions", "tables", "query", "inlineQuery"] as const)(
  "issues %s read leases without approval even for previously restricted projects",
  async (kind) => {
    const { t, projectId } = await setup(kind);
    const args = {
      projectId,
      policyVersion: 1,
      name: "read-without-consent",
      kind,
      expiresAt: Date.now() + 31 * 60000,
    };
    const lease = await t.mutation(internal.connectionStore.startLease, args);
    expect(
      (await t.run((ctx) => ctx.db.get(lease.leaseId)))?.proposalId,
    ).toBeUndefined();
    await expect(
      t.mutation(internal.connectionStore.startLease, {
        ...args,
        kind: "mutation",
      }),
    ).rejects.toThrow("approval");
    await expect(
      t.mutation(internal.connectionStore.startLease, {
        ...args,
        kind: "action",
      }),
    ).rejects.toThrow("approval");
    await t.run((ctx) => ctx.db.patch(projectId, { enabled: false }));
    await expect(
      t.mutation(internal.connectionStore.startLease, {
        ...args,
        name: "paused",
      }),
    ).rejects.toThrow("changed");
  },
);

it("resumes only valid pending reads when applying the new read policy", async () => {
  const { t, projectId, proposalId } = await setup("functions");
  const otherIds = await t.run(async (ctx) => {
    const original = (await ctx.db.get(proposalId))!;
    const { _id, _creationTime, ...fields } = original;
    return Promise.all(
      [
        { ...fields, kind: "mutation" as const },
        { ...fields, kind: "action" as const },
        { ...fields, state: "rejected" as const },
        { ...fields, state: "uncertain" as const },
        { ...fields, expiresAt: Date.now() - 1 },
        { ...fields, policyVersion: 99 },
        {
          ...fields,
          notebook: {
            code: "print(network)",
            timeoutMs: 5000,
            requests: [
              {
                kind: "functions" as const,
                functionPath: "Function definitions",
                argsJson: "{}",
              },
              {
                kind: "mutation" as const,
                functionPath: "jobs:retry",
                argsJson: "{}",
              },
            ],
          },
        },
      ].map((row) => ctx.db.insert("proposals", row)),
    );
  });
  const before = await t.run(async (ctx) =>
    Promise.all(otherIds.map((id) => ctx.db.get(id))),
  );
  expect(await t.mutation(internal.approvals.resumePendingReads, {})).toEqual({
    resumed: [proposalId],
  });
  expect(await t.mutation(internal.approvals.resumePendingReads, {})).toEqual({
    resumed: [],
  });
  expect((await t.run((ctx) => ctx.db.get(proposalId)))?.state).toBe(
    "executing",
  );
  expect(
    await t.run(async (ctx) =>
      Promise.all(otherIds.map((id) => ctx.db.get(id))),
    ),
  ).toEqual(before);
  const remaining = await t.run((ctx) =>
    ctx.db.query("credentialLeases").collect(),
  );
  expect(remaining).toHaveLength(0); // Only schedules; credentials are acquired at execution.
  expect((await t.run((ctx) => ctx.db.get(projectId)))?.policyVersion).toBe(1);
});
