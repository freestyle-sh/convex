import type { ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  close,
  children,
  compact = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 p-6 backdrop-blur-sm max-sm:p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <section
        className={`modal max-h-[90dvh] w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-surface shadow-2xl [&_form>.primary]:mt-2 ${compact ? "max-w-md p-5" : "max-w-xl p-6 max-sm:p-5"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className={`modal-header flex items-center justify-between gap-4 [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-zinc-900 ${compact ? "mb-3 [&_h2]:text-base" : "mb-5 [&_h2]:text-xl"}`}
        >
          <h2>{title}</h2>
          <button
            autoFocus
            aria-label="Close dialog"
            className="icon-button size-9 shrink-0 rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 [&.is-active]:bg-zinc-100 [&.is-active]:text-zinc-900"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
