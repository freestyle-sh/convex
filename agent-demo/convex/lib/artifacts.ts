import {
  notebookResult,
  type ResultTable,
  type PlotlyFigure,
} from "./notebook";

export type ResultItem = { sourceId: string; partial: boolean } & (
  | { kind: "chart"; figure: PlotlyFigure }
  | { kind: "table"; table: ResultTable }
);
export function resultItems(
  tools: { id: string; name: string; state: string; output?: unknown }[],
): ResultItem[] {
  const items = new Map<string, ResultItem>();
  for (const tool of tools) {
    if (tool.name !== "notebook" || tool.state !== "output-available") continue;
    const parsed = notebookResult.safeParse(tool.output);
    if (!parsed.success) continue;
    const result = parsed.data;
    // Only a successful, renderable replacement may supersede earlier evidence.
    // Keep original cell output in the execution history for inspection.
    if (
      result.replacesPreviousResults &&
      result.status === "ok" &&
      !result.outputTruncated &&
      !result.chartWarnings.length &&
      (result.tables.length || result.charts.length)
    )
      items.clear();
    const add = (item: ResultItem, title?: string) => {
      const key =
        title && title !== "Results" ? `${item.kind}:${title}` : item.sourceId;
      if (item.partial && items.get(key)?.partial === false) return;
      items.delete(key);
      items.set(key, item);
    };
    result.tables.forEach((table, index) =>
      add(
        {
          kind: "table",
          table,
          sourceId: `${tool.id}:table:${index}`,
          partial: result.status !== "ok",
        },
        table.title,
      ),
    );
    result.charts.forEach((figure, index) =>
      add(
        {
          kind: "chart",
          figure,
          sourceId: `${tool.id}:chart:${index}`,
          partial: result.status !== "ok",
        },
        figure.layout?.title?.text,
      ),
    );
  }
  return [...items.values()];
}

export type Artifact = {
  messageId?: string;
  rootSourceId?: string;
  threadId: string;
  threadTitle: string;
  createdAt: number;
  item: ResultItem;
};
