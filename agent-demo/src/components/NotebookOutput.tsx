import { lazy, Suspense, useMemo } from "react";
import { notebookResult } from "../../convex/lib/notebook";
import { JsonOutput } from "./JsonOutput";
import { ResultTable } from "./ResultTable";
import type { SelectResult } from "../results";
const PlotlyChart = lazy(() => import("./PlotlyChart"));

export function NotebookOutput({
  output,
  display = "all",
  sourceId = "notebook",
  onSelect,
}: {
  output: unknown;
  display?: "all" | "text" | "charts";
  sourceId?: string;
  onSelect?: SelectResult;
}) {
  const parsed = useMemo(() => notebookResult.safeParse(output), [output]);
  if (!parsed.success) return null;
  const result = parsed.data;
  const showText = display !== "charts";
  const showCharts = display !== "text";
  if (
    display === "charts" &&
    !result.charts.length &&
    !result.tables.length &&
    !result.chartWarnings.length
  )
    return null;
  return (
    <div className="space-y-3">
      {showText &&
        [result.stdout, result.text].filter(Boolean).map((text, index) => (
          <pre
            key={index}
            className="max-h-72 overflow-auto rounded-lg bg-field p-4 text-xs leading-5 whitespace-pre-wrap text-ink-2"
          >
            <JsonOutput text={text} />
          </pre>
        ))}
      {showText && result.stderr && (
        <pre className="max-h-64 overflow-auto rounded-lg border border-red-100 bg-red-50 p-4 text-xs leading-5 whitespace-pre-wrap text-red-700">
          <JsonOutput text={result.stderr} />
        </pre>
      )}
      {showCharts &&
        result.tables.map((table, index) => (
          <ResultTable
            key={`table-${index}`}
            table={table}
            sourceId={`${sourceId}:table:${index}`}
            onSelect={onSelect}
          />
        ))}
      {showCharts &&
        result.charts.map((figure, index) => (
          <Suspense
            key={index}
            fallback={
              <div className="flex h-80 items-center justify-center rounded-xl border border-line text-sm text-ink-3">
                Loading chart…
              </div>
            }
          >
            <PlotlyChart
              figure={figure}
              sourceId={`${sourceId}:chart:${index}`}
              onSelect={onSelect}
            />
          </Suspense>
        ))}
      {showText &&
        result.chartWarnings.map((warning, index) => (
          <p key={index} className="text-xs text-amber-700">
            {warning}
          </p>
        ))}
      {showText && result.outputTruncated && (
        <p className="text-xs text-ink-3">Cell output was truncated.</p>
      )}
      {showText && result.kernelReset && (
        <p className="text-xs text-ink-3">
          The cell timed out. The next cell will start a fresh notebook.
        </p>
      )}
    </div>
  );
}
