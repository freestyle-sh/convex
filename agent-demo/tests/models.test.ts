import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import schema from "../convex/schema";
import { api, components, internal } from "../convex/_generated/api";
import { runtimeSettings } from "../convex/lib/runtimeSettings";
import { openCredential } from "../convex/lib/credentials";
import {
  defaultModel,
  workspaceModel,
  validateModel,
  routedModelPresets,
  sortCatalog,
} from "../convex/lib/models";
import { executeGrant } from "../convex/lib/sandbox";
import { executeNotebook } from "../convex/notebookRuntime";
import { getServiceToken } from "convex/server";
import { gatewayMessages } from "../convex/lib/gateway";
import { openRouterProviders } from "../src/messageProviders";
import type { ActionCtx } from "../convex/_generated/server";
vi.mock("convex/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/server")>()),
  getServiceToken: vi.fn(async () => "synthetic-gateway-deployment-token"),
}));
vi.mock("../convex/lib/sandbox", () => ({
  executeGrant: vi.fn(async () => ({ healthy: true })),
}));
vi.mock("../convex/notebookRuntime", () => ({
  executeNotebook: vi.fn(async () => ({
    status: "ok",
    executionCount: 1,
    stdout: "healthy: true; 4; VERIFIED_CELL_RECEIPT_42\n",
    networkResults: [{ kind: "query", state: "complete", successful: true }],
    stderr: "",
    text: "",
    charts: [
      {
        data: [{ type: "bar", x: ["A"], y: [4] }],
        layout: { title: { text: "Observed result" } },
      },
    ],
    chartWarnings: [],
    kernelReset: false,
    sessionReused: false,
    durationMs: 10,
    timeoutMs: 5000,
    outputTruncated: false,
  })),
}));
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
const routerKey = "sk-or-test-private-router-key";
function streamedReply(
  model: string,
  calls?: {
    code?: string;
    requests?: unknown[];
    reason?: string;
    timeoutMs?: number;
    updateArtifact?: boolean;
  }[],
  text = "Finished using the collected evidence.",
) {
  const chunks = [
    {
      id: "reliability-test",
      object: "chat.completion.chunk",
      created: 1,
      model,
      provider: "Synthetic provider",
      choices: [
        {
          index: 0,
          delta: calls
            ? {
                role: "assistant",
                tool_calls: calls.map((call, index) => ({
                  index,
                  id: `call_${index}`,
                  type: "function",
                  function: {
                    name: "notebook",
                    arguments: JSON.stringify({
                      timeoutMs: 5000,
                      requests: [],
                      reason: "Investigate",
                      ...call,
                    }),
                  },
                })),
              }
            : {
                role: "assistant",
                content: text,
              },
          finish_reason: null,
        },
      ],
    },
    {
      id: "reliability-test",
      object: "chat.completion.chunk",
      created: 1,
      model,
      choices: [
        { index: 0, delta: {}, finish_reason: calls ? "tool_calls" : "stop" },
      ],
    },
  ];
  return new Response(
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  const workspaceId = await t.mutation(api.workspaces.open, { token });
  const projectId = await t.mutation(api.projects.save, {
    token,
    name: "Model routing test",
    deploymentUrl: "https://test-123.convex.cloud",
    keyPrefix: "TARGET_TEST",
    permissions: {
      readLogs: false,
      runQueries: true,
      analyze: true,
      proposeChanges: false,
    },
    allowedQueries: ["health:read"],
    allowedMutations: [],
    intervalMinutes: 15,
    enabled: true,
  });
  return { t, workspaceId, projectId };
}
beforeEach(() => {
  vi.mocked(getServiceToken)
    .mockReset()
    .mockResolvedValue("synthetic-gateway-deployment-token");
  vi.useFakeTimers();
  vi.stubEnv("CONNECTION_ENCRYPTION_KEY", "ef".repeat(32));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("model providers and per-message selection", () => {
  it("updates the open chart from a successful notebook result even if the model sends the obsolete false flag", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return streamedReply(
          body.model,
          bodies.length % 2 === 1
            ? [{ code: "fig.show()", updateArtifact: false }]
            : undefined,
        );
      }),
    );
    const originalRun = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Chart my orders",
    }))!;
    await t.action(internal.investigate.run, { runId: originalRun });
    const [original] = await t.query(api.artifacts.recent, {
      token,
      projectId,
    });
    const source = {
      token,
      projectId,
      threadId: original.threadId,
      sourceId: original.item.sourceId,
    };
    const originalResult =
      await vi.mocked(executeNotebook).mock.results[0].value;
    const paidChart = {
      data: [{ type: "bar", x: ["paid"], y: [3] }],
      layout: { title: { text: "Paid orders" } },
    };
    vi.mocked(executeNotebook).mockResolvedValueOnce({
      ...originalResult,
      charts: [paidChart],
    });
    const editRun = (await t.mutation(api.artifacts.ask, {
      ...source,
      prompt: "show only paid orders",
    }))!;
    const before = (await t.query(api.artifacts.history, source))!;
    await t.action(internal.investigate.run, { runId: editRun });
    const after = (await t.query(api.artifacts.history, source))!;
    expect((await t.run((ctx) => ctx.db.get(editRun)))?.state).toBe("complete");
    expect(after.currentVersionId).not.toBe(before.currentVersionId);
    expect(after.versions.map((version) => version.number)).toEqual([2, 1]);
    expect(after.artifact?.item).toMatchObject({
      kind: "chart",
      figure: paidChart,
    });
    const receipt = bodies[3].messages
      .filter((message: any) => message.role === "tool")
      .at(-1);
    expect(JSON.parse(receipt.content).artifactUpdate).toMatchObject({
      state: "saved",
      displayed: true,
    });
    for (const body of bodies) {
      const notebook = body.tools?.find(
        (tool: any) => tool.function.name === "notebook",
      );
      if (notebook)
        expect(notebook.function.parameters.properties).not.toHaveProperty(
          "updateArtifact",
        );
    }
  });

  it.each(["openrouter", "convex"] as const)(
    "%s supplies safe defaults for omitted notebook settings",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        openrouterKey: routerKey,
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          bodies.push(body);
          if (provider === "openrouter")
            expect(body.provider).toEqual({ ignore: ["open-inference"] });
          return streamedReply(
            body.model,
            bodies.length === 1
              ? [
                  {
                    code: "print(42)",
                    requests: undefined,
                    reason: undefined,
                    timeoutMs: undefined,
                  },
                ]
              : undefined,
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Calculate 42",
      }))!;
      await t.action(internal.investigate.run, { runId });
      expect(executeNotebook).toHaveBeenCalledOnce();
      expect(vi.mocked(executeNotebook).mock.calls[0][2]).toMatchObject({
        code: "print(42)",
        timeoutMs: 30000,
        requests: [],
      });
      expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe("complete");
    },
  );

  it.each(["invalid arguments", "Python errors"])(
    "recovers from two consecutive %s and creates a chart in the next cell",
    async (failure) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        openrouterKey: routerKey,
        modelProvider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      if (failure === "Python errors") {
        vi.mocked(executeNotebook)
          .mockResolvedValueOnce({
            status: "error",
            stderr: "NameError: unknown",
          } as any)
          .mockResolvedValueOnce({
            status: "error",
            stderr: "SyntaxError: invalid syntax",
          } as any);
      }
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          bodies.push(body);
          return streamedReply(
            body.model,
            bodies.length <= 2
              ? [
                  {
                    code: failure === "Python errors" ? "unknown()" : undefined,
                  },
                ]
              : bodies.length === 3 && body.tools?.length
                ? [{ code: "px.bar(x=['A'], y=[4]).show()" }]
                : undefined,
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Investigate",
      }))!;
      await t.action(internal.investigate.run, { runId });
      expect(bodies).toHaveLength(4);
      expect(bodies[2].tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({ name: "notebook" }),
          }),
        ]),
      );
      expect(executeNotebook).toHaveBeenCalledTimes(
        failure === "Python errors" ? 3 : 1,
      );
      expect(vi.mocked(executeNotebook).mock.lastCall?.[2]).toMatchObject({
        code: "px.bar(x=['A'], y=[4]).show()",
        requests: [],
      });
      expect((await t.run((ctx) => ctx.db.get(runId)))?.summary).toBe(
        "Finished using the collected evidence.",
      );
      expect(await t.query(api.artifacts.recent, { token, projectId })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            item: expect.objectContaining({ kind: "chart" }),
          }),
        ]),
      );
    },
  );

  it("deletes during a notebook call without waiting or restoring late results", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    let cellStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      cellStarted = resolve;
    });
    let finishCell!: () => void;
    const pendingCell = new Promise<void>((resolve) => {
      finishCell = resolve;
    });
    vi.mocked(executeNotebook).mockImplementationOnce(async () => {
      cellStarted();
      await pendingCell;
      return {
        status: "ok",
        stdout: "Late result",
        charts: [],
        tables: [],
        chartWarnings: [],
        stderr: "",
        text: "",
      } as any;
    });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return streamedReply(
          body.model,
          bodies.length === 1 ? [{ code: "print('Late result')" }] : undefined,
        );
      }),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Run a notebook cell",
    }))!;
    const run = (await t.run((ctx) => ctx.db.get(runId)))!;
    const running = t.action(internal.investigate.run, { runId });
    await started;
    const queuedId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId: run.threadId,
      prompt: "Queued follow-up",
    }))!;
    try {
      expect(
        await t.mutation(api.projects.deleteChat, {
          token,
          projectId,
          threadId: run.threadId!,
        }),
      ).toEqual({ deleted: true });
      expect(
        await t.query(api.projects.chat, {
          token,
          threadId: run.threadId!,
        }),
      ).toBeNull();
    } finally {
      finishCell();
      await running;
    }
    await t.action(internal.investigate.run, { runId: queuedId });
    expect(executeNotebook).toHaveBeenCalledOnce();
    expect(bodies).toHaveLength(1);
    expect(
      await t.query(components.agent.threads.getThread, {
        threadId: run.threadId!,
      }),
    ).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(runId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(queuedId))).toBeNull();
    expect(await t.query(api.artifacts.recent, { token, projectId })).toEqual(
      [],
    );
  });

  it("makes an empty final response visible as a failure without replaying tools", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) =>
        streamedReply(
          JSON.parse(init.body).model,
          ++requests === 1 ? [{ code: "print(42)" }] : undefined,
          "",
        ),
      ),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Read once",
    }))!;
    await t.action(internal.investigate.run, { runId });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.state).toBe("failed");
    expect(run?.error).toContain("finished without an answer");
    expect(executeNotebook).toHaveBeenCalledOnce();
    expect(requests).toBe(2);
  });

  it.each(["headers", "stream"])(
    "ends a silent provider wait at %s",
    async (phase) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        openrouterKey: routerKey,
        modelProvider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const signal = init.signal as AbortSignal;
          if (phase === "headers")
            return new Promise<Response>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
              entered();
            });
          return new Response(
            new ReadableStream({
              start(controller) {
                signal.addEventListener(
                  "abort",
                  () => controller.error(signal.reason),
                  { once: true },
                );
                entered();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Say hello",
      }))!;
      const running = t.action(internal.investigate.run, { runId });
      await started;
      await t.action(async () => {
        await vi.advanceTimersByTimeAsync(60_001);
      });
      await running;
      await t.finishInProgressScheduledFunctions();
      const run = await t.run((ctx) => ctx.db.get(runId));
      expect(run?.state).toBe("failed");
      expect(run?.error).toContain("stopped responding for a minute");
      expect(executeNotebook).not.toHaveBeenCalled();
    },
  );

  it("does not apply the model wait timeout to a running notebook", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(executeNotebook).mockImplementationOnce(async () => {
      entered();
      await finished;
      return { status: "ok", stdout: "42" } as any;
    });
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) =>
        streamedReply(
          JSON.parse(init.body).model,
          ++requests === 1 ? [{ code: "print(42)" }] : undefined,
        ),
      ),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Read once",
    }))!;
    const running = t.action(internal.investigate.run, { runId });
    await started;
    await t.action(async () => {
      await vi.advanceTimersByTimeAsync(75_000);
    });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe("running");
    release();
    await running;
    await t.finishInProgressScheduledFunctions();
    expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe("complete");
  });

  it("marks a failed follow-up stream as failed without replaying the successful cell", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        requests++;
        return requests === 1
          ? streamedReply(JSON.parse(init.body).model, [{ code: "print(42)" }])
          : Response.json(
              { error: { message: "private-provider-diagnostic", code: 400 } },
              { status: 400 },
            );
      }),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Read once",
    }))!;
    await t.action(internal.investigate.run, { runId });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.state).toBe("failed");
    expect(run?.error).toBe(
      "Investigation failed. Check Agent services, project access, and provider availability.",
    );
    expect(run?.summary).toBeUndefined();
    expect(executeNotebook).toHaveBeenCalledOnce();
    expect(requests).toBe(2);
  });

  it.each(["openrouter", "convex"] as const)(
    "%s executes a burst of 21 duplicate cells once without budget errors",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        openrouterKey: routerKey,
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          bodies.push(body);
          expect(body.parallel_tool_calls).toBe(false);
          return streamedReply(
            body.model,
            bodies.length === 1
              ? Array.from({ length: 21 }, (_, i) => ({
                  code: "print(customers)",
                  reason: `Reason ${i}`,
                  requests: [
                    {
                      kind: "query",
                      functionPath: "health:read",
                      argsJson: i % 2 ? "{}" : {},
                    },
                  ],
                }))
              : undefined,
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Who are my customers?",
      }))!;
      await t.action(internal.investigate.run, { runId });
      expect(executeNotebook).toHaveBeenCalledOnce();
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.reasoning).toEqual({ effort: "low" });
      }
      const toolMessages = bodies[1].messages.filter(
        (m: any) => m.role === "tool",
      );
      expect(toolMessages).toHaveLength(21);
      expect(
        toolMessages.filter(
          (m: any) => JSON.parse(m.content).status === "duplicate",
        ),
      ).toHaveLength(20);
      expect(
        toolMessages.filter((m: any) => JSON.parse(m.content).status === "ok"),
      ).toHaveLength(1);
      expect(JSON.stringify(toolMessages)).not.toContain("budget exhausted");
      expect((await t.run((ctx) => ctx.db.get(runId)))?.summary).toBe(
        "Finished using the collected evidence.",
      );
    },
  );

  it("deduplicates write proposals without executing or granting access", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) =>
        streamedReply(
          JSON.parse(init.body).model,
          Array.from({ length: 21 }, () => ({
            code: "print('change')",
            requests: [
              {
                kind: "mutation",
                functionPath: "health:repair",
                argsJson: "{}",
              },
            ],
          })),
        ),
      ),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Propose a repair",
    }))!;
    await t.action(internal.investigate.run, { runId });
    const proposals = await t.run((ctx) => ctx.db.query("proposals").collect());
    expect(proposals).toHaveLength(1);
    expect(proposals[0].state).toBe("pending");
    expect(executeNotebook).not.toHaveBeenCalled();
  });

  it("summarizes at the tool limit instead of generating a loop of budget errors", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return streamedReply(
          body.model,
          bodies.length === 1
            ? Array.from({ length: 10 }, (_, i) => ({ code: `print(${i})` }))
            : undefined,
        );
      }),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Investigate",
    }))!;
    await t.action(internal.investigate.run, { runId });
    expect(executeNotebook).toHaveBeenCalledTimes(8);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].tools ?? []).toHaveLength(0);
    expect(JSON.stringify(bodies[1].messages)).not.toContain(
      "budget exhausted",
    );
    expect((await t.run((ctx) => ctx.db.get(runId)))?.summary).toBe(
      "Finished using the collected evidence.",
    );
  });

  it("allows a fresh read in later steps and reserves the last step for an answer", async () => {
    const { t, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      snapshot: "freestyle/ubuntu",
    });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return streamedReply(
          body.model,
          body.tools?.length ? [{ code: "print('fresh read')" }] : undefined,
        );
      }),
    );
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Investigate",
    }))!;
    await t.action(internal.investigate.run, { runId });
    expect(executeNotebook).toHaveBeenCalledTimes(7);
    expect(bodies).toHaveLength(8);
    expect(bodies[7].tools ?? []).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(runId)))?.summary).toBe(
      "Finished using the collected evidence.",
    );
  });
  it.each(
    (["openrouter", "convex"] as const).flatMap((provider) =>
      [false, true].map((firstFails) => ({ provider, firstFails })),
    ),
  )(
    "serializes parallel $provider notebook calls (firstFails=$firstFails)",
    async ({ provider, firstFails }) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      let entered!: () => void;
      let release!: () => void;
      const toolEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const toolReleased = new Promise<void>((resolve) => {
        release = resolve;
      });
      const order: string[] = [];
      vi.mocked(executeNotebook)
        .mockImplementationOnce(async () => {
          order.push("first started");
          entered();
          await toolReleased;
          order.push("first finished");
          if (firstFails) throw new Error("Synthetic cell failure");
          return { status: "ok", stdout: "first result" } as any;
        })
        .mockImplementationOnce(async () => {
          order.push("second started");
          return { status: "ok", stdout: "second result" } as any;
        });
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          bodies.push(body);
          const first = bodies.length === 1;
          const delta = first
            ? {
                role: "assistant",
                tool_calls: [0, 1].map((index) => ({
                  index,
                  id: `call_${index}`,
                  type: "function",
                  function: {
                    name: "notebook",
                    arguments: JSON.stringify({
                      code: `print(${index})`,
                      timeoutMs: 5000,
                      reason: "Offline analysis",
                      requests: [],
                    }),
                  },
                })),
              }
            : { role: "assistant", content: "Completed queued cells." };
          const chunks = [
            {
              id: "parallel-test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason: null }],
            },
            {
              id: "parallel-test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: first ? "tool_calls" : "stop",
                },
              ],
            },
          ];
          return new Response(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Run two offline cells.",
      }))!;
      const running = t.action(internal.investigate.run, { runId });
      await toolEntered;
      // Let the second provider tool call reach execute while the first is blocked.
      await vi.advanceTimersByTimeAsync(10);
      const orderWhileBlocked = [...order];
      release();
      await running;
      expect(orderWhileBlocked).toEqual(["first started"]);
      expect(order).toEqual([
        "first started",
        "first finished",
        "second started",
      ]);
      expect(executeNotebook).toHaveBeenCalledTimes(2);
      const run = await t.run((ctx) => ctx.db.get(runId));
      expect(run?.state).toBe("complete");
      expect(run?.error).toBeUndefined();
      expect(bodies).toHaveLength(2);
      const toolResults = bodies[1].messages.filter(
        (m: any) => m.role === "tool",
      );
      expect(toolResults).toHaveLength(2);
      expect(JSON.stringify(toolResults)).toContain("second result");
      expect(JSON.stringify(toolResults)).toContain(
        firstFails ? "Synthetic cell failure" : "first result",
      );
    },
  );

  it.each(["openrouter", "convex"] as const)(
    "picks up a follow-up after the current tool step through %s without rerunning the tool",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      let entered!: () => void;
      let release!: () => void;
      const toolEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const toolReleased = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(executeNotebook).mockImplementationOnce(async () => {
        entered();
        await toolReleased;
        return { status: "ok", stdout: "original-query-result" } as any;
      });
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          bodies.push(body);
          const first = bodies.length === 1;
          const delta = first
            ? {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_before_followup",
                    type: "function",
                    function: {
                      name: "notebook",
                      arguments: JSON.stringify({
                        code: "print(healthy)",
                        timeoutMs: 5000,
                        reason: "Read health",
                        requests: [
                          {
                            kind: "query",
                            functionPath: "health:read",
                            argsJson: "{}",
                          },
                        ],
                      }),
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content:
                  "Following the updated request using the completed query.",
              };
          return new Response(
            [
              {
                id: "steering-test",
                object: "chat.completion.chunk",
                created: 1,
                model: body.model,
                choices: [{ index: 0, delta, finish_reason: null }],
              },
              {
                id: "steering-test",
                object: "chat.completion.chunk",
                created: 1,
                model: body.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: first ? "tool_calls" : "stop",
                  },
                ],
              },
            ]
              .map((c) => `data: ${JSON.stringify(c)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const first = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Run the health query and investigate.",
      }))!;
      const running = t.action(internal.investigate.run, { runId: first });
      await toolEntered;
      const followup = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt:
          "Actually summarize the completed result in one sentence; do not query again.",
        modelChoice: { provider, id: "test/followup-model" },
      }))!;
      expect(
        await t.mutation(internal.projects.claimRun, { runId: followup }),
      ).toBeNull();
      release();
      await running;
      expect(bodies).toHaveLength(1);
      expect((await t.run((ctx) => ctx.db.get(first)))?.state).toBe("complete");
      await t.action(internal.investigate.run, { runId: followup });
      expect(bodies).toHaveLength(2);
      expect(bodies[1].model).toBe("test/followup-model");
      expect(JSON.stringify(bodies[1].messages)).toContain(
        "Actually summarize",
      );
      expect(JSON.stringify(bodies[1].messages)).toContain(
        "original-query-result",
      );
      expect(executeNotebook).toHaveBeenCalledOnce();
      expect((await t.run((ctx) => ctx.db.get(followup)))?.summary).toBe(
        "Following the updated request using the completed query.",
      );
    },
  );
  it("keeps OpenRouter credentials encrypted, isolated from Gateway, and removable", async () => {
    const { t, workspaceId, projectId } = await setup();
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "openrouter",
      model: "openai/gpt-5.4",
      snapshot: "freestyle/ubuntu",
    });
    const row = (await t.run((ctx) => ctx.db.get(workspaceId)))!;
    expect(JSON.stringify(row)).not.toContain(routerKey);
    expect(
      openCredential(row.openrouterKey!, `${workspaceId}:openrouter`),
    ).toBe(routerKey);
    expect(() =>
      openCredential(row.openrouterKey!, `${workspaceId}:model`),
    ).toThrow();
    const publicSettings = await t.query(api.workspaces.settings, { token });
    expect(publicSettings).toMatchObject({
      hasOpenRouterKey: true,
      modelProvider: "openrouter",
    });
    expect(JSON.stringify(publicSettings)).not.toContain(routerKey);
    const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
    const ctx = { runQuery: t.query.bind(t) } as unknown as ActionCtx;
    expect((await runtimeSettings(ctx, project)).modelKey).toBe(routerKey);
    expect(
      (
        await runtimeSettings(ctx, project, {
          provider: "convex",
          id: defaultModel.id,
        })
      ).modelKey,
    ).toBeUndefined();
    await t.action(api.settings.save, {
      token,
      openrouterKey: null,
      model: "openai/gpt-5.4",
      snapshot: "freestyle/ubuntu",
    });
    vi.stubEnv("OPENROUTER_API_KEY", "do-not-fall-back-to-platform-key");
    expect((await runtimeSettings(ctx, project)).modelKey).toBeUndefined();
    expect(
      (await t.query(api.workspaces.settings, { token })).hasOpenRouterKey,
    ).toBe(false);
    await expect(
      t.action(api.settings.save, {
        token: "b".repeat(64),
        openrouterKey: routerKey,
        model: "openai/gpt-5.4",
        modelProvider: "openrouter",
        snapshot: "freestyle/ubuntu",
      }),
    ).rejects.toThrow("Workspace unavailable");
  });
  it("defaults new and untouched workspaces to Gateway while preserving configured choices", async () => {
    const { t, workspaceId, projectId } = await setup();
    expect(await t.query(api.workspaces.settings, { token })).toMatchObject({
      modelProvider: "convex",
      model: defaultModel.id,
    });
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Check",
    }))!;
    expect((await t.run((ctx) => ctx.db.get(runId)))?.modelChoice).toEqual(
      defaultModel,
    );
    expect(workspaceModel({ model: "claude-sonnet-4-5" })).toEqual(
      defaultModel,
    );
    expect(workspaceModel({ model: "claude-custom" })).toEqual(defaultModel);
    expect(
      workspaceModel({
        modelProvider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    ).toEqual(defaultModel);
    expect(
      workspaceModel({ modelProvider: "openrouter", model: "openai/gpt-5.4" }),
    ).toEqual({ provider: "openrouter", id: "openai/gpt-5.4" });
    await t.run((ctx) =>
      ctx.db.patch(workspaceId, {
        modelKey: "not-decryptable",
        openrouterKey: "not-decryptable",
      }),
    );
    const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
    const ctx = { runQuery: t.query.bind(t) } as unknown as ActionCtx;
    expect((await runtimeSettings(ctx, project)).modelKey).toBeUndefined();
  });
  it("rejects removed direct-provider inputs and fails historical queued runs without re-routing", async () => {
    const { t, projectId, workspaceId } = await setup();
    await expect(
      t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "test",
        modelChoice: { provider: "anthropic", id: "claude-old" },
      } as any),
    ).rejects.toThrow();
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "historical run",
    }))!;
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        modelChoice: { provider: "anthropic", id: "claude-old" },
      });
      await ctx.db.patch(workspaceId, {
        modelKey: "unused-legacy-encrypted-key",
      });
    });
    await t.action(internal.investigate.run, { runId });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.error).toContain(
      "Direct Anthropic support was removed",
    );
    expect(getServiceToken).not.toHaveBeenCalled();
    expect(executeGrant).not.toHaveBeenCalled();
    await t.action(api.settings.save, {
      token,
      modelProvider: "convex",
      model: defaultModel.id,
      snapshot: "freestyle/ubuntu",
    });
    expect(
      (await t.run((ctx) => ctx.db.get(workspaceId)))?.modelKey,
    ).toBeUndefined();
  });
  it("checks provider setup before sending, reads newly saved keys, and creates no run", async () => {
    const { t } = await setup();
    await expect(
      t.action(api.models.access, {
        token: "b".repeat(64),
        provider: "convex",
      }),
    ).rejects.toThrow("Workspace unavailable");
    expect(getServiceToken).not.toHaveBeenCalled();
    expect(
      await t.action(api.models.access, { token, provider: "openrouter" }),
    ).toEqual({
      ready: false,
      message: "Add your OpenRouter API key to send this message.",
    });
    vi.mocked(getServiceToken).mockRejectedValueOnce(
      new Error("AiGatewayUnavailable"),
    );
    expect(
      await t.action(api.models.access, { token, provider: "convex" }),
    ).toEqual({ ready: false, message: gatewayMessages.unavailable });
    expect(
      await t.action(api.models.access, { token, provider: "convex" }),
    ).toEqual({
      ready: false,
      message: "Add your Freestyle API key to send this message.",
    });
    await t.action(api.settings.save, {
      token,
      freestyleKey: "private-freestyle-key",
      openrouterKey: routerKey,
      modelProvider: "convex",
      model: defaultModel.id,
      snapshot: "freestyle/ubuntu",
    });
    expect(
      (await t.action(api.models.access, { token, provider: "convex" })).ready,
    ).toBe(true);
    expect(
      (await t.action(api.models.access, { token, provider: "openrouter" }))
        .ready,
    ).toBe(true);
    await t.action(api.settings.save, {
      token,
      openrouterKey: null,
      model: defaultModel.id,
      snapshot: "freestyle/ubuntu",
    });
    expect(
      (await t.action(api.models.access, { token, provider: "openrouter" }))
        .ready,
    ).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toEqual([]);
    expect(executeGrant).not.toHaveBeenCalled();
  });
  it("authorizes before minting Gateway tokens and never returns or stores them", async () => {
    const { t, workspaceId } = await setup();
    await expect(
      t.action(api.models.gatewayAccess, { token: "b".repeat(64) }),
    ).rejects.toThrow("Workspace unavailable");
    await expect(
      t.action(api.models.catalog, {
        token: "b".repeat(64),
        provider: "convex",
      }),
    ).rejects.toThrow("Workspace unavailable");
    expect(getServiceToken).not.toHaveBeenCalled();
    const access = await t.action(api.models.gatewayAccess, { token });
    expect(access.state).toBe("available");
    const before = await t.run((ctx) => ctx.db.get(workspaceId));
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://ai-gateway.convex.dev/v1/models");
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer synthetic-gateway-deployment-token",
      );
      return Response.json({
        data: [
          { id: "z-ai/glm-5.3-flash" },
          { id: "z-ai/glm-5.3-flash:batch" },
          { id: "test/image" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const models = await t.action(api.models.catalog, {
      token,
      provider: "convex",
    });
    expect(models).toEqual([
      { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    ]);
    expect(await t.run((ctx) => ctx.db.get(workspaceId))).toEqual(before);
    expect(JSON.stringify({ access, models, before })).not.toContain(
      "synthetic-gateway-deployment-token",
    );
    fetch.mockRejectedValueOnce(
      new Error("synthetic-gateway-deployment-token"),
    );
    await expect(
      t.action(api.models.catalog, { token, provider: "convex" }),
    ).rejects.toThrow("Could not load Convex Gateway models");
  });
  it.each([
    ["AiGatewayUnavailable", "unavailable"],
    [
      '`getServiceToken("ai-gateway")` requires an authenticated local deployment.',
      "unavailable",
    ],
    ["AiGatewayDisabled", "disabled"],
    ["private-internal-diagnostic", "error"],
  ] as const)(
    "reports %s without leaking diagnostics or running tools",
    async (code, state) => {
      const { t, projectId } = await setup();
      vi.mocked(getServiceToken).mockRejectedValue(new Error(code));
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(await t.action(api.models.gatewayAccess, { token })).toEqual({
        state,
        message: gatewayMessages[state],
      });
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Check",
      }))!;
      await t.action(internal.investigate.run, { runId });
      expect((await t.run((ctx) => ctx.db.get(runId)))?.error).toBe(
        gatewayMessages[state],
      );
      expect(executeGrant).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("prioritizes current low-cost picks and sorts the remaining catalog newest first", () => {
    const suggestions = sortCatalog([
      { id: "test/old", name: "A old", created: 1 },
      { id: "anthropic/claude-opus-5.5", name: "Premium", created: 30 },
      { id: "test/new", name: "Z new", created: 100 },
      { id: "openai/gpt-6-luna", name: "Luna", created: 20 },
      { id: "z-ai/glm-5.3-flash", name: "GLM", created: 10 },
    ]);
    expect(suggestions.map((m) => m.id)).toEqual([
      "z-ai/glm-5.3-flash",
      "openai/gpt-6-luna",
      "anthropic/claude-opus-5.5",
      "test/new",
      "test/old",
    ]);
    expect(defaultModel.id).toBe(suggestions[0].id);
    expect(
      routedModelPresets.some((m) =>
        [
          "openai/gpt-5.4",
          "anthropic/claude-sonnet-4.5",
          "google/gemini-2.5-flash",
        ].includes(m.id),
      ),
    ).toBe(false);
  });
  it("pins each run's selection and remembers it for follow-ups, despite default changes", async () => {
    const { t, projectId } = await setup();
    const choice = { provider: "openrouter" as const, id: "openai/gpt-5.4" };
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Check health",
      modelChoice: choice,
    }))!;
    await t.action(api.settings.save, {
      token,
      modelProvider: "convex",
      model: "anthropic/claude-opus-4.6",
      snapshot: "freestyle/ubuntu",
    });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.modelChoice).toEqual(
      choice,
    );
    expect(
      (await t.query(api.projects.conversations, { token, projectId }))[0]
        .modelChoice,
    ).toEqual(choice);
    await t.mutation(internal.projects.finishRun, { runId, summary: "Done" });
    const followup = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "And now?",
    }))!;
    expect((await t.run((ctx) => ctx.db.get(followup)))?.modelChoice).toEqual(
      choice,
    );
    await t.mutation(internal.projects.finishRun, {
      runId: followup,
      summary: "Done",
    });
    const threadId = await t.mutation(api.projects.newChat, {
      token,
      projectId,
    });
    const fresh = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      threadId,
      prompt: "New chat",
    }))!;
    expect((await t.run((ctx) => ctx.db.get(fresh)))?.modelChoice).toEqual({
      provider: "convex",
      id: "anthropic/claude-opus-4.6",
    });
    await t.mutation(internal.projects.finishRun, {
      runId: fresh,
      summary: "Done",
    });
    await expect(
      t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "bad model",
        modelChoice: { provider: "openrouter", id: "https://example.com" },
      }),
    ).rejects.toThrow("OpenRouter model ID");
  });
  it("loads only text models advertising tool support and sanitizes catalog failures", async () => {
    const { t } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "test/tools:batch",
              name: "Batch only",
              supported_parameters: ["tools"],
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "test/tools",
              name: "Tool model",
              created: 1790000000,
              supported_parameters: ["tools"],
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "test/no-tools",
              name: "No tools",
              supported_parameters: [],
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "test/image",
              name: "Image",
              supported_parameters: ["tools"],
              architecture: { output_modalities: ["image"] },
            },
          ],
        }),
      ),
    );
    expect(await t.action(api.models.catalog, { token })).toEqual([
      { id: "test/tools", name: "Tool model", created: 1790000000 },
    ]);
    expect(
      validateModel({
        provider: "openrouter",
        id: "~google/gemini-flash-latest",
      }).id,
    ).toBe("~google/gemini-flash-latest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(routerKey);
      }),
    );
    await expect(t.action(api.models.catalog, { token })).rejects.toThrow(
      "Could not load OpenRouter models",
    );
  });
  it("reports a missing OpenRouter key without calling a provider or sandbox", async () => {
    const { t, projectId } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runId = (await t.mutation(api.projects.ask, {
      token,
      projectId,
      prompt: "Check health",
      modelChoice: { provider: "openrouter", id: "openai/gpt-5.4" },
    }))!;
    await t.action(internal.investigate.run, { runId });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.error).toBe(
      "Add your OpenRouter API key in Settings → Agent services.",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(executeGrant).not.toHaveBeenCalled();
  });
  it.each(["openrouter", "convex"] as const)(
    "asks for write approval and continues from an approved result through %s Agent",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.run(async (ctx) => {
        const p = (await ctx.db.get(projectId))!;
        await ctx.db.patch(projectId, {
          permissions: { ...p.permissions, runQueries: false },
          allowedQueries: [],
        });
      });
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          bodies.push(body);
          const delta =
            bodies.length === 1
              ? {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_query",
                      type: "function",
                      function: {
                        name: "notebook",
                        arguments: JSON.stringify({
                          code: "print(healthy)",
                          timeoutMs: 5000,
                          reason: "Repair health",
                          requests: [
                            {
                              kind: "mutation",
                              functionPath: "health:repair",
                              argsJson: "{}",
                            },
                          ],
                        }),
                      },
                    },
                  ],
                }
              : {
                  role: "assistant",
                  content: "The approved mutation reports healthy.",
                };
          const chunks = [
            {
              id: "test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason: null }],
            },
            {
              id: "test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: bodies.length === 1 ? "tool_calls" : "stop",
                },
              ],
            },
          ];
          return new Response(
            chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
              "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Repair the health record",
      }))!;
      await t.action(internal.investigate.run, { runId });
      expect(executeGrant).not.toHaveBeenCalled();
      expect(bodies).toHaveLength(1);
      const proposals = await t.run((ctx) =>
        ctx.db.query("proposals").collect(),
      );
      expect(proposals).toHaveLength(1);
      expect(proposals[0]).toMatchObject({
        oneTime: true,
        kind: "mutation",
        state: "pending",
        functionPath: "health:repair",
      });
      await t.mutation(api.approvals.decide, {
        token,
        proposalId: proposals[0]._id,
        approve: true,
      });
      const project = (await t.run((ctx) => ctx.db.get(projectId)))!;
      expect(project.permissions.runQueries).toBe(false);
      const continuationRun = (
        await t.run((ctx) => ctx.db.query("runs").collect())
      ).find((r) => r.approvalId === proposals[0]._id)!;
      await t.action(internal.investigate.run, { runId: continuationRun._id });
      expect(bodies).toHaveLength(2);
      expect(JSON.stringify(bodies[1].messages)).toContain(
        "VERIFIED_CELL_RECEIPT_42",
      );
      expect(bodies[1].tool_choice).toBe("auto");
      expect(executeNotebook).toHaveBeenCalledOnce();
      const finished = (await t.run((ctx) => ctx.db.get(continuationRun._id)))!;
      expect(finished.summary).toBe("The approved mutation reports healthy.");
      expect(finished.error).toBeUndefined();
    },
  );
  it.each(["openrouter", "convex"] as const)(
    "collects empty logs and persists visible notebook cells and Plotly charts through %s",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.run(async (ctx) => {
        const project = (await ctx.db.get(projectId))!;
        await ctx.db.patch(projectId, {
          permissions: {
            ...project.permissions,
            readLogs: true,
            analyze: true,
          },
        });
      });
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      vi.mocked(executeNotebook).mockResolvedValueOnce({
        status: "ok",
        stdout: "Log access succeeded: 0 events",
        networkResults: [{ kind: "logs", state: "complete", successful: true }],
      } as any);
      const bodies: any[] = [];
      const execInput = {
        code: "print(2+2)",
        timeoutMs: 5000,
        requests: [],
        reason: "Analyze",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          bodies.push(body);
          const name = "notebook";
          const delta =
            bodies.length <= 2
              ? {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${name}_${bodies.length}`,
                      type: "function",
                      function: {
                        name,
                        arguments: JSON.stringify(
                          bodies.length === 1
                            ? {
                                ...execInput,
                                requests: [
                                  {
                                    kind: "logs",
                                    functionPath: "",
                                    argsJson: '{"cursor":0}',
                                  },
                                ],
                              }
                            : execInput,
                        ),
                      },
                    },
                  ],
                }
              : {
                  role: "assistant",
                  content:
                    "Log access succeeded with zero events. The sandbox command returned 4.",
                };
          const chunks = [
            {
              id: "test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [{ index: 0, delta, finish_reason: null }],
            },
            {
              id: "test",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: bodies.length <= 2 ? "tool_calls" : "stop",
                },
              ],
            },
          ];
          return new Response(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "How is my project doing?",
      }))!;
      await t.action(internal.investigate.run, { runId });
      const run = (await t.run((ctx) => ctx.db.get(runId)))!;
      expect(run.error).toBeUndefined();
      expect(run.state).toBe("complete");
      expect(bodies).toHaveLength(3);
      expect(bodies[0].tool_choice).toBe("auto");
      expect(bodies[0].tools.map((tool: any) => tool.function.name)).toEqual([
        "notebook",
        "recordFinding",
      ]);
      expect(bodies[1].tool_choice).toBe("auto");
      expect(bodies[1].tools.map((tool: any) => tool.function.name)).toContain(
        "notebook",
      );
      expect(
        bodies[1].messages.some(
          (m: any) =>
            m.role === "tool" &&
            m.content.includes("Log access succeeded: 0 events"),
        ),
      ).toBe(true);
      expect(executeNotebook).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ _id: projectId }),
        execInput,
        { events: [], results: [] },
        runId,
        { requests: [] },
      );
      const messages = await t.query(api.projects.messages, {
        token,
        projectId,
        threadId: run.threadId!,
        paginationOpts: { numItems: 50, cursor: null },
        streamArgs: { kind: "list", startOrder: 0 },
      });
      const serialized = JSON.stringify(messages.page);
      expect(serialized).not.toContain('"name":"readLogs"');
      expect(serialized).toContain("notebook");
      expect(serialized).toContain("output-available");
      expect(serialized).toContain("executionCount");
      expect(serialized).toContain('"y":[4]');
      expect(serialized).not.toContain("private-freestyle-key");
    },
  );
  it.each(["openrouter", "convex"] as const)(
    "publishes partial-word %s tokens before the provider finishes",
    async (provider) => {
      vi.useRealTimers();
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "z-ai/glm-5.3-flash",
        snapshot: "freestyle/ubuntu",
      });
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const encoder = new TextEncoder();
      const chunk = (content: string, finish: boolean = false) =>
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: "live-tokens",
              object: "chat.completion.chunk",
              created: 1,
              model: "z-ai/glm-5.3-flash",
              choices: [
                {
                  index: 0,
                  delta: { content },
                  finish_reason: finish ? "stop" : null,
                },
              ],
            })}\n\n`,
          ),
        );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          chunk("Hel");
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Say hello",
      }))!;
      const run = (await t.run((ctx) => ctx.db.get(runId)))!;
      const running = t.action(internal.investigate.run, { runId });
      const readPartialText = async () => {
        const args = {
          token,
          projectId,
          threadId: run.threadId!,
          paginationOpts: { numItems: 30, cursor: null },
        };
        const list = await t.query(api.projects.messages, {
          ...args,
          streamArgs: { kind: "list", startOrder: 0 },
        });
        if (list.streams?.kind !== "list" || !list.streams.messages.length)
          return "";
        const deltas = await t.query(api.projects.messages, {
          ...args,
          streamArgs: {
            kind: "deltas",
            cursors: list.streams.messages.map((message) => ({
              streamId: message.streamId,
              cursor: 0,
            })),
          },
        });
        if (deltas.streams?.kind !== "deltas") return "";
        return deltas.streams.deltas
          .flatMap((delta) => delta.parts)
          .flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))
          .join("");
      };
      try {
        await vi.waitFor(
          async () => expect(await readPartialText()).toBe("Hel"),
          { timeout: 2000, interval: 10 },
        );
        expect((await t.run((ctx) => ctx.db.get(runId)))?.state).toBe(
          "running",
        );
        chunk("lo");
        await vi.waitFor(
          async () => expect(await readPartialText()).toBe("Hello"),
          { timeout: 2000, interval: 10 },
        );
      } finally {
        chunk("", true);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        await running;
      }
      expect((await t.run((ctx) => ctx.db.get(runId)))?.summary).toBe("Hello");
    },
  );
  it.each(["openrouter", "convex"] as const)(
    "streams a %s tool call and follow-up answer through the actual Convex Agent",
    async (provider) => {
      const { t, projectId } = await setup();
      await t.action(api.settings.save, {
        token,
        freestyleKey: "private-freestyle-key",
        ...(provider === "openrouter" ? { openrouterKey: routerKey } : {}),
        modelProvider: provider,
        model: "openai/gpt-5.4",
        snapshot: "freestyle/ubuntu",
      });
      await t.run(async (ctx) => {
        const p = (await ctx.db.get(projectId))!;
        await ctx.db.patch(projectId, {
          allowedQueries: [],
          permissions: { ...p.permissions, readLogs: false, runQueries: false },
        });
      });
      const readRequests = [
        { kind: "functions", functionPath: "", argsJson: "{}" },
        { kind: "logs", functionPath: "", argsJson: '{"cursor":0}' },
        { kind: "query", functionPath: "health:read", argsJson: "{}" },
        {
          kind: "inlineQuery",
          functionPath: "",
          argsJson: '{"code":"return 1;"}',
        },
      ];
      const bodies: any[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          expect(String(url)).toBe(
            provider === "openrouter"
              ? "https://openrouter.ai/api/v1/chat/completions"
              : "https://ai-gateway.convex.dev/v1/chat/completions",
          );
          expect(new Headers(init.headers).get("authorization")).toBe(
            `Bearer ${provider === "openrouter" ? routerKey : "synthetic-gateway-deployment-token"}`,
          );
          const body = JSON.parse(init.body as string);
          bodies.push(body);
          const delta =
            bodies.length === 1
              ? {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_health",
                      type: "function",
                      function: {
                        name: "notebook",
                        arguments: JSON.stringify({
                          code: "print(healthy)",
                          timeoutMs: 5000,
                          reason: "Read health",
                          requests: readRequests,
                        }),
                      },
                    },
                  ],
                }
              : {
                  role: "assistant",
                  content: "The health query reports healthy.",
                };
          const chunks = [
            {
              id: "test-response",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              provider: bodies.length === 1 ? "Together" : "Fireworks",
              choices: [{ index: 0, delta, finish_reason: null }],
            },
            {
              id: "test-response",
              object: "chat.completion.chunk",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: bodies.length === 1 ? "tool_calls" : "stop",
                },
              ],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 10,
                total_tokens: 30,
              },
            },
          ];
          return new Response(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const runId = (await t.mutation(api.projects.ask, {
        token,
        projectId,
        prompt: "Check health",
      }))!;
      await t.action(internal.investigate.run, { runId });
      const run = await t.run((ctx) => ctx.db.get(runId));
      expect(run?.error).toBeUndefined();
      expect(run?.state).toBe("complete");
      expect(run?.summary).toBe("The health query reports healthy.");
      const messages = await t.query(api.projects.messages, {
        token,
        projectId,
        threadId: run!.threadId!,
        paginationOpts: { numItems: 30, cursor: null },
        streamArgs: { kind: "list", startOrder: 0 },
      });
      const response = messages.page.find((m) => m.role === "assistant")!;
      expect(openRouterProviders(response)).toEqual(
        provider === "openrouter" ? ["Together", "Fireworks"] : undefined,
      );
      expect(bodies).toHaveLength(2);
      expect(
        bodies.every((body) => body.model === "openai/gpt-5.4" && body.stream),
      ).toBe(true);
      expect(bodies[0].provider).toBeUndefined();
      if (provider === "convex") {
        expect(bodies[0].provider).toBeUndefined();
        expect(getServiceToken).toHaveBeenCalledWith("ai-gateway");
        expect(JSON.stringify(run)).not.toContain(
          "synthetic-gateway-deployment-token",
        );
      }
      expect(
        bodies[1].messages.some(
          (m: any) => m.role === "tool" && m.content.includes("healthy"),
        ),
      ).toBe(true);
      expect(executeNotebook).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ _id: projectId }),
        expect.objectContaining({ code: "print(healthy)" }),
        { events: [], results: [] },
        runId,
        {
          requests: [
            {
              kind: "functions",
              functionPath: "Function definitions",
              argsJson: "{}",
            },
            {
              kind: "logs",
              functionPath: "Deployment logs",
              argsJson: '{"cursor":0}',
            },
            { kind: "query", functionPath: "health:read", argsJson: "{}" },
            {
              kind: "inlineQuery",
              functionPath: "Read-only data query",
              argsJson: '{"code":"return 1;"}',
            },
          ],
        },
      );
      expect(executeGrant).not.toHaveBeenCalled();
      expect(
        await t.run((ctx) => ctx.db.query("proposals").collect()),
      ).toHaveLength(0);
    },
  );
});
