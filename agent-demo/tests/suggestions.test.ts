import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  materializeSuggestions,
  type SuggestionContext,
} from "../convex/lib/suggestions";
import { resultSelection } from "../convex/lib/resultSelection";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64),
  stranger = "b".repeat(64);
const model = { provider: "openrouter" as const, id: "z-ai/glm-5.3-flash" };
const config = {
  name: "Shop",
  deploymentUrl: "https://shop-test.convex.cloud",
  keyPrefix: "TARGET_SHOP",
  permissions: {
    readLogs: true,
    runQueries: true,
    analyze: true,
    proposeChanges: true,
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
  const projectId = await t.mutation(api.projects.save, { ...config, token });
  return { t, projectId, args: { token, projectId, model } };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
const prompts = [
  { text: "Compare failed checkouts with worker timeouts" },
  { text: "Chart paid revenue by order status" },
  { text: "Find the cause of the delayed job retries" },
];
describe("AI suggestions cache", () => {
  it("authorizes both reading and generation before touching another workspace", async () => {
    const { t, args } = await setup();
    await expect(
      t.query(api.suggestions.get, { ...args, token: stranger }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.suggestions.request, { ...args, token: stranger }),
    ).rejects.toThrow("this workspace");
    expect(
      await t.run((ctx) => ctx.db.query("suggestions").collect()),
    ).toHaveLength(0);
  });
  it("coalesces overlapping requests, reuses results and isolates model caches", async () => {
    const { t, args } = await setup();
    await t.mutation(api.suggestions.request, args);
    const first = (
      await t.run((ctx) => ctx.db.query("suggestions").collect())
    )[0];
    await t.mutation(api.suggestions.request, { ...args, refresh: true });
    expect((await t.run((ctx) => ctx.db.get(first._id)))?.requestId).toBe(
      first.requestId,
    );
    await t.mutation(internal.suggestions.finish, {
      cacheId: first._id,
      requestId: first.requestId,
      prompts,
    });
    await t.mutation(api.suggestions.request, args);
    expect((await t.run((ctx) => ctx.db.get(first._id)))?.requestId).toBe(
      first.requestId,
    );
    expect(await t.query(api.suggestions.get, args)).toMatchObject({
      state: "ready",
      prompts,
    });
    expect(
      await t.query(api.suggestions.get, {
        ...args,
        model: { ...model, provider: "convex" },
      }),
    ).toBeNull();
  });
  it("refreshes on new evidence and fences late results, keeping usable suggestions after failure", async () => {
    const { t, args, projectId } = await setup();
    await t.mutation(api.suggestions.request, args);
    const first = (
      await t.run((ctx) => ctx.db.query("suggestions").collect())
    )[0];
    await t.mutation(internal.suggestions.finish, {
      cacheId: first._id,
      requestId: first.requestId,
      prompts,
    });
    await t.run((ctx) =>
      ctx.db.insert("logs", {
        projectId,
        eventId: "new-evidence",
        timestamp: Date.now(),
        level: "error",
        functionPath: "orders:submit",
        message: "A new failure",
        source: "test",
      }),
    );
    await t.mutation(api.suggestions.request, args);
    const next = (await t.run((ctx) => ctx.db.get(first._id)))!;
    expect(next.requestId).not.toBe(first.requestId);
    await t.mutation(internal.suggestions.finish, {
      cacheId: first._id,
      requestId: first.requestId,
      prompts: [],
    });
    expect((await t.query(api.suggestions.get, args))?.state).toBe(
      "generating",
    );
    await t.mutation(internal.suggestions.finish, {
      cacheId: first._id,
      requestId: next.requestId,
    });
    expect(await t.query(api.suggestions.get, args)).toMatchObject({
      state: "error",
      prompts,
    });
    await t.mutation(api.suggestions.request, args);
    expect((await t.run((ctx) => ctx.db.get(first._id)))?.requestId).toBe(
      next.requestId,
    );
  });
  it("regenerates on explicit refresh or expiry, and expires a stalled generation", async () => {
    const { t, args } = await setup();
    await t.mutation(api.suggestions.request, args);
    let row = (await t.run((ctx) => ctx.db.query("suggestions").collect()))[0];
    await t.mutation(internal.suggestions.finish, {
      cacheId: row._id,
      requestId: row.requestId,
      prompts,
    });
    await t.mutation(api.suggestions.request, { ...args, refresh: true });
    const fresh = (await t.run((ctx) => ctx.db.get(row._id)))!;
    expect(fresh.requestId).not.toBe(row.requestId);
    await t.mutation(internal.suggestions.finish, {
      cacheId: fresh._id,
      requestId: fresh.requestId,
      prompts,
    });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await t.mutation(api.suggestions.request, args);
    row = (await t.run((ctx) => ctx.db.get(row._id)))!;
    expect(row.requestId).not.toBe(fresh.requestId);
    await t.mutation(internal.suggestions.expire, {
      cacheId: row._id,
      requestId: row.requestId,
    });
    await t.mutation(internal.suggestions.finish, {
      cacheId: row._id,
      requestId: row.requestId,
      prompts: [],
    });
    expect(await t.query(api.suggestions.get, args)).toMatchObject({
      state: "error",
      prompts,
    });
  });
});
const context: SuggestionContext = {
  project: "Shop",
  chats: [],
  sources: [{ id: "log-1", kind: "log", at: 123, text: "Failed order" }],
};
const generated = {
  prompts: prompts.map((p, i) => ({
    ...p,
    evidenceIds: i === 0 ? ["log-1"] : [],
  })),
};
describe("generated suggestion validation", () => {
  it("attaches only verified source IDs with original timestamps", () => {
    const result = materializeSuggestions(generated, context);
    expect(resultSelection.safeParse(result[0].selection).success).toBe(true);
    expect(JSON.parse(result[0].selection!.contextJson).sources[0].at).toBe(
      123,
    );
    expect(result[1].selection).toBeUndefined();
  });
  it("rejects hallucinated sources and duplicate prompts", () => {
    expect(() =>
      materializeSuggestions(
        {
          prompts: generated.prompts.map((p) => ({
            ...p,
            evidenceIds: ["other-project"],
          })),
        },
        context,
      ),
    ).toThrow("Unknown suggestion evidence");
    expect(() =>
      materializeSuggestions(
        {
          prompts: [
            generated.prompts[0],
            generated.prompts[0],
            generated.prompts[2],
          ],
        },
        context,
      ),
    ).toThrow("Duplicate suggestions");
  });
  it("bounds escaped context so a generated suggestion can actually be submitted", () => {
    const large = {
      ...context,
      sources: [0, 1, 2].map((n) => ({
        id: `log-${n}`,
        kind: "log",
        at: n,
        text: '\\"\n'.repeat(460),
      })),
    };
    const result = materializeSuggestions(
      {
        prompts: generated.prompts.map((p) => ({
          ...p,
          evidenceIds: large.sources.map((s) => s.id),
        })),
      },
      large,
    );
    expect(resultSelection.safeParse(result[0].selection).success).toBe(true);
  });
});
