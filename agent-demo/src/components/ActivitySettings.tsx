import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
} from "lucide-react";
import { inspectorCells } from "../inspector";
import { selectionFor, type SelectResult } from "../results";
import type { Conversation, Detail, Message, Project } from "../types";
import { PermissionRequests } from "./PermissionRequests";

const dateTime = (value: number) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const statusLabel = (state: string) =>
  ({
    complete: "Complete",
    running: "Running",
    queued: "Queued",
    failed: "Failed",
    cancelled: "Stopped",
    idle: "Idle",
  })[state] ?? state.replaceAll("_", " ");
const stateColor = (state: string) =>
  state === "failed"
    ? "bg-red-500"
    : state === "running" || state === "queued"
      ? "bg-accent-plum"
      : state === "complete"
        ? "bg-emerald-500"
        : "bg-zinc-400";
function Section({
  title,
  count,
  children,
  open = false,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      className="group/section border-b border-line last:border-0"
      open={open}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-xs font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDown
          size={12}
          className="-rotate-90 text-ink-3 transition-transform group-open/section:rotate-0"
        />
        <span className="flex-1">{title}</span>
        {count !== undefined && (
          <span className="font-normal text-ink-3 tabular-nums">{count}</span>
        )}
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

export function ActivitySettings({
  project,
  conversation,
  messages,
  detail,
  decide,
  onSelect,
}: {
  project?: Project;
  conversation?: Conversation;
  messages: Message[];
  detail: Detail;
  decide: (id: string, approve: boolean) => Promise<void>;
  onSelect: SelectResult;
}) {
  const [allRuns, setAllRuns] = useState(false);
  const [errorLogsOnly, setErrorLogsOnly] = useState(true);
  const [allLogs, setAllLogs] = useState(false);
  const [copied, setCopied] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const cells = useMemo(() => inspectorCells(messages), [messages]);
  const runs = useMemo(
    () => [...detail.runs].sort((a, b) => b.startedAt - a.startedAt),
    [detail.runs],
  );
  const pending = detail.proposals.filter(
    (p) =>
      p.state === "pending" &&
      p.expiresAt > now &&
      p.policyVersion === project?.policyVersion,
  ).length;
  const errorLogs = detail.logs.filter((log) =>
    /^(error|critical|fatal)$/i.test(log.level),
  );
  const logs = errorLogsOnly ? errorLogs : detail.logs;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3 text-xs">
        <span
          className="min-w-0 truncate font-medium"
          title={conversation?.title ?? project?.name}
        >
          {conversation?.title ?? project?.name}
        </span>
        {cells.total > 0 && (
          <span
            className="shrink-0 text-ink-3"
            title="Notebook cells in loaded messages"
          >
            {cells.total} cells
            {cells.failed > 0 && (
              <span className="text-red-600"> · {cells.failed} failed</span>
            )}
          </span>
        )}
      </div>
      {detail.proposals.length > 0 && (
        <Section
          title="Approvals"
          count={pending || undefined}
          open={pending > 0}
        >
          <PermissionRequests
            proposals={detail.proposals}
            project={project}
            busy={deciding}
            decide={async (id, approve) => {
              setDeciding(true);
              setApprovalError("");
              try {
                await decide(id, approve);
              } catch {
                setApprovalError(
                  "Could not update this request. It may have expired or already been handled.",
                );
              } finally {
                setDeciding(false);
              }
            }}
          />
          {approvalError && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {approvalError}
            </p>
          )}
        </Section>
      )}
      <Section
        title="Recent runs"
        count={runs.length}
        open={!pending && !errorLogs.length}
      >
        {runs.length > 0 ? (
          <div className="divide-y divide-line">
            {runs.slice(0, allRuns ? undefined : 5).map((run) => (
              <details key={run._id} className="group/run">
                <summary className="flex cursor-pointer list-none items-start gap-2 py-2.5 [&::-webkit-details-marker]:hidden">
                  {run.state === "running" ? (
                    <LoaderCircle
                      size={12}
                      className="mt-0.5 shrink-0 animate-spin text-accent-plum"
                    />
                  ) : (
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${stateColor(run.state)}`}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {run.prompt ?? "Investigation"}
                    </span>
                    <span className="mt-1 block text-[10px] text-ink-3">
                      {dateTime(run.startedAt)} · {statusLabel(run.state)}
                    </span>
                  </span>
                  <ChevronDown
                    size={12}
                    className="mt-1 shrink-0 -rotate-90 text-ink-3 group-open/run:rotate-0"
                  />
                </summary>
                <div className="pb-3 pl-3.5 text-xs leading-5">
                  {run.prompt && (
                    <p className="mb-2 text-ink-2">{run.prompt}</p>
                  )}
                  {run.error ? (
                    <>
                      <p className="rounded-lg bg-red-50 p-2 text-[11px] break-words text-red-700">
                        {run.error}
                      </p>
                      <button
                        type="button"
                        className="mt-2 text-xs text-accent-plum"
                        onClick={() =>
                          onSelect(
                            selectionFor(
                              "error",
                              "Failed investigation",
                              run._id,
                              {
                                prompt: run.prompt,
                                error: run.error,
                                startedAt: run.startedAt,
                              },
                            ),
                          )
                        }
                      >
                        Investigate failure <ArrowUpRight size={12} />
                      </button>
                    </>
                  ) : (
                    <p className="text-ink-3">
                      {run.summary ??
                        (run.state === "running"
                          ? "The agent is working on this request."
                          : run.state === "queued"
                            ? "Waiting for the next step."
                            : "No run summary recorded.")}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-3">No runs yet.</p>
        )}
        {runs.length > 5 && (
          <button
            type="button"
            onClick={() => setAllRuns(!allRuns)}
            className="mt-2 text-[11px] text-accent-plum"
          >
            {allRuns ? "Show fewer" : `Show all ${runs.length} runs`}
          </button>
        )}
      </Section>
      <Section
        title="Project logs"
        count={detail.logs.length}
        open={errorLogs.length > 0}
      >
        <div
          className="mb-2 flex gap-1"
          role="group"
          aria-label="Filter project logs"
        >
          {[true, false].map((errors) => (
            <button
              type="button"
              key={String(errors)}
              aria-pressed={errorLogsOnly === errors}
              onClick={() => {
                setErrorLogsOnly(errors);
                setAllLogs(false);
              }}
              className={`rounded-md px-2 py-1 text-[11px] ${errorLogsOnly === errors ? "bg-selection text-ink" : "text-ink-3 hover:bg-field"}`}
            >
              {errors ? `Errors ${errorLogs.length}` : "All logs"}
            </button>
          ))}
        </div>
        <p className="mb-2 text-[10px] leading-4 text-ink-3">
          Latest captured project events, across chats. Select one to
          investigate.
        </p>
        {logs.slice(0, allLogs ? undefined : 8).map((log) => (
          <button
            type="button"
            key={log._id}
            className="block w-full rounded-lg p-2 text-left hover:bg-field"
            aria-label={`Investigate log: ${log.functionPath} ${dateTime(log.timestamp)}`}
            onClick={() =>
              onSelect(
                selectionFor(
                  "error",
                  `${log.functionPath} · ${log.level}`,
                  log.eventId,
                  {
                    eventId: log.eventId,
                    timestamp: log.timestamp,
                    level: log.level,
                    functionPath: log.functionPath,
                    message: log.message.slice(0, 3500),
                  },
                ),
              )
            }
          >
            <span className="flex items-center gap-2">
              <span
                className={`size-1 shrink-0 rounded-full ${/error|critical|fatal/i.test(log.level) ? "bg-red-500" : "bg-zinc-400"}`}
              />
              <span className="truncate font-mono text-[11px] text-ink">
                {log.functionPath}
              </span>
              <span className="ml-auto text-[10px] text-ink-3">
                {log.level}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-3">
              {log.message}
            </span>
          </button>
        ))}
        {!logs.length && (
          <p className="py-2 text-xs text-ink-3">
            {errorLogsOnly
              ? "No errors in the captured logs."
              : "No captured logs yet."}
          </p>
        )}
        {logs.length > 8 && (
          <button
            type="button"
            className="mt-2 text-[11px] text-accent-plum"
            onClick={() => setAllLogs(!allLogs)}
          >
            {allLogs ? "Show fewer" : `Show all ${logs.length} events`}
          </button>
        )}
      </Section>
      <Section title="Sandbox receipts" count={detail.sandboxes.length}>
        <p className="mb-2 text-[10px] leading-4 text-ink-3">
          Recorded lifecycle state; not a live VM health check.
        </p>
        {detail.sandboxes.map((sandbox) => (
          <details
            key={sandbox._id}
            className="group/sandbox border-t border-line py-2 first:border-0"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={11}
                className="-rotate-90 group-open/sandbox:rotate-0"
              />
              <span className="min-w-0 flex-1 truncate">
                {sandbox.purpose === "Jupyter notebook"
                  ? "Notebook"
                  : sandbox.purpose}
              </span>
              <span className="text-[10px] text-ink-3">
                {sandbox.expiresAt && sandbox.expiresAt <= now
                  ? "Expired"
                  : statusLabel(sandbox.state)}
              </span>
            </summary>
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 text-[10px] break-all text-ink-3">
                {sandbox.slug}
              </code>
              <button
                type="button"
                className="result-control size-6"
                aria-label="Copy sandbox ID"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sandbox.slug);
                    setCopied(sandbox._id);
                  } catch {
                    setCopied("");
                  }
                }}
              >
                {copied === sandbox._id ? (
                  <Check size={12} />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            </div>
            {sandbox.expiresAt && (
              <p className="mt-1 text-[10px] text-ink-3">
                Expires {dateTime(sandbox.expiresAt)}
              </p>
            )}
          </details>
        ))}
        {!detail.sandboxes.length && (
          <p className="text-xs text-ink-3">No sandbox receipts recorded.</p>
        )}
      </Section>
    </div>
  );
}
