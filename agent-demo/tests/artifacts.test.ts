import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import crons from "@convex-dev/crons/test";
import { saveMessage, saveMessages } from "@convex-dev/agent";
import schema from "../convex/schema";
import { api, components, internal } from "../convex/_generated/api";
import type { NotebookResult } from "../convex/lib/notebook";
const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64),
  stranger = "b".repeat(64);
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
const output = (
  title: string,
  value: number,
  replacesPreviousResults = false,
): NotebookResult => ({
  status: "ok",
  executionCount: 1,
  stdout: "Not part of the artifact",
  stderr: "",
  text: "",
  charts: [
    {
      data: [{ type: "bar", x: ["A"], y: [value] }],
      layout: { title: { text: title } },
    },
  ],
  tables: [],
  chartWarnings: [],
  kernelReset: false,
  durationMs: 5,
  outputTruncated: false,
  replacesPreviousResults,
});
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  crons.register(t);
  await t.mutation(api.workspaces.open, { token });
  await t.mutation(api.workspaces.open, { token: stranger });
  const projectId = await t.mutation(api.projects.save, { token, ...config });
  const threadId = await t.mutation(api.projects.newChat, { token, projectId });
  return { t, projectId, threadId, args: { token, projectId } };
}
async function saveResults(
  t: Awaited<ReturnType<typeof setup>>["t"],
  threadId: string,
  outputs: ReturnType<typeof output>[],
) {
  await t.run(async (ctx) => {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt: "Show me orders",
    });
    for (const [index, value] of outputs.entries()) {
      const toolCallId = `cell-${messageId}-${index}`;
      await saveMessages(ctx, components.agent, {
        threadId,
        promptMessageId: messageId,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId,
                toolName: "notebook",
                input: { code: "private code" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId,
                toolName: "notebook",
                output: { type: "json", value },
              },
            ],
          },
        ],
      });
    }
  });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("homepage artifacts", () => {
  it("opens a stable artifact URL without starting an investigation, with workspace and deletion checks", async () => {
    const { t, threadId, projectId, args } = await setup();
    await saveResults(t, threadId, [output("Orders", 12)]);
    const [original] = await t.query(api.artifacts.recent, args);
    const source = {
      ...args,
      threadId,
      sourceId: original.item.sourceId,
      messageId: original.messageId,
    };
    const id = await t.mutation(api.artifacts.open, source);
    expect(await t.mutation(api.artifacts.open, source)).toBe(id);
    expect(
      await t.query(api.artifacts.get, { token, artifactId: id }),
    ).toMatchObject({ item: original.item });
    expect(
      (
        await t.query(api.artifacts.history, {
          ...args,
          threadId,
          sourceId: original.item.sourceId,
        })
      )?.versions,
    ).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toEqual([]);
    expect(
      await t.query(api.artifacts.get, { token: stranger, artifactId: id }),
    ).toBeNull();
    expect(
      await t.query(api.artifacts.get, { token, artifactId: "invalid" }),
    ).toBeNull();
    await expect(
      t.mutation(api.artifacts.open, { ...source, token: stranger }),
    ).rejects.toThrow("this workspace");
    await t.mutation(api.projects.deleteChat, { token, projectId, threadId });
    expect(
      await t.query(api.artifacts.get, { token, artifactId: id }),
    ).toBeNull();
  });
  it("opens an older inline chart using its verified message anchor", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [output("Older chart", 42)]);
    const [original] = await t.query(api.artifacts.recent, args);
    for (let i = 0; i < 45; i++) {
      await t.run((ctx) =>
        saveMessage(ctx, components.agent, { threadId, prompt: `Later ${i}` }),
      );
    }
    expect(await t.query(api.artifacts.recent, args)).toEqual([]);
    const id = await t.mutation(api.artifacts.open, {
      ...args,
      threadId,
      sourceId: original.item.sourceId,
      messageId: original.messageId,
    });
    expect(
      (await t.query(api.artifacts.get, { token, artifactId: id }))?.item,
    ).toEqual(original.item);
  });
  it("includes validated tables with their source and partial-result status", async () => {
    const { t, threadId, args } = await setup();
    const result = output("Ignored", 0);
    result.charts = [];
    result.tables = [
      {
        title: "Orders",
        columns: ["Status", "Count"],
        rows: [
          ["paid", 98],
          ["failed", 12],
        ],
      },
    ];
    result.status = "error";
    await saveResults(t, threadId, [result]);
    expect(await t.query(api.artifacts.recent, args)).toMatchObject([
      {
        threadId,
        item: { kind: "table", partial: true, table: result.tables[0] },
      },
    ]);
  });
  it("returns persisted Agent charts, preferring corrected versions and excluding code/stdout", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [
      output("Wrong", 0),
      output("Corrected", 42, true),
    ]);
    const artifacts = await t.query(api.artifacts.recent, args);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      threadId,
      item: {
        kind: "chart",
        partial: false,
        figure: {
          layout: { title: { text: "Corrected" } },
          data: [{ y: [42] }],
        },
      },
    });
    expect(JSON.stringify(artifacts)).not.toContain("private code");
    expect(JSON.stringify(artifacts)).not.toContain("Not part of the artifact");
  });
  it("keeps repeated titles across chats, newest first, and removes deleted chats", async () => {
    const { t, threadId, projectId, args } = await setup();
    await saveResults(t, threadId, [output("Orders", 1)]);
    vi.setSystemTime(Date.now() + 60_000);
    const newer = await t.mutation(api.projects.newChat, { token, projectId });
    await saveResults(t, newer, [output("Orders", 2)]);
    expect(
      (await t.query(api.artifacts.recent, args)).map((a) => a.threadId),
    ).toEqual([newer, threadId]);
    await t.mutation(api.projects.deleteChat, { ...args, threadId: newer });
    expect(
      (await t.query(api.artifacts.recent, args)).map((a) => a.threadId),
    ).toEqual([threadId]);
  });
  it("isolates projects and workspaces and has a quiet empty state", async () => {
    const { t, threadId, args } = await setup();
    expect(await t.query(api.artifacts.recent, args)).toEqual([]);
    await saveResults(t, threadId, [output("Private", 1)]);
    await expect(
      t.query(api.artifacts.recent, { ...args, token: stranger }),
    ).rejects.toThrow("this workspace");
    const projectId = await t.mutation(api.projects.save, {
      token,
      ...config,
      name: "Other",
      deploymentUrl: "https://other-123.convex.cloud",
      keyPrefix: "TARGET_OTHER",
    });
    expect(await t.query(api.artifacts.recent, { token, projectId })).toEqual(
      [],
    );
  });
  it("bounds the gallery to 12 recent artifacts", async () => {
    const { t, threadId, args } = await setup();
    for (let i = 0; i < 15; i++) {
      vi.setSystemTime(Date.now() + 1000);
      await saveResults(t, threadId, [output(`Chart ${i}`, i)]);
    }
    const artifacts = await t.query(api.artifacts.recent, args);
    expect(artifacts).toHaveLength(12);
    expect(artifacts[0].item).toMatchObject({
      kind: "chart",
      figure: { layout: { title: { text: "Chart 14" } } },
    });
  });
  it("pins real results across the recent window, unpins idempotently, and removes pins with deleted chats", async () => {
    const { t, threadId, projectId, args } = await setup();
    await saveResults(t, threadId, [output("Keep me", 42)]);
    const [artifact] = await t.query(api.artifacts.recent, args);
    const pinArgs = { ...args, threadId, sourceId: artifact.item.sourceId };
    await t.mutation(api.artifacts.setPinned, { ...pinArgs, pinned: true });
    await t.mutation(api.artifacts.setPinned, { ...pinArgs, pinned: true });
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(Date.now() + 1000);
      await t.mutation(api.projects.newChat, { token, projectId });
    }
    expect(await t.query(api.artifacts.recent, args)).toEqual([]);
    expect(await t.query(api.artifacts.pinned, args)).toEqual([artifact]);
    await t.mutation(api.projects.deleteChat, { ...args, threadId });
    expect(await t.query(api.artifacts.pinned, args)).toEqual([]);
    await expect(
      t.mutation(api.artifacts.setPinned, { ...pinArgs, pinned: true }),
    ).rejects.toThrow("no longer available");
    await t.mutation(api.artifacts.setPinned, { ...pinArgs, pinned: false });
  });
  it("authorizes pins, rejects invented results and wrong-project threads, and supports unpin", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [output("Private", 10)]);
    const [artifact] = await t.query(api.artifacts.recent, args);
    const pinArgs = {
      ...args,
      threadId,
      sourceId: artifact.item.sourceId,
      pinned: true,
    };
    await expect(
      t.mutation(api.artifacts.setPinned, { ...pinArgs, token: stranger }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.query(api.artifacts.pinned, { ...args, token: stranger }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.artifacts.setPinned, { ...pinArgs, sourceId: "invented" }),
    ).rejects.toThrow("no longer in the recent list");
    const other = await t.mutation(api.projects.save, {
      token,
      ...config,
      name: "Other",
      keyPrefix: "TARGET_OTHER",
      deploymentUrl: "https://other-123.convex.cloud",
    });
    await expect(
      t.mutation(api.artifacts.setPinned, { ...pinArgs, projectId: other }),
    ).rejects.toThrow("no longer available");
    await t.mutation(api.artifacts.setPinned, pinArgs);
    await t.mutation(api.artifacts.setPinned, { ...pinArgs, pinned: false });
    expect(await t.query(api.artifacts.pinned, args)).toEqual([]);
  });
  it("edits the main artifact, preserves original versions, and updates the same gallery and pin", async () => {
    const { t, threadId, projectId, args } = await setup();
    await saveResults(t, threadId, [output("Orders", 12)]);
    const [original] = await t.query(api.artifacts.recent, args);
    const source = { ...args, threadId, sourceId: original.item.sourceId };
    await t.mutation(api.artifacts.setPinned, { ...source, pinned: true });
    const runId = (await t.mutation(api.artifacts.ask, {
      ...source,
      prompt: "Group by week",
    }))!;
    const initial = (await t.query(api.artifacts.history, source))!;
    expect(initial.versions).toHaveLength(1);
    expect((await t.query(internal.artifacts.forRun, { runId }))?.item).toEqual(
      original.item,
    );
    await t.run((ctx) => ctx.db.patch(runId, { state: "running" }));
    const commit = await t.mutation(internal.artifacts.commit, {
      runId,
      toolCallId: "edit-1",
      output: output("Weekly orders", 120),
    });
    expect(commit).toMatchObject({ state: "saved", displayed: true });
    const history = (await t.query(api.artifacts.history, source))!;
    expect(history.versions.map((v) => v.number)).toEqual([2, 1]);
    expect(history.artifact).toMatchObject({
      rootSourceId: original.item.sourceId,
      item: {
        kind: "chart",
        sourceId: "edit-1:chart:0",
        figure: { data: [{ y: [120] }] },
      },
    });
    expect(
      await t.mutation(api.artifacts.open, {
        ...args,
        threadId,
        sourceId: "edit-1:chart:0",
      }),
    ).toBe(history.artifactId);
    expect(await t.query(api.artifacts.recent, args)).toEqual([
      history.artifact,
    ]);
    expect(await t.query(api.artifacts.pinned, args)).toEqual([
      history.artifact,
    ]);
    expect(
      await t.mutation(internal.artifacts.commit, {
        runId,
        toolCallId: "edit-1",
        output: output("Duplicate", 999),
      }),
    ).toMatchObject({ state: "saved", displayed: true });
    expect(
      (await t.query(api.artifacts.history, source))?.versions,
    ).toHaveLength(2);
    await t.mutation(api.artifacts.selectVersion, {
      token,
      artifactId: history.artifactId,
      versionId: initial.currentVersionId!,
    });
    expect(
      (await t.query(api.artifacts.history, source))?.artifact?.item,
    ).toEqual(original.item);
    const editFromOriginal = (await t.mutation(api.artifacts.ask, {
      ...source,
      baseVersionId: initial.currentVersionId,
      prompt: "Change it to a line",
    }))!;
    expect(
      (await t.query(internal.artifacts.forRun, { runId: editFromOriginal }))
        ?.item,
    ).toEqual(original.item);
    await t.mutation(api.artifacts.selectVersion, {
      token,
      artifactId: history.artifactId,
      versionId: history.currentVersionId!,
    });
    expect(
      (await t.query(api.artifacts.history, source))?.artifact?.item,
    ).toEqual(history.artifact?.item);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { state: "complete" });
      await ctx.db.patch(editFromOriginal, { state: "complete" });
    });
    await t.mutation(api.projects.deleteChat, { token, projectId, threadId });
    expect(await t.query(api.artifacts.history, source)).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("artifactVersions").collect()),
    ).toEqual([]);
  });
  it("keeps the current artifact for failed, ambiguous, incomplete, or inactive cell results", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [output("Original", 12)]);
    const [original] = await t.query(api.artifacts.recent, args);
    const source = { ...args, threadId, sourceId: original.item.sourceId };
    const runId = (await t.mutation(api.artifacts.ask, {
      ...source,
      prompt: "Explain this chart",
    }))!;
    const failed = output("Failure", 0);
    failed.status = "error";
    const multiple = output("Ambiguous", 0);
    multiple.charts.push(...output("Other", 0).charts);
    const truncated = output("Truncated", 0);
    truncated.outputTruncated = true;
    const warning = output("Warning", 0);
    warning.chartWarnings = ["Dropped unsupported trace"];
    expect(
      await t.mutation(internal.artifacts.commit, {
        runId,
        toolCallId: "inactive",
        output: output("Invalid", 0),
      }),
    ).toMatchObject({ state: "unchanged" });
    await t.run((ctx) => ctx.db.patch(runId, { state: "running" }));
    for (const [index, result] of [
      failed,
      multiple,
      truncated,
      warning,
      {},
    ].entries()) {
      expect(
        await t.mutation(internal.artifacts.commit, {
          runId,
          toolCallId: `failed-${index}`,
          output: result,
        }),
      ).toMatchObject({ state: "unchanged" });
    }
    const history = (await t.query(api.artifacts.history, source))!;
    expect(history.versions).toHaveLength(1);
    expect(history.artifact?.item).toEqual(original.item);
  });
  it("does not let a late edit override a selected version, and rejects stale submissions", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [output("Original", 12)]);
    const [original] = await t.query(api.artifacts.recent, args);
    const source = { ...args, threadId, sourceId: original.item.sourceId };
    const firstRun = (await t.mutation(api.artifacts.ask, {
      ...source,
      prompt: "First edit",
    }))!;
    const initial = (await t.query(api.artifacts.history, source))!;
    await t.run((ctx) => ctx.db.patch(firstRun, { state: "running" }));
    await t.mutation(internal.artifacts.commit, {
      runId: firstRun,
      toolCallId: "first",
      output: output("First", 20),
    });
    const edited = (await t.query(api.artifacts.history, source))!;
    await expect(
      t.mutation(api.artifacts.ask, {
        ...source,
        baseVersionId: initial.currentVersionId,
        prompt: "Stale",
      }),
    ).rejects.toThrow("artifact changed");
    const nextRun = (await t.mutation(api.artifacts.ask, {
      ...source,
      baseVersionId: edited.currentVersionId,
      prompt: "Second edit",
    }))!;
    await t.run((ctx) => ctx.db.patch(nextRun, { state: "running" }));
    await t.mutation(api.artifacts.selectVersion, {
      token,
      artifactId: edited.artifactId,
      versionId: initial.currentVersionId!,
    });
    expect(
      await t.mutation(internal.artifacts.commit, {
        runId: nextRun,
        toolCallId: "late",
        output: output("Late", 30),
      }),
    ).toMatchObject({ state: "saved", displayed: false });
    const history = (await t.query(api.artifacts.history, source))!;
    expect(history.currentVersionId).toEqual(initial.currentVersionId);
    expect(history.versions).toHaveLength(3);
  });
  it("isolates version history and edits across projects and workspaces", async () => {
    const { t, threadId, args } = await setup();
    await saveResults(t, threadId, [output("Private", 12)]);
    const [original] = await t.query(api.artifacts.recent, args);
    const source = { ...args, threadId, sourceId: original.item.sourceId };
    await t.mutation(api.artifacts.ask, { ...source, prompt: "Discuss" });
    const history = (await t.query(api.artifacts.history, source))!;
    await expect(
      t.query(api.artifacts.history, { ...source, token: stranger }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.artifacts.ask, {
        ...source,
        token: stranger,
        prompt: "Change",
      }),
    ).rejects.toThrow("this workspace");
    await expect(
      t.mutation(api.artifacts.selectVersion, {
        token: stranger,
        artifactId: history.artifactId,
        versionId: history.currentVersionId!,
      }),
    ).rejects.toThrow("this workspace");
    const second = await t.mutation(api.projects.newChat, args);
    await saveResults(t, second, [output("Other", 1)]);
    const otherArtifact = (await t.query(api.artifacts.recent, args)).find(
      (a) => a.threadId === second,
    )!;
    const otherSource = {
      ...args,
      threadId: second,
      sourceId: otherArtifact.item.sourceId,
    };
    await t.mutation(api.artifacts.ask, { ...otherSource, prompt: "Other" });
    const other = (await t.query(api.artifacts.history, otherSource))!;
    await expect(
      t.mutation(api.artifacts.selectVersion, {
        token,
        artifactId: history.artifactId,
        versionId: other.currentVersionId!,
      }),
    ).rejects.toThrow("Version not found");
  });
});
