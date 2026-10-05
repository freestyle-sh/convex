import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  normalizeDocumentPatch,
  patchFields,
  unchangedFields,
} from "../convex/lib/documentPatch";
import { grantRequest } from "../convex/lib/sandbox";
import { hasStandingAccess } from "../convex/lib/notebookAccess";
import { normalizeOperation, operationActions } from "../convex/lib/operations";
import type { Doc } from "../convex/_generated/dataModel";

const token = "a".repeat(64),
  stranger = "b".repeat(64);
const modules = import.meta.glob("../convex/**/*.ts");
const original = {
  _id: "j1234567890123456789012345678901",
  _creationTime: 12,
  status: "pending",
  count: 1,
  nested: { a: 1, b: 2 },
};
const patch = () =>
  normalizeDocumentPatch({
    table: "orders",
    id: original._id,
    changes: [
      {
        field: "status",
        before: { exists: true, value: "pending" },
        after: { exists: true, value: "paid" },
      },
    ],
  });
const config = {
  name: "Shop",
  deploymentUrl: "https://shop-test.convex.cloud",
  keyPrefix: "TARGET_SHOP",
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
};
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  await t.mutation(api.workspaces.open, { token: stranger });
  const projectId = await t.mutation(api.projects.save, { token, ...config });
  await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("connections", {
      projectId,
      remoteProjectId: 1,
      teamId: 2,
      deploymentName: "shop-test",
      deploymentType: "dev",
      encryptedToken: "not-a-real-token",
      binding: "test",
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
  return {
    t,
    projectId,
    args: {
      projectId,
      runId,
      kind: "documentPatch" as const,
      functionPath: "",
      argsJson: JSON.stringify(patch()),
      reason: "Update one order.",
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("document changes", () => {
  it("patches only reviewed fields and leaves unrelated changes intact", () => {
    expect(patch().changes).toEqual([
      {
        field: "status",
        before: { exists: true, value: "pending" },
        after: { exists: true, value: "paid" },
      },
    ]);
    expect(patchFields(patch())).toEqual({ status: "paid" });
    expect(unchangedFields(patch(), { ...original, count: 9 })).toBe(true);
    expect(unchangedFields(patch(), { ...original, status: "cancelled" })).toBe(
      false,
    );
    expect(unchangedFields(patch(), { ...original, _id: "different" })).toBe(
      false,
    );
    expect(unchangedFields(patch(), null)).toBe(false);
  });
  it("distinguishes missing fields from null and reviews removals", () => {
    const p = normalizeDocumentPatch({
      table: "orders",
      id: original._id,
      changes: [
        {
          field: "status",
          before: { exists: true, value: "pending" },
          after: { exists: true, value: null },
        },
        {
          field: "count",
          before: { exists: true, value: 1 },
          after: { exists: false },
        },
        {
          field: "newField",
          before: { exists: false },
          after: { exists: true, value: false },
        },
      ],
    });
    expect(p.changes).toContainEqual({
      field: "count",
      before: { exists: true, value: 1 },
      after: { exists: false },
    });
    expect(p.changes).toContainEqual({
      field: "newField",
      before: { exists: false },
      after: { exists: true, value: false },
    });
    expect(patchFields(p).count).toMatch(/^__CONVEX_PLACEHOLDER_undefined_/);
    expect(patchFields(p).status).toBeNull();
  });
  it("rejects system fields, bulk targets, no-op edits, reserved values and oversized changes", () => {
    for (const change of [
      { ...patch(), id: undefined },
      { ...patch(), ids: [original._id] },
      { ...patch(), table: "_scheduled_functions" },
      { ...patch(), changes: [{ ...patch().changes[0], field: "_id" }] },
      { ...patch(), changes: [patch().changes[0], patch().changes[0]] },
      {
        ...patch(),
        changes: [{ ...patch().changes[0], after: { exists: true } }],
      },
      {
        ...patch(),
        changes: [
          { ...patch().changes[0], after: { exists: false, value: null } },
        ],
      },
      {
        ...patch(),
        changes: [
          {
            ...patch().changes[0],
            after: { exists: true, value: { $integer: "abc" } },
          },
        ],
      },
      {
        ...patch(),
        changes: [
          {
            ...patch().changes[0],
            after: { exists: true, value: "x".repeat(16000) },
          },
        ],
      },
    ])
      expect(() => normalizeDocumentPatch(change)).toThrow();
    expect(() =>
      normalizeDocumentPatch({
        ...patch(),
        changes: [
          {
            field: "nested",
            before: { exists: true, value: { a: 1, b: 2 } },
            after: { exists: true, value: { b: 2, a: 1 } },
          },
        ],
      }),
    ).toThrow("No field changes");
    expect(() => normalizeDocumentPatch([])).toThrow();
  });
  it("pins the native mutation to exactly one document and requires write approval", () => {
    const operation = normalizeOperation(
      "documentPatch",
      "injected:path",
      JSON.stringify(patch()),
    );
    const request = grantRequest(
      { deploymentUrl: config.deploymentUrl } as Doc<"projects">,
      { kind: "documentPatch", argsJson: operation.argsJson },
    );
    expect(request.path).toBe("/api/mutation");
    expect(request.body).toEqual({
      path: "_system/frontend/patchDocumentsFields",
      args: {
        table: "orders",
        ids: [original._id],
        fields: { status: "paid" },
        componentId: null,
      },
      format: "json",
    });
    expect(operationActions.documentPatch).toEqual(["deployment:data:write"]);
    expect(hasStandingAccess({ ...config, policyVersion: 1 }, operation)).toBe(
      false,
    );
  });
});

describe("document approval authorization", () => {
  it("prepares an immutable approval without executing or provisioning a key", async () => {
    const { t, args } = await setup();
    const id = await t.mutation(internal.approvals.propose, args);
    const edit = await t.run((ctx) => ctx.db.get(id));
    expect(edit!.state).toBe("pending");
    expect(JSON.parse(edit!.argsJson)).toEqual(patch());
    expect(
      await t.run((ctx) => ctx.db.query("credentialLeases").collect()),
    ).toEqual([]);
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toEqual([]);
    await expect(
      t.mutation(api.approvals.decide, {
        token: stranger,
        proposalId: id,
        approve: true,
      }),
    ).rejects.toThrow("Project not found");
  });
  it("binds approval to project policy and permits only one execution claim", async () => {
    const { t, args, projectId } = await setup();
    const id = await t.mutation(internal.approvals.propose, args);
    await t.mutation(api.approvals.decide, {
      token,
      proposalId: id,
      approve: true,
    });
    expect(
      await t.mutation(internal.approvals.claimExecution, { proposalId: id }),
    ).not.toBeNull();
    expect(
      await t.mutation(internal.approvals.claimExecution, { proposalId: id }),
    ).toBeNull();
    const operation = await t.query(internal.approvals.authorizeExecution, {
      proposalId: id,
      projectId,
    });
    expect(JSON.parse(operation.argsJson)).toEqual(patch());
    await expect(
      t.mutation(api.approvals.decide, {
        token,
        proposalId: id,
        approve: true,
      }),
    ).rejects.toThrow("no longer pending");
    await t.run((ctx) => ctx.db.patch(projectId, { policyVersion: 2 }));
    await expect(
      t.query(internal.approvals.authorizeExecution, {
        proposalId: id,
        projectId,
      }),
    ).rejects.toThrow("Permissions changed");
  });
  it("rejects expired and paused edits", async () => {
    const { t, args, projectId } = await setup();
    const id = await t.mutation(internal.approvals.propose, args);
    await t.run((ctx) => ctx.db.patch(id, { expiresAt: Date.now() - 1 }));
    await expect(
      t.mutation(api.approvals.decide, {
        token,
        proposalId: id,
        approve: true,
      }),
    ).rejects.toThrow("expired");
    await t.mutation(api.approvals.decide, {
      token,
      proposalId: id,
      approve: false,
    });
    const next = await t.mutation(internal.approvals.propose, args);
    await t.run((ctx) => ctx.db.patch(projectId, { enabled: false }));
    await expect(
      t.mutation(api.approvals.decide, {
        token,
        proposalId: next,
        approve: true,
      }),
    ).rejects.toThrow("paused");
  });
});
