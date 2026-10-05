import { ArrowUpRight, AlertCircle } from "lucide-react";
import { selectionFor, type SelectResult } from "../results";

export function ErrorResult({
  error,
  sourceId,
  code,
  onSelect,
}: {
  error: string;
  sourceId: string;
  code?: string;
  onSelect?: SelectResult;
}) {
  const lines = error.trim().split("\n").filter(Boolean);
  const title = (lines.at(-1) ?? "Execution failed").slice(0, 180);
  return (
    <button
      type="button"
      disabled={!onSelect}
      onClick={() =>
        onSelect?.(
          selectionFor("error", title, sourceId, {
            error: error.slice(-3500),
            ...(code ? { code: code.slice(0, 1800) } : {}),
          }),
        )
      }
      className="flex w-full items-start justify-start gap-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 disabled:cursor-default disabled:opacity-100"
    >
      <AlertCircle size={14} className="mt-0.5" />
      <span className="min-w-0 flex-1 break-words">{title}</span>
      {onSelect && (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          Investigate <ArrowUpRight size={12} />
        </span>
      )}
    </button>
  );
}
