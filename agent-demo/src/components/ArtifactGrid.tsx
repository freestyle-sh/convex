import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, GripVertical, Pin } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Artifact } from "../../convex/lib/artifacts";
import type { Project } from "../types";
import {
  artifactId,
  artifactSourceId,
  artifactTitle,
  artifactOrder,
  moveArtifact,
  readArtifactLayout,
  type ArtifactLayout,
} from "../artifactLayout";
import { OpenArtifactButton } from "./OpenArtifactButton";

const PlotlyChart = lazy(() => import("./PlotlyChart"));
const control =
  "grid size-7 place-items-center rounded-md bg-surface/95 text-ink-3 shadow-sm hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-plum";
export function ArtifactGrid({
  token,
  project,
}: {
  token: string;
  project: Project;
}) {
  const args = { token, projectId: project._id as Id<"projects"> };
  const recent = useQuery(api.artifacts.recent, args);
  const pinned = useQuery(api.artifacts.pinned, args);
  const setPinned = useMutation(api.artifacts.setPinned);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<ArtifactLayout>(() =>
    readArtifactLayout(null),
  );
  const [loaded, setLoaded] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const section = useRef<HTMLElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    over: string | null;
    x: number;
    y: number;
  } | null>(null);
  const origin = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const target = useRef<string | null>(null);
  const key = `workbench.artifact-layout:${project._id}`;
  useEffect(() => {
    try {
      setLayout(readArtifactLayout(localStorage.getItem(key)));
    } catch {
      /* Optional browser preference. */
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(key, JSON.stringify(layout));
      } catch {
        /* Layout still works without browser storage. */
      }
  }, [key, layout, loaded]);
  const byId = new Map(
    [...(pinned ?? []), ...(recent ?? [])].map((a) => [artifactId(a), a]),
  );
  const pins = (pinned ?? []).map(artifactId);
  const order = artifactOrder(layout, [...byId.keys()], pins);
  async function togglePin(artifact: Artifact) {
    if (pinning) return;
    setPinning(true);
    setError("");
    const isPinned = pins.includes(artifactId(artifact));
    try {
      await setPinned({
        ...args,
        threadId: artifact.threadId,
        sourceId: artifactSourceId(artifact),
        pinned: !isPinned,
      });
      setAnnouncement(
        `${isPinned ? "Unpinned" : "Pinned"} ${artifactTitle(artifact)}.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save the pin. Try again.",
      );
    } finally {
      setPinning(false);
    }
  }
  const reorder = (source: string, destination: string) => {
    if (pins.includes(source) !== pins.includes(destination)) {
      setAnnouncement(
        "Pinned artifacts stay first. Move within the same group.",
      );
      return;
    }
    setLayout((current) =>
      moveArtifact(current, order, pins, source, destination),
    );
    setAnnouncement(`Moved ${artifactTitle(byId.get(source)!)}.`);
  };
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = origin.current;
    if (!start) return;
    const x = event.clientX - start.x,
      y = event.clientY - start.y;
    if (!start.moved && Math.hypot(x, y) < 5) return;
    start.moved = true;
    const over = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((el) => el.closest<HTMLElement>("[data-artifact-id]"))
      .find(
        (el) =>
          el &&
          board.current?.contains(el) &&
          el.dataset.artifactId !== start.id,
      );
    target.current = over?.dataset.artifactId ?? null;
    setDrag({ id: start.id, over: target.current, x, y });
  };
  const pointerEnd = (
    event: PointerEvent<HTMLButtonElement>,
    cancel = false,
  ) => {
    if (!cancel && origin.current?.moved && target.current)
      reorder(origin.current.id, target.current);
    origin.current = null;
    target.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!byId.size) return null;
  return (
    <section
      ref={section}
      className="@container/artifacts mt-6"
      aria-label="Artifacts"
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-xs text-red-600">
          {error}
        </p>
      )}
      <div
        ref={board}
        id="artifact-grid"
        className="grid grid-cols-1 gap-3 @min-[440px]/artifacts:grid-cols-2 @min-[780px]/artifacts:grid-cols-3"
      >
        {order.map((id) => {
          const artifact = byId.get(id)!,
            { item } = artifact,
            title = artifactTitle(artifact),
            isPinned = pins.includes(id);
          return (
            <article
              key={id}
              data-artifact-id={id}
              className={`group relative min-w-0 rounded-xl border bg-surface transition-[border-color,box-shadow] ${drag?.over === id ? "border-accent-plum ring-2 ring-accent-plum/20" : "border-line hover:border-accent-plum/30"} ${drag?.id === id ? "z-10 shadow-xl" : ""}`}
              style={
                drag?.id === id
                  ? {
                      transform: `translate(${drag.x}px, ${drag.y}px)`,
                      pointerEvents: "none",
                    }
                  : undefined
              }
            >
              <div className="absolute top-2 right-2 z-10 flex gap-1 rounded-lg opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                  type="button"
                  aria-label={`Move artifact: ${title}`}
                  title="Drag to reorder · arrow keys to move"
                  className={`${control} cursor-grab touch-none active:cursor-grabbing`}
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
                  onLostPointerCapture={() => {
                    origin.current = null;
                    target.current = null;
                    setDrag(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      origin.current = null;
                      target.current = null;
                      setDrag(null);
                      return;
                    }
                    if (
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const group = order.filter(
                        (value) => pins.includes(value) === isPinned,
                      ),
                      index = group.indexOf(id),
                      next =
                        group[
                          index +
                            (["ArrowLeft", "ArrowUp"].includes(event.key)
                              ? -1
                              : 1)
                        ];
                    if (next) reorder(id, next);
                  }}
                >
                  <GripVertical size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`${isPinned ? "Unpin" : "Pin"} artifact: ${title}`}
                  title={isPinned ? "Unpin" : "Pin"}
                  aria-pressed={isPinned}
                  disabled={pinning}
                  onClick={() => void togglePin(artifact)}
                  className={`${control} ${isPinned ? "text-accent-plum" : ""}`}
                >
                  <Pin size={13} fill={isPinned ? "currentColor" : "none"} />
                </button>
              </div>
              <OpenArtifactButton
                source={{
                  projectId: project._id,
                  threadId: artifact.threadId,
                  messageId: artifact.messageId,
                }}
                sourceId={artifactSourceId(artifact)}
                type="button"
                aria-label={`Open artifact: ${title}`}
                className="flex w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-xl text-left"
              >
                <ArtifactPreview item={item} />
                <div className="flex min-w-0 items-start gap-3 px-3.5 pt-3 pb-3.5">
                  <div className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px] leading-5 font-medium text-ink">
                      {title}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] font-normal text-ink-3">
                      {isPinned && (
                        <Pin
                          size={10}
                          className="shrink-0 text-accent-plum"
                          fill="currentColor"
                        />
                      )}
                      {item.kind === "chart"
                        ? "Chart"
                        : `Table · ${item.table.totalRows ?? item.table.rows.length} ${(item.table.totalRows ?? item.table.rows.length) === 1 ? "row" : "rows"}`}
                      {item.partial ? " · Partial" : ""} ·{" "}
                      {new Date(artifact.createdAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}
                    </span>
                  </div>
                  <ArrowUpRight
                    size={14}
                    className="mt-1 shrink-0 text-ink-3 transition-colors group-hover:text-accent-plum"
                  />
                </div>
              </OpenArtifactButton>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ArtifactPreview({ item }: { item: Artifact["item"] }) {
  return (
    <div
      className="pointer-events-none h-[164px] w-full overflow-hidden border-b border-line/70 bg-white p-1.5"
      aria-hidden="true"
    >
      {item.kind === "chart" ? (
        <Suspense
          fallback={
            <div className="h-full rounded-lg bg-field/50 motion-safe:animate-pulse" />
          }
        >
          <PlotlyChart figure={item.figure} preview />
        </Suspense>
      ) : (
        <div className="overflow-hidden rounded border border-line/70">
          <div
            className="grid bg-field/70"
            style={{
              gridTemplateColumns: `repeat(${Math.min(3, item.table.columns.length)}, minmax(0, 1fr))`,
            }}
          >
            {item.table.columns.slice(0, 3).map((column, index) => (
              <span
                key={index}
                className="truncate border-b border-line px-2 py-2 text-[10px] font-medium text-ink-2"
              >
                {column}
              </span>
            ))}
          </div>
          {item.table.rows.slice(0, 4).map((row, index) => (
            <div
              key={index}
              className="grid border-b border-line/60 last:border-0"
              style={{
                gridTemplateColumns: `repeat(${Math.min(3, item.table.columns.length)}, minmax(0, 1fr))`,
              }}
            >
              {row.slice(0, 3).map((value, column) => (
                <span
                  key={column}
                  className="truncate px-2 py-2 text-[10px] font-normal text-ink-3"
                >
                  {value == null ? "—" : String(value)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
