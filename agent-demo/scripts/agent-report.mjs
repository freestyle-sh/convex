import { execFileSync } from "node:child_process";

// Read-only report against the configured demo backend. Never prints credentials,
// notebook code, customer records, or provider reasoning.
const threadIds = process.argv.slice(2);
if (!threadIds.length)
  throw new Error("Usage: node scripts/agent-report.mjs THREAD_ID [...]");
function convex(args) {
  return JSON.parse(
    execFileSync("npx", ["convex", ...args], {
      encoding: "utf8",
      maxBuffer: 20_000_000,
    }),
  );
}
const runs = convex(["data", "runs", "--limit", "200", "--format", "json"]);
const report = [];
for (const threadId of threadIds) {
  const messages = [];
  let cursor = null;
  do {
    const page = convex([
      "run",
      "--component",
      "agent",
      "messages:listMessagesByThreadId",
      JSON.stringify({
        threadId,
        order: "asc",
        paginationOpts: { numItems: 100, cursor },
      }),
    ]);
    messages.push(...page.page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  for (const run of runs
    .filter((r) => r.threadId === threadId)
    .sort((a, b) => a.startedAt - b.startedAt)) {
    const order = messages.find((m) => m._id === run.promptMessageId)?.order;
    if (order === undefined) continue;
    const turn = messages.filter((m) => m.order === order);
    const parts = turn.flatMap((m) =>
      Array.isArray(m.message?.content) ? m.message.content : [],
    );
    const calls = parts.filter((p) => p.type === "tool-call");
    const outputs = parts.filter((p) => p.type === "tool-result");
    const cells = outputs.filter(
      (p) => p.toolName === "notebook" && p.output?.value?.sessionId,
    );
    const executedIds = new Set(cells.map((p) => p.toolCallId));
    report.push({
      threadId,
      prompt: run.prompt,
      state: run.state,
      failedMessages: turn.filter((m) => m.status === "failed").length,
      hasFinalAnswer: Boolean(run.summary?.trim()),
      elapsedSeconds: run.finishedAt
        ? (run.finishedAt - run.startedAt) / 1000
        : null,
      toolCalls: calls.length,
      notebookExecutions: cells.length,
      skippedDuplicates: outputs.filter(
        (p) => p.output?.value?.status === "duplicate",
      ).length,
      errors: outputs.filter(
        (p) =>
          p.output?.type === "error-text" ||
          ["error", "timeout"].includes(p.output?.value?.status),
      ).length,
      networkRequests: calls
        .filter((p) => executedIds.has(p.toolCallId))
        .reduce((n, p) => n + (p.input?.requests?.length ?? 0), 0),
      reusedCells: cells.filter((p) => p.output.value.sessionReused).length,
      kernelSeconds:
        cells.reduce((n, p) => n + (p.output.value.durationMs ?? 0), 0) / 1000,
      charts: cells.reduce(
        (n, p) => n + (p.output.value.charts?.length ?? 0),
        0,
      ),
      providers: [
        ...new Set(
          turn
            .map((m) => m.providerMetadata?.openrouter?.provider)
            .filter(Boolean),
        ),
      ],
    });
  }
}
console.log(JSON.stringify(report, null, 2));
