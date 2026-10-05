import { type ResultTable, type PlotlyFigure } from "../convex/lib/notebook";
import {
  resultSelection,
  type ResultSelection,
} from "../convex/lib/resultSelection";
import type { Message } from "./types";

export type Cell = string | number | boolean | null;
export type SelectResult = (selection: ResultSelection) => void;
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
function numeric(value: Cell) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[$€£,%]/g, "");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}
export function sortedRows(
  rows: Cell[][],
  column: number | null,
  direction: "asc" | "desc",
) {
  const indexed = rows.map((cells, index) => ({ cells, index }));
  if (column === null) return indexed;
  return indexed.sort((a, b) => {
    const av = a.cells[column],
      bv = b.cells[column];
    // Missing values stay last in either direction. Ties retain source order.
    if (av === null || av === undefined || av === "")
      return bv === null || bv === undefined || bv === ""
        ? a.index - b.index
        : 1;
    if (bv === null || bv === undefined || bv === "") return -1;
    const an = numeric(av),
      bn = numeric(bv);
    const result =
      an !== null && bn !== null
        ? an - bn
        : collator.compare(String(av), String(bv));
    return result ? result * (direction === "asc" ? 1 : -1) : a.index - b.index;
  });
}
export function selectionFor(
  kind: ResultSelection["kind"],
  label: string,
  sourceId: string,
  details: object,
): ResultSelection {
  let contextJson = JSON.stringify(details);
  // Bounds apply after JSON escaping, including pasted logs and traceback code.
  let stringLimit = 240;
  let itemLimit = 10;
  for (let attempt = 0; contextJson.length > 5800 && attempt < 8; attempt++) {
    const compact = (value: unknown): unknown =>
      typeof value === "string"
        ? value.slice(0, stringLimit)
        : Array.isArray(value)
          ? value.slice(0, itemLimit).map(compact)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([key, child]) => [
                  key,
                  compact(child),
                ]),
              )
            : value;
    contextJson = JSON.stringify({
      ...(compact(details) as object),
      truncated: true,
    });
    stringLimit = Math.max(1, Math.floor(stringLimit / 2));
    itemLimit = Math.max(1, Math.floor(itemLimit / 2));
  }
  if (contextJson.length > 5800)
    contextJson = JSON.stringify({
      excerpt: contextJson.slice(0, 1200),
      truncated: true,
    });
  return resultSelection.parse({
    kind,
    label: label.slice(0, 160),
    sourceId: sourceId.slice(0, 200),
    contextJson,
  });
}
export function tableSelection(
  table: ResultTable,
  indexes: number[],
  sourceId: string,
) {
  const columns = table.columns.slice(0, 12);
  const rows = indexes
    .filter((index) => !!table.rows[index])
    .slice(0, 5)
    .map((index) => ({
      row: index + 1,
      values: table.rows[index]
        .slice(0, 12)
        .map((value) =>
          typeof value === "string" ? value.slice(0, 160) : value,
        ),
    }));
  const details = {
    title: table.title,
    columns,
    rows,
    selectedCount: indexes.length,
    truncated:
      rows.length !== indexes.length ||
      columns.length !== table.columns.length ||
      rows.some((row) =>
        row.values.some((value, i) => value !== table.rows[row.row - 1][i]),
      ),
  };
  while (JSON.stringify(details).length > 5800 && rows.length > 1) {
    rows.pop();
    details.truncated = true;
  }
  return selectionFor(
    "table",
    `${table.title} · ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    sourceId,
    details,
  );
}
export function chartTable(figure: PlotlyFigure): ResultTable {
  const rows: Cell[][] = [];
  let totalRows = 0;
  const heatmap = figure.data.some((trace) => trace.type === "heatmap");
  for (const [i, trace] of figure.data.entries()) {
    if (trace.type === "heatmap" && trace.z) {
      for (const [y, values] of trace.z.entries())
        for (const [x, value] of values.entries()) {
          if (rows.length < 200)
            rows.push([
              trace.name || `Series ${i + 1}`,
              trace.x?.[x] ?? x,
              trace.y?.[y] ?? y,
              value,
            ]);
          totalRows++;
        }
      continue;
    }
    const length = Math.max(trace.x?.length ?? 0, trace.y?.length ?? 0);
    for (let point = 0; point < length; point++) {
      if (rows.length < 200)
        rows.push([
          trace.name || `Series ${i + 1}`,
          trace.x?.[point] ?? null,
          trace.y?.[point] ?? null,
          ...(heatmap ? [null] : []),
        ]);
      totalRows++;
    }
  }
  return {
    title: figure.layout?.title?.text ?? "Chart data",
    columns: ["Series", "X", "Y", ...(heatmap ? ["Value"] : [])],
    rows,
    totalRows,
    truncated: totalRows > rows.length,
  };
}

export { resultItems, type ResultItem } from "../convex/lib/artifacts";
export function nextPrompts(message: Message): string[] {
  const tools = message.tools ?? [];
  const text = message.text.toLowerCase();
  const outputs = tools.map(({ output }) =>
    output && typeof output === "object"
      ? (output as { charts?: unknown; status?: unknown })
      : undefined,
  );
  const charts = outputs.some(
    (output) => Array.isArray(output?.charts) && output.charts.length > 0,
  );
  const failed =
    tools.some((tool) => tool.state === "output-error") ||
    outputs.some(
      (output) => output?.status === "error" || output?.status === "timeout",
    );
  const errorEvidence = /\b(error|failed|failure|timeout|exception)\b/.test(
    text,
  );
  if (charts)
    return [
      "Investigate the biggest change",
      "Show the underlying records",
      "Compare with the previous period",
    ];
  if (errorEvidence || failed)
    return [
      "Investigate the failures",
      "Show errors over time",
      "Which functions are affected?",
    ];
  if (/\b(table|customer|order|user|record)\b/.test(text))
    return [
      "Show this over time",
      "Break this down by status",
      "What stands out?",
    ];
  return ["Show the supporting data", "What should I investigate next?"];
}
