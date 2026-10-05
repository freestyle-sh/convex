import { NotebookOutput } from "./NotebookOutput";
import { PythonCode } from "./PythonCode";
import { JsonOutput } from "./JsonOutput";
import { useEffect, useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import {
  isWrite,
  operationActions,
  operationLabels,
} from "../../convex/lib/operations";
import { requestActions } from "../../convex/lib/notebookAccess";
import type { Project, Proposal } from "../types";
import { PermissionHistory } from "./PermissionHistory";

export function PermissionRequests({
  proposals,
  project,
  busy,
  decide,
}: {
  proposals: Proposal[];
  project?: Project;
  busy: boolean;
  decide: (id: string, approve: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  if (!proposals.length) return null;
  const active = proposals.filter(
    (p) => p.state === "pending" || p.state === "executing",
  );
  const history = proposals.filter((p) => !active.includes(p));
  function row(p: Proposal) {
    const requests = p.notebook?.requests ?? [
      {
        kind: p.kind ?? "mutation",
        functionPath: p.functionPath,
        argsJson: p.argsJson,
      },
    ];
    const write = requests.some((r) => isWrite(r.kind));
    const changed =
      p.policyVersion !== project?.policyVersion ||
      (p.oneTime &&
        JSON.stringify(p.allowedActions) !==
          JSON.stringify(
            p.notebook
              ? requestActions(requests)
              : operationActions[p.kind ?? "mutation"],
          ));
    const expired = p.expiresAt <= now;
    const allowed =
      project?.enabled &&
      !changed &&
      !expired &&
      (p.oneTime ||
        (project.permissions.proposeChanges &&
          project.allowedMutations.includes(p.functionPath)));
    const status =
      p.state === "pending"
        ? changed
          ? "Access changed"
          : expired
            ? "Expired"
            : write
              ? "Can change data"
              : "Read only"
        : p.state === "executing"
          ? "Running"
          : p.state === "executed"
            ? "Completed"
            : p.state === "rejected"
              ? "Declined"
              : "Check result";
    return (
      <div
        key={p._id}
        className="flex items-start gap-2 border-t border-zinc-100 px-3 py-2 first:border-0"
      >
        <details className="group min-w-0 flex-1">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={13}
              className="shrink-0 text-zinc-400 transition-transform group-open:rotate-90"
            />
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">
              {requests.length === 1
                ? requests[0].functionPath
                : requests.map((r) => r.functionPath).join(" + ")}
            </span>
            <span
              className={`shrink-0 text-[11px] ${write && p.state === "pending" ? "text-amber-700" : "text-zinc-500"}`}
            >
              {status}
            </span>
            {p.state === "executing" && (
              <LoaderCircle size={12} className="animate-spin" />
            )}
          </summary>
          <div className="space-y-3 pt-2 pb-2 pl-5 text-xs leading-5 text-zinc-600">
            <p>{p.reason}</p>
            <p>
              {project?.name} · Each request runs once. Access ends after this
              cell.
            </p>
            {requests.some((r) => r.kind === "action") && (
              <p className="text-amber-700">
                Actions can change data and contact external services.
              </p>
            )}
            {requests.map((r, i) => (
              <div key={i}>
                <p className="font-medium text-zinc-700">
                  {operationLabels[r.kind]} · {r.functionPath}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-50 p-2 text-[11px] break-all whitespace-pre-wrap">
                  <JsonOutput text={r.argsJson} />
                </pre>
              </div>
            ))}
            {p.notebook && (
              <details>
                <summary className="cursor-pointer">Python cell</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[11px] break-all whitespace-pre-wrap">
                  <PythonCode code={p.notebook.code} className="text-[11px]" />
                </pre>
              </details>
            )}
            <details>
              <summary className="cursor-pointer">Credential scope</summary>
              <p className="mt-1 break-all">{p.allowedActions?.join(", ")}</p>
              <p>
                Keys are injected at the network edge and revoked after use,
                with a 31-minute expiry as a fallback.
              </p>
            </details>
            {p.result && (
              <details>
                <summary className="cursor-pointer">Execution result</summary>
                {p.notebookOutput ? (
                  <NotebookOutput output={p.notebookOutput} />
                ) : null}
                <pre className="mt-2 max-h-64 overflow-auto text-[11px] break-all whitespace-pre-wrap">
                  <JsonOutput text={p.result} />
                </pre>
              </details>
            )}
          </div>
        </details>
        {p.state === "pending" && (
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            <button
              className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              disabled={busy}
              onClick={() => decide(p._id, false)}
            >
              Decline
            </button>
            <button
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
              disabled={busy || !allowed}
              onClick={() => decide(p._id, true)}
            >
              {requests.length > 1 ? `Allow ${requests.length}` : "Allow"}
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <section
      aria-label="Permissions"
      className={`mx-auto w-full max-w-[680px] ${active.length ? "overflow-hidden rounded-xl border border-zinc-200 bg-surface" : ""}`}
    >
      {active.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1 text-xs font-medium text-zinc-500">
            Permissions
          </div>
          {active.map(row)}
        </>
      )}
      {history.length > 0 && (
        <div className={active.length ? "border-t border-zinc-100 p-1" : ""}>
          <PermissionHistory proposals={history} />
        </div>
      )}
    </section>
  );
}
