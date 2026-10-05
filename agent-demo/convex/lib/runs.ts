import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export function threadRun(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  threadId: string,
  state: "queued" | "running",
) {
  return ctx.db
    .query("runs")
    .withIndex("by_thread_state", (q) =>
      q.eq("projectId", projectId).eq("threadId", threadId).eq("state", state),
    )
    .first();
}

export async function hasActiveRuns(ctx: QueryCtx, projectId: Id<"projects">) {
  const runs = await Promise.all(
    (["queued", "running"] as const).map((state) =>
      ctx.db
        .query("runs")
        .withIndex("by_project_state", (q) =>
          q.eq("projectId", projectId).eq("state", state),
        )
        .first(),
    ),
  );
  return runs.some(Boolean);
}
