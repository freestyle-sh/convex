import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  INITIAL_MESSAGE_COUNT,
  MAX_PRELOAD_DESTINATIONS,
  NavigationPreloader,
  navigationQueries,
  PRELOAD_DELAY_MS,
  PRELOAD_TTL_MS,
  type NavigationTarget,
} from "../src/navigationPreload";

const chat = (threadId = "chat-a"): NavigationTarget => ({
  kind: "chat",
  projectId: "project-a",
  threadId,
});

describe("navigation preloading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const watchQuery = vi.fn(() => ({
      onUpdate: () => {
        const release = vi.fn();
        releases.push(release);
        return release;
      },
    }));
    const preloader = new NavigationPreloader(
      { watchQuery } as unknown as Pick<ConvexReactClient, "watchQuery">,
      "workspace-a",
    );
    return { preloader, watchQuery, releases };
  }

  it("waits for intent, cancels flybys, and warms only the latest destination", () => {
    const { preloader, watchQuery } = setup();
    preloader.schedule(chat());
    vi.advanceTimersByTime(PRELOAD_DELAY_MS - 1);
    expect(watchQuery).not.toHaveBeenCalled();
    preloader.cancel(chat());
    vi.advanceTimersByTime(PRELOAD_DELAY_MS);
    expect(watchQuery).not.toHaveBeenCalled();
    preloader.schedule(chat());
    preloader.schedule(chat("chat-b"));
    preloader.cancel(chat()); // Leaving the old element cannot cancel the new one.
    vi.advanceTimersByTime(PRELOAD_DELAY_MS);
    expect(watchQuery).toHaveBeenCalledTimes(3);
    expect(
      watchQuery.mock.calls.every(
        (call) =>
          (call as unknown as [unknown, { threadId: string }])[1].threadId ===
          "chat-b",
      ),
    ).toBe(true);
    preloader.clear();
  });

  it("deduplicates repeated intent and expires idle subscriptions", () => {
    const { preloader, watchQuery, releases } = setup();
    preloader.schedule(chat());
    preloader.preload(chat()); // Pointer-down takes over from the delayed hover.
    vi.advanceTimersByTime(PRELOAD_DELAY_MS);
    expect(watchQuery).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(PRELOAD_TTL_MS / 2);
    preloader.preload(chat());
    vi.advanceTimersByTime(PRELOAD_TTL_MS / 2);
    expect(releases.every((release) => release.mock.calls.length === 0)).toBe(
      true,
    );
    expect(watchQuery).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(PRELOAD_TTL_MS / 2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
      true,
    );
    preloader.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds live destinations and evicts the least recently used", () => {
    const { preloader, releases } = setup();
    for (let i = 0; i < MAX_PRELOAD_DESTINATIONS; i++)
      preloader.preload(chat(`chat-${i}`));
    preloader.preload(chat("chat-0"));
    preloader.preload(chat("extra"));
    expect(
      releases.slice(0, 3).every((release) => release.mock.calls.length === 0),
    ).toBe(true);
    expect(
      releases.slice(3, 6).every((release) => release.mock.calls.length === 1),
    ).toBe(true);
    preloader.schedule(chat("pending"));
    preloader.clear();
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps workspaces isolated and requests only bounded read queries", () => {
    const targets: NavigationTarget[] = [
      chat(),
      { kind: "project", projectId: "project-a" },
      {
        kind: "artifact",
        projectId: "project-a",
        threadId: "chat-a",
        sourceId: "chart-a",
      },
    ];
    const names = new Set<string>();
    for (const target of targets) {
      for (const { query, args } of navigationQueries("workspace-b", target)) {
        expect(args.token).toBe("workspace-b");
        names.add(getFunctionName(query));
      }
    }
    expect([...names].sort()).toEqual([
      "artifacts:history",
      "artifacts:pinned",
      "artifacts:recent",
      "projects:chat",
      "projects:conversations",
      "projects:inspect",
      "projects:messages",
    ]);
    const messages = navigationQueries("workspace-b", chat()).find(
      ({ query }) => getFunctionName(query) === "projects:messages",
    )!;
    expect(messages.args.paginationOpts).toEqual({
      cursor: null,
      numItems: INITIAL_MESSAGE_COUNT,
    });
    expect(messages.args).not.toHaveProperty("streamArgs");
  });

  it("cleans up a partial subscription failure without breaking navigation", () => {
    const { preloader, watchQuery, releases } = setup();
    watchQuery.mockImplementationOnce(() => ({
      onUpdate: () => {
        const release = vi.fn();
        releases.push(release);
        return release;
      },
    }));
    watchQuery.mockImplementationOnce(() => {
      throw new Error("Connection unavailable");
    });
    expect(() => preloader.preload(chat())).not.toThrow();
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    preloader.preload(chat());
    expect(watchQuery).toHaveBeenCalledTimes(5);
    preloader.clear();
  });
});

