import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Message, ToolStep } from "../types";
import { selectionFor, type SelectResult } from "../results";
import { NotebookOutput } from "./NotebookOutput";
import { PythonCode } from "./PythonCode";
import { SyntaxCode } from "./SyntaxCode";
import { JsonOutput } from "./JsonOutput";
import { MarkdownTable } from "./MarkdownTable";
import { ErrorResult } from "./ErrorResult";
import { MessageResults } from "./MessageResults";
import { ThinkingStatus } from "./ThinkingStatus";
import type { ArtifactSource } from "./OpenArtifactButton";
const pretty = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
function markdownComponents(
  onSelect: SelectResult,
  sourceId: string,
): Components {
  return {
    code: ({ className, children }) =>
      /\blanguage-(python|py)\b/i.test(className ?? "") ? (
        <PythonCode code={String(children)} className={className} />
      ) : /\blanguage-json\b/i.test(className ?? "") ? (
        <SyntaxCode
          code={String(children)}
          language="json"
          className={className}
        />
      ) : /\b(?:[A-Z][A-Z_]*(?:ERROR|FAILED|TIMEOUT|DECLINED)[A-Z_]*|[A-Za-z]+Error)\b/.test(
          String(children),
        ) && !className ? (
        <button
          type="button"
          className="inline rounded bg-red-50 px-1.5 py-0.5 font-mono text-sm text-red-700 underline decoration-red-200 underline-offset-2 hover:bg-red-100"
          title="Investigate this error"
          onClick={() =>
            onSelect(
              selectionFor("error", String(children).slice(0, 160), sourceId, {
                error: String(children).slice(0, 3000),
              }),
            )
          }
        >
          {children}
        </button>
      ) : (
        <code className={className}>{children}</code>
      ),
    table: ({ node }) => (
      <MarkdownTable node={node} sourceId={sourceId} onSelect={onSelect} />
    ),
  };
}

