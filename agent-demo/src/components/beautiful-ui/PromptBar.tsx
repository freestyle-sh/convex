// Adapted from Beautiful UI PromptBar (MIT, Shane Levine). See ./LICENSE.
// The gallery's scripted replies and demo controls are replaced by live Convex state.
import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, X, ArrowUpRight } from "lucide-react";
import type { ResultSelection } from "../../../convex/lib/resultSelection";
import { appName } from "../../brand";

export function PromptBar({
  inputId = "message",
  value,
  onChange,
  onSubmit,
  disabled,
  sending,
  canSend,
  modelPicker,
  placeholder,
  selection,
  clearSelection,
  variant = "reply",
}: {
  inputId?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  disabled: boolean;
  sending: boolean;
  canSend: boolean;
  modelPicker: ReactNode;
  placeholder: string;
  selection?: ResultSelection;
  clearSelection?: () => void;
  variant?: "start" | "reply";
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, variant === "start" ? 84 : 42), 180)}px`;
    input.style.overflowY = input.scrollHeight > 180 ? "auto" : "hidden";
  }, [value, variant]);
  return (
    <form
      onSubmit={onSubmit}
      className={`relative rounded-xl border p-2 transition-[border-color,box-shadow] duration-150 focus-within:border-accent-plum/40 focus-within:shadow-bui-focus ${variant === "start" ? "border-line-strong/60 bg-field/45 sm:p-3" : "border-line-strong/60 bg-surface"}`}
    >
      {selection && (
        <div
          className="mx-2 mt-1 flex items-center gap-2 rounded-lg bg-selection px-2.5 py-2 text-xs text-ink-2"
          role="status"
        >
          <ArrowUpRight size={13} />
          <span
            className="min-w-0 flex-1 [overflow-wrap:anywhere]"
            title={selection.label}
          >
            {selection.label}
          </span>
          <button
            type="button"
            aria-label="Remove selected context"
            onClick={clearSelection}
            className="size-9 shrink-0 rounded-lg hover:bg-zinc-200"
          >
            <X size={13} />
          </button>
        </div>
      )}
      <textarea
        ref={inputRef}
        id={inputId}
        aria-label={`Message ${appName}`}
        value={value}
        maxLength={8000}
        rows={1}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (canSend) event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        className={`min-h-[42px] w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 leading-7 [overflow-wrap:anywhere] text-ink outline-none placeholder:text-ink-3 focus:border-transparent focus:outline-none ${variant === "start" ? "text-xl tracking-[-0.025em] sm:text-[23px]" : "text-[15px]"}`}
      />
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 pb-1">
        {modelPicker}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            aria-label="Send message"
            disabled={!canSend}
            className={`shrink-0 rounded-lg bg-action text-white transition-[background-color,transform] hover:bg-action-hover enabled:active:scale-95 disabled:bg-field disabled:text-ink-3 disabled:opacity-100 ${variant === "start" ? "h-9 px-3 text-xs font-medium" : "size-8"}`}
          >
            {variant === "start" && <span>Investigate</span>}
            {sending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : variant === "start" ? (
              <ArrowUpRight size={16} />
            ) : (
              <ArrowUp size={17} strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
