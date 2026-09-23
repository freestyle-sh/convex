import { describe, expect, test, vi } from "vitest";
import type { ComponentApi } from "../component/_generated/component.js";
import { Freestyle, MANAGEMENT_TOKEN_METADATA_KEY } from "./index.js";

const component = {
  vms: {
    completeCreate: "completeCreate",
    get: "get",
    list: "list",
    recordFailure: "recordFailure",
    remove: "remove",
    reserve: "reserve",
    sync: "sync",
  },
} as unknown as ComponentApi;

function vmData(metadata: Record<string, string>) {
  return {
    createdAt: "2026-09-23T12:00:00Z",
    id: "vm-test",
    metadata,
    networks: [],
    resources: { cpu: 4, memory: 8192, storage: 32768 },
    slug: "workspace-a",
    state: "running",
    updatedAt: "2026-09-23T12:00:01Z",
    vpcs: [],
  };
}

function actionContext(managementToken = "reservation-token") {
  const record = {
    _creationTime: 1,
    _id: "record-a",
    managementToken,
    ownerId: "user-a",
    phase: "provisioning",
    slug: "workspace-a",
    updatedAt: 1,
  };
  const runMutation = vi.fn(async (reference: unknown, args: any) => {
    if (reference === component.vms.reserve) return record;
    if (reference === component.vms.completeCreate) {
      return {
        ...record,
        phase: "ready",
        remote: args.remote,
        vmId: args.remote.id,
      };
    }
    if (reference === component.vms.recordFailure) return null;
    throw new Error(`Unexpected mutation ${String(reference)}`);
  });
  return {
    ctx: {
      runMutation,
      runQuery: vi.fn(),
    } as any,
    record,
    runMutation,
  };
}

describe("Freestyle client", () => {
  test("creates a tagged VM and links the reservation", async () => {
    const { ctx, runMutation } = actionContext();
    let requestBody: any;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json(vmData(requestBody.metadata));
      },
    );
    const freestyle = new Freestyle(component, {
      apiKey: "test-key",
      baseUrl: "https://api.test",
      fetch,
    });

    const result = await freestyle.create(ctx, {
      firewall: { rules: [] },
      metadata: { purpose: "test" },
      ownerId: "user-a",
      slug: "workspace-a",
    });

    expect(requestBody.metadata).toEqual({
      [MANAGEMENT_TOKEN_METADATA_KEY]: "reservation-token",
      purpose: "test",
    });
    expect(result.record.vmId).toBe("vm-test");
    expect(runMutation).toHaveBeenCalledWith(
      component.vms.completeCreate,
      expect.objectContaining({
        managementToken: "reservation-token",
        recordId: "record-a",
      }),
    );
  });

  test("recovers a matching VM after a create conflict", async () => {
    const { ctx } = actionContext();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v5/vms")) {
        return Response.json(
          { code: "CONFLICT", message: "slug exists" },
          { status: 409 },
        );
      }
      return Response.json(
        vmData({ [MANAGEMENT_TOKEN_METADATA_KEY]: "reservation-token" }),
      );
    });
    const freestyle = new Freestyle(component, {
      apiKey: "test-key",
      baseUrl: "https://api.test",
      fetch,
    });

    const result = await freestyle.create(ctx, {
      firewall: { rules: [] },
      ownerId: "user-a",
      slug: "workspace-a",
    });

    expect(result.vm.id).toBe("vm-test");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("refuses to adopt an unrelated VM with the same slug", async () => {
    const { ctx, runMutation } = actionContext();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v5/vms")) {
        return Response.json(
          { code: "CONFLICT", message: "slug exists" },
          { status: 409 },
        );
      }
      return Response.json(
        vmData({ [MANAGEMENT_TOKEN_METADATA_KEY]: "someone-else" }),
      );
    });
    const freestyle = new Freestyle(component, {
      apiKey: "test-key",
      baseUrl: "https://api.test",
      fetch,
    });

    await expect(
      freestyle.create(ctx, {
        firewall: { rules: [] },
        ownerId: "user-a",
        slug: "workspace-a",
      }),
    ).rejects.toThrow("is not managed by this component record");
    expect(runMutation).toHaveBeenCalledWith(
      component.vms.recordFailure,
      expect.objectContaining({ recordId: "record-a" }),
    );
  });

  test("preserves a non-slug conflict when no VM can be recovered", async () => {
    const { ctx, runMutation } = actionContext();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v5/vms")) {
        return Response.json(
          { code: "RESOURCE_LIMIT", message: "VM limit reached" },
          { status: 409 },
        );
      }
      return Response.json(
        { code: "NOT_FOUND", message: "VM not found" },
        { status: 404 },
      );
    });
    const freestyle = new Freestyle(component, {
      apiKey: "test-key",
      baseUrl: "https://api.test",
      fetch,
    });

    await expect(
      freestyle.create(ctx, {
        firewall: { rules: [] },
        ownerId: "user-a",
        slug: "workspace-a",
      }),
    ).rejects.toThrow("VM limit reached");
    expect(runMutation).toHaveBeenCalledWith(
      component.vms.recordFailure,
      expect.objectContaining({
        error: "VM limit reached",
        recordId: "record-a",
      }),
    );
  });
});
