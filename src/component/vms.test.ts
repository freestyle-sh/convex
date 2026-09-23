import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

function initConvexTest() {
  return convexTest(schema, modules);
}

const remote = {
  createdAt: "2026-09-23T12:00:00Z",
  displayName: "Workspace",
  id: "vm-test",
  idleTimeoutSeconds: 600,
  resources: { cpu: 4, memory: 8192, storage: 32768 },
  slug: "workspace-a",
  snapshotId: "freestyle/ubuntu",
  state: "running" as const,
  updatedAt: "2026-09-23T12:00:01Z",
};

describe("managed VM records", () => {
  test("reserves idempotently and links one remote VM", async () => {
    const t = initConvexTest();
    const first = await t.mutation(api.vms.reserve, {
      managementToken: "token-a",
      ownerId: "user-a",
      slug: "workspace-a",
    });
    const second = await t.mutation(api.vms.reserve, {
      managementToken: "token-b",
      ownerId: "user-a",
      slug: "workspace-a",
    });

    expect(second._id).toBe(first._id);
    expect(second.managementToken).toBe("token-a");

    const linked = await t.mutation(api.vms.completeCreate, {
      managementToken: first.managementToken,
      recordId: first._id,
      remote,
    });
    expect(linked.phase).toBe("ready");
    expect(linked.vmId).toBe(remote.id);
  });

  test("keeps owners isolated and deletes only the linked record", async () => {
    const t = initConvexTest();
    const userA = await t.mutation(api.vms.reserve, {
      managementToken: "token-a",
      ownerId: "user-a",
      slug: "shared-name",
    });
    const userB = await t.mutation(api.vms.reserve, {
      managementToken: "token-b",
      ownerId: "user-b",
      slug: "shared-name",
    });
    await t.mutation(api.vms.completeCreate, {
      managementToken: userA.managementToken,
      recordId: userA._id,
      remote: { ...remote, slug: "shared-name" },
    });
    await t.mutation(api.vms.completeCreate, {
      managementToken: userB.managementToken,
      recordId: userB._id,
      remote: { ...remote, id: "vm-test-b", slug: "shared-name" },
    });

    expect(await t.query(api.vms.list, { ownerId: "user-a" })).toHaveLength(1);
    expect(await t.query(api.vms.list, { ownerId: "user-b" })).toHaveLength(1);

    await t.mutation(api.vms.remove, {
      recordId: userA._id,
      vmId: "vm-test",
    });
    expect(
      await t.query(api.vms.get, {
        ownerId: "user-a",
        slug: "shared-name",
      }),
    ).toBeNull();
    expect(
      await t.query(api.vms.get, {
        ownerId: "user-b",
        slug: "shared-name",
      }),
    ).not.toBeNull();
  });

  test("rejects stale links", async () => {
    const t = initConvexTest();
    const record = await t.mutation(api.vms.reserve, {
      managementToken: "token-a",
      ownerId: "user-a",
      slug: "workspace-a",
    });

    await expect(
      t.mutation(api.vms.completeCreate, {
        managementToken: "wrong-token",
        recordId: record._id,
        remote,
      }),
    ).rejects.toThrow("reservation is no longer current");
  });
});
