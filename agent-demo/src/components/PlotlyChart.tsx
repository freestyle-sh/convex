import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-cartesian-dist-min";
import type { PlotlyFigure } from "../../convex/lib/notebook";
import { appName } from "../brand";
import { SelectionActions } from "./SelectionActions";
import { chartTable, selectionFor, type SelectResult } from "../results";
import { ResultTable } from "./ResultTable";
import { styleChart } from "../chartStyle";

type Point = {
  series: string;
  x: string | number | null;
  y: string | number | null;
  z?: string | number | null;
  trace: number;
  xAxis: string;
  yAxis: NonNullable<PlotlyFigure["data"][number]["yaxis"]>;
  point: number | number[];
};
const scalar = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : value == null
      ? null
      : String(value).slice(0, 120);
export default function PlotlyChart({
  figure,
  sourceId = "chart",
  onSelect,
  embedded = false,
  focused = false,
  height,
  preview = false,
  fill = false,
}: {
  figure: PlotlyFigure;
  sourceId?: string;
  onSelect?: SelectResult;
  embedded?: boolean;
  focused?: boolean;
  height?: number;
  preview?: boolean;
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"chart" | "data">("chart");
  const [points, setPoints] = useState<Point[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const title = figure.layout?.title?.text ?? "Chart";
  const selectedPoint = points.length === 1 ? points[0] : undefined;
  const selectedAxis = selectedPoint
    ? {
        y: figure.layout?.yaxis,
        y2: figure.layout?.yaxis2,
        y3: figure.layout?.yaxis3,
        y4: figure.layout?.yaxis4,
      }[selectedPoint.yAxis]
    : undefined;
  const selectedMetric = selectedPoint
    ? figure.data[selectedPoint.trace]?.name?.trim() ||
      (figure.data.length > 1
        ? selectedPoint.series
        : selectedAxis?.title?.text)
    : undefined;
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // Each effect owns a node, so late Plotly promises cannot purge a newer
    // render during StrictMode remounts or streaming message updates.
    const element = document.createElement("div");
    element.style.width = "100%";
    if (fill) element.style.height = "100%";
    host.replaceChildren(element);
    plotRef.current = element;
    let active = true;
    let ready = false;
    setError(false);
    const { data, layout } = styleChart(figure, {
      preview,
      embedded,
      focused,
      fill,
      height,
    });
    // Plotly can mutate its inputs. Give it an isolated, validated copy.
    void Plotly.newPlot(element, data, layout, {
      responsive: true,
      displaylogo: false,
      displayModeBar: preview ? false : "hover",
      staticPlot: preview,
      scrollZoom: false,
      modeBarButtonsToRemove: ["sendDataToCloud", "sendChartToCloud"],
      toImageButtonOptions: {
        format: "png",
        filename: "convex-monitor-chart",
        scale: 2,
        width: 1000,
        height: 600,
      },
    })
      .then((plot) => {
        if (!active) Plotly.purge(element);
        else {
          ready = true;
          const selectPoints = (
            event: Pick<Plotly.PlotMouseEvent, "points">,
          ) => {
            const picked = event?.points ?? [];
            setPointCount(picked.length);
            setPoints(
              picked.slice(0, 10).map((point) => ({
                series: String(
                  point.data.name || `Series ${point.curveNumber + 1}`,
                ).slice(0, 80),
                x: scalar(point.x),
                y: scalar(point.y),
                ...("z" in point ? { z: scalar(point.z) } : {}),
                trace: point.curveNumber,
                xAxis: figure.data[point.curveNumber]?.xaxis ?? "x",
                yAxis: figure.data[point.curveNumber]?.yaxis ?? "y",
                point: point.pointNumber,
              })),
            );
          };
          if (!preview) {
            plot.on("plotly_click", selectPoints);
            plot.on("plotly_selected", selectPoints);
            plot.on("plotly_deselect", () => {
              setPoints([]);
              setPointCount(0);
            });
          }
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    const observer = new ResizeObserver(() => {
      if (
        !active ||
        !ready ||
        !element.isConnected ||
        !host.clientWidth ||
        !host.clientHeight
      )
        return;
      // Plotly resizes asynchronously; a card may be collapsed or its chat
      // unmounted before that resize settles.
      void Promise.resolve(Plotly.Plots.resize(element)).catch(() => {
        if (
          active &&
          element.isConnected &&
          host.clientWidth &&
          host.clientHeight
        )
          setError(true);
      });
    });
    observer.observe(host);
    return () => {
      active = false;
      observer.disconnect();
      Plotly.purge(element);
      element.remove();
      if (plotRef.current === element) plotRef.current = null;
    };
  }, [figure, view, embedded, focused, preview, height, fill]);
  if (preview)
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className="workbench-chart h-[152px] w-full overflow-hidden"
      />
    );
  return (
    <figure
      className={`workbench-chart min-w-0 overflow-hidden ${fill ? "flex h-full min-h-0 flex-col" : ""} ${embedded ? "" : "rounded-xl border border-line bg-surface"}`}
    >
      <div className="flex shrink-0 items-center justify-end gap-3 px-1 pb-2 text-[11px] text-ink-3">
        <div
          className="flex gap-0.5 rounded-lg bg-field/60 p-0.5"
          role="group"
          aria-label="Chart view"
        >
          {(["chart", "data"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`min-h-8 rounded-md px-3 py-1 capitalize transition-colors ${view === value ? "bg-surface font-medium text-ink ring-1 ring-line/70" : "hover:text-ink"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      {view === "data" ? (
        <div className={fill ? "min-h-0 flex-1" : "p-2"}>
          <ResultTable
            table={chartTable(figure)}
            sourceId={sourceId}
            onSelect={onSelect}
            embedded
            fill={fill}
            rowLabelColumn={1}
          />
        </div>
      ) : (
        <>
          <div
            ref={ref}
            role="img"
            aria-label={
              figure.layout?.title?.text ??
              `Interactive chart generated by ${appName}`
            }
            className={fill ? "min-h-0 w-full flex-1" : "w-full"}
          />
          {!!points.length && onSelect && (
            <div className="shrink-0 px-1 pt-2 pb-1">
              <SelectionActions
                label={
                  selectedPoint ? (
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-ink-3 tabular-nums">
                        {selectedPoint.x ?? "—"}
                      </span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <strong className="font-semibold text-ink tabular-nums">
                          {selectedPoint.y ?? "—"}
                        </strong>
                        {selectedMetric && (
                          <span className="ml-1.5">{selectedMetric}</span>
                        )}
                      </span>
                    </span>
                  ) : (
                    `${pointCount} points selected`
                  )
                }
                clearLabel="Clear chart selection"
                investigate={() =>
                  onSelect(
                    selectionFor(
                      "chart",
                      `${title} · ${pointCount} point${pointCount === 1 ? "" : "s"}`,
                      sourceId,
                      {
                        title,
                        xAxis: figure.layout?.xaxis?.title?.text,
                        yAxis: figure.layout?.yaxis?.title?.text,
                        points,
                        selectedCount: pointCount,
                        truncated: pointCount > points.length,
                      },
                    ),
                  )
                }
                clear={() => {
                  setPoints([]);
                  setPointCount(0);
                  if (plotRef.current)
                    void Plotly.restyle(plotRef.current, {
                      selectedpoints: null,
                    }).catch(() => {});
                }}
              />
            </div>
          )}
        </>
      )}
      {error && (
        <figcaption role="alert" className="px-4 pb-4 text-sm text-red-600">
          This chart could not be rendered.
        </figcaption>
      )}
    </figure>
  );
}
