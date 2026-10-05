import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { openCredential, sealCredential } from "../convex/lib/credentials";
import { acquireCredential } from "../convex/lib/toolCredential";
import type { ActionCtx } from "../convex/_generated/server";
import { deploymentOrigin } from "../convex/lib/policy";
import { verifyLogs, readTokenExpiry } from "../convex/lib/platform";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
const accessToken = "team:sample|private-management-secret-for-tests";
const project = {
  id: 7,
  teamId: 4,
  name: "Example",
  slug: "example",
  teamSlug: "my-team",
};
const deployment = {
  name: "good-app-123",
  projectId: 7,
  deploymentType: "dev",
  kind: "cloud",
  deploymentUrl: "https://good-app-123.eu-west-1.convex.cloud",
};
const calls: Array<{
  url: string;
  init: RequestInit;
  body: Record<string, any>;
}> = [];
let keys: Array<{ name: string; allowedActions: string[]; expiresAt: number }>;
let override:
  | ((
      url: string,
      init: RequestInit,
      body: Record<string, any>,
    ) => Response | undefined)
  | undefined;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  return t;
}
const connectArgs = {
  token,
  accessToken,
  remoteProjectId: project.id,
  deploymentName: deployment.name,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPERATOR_TOKEN", token);
  vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "ab".repeat(32));
  keys = [];
  calls.length = 0;
  override = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const body = init.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, init, body });
      const replacement = override?.(url, init, body);
      if (replacement) return replacement;
      if (url.endsWith("/token_details"))
        return json({ type: "teamToken", teamId: 4, id: 11 });
      if (url.includes("/teams/4/list_access_tokens?"))
        return json({
          items: [{ id: 11, expiresAt: Date.now() + 365 * 86_400_000 }],
          pagination: { hasMore: false },
        });
      if (url.includes("/teams/4/projects?"))
        return json({ items: [project], pagination: { hasMore: false } });
      if (url.endsWith("/projects/7")) return json(project);
      if (url.includes("/projects/7/list_deployments?"))
        return json([deployment, { kind: "local", name: "local" }]);
      if (url.endsWith("/create_deploy_key")) {
        keys.push(body as any);
        return json({ deployKey: "dev:good-app-123|new-private-tool-key" });
      }
      if (url.endsWith("/list_deploy_keys")) return json(keys);
      if (url.endsWith("/delete_deploy_key")) {
        keys = keys.filter((k) => k.name !== body.id);
        return new Response(null, { status: 200 });
      }
      if (url.includes("/api/stream_function_logs"))
        return json({ entries: [], newCursor: 0 });
      throw new Error(`Unmocked endpoint ${url}`);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verified Convex connections", () => {
  it("keeps successful deployments connected when another selected deployment fails", async () => {
    const t = await setup();
    const second = {
      ...deployment,
      name: "second-app-456",
      deploymentUrl: "https://second-app-456.convex.cloud",
      deploymentType: "prod",
    };
    let rejectSecond = true;
    override = (url) =>
      url.includes("list_deployments?")
        ? json([deployment, second])
        : rejectSecond && url.startsWith(second.deploymentUrl)
          ? json({}, 403)
          : undefined;
    const outcomes = await Promise.allSettled([
      t.action(api.connections.connect, connectArgs),
      t.action(api.connections.connect, {
        ...connectArgs,
        deploymentName: second.name,
      }),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    const first = (await t.query(api.projects.list, { token }))[0];
    expect(first.deploymentUrl).toBe(deployment.deploymentUrl);
    expect(keys).toHaveLength(0);
    rejectSecond = false;
    await t.action(api.connections.connect, {
      ...connectArgs,
      deploymentName: second.name,
    });
    const connected = await t.query(api.projects.list, { token });
    expect(connected).toHaveLength(2);
    expect(connected.find((p) => p._id === first._id)?.threadId).toBe(
      first.threadId,
    );
    expect(new Set(connected.map((p) => p.connectionId)).size).toBe(2);
    expect(keys).toHaveLength(0);
  });
  it("matches token expiry by id across pages and distinguishes no expiry from unknown", async () => {
    const expiresAt = Date.now() + 86_400_000;
    override = (url) =>
      url.includes("list_access_tokens?")
        ? url.includes("cursor=next")
          ? json({
              items: [{ id: 11, expiresAt }],
              pagination: { hasMore: false },
            })
          : json({
              items: [{ id: 99, expiresAt: null }],
              pagination: { hasMore: true, nextCursor: "next" },
            })
        : undefined;
    expect(await readTokenExpiry(accessToken)).toEqual({
      expiresAt,
      checkedAt: Date.now(),
    });
    override = (url) =>
      url.includes("list_access_tokens?")
        ? json({
            items: [{ id: 11, expiresAt: null }],
            pagination: { hasMore: false },
          })
        : undefined;
    expect((await readTokenExpiry(accessToken)).expiresAt).toBeNull();
    override = (url) =>
      url.includes("list_access_tokens?")
        ? json({ secret: accessToken }, 403)
        : undefined;
    expect(await readTokenExpiry(accessToken)).toEqual({
      checkedAt: Date.now(),
    });
  });
  it("reuses encrypted access only within its workspace and refreshes expiry without exposing the token", async () => {
    const t = await setup();
    const sourceProjectId = await t.action(
      api.connections.connect,
      connectArgs,
    );
    const before = (await t.query(api.projects.list, { token }))[0];
    expect(before.tokenExpiresAt).toBe(Date.now() + 365 * 86_400_000);
    const found = await t.action(api.connections.discover, {
      token,
      sourceProjectId,
    });
    expect(found.projects).toEqual([project]);
    expect(JSON.stringify(found)).not.toContain(accessToken);
    const expiry = await t.action(api.connections.refreshTokenExpiry, {
      token,
      sourceProjectId,
    });
    expect(expiry.expiresAt).toBe(before.tokenExpiresAt);
    override = (url) =>
      url.includes("list_access_tokens?") ? json({}, 403) : undefined;
    await t.action(api.connections.refreshTokenExpiry, {
      token,
      sourceProjectId,
    });
    expect(
      (await t.query(api.projects.list, { token }))[0].tokenExpiresAt,
    ).toBe(before.tokenExpiresAt);
    const other = "b".repeat(64);
    await t.mutation(api.workspaces.open, { token: other });
    const count = calls.length;
    await expect(
      t.action(api.connections.discover, { token: other, sourceProjectId }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.action(api.connections.refreshTokenExpiry, {
        token: other,
        sourceProjectId,
      }),
    ).rejects.toThrow("this workspace");
    expect(calls).toHaveLength(count);
    await t.run((ctx) => ctx.db.patch(sourceProjectId, { enabled: false }));
    await expect(
      t.action(api.connections.discover, { token, sourceProjectId }),
    ).rejects.toThrow("active connection");
  });
  it("allows Convex's 60-second empty log poll to complete", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("timeout")),
          );
          setTimeout(
            () => resolve(json({ entries: [], newCursor: 0 })),
            60_000,
          );
        }),
    );
    const result = expect(
      verifyLogs(deployment.deploymentUrl, "test-key"),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });
  it("requires operator authorization before any upstream request", async () => {
    const t = await setup();
    await expect(
      t.action(api.connections.discover, { token: "wrong", accessToken }),
    ).rejects.toThrow("Workspace unavailable");
    await expect(
      t.action(api.connections.connect, { ...connectArgs, token: "wrong" }),
    ).rejects.toThrow("Workspace unavailable");
    expect(calls).toHaveLength(0);
  });
  it("discovers existing projects with pagination and returns metadata only", async () => {
    const t = await setup();
    override = (url) =>
      url.includes("/teams/4/projects?")
        ? json({
            items: [project],
            pagination: { hasMore: true, nextCursor: "next/page" },
          })
        : undefined;
    const result = await t.action(api.connections.discover, {
      token,
      accessToken,
      cursor: "previous/page",
    });
    expect(result).toEqual({ projects: [project], nextCursor: "next/page" });
    expect(calls[1].url).toContain("cursor=previous%2Fpage");
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(calls.every((c) => c.init.redirect === "error")).toBe(true);
  });
  it("rejects deploy/project tokens and redacts upstream errors", async () => {
    const t = await setup();
    override = (url) =>
      url.endsWith("/token_details")
        ? json({ type: "projectToken", projectId: 7 })
        : undefined;
    await expect(
      t.action(api.connections.discover, { token, accessToken }),
    ).rejects.toThrow("team access token");
    override = () => json({ error: accessToken }, 401);
    await expect(
      t.action(api.connections.discover, { token, accessToken }),
    ).rejects.toThrow("Convex rejected this token");
    try {
      await t.action(api.connections.discover, { token, accessToken });
    } catch (e) {
      expect(String(e)).not.toContain(accessToken);
    }
  });
  it("revalidates project ownership and ignores local deployments", async () => {
    const t = await setup();
    expect(
      (
        await t.action(api.connections.deployments, {
          token,
          accessToken,
          remoteProjectId: 7,
        })
      ).deployments,
    ).toEqual([deployment]);
    override = (url) =>
      url.endsWith("/projects/7")
        ? json({ ...project, teamId: 999 })
        : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("connected team");
    expect(calls.some((c) => c.url.endsWith("create_deploy_key"))).toBe(false);
    expect(await t.query(api.projects.list, { token })).toEqual([]);
  });
  it("rejects forged deployment selections and unsafe deployment URLs before issuing keys", async () => {
    const t = await setup();
    await expect(
      t.action(api.connections.connect, {
        ...connectArgs,
        deploymentName: "other-app",
      }),
    ).rejects.toThrow("belonging to this project");
    override = (url) =>
      url.includes("list_deployments?")
        ? json([{ ...deployment, deploymentUrl: "https://attacker.example" }])
        : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow();
    expect(calls.some((c) => c.url.endsWith("create_deploy_key"))).toBe(false);
    expect(deploymentOrigin(deployment.deploymentUrl)).toBe(
      deployment.deploymentUrl,
    );
  });
  it("verifies logs with a freshly scoped key, revokes it, encrypts authority, and connects idempotently", async () => {
    const t = await setup();
    const id = await t.action(api.connections.connect, connectArgs);
    const rows = await t.query(api.projects.list, { token });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      connectionStatus: "connected",
      enabled: true,
      permissions: {
        readLogs: true,
        analyze: true,
        runQueries: true,
        proposeChanges: false,
      },
    });
    expect(JSON.stringify(rows)).not.toContain(accessToken);
    const connection = (await t.run((ctx) =>
      ctx.db.get(rows[0].connectionId!),
    ))!;
    expect(connection.encryptedToken).not.toContain(accessToken);
    expect(openCredential(connection.encryptedToken!, connection.binding)).toBe(
      accessToken,
    );
    expect(keys).toHaveLength(0);
    const issued = calls.find((c) => c.url.endsWith("create_deploy_key"))!;
    expect(issued.body.allowedActions).toEqual(["deployment:logs:view"]);
    expect(issued.body.expiresAt).toBe(Date.now() + 31 * 60_000);
    const probe = calls.find((c) => c.url.includes("stream_function_logs"))!;
    expect(probe.init.headers).toEqual({
      Authorization: "Convex dev:good-app-123|new-private-tool-key",
    });
    expect(await t.action(api.connections.connect, connectArgs)).toBe(id);
    expect(await t.query(api.projects.list, { token })).toHaveLength(1);
    expect(
      await t.query(api.projects.conversations, { token, projectId: id }),
    ).toHaveLength(1);
  });
  it("does not save a connection if log access fails or temporary key removal fails", async () => {
    const t = await setup();
    override = (url) =>
      url.includes("stream_function_logs") ? json({}, 403) : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("denied log access");
    expect(keys).toHaveLength(0);
    expect(await t.query(api.projects.list, { token })).toHaveLength(0);
    override = (url) =>
      url.endsWith("delete_deploy_key") ? json({}, 403) : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("removal of the temporary");
    expect(await t.query(api.projects.list, { token })).toHaveLength(0);
  });
  it("refuses broader, unexpiring, or reused OAuth authority and never deletes the supplied token", async () => {
    const t = await setup();
    override = (url) =>
      url.endsWith("create_deploy_key")
        ? json({
            deployKey: `dev:${deployment.name}|${accessToken.split("|")[1]}`,
          })
        : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("reused the connection token");
    override = (url) =>
      url.endsWith("list_deploy_keys")
        ? json(
            keys.map((k) => ({ ...k, allowedActions: ["deployment:deploy"] })),
          )
        : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("permissions and expiry");
    override = (url) =>
      url.endsWith("list_deploy_keys")
        ? json(keys.map((k) => ({ ...k, expiresAt: null })))
        : undefined;
    await expect(
      t.action(api.connections.connect, connectArgs),
    ).rejects.toThrow("permissions and expiry");
    expect(
      calls
        .filter((c) => c.url.endsWith("delete_deploy_key"))
        .every(
          (c) =>
            c.body.id.startsWith("convex-monitor-check-") &&
            c.body.id !== accessToken,
        ),
    ).toBe(true);
    expect(await t.query(api.projects.list, { token })).toHaveLength(0);
  });
  it("encrypts with randomized nonces and rejects tampering or swapped record bindings", () => {
    const a = sealCredential(accessToken, "first"),
      b = sealCredential(accessToken, "first");
    expect(a).not.toBe(b);
    expect(openCredential(a, "first")).toBe(accessToken);
    expect(() => openCredential(a, "second")).toThrow("could not be decrypted");
    const parts = a.split(".");
    parts[2] = Buffer.alloc(16).toString("base64");
    expect(() => openCredential(parts.join("."), "first")).toThrow(
      "could not be decrypted",
    );
    vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "");
    expect(() => sealCredential(accessToken, "x")).toThrow(
      "temporarily unavailable",
    );
  });
  it("provisions unique per-tool keys and blocks activation after a disconnect", async () => {
    const t = await setup();
    const projectId = await t.action(api.connections.connect, connectArgs);
    const p = (await t.query(api.projects.list, { token }))[0];
    const ctx = {
      runMutation: t.mutation.bind(t),
      runAction: t.action.bind(t),
    } as unknown as ActionCtx;
    const a = await acquireCredential(ctx, p, "logs");
    const b = await acquireCredential(ctx, p, "logs");
    expect(a.name).not.toBe(b.name);
    expect(keys).toHaveLength(2);
    await t.action(internal.connections.cleanupLease, { leaseId: a.leaseId });
    expect(keys).toHaveLength(1);
    await t.mutation(api.connectionStore.disconnect, { token, projectId });
    await expect(acquireCredential(ctx, p, "logs")).rejects.toThrow(
      "connection or permissions changed",
    );
    await t.action(internal.connections.cleanupLease, { leaseId: b.leaseId });
    expect(keys).toHaveLength(0);
    const connection = await t.run((c) => c.db.get(p.connectionId!));
    expect(connection?.encryptedToken).toBeUndefined();
    expect((await t.query(api.projects.list, { token }))[0].enabled).toBe(
      false,
    );
    expect(await t.action(api.connections.connect, connectArgs)).toBe(
      projectId,
    );
  });
  it("revokes a key minted during a permission change before it can reach a sandbox", async () => {
    const t = await setup();
    await t.action(api.connections.connect, connectArgs);
    const p = (await t.query(api.projects.list, { token }))[0];
    const lease = await t.mutation(internal.connectionStore.startLease, {
      projectId: p._id,
      policyVersion: p.policyVersion,
      kind: "logs",
      name: "test-race-key",
      expiresAt: Date.now() + 31 * 60_000,
    });
    await t.mutation(api.connectionStore.disconnect, {
      token,
      projectId: p._id,
    });
    await expect(
      t.mutation(internal.connectionStore.activateLease, {
        leaseId: lease.leaseId,
        policyVersion: p.policyVersion,
      }),
    ).rejects.toThrow("access changed");
    await t.action(internal.connections.cleanupLease, {
      leaseId: lease.leaseId,
    });
    expect((await t.run((ctx) => ctx.db.get(lease.leaseId)))?.state).toBe(
      "revoked",
    );
  });
  it("keeps credentials for cleanup after disconnect, retries failures, and erases at expiry", async () => {
    const t = await setup();
    const projectId = await t.action(api.connections.connect, connectArgs);
    const p = (await t.query(api.projects.list, { token }))[0];
    const ctx = {
      runMutation: t.mutation.bind(t),
      runAction: t.action.bind(t),
    } as unknown as ActionCtx;
    const granted = await acquireCredential(ctx, p, "logs");
    await t.mutation(api.connectionStore.disconnect, { token, projectId });
    override = (url) =>
      url.endsWith("delete_deploy_key") ? json({}, 503) : undefined;
    await t.action(internal.connections.cleanupLease, {
      leaseId: granted.leaseId,
    });
    expect((await t.run((c) => c.db.get(granted.leaseId)))?.state).toBe(
      "cleanup_pending",
    );
    expect(
      (await t.run((c) => c.db.get(p.connectionId!)))?.encryptedToken,
    ).toBeTruthy();
    vi.setSystemTime(Date.now() + 32 * 60_000);
    await t.action(internal.connections.cleanupLease, {
      leaseId: granted.leaseId,
    });
    expect(
      (await t.run((c) => c.db.get(p.connectionId!)))?.encryptedToken,
    ).toBeUndefined();
  });
});
