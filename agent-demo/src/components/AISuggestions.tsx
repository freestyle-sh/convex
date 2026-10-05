import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ModelChoice } from "../../convex/lib/models";
import type { ResultSelection } from "../../convex/lib/resultSelection";

export function AISuggestions({
  token,
  projectId,
  model,
  revision,
  enabled,
  disabled,
  onSend,
}: {
  token: string;
  projectId: string;
  model: ModelChoice;
  revision: string;
  enabled: boolean;
  disabled: boolean;
  onSend: (prompt: string, selection?: ResultSelection) => void;
}) {
  const args = { token, projectId: projectId as Id<"projects">, model };
  const suggestions = useQuery(api.suggestions.get, args);
  const request = useMutation(api.suggestions.request);
  const [requestFailed, setRequestFailed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const dismissalKey = `workbench.dismissed-suggestions:${projectId}:${model.provider}:${model.id}`;
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(dismissalKey) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved
            .filter((text): text is string => typeof text === "string")
            .slice(-100)
        : [];
    } catch {
      return [];
    }
  });
  const dismiss = (text: string, index: number) => {
    const next = [...new Set([...dismissed, text])].slice(-100);
    setDismissed(next);
    try {
      sessionStorage.setItem(dismissalKey, JSON.stringify(next));
    } catch {
      // Dismissal still works when browser storage is unavailable.
    }
    requestAnimationFrame(() => {
      const remaining = list.current?.querySelectorAll<HTMLButtonElement>(
        "[data-suggestion-send]",
      );
      const target = remaining?.[Math.min(index, remaining.length - 1)];
      (target ?? document.getElementById("message"))?.focus();
    });
  };
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setRequestFailed(false);
    void request({
      token,
      projectId: projectId as Id<"projects">,
      model,
    }).catch(() => {
      if (current) setRequestFailed(true);
    });
    return () => {
      current = false;
    };
  }, [
    token,
    projectId,
    model.provider,
    model.id,
    revision,
    enabled,
    suggestions?.state,
    request,
  ]);

  if (!enabled) return null;
  const prompts = suggestions?.prompts ?? [];
  const visiblePrompts = prompts.filter(
    (prompt) => !dismissed.includes(prompt.text),
  );
  const failed = requestFailed || suggestions?.state === "error";
  const generating =
    !failed && (!suggestions || suggestions.state === "generating");
  if (prompts.length && !visiblePrompts.length) return null;
  return (
    <div
      ref={list}
      className="mt-7"
      aria-label="Suggested prompts"
      aria-busy={generating}
    >
      {visiblePrompts.map((prompt, index) => (
        <div
          key={prompt.text}
          className="group/suggestion flex min-w-0 items-center gap-1 border-b border-line/70 last:border-0"
        >
          <button
            type="button"
            data-suggestion-send
            disabled={disabled}
            onClick={() => onSend(prompt.text, prompt.selection)}
            className="group flex min-w-0 flex-1 justify-between gap-5 py-3.5 text-left text-sm text-ink-2 transition-colors enabled:hover:text-accent-plum"
          >
            <span className="min-w-0">{prompt.text}</span>
            <ArrowUpRight
              size={15}
              className="shrink-0 text-ink-3 transition-transform group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:-translate-y-0.5"
            />
          </button>
          <button
            type="button"
            aria-label={`Dismiss suggestion: ${prompt.text}`}
            title="Dismiss suggestion"
            onClick={() => dismiss(prompt.text, index)}
            className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 transition-[opacity,color,background-color] group-focus-within/suggestion:opacity-100 group-hover/suggestion:opacity-100 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-plum [@media(hover:none)]:size-9 [@media(hover:none)]:opacity-100"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {generating && !prompts.length && (
        <div
          role="status"
          aria-label="Generating suggestions"
          className="space-y-6 py-3 motion-safe:animate-pulse"
        >
          {["w-3/5", "w-4/5", "w-2/3"].map((width) => (
            <div key={width} className={`h-3 rounded bg-field ${width}`} />
          ))}
        </div>
      )}
      {failed && !prompts.length && (
        <p role="status" className="mt-2 text-xs text-ink-3">
          Couldn’t generate suggestions.
        </p>
      )}
    </div>
  );
}
