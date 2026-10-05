import type { Artifact } from "../convex/lib/artifacts";
import { orderedResults, moveResult } from "./resultLayout";
import { selectionFor } from "./results";
import type { Message } from "./types";

export const artifactSourceId = (a: Artifact) =>
  a.rootSourceId ?? a.item.sourceId;
export const artifactId = (a: Artifact) =>
  `${a.threadId}:${artifactSourceId(a)}`;
export const artifactTitle = (a: Artifact) =>
  a.item.kind === "chart"
    ? (a.item.figure.layout?.title?.text ?? "Chart")
    : a.item.table.title;
export type ArtifactLayout = { order: string[] };
export function readArtifactLayout(raw: string | null): ArtifactLayout {
  try {
    const value = JSON.parse(raw ?? "null");
    const ids = (items: unknown): string[] =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.filter(
                (id): id is string =>
                  typeof id === "string" && id.length > 0 && id.length <= 512,
              ),
            ),
          ].slice(0, 200)
        : [];
    return { order: ids(value?.order) };
  } catch {
    return { order: [] };
  }
}
export function artifactOrder(
  layout: ArtifactLayout,
  available: string[],
  pinned: string[],
) {
  const ordered = orderedResults(layout.order, available);
  const pins = new Set(pinned);
  return [
    ...ordered.filter((id) => pins.has(id)),
    ...ordered.filter((id) => !pins.has(id)),
  ];
}
export function moveArtifact(
  layout: ArtifactLayout,
  order: string[],
  pinned: string[],
  from: string,
  to: string,
): ArtifactLayout {
  // Pins stay at the front; dragging changes order within either group.
  if (pinned.includes(from) !== pinned.includes(to)) return layout;
  return { ...layout, order: moveResult(order, from, to) };
}
export function artifactSelection(artifact: Artifact) {
  const { item } = artifact;
  return selectionFor(
    item.kind,
    artifactTitle(artifact),
    artifactSourceId(artifact),
    {
      sourceThreadId: artifact.threadId,
      createdAt: artifact.createdAt,
      partial: item.partial,
      ...(item.kind === "chart"
        ? { figure: item.figure }
        : { table: item.table }),
    },
  );
}
export function artifactMessages(messages: Message[], sourceId: string) {
  let relevant = false;
  return messages.filter((message) => {
    if (message.role === "user")
      relevant = message.selection?.sourceId === sourceId;
    return relevant;
  });
}