export function MessageView({
  message,
  viewKey,
  showName,
  onSelect,
  compact = false,
  artifactEditor = false,
  artifactSource,
}: {
  message: Message;
  viewKey: string;
  showName: boolean;
  compact?: boolean;
  artifactEditor?: boolean;
  artifactSource: ArtifactSource;
  onSelect: SelectResult;
}) {
  const text = message.text;
  const [answerCollapsed, setAnswerCollapsed] = useState(false);
  useEffect(() => {
    try {
      setAnswerCollapsed(
        localStorage.getItem(`workbench.answer-collapse:${viewKey}`) === "true",
      );
    } catch {
      /* Optional layout preference. */
    }
  }, [viewKey]);
  const toggleAnswer = () =>
    setAnswerCollapsed((value) => {
      try {
        localStorage.setItem(
          `workbench.answer-collapse:${viewKey}`,
          String(!value),
        );
      } catch {
        /* Optional layout preference. */
      }
      return !value;
    });
  const markdown = useMemo(
    () => markdownComponents(onSelect, message.key),
    [onSelect, message.key],
  );
  // Token updates should not reparse Markdown in every completed message.
  const renderedMarkdown = useMemo(
    () => (
      <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
        {text}
      </Markdown>
    ),
    [markdown, text],
  );
  const streaming = message.status === "streaming";
  const duplicates =
    message.tools?.filter(
      (tool) =>
        tool.output &&
        typeof tool.output === "object" &&
        "status" in tool.output &&
        tool.output.status === "duplicate",
    ).length ?? 0;
  const tools = useMemo(
    () =>
      message.tools?.filter(
        (tool) =>
          !(
            tool.output &&
            typeof tool.output === "object" &&
            "status" in tool.output &&
            ["awaiting_approval", "duplicate"].includes(
              String(tool.output.status),
            )
          ),
      ) ?? [],
    [message.tools],
  );
  if (
    message.role !== "user" &&
    !text &&
    !streaming &&
    !tools.length &&
    message.status !== "failed"
  )
    return null;
  if (message.role === "user")
    return (
      <div className="request-brief mx-auto mt-4 w-full max-w-[680px] border-t border-line pt-6 first:mt-0 first:border-0 first:pt-0">
        <div>
          <p
            className={`${compact ? "text-sm" : "text-[24px] max-sm:text-xl"} leading-[1.35] font-medium tracking-[-0.035em] wrap-anywhere whitespace-pre-wrap text-ink`}
          >
            {message.text}
          </p>
          {message.selection && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-xs text-ink-3">
              <ArrowRight size={12} />
              <span className="truncate">{message.selection.label}</span>
            </div>
          )}
          {message.queued && (
            <span className="mt-1 block text-xs text-ink-3">
              Waiting for next step
            </span>
          )}
        </div>
      </div>
    );
  return (
    <div className={`agent-message ${showName ? "with-name" : ""}`}>
      {!!tools.length && (
        <ExecutionDetails streaming={streaming} count={tools.length}>
          {tools.map((tool) => (
            <ToolActivity key={tool.id} tool={tool} onSelect={onSelect} />
          ))}
          {duplicates > 0 && (
            <p className="pb-2 text-xs text-ink-3">
              {duplicates} duplicate request{duplicates === 1 ? "" : "s"}{" "}
              skipped
            </p>
          )}
        </ExecutionDetails>
      )}
      {!!text && (
        <button
          type="button"
          className="answer-fold mx-auto mb-2 flex w-full max-w-[680px] justify-start gap-2 py-1 text-xs text-ink-3 hover:text-ink"
          aria-label={answerCollapsed ? "Expand answer" : "Collapse answer"}
          aria-expanded={streaming || !answerCollapsed}
          disabled={streaming}
          onClick={toggleAnswer}
        >
          <ChevronDown
            size={13}
            className={`transition-transform ${answerCollapsed && !streaming ? "-rotate-90" : ""}`}
          />
          {answerCollapsed && !streaming ? (
            <span className="truncate">
              {text.replace(/[#*`]/g, "").slice(0, 90)}
            </span>
          ) : (
            <span>Answer</span>
          )}
        </button>
      )}
      {!!text && (
        <div
          className={`collapsible-content ${answerCollapsed && !streaming ? "is-collapsed" : ""}`}
          inert={answerCollapsed && !streaming}
          aria-hidden={answerCollapsed && !streaming}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              data-streaming={streaming || undefined}
              className="markdown mx-auto max-w-[680px] text-[15px] leading-6 wrap-anywhere text-ink tabular-nums [&_a]:text-accent-plum [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-500 [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-zinc-800 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p+p]:mt-4 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:bg-zinc-50 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-zinc-900 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6"
            >
              {renderedMarkdown}
            </div>
          </div>
        </div>
      )}
      {streaming && message.thinking && !text ? (
        <ThinkingStatus key={message.key} />
      ) : (
        !text && streaming && !tools.length && <StreamingCursor />
      )}
      {message.status === "failed" && (
        <p className="error mx-auto mb-3 w-full max-w-[680px] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          This response could not finish. Try again when the provider is
          available.
        </p>
      )}
      <MessageResults
        artifactSource={{ ...artifactSource, messageId: message.id }}
        key={viewKey}
        storageKey={viewKey}
        tools={
          artifactEditor
            ? tools.filter(
                (tool) =>
                  !(
                    tool.output &&
                    typeof tool.output === "object" &&
                    "artifactUpdate" in tool.output &&
                    (
                      tool.output.artifactUpdate as {
                        state?: string;
                        displayed?: boolean;
                      }
                    )?.state === "saved" &&
                    (tool.output.artifactUpdate as { displayed?: boolean })
                      .displayed
                  ),
              )
            : tools
        }
        onSelect={onSelect}
      />
      {!streaming && (message.text || message.openrouterProviders) && (
        <div className="mx-auto mt-3 flex max-w-[680px] flex-wrap items-center gap-x-3 gap-y-1">
          {!!message.text && <CopyMessage text={message.text} />}
          {message.openrouterProviders && (
            <span
              className="text-xs text-ink-3"
              title="Inference provider reported by OpenRouter for this response"
            >
              OpenRouter ·{" "}
              {message.openrouterProviders.join(", ") ||
                "Provider not reported"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
function ExecutionDetails({
  streaming,
  count,
  children,
}: {
  streaming: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(streaming);
  useLayoutEffect(() => setOpen(streaming), [streaming]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mx-auto mb-3 max-w-[680px] [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex w-fit cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-xs text-ink-3 transition-colors hover:bg-hover hover:text-ink">
        {streaming ? (
          <LoaderCircle size={13} className="animate-spin" />
        ) : (
          <Check size={13} />
        )}
        <span>
          {streaming ? "Working" : "Execution details"} · {count}{" "}
          {count === 1 ? "call" : "calls"}
        </span>
        <ChevronRight
          size={13}
          className={`ml-auto transition-transform ${open ? "rotate-90" : ""}`}
        />
      </summary>
      <div className="mt-2 flex flex-col gap-1 border-l-2 border-line py-1 pl-3">
        {children}
      </div>
    </details>
  );
}
export function StreamingCursor() {
  return (
    <span
      role="status"
      className="mx-auto block w-full max-w-[680px] py-1 text-ink-3"
    >
      <span aria-hidden="true" className="streaming-cursor" />
      <span className="sr-only">Waiting for response</span>
    </span>
  );
}
function CopyMessage({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Copy message"
        title="Copy message"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("error");
          }
        }}
        className="rounded-md px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
      >
        {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
        <span role="status">{state === "copied" ? "Copied" : "Copy"}</span>
      </button>
      {state === "error" && (
        <span role="alert" className="text-xs text-red-600">
          Couldn’t copy. Please try again.
        </span>
      )}
    </div>
  );
}
const toolLabels: Record<string, string> = {
  readLogs: "Read deployment logs",
  runQuery: "Query the deployment",
  analyzeWithPython: "Analyze evidence in Python",
  recordFinding: "Record a finding",
  proposeMutation: "Request permission to make a change",
  requestAccess: "Request additional access",
};
function ToolActivity({
  tool,
  onSelect,
}: {
  tool: ToolStep;
  onSelect: SelectResult;
}) {
  const input =
    tool.input && typeof tool.input === "object"
      ? (tool.input as Record<string, unknown>)
      : {};
  const output =
    tool.output && typeof tool.output === "object"
      ? (tool.output as Record<string, unknown>)
      : {};
  if (output.status === "awaiting_approval") return null;
  const command =
    tool.name === "notebook" && typeof input.code === "string"
      ? input.code
      : tool.name === "exec" && typeof input.command === "string"
        ? input.command
        : undefined;
  const timedOut = output.timedOut === true;
  const complete = tool.state === "output-available";
  const failed =
    tool.state === "output-error" ||
    tool.state === "output-denied" ||
    (tool.name === "notebook" &&
      complete &&
      !["ok", "limit_reached"].includes(String(output.status))) ||
    (tool.name === "exec" && complete && (timedOut || output.exitCode !== 0));
  const status =
    output.status === "limit_reached"
      ? "Limit reached"
      : timedOut || output.status === "timeout"
        ? "Timed out"
        : failed
          ? "Failed"
          : complete
            ? "Done"
            : "Running";
  const label =
    tool.name === "exec"
      ? "Sandbox command"
      : (toolLabels[tool.name] ?? tool.name);
  const durationMs =
    typeof output.totalDurationMs === "number"
      ? output.totalDurationMs
      : output.durationMs;
  const durationTitle =
    tool.name === "notebook" && typeof output.durationMs === "number"
      ? typeof output.totalDurationMs === "number"
        ? `Total tool time, including setup and network access. Python: ${(output.durationMs / 1000).toFixed(2)}s.`
        : "Python execution time. Total tool time was not recorded for this older cell."
      : undefined;
  const notebookComplete =
    tool.name === "notebook" &&
    complete &&
    ["ok", "error", "timeout"].includes(String(output.status));
  const hasNotebookText =
    notebookComplete &&
    (output.stdout ||
      output.stderr ||
      output.text ||
      output.outputTruncated ||
      output.kernelReset);
  return (
    <div className="min-w-0">
      <details
        className={`tool-activity min-w-0 text-sm text-zinc-600 [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:gap-2.5 [&_summary]:py-2 [&_summary::-webkit-details-marker]:hidden [&.failed_.tool-state]:bg-red-100 [&.failed_.tool-state]:text-red-600 [&[open]_.tool-chevron]:rotate-90 ${failed ? "failed" : ""}`}
      >
        <summary>
          <span className="tool-state grid size-5 shrink-0 place-items-center rounded-full bg-zinc-200/70 text-zinc-600">
            {failed ? (
              <X size={13} />
            ) : complete ? (
              <Check size={13} />
            ) : (
              <LoaderCircle size={13} className="spin animate-spin" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            {tool.name !== "notebook" && (
              <span className="block text-xs font-medium text-zinc-700">
                {label}
              </span>
            )}
            {command &&
              (tool.name === "notebook" ? (
                <PythonCode
                  code={command}
                  className="block truncate text-xs text-zinc-600"
                />
              ) : (
                <code className="mt-1 block truncate text-[11px] text-zinc-500">
                  {command}
                </code>
              ))}
            {tool.name === "readLogs" &&
              typeof output.fetchedEvents === "number" && (
                <span className="mt-1 block text-[11px] text-zinc-500">
                  {output.fetchedEvents} new log events
                </span>
              )}
          </span>
          <span
            className="shrink-0 text-[11px] text-zinc-400"
            title={durationTitle}
          >
            {status}
            {typeof durationMs === "number"
              ? ` · ${(durationMs / 1000).toFixed(1)}s`
              : ""}
          </span>
          <ChevronRight
            className="tool-chevron ml-auto shrink-0 text-zinc-400 transition-transform"
            size={14}
          />
        </summary>
        <div className="tool-content my-3 rounded-lg border border-zinc-200 bg-surface p-4 [&_.section-label]:mb-2 [&_.section-label]:text-[10px] [&_pre]:mb-4 [&_pre]:max-h-72 [&_pre]:overflow-auto [&_pre]:text-xs [&_pre]:leading-5 [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:text-zinc-700 [&_pre:last-child]:mb-0">
          {tool.name !== "notebook" && (
            <span className="section-label mb-3 flex items-center justify-between text-xs font-medium tracking-wide text-zinc-500">
              {command ? "COMMAND" : "INPUT"}
            </span>
          )}
          <pre>
            {command && tool.name === "notebook" ? (
              <PythonCode code={command} className="text-xs" />
            ) : command ? (
              command
            ) : (
              <JsonOutput text={pretty(tool.input ?? {})} />
            )}
          </pre>
          {command && tool.name !== "notebook" && (
            <p className="mb-4 text-xs text-zinc-500">
              {typeof input.timeoutMs === "number"
                ? `${input.timeoutMs / 1000}s timeout`
                : ""}
              {input.access === "none"
                ? " · No network"
                : ` · ${input.access === "logs" ? "Log access" : "Allowed query"}`}
              {complete
                ? ` · ${timedOut ? "Timeout reached" : `Exit ${output.exitCode}`}`
                : ""}
            </p>
          )}
          {tool.name === "notebook" ? null : command && complete ? (
            <>
              <span className="section-label">STDOUT</span>
              <pre>
                <JsonOutput
                  text={
                    typeof output.stdout === "string" && output.stdout
                      ? output.stdout
                      : "No output"
                  }
                />
              </pre>
              {typeof output.stderr === "string" && output.stderr && (
                <>
                  <span className="section-label">STDERR</span>
                  <pre>
                    <JsonOutput text={output.stderr} />
                  </pre>
                </>
              )}
              {output.outputTruncated === true && (
                <p className="text-xs text-zinc-500">
                  Output truncated to 4,000 characters per stream.
                </p>
              )}
            </>
          ) : (
            tool.output !== undefined && (
              <>
                <span className="section-label mb-3 flex items-center justify-between text-xs font-medium tracking-wide text-zinc-500">
                  RESULT
                </span>
                <pre>
                  <JsonOutput text={pretty(tool.output)} />
                </pre>
              </>
            )
          )}
          {tool.error && (
            <p className="error mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              {tool.error}
            </p>
          )}
        </div>
        {Boolean(hasNotebookText) && (
          <div className="mb-3 border-t border-line pt-3">
            <span className="mb-2 block text-[10px] font-medium tracking-wide text-zinc-500">
              OUTPUT
            </span>
            <NotebookOutput output={tool.output} display="text" />
          </div>
        )}
      </details>
      {failed && (
        <div className="pb-2">
          <ErrorResult
            error={
              typeof output.stderr === "string" && output.stderr
                ? output.stderr
                : (tool.error ?? "This cell failed.")
            }
            code={command}
            sourceId={tool.id}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}
