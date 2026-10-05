import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Columns2,
  GripVertical,
  Maximize2,
  Rows3,
} from "lucide-react";
import type { ToolStep } from "../types";
import { resultItems, type ResultItem, type SelectResult } from "../results";
import {
  defaultResultLayout,
  moveResult,
  orderedResults,
  readResultLayout,
  toggleResult,
  type ResultLayout,
} from "../resultLayout";
import { ResultTable } from "./ResultTable";
import { OpenArtifactButton, type ArtifactSource } from "./OpenArtifactButton";
const PlotlyChart = lazy(() => import("./PlotlyChart"));
const titleOf = (item: ResultItem) =>
  item.kind === "table"
    ? item.table.title
    : (item.figure.layout?.title?.text ?? "Chart");

export function ResultContent({
  item,
  onSelect,
  focused = false,
  height,
  fill = false,
}: {
  item: ResultItem;
  onSelect: SelectResult;
  focused?: boolean;
  height?: number;
  fill?: boolean;
}) {
  return item.kind === "table" ? (
    <ResultTable
      fill={fill}
      table={item.table}
      sourceId={item.sourceId}
      onSelect={onSelect}
      embedded
    />
  ) : (
    <Suspense
      fallback={
        <div className="grid h-72 place-items-center text-xs text-ink-3">
          Loading chart…
        </div>
      }
    >
      <PlotlyChart
        figure={item.figure}
        sourceId={item.sourceId}
        onSelect={onSelect}
        embedded
        focused={focused}
        height={height}
        fill={fill}
      />
    </Suspense>
  );
}

