import { ArrowUpRight, X } from "lucide-react";
import type { ReactNode } from "react";

export function SelectionActions({
  label,
  clearLabel,
  investigate,
  clear,
}: {
  label: ReactNode;
  clearLabel: string;
  investigate: () => void;
  clear: () => void;
}) {
  return (
    <div className="mx-auto flex w-fit max-w-full min-w-0 items-stretch rounded-xl border border-accent-plum/15 bg-selection/30 text-xs">
      <button
        type="button"
        aria-label="Investigate this"
        onClick={investigate}
        className="group flex min-h-11 min-w-0 flex-1 items-center justify-start gap-4 rounded-l-xl px-3 py-2 text-left transition-colors hover:bg-selection/60 focus-visible:-outline-offset-2"
      >
        <span
          className="min-w-0 flex-1 [overflow-wrap:anywhere] text-ink-2"
          role="status"
        >
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap text-accent-plum">
          Investigate this
          <ArrowUpRight
            size={14}
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </span>
      </button>
      <button
        type="button"
        aria-label={clearLabel}
        onClick={clear}
        className="min-h-11 w-9 shrink-0 rounded-r-xl text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:-outline-offset-2"
      >
        <X size={14} />
      </button>
    </div>
  );
}
