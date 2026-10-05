import { z } from "zod";

export const notebookInput = z.object({
  code: z.string().trim().min(1).max(12000),
  timeoutMs: z.number().int().min(1000).max(90000).default(30000),
});

// A deliberately data-only subset. No HTML, remote images, URLs, transforms,
// map tiles, executable JS, or Plotly configuration supplied by the model.
const text = z
  .string()
  .max(500)
  .transform((s) => s.replace(/[<>]/g, ""));
const number = z.number().finite();
const values = z.array(z.union([number, text, z.null()])).max(5000);
const color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24}|rgba?\([\d.,% ]+\))$/);
const xAxisRef = z.enum(["x", "x2", "x3", "x4"]);
const yAxisRef = z.enum(["y", "y2", "y3", "y4"]);
const axis = z.object({
  title: z.object({ text }).optional(),
  type: z.enum(["linear", "log", "date", "category"]).optional(),
  range: z
    .array(z.union([number, text]))
    .length(2)
    .optional(),
  tickformat: text.optional(),
  showgrid: z.boolean().optional(),
  zeroline: z.boolean().optional(),
  domain: z.tuple([number.min(0).max(1), number.min(0).max(1)]).optional(),
  anchor: z.union([xAxisRef, yAxisRef, z.literal("free")]).optional(),
  overlaying: z
    .union([xAxisRef, yAxisRef, z.literal(false)])
    .transform((value) => (value === false ? undefined : value))
    .optional(),
  matches: z
    .union([xAxisRef, yAxisRef, z.null()])
    .transform((value) => value ?? undefined)
    .optional(),
  side: z.enum(["top", "bottom", "left", "right"]).optional(),
  showticklabels: z.boolean().optional(),
});
export const plotlyFigure = z.object({
  data: z
    .array(
      z.object({
        type: z.enum(["scatter", "bar", "histogram", "box", "heatmap"]),
        name: text.optional(),
        xaxis: xAxisRef.optional(),
        yaxis: yAxisRef.optional(),
        showlegend: z.boolean().optional(),
        legendgroup: text.optional(),
        x: values.optional(),
        y: values.optional(),
        z: z
          .array(z.array(z.union([number, z.null()])).max(200))
          .max(200)
          .optional(),
        text: z.union([text, z.array(text).max(5000)]).optional(),
        mode: z
          .enum([
            "lines",
            "markers",
            "lines+markers",
            "text",
            "lines+text",
            "markers+text",
            "lines+markers+text",
            "none",
          ])
          .optional(),
        orientation: z.enum(["h", "v"]).optional(),
        marker: z
          .object({
            color: z.union([color, z.array(color).max(5000)]).optional(),
            size: number.min(1).max(40).optional(),
          })
          .optional(),
        line: z
          .object({
            color: color.optional(),
            width: number.min(0).max(10).optional(),
            shape: z
              .enum(["linear", "spline", "hv", "vh", "hvh", "vhv"])
              .optional(),
          })
          .optional(),
        opacity: number.min(0).max(1).optional(),
        fill: z
          .enum([
            "none",
            "tozeroy",
            "tozerox",
            "tonexty",
            "tonextx",
            "toself",
            "tonext",
          ])
          .optional(),
        nbinsx: number.int().min(1).max(200).optional(),
        nbinsy: number.int().min(1).max(200).optional(),
        histnorm: z
          .enum([
            "",
            "percent",
            "probability",
            "density",
            "probability density",
          ])
          .optional(),
        colorscale: z
          .enum([
            "Viridis",
            "Blues",
            "Greens",
            "Reds",
            "RdBu",
            "Cividis",
            "Plasma",
          ])
          .optional(),
      }),
    )
    .min(1)
    .max(20),
  layout: z
    .object({
      title: z.object({ text }).optional(),
      xaxis: axis.optional(),
      yaxis: axis.optional(),
      xaxis2: axis.optional(),
      yaxis2: axis.optional(),
      xaxis3: axis.optional(),
      yaxis3: axis.optional(),
      xaxis4: axis.optional(),
      yaxis4: axis.optional(),
      annotations: z
        .array(
          z.object({
            text,
            x: number.min(-1).max(2),
            y: number.min(-1).max(2),
            xref: z.literal("paper"),
            yref: z.literal("paper"),
            xanchor: z.enum(["auto", "left", "center", "right"]).optional(),
            yanchor: z.enum(["auto", "top", "middle", "bottom"]).optional(),
            showarrow: z.literal(false),
          }),
        )
        .max(8)
        .optional(),
      barmode: z.enum(["group", "stack", "relative", "overlay"]).optional(),
      showlegend: z.boolean().optional(),
      bargap: number.min(0).max(1).optional(),
    })
    .optional(),
});
export type PlotlyFigure = z.infer<typeof plotlyFigure>;
export const resultTable = z
  .object({
    title: z.string().max(160),
    columns: z.array(z.string().max(80)).min(1).max(20),
    rows: z
      .array(
        z
          .array(z.union([z.string().max(500), number, z.boolean(), z.null()]))
          .max(20),
      )
      .max(200),
    totalRows: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
  })
  .refine(
    (table) => table.rows.every((row) => row.length === table.columns.length),
    "Table cells must match columns.",
  );
