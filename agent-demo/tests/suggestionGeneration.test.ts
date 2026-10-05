import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { Agent } from "@convex-dev/agent";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "ab".repeat(32));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("generates and saves suggestions through Convex Agent without tools or chat messages", async () => {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  await t.action(api.settings.save, {
    token,
    openrouterKey: "test-api-key",
    modelProvider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    snapshot: "freestyle/ubuntu",
  });
  const projectId = await t.mutation(api.projects.save, {
    token,
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
  });
  const model = { provider: "openrouter" as const, id: "z-ai/glm-5.3-flash" };
  const prompts = [
    {
      text: "Compare failed orders with successful checkouts",
      evidenceIds: [],
    },
    { text: "Chart paid revenue over the last week", evidenceIds: [] },
    { text: "Investigate delayed job retries", evidenceIds: [] },
  ];
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          id: "test",
          object: "chat.completion",
          created: 1,
          model: model.id,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ prompts }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  let observedError: unknown;
  const original = Agent.prototype.generateText;
  vi.spyOn(Agent.prototype, "generateText").mockImplementation(async function (
    this: Agent,
    ...args: any[]
  ) {
    try {
      return await original.apply(this, args as any);
    } catch (error) {
      observedError = error;
      throw error;
    }
  });
  const before = await t.query(api.projects.conversations, {
    token,
    projectId,
  });
  await t.mutation(api.suggestions.request, { token, projectId, model });
  const row = (await t.run((ctx) => ctx.db.query("suggestions").collect()))[0];
  await t.action(internal.suggestionGeneration.generate, {
    cacheId: row._id,
    requestId: row.requestId,
    context: JSON.stringify({ project: "Shop", chats: [], sources: [] }),
  });
  expect(observedError).toBeUndefined();
  expect(
    await t.query(api.suggestions.get, { token, projectId, model }),
  ).toMatchObject({
    state: "ready",
    prompts: prompts.map(({ text }) => ({ text })),
  });
  expect(bodies).toHaveLength(1);
  expect(bodies[0].tools?.length ?? 0).toBe(0);
  expect(
    await t.query(api.projects.conversations, { token, projectId }),
  ).toEqual(before);
});