// Exercise the actual Convex client/cache with a deterministic transport. No
// credentials, backend mutations, or external services are used by this test.
describe("Convex subscription handoff", () => {
  it("reuses the prefetched first page and retains reactive updates after expiry", async () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    let socket: FakeSocket;
    class FakeSocket {
      onopen?: () => void;
      onmessage?: (message: { data: string }) => void;
      onclose?: () => void;
      constructor() {
        // Expose the transport created by Convex to this integration test.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        socket = this;
      }
      send(message: string) {
        sent.push(JSON.parse(message));
      }
      close() {
        this.onclose?.();
      }
    }
    const client = new ConvexReactClient("https://preload-test.convex.cloud", {
      webSocketConstructor: FakeSocket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
    });
    const preloader = new NavigationPreloader(client, "workspace-a");
    try {
      preloader.preload(chat());
      socket!.onopen!();
      const adds = sent
        .flatMap((message) => message.modifications ?? [])
        .filter((item) => item.type === "Add");
      expect(adds).toHaveLength(3);
      const messageQuery = adds.find(
        (item) => item.udfPath === "projects:messages",
      );
      const version = Math.max(
        ...sent
          .filter((message) => message.type === "ModifyQuerySet")
          .map((message) => message.newVersion),
      );
      const emptyTimestamp = Buffer.alloc(8).toString("base64");
      const response = {
        page: [
          {
            id: "message-1",
            key: "message-1",
            role: "assistant",
            status: "success",
            order: 1,
            stepOrder: 0,
            parts: [{ type: "text", text: "Already loaded" }],
          },
        ],
        isDone: true,
        continueCursor: "",
      };
      const deliver = (start: number, end: number, value: unknown) =>
        socket!.onmessage!({
          data: JSON.stringify({
            type: "Transition",
            startVersion: { querySet: start, ts: emptyTimestamp, identity: 0 },
            endVersion: { querySet: end, ts: emptyTimestamp, identity: 0 },
            modifications: [
              {
                type: "QueryUpdated",
                queryId: messageQuery.queryId,
                value,
                logLines: [],
                journal: null,
              },
            ],
          }),
        });
      deliver(0, version, response);
      // Exercise the installed Agent hook itself: this catches pagination key
      // changes in an SDK upgrade, not just a matching hand-written watch.
      function AgentMessages() {
        const { results, status } = useUIMessages(
          api.projects.messages,
          {
            token: "workspace-a",
            projectId: "project-a" as Id<"projects">,
            threadId: "chat-a",
          },
          { initialNumItems: INITIAL_MESSAGE_COUNT, stream: true },
        );
        return createElement(
          "span",
          null,
          `${status}: ${results.flatMap((message) => message.parts.filter((part) => part.type === "text").map((part) => part.text)).join("")}`,
        );
      }
      expect(
        renderToStaticMarkup(
          createElement(
            ConvexProvider,
            { client },
            createElement(AgentMessages),
          ),
        ),
      ).toBe("<span>Exhausted: Already loaded</span>");
      // These are the args used by Agent's first page. Reading them before
      // attaching the foreground listener must already return the warm result.
      const visible = client.watchQuery(api.projects.messages, {
        token: "workspace-a",
        projectId: "project-a" as Id<"projects">,
        threadId: "chat-a",
        paginationOpts: { cursor: null, numItems: INITIAL_MESSAGE_COUNT },
      });
      expect(visible.localQueryResult()).toEqual(response);
      const update = vi.fn();
      const release = visible.onUpdate(update);
      expect(
        sent
          .flatMap((message) => message.modifications ?? [])
          .filter((item) => item.type === "Add"),
      ).toHaveLength(3);
      vi.advanceTimersByTime(PRELOAD_TTL_MS);
      const removals = sent
        .flatMap((message) => message.modifications ?? [])
        .filter((item) => item.type === "Remove");
      expect(removals.map((item) => item.queryId)).not.toContain(
        messageQuery.queryId,
      );
      deliver(version, version, {
        ...response,
        page: [{ id: "message-1", text: "Live update" }],
      });
      expect(visible.localQueryResult()?.page[0]).toEqual({
        id: "message-1",
        text: "Live update",
      });
      expect(update).toHaveBeenCalled();
      release();
    } finally {
      preloader.clear();
      await client.close();
      vi.useRealTimers();
    }
  });
});