export function MessageResults({
  tools,
  onSelect,
  storageKey,
  artifactSource,
}: {
  tools: ToolStep[];
  onSelect: SelectResult;
  storageKey: string;
  artifactSource: ArtifactSource;
}) {
  const items = useMemo(() => resultItems(tools), [tools]);
  const [layout, setLayout] = useState<ResultLayout>(defaultResultLayout);
  const [loaded, setLoaded] = useState(false);
  const [drag, setDrag] = useState<{
    id: string;
    over: string | null;
    x: number;
    y: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const board = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const origin = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const dragTarget = useRef<string | null>(null);
  const key = `workbench.result-layout:${storageKey}`;
  useEffect(() => {
    try {
      setLayout(readResultLayout(localStorage.getItem(key)));
    } catch {
      setLayout(defaultResultLayout);
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(key, JSON.stringify(layout));
      } catch {
        /* Layout still works without storage. */
      }
  }, [key, layout, loaded]);
  const order = orderedResults(
    layout.order,
    items.map((item) => item.sourceId),
  );
  const byId = new Map(items.map((item) => [item.sourceId, item]));
  useLayoutEffect(() => {
    const host = board.current;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    host
      .querySelectorAll<HTMLElement>("[data-result-source]")
      .forEach((panel) => {
        const id = panel.dataset.resultSource!;
        const rect = panel.getBoundingClientRect();
        const position = {
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
        };
        const previous = positions.current.get(id);
        if (
          previous &&
          !reduced &&
          (previous.x !== position.x || previous.y !== position.y)
        ) {
          panel.animate(
            [
              {
                transform: `translate(${previous.x - position.x}px, ${previous.y - position.y}px)`,
              },
              { transform: "translate(0, 0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          );
        }
        next.set(id, position);
      });
    positions.current = next;
  }, [
    order.join("|"),
    layout.mode,
    layout.wide.join("|"),
    layout.collapsed.join("|"),
  ]);
  const sideBySide = items.length > 1 && layout.mode === "grid";
  const allCollapsed =
    !!items.length &&
    items.every((item) => layout.collapsed.includes(item.sourceId));
  const reorder = (source: string, target: string) => {
    setLayout((current) => ({
      ...current,
      order: moveResult(
        orderedResults(
          current.order,
          items.map((item) => item.sourceId),
        ),
        source,
        target,
      ),
    }));
    setAnnouncement(`Moved ${titleOf(byId.get(source)!)}.`);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = origin.current;
    if (!start) return;
    const x = event.clientX - start.x,
      y = event.clientY - start.y;
    if (!start.moved && Math.hypot(x, y) < 5) return;
    start.moved = true;
    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((el) => el.closest<HTMLElement>("[data-result-source]"))
      .find(
        (el) =>
          el &&
          board.current?.contains(el) &&
          el.dataset.resultSource !== start.id,
      );
    dragTarget.current = target?.dataset.resultSource ?? null;
    setDrag({ id: start.id, over: dragTarget.current, x, y });
  };
  const pointerEnd = (
    event: PointerEvent<HTMLButtonElement>,
    cancel = false,
  ) => {
    if (!cancel && origin.current?.moved && dragTarget.current)
      reorder(origin.current.id, dragTarget.current);
    origin.current = null;
    dragTarget.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!items.length) return null;
  return (
    <div
      className={`message-results @container/results mx-auto mt-7 w-full ${sideBySide ? "" : "max-w-[680px]"}`}
      aria-label="Results"
      ref={board}
    >
      <div className="mb-2 flex items-center justify-end gap-1">
        {items.length > 1 && (
          <div
            role="group"
            aria-label="Result layout"
            className="mr-1 flex rounded-lg bg-field p-0.5"
          >
            <button
              type="button"
              aria-label="Side-by-side results"
              title="Side by side"
              aria-pressed={layout.mode === "grid"}
              onClick={() =>
                setLayout((current) => ({ ...current, mode: "grid" }))
              }
              className={`layout-choice ${layout.mode === "grid" ? "is-active" : ""}`}
            >
              <Columns2 size={14} />
            </button>
            <button
              type="button"
              aria-label="Stacked results"
              title="Stacked"
              aria-pressed={layout.mode === "stack"}
              onClick={() =>
                setLayout((current) => ({ ...current, mode: "stack" }))
              }
              className={`layout-choice ${layout.mode === "stack" ? "is-active" : ""}`}
            >
              <Rows3 size={14} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() =>
            setLayout((current) => ({
              ...current,
              collapsed: allCollapsed ? [] : items.map((item) => item.sourceId),
            }))
          }
          className="rounded-md px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>
      <div
        className={`grid items-start gap-3 ${sideBySide ? "@min-[700px]/results:grid-cols-2" : "grid-cols-1"}`}
      >
        {order.map((id, index) => {
          const item = byId.get(id)!;
          const title = titleOf(item);
          const collapsed = layout.collapsed.includes(id),
            wide = layout.wide.includes(id);
          const moving = drag?.id === id,
            over = drag?.over === id;
          return (
            <section
              key={id}
              data-result-source={id}
              aria-label={title}
              className={`result-panel relative min-w-0 rounded-xl border bg-surface ${wide ? "col-span-full" : ""} ${moving ? "is-dragging z-20 border-accent-plum/40" : over ? "border-accent-plum ring-2 ring-accent-plum/15" : "border-line"}`}
              style={
                moving
                  ? {
                      transform: `translate(${drag.x}px, ${drag.y}px)`,
                      pointerEvents: "none",
                    }
                  : undefined
              }
            >
              <header className="flex min-h-11 items-center gap-1 px-2 py-1.5">
                {items.length > 1 && (
                  <button
                    type="button"
                    className="result-control cursor-grab touch-none select-none active:cursor-grabbing"
                    aria-label={`Move ${title}`}
                    title="Drag to move · arrow keys to reorder"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      origin.current = {
                        id,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                      };
                    }}
                    onPointerMove={pointerMove}
                    onPointerUp={(event) => pointerEnd(event)}
                    onPointerCancel={(event) => pointerEnd(event, true)}
                    onKeyDown={(event) => {
                      const direction =
                        event.key === "ArrowUp" || event.key === "ArrowLeft"
                          ? -1
                          : event.key === "ArrowDown" ||
                              event.key === "ArrowRight"
                            ? 1
                            : 0;
                      const target = order[index + direction];
                      if (direction) {
                        event.preventDefault();
                        if (target) reorder(id, target);
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
                  onClick={() =>
                    setLayout((current) => ({
                      ...current,
                      collapsed: toggleResult(current.collapsed, id),
                    }))
                  }
                  className="min-w-0 flex-1 justify-start gap-2 rounded px-1 py-1 text-left text-[13px] font-medium text-ink"
                >
                  <ChevronDown
                    size={13}
                    className={`shrink-0 text-ink-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                  />
                  <span className="truncate" title={title}>
                    {title}
                  </span>
                </button>
                {layout.mode === "grid" && items.length > 1 && (
                  <button
                    type="button"
                    className="result-control hidden @min-[700px]/results:inline-flex"
                    aria-label={`${wide ? "Narrow" : "Widen"} ${title}`}
                    title={wide ? "Half width" : "Full width"}
                    aria-pressed={wide}
                    onClick={() =>
                      setLayout((current) => ({
                        ...current,
                        wide: toggleResult(current.wide, id),
                      }))
                    }
                  >
                    <ArrowLeftRight size={14} />
                  </button>
                )}
                <OpenArtifactButton
                  source={artifactSource}
                  sourceId={item.sourceId}
                  className="result-control"
                  aria-label={`Open artifact: ${title}`}
                  title="Open chart and chat"
                >
                  <Maximize2 size={14} />
                </OpenArtifactButton>
              </header>
              <div
                className={`collapsible-content ${collapsed ? "is-collapsed" : ""}`}
                inert={collapsed}
                aria-hidden={collapsed}
              >
                <div className="min-h-0 overflow-hidden">
                  {item.partial && (
                    <p className="px-4 pb-2 text-xs text-ink-3">
                      Partial result from a cell that did not finish.
                    </p>
                  )}
                  <ResultContent item={item} onSelect={onSelect} />
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
