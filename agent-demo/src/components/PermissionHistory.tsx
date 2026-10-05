import { Check, ChevronRight, CircleHelp, X } from "lucide-react";
import type { Proposal } from "../types";
import {
  permissionHistoryOutcome,
  permissionOperations,
  permissionOperationTitle,
  permissionQueryCode,
} from "../permissionHistory";
import { JsonOutput } from "./JsonOutput";
import { PythonCode } from "./PythonCode";

export function PermissionHistory({ proposals }: { proposals: Proposal[] }) {
  const completed = proposals.filter((p) => p.state === "executed").length;
  const declined = proposals.filter((p) => p.state === "rejected").length;
  const unconfirmed = proposals.length - completed - declined;
  const summary = [
    completed && `${completed} completed`,
    declined && `${declined} declined`,
    unconfirmed && `${unconfirmed} unconfirmed`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details className="group/history">
      <summary className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-2 text-xs text-ink-3 transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={13}
          className="transition-transform group-open/history:rotate-90"
        />
        <span className="font-medium">Access history</span>
        <span
          className={`ml-auto text-[11px] ${unconfirmed ? "text-amber-700" : ""}`}
        >
          {summary}
        </span>
      </summary>
      <div className="mt-1 space-y-1">
        {proposals.map((proposal) => {
          const operations = permissionOperations(proposal);
          const title =
            operations.length === 1
              ? permissionOperationTitle(operations[0])
              : `${operations.length} operations`;
          const completed = proposal.state === "executed";
          const declined = proposal.state === "rejected";
          const Icon = completed ? Check : declined ? X : CircleHelp;
          const status = completed
            ? "Completed"
            : declined
              ? "Declined"
              : "Unconfirmed";
          return (
            <details
              key={proposal._id}
              className="group/entry rounded-lg bg-field/60"
            >
              <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-lg px-3 py-2.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
                <Icon
                  size={14}
                  aria-hidden="true"
                  className={`mt-0.5 ${completed ? "text-emerald-600" : declined ? "text-ink-3" : "text-amber-700"}`}
                />
                <span className="min-w-0 flex-1 text-xs leading-5">
                  <span className="block font-medium wrap-anywhere text-ink">
                    {title}
                  </span>
                  <span className="block wrap-anywhere text-ink-3">
                    {permissionHistoryOutcome(proposal)}
                  </span>
                </span>
                <span className="sr-only">{status}</span>
                <ChevronRight
                  size={12}
                  className="mt-1 text-ink-3 transition-transform group-open/entry:rotate-90"
                />
              </summary>
              <div className="space-y-3 px-3 pt-1 pb-3 pl-[38px] text-xs leading-5 text-ink-2">
                <p className="wrap-anywhere">{proposal.reason}</p>
                {operations.map((operation, index) => {
                  const code = permissionQueryCode(operation);
                  return (
                    <div key={index}>
                      {operations.length > 1 && (
                        <p className="font-medium">
                          {permissionOperationTitle(operation)}
                        </p>
                      )}
                      {code && (
                        <pre className="max-h-40 overflow-auto rounded-md border border-line bg-surface px-3 py-2">
                          <code>{code}</code>
                        </pre>
                      )}
                    </div>
                  );
                })}
                <details className="group/technical">
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      size={12}
                      className="transition-transform group-open/technical:rotate-90"
                    />
                    Technical details
                  </summary>
                  <div className="mt-3 space-y-3">
                    {operations
                      .filter((operation) => operation.argsJson !== "{}")
                      .map((operation, index) => (
                        <div key={index}>
                          <p className="mb-1 font-medium">
                            {permissionOperationTitle(operation)} · arguments
                          </p>
                          <pre className="max-h-48 overflow-auto rounded-md bg-surface p-2">
                            <JsonOutput text={operation.argsJson} />
                          </pre>
                        </div>
                      ))}
                    {proposal.notebook && (
                      <div>
                        <p className="mb-1 font-medium">Python cell</p>
                        <pre className="max-h-64 overflow-auto rounded-md bg-surface p-2">
                          <PythonCode code={proposal.notebook.code} />
                        </pre>
                      </div>
                    )}
                    {!!proposal.allowedActions?.length && (
                      <div>
                        <p className="font-medium">Credential scope</p>
                        <p className="wrap-anywhere text-ink-3">
                          {proposal.allowedActions.join(", ")}
                        </p>
                      </div>
                    )}
                    {proposal.result && (
                      <div>
                        <p className="mb-1 font-medium">Raw response</p>
                        <pre className="max-h-64 overflow-auto rounded-md bg-surface p-2">
                          <JsonOutput text={proposal.result} />
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}