export type ResultTable = z.infer<typeof resultTable>;
export const notebookResult = z.object({
  status: z.enum(["ok", "error", "timeout"]),
  executionCount: z.number().int().nonnegative(),
  stdout: z.string().max(12000),
  stderr: z.string().max(12000),
  text: z.string().max(12000),
  charts: z.array(plotlyFigure).max(4),
  tables: z.array(resultTable).max(4).default([]),
  replacesPreviousResults: z.boolean().default(false),
  chartWarnings: z.array(z.string().max(500)).max(5),
  outputTruncated: z.boolean(),
  kernelReset: z.boolean(),
  durationMs: number.nonnegative(),
});
export type NotebookResult = z.infer<typeof notebookResult>;

export function parseNotebookResult(raw: string): NotebookResult {
  if (raw.length > 300000) throw new Error("Notebook output exceeds limit.");
  const output = JSON.parse(raw);
  // The preloaded helper works with existing live kernels as well as snapshots.
  // Interpret only validated, bounded data; never render guest-supplied HTML.
  const tables = Array.isArray(output.tables) ? output.tables : [];
  if (typeof output.stdout === "string") {
    output.stdout = output.stdout
      .split("\n")
      .filter((line: string) => {
        if (line === "__WORKBENCH_REPLACE_RESULTS__") {
          output.replacesPreviousResults = true;
          return false;
        }
        if (!line.startsWith("__WORKBENCH_TABLE__")) return true;
        try {
          const parsed = resultTable.safeParse(JSON.parse(line.slice(19)));
          if (parsed.success && tables.length < 4) {
            tables.push(parsed.data);
            return false;
          }
        } catch {
          /* A truncated table must not become a misleading partial table. */
        }
        output.outputTruncated = true;
        return false;
      })
      .join("\n");
  }
  output.tables = tables;
  // Keep valid text even when a chart exceeds our supported JSON subset.
  if (Array.isArray(output.charts)) {
    const warnings = Array.isArray(output.chartWarnings)
      ? output.chartWarnings
      : [];
    output.charts = output.charts.slice(0, 4).flatMap((chart: unknown) => {
      // Dropping an unknown axis would silently move its traces onto another
      // plot. Reject unsupported layouts instead of displaying misleading data.
      const layout = (chart as { layout?: Record<string, unknown> } | null)
        ?.layout;
      if (
        layout &&
        Object.keys(layout).some(
          (key) => /^[xy]axis\d+$/.test(key) && !/^[xy]axis[2-4]$/.test(key),
        )
      ) {
        warnings.push(
          "Use separate figures or at most four Cartesian subplots per figure.",
        );
        return [];
      }
      const parsed = plotlyFigure.safeParse(chart);
      if (parsed.success && JSON.stringify(parsed.data).length <= 60000)
        return [parsed.data];
      warnings.push(
        "A chart could not be displayed. Use bounded arrays and supported Plotly traces: scatter, bar, histogram, box, heatmap.",
      );
      return [];
    });
    output.chartWarnings = warnings.slice(0, 5);
  }
  return notebookResult.parse(output);
}
