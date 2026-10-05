import type { ConvexReactClient } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const INITIAL_MESSAGE_COUNT = 30;
export const PRELOAD_DELAY_MS = 80;
export const PRELOAD_TTL_MS = 30_000;
export const MAX_PRELOAD_DESTINATIONS = 3;

export type NavigationTarget =
  | { kind: "project"; projectId: string }
  | { kind: "chat"; projectId: string; threadId: string }
  | { kind: "artifact"; projectId: string; threadId: string; sourceId: string };

type QuerySpec = {
  query: FunctionReference<"query">;
  args: Record<string, Value>;
};
function querySpec<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): QuerySpec {
  return { query, args };
}

export function navigationQueries(token: string, target: NavigationTarget) {
  const project = { token, projectId: target.projectId as Id<"projects"> };
  if (target.kind === "project") {
    return [
      querySpec(api.projects.conversations, project),
      querySpec(api.projects.inspect, project),
      querySpec(api.artifacts.recent, project),
      querySpec(api.artifacts.pinned, project),
    ];
  }
  const chat = { ...project, threadId: target.threadId };
  const queries = [
    querySpec(api.projects.chat, { token, threadId: target.threadId }),
    querySpec(api.projects.inspect, chat),
    // Agent's useUIMessages uses convex-helpers pagination: the first page has
    // no pagination ID or streamArgs. Keep these arguments identical so the
    // mounted hook consumes the same live subscription, including updates.
    querySpec(api.projects.messages, {
      ...chat,
      paginationOpts: { numItems: INITIAL_MESSAGE_COUNT, cursor: null },
    }),
  ];
  if (target.kind === "artifact")
    queries.push(
      querySpec(api.artifacts.history, { ...chat, sourceId: target.sourceId }),
    );
  return queries;
}

export class NavigationPreloader {
  private entries = new Map<
    string,
    { release: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  private pending?: { key: string; timer: ReturnType<typeof setTimeout> };

  constructor(
    private client: Pick<ConvexReactClient, "watchQuery">,
    private token: string,
  ) {}

  schedule(target: NavigationTarget) {
    this.cancel();
    this.pending = {
      key: JSON.stringify(target),
      timer: setTimeout(() => {
        this.pending = undefined;
        this.preload(target);
      }, PRELOAD_DELAY_MS),
    };
  }

  cancel(target?: NavigationTarget) {
    if (
      !this.pending ||
      (target && this.pending.key !== JSON.stringify(target))
    )
      return;
    clearTimeout(this.pending.timer);
    this.pending = undefined;
  }

  preload(target: NavigationTarget) {
    this.cancel(target);
    const key = JSON.stringify(target);
    const existing = this.entries.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.entries.delete(key);
      this.entries.set(key, {
        ...existing,
        timer: setTimeout(() => this.evict(key), PRELOAD_TTL_MS),
      });
      return;
    }
    while (this.entries.size >= MAX_PRELOAD_DESTINATIONS)
      this.evict(this.entries.keys().next().value!);
    const unsubscribes: (() => void)[] = [];
    try {
      for (const { query, args } of navigationQueries(this.token, target)) {
        // Convex deduplicates identical queries with visible subscribers. Keep
        // our subscription alive briefly; a one-shot query loses that cache.
        unsubscribes.push(
          this.client.watchQuery(query, args).onUpdate(() => {}),
        );
      }
      this.entries.set(key, {
        release: () => unsubscribes.forEach((unsubscribe) => unsubscribe()),
        timer: setTimeout(() => this.evict(key), PRELOAD_TTL_MS),
      });
    } catch {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      // Speculative loading must never interrupt normal navigation.
    }
  }

  private evict(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.release();
    this.entries.delete(key);
  }

  clear() {
    this.cancel();
    for (const key of this.entries.keys()) this.evict(key);
  }
}
