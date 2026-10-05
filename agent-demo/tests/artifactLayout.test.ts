import { describe, it, expect } from "vitest";
import {
  artifactId,
  artifactOrder,
  moveArtifact,
  readArtifactLayout,
  artifactSelection,
  artifactMessages,
} from "../src/artifactLayout";
import type { Artifact } from "../convex/lib/artifacts";
import { resultSelection } from "../convex/lib/resultSelection";
const artifact: Artifact = {
  threadId: "chat1",
  threadTitle: "Orders",
  createdAt: 123,
  item: {
    kind: "table",
    sourceId: "cell:table:0",
    partial: false,
    table: {
      title: "Orders",
      columns: ["SKU", "Count"],
      rows: [["Keyboard", 12]],
    },
  },
};
describe("artifact workspace", () => {
  it("restores ordering safely and ignores legacy hidden artifacts", () => {
    expect(readArtifactLayout("no json")).toEqual({ order: [] });
    expect(
      readArtifactLayout(
        JSON.stringify({ order: [null, "a", "a", "b", ""], hidden: [3, "a"] }),
      ),
    ).toEqual({ order: ["a", "b"] });
    const saved = { order: ["b", "a"], hidden: ["a"] };
    const restored = readArtifactLayout(JSON.stringify(saved));
    expect(artifactOrder(restored, ["a", "b", "new"], [])).toEqual([
      "b",
      "a",
      "new",
    ]);
  });
  it("puts pins first, supports moving both groups, and does not cross the pin boundary", () => {
    const layout = { order: ["a", "b", "c", "d"] };
    const ordered = artifactOrder(layout, ["a", "b", "c", "d"], ["c", "d"]);
    expect(ordered).toEqual(["c", "d", "a", "b"]);
    expect(moveArtifact(layout, ordered, ["c", "d"], "d", "c").order).toEqual([
      "d",
      "c",
      "a",
      "b",
    ]);
    expect(moveArtifact(layout, ordered, ["c", "d"], "b", "a").order).toEqual([
      "c",
      "d",
      "b",
      "a",
    ]);
    expect(moveArtifact(layout, ordered, ["c", "d"], "b", "c")).toEqual(layout);
  });
  it("attaches actual artifact values with bounded evidence and its source thread", () => {
    const selection = artifactSelection(artifact);
    expect(resultSelection.safeParse(selection).success).toBe(true);
    expect(JSON.parse(selection.contextJson)).toMatchObject({
      sourceThreadId: "chat1",
      table: artifact.item.kind === "table" ? artifact.item.table : undefined,
    });
    expect(artifactId(artifact)).toBe("chat1:cell:table:0");
    const edited = {
      ...artifact,
      rootSourceId: "original",
      item: { ...artifact.item, sourceId: "edited-cell:table:0" },
    };
    expect(artifactId(edited)).toBe("chat1:original");
    expect(artifactSelection(edited).sourceId).toBe("original");
    const large = {
      ...artifact,
      item: {
        ...artifact.item,
        kind: "table" as const,
        table: {
          title: "Large",
          columns: ["Data"],
          rows: Array.from({ length: 200 }, () => ['\\"\n'.repeat(2000)]),
        },
      },
    };
    expect(artifactSelection(large).contextJson.length).toBeLessThan(6000);
    expect(JSON.parse(artifactSelection(large).contextJson).truncated).toBe(
      true,
    );
  });
  it("reopens only the artifact's discussion and preserves tool/streaming steps", () => {
    const selection = artifactSelection(artifact);
    const messages = [
      { key: "0", role: "assistant", text: "earlier answer" },
      { key: "1", role: "user", text: "Explain", selection },
      {
        key: "2",
        role: "assistant",
        text: "",
        tools: [{ id: "tool", name: "notebook", state: "output-available" }],
      },
      { key: "3", role: "assistant", text: "12 orders" },
      { key: "4", role: "user", text: "unrelated" },
      { key: "5", role: "assistant", text: "other answer" },
      { key: "6", role: "user", text: "More", selection },
      { key: "7", role: "assistant", text: "Streaming", status: "streaming" },
    ];
    expect(
      artifactMessages(messages, selection.sourceId).map((m) => m.key),
    ).toEqual(["1", "2", "3", "6", "7"]);
  });
});
